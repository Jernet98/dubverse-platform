import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { del, put } from '@vercel/blob';
import { AppError, booleanValue, getSql, slugify } from '@/lib/db';
import { isAdminRequest, loginResponse, logoutResponse, requireAdmin, verifyAdminKey } from '@/lib/auth';
import { mapEpisode, mapProject, mapStudio } from '@/lib/mappers';
import { inspectArchive, archiveEmbedUrl } from '@/lib/archive';
import { seedDatabase } from '@/lib/seed';
import { ensureSchema } from '@/lib/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PROJECT_TYPES = new Set(['SERIES', 'MOVIE', 'OVA', 'SPECIAL', 'MANGA_COMIC_DUB']);
const PROJECT_STATUSES = new Set(['ONGOING', 'FINISHED', 'PAUSED', 'CANCELLED']);
const EPISODE_PROVIDERS = new Set(['ARCHIVE', 'PIXELDRAIN', 'EXTERNAL', 'LOCAL']);
const EPISODE_STATUSES = new Set(['DRAFT', 'UPLOADING', 'PROCESSING', 'READY', 'PUBLISHED', 'ERROR', 'RETIRED']);
const TRASH_KINDS = new Set(['projects', 'studios', 'episodes']);
const LOGIN_MAX_FAILURES = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCK_MS = 15 * 60 * 1000;

let schemaPromise = null;

