import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { AppError, booleanValue, getSql, slugify } from '@/lib/db';
import { isAdminRequest, loginResponse, logoutResponse, requireAdmin, verifyAdminKey } from '@/lib/auth';
import { mapEpisode, mapProject, mapStudio } from '@/lib/mappers';
import { inspectArchive, archiveEmbedUrl } from '@/lib/archive';
import { seedDatabase } from '@/lib/seed';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PROJECT_TYPES = new Set(['SERIES', 'MOVIE', 'OVA', 'SPECIAL']);
const PROJECT_STATUSES = new Set(['ONGOING', 'FINISHED', 'PAUSED', 'CANCELLED']);
const EPISODE_PROVIDERS = new Set(['ARCHIVE', 'PIXELDRAIN', 'EXTERNAL', 'LOCAL']);
const EPISODE_STATUSES = new Set(['DRAFT', 'UPLOADING', 'PROCESSING', 'READY', 'PUBLISHED', 'ERROR', 'RETIRED']);

function json(payload, status = 200) {
  return NextResponse.json(payload, { status, headers: { 'Cache-Control': 'no-store' } });
}

function errorResponse(error) {
  console.error('[Dubverse API]', error);
  if (error instanceof AppError) return json({ ok: false, error: error.message }, error.status);
  if (error?.code === '23505') return json({ ok: false, error: 'Ese registro ya existe o el número de episodio está repetido.' }, 409);
  if (error?.code === '23503') return json({ ok: false, error: 'La operación viola una relación entre registros.' }, 409);
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') return json({ ok: false, error: 'La consulta tardó demasiado.' }, 504);
  return json({ ok: false, error: 'Error interno de Dubverse.' }, 500);
}

async function bodyJson(request) {
  try { return await request.json(); }
  catch { throw new AppError(400, 'El cuerpo de la solicitud no contiene JSON válido.'); }
}

async function getSegments(context) {
  const params = await context.params;
  return Array.isArray(params?.path) ? params.path.map(decodeURIComponent) : [];
}

function requiredText(value, label) {
  const text = String(value || '').trim();
  if (!text) throw new AppError(400, `${label} es obligatorio.`);
  return text;
}

function enumValue(value, allowed, fallback) {
  const normalized = String(value || fallback).toUpperCase();
  if (!allowed.has(normalized)) throw new AppError(400, `Valor no permitido: ${normalized}.`);
  return normalized;
}

function genresValue(value) {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean);
}

function studioIdsValue(value) {
  if (!Array.isArray(value)) return null;
  return [...new Set(value.map(item => String(item).trim()).filter(Boolean))];
}

async function publicProjects(sql) {
  const rows = await sql`
    SELECT p.*, COUNT(e.id) FILTER (WHERE e.published = true) AS episode_count
    FROM projects p LEFT JOIN episodes e ON e.project_id = p.id
    WHERE p.published = true
    GROUP BY p.id ORDER BY p.featured DESC, p.title ASC
  `;
  return rows.map(row => mapProject(row));
}

async function publicStudios(sql) {
  const [studios, relations] = await sql.transaction([
    sql`SELECT * FROM studios WHERE published = true ORDER BY name`,
    sql`SELECT ps.studio_id, p.id, p.title, p.poster, p.type
        FROM project_studios ps JOIN projects p ON p.id = ps.project_id
        WHERE p.published = true ORDER BY p.title`
  ], { readOnly: true });
  const byStudio = new Map();
  for (const relation of relations) {
    if (!byStudio.has(relation.studio_id)) byStudio.set(relation.studio_id, []);
    byStudio.get(relation.studio_id).push({ id: relation.id, title: relation.title, poster: relation.poster || '', type: relation.type });
  }
  return studios.map(row => mapStudio(row, { projects: byStudio.get(row.id) || [] }));
}

async function adminProjects(sql) {
  const [projects, relations] = await sql.transaction([
    sql`SELECT p.*, COUNT(e.id) AS episode_count
        FROM projects p LEFT JOIN episodes e ON e.project_id = p.id
        GROUP BY p.id ORDER BY p.title`,
    sql`SELECT ps.project_id, ps.role, ps.notes, s.id, s.name, s.logo
        FROM project_studios ps JOIN studios s ON s.id = ps.studio_id ORDER BY s.name`
  ], { readOnly: true });
  const byProject = new Map();
  for (const relation of relations) {
    if (!byProject.has(relation.project_id)) byProject.set(relation.project_id, []);
    byProject.get(relation.project_id).push({ id: relation.id, name: relation.name, logo: relation.logo || '', role: relation.role, notes: relation.notes });
  }
  return projects.map(row => mapProject(row, { studios: byProject.get(row.id) || [] }));
}

