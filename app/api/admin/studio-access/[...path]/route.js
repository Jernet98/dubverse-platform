import crypto from 'node:crypto';
import { AppError, getSql } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { assertSocialWriteOrigin, jsonBody } from '@/lib/social';
import { isUpdate2SchemaMissing } from '@/lib/update2';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(value, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function pathOf(context) {
  const params = await context.params;
  return Array.isArray(params.path) ? params.path : [];
}

function errorResponse(error) {
  if (isUpdate2SchemaMissing(error)) return json({ error: 'Aplica primero la migración Dubverse Update 2 en Preview.' }, 409);
  const status = Number(error?.status || (error?.code === '23505' ? 409 : 500));
  return json({ error: status >= 500 ? 'Error interno de administración de estudios.' : error.message }, status);
}

export async function GET(request) {
  try {
    requireAdmin(request);
    const sql = getSql();
    const query = String(request.nextUrl.searchParams.get('query') || '').trim().replace(/^@/, '').slice(0, 30);
    const [studios, memberships, users] = await sql.transaction([
      sql`SELECT id, name, logo, is_verified FROM studios WHERE deleted_at IS NULL ORDER BY name`,
      sql`SELECT sm.id, sm.role, sm.created_at, s.id AS studio_id, s.name AS studio_name,
          p.id AS profile_id, p.username, p.display_name
        FROM studio_memberships sm JOIN studios s ON s.id = sm.studio_id
        JOIN user_profiles p ON p.id = sm.user_profile_id
        WHERE s.deleted_at IS NULL ORDER BY s.name, p.username`,
      query ? sql`SELECT id, username, display_name FROM user_profiles
        WHERE lower(username) LIKE lower(${`%${query}%`}) AND status = 'ACTIVE'
        ORDER BY CASE WHEN lower(username) = lower(${query}) THEN 0 ELSE 1 END, username LIMIT 12`
        : sql`SELECT id, username, display_name FROM user_profiles WHERE false`
    ], { readOnly: true });
    return json({ studios: studios.map(row => ({ id: row.id, name: row.name, logo: row.logo || '', isVerified: row.is_verified })), memberships, users });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request) {
  try {
    requireAdmin(request);
    assertSocialWriteOrigin(request);
    const body = await jsonBody(request);
    const username = String(body.username || '').trim().replace(/^@/, '');
    const studioId = String(body.studioId || '').trim();
    const role = String(body.role || 'ADMIN').toUpperCase();
    if (!username || !studioId || !['OWNER', 'ADMIN'].includes(role)) throw new AppError(400, 'Usuario, estudio y rol son obligatorios.');
    const sql = getSql();
    const rows = await sql`
      INSERT INTO studio_memberships (id, user_profile_id, studio_id, role, granted_by, updated_at)
      SELECT ${crypto.randomUUID()}::uuid, p.id, s.id, ${role}, 'global-admin', now()
      FROM user_profiles p CROSS JOIN studios s
      WHERE lower(p.username) = lower(${username}) AND p.status = 'ACTIVE'
        AND s.id = ${studioId} AND s.deleted_at IS NULL
      ON CONFLICT (user_profile_id, studio_id) DO UPDATE SET role = EXCLUDED.role, granted_by = 'global-admin', updated_at = now()
      RETURNING id
    `;
    if (!rows.length) throw new AppError(404, 'No se encontró el usuario activo o el estudio.');
    return json({ ok: true, id: rows[0].id }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request, context) {
  try {
    requireAdmin(request);
    assertSocialWriteOrigin(request);
    const path = await pathOf(context);
    if (!path[0]) throw new AppError(400, 'Falta la membresía.');
    const rows = await getSql()`DELETE FROM studio_memberships WHERE id = ${path[0]}::uuid RETURNING id`;
    if (!rows.length) throw new AppError(404, 'Membresía no encontrada.');
    return json({ ok: true, revoked: true });
  } catch (error) {
    return errorResponse(error);
  }
}