async function readySql() {
  const sql = getSql();
  if (!schemaPromise) {
    schemaPromise = ensureSchema(sql).catch(error => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
  return sql;
}

function json(payload, status = 200, headers = {}) {
  return NextResponse.json(payload, {
    status,
    headers: { 'Cache-Control': 'no-store', ...headers }
  });
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
  try {
    return await request.json();
  } catch {
    throw new AppError(400, 'El cuerpo de la solicitud no contiene JSON válido.');
  }
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

function optionalText(value, label, maxLength = 20000) {
  const text = String(value || '').trim();
  if (text.length > maxLength) throw new AppError(400, `${label} supera el máximo de ${maxLength} caracteres.`);
  return text;
}

function socialsValue(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new AppError(400, 'Las redes sociales deben ser un objeto válido.');
  const socials = {};
  for (const [rawKey, rawUrl] of Object.entries(value)) {
    const key = String(rawKey || '').trim().toLowerCase();
    const url = String(rawUrl || '').trim();
    if (!key || !url) continue;
    if (!/^[a-z0-9_-]{1,40}$/.test(key)) throw new AppError(400, `Nombre de red no permitido: ${key}.`);
    let parsed;
    try { parsed = new URL(url); } catch { throw new AppError(400, `URL no válida para ${key}.`); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new AppError(400, `La URL de ${key} debe usar http o https.`);
    socials[key] = parsed.toString();
  }
  return socials;
}

function assertWriteOrigin(request) {
  if (request.headers.get('x-admin-key')) return;
  const origin = request.headers.get('origin');
  if (!origin) return;
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  if (!host) return;
  let originHost = '';
  try { originHost = new URL(origin).host; } catch { throw new AppError(403, 'Origen de solicitud no permitido.'); }
  if (originHost !== host) throw new AppError(403, 'Origen de solicitud no permitido.');
}

function loginFingerprint(request) {
  const forwarded = request.headers.get('x-forwarded-for') || '';
  const ip = forwarded.split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown';
  const secret = process.env.AUTH_SECRET || 'dubverse-login-rate-limit';
  return crypto.createHmac('sha256', secret).update(ip).digest('hex');
}

async function enforceLoginLimit(sql, keyHash) {
  const rows = await sql`SELECT failures, locked_until, updated_at FROM admin_login_attempts WHERE key_hash = ${keyHash}`;
  if (!rows.length) return;
  const row = rows[0];
  const lockedUntil = row.locked_until ? new Date(row.locked_until).getTime() : 0;
  if (lockedUntil > Date.now()) {
    const minutes = Math.max(1, Math.ceil((lockedUntil - Date.now()) / 60000));
    throw new AppError(429, `Demasiados intentos. Espera ${minutes} minuto${minutes === 1 ? '' : 's'} antes de volver a probar.`);
  }
  const updatedAt = row.updated_at ? new Date(row.updated_at).getTime() : 0;
  if (Date.now() - updatedAt > LOGIN_WINDOW_MS) {
    await sql`DELETE FROM admin_login_attempts WHERE key_hash = ${keyHash}`;
  }
}

async function recordLoginFailure(sql, keyHash) {
  const rows = await sql`SELECT failures, updated_at FROM admin_login_attempts WHERE key_hash = ${keyHash}`;
  const now = Date.now();
  const previous = rows[0];
  const withinWindow = previous?.updated_at && now - new Date(previous.updated_at).getTime() <= LOGIN_WINDOW_MS;
  const failures = withinWindow ? Number(previous.failures || 0) + 1 : 1;
  const lockedUntil = failures >= LOGIN_MAX_FAILURES ? new Date(now + LOGIN_LOCK_MS) : null;
  await sql`
    INSERT INTO admin_login_attempts (key_hash, failures, locked_until, updated_at)
    VALUES (${keyHash}, ${failures}, ${lockedUntil}, now())
    ON CONFLICT (key_hash) DO UPDATE SET
      failures = EXCLUDED.failures,
      locked_until = EXCLUDED.locked_until,
      updated_at = now()
  `;
  return { failures, lockedUntil };
}

function isManagedBlobUrl(value) {
  if (!value || !process.env.BLOB_READ_WRITE_TOKEN) return false;
  try {
    const host = new URL(String(value)).hostname.toLowerCase();
    return host === 'blob.vercel-storage.com' || host.endsWith('.blob.vercel-storage.com');
  } catch {
    return false;
  }
}

async function blobReferenceCount(sql, url) {
  const rows = await sql`
    SELECT
      (SELECT COUNT(*) FROM projects WHERE poster = ${url} OR banner = ${url}) +
      (SELECT COUNT(*) FROM studios WHERE logo = ${url}) AS references
  `;
  return Number(rows[0]?.references || 0);
}

async function deleteBlobIfUnreferenced(sql, url) {
  if (!isManagedBlobUrl(url)) return false;
  if (await blobReferenceCount(sql, url)) return false;
  try {
    await del(url);
    return true;
  } catch (error) {
    console.warn('[Dubverse Blob] No se pudo eliminar', url, error?.message || error);
    return false;
  }
}

async function cleanupBlobUrls(sql, values) {
  let deleted = 0;
  for (const value of [...new Set((values || []).filter(Boolean))]) {
    if (await deleteBlobIfUnreferenced(sql, value)) deleted += 1;
  }
  return deleted;
}

async function publicProjects(sql) {
  const rows = await sql`
    SELECT p.*, COUNT(e.id) FILTER (WHERE e.published = true AND e.deleted_at IS NULL) AS episode_count
    FROM projects p
    LEFT JOIN episodes e ON e.project_id = p.id
    WHERE p.published = true AND p.deleted_at IS NULL
    GROUP BY p.id
    ORDER BY p.featured DESC, p.title ASC
  `;
  return rows.map(row => mapProject(row));
}

async function publicStudios(sql) {
  const [studios, relations] = await sql.transaction([
    sql`SELECT * FROM studios WHERE published = true AND deleted_at IS NULL ORDER BY name`,
    sql`SELECT ps.studio_id, p.id, p.title, p.poster, p.type
        FROM project_studios ps
        JOIN projects p ON p.id = ps.project_id
        JOIN studios s ON s.id = ps.studio_id
        WHERE p.published = true AND p.deleted_at IS NULL AND s.deleted_at IS NULL
        ORDER BY p.title`
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
    sql`SELECT p.*, COUNT(e.id) FILTER (WHERE e.deleted_at IS NULL) AS episode_count
        FROM projects p
        LEFT JOIN episodes e ON e.project_id = p.id
        WHERE p.deleted_at IS NULL
        GROUP BY p.id
        ORDER BY p.title`,
    sql`SELECT ps.project_id, ps.role, ps.notes, s.id, s.name, s.logo
        FROM project_studios ps
        JOIN studios s ON s.id = ps.studio_id
        WHERE s.deleted_at IS NULL
        ORDER BY s.name`
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
    sql`SELECT * FROM studios WHERE deleted_at IS NULL ORDER BY name`,
    sql`SELECT ps.studio_id, p.id, p.title, p.poster, p.type
        FROM project_studios ps
        JOIN projects p ON p.id = ps.project_id
        WHERE p.deleted_at IS NULL
        ORDER BY p.title`
  ], { readOnly: true });
  const byStudio = new Map();
  for (const relation of relations) {
    if (!byStudio.has(relation.studio_id)) byStudio.set(relation.studio_id, []);
    byStudio.get(relation.studio_id).push({ id: relation.id, title: relation.title, poster: relation.poster || '', type: relation.type });
  }
  return studios.map(row => mapStudio(row, { projects: byStudio.get(row.id) || [] }));
}

async function adminEpisodes(sql) {
  const rows = await sql`
    SELECT e.*, p.title AS project_title
    FROM episodes e
    JOIN projects p ON p.id = e.project_id
    WHERE e.deleted_at IS NULL AND p.deleted_at IS NULL
    ORDER BY p.title, e.season, e.number
  `;
  return rows.map(row => mapEpisode(row));
}

async function adminTrash(sql) {
  const [projects, studios, episodes] = await sql.transaction([
    sql`SELECT id, title AS name, poster AS image, deleted_at FROM projects WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`,
    sql`SELECT id, name, logo AS image, deleted_at FROM studios WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`,
    sql`SELECT e.id, e.title AS name, p.title AS parent_name, e.deleted_at
        FROM episodes e LEFT JOIN projects p ON p.id = e.project_id
        WHERE e.deleted_at IS NOT NULL ORDER BY e.deleted_at DESC`
  ], { readOnly: true });
  return {
    projects: projects.map(row => ({ ...row, kind: 'projects' })),
    studios: studios.map(row => ({ ...row, kind: 'studios' })),
    episodes: episodes.map(row => ({ ...row, kind: 'episodes' }))
  };
}

async function replaceProjectStudios(sql, projectId, studioIds) {
  if (studioIds === null) return;
  const currentRows = await sql`
    SELECT ps.studio_id, s.deleted_at
    FROM project_studios ps
    JOIN studios s ON s.id = ps.studio_id
    WHERE ps.project_id = ${projectId}
  `;
  const currentIds = new Set(currentRows.map(row => row.studio_id));
  const desiredIds = new Set(studioIds);
  const queries = [];

  for (const relation of currentRows) {
    if (!relation.deleted_at && !desiredIds.has(relation.studio_id)) {
      queries.push(sql`DELETE FROM project_studios WHERE project_id = ${projectId} AND studio_id = ${relation.studio_id}`);
    }
  }

  for (const studioId of studioIds) {
    if (!currentIds.has(studioId)) {
      queries.push(sql`INSERT INTO project_studios (project_id, studio_id, role, notes)
        SELECT ${projectId}, ${studioId}, 'Fandoblaje', ''
        WHERE EXISTS (SELECT 1 FROM studios WHERE id = ${studioId} AND deleted_at IS NULL)
        ON CONFLICT (project_id, studio_id) DO NOTHING`);
    }
  }
  if (queries.length) await sql.transaction(queries);
}

function trashTable(kind) {
  if (!TRASH_KINDS.has(kind)) throw new AppError(400, 'Tipo de papelera no permitido.');
  return kind;
}

export async function GET(request, context) {
  try {
    const path = await getSegments(context);

    if (path[0] === 'admin' && path[1] === 'session') {
      return json({ authenticated: isAdminRequest(request) });
    }

    const sql = await readySql();

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
      const projectRows = await sql`
        SELECT p.*, COUNT(e.id) FILTER (WHERE e.published = true AND e.deleted_at IS NULL) AS episode_count
        FROM projects p
        LEFT JOIN episodes e ON e.project_id = p.id
        WHERE p.id = ${path[1]} AND p.published = true AND p.deleted_at IS NULL
        GROUP BY p.id
      `;
      if (!projectRows.length) throw new AppError(404, 'Proyecto no encontrado.');
      const [episodes, studios] = await sql.transaction([
        sql`SELECT * FROM episodes WHERE project_id = ${path[1]} AND published = true AND deleted_at IS NULL ORDER BY season, number`,
        sql`SELECT s.*, ps.role, ps.notes
            FROM project_studios ps JOIN studios s ON s.id = ps.studio_id
            WHERE ps.project_id = ${path[1]} AND s.published = true AND s.deleted_at IS NULL
            ORDER BY s.name`
      ], { readOnly: true });
      return json(mapProject(projectRows[0], {
        episodes: episodes.map(row => mapEpisode(row)),
        studios: studios.map(row => ({ ...mapStudio(row), role: row.role, notes: row.notes }))
      }));
    }

    if (path[0] === 'studios' && path.length === 1) return json(await publicStudios(sql));

    if (path[0] === 'studios' && path[1]) {
      const studioRows = await sql`
        SELECT * FROM studios
        WHERE id = ${path[1]} AND published = true AND deleted_at IS NULL
      `;
      if (!studioRows.length) throw new AppError(404, 'Estudio no encontrado.');
      const projects = await sql`
        SELECT p.*, COUNT(e.id) FILTER (WHERE e.published = true AND e.deleted_at IS NULL) AS episode_count
        FROM project_studios ps
        JOIN projects p ON p.id = ps.project_id
        LEFT JOIN episodes e ON e.project_id = p.id
        WHERE ps.studio_id = ${path[1]}
          AND p.published = true
          AND p.deleted_at IS NULL
        GROUP BY p.id
        ORDER BY p.featured DESC, p.title
      `;
      return json(mapStudio(studioRows[0], { projects: projects.map(row => mapProject(row)) }));
    }

    if (path[0] === 'episodes' && path[1]) {
      const rows = await sql`
        SELECT e.*, p.title AS project_title, p.poster AS project_poster, p.banner AS project_banner
        FROM episodes e JOIN projects p ON p.id = e.project_id
        WHERE e.id = ${path[1]}
          AND e.published = true
          AND e.deleted_at IS NULL
          AND p.published = true
          AND p.deleted_at IS NULL
      `;
      if (!rows.length) throw new AppError(404, 'Episodio no encontrado.');
      const row = rows[0];
      return json(mapEpisode(row, {
        project: { id: row.project_id, title: row.project_title, poster: row.project_poster || '', banner: row.project_banner || '' }
      }));
    }

    if (path[0] === 'admin') requireAdmin(request);

    if (path[0] === 'admin' && path[1] === 'config') {
      return json({
        database: Boolean(process.env.DATABASE_URL),
        adminKey: Boolean(process.env.ADMIN_ACCESS_KEY),
        authSecret: Boolean(process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 32),
        blob: Boolean(process.env.BLOB_READ_WRITE_TOKEN)
      });
    }

    if (path[0] === 'admin' && path[1] === 'overview') {
      const [counts, providers] = await sql.transaction([
        sql`SELECT
          (SELECT COUNT(*) FROM projects WHERE deleted_at IS NULL) AS projects,
          (SELECT COUNT(*) FROM episodes e JOIN projects p ON p.id = e.project_id WHERE e.deleted_at IS NULL AND p.deleted_at IS NULL) AS episodes,
          (SELECT COUNT(*) FROM studios WHERE deleted_at IS NULL) AS studios,
          (SELECT COUNT(*) FROM episodes e JOIN projects p ON p.id = e.project_id WHERE e.published = true AND e.deleted_at IS NULL AND p.deleted_at IS NULL) AS published_episodes,
          (SELECT COUNT(*) FROM episodes e JOIN projects p ON p.id = e.project_id WHERE e.status IN ('UPLOADING','PROCESSING') AND e.deleted_at IS NULL AND p.deleted_at IS NULL) AS processing,
          ((SELECT COUNT(*) FROM projects WHERE deleted_at IS NOT NULL) +
           (SELECT COUNT(*) FROM studios WHERE deleted_at IS NOT NULL) +
           (SELECT COUNT(*) FROM episodes WHERE deleted_at IS NOT NULL)) AS trash`,
        sql`SELECT e.provider, COUNT(*)::int AS count FROM episodes e JOIN projects p ON p.id = e.project_id WHERE e.deleted_at IS NULL AND p.deleted_at IS NULL GROUP BY e.provider ORDER BY count DESC`
      ], { readOnly: true });
      const count = counts[0];
      return json({
        projects: Number(count.projects),
        episodes: Number(count.episodes),
        studios: Number(count.studios),
        publishedEpisodes: Number(count.published_episodes),
        processing: Number(count.processing),
        trash: Number(count.trash),
        providers: providers.map(row => ({ provider: row.provider, count: Number(row.count) }))
      });
    }

    if (path[0] === 'admin' && path[1] === 'projects') return json(await adminProjects(sql));
    if (path[0] === 'admin' && path[1] === 'studios') return json(await adminStudios(sql));
    if (path[0] === 'admin' && path[1] === 'episodes') return json(await adminEpisodes(sql));
    if (path[0] === 'admin' && path[1] === 'trash') return json(await adminTrash(sql));

    if (path[0] === 'admin' && path[1] === 'export') {
      const [settings, projects, studios, relations, episodes] = await sql.transaction([
        sql`SELECT * FROM settings ORDER BY key`,
        sql`SELECT * FROM projects ORDER BY title`,
        sql`SELECT * FROM studios ORDER BY name`,
        sql`SELECT * FROM project_studios ORDER BY project_id, studio_id`,
        sql`SELECT * FROM episodes ORDER BY project_id, season, number`
      ], { readOnly: true });
      const backup = { version: 1, generatedAt: new Date().toISOString(), settings, projects, studios, projectStudios: relations, episodes };
      const filename = `dubverse-respaldo-${new Date().toISOString().slice(0, 10)}.json`;
      return new NextResponse(JSON.stringify(backup, null, 2), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-store'
        }
      });
    }

    if (path[0] === 'admin' && path[1] === 'archive' && path[2] === 'status' && path[3]) {
      const episodes = await sql`SELECT * FROM episodes WHERE id = ${path[3]} AND deleted_at IS NULL`;
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
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request, context) {
  try {
    const path = await getSegments(context);

    if (path[0] === 'setup') {
      if (process.env.SETUP_ENABLED !== 'true') throw new AppError(404, 'Ruta no encontrada.');
      const body = await bodyJson(request);
      if (!verifyAdminKey(body.key)) throw new AppError(401, 'ADMIN_ACCESS_KEY incorrecta.');
      const result = await seedDatabase(await readySql(), { reset: false });
      return json({ ok: true, ...result });
    }

    if (path[0] === 'admin' && path[1] === 'login') {
      const sql = await readySql();
      const keyHash = loginFingerprint(request);
      await enforceLoginLimit(sql, keyHash);
      const body = await bodyJson(request);
      if (!verifyAdminKey(body.key)) {
        const attempt = await recordLoginFailure(sql, keyHash);
        const remaining = Math.max(0, LOGIN_MAX_FAILURES - attempt.failures);
        if (attempt.lockedUntil) throw new AppError(429, 'Demasiados intentos. El acceso quedó bloqueado durante 15 minutos.');
        throw new AppError(401, `Clave incorrecta. Quedan ${remaining} intento${remaining === 1 ? '' : 's'} antes del bloqueo temporal.`);
      }
      await sql`DELETE FROM admin_login_attempts WHERE key_hash = ${keyHash}`;
      return loginResponse();
    }

    if (path[0] === 'admin' && path[1] === 'logout') return logoutResponse();

    requireAdmin(request);
    assertWriteOrigin(request);
    const sql = await readySql();

    if (path[0] === 'admin' && path[1] === 'archive' && path[2] === 'inspect') {
      const body = await bodyJson(request);
      return json(await inspectArchive(requiredText(body.identifier, 'El identificador de Archive.org')));
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

    if (path[0] === 'admin' && path[1] === 'blob' && path[2] === 'cleanup') {
      const body = await bodyJson(request);
      const urls = Array.isArray(body.urls) ? body.urls.map(String).slice(0, 20) : [];
      return json({ ok: true, deleted: await cleanupBlobUrls(sql, urls) });
    }

    if (path[0] === 'admin' && path[1] === 'trash' && path[2] === 'restore') {
      const body = await bodyJson(request);
      const kind = trashTable(String(body.kind || ''));
      const id = requiredText(body.id, 'El identificador');
      let rows;
      if (kind === 'projects') rows = await sql`UPDATE projects SET deleted_at = NULL, updated_at = now() WHERE id = ${id} AND deleted_at IS NOT NULL RETURNING id`;
      if (kind === 'studios') rows = await sql`UPDATE studios SET deleted_at = NULL, updated_at = now() WHERE id = ${id} AND deleted_at IS NOT NULL RETURNING id`;
      if (kind === 'episodes') rows = await sql`UPDATE episodes SET deleted_at = NULL, updated_at = now() WHERE id = ${id} AND deleted_at IS NOT NULL RETURNING id`;
      if (!rows?.length) throw new AppError(404, 'Registro no encontrado en la papelera.');
      return json({ ok: true, id });
    }

    if (path[0] === 'admin' && path[1] === 'projects' && path.length === 2) {
      const body = await bodyJson(request);
      const title = requiredText(body.title, 'El título');
      const id = slugify(body.id || title);
      const type = enumValue(body.type, PROJECT_TYPES, 'SERIES');
      const status = enumValue(body.status, PROJECT_STATUSES, 'ONGOING');
      const studioIds = studioIdsValue(body.studioIds) || [];
      const queries = [sql`INSERT INTO projects (
          id, type, title, alternate_title, synopsis, project_director, dubbing_info, credits,
          status, genres, poster, banner,
          published, featured, deleted_at, updated_at
        ) VALUES (
          ${id}, ${type}, ${title}, ${String(body.alternateTitle || '')}, ${String(body.synopsis || '')},
          ${optionalText(body.projectDirector, 'La dirección del proyecto', 240)},
          ${optionalText(body.dubbingInfo, 'La información del fandoblaje')},
          ${optionalText(body.credits, 'Los créditos')},
          ${status}, ${JSON.stringify(genresValue(body.genres))}::jsonb, ${String(body.poster || '') || null},
          ${String(body.banner || '') || null}, ${booleanValue(body.published)}, ${booleanValue(body.featured)}, NULL, now()
        )`];
      for (const studioId of studioIds) {
        queries.push(sql`INSERT INTO project_studios (project_id, studio_id, role, notes)
          SELECT ${id}, ${studioId}, 'Fandoblaje', ''
          WHERE EXISTS (SELECT 1 FROM studios WHERE id = ${studioId} AND deleted_at IS NULL)`);
      }
      await sql.transaction(queries);
      return json({ ok: true, id }, 201);
    }

    if (path[0] === 'admin' && path[1] === 'studios' && path.length === 2) {
      const body = await bodyJson(request);
      const name = requiredText(body.name, 'El nombre');
      const id = slugify(body.id || name);
      await sql`INSERT INTO studios (id, name, director, description, logo, socials, published, deleted_at, updated_at)
        VALUES (${id}, ${name}, ${String(body.director || '')}, ${String(body.description || '')},
          ${String(body.logo || '') || null}, ${JSON.stringify(socialsValue(body.socials))}::jsonb,
          ${body.published === undefined ? true : booleanValue(body.published)}, NULL, now())`;
      return json({ ok: true, id }, 201);
    }

    if (path[0] === 'admin' && path[1] === 'episodes' && path.length === 2) {
      const body = await bodyJson(request);
      const projectId = requiredText(body.projectId, 'El proyecto');
      const projectRows = await sql`SELECT id FROM projects WHERE id = ${projectId} AND deleted_at IS NULL`;
      if (!projectRows.length) throw new AppError(400, 'El proyecto seleccionado no existe o está en la papelera.');
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
          archive_identifier, archive_file, status, published, deleted_at, updated_at
        ) VALUES (
          ${id}, ${projectId}, ${season}, ${number}, ${requiredText(body.title || `Episodio ${number}`, 'El título')},
          ${String(body.description || '')}, ${provider}, ${videoUrl}, ${archiveIdentifier}, ${archiveFile},
          ${status}, ${booleanValue(body.published)}, NULL, now())`;
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
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request, context) {
  try {
    const path = await getSegments(context);
    requireAdmin(request);
    assertWriteOrigin(request);
    const sql = await readySql();
    const body = await bodyJson(request);
    if (path[0] !== 'admin' || !path[1] || !path[2]) throw new AppError(404, 'Ruta no encontrada.');
    const id = path[2];

    if (path[1] === 'projects') {
      const rows = await sql`SELECT * FROM projects WHERE id = ${id} AND deleted_at IS NULL`;
      if (!rows.length) throw new AppError(404, 'Proyecto no encontrado.');
      const old = rows[0];
      const title = body.title !== undefined ? requiredText(body.title, 'El título') : old.title;
      const type = body.type !== undefined ? enumValue(body.type, PROJECT_TYPES, old.type) : old.type;
      const status = body.status !== undefined ? enumValue(body.status, PROJECT_STATUSES, old.status) : old.status;
      const poster = body.poster !== undefined ? (String(body.poster).trim() || null) : old.poster;
      const banner = body.banner !== undefined ? (String(body.banner).trim() || null) : old.banner;
      await sql`UPDATE projects SET
          title = ${title},
          alternate_title = ${body.alternateTitle !== undefined ? String(body.alternateTitle) : old.alternate_title},
          synopsis = ${body.synopsis !== undefined ? String(body.synopsis) : old.synopsis},
          project_director = ${body.projectDirector !== undefined ? optionalText(body.projectDirector, 'La dirección del proyecto', 240) : old.project_director},
          dubbing_info = ${body.dubbingInfo !== undefined ? optionalText(body.dubbingInfo, 'La información del fandoblaje') : old.dubbing_info},
          credits = ${body.credits !== undefined ? optionalText(body.credits, 'Los créditos') : old.credits},
          type = ${type}, status = ${status},
          genres = ${JSON.stringify(body.genres !== undefined ? genresValue(body.genres) : old.genres)}::jsonb,
          poster = ${poster}, banner = ${banner},
          published = ${body.published !== undefined ? booleanValue(body.published) : old.published},
          featured = ${body.featured !== undefined ? booleanValue(body.featured) : old.featured},
          updated_at = now()
        WHERE id = ${id}`;
      await replaceProjectStudios(sql, id, studioIdsValue(body.studioIds));
      await cleanupBlobUrls(sql, [old.poster !== poster ? old.poster : null, old.banner !== banner ? old.banner : null]);
      return json({ ok: true });
    }

    if (path[1] === 'studios') {
      const rows = await sql`SELECT * FROM studios WHERE id = ${id} AND deleted_at IS NULL`;
      if (!rows.length) throw new AppError(404, 'Estudio no encontrado.');
      const old = rows[0];
      const logo = body.logo !== undefined ? (String(body.logo).trim() || null) : old.logo;
      await sql`UPDATE studios SET
          name = ${body.name !== undefined ? requiredText(body.name, 'El nombre') : old.name},
          director = ${body.director !== undefined ? String(body.director) : old.director},
          description = ${body.description !== undefined ? String(body.description) : old.description},
          logo = ${logo},
          socials = ${JSON.stringify(body.socials !== undefined ? socialsValue(body.socials) : old.socials)}::jsonb,
          published = ${body.published !== undefined ? booleanValue(body.published) : old.published},
          updated_at = now()
        WHERE id = ${id}`;
      await cleanupBlobUrls(sql, [old.logo !== logo ? old.logo : null]);
      return json({ ok: true });
    }

    if (path[1] === 'episodes') {
      const rows = await sql`SELECT * FROM episodes WHERE id = ${id} AND deleted_at IS NULL`;
      if (!rows.length) throw new AppError(404, 'Episodio no encontrado.');
      const old = rows[0];
      const projectId = body.projectId !== undefined ? requiredText(body.projectId, 'El proyecto') : old.project_id;
      const projectRows = await sql`SELECT id FROM projects WHERE id = ${projectId} AND deleted_at IS NULL`;
      if (!projectRows.length) throw new AppError(400, 'El proyecto seleccionado no existe o está en la papelera.');
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
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request, context) {
  try {
    const path = await getSegments(context);
    requireAdmin(request);
    assertWriteOrigin(request);
    const sql = await readySql();

    if (path[0] !== 'admin') throw new AppError(404, 'Ruta no encontrada.');

    if (TRASH_KINDS.has(path[1]) && path[2]) {
      let rows;
      if (path[1] === 'projects') rows = await sql`UPDATE projects SET deleted_at = now(), updated_at = now() WHERE id = ${path[2]} AND deleted_at IS NULL RETURNING id`;
      if (path[1] === 'studios') rows = await sql`UPDATE studios SET deleted_at = now(), updated_at = now() WHERE id = ${path[2]} AND deleted_at IS NULL RETURNING id`;
      if (path[1] === 'episodes') rows = await sql`UPDATE episodes SET deleted_at = now(), updated_at = now() WHERE id = ${path[2]} AND deleted_at IS NULL RETURNING id`;
      if (!rows?.length) throw new AppError(404, 'Registro no encontrado.');
      return json({ ok: true, trashed: true });
    }

    if (path[1] === 'trash' && path[2] && path[3]) {
      const kind = trashTable(path[2]);
      const id = path[3];
      let rows;
      let blobUrls = [];
      if (kind === 'projects') {
        const records = await sql`SELECT poster, banner FROM projects WHERE id = ${id} AND deleted_at IS NOT NULL`;
        if (!records.length) throw new AppError(404, 'Proyecto no encontrado en la papelera.');
        blobUrls = [records[0].poster, records[0].banner];
        rows = await sql`DELETE FROM projects WHERE id = ${id} AND deleted_at IS NOT NULL RETURNING id`;
      }
      if (kind === 'studios') {
        const records = await sql`SELECT logo FROM studios WHERE id = ${id} AND deleted_at IS NOT NULL`;
        if (!records.length) throw new AppError(404, 'Estudio no encontrado en la papelera.');
        blobUrls = [records[0].logo];
        rows = await sql`DELETE FROM studios WHERE id = ${id} AND deleted_at IS NOT NULL RETURNING id`;
      }
      if (kind === 'episodes') {
        rows = await sql`DELETE FROM episodes WHERE id = ${id} AND deleted_at IS NOT NULL RETURNING id`;
      }
      if (!rows?.length) throw new AppError(404, 'Registro no encontrado en la papelera.');
      await cleanupBlobUrls(sql, blobUrls);
      return json({ ok: true, permanentlyDeleted: true });
    }

    throw new AppError(404, 'Ruta no encontrada.');
  } catch (error) {
    return errorResponse(error);
  }
}