async function adminStudios(sql) {
  const [studios, relations] = await sql.transaction([
    sql`SELECT * FROM studios ORDER BY name`,
    sql`SELECT ps.studio_id, p.id, p.title, p.poster, p.type
        FROM project_studios ps JOIN projects p ON p.id = ps.project_id ORDER BY p.title`
  ], { readOnly: true });
  const byStudio = new Map();
  for (const relation of relations) {
    if (!byStudio.has(relation.studio_id)) byStudio.set(relation.studio_id, []);
    byStudio.get(relation.studio_id).push({ id: relation.id, title: relation.title, poster: relation.poster || '', type: relation.type });
  }
  return studios.map(row => mapStudio(row, { projects: byStudio.get(row.id) || [] }));
}

async function adminEpisodes(sql) {
  const rows = await sql`SELECT e.*, p.title AS project_title
    FROM episodes e JOIN projects p ON p.id = e.project_id
    ORDER BY p.title, e.season, e.number`;
  return rows.map(row => mapEpisode(row));
}

async function replaceProjectStudios(sql, projectId, studioIds) {
  if (studioIds === null) return;
  const queries = [sql`DELETE FROM project_studios WHERE project_id = ${projectId}`];
  for (const studioId of studioIds) {
    queries.push(sql`INSERT INTO project_studios (project_id, studio_id, role, notes)
      VALUES (${projectId}, ${studioId}, 'Fandoblaje', '')
      ON CONFLICT (project_id, studio_id) DO NOTHING`);
  }
  await sql.transaction(queries);
}

export async function GET(request, context) {
  try {
    const path = await getSegments(context);
    const sql = getSql();

    if (path[0] === 'health') {
      const result = await sql`SELECT now() AS time`;
      return json({ ok: true, service: 'Dubverse', database: true, time: result[0]?.time });
    }
    if (path[0] === 'settings' && path.length === 1) {
      const rows = await sql`SELECT key, value FROM settings`;
      return json(Object.fromEntries(rows.map(row => [row.key, row.value])));
    }
    if (path[0] === 'projects' && path.length === 1) return json(await publicProjects(sql));
    if (path[0] === 'projects' && path[1]) {
      const projectRows = await sql`SELECT p.*, COUNT(e.id) FILTER (WHERE e.published = true) AS episode_count
        FROM projects p LEFT JOIN episodes e ON e.project_id = p.id
        WHERE p.id = ${path[1]} AND p.published = true GROUP BY p.id`;
      if (!projectRows.length) throw new AppError(404, 'Proyecto no encontrado.');
      const [episodes, studios] = await sql.transaction([
        sql`SELECT * FROM episodes WHERE project_id = ${path[1]} AND published = true ORDER BY season, number`,
        sql`SELECT s.*, ps.role, ps.notes FROM project_studios ps JOIN studios s ON s.id = ps.studio_id
            WHERE ps.project_id = ${path[1]} AND s.published = true ORDER BY s.name`
      ], { readOnly: true });
      return json(mapProject(projectRows[0], {
        episodes: episodes.map(row => mapEpisode(row)),
        studios: studios.map(row => ({ ...mapStudio(row), role: row.role, notes: row.notes }))
      }));
    }
    if (path[0] === 'studios' && path.length === 1) return json(await publicStudios(sql));
    if (path[0] === 'episodes' && path[1]) {
      const rows = await sql`SELECT e.*, p.title AS project_title, p.poster AS project_poster, p.banner AS project_banner
        FROM episodes e JOIN projects p ON p.id = e.project_id
        WHERE e.id = ${path[1]} AND e.published = true AND p.published = true`;
      if (!rows.length) throw new AppError(404, 'Episodio no encontrado.');
      const row = rows[0];
      return json(mapEpisode(row, { project: { id: row.project_id, title: row.project_title, poster: row.project_poster || '', banner: row.project_banner || '' } }));
    }
    if (path[0] === 'admin' && path[1] === 'session') return json({ authenticated: isAdminRequest(request) });
    if (path[0] === 'admin') requireAdmin(request);
    if (path[0] === 'admin' && path[1] === 'config') {
      return json({ database: Boolean(process.env.DATABASE_URL), adminKey: Boolean(process.env.ADMIN_ACCESS_KEY), authSecret: Boolean(process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 32), blob: Boolean(process.env.BLOB_READ_WRITE_TOKEN) });
    }
    if (path[0] === 'admin' && path[1] === 'overview') {
      const [counts, providers] = await sql.transaction([
        sql`SELECT (SELECT COUNT(*) FROM projects) AS projects,
                   (SELECT COUNT(*) FROM episodes) AS episodes,
                   (SELECT COUNT(*) FROM studios) AS studios,
                   (SELECT COUNT(*) FROM episodes WHERE published = true) AS published_episodes,
                   (SELECT COUNT(*) FROM episodes WHERE status IN ('UPLOADING','PROCESSING')) AS processing`,
        sql`SELECT provider, COUNT(*)::int AS count FROM episodes GROUP BY provider ORDER BY count DESC`
      ], { readOnly: true });
      const count = counts[0];
      return json({ projects: Number(count.projects), episodes: Number(count.episodes), studios: Number(count.studios), publishedEpisodes: Number(count.published_episodes), processing: Number(count.processing), providers: providers.map(row => ({ provider: row.provider, count: Number(row.count) })) });
    }
    if (path[0] === 'admin' && path[1] === 'projects') return json(await adminProjects(sql));
    if (path[0] === 'admin' && path[1] === 'studios') return json(await adminStudios(sql));
    if (path[0] === 'admin' && path[1] === 'episodes') return json(await adminEpisodes(sql));
    if (path[0] === 'admin' && path[1] === 'archive' && path[2] === 'status' && path[3]) {
      const episodes = await sql`SELECT * FROM episodes WHERE id = ${path[3]}`;
      if (!episodes.length) throw new AppError(404, 'Episodio no encontrado.');
      const episode = episodes[0];
      if (!episode.archive_identifier) throw new AppError(400, 'El episodio no tiene identificador de Archive.org.');
      const archive = await inspectArchive(episode.archive_identifier);
      const status = archive.ready ? 'READY' : 'PROCESSING';
      const selectedFile = episode.archive_file || archive.selected?.name || null;
      const videoUrl = archiveEmbedUrl(episode.archive_identifier, selectedFile || '');
      await sql`UPDATE episodes SET status = ${status}, archive_file = ${selectedFile}, video_url = ${videoUrl}, updated_at = now() WHERE id = ${episode.id}`;
      return json({ episode: episode.id, status, archive });
    }
    throw new AppError(404, 'Ruta no encontrada.');
  } catch (error) { return errorResponse(error); }
}

