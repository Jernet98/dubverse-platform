import crypto from 'node:crypto';
import { AppError, booleanValue } from '@/lib/db';
import { mapEpisode, mapProject, mapStudio } from '@/lib/mappers';
import { assertSocialWriteOrigin, jsonBody, socialErrorResponse, socialSession } from '@/lib/social';
import { managedStudios, requireManagedEpisode, requireManagedProject, studioAdminSession } from '@/lib/studio-access';
import { notifyStudioFollowers } from '@/lib/studio-notifications';
import { isUpdate2SchemaMissing, mapPromo, promoValue, safeHttpUrl } from '@/lib/update2';
import { cleanupBlobUrls, uploadPanelImage } from '@/lib/blob-media';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PROJECT_STATUSES = new Set(['ONGOING', 'UPCOMING', 'FINISHED', 'PAUSED', 'CANCELLED']);
const EPISODE_STATUSES = new Set(['DRAFT', 'UPLOADING', 'PROCESSING', 'READY', 'PUBLISHED', 'ERROR', 'RETIRED']);
const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
async function pathOf(context) { const params = await context.params; return Array.isArray(params.path) ? params.path : []; }

function failure(error) {
  if (isUpdate2SchemaMissing(error)) return json({ error: 'El Panel de estudio requiere la migración Dubverse Update 2.' }, 409);
  return socialErrorResponse(error);
}

function text(value, fallback = '', max = 20000) {
  const result = String(value ?? fallback).trim();
  if (result.length > max) throw new AppError(400, 'Uno de los textos supera el límite permitido.');
  return result;
}

function enumValue(value, allowed, fallback) {
  const result = String(value ?? fallback).toUpperCase();
  if (!allowed.has(result)) throw new AppError(400, 'Estado no permitido.');
  return result;
}

function imageValue(value, fallback = '') {
  const result = String(value ?? fallback).trim();
  if (!result || result.startsWith('/')) return result;
  return safeHttpUrl(result, 'La imagen');
}

