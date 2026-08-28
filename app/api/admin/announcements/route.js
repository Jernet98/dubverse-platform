import { NextResponse } from 'next/server';
import { AppError, getSql } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { assertSocialWriteOrigin } from '@/lib/social';
import { safeAnnouncementLink } from '@/lib/content-discovery';
import { sendAnnouncement } from '@/lib/content-notifications';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const AUDIENCES = new Set(['ALL', 'STUDIO_FOLLOWERS', 'PROJECT_FOLLOWERS', 'USER']);
const json = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const fail = error => json({ error: error instanceof AppError ? error.message : 'No se pudo procesar el anuncio.' }, error instanceof AppError ? error.status : 500);

export async function GET(request) {
  try {
    requireAdmin(request);
    const rows = await getSql()`SELECT * FROM admin_announcements ORDER BY created_at DESC LIMIT 50`;
    return json({ announcements: rows.map(row => ({ id: row.id, title: row.title, message: row.message, imageUrl: row.image_url, linkUrl: row.link_url, audienceType: row.audience_type, audienceId: row.audience_id, recipientCount: Number(row.recipient_count), createdAt: row.created_at })) });
  } catch (error) { return fail(error); }
}

export async function POST(request) {
  try {
    requireAdmin(request);
    assertSocialWriteOrigin(request);
    const raw = await request.json();
    const title = String(raw.title || '').trim().slice(0, 120);
    const message = String(raw.message || '').trim().slice(0, 1000);
    const audienceType = String(raw.audienceType || '').toUpperCase();
    const audienceId = String(raw.audienceId || '').trim().replace(/^@/, '').slice(0, 160);
    const requestId = String(raw.requestId || '').trim().toLowerCase();
    if (!title || !message) throw new AppError(400, 'Título y mensaje son obligatorios.');
    if (!AUDIENCES.has(audienceType)) throw new AppError(400, 'Destinatarios no válidos.');
    if (audienceType !== 'ALL' && !audienceId) throw new AppError(400, 'Selecciona el estudio, proyecto o usuario destinatario.');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestId)) throw new AppError(400, 'Falta una clave de envío válida. Recarga el panel e intenta de nuevo.');
    const sql = getSql();
    let target = [{ exists: true }];
    if (audienceType === 'STUDIO_FOLLOWERS') target = await sql`SELECT EXISTS(SELECT 1 FROM studios WHERE id=${audienceId} AND deleted_at IS NULL) AS exists`;
    if (audienceType === 'PROJECT_FOLLOWERS') target = await sql`SELECT EXISTS(SELECT 1 FROM projects WHERE id=${audienceId} AND deleted_at IS NULL) AS exists`;
    if (audienceType === 'USER') target = await sql`SELECT EXISTS(SELECT 1 FROM user_profiles WHERE lower(username)=lower(${audienceId}) AND status='ACTIVE') AS exists`;
    if (!target[0]?.exists) throw new AppError(400, 'El destinatario seleccionado no existe o no está activo.');
    const imageUrl = safeAnnouncementLink(raw.imageUrl);
    const linkUrl = safeAnnouncementLink(raw.linkUrl);
    const result = await sendAnnouncement(sql, { title, message, imageUrl, linkUrl, audienceType, audienceId, requestId });
    return json(result, 201);
  } catch (error) {
    if (error?.code === '23505') return json({ error: 'Este anuncio ya fue enviado.' }, 409);
    return fail(error);
  }
}
