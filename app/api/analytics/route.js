import crypto from 'node:crypto';
import { AppError, getSql } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { studioAdminSession } from '@/lib/studio-access';
import { assertSocialWriteOrigin } from '@/lib/social';
import { analyticsDashboard, recordAnalyticsEvent, validateAnalyticsEvent } from '@/lib/analytics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const COOKIE_VISITOR = 'dv_analytics_visitor';
const COOKIE_SESSION = 'dv_analytics_session';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const errorResponse = error => json({ error: error instanceof AppError ? error.message : 'No se pudieron consultar las estadísticas.' }, error instanceof AppError ? error.status : 500);

export async function POST(request) {
  try {
    assertSocialWriteOrigin(request);
    const origin = request.headers.get('origin');
    if (!origin || origin !== new URL(request.url).origin) throw new AppError(403, 'Origen no permitido.');
    if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') throw new AppError(415, 'Se requiere JSON.');
    if (Number(request.headers.get('content-length') || 0) > 1024) throw new AppError(413, 'Evento demasiado grande.');
    const text = await request.text();
    if (text.length > 1024) throw new AppError(413, 'Evento demasiado grande.');
    let body;
    try { body = JSON.parse(text); } catch { throw new AppError(400, 'JSON inválido.'); }
    const event = validateAnalyticsEvent(body);
    const oldVisitor = request.cookies.get(COOKIE_VISITOR)?.value;
    const oldSession = request.cookies.get(COOKIE_SESSION)?.value;
    const visitorId = UUID.test(oldVisitor || '') ? oldVisitor : crypto.randomUUID();
    const sessionId = UUID.test(oldSession || '') ? oldSession : crypto.randomUUID();
    const result = await recordAnalyticsEvent(getSql(), event, visitorId, sessionId);
    const response = json(result, result.recorded ? 201 : 200);
    for (const [name, value, maxAge] of [[COOKIE_VISITOR, visitorId, 31536000], [COOKIE_SESSION, sessionId, 1800]]) {
      response.headers.append('Set-Cookie', `${name}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
    }
    return response;
  } catch (error) { return errorResponse(error); }
}

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const studioId = url.searchParams.get('studio') || null;
    const projectId = url.searchParams.get('project') || null;
    const period = url.searchParams.get('period') || '30d';
    if (studioId && (studioId.length > 120 || !/^[a-zA-Z0-9._-]+$/.test(studioId))) throw new AppError(400, 'Estudio inválido.');
    if (projectId && (projectId.length > 120 || !/^[a-zA-Z0-9._-]+$/.test(projectId))) throw new AppError(400, 'Proyecto inválido.');
    if (url.searchParams.get('scope') === 'admin') {
      requireAdmin(request);
      return json(await analyticsDashboard(getSql(), { studioId, projectId, period }));
    }
    if (!studioId) throw new AppError(400, 'Selecciona un estudio.');
    const session = await studioAdminSession(request, studioId);
    if (projectId) {
      const owns = await session.sql`SELECT 1 FROM project_studios WHERE studio_id = ${session.studioId} AND project_id = ${projectId} LIMIT 1`;
      if (!owns.length) throw new AppError(403, 'El proyecto no pertenece a este estudio.');
    }
    return json(await analyticsDashboard(session.sql, { studioId: session.studioId, projectId, period }));
  } catch (error) { return errorResponse(error); }
}