function socialsValue(value, fallback = {}) {
  if (value === undefined) return fallback || {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError(400, 'Las redes sociales deben ser un objeto.');
  const result = {};
  for (const [key, url] of Object.entries(value)) {
    if (!/^[a-z0-9_-]{1,40}$/i.test(key)) throw new AppError(400, 'Nombre de red social no permitido.');
    const safe = safeHttpUrl(url, `La URL de ${key}`);
    if (safe) result[key.toLowerCase()] = safe;
  }
  return result;
}

async function panelData(session) {
  const [studios, projects, episodes, promos] = await session.sql.transaction([
    session.sql`SELECT s.* FROM studios s WHERE s.id = ${session.studioId} AND s.deleted_at IS NULL`,
    session.sql`SELECT p.*, COUNT(e.id) FILTER (WHERE e.deleted_at IS NULL)::int AS episode_count
      FROM project_studios ps JOIN projects p ON p.id = ps.project_id
      LEFT JOIN episodes e ON e.project_id = p.id
      WHERE ps.studio_id = ${session.studioId} AND p.deleted_at IS NULL GROUP BY p.id ORDER BY p.title`,
    session.sql`SELECT e.*, p.title AS project_title FROM episodes e JOIN projects p ON p.id = e.project_id
      JOIN project_studios ps ON ps.project_id = p.id
      WHERE ps.studio_id = ${session.studioId} AND e.deleted_at IS NULL AND p.deleted_at IS NULL
      ORDER BY p.title, e.season, e.number`,
    session.sql`SELECT pm.* FROM project_promo_media pm JOIN project_studios ps ON ps.project_id = pm.project_id
      WHERE ps.studio_id = ${session.studioId} ORDER BY pm.project_id, pm.position, pm.created_at`
  ], { readOnly: true });
  return {
    studio: mapStudio(studios[0]),
    membership: session.membership,
    projects: projects.map(mapProject),
    episodes: episodes.map(mapEpisode),
    promos: promos.map(mapPromo)
  };
}

export async function GET(request, context) {
  try {
    const path = await pathOf(context);
    if (!path.length) {
      const session = await socialSession(request, { required: true, active: true });
      const rows = await managedStudios(session.sql, session.row.id);
      return json({ studios: rows.map(row => ({ id: row.id, name: row.name, logo: row.logo || '', banner: row.banner || '', isVerified: row.is_verified, role: row.role })) });
    }
    return json(await panelData(await studioAdminSession(request, path[0])));
  } catch (error) { return failure(error); }
}

export async function PATCH(request, context) {
  try {
    assertSocialWriteOrigin(request);
    const path = await pathOf(context);
    const body = await jsonBody(request);
    if (path[0] === 'studios' && path[1] && path.length === 2) {
      const session = await studioAdminSession(request, path[1]);
      const rows = await session.sql`SELECT * FROM studios WHERE id = ${path[1]} AND deleted_at IS NULL`;
      if (!rows.length) throw new AppError(404, 'Estudio no encontrado.');
      const old = rows[0];
      const logo = imageValue(body.logo, old.logo) || null;
      const banner = imageValue(body.banner, old.banner) || null;
      await session.sql`UPDATE studios SET
        name = ${text(body.name, old.name, 160)}, director = ${text(body.director, old.director, 240)},
        description = ${text(body.description, old.description)}, logo = ${logo},
        banner = ${banner},
        socials = ${JSON.stringify(socialsValue(body.socials, old.socials))}::jsonb, updated_at = now()
        WHERE id = ${session.studioId}`;
      await cleanupBlobUrls(session.sql, [old.logo !== logo ? old.logo : null, old.banner !== banner ? old.banner : null]);
      return json({ ok: true });
    }
    if (path[0] === 'studios' && path[1] && path[2] === 'projects' && path[3] && path.length === 4) {
      const session = await studioAdminSession(request, path[1]);
      const old = await requireManagedProject(session, path[3]);
      const published = body.published === undefined ? old.published : booleanValue(body.published);
      const poster = imageValue(body.poster, old.poster) || null;
      const banner = imageValue(body.banner, old.banner) || null;
      await session.sql`UPDATE projects SET title = ${text(body.title, old.title, 240)},
        alternate_title = ${text(body.alternateTitle, old.alternate_title, 240)}, synopsis = ${text(body.synopsis, old.synopsis)},
        project_director = ${text(body.projectDirector, old.project_director, 240)}, dubbing_info = ${text(body.dubbingInfo, old.dubbing_info)},
        credits = ${text(body.credits, old.credits)}, status = ${enumValue(body.status, PROJECT_STATUSES, old.status)},
        poster = ${poster}, banner = ${banner},
        published = ${published}, updated_at = now() WHERE id = ${old.id}`;
      await cleanupBlobUrls(session.sql, [old.poster !== poster ? old.poster : null, old.banner !== banner ? old.banner : null]);
      if (!old.published && published) await notifyStudioFollowers(session.sql, { type: 'STUDIO_NEW_PROJECT', projectId: old.id, actorProfileId: session.row.id });
      return json({ ok: true });
    }
    if (path[0] === 'studios' && path[1] && path[2] === 'episodes' && path[3] && path.length === 4) {
      const session = await studioAdminSession(request, path[1]);
      const old = await requireManagedEpisode(session, path[3]);
      const published = body.published === undefined ? old.published : booleanValue(body.published);
      await session.sql`UPDATE episodes SET title = ${text(body.title, old.title, 240)},
        description = ${text(body.description, old.description)}, status = ${enumValue(body.status, EPISODE_STATUSES, old.status)},
        published = ${published}, updated_at = now() WHERE id = ${old.id}`;
      if (!old.published && published) await notifyStudioFollowers(session.sql, { type: 'STUDIO_NEW_EPISODE', projectId: old.project_id, episodeId: old.id, actorProfileId: session.row.id });
      return json({ ok: true });
    }
    if (path[0] === 'studios' && path[1] && path[2] === 'promos' && path[3] && path.length === 4) {
      const session = await studioAdminSession(request, path[1]);
      const rows = await session.sql`SELECT pm.* FROM project_promo_media pm JOIN project_studios ps ON ps.project_id = pm.project_id
        WHERE pm.id = ${path[3]}::uuid AND ps.studio_id = ${session.studioId}`;
      if (!rows.length) throw new AppError(403, 'El material no pertenece al estudio administrado.');
      const value = promoValue(body, rows[0]);
      await session.sql`UPDATE project_promo_media SET type = ${value.type}, provider = ${value.provider}, title = ${value.title},
        url = ${value.url}, provider_identifier = ${value.providerIdentifier}, provider_file = ${value.providerFile},
        thumbnail_url = ${value.thumbnailUrl}, position = ${value.position}, is_active = ${Boolean(value.isActive)}, updated_at = now()
        WHERE id = ${path[3]}::uuid`;
      await cleanupBlobUrls(session.sql, [rows[0].thumbnail_url !== value.thumbnailUrl ? rows[0].thumbnail_url : null]);
      return json({ ok: true });
    }
    throw new AppError(404, 'Ruta del Panel de estudio no encontrada.');
  } catch (error) { return failure(error); }
}

export async function POST(request, context) {
  try {
    assertSocialWriteOrigin(request);
    const path = await pathOf(context);
    if (path[0] === 'studios' && path[1] && path[2] === 'media' && path.length === 3) {
      const session = await studioAdminSession(request, path[1]);
      const form = await request.formData();
      const kind = String(form.get('kind') || '').toLowerCase();
      const projectId = text(form.get('projectId'), '', 160);
      if (['project-poster', 'project-banner', 'promo-thumbnail'].includes(kind)) await requireManagedProject(session, projectId);
      const image = await uploadPanelImage(form.get('file'), { studioId: session.studioId, kind });
      return json({ image }, 201);
    }
    if (!(path[0] === 'studios' && path[1] && path[2] === 'promos' && path.length === 3)) throw new AppError(404, 'Ruta del Panel de estudio no encontrada.');
    const session = await studioAdminSession(request, path[1]);
    const body = await jsonBody(request);
    const projectId = text(body.projectId, '', 160);
    await requireManagedProject(session, projectId);
    const value = promoValue(body);
    const rows = await session.sql`INSERT INTO project_promo_media (
      id, project_id, type, provider, title, url, provider_identifier, provider_file, thumbnail_url, position, is_active
    ) VALUES (${crypto.randomUUID()}::uuid, ${projectId}, ${value.type}, ${value.provider}, ${value.title}, ${value.url},
      ${value.providerIdentifier}, ${value.providerFile}, ${value.thumbnailUrl}, ${value.position}, ${Boolean(value.isActive)}) RETURNING *`;
    return json({ promo: mapPromo(rows[0]) }, 201);
  } catch (error) { return failure(error); }
}

export async function DELETE(request, context) {
  try {
    assertSocialWriteOrigin(request);
    const path = await pathOf(context);
    if (path[0] === 'studios' && path[1] && path[2] === 'media' && path.length === 3) {
      const session = await studioAdminSession(request, path[1]);
      const body = await jsonBody(request);
      const urls = Array.isArray(body.urls) ? body.urls.map(String).slice(0, 10) : [];
      return json({ deleted: await cleanupBlobUrls(session.sql, urls) });
    }
    if (!(path[0] === 'studios' && path[1] && path[2] === 'promos' && path[3] && path.length === 4)) throw new AppError(404, 'Ruta del Panel de estudio no encontrada.');
    const session = await studioAdminSession(request, path[1]);
    const rows = await session.sql`DELETE FROM project_promo_media pm USING project_studios ps
      WHERE pm.id = ${path[3]}::uuid AND ps.project_id = pm.project_id AND ps.studio_id = ${session.studioId}
      RETURNING pm.id, pm.thumbnail_url`;
    if (!rows.length) throw new AppError(403, 'El material no pertenece al estudio administrado.');
    await cleanupBlobUrls(session.sql, [rows[0].thumbnail_url]);
    return json({ deleted: true });
  } catch (error) { return failure(error); }
}
