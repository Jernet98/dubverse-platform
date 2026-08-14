import { NextResponse } from 'next/server';
import { AppError, getSql } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import {
  buildContentIdAudit,
  contentIdValue,
  contentKindValue,
  isAliasSchemaMissing
} from '@/lib/content-ids';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(payload, status = 200) {
  return NextResponse.json(payload, { status, headers: { 'Cache-Control': 'no-store' } });
}

function errorResponse(error) {
  console.error('[Dubverse IDs]', error);
  if (error instanceof AppError) return json({ ok: false, error: error.message }, error.status);
  if (isAliasSchemaMissing(error)) return json({ ok: false, error: 'La migración explícita de IDs y aliases todavía no está aplicada.' }, 503);
  if (error?.code === 'P0002') return json({ ok: false, error: 'El registro con el ID actual ya no existe.' }, 404);
  if (error?.code === '23505') return json({ ok: false, error: 'El nuevo ID ya está ocupado por un registro o alias histórico.' }, 409);
  if (error?.code === '23503') return json({ ok: false, error: 'No se pudo conservar una relación. El cambio fue revertido completamente.' }, 409);
  return json({ ok: false, error: 'No se pudo completar la operación de IDs.' }, 500);
}

function assertWriteOrigin(request) {
  if (request.headers.get('x-admin-key')) return;
  const origin = request.headers.get('origin');
  if (!origin) return;
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  if (!host) return;
  let originHost = '';
  try { originHost = new URL(origin).host; } catch { throw new AppError(403, 'Origen no permitido.'); }
  if (originHost !== host) throw new AppError(403, 'Origen no permitido.');
}

async function segments(context) {
  const params = await context.params;
  return Array.isArray(params?.path) ? params.path.map(decodeURIComponent) : [];
}

async function requestBody(request) {
  try { return await request.json(); } catch { throw new AppError(400, 'El cuerpo de la solicitud no contiene JSON válido.'); }
}

async function idAudit(sql) {
  const [projects, studios, episodes, projectAliases, studioAliases, episodeAliases] = await sql.transaction([
    sql`SELECT id, title, deleted_at FROM projects ORDER BY title`,
    sql`SELECT id, name, deleted_at FROM studios ORDER BY name`,
    sql`SELECT e.id, e.project_id, e.season, e.number, e.title, e.deleted_at, p.title AS project_title
        FROM episodes e JOIN projects p ON p.id = e.project_id ORDER BY p.title, e.season, e.number`,
    sql`SELECT alias, project_id AS target_id, created_at FROM project_slug_aliases ORDER BY created_at`,
    sql`SELECT alias, studio_id AS target_id, created_at FROM studio_slug_aliases ORDER BY created_at`,
    sql`SELECT alias, episode_id AS target_id, created_at FROM episode_slug_aliases ORDER BY created_at`
  ], { readOnly: true });
  const items = buildContentIdAudit({
    projects,
    studios,
    episodes,
    aliases: { projects: projectAliases, studios: studioAliases, episodes: episodeAliases }
  });
  return {
    items,
    summary: {
      total: items.length,
      correct: items.filter(item => item.status === 'CORRECT').length,
      incorrect: items.filter(item => item.status === 'INCORRECT').length,
      conflicts: items.filter(item => item.status === 'CONFLICT').length,
      aliases: projectAliases.length + studioAliases.length + episodeAliases.length
    }
  };
}

async function renameContentId(sql, kind, currentId, newId) {
  const query = kind === 'projects'
    ? sql`SELECT dubverse_rename_project_slug(${currentId}, ${newId}) AS renamed_id`
    : kind === 'studios'
      ? sql`SELECT dubverse_rename_studio_slug(${currentId}, ${newId}) AS renamed_id`
      : sql`SELECT dubverse_rename_episode_slug(${currentId}, ${newId}) AS renamed_id`;
  const transaction = await sql.transaction([query]);
  const renamedId = transaction[0]?.[0]?.renamed_id;
  if (renamedId !== newId) throw new AppError(409, 'No se pudo confirmar el cambio; la transacción fue revertida.');
  return renamedId;
}

export async function GET(request, context) {
  try {
    requireAdmin(request);
    const path = await segments(context);
    if (path.length !== 1 || path[0] !== 'audit') throw new AppError(404, 'Ruta no encontrada.');
    return json(await idAudit(getSql()));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request, context) {
  try {
    requireAdmin(request);
    assertWriteOrigin(request);
    const path = await segments(context);
    if (path.length !== 1 || path[0] !== 'rename') throw new AppError(404, 'Ruta no encontrada.');
    const body = await requestBody(request);
    const kind = contentKindValue(body.kind);
    const currentId = contentIdValue(body.currentId, 'El ID actual');
    const newId = contentIdValue(body.newId);
    if (newId === currentId) throw new AppError(400, 'El nuevo ID debe ser diferente del ID actual.');
    if (String(body.confirmId || '') !== currentId) throw new AppError(400, 'La confirmación no coincide exactamente con el ID actual.');
    const renamedId = await renameContentId(getSql(), kind, currentId, newId);
    return json({ ok: true, kind, oldId: currentId, id: renamedId, alias: currentId });
  } catch (error) {
    return errorResponse(error);
  }
}