export async function POST(request, context) {
  try {
    const path = await getSegments(context);

    if (path[0] === 'setup') {
      const body = await bodyJson(request);
      if (!verifyAdminKey(body.key)) throw new AppError(401, 'ADMIN_ACCESS_KEY incorrecta.');
      const result = await seedDatabase(getSql(), { reset: booleanValue(body.reset) });
      return json({ ok: true, ...result });
    }
    if (path[0] === 'admin' && path[1] === 'login') {
      const body = await bodyJson(request);
      if (!verifyAdminKey(body.key)) throw new AppError(401, 'Clave incorrecta.');
      return loginResponse();
    }
    if (path[0] === 'admin' && path[1] === 'logout') return logoutResponse();

    requireAdmin(request);
    const sql = getSql();

    if (path[0] === 'admin' && path[1] === 'archive' && path[2] === 'inspect') {
      const body = await bodyJson(request);
      return json(await inspectArchive(body.identifier));
    }
    if (path[0] === 'admin' && path[1] === 'upload') {
      if (!process.env.BLOB_READ_WRITE_TOKEN) throw new AppError(503, 'Vercel Blob todavía no está conectado. Puedes pegar una URL manualmente.');
      const form = await request.formData();
      const file = form.get('file');
      const folder = slugify(String(form.get('folder') || 'dubverse'));
      if (!(file instanceof File)) throw new AppError(400, 'Selecciona una imagen.');
      if (!file.type.startsWith('image/')) throw new AppError(400, 'Solo se permiten imágenes.');
      if (file.size > 4_000_000) throw new AppError(413, 'La imagen supera 4 MB. Comprímela antes de subirla.');
      const blob = await put(`${folder}/${Date.now()}-${slugify(file.name)}`, file, { access: 'public', addRandomSuffix: true });
      return json({ ok: true, url: blob.url, pathname: blob.pathname }, 201);
    }
    if (path[0] === 'admin' && path[1] === 'projects' && path.length === 2) {
      const body = await bodyJson(request);
      const title = requiredText(body.title, 'El título');
      const id = slugify(body.id || title);
      const type = enumValue(body.type, PROJECT_TYPES, 'SERIES');
      const status = enumValue(body.status, PROJECT_STATUSES, 'ONGOING');
      const studioIds = studioIdsValue(body.studioIds) || [];
      const queries = [sql`INSERT INTO projects (
          id, type, title, alternate_title, synopsis, status, genres, poster, banner,
          published, featured, updated_at
        ) VALUES (
          ${id}, ${type}, ${title}, ${String(body.alternateTitle || '')}, ${String(body.synopsis || '')},
          ${status}, ${JSON.stringify(genresValue(body.genres))}::jsonb, ${String(body.poster || '') || null},
          ${String(body.banner || '') || null}, ${booleanValue(body.published)}, ${booleanValue(body.featured)}, now()
        )`];
      for (const studioId of studioIds) {
        queries.push(sql`INSERT INTO project_studios (project_id, studio_id, role, notes)
          VALUES (${id}, ${studioId}, 'Fandoblaje', '')`);
      }
      await sql.transaction(queries);
      return json({ ok: true, id }, 201);
    }
    if (path[0] === 'admin' && path[1] === 'studios' && path.length === 2) {
      const body = await bodyJson(request);
      const name = requiredText(body.name, 'El nombre');
      const id = slugify(body.id || name);
      await sql`INSERT INTO studios (id, name, director, description, logo, socials, published, updated_at)
        VALUES (${id}, ${name}, ${String(body.director || '')}, ${String(body.description || '')},
          ${String(body.logo || '') || null}, ${JSON.stringify(body.socials || {})}::jsonb,
          ${body.published === undefined ? true : booleanValue(body.published)}, now())`;
      return json({ ok: true, id }, 201);
    }
    if (path[0] === 'admin' && path[1] === 'episodes' && path.length === 2) {
      const body = await bodyJson(request);
      const projectId = requiredText(body.projectId, 'El proyecto');
      const season = Math.max(1, Number(body.season || 1));
      const number = Math.max(1, Number(body.number || 1));
      if (!Number.isInteger(season) || !Number.isInteger(number)) throw new AppError(400, 'Temporada y episodio deben ser números enteros.');
      const id = slugify(body.id || `${projectId}-s${String(season).padStart(2, '0')}-e${String(number).padStart(3, '0')}`);
      const provider = enumValue(body.provider, EPISODE_PROVIDERS, 'ARCHIVE');
      const status = enumValue(body.status, EPISODE_STATUSES, 'DRAFT');
      const archiveIdentifier = String(body.archiveIdentifier || '').trim() || null;
      const archiveFile = String(body.archiveFile || '').trim() || null;
      let videoUrl = String(body.videoUrl || '').trim();
      if (provider === 'ARCHIVE' && archiveIdentifier && !videoUrl) videoUrl = archiveEmbedUrl(archiveIdentifier, archiveFile || '');
      await sql`INSERT INTO episodes (
          id, project_id, season, number, title, description, provider, video_url,
          archive_identifier, archive_file, status, published, updated_at
        ) VALUES (
          ${id}, ${projectId}, ${season}, ${number}, ${requiredText(body.title || `Episodio ${number}`, 'El título')},
          ${String(body.description || '')}, ${provider}, ${videoUrl}, ${archiveIdentifier}, ${archiveFile},
          ${status}, ${booleanValue(body.published)}, now())`;
      return json({ ok: true, id }, 201);
    }
    if (path[0] === 'admin' && path[1] === 'project-studios') {
      const body = await bodyJson(request);
      await sql`INSERT INTO project_studios (project_id, studio_id, role, notes)
        VALUES (${requiredText(body.projectId, 'projectId')}, ${requiredText(body.studioId, 'studioId')}, ${String(body.role || 'Fandoblaje')}, ${String(body.notes || '')})
        ON CONFLICT (project_id, studio_id) DO UPDATE SET role = EXCLUDED.role, notes = EXCLUDED.notes`;
      return json({ ok: true }, 201);
    }
    throw new AppError(404, 'Ruta no encontrada.');
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request, context) {
  try {
    const path = await getSegments(context);
    requireAdmin(request);
    const sql = getSql();
    const body = await bodyJson(request);
    if (path[0] !== 'admin' || !path[1] || !path[2]) throw new AppError(404, 'Ruta no encontrada.');
    const id = path[2];

    if (path[1] === 'projects') {
      const rows = await sql`SELECT * FROM projects WHERE id = ${id}`;
      if (!rows.length) throw new AppError(404, 'Proyecto no encontrado.');
      const old = rows[0];
      const title = body.title !== undefined ? requiredText(body.title, 'El título') : old.title;
      const type = body.type !== undefined ? enumValue(body.type, PROJECT_TYPES, old.type) : old.type;
      const status = body.status !== undefined ? enumValue(body.status, PROJECT_STATUSES, old.status) : old.status;
      await sql`UPDATE projects SET
          title = ${title},
          alternate_title = ${body.alternateTitle !== undefined ? String(body.alternateTitle) : old.alternate_title},
          synopsis = ${body.synopsis !== undefined ? String(body.synopsis) : old.synopsis},
          type = ${type}, status = ${status},
          genres = ${JSON.stringify(body.genres !== undefined ? genresValue(body.genres) : old.genres)}::jsonb,
          poster = ${body.poster !== undefined ? (String(body.poster).trim() || null) : old.poster},
          banner = ${body.banner !== undefined ? (String(body.banner).trim() || null) : old.banner},
          published = ${body.published !== undefined ? booleanValue(body.published) : old.published},
          featured = ${body.featured !== undefined ? booleanValue(body.featured) : old.featured},
          updated_at = now()
        WHERE id = ${id}`;
      await replaceProjectStudios(sql, id, studioIdsValue(body.studioIds));
      return json({ ok: true });
    }
    if (path[1] === 'studios') {
      const rows = await sql`SELECT * FROM studios WHERE id = ${id}`;
      if (!rows.length) throw new AppError(404, 'Estudio no encontrado.');
      const old = rows[0];
      await sql`UPDATE studios SET
          name = ${body.name !== undefined ? requiredText(body.name, 'El nombre') : old.name},
          director = ${body.director !== undefined ? String(body.director) : old.director},
          description = ${body.description !== undefined ? String(body.description) : old.description},
          logo = ${body.logo !== undefined ? (String(body.logo).trim() || null) : old.logo},
          socials = ${JSON.stringify(body.socials !== undefined ? body.socials : old.socials)}::jsonb,
          published = ${body.published !== undefined ? booleanValue(body.published) : old.published},
          updated_at = now()
        WHERE id = ${id}`;
      return json({ ok: true });
    }
    if (path[1] === 'episodes') {
      const rows = await sql`SELECT * FROM episodes WHERE id = ${id}`;
      if (!rows.length) throw new AppError(404, 'Episodio no encontrado.');
      const old = rows[0];
      const projectId = body.projectId !== undefined ? requiredText(body.projectId, 'El proyecto') : old.project_id;
      const season = body.season !== undefined ? Number(body.season) : Number(old.season);
      const number = body.number !== undefined ? Number(body.number) : Number(old.number);
      if (!Number.isInteger(season) || season < 1 || !Number.isInteger(number) || number < 1) throw new AppError(400, 'Temporada y episodio deben ser enteros positivos.');
      const provider = body.provider !== undefined ? enumValue(body.provider, EPISODE_PROVIDERS, old.provider) : old.provider;
      const status = body.status !== undefined ? enumValue(body.status, EPISODE_STATUSES, old.status) : old.status;
      const archiveIdentifier = body.archiveIdentifier !== undefined ? (String(body.archiveIdentifier).trim() || null) : old.archive_identifier;
      const archiveFile = body.archiveFile !== undefined ? (String(body.archiveFile).trim() || null) : old.archive_file;
      let videoUrl = body.videoUrl !== undefined ? String(body.videoUrl).trim() : old.video_url;
      if (provider === 'ARCHIVE' && archiveIdentifier && !videoUrl) videoUrl = archiveEmbedUrl(archiveIdentifier, archiveFile || '');
      await sql`UPDATE episodes SET
          project_id = ${projectId}, season = ${season}, number = ${number},
          title = ${body.title !== undefined ? requiredText(body.title, 'El título') : old.title},
          description = ${body.description !== undefined ? String(body.description) : old.description},
          provider = ${provider}, video_url = ${videoUrl}, archive_identifier = ${archiveIdentifier}, archive_file = ${archiveFile},
          status = ${status}, published = ${body.published !== undefined ? booleanValue(body.published) : old.published}, updated_at = now()
        WHERE id = ${id}`;
      return json({ ok: true });
    }
    throw new AppError(404, 'Ruta no encontrada.');
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request, context) {
  try {
    const path = await getSegments(context);
    requireAdmin(request);
    if (path[0] !== 'admin' || !['projects', 'studios', 'episodes'].includes(path[1]) || !path[2]) throw new AppError(404, 'Ruta no encontrada.');
    const sql = getSql();
    let rows;
    if (path[1] === 'projects') rows = await sql`DELETE FROM projects WHERE id = ${path[2]} RETURNING id`;
    if (path[1] === 'studios') rows = await sql`DELETE FROM studios WHERE id = ${path[2]} RETURNING id`;
    if (path[1] === 'episodes') rows = await sql`DELETE FROM episodes WHERE id = ${path[2]} RETURNING id`;
    if (!rows?.length) throw new AppError(404, 'Registro no encontrado.');
    return json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
