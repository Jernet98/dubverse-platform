import crypto from 'node:crypto';
import { AppError, getSql } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { assertSocialWriteOrigin, jsonBody } from '@/lib/social';
import { isUpdate2SchemaMissing, mapPromo, mapPromoResolved, resolvedPromoValue } from '@/lib/update2';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
async function pathOf(context) { const params = await context.params; return Array.isArray(params.path) ? params.path : []; }
function fail(error) {
  if (isUpdate2SchemaMissing(error)) return json({ error: 'Aplica primero la migración Dubverse Update 2 en Preview.' }, 409);
  const status = Number(error?.status || 500);
  return json({ error: status >= 500 ? 'Error interno del material promocional.' : error.message }, status);
}

export async function GET(request) {
  try {
    requireAdmin(request);
    const projectId = String(request.nextUrl.searchParams.get('projectId') || '').trim();
    if (!projectId) throw new AppError(400, 'Falta projectId.');
    const rows = await getSql()`SELECT * FROM project_promo_media WHERE project_id = ${projectId} ORDER BY position, created_at`;
    return json({ promos: await Promise.all(rows.map(row => mapPromoResolved(row))) });
  } catch (error) { return fail(error); }
}

export async function POST(request) {
  try {
    requireAdmin(request); assertSocialWriteOrigin(request);
    const raw = await jsonBody(request);
    const projectId = String(raw.projectId || '').trim();
    const value = await resolvedPromoValue(raw);
    const rows = await getSql()`INSERT INTO project_promo_media (
        id, project_id, type, provider, title, url, provider_identifier, provider_file, thumbnail_url, position, is_active
      ) SELECT ${crypto.randomUUID()}::uuid, p.id, ${value.type}, ${value.provider}, ${value.title}, ${value.url},
        ${value.providerIdentifier}, ${value.providerFile}, ${value.thumbnailUrl}, ${value.position}, ${Boolean(value.isActive)}
      FROM projects p WHERE p.id = ${projectId} AND p.deleted_at IS NULL RETURNING *`;
    if (!rows.length) throw new AppError(404, 'Proyecto no encontrado.');
    return json({ promo: mapPromo(rows[0]) }, 201);
  } catch (error) { return fail(error); }
}

export async function PATCH(request, context) {
  try {
    requireAdmin(request); assertSocialWriteOrigin(request);
    const [id] = await pathOf(context);
    const sql = getSql();
    const rows = await sql`SELECT * FROM project_promo_media WHERE id = ${id}::uuid`;
    if (!rows.length) throw new AppError(404, 'Material promocional no encontrado.');
    const value = await resolvedPromoValue(await jsonBody(request), rows[0]);
    const updated = await sql`UPDATE project_promo_media SET type = ${value.type}, provider = ${value.provider}, title = ${value.title},
      url = ${value.url}, provider_identifier = ${value.providerIdentifier}, provider_file = ${value.providerFile},
      thumbnail_url = ${value.thumbnailUrl}, position = ${value.position}, is_active = ${Boolean(value.isActive)}, updated_at = now()
      WHERE id = ${id}::uuid RETURNING *`;
    return json({ promo: mapPromo(updated[0]) });
  } catch (error) { return fail(error); }
}

export async function DELETE(request, context) {
  try {
    requireAdmin(request); assertSocialWriteOrigin(request);
    const [id] = await pathOf(context);
    const rows = await getSql()`DELETE FROM project_promo_media WHERE id = ${id}::uuid RETURNING id`;
    if (!rows.length) throw new AppError(404, 'Material promocional no encontrado.');
    return json({ deleted: true });
  } catch (error) { return fail(error); }
}
