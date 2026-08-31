import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { r2ImagesStatus, uploadR2Image } from '@/lib/r2-images';
import { AppError, booleanValue, getSql, slugify } from '@/lib/db';
import { isAdminRequest, loginResponse, logoutResponse, requireAdmin, verifyAdminKey } from '@/lib/auth';
import { mapEpisode, mapProject, mapStudio } from '@/lib/mappers';
import { archiveEmbedUrl, inspectArchive } from '@/lib/archive';
import { seedDatabase } from '@/lib/seed';
import { socialSession } from '@/lib/social';
import { isAliasSchemaMissing } from '@/lib/content-ids';
import { episodePlayback, isUpdate2SchemaMissing, mapPromo, mapPromoResolved } from '@/lib/update2';
import { notifyGlobalProject, notifyGlobalStudio, notifyRelatedEpisode } from '@/lib/content-notifications';
import { projectMetadataValue } from '@/lib/content-discovery';
import { cleanupBlobUrls } from '@/lib/blob-media';
import {
  bannerValue,
  DEFAULT_HOME_SECTIONS,
  DEFAULT_SITE_SETTINGS,
  diversifiedFallback,
  HOME_DEFAULT_KEYS,
  HOME_DEFAULT_TYPES,
  isHomeSchemaMissing,
  rankRecommendations,
  sectionValue,
  siteSettingsValue,
  stableDailyRotate
} from '@/lib/home-cms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PROJECT_TYPES = new Set(['SERIES', 'MOVIE', 'OVA', 'SPECIAL', 'MANGA_COMIC_DUB']);
const PROJECT_STATUSES = new Set(['ONGOING', 'UPCOMING', 'FINISHED', 'PAUSED', 'CANCELLED']);
const EPISODE_PROVIDERS = new Set(['ARCHIVE', 'DIRECT', 'HLS', 'PIXELDRAIN', 'EXTERNAL', 'LOCAL']);
const EPISODE_STATUSES = new Set(['DRAFT', 'UPLOADING', 'PROCESSING', 'READY', 'PUBLISHED', 'ERROR', 'RETIRED']);
const TRASH_KINDS = new Set(['projects', 'studios', 'episodes']);
const LOGIN_MAX_FAILURES = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCK_MS = 15 * 60 * 1000;

async function readySql() {
  return getSql();
}

async function projectAliasTarget(sql, requestedId) {
  try {
    const aliases = await sql`SELECT project_id FROM project_slug_aliases WHERE alias = ${requestedId}`;
    return aliases[0]?.project_id || null;
  } catch (error) {
    if (isAliasSchemaMissing(error)) return null;
    throw error;
  }
}

async function studioAliasTarget(sql, requestedId) {
  try {
    const aliases = await sql`SELECT studio_id FROM studio_slug_aliases WHERE alias = ${requestedId}`;
    return aliases[0]?.studio_id || null;
  } catch (error) {
    if (isAliasSchemaMissing(error)) return null;
    throw error;
  }
}

async function episodeAliasTarget(sql, requestedId) {
  try {
    const aliases = await sql`SELECT episode_id FROM episode_slug_aliases WHERE alias = ${requestedId}`;
    return aliases[0]?.episode_id || null;
  } catch (error) {
    if (isAliasSchemaMissing(error)) return null;
    throw error;
  }
}

function aliasRedirect(request, collection, requestedId, canonicalId) {
  if (!canonicalId || requestedId === canonicalId) return null;
  const target = new URL(`/api/${collection}/${encodeURIComponent(canonicalId)}`, request.url);
  const response = NextResponse.redirect(target, 308);
  response.headers.set('Cache-Control', 'public, max-age=3600');
  return response;
}

function json(payload, status = 200, headers = {}) {
  return NextResponse.json(payload, {
    status,
    headers: { 'Cache-Control': 'no-store', ...headers }
  });
}

function errorResponse(error) {
  console.error('[Dubverse API]', error);
  if (error instanceof AppError) return json({ ok: false, error: error.message, ...(error.field ? { field: error.field } : {}) }, error.status);
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

function enumValue(value, allowed, fallback, label = 'El valor', field = null) {
  const normalized = String(value || fallback).toUpperCase();
  if (!allowed.has(normalized)) throw new AppError(400, `${label} contiene una opción no permitida: ${normalized}.`, field);
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

function mapSiteSettings(row, legacy = {}) {
  return {
    siteName: row ? row.site_name : (legacy.siteName || DEFAULT_SITE_SETTINGS.siteName),
    footerSlogan: row ? row.footer_slogan : (legacy.tagline || DEFAULT_SITE_SETTINGS.footerSlogan),
    description: row ? row.description : DEFAULT_SITE_SETTINGS.description,
    publicEmail: row?.public_email || '',
    copyrightText: row?.copyright_text || '',
    socials: row?.socials && typeof row.socials === 'object' ? row.socials : Object.fromEntries(
      ['facebook', 'instagram', 'x', 'twitter', 'youtube', 'discord', 'tiktok', 'website', 'whatsapp']
        .filter(key => legacy[key]).map(key => [key, legacy[key]])
    )
  };
}

function legacySiteSettings(legacy = {}) {
  const legacySocials = Object.fromEntries(
    ['facebook', 'instagram', 'x', 'twitter', 'youtube', 'discord', 'tiktok', 'website', 'whatsapp']
      .filter(key => legacy[key]).map(key => [key, legacy[key]])
  );
  return {
    siteName: legacy.siteName || DEFAULT_SITE_SETTINGS.siteName,
    footerSlogan: legacy.tagline || DEFAULT_SITE_SETTINGS.footerSlogan,
    description: DEFAULT_SITE_SETTINGS.description,
    publicEmail: '',
    copyrightText: '',
    socials: legacySocials
  };
}

function mapHomeSection(row) {
  return {
    id: row.id || null,
    sectionKey: row.section_key || row.sectionKey,
    sectionType: row.section_type || row.sectionType,
    title: row.title || '',
    subtitle: row.subtitle || '',
    enabled: row.enabled !== false,
    position: Number(row.position || 0),
    maxItems: Number(row.max_items || row.maxItems || 6),
    configuration: row.configuration && typeof row.configuration === 'object' ? row.configuration : {},
    persisted: Boolean(row.id),
    isDefault: HOME_DEFAULT_KEYS.has(row.section_key || row.sectionKey)
  };
}

function mergeHomeSections(rows) {
  const persisted = new Map(rows.map(row => [row.section_key, mapHomeSection(row)]));
  const defaults = DEFAULT_HOME_SECTIONS.map(section => persisted.get(section.sectionKey) || mapHomeSection(section));
  const custom = rows.filter(row => !HOME_DEFAULT_KEYS.has(row.section_key)).map(mapHomeSection);
  return [...defaults, ...custom].sort((left, right) => left.position - right.position || left.sectionKey.localeCompare(right.sectionKey));
}

function mapEditorialBanner(row) {
  return {
    id: row.id,
    label: row.label || '',
    title: row.title,
    description: row.description || '',
    imageUrl: row.image_url || '',
    mobileImageUrl: row.mobile_image_url || '',
    linkUrl: row.link_url || '',
    buttonText: row.button_text || '',
    enabled: Boolean(row.enabled),
    position: Number(row.position || 0),
    startsAt: row.starts_at ? new Date(row.starts_at).toISOString() : null,
    endsAt: row.ends_at ? new Date(row.ends_at).toISOString() : null
  };
}

function existingSectionValue(row) {
  const mapped = mapHomeSection(row);
  return mapped;
}

function existingBannerValue(row) {
  return mapEditorialBanner(row);
}

async function ensurePublishedProject(sql, id) {
  const rows = await sql`SELECT id FROM projects WHERE id = ${id} AND published = true AND deleted_at IS NULL`;
  if (!rows.length) throw new AppError(400, 'El proyecto no existe, está oculto o está en la papelera.');
}

async function ensurePublishedStudio(sql, id) {
  const rows = await sql`SELECT id FROM studios WHERE id = ${id} AND published = true AND deleted_at IS NULL`;
  if (!rows.length) throw new AppError(400, 'El estudio no existe, está oculto o está en la papelera.');
}

function curatedIdsValue(value) {
  if (value === undefined) return null;
  if (!Array.isArray(value)) throw new AppError(400, 'Los proyectos curados deben ser una lista.');
  return [...new Set(value.map(item => requiredText(item, 'El proyecto curado')).slice(0, 12))];
}

function homeEnabledValue(value, fallback = true) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new AppError(400, 'El estado activo debe ser booleano.');
  return value;
}

function projectCatalogUrl(section) {
  if (section.sectionType === 'AUTO_STATUS') return `/catalogo?status=${encodeURIComponent(section.configuration.status)}`;
  if (section.sectionType === 'AUTO_TYPE') return `/catalogo?type=${encodeURIComponent(section.configuration.type)}`;
  return '/catalogo';
}

async function optionalHomeViewer(request) {
  try { return await socialSession(request); } catch { return null; }
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

function automaticSectionProjects(section, projects) {
  const eligible = projects.filter(project => project.published && !project.deletedAt);
  if (section.sectionType === 'AUTO_STATUS') return eligible.filter(project => project.status === section.configuration.status);
  if (section.sectionType === 'AUTO_TYPE') return eligible.filter(project => project.type === section.configuration.type);
  if (section.sectionType === 'RECENT') return [...eligible].sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')));
  return eligible;
}

function completeManual(manual, candidates, maxItems, autoFill, salt) {
  const chosen = [...manual];
  if (!autoFill || chosen.length >= maxItems) return chosen.slice(0, maxItems);
  const selected = new Set(chosen.map(item => item.id));
  const available = stableDailyRotate(candidates.filter(item => !selected.has(item.id)), salt);
  return [...chosen, ...available].slice(0, maxItems);
}

async function recommendationContext(sql, viewer, projects) {
  if (!viewer) return { items: diversifiedFallback(stableDailyRotate(projects, 'anonymous')), reference: null };
  const [references, watched] = await sql.transaction([
    sql`SELECT p.*, COUNT(e.id) FILTER (WHERE e.published = true AND e.deleted_at IS NULL) AS episode_count,
          MAX(source.activity_at) AS activity_at
        FROM (
          SELECT project_id, created_at AS activity_at FROM favorites WHERE user_profile_id = ${viewer.row.id}
          UNION ALL
          SELECT e.project_id, h.last_viewed_at AS activity_at FROM episode_history h
          JOIN episodes e ON e.id = h.episode_id WHERE h.user_profile_id = ${viewer.row.id}
        ) source JOIN projects p ON p.id = source.project_id
        LEFT JOIN episodes e ON e.project_id = p.id
        WHERE p.published = true AND p.deleted_at IS NULL
        GROUP BY p.id ORDER BY activity_at DESC LIMIT 8`,
    sql`SELECT e.project_id, COUNT(DISTINCT w.episode_id) FILTER (WHERE e.published = true AND e.deleted_at IS NULL)::int AS watched_count,
          COUNT(DISTINCT published.id)::int AS episode_count
        FROM episode_watched w JOIN episodes e ON e.id = w.episode_id
        JOIN projects p ON p.id = e.project_id
        LEFT JOIN episodes published ON published.project_id = p.id AND published.published = true AND published.deleted_at IS NULL
        WHERE w.user_profile_id = ${viewer.row.id}
        GROUP BY e.project_id`
  ], { readOnly: true });
  const completedIds = watched.filter(row => Number(row.episode_count) > 0 && Number(row.watched_count) >= Number(row.episode_count)).map(row => row.project_id);
  const recommendation = rankRecommendations(references.map(row => mapProject(row)), projects, { completedIds });
  if (recommendation.items.length) return recommendation;
  return { items: diversifiedFallback(stableDailyRotate(projects, viewer.row.id)), reference: null };
}

async function publicHome(request, sql) {
  const [projects, studios, legacyRows] = await Promise.all([
    publicProjects(sql),
    publicStudios(sql),
    sql`SELECT key, value FROM settings`
  ]);
  const legacy = Object.fromEntries(legacyRows.map(row => [row.key, row.value]));
  let site = mapSiteSettings(null, legacy);
  let sections = DEFAULT_HOME_SECTIONS.map(mapHomeSection);
  let manualProjects = [];
  let manualStudios = [];
  let heroProjects = [];
  let curatedRows = [];
  let banners = [];
  let cmsAvailable = true;
  try {
    const result = await sql.transaction([
      sql`SELECT * FROM site_settings WHERE id = 1`,
      sql`SELECT * FROM home_sections ORDER BY position, section_key`,
      sql`SELECT fp.*, p.*, COUNT(e.id) FILTER (WHERE e.published = true AND e.deleted_at IS NULL) AS episode_count
          FROM home_featured_projects fp JOIN projects p ON p.id = fp.project_id
          LEFT JOIN episodes e ON e.project_id = p.id
          WHERE fp.enabled = true AND p.published = true AND p.deleted_at IS NULL
          GROUP BY fp.project_id, fp.enabled, fp.position, fp.created_at, fp.updated_at, p.id ORDER BY fp.position, p.title`,
      sql`SELECT fs.*, s.*, COUNT(DISTINCT ps.project_id) FILTER (WHERE p.published = true AND p.deleted_at IS NULL) AS project_count
          FROM home_featured_studios fs JOIN studios s ON s.id = fs.studio_id
          LEFT JOIN project_studios ps ON ps.studio_id = s.id LEFT JOIN projects p ON p.id = ps.project_id
          WHERE fs.enabled = true AND s.published = true AND s.deleted_at IS NULL
          GROUP BY fs.studio_id, fs.enabled, fs.position, fs.created_at, fs.updated_at, s.id ORDER BY fs.position, s.name`,
      sql`SELECT hp.*, p.*, COUNT(e.id) FILTER (WHERE e.published = true AND e.deleted_at IS NULL) AS episode_count
          FROM home_hero_projects hp JOIN projects p ON p.id = hp.project_id
          LEFT JOIN episodes e ON e.project_id = p.id
          WHERE hp.enabled = true AND p.published = true AND p.deleted_at IS NULL
          GROUP BY hp.project_id, hp.enabled, hp.position, hp.weight, hp.created_at, hp.updated_at, p.id ORDER BY hp.position, p.title`,
      sql`SELECT cp.section_id, cp.position, p.*, COUNT(e.id) FILTER (WHERE e.published = true AND e.deleted_at IS NULL) AS episode_count
          FROM home_curated_projects cp JOIN projects p ON p.id = cp.project_id
          LEFT JOIN episodes e ON e.project_id = p.id
          WHERE cp.enabled = true AND p.published = true AND p.deleted_at IS NULL
          GROUP BY cp.section_id, cp.project_id, cp.position, cp.created_at, p.id ORDER BY cp.section_id, cp.position, p.title`,
      sql`SELECT * FROM editorial_banners WHERE enabled = true
          AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at > now())
          ORDER BY position, created_at`
    ], { readOnly: true });
    if (result[0].length) site = mapSiteSettings(result[0][0], legacy);
    sections = mergeHomeSections(result[1]).filter(section => section.enabled);
    manualProjects = result[2].map(row => mapProject(row));
    manualStudios = result[3].map(row => mapStudio(row, { projects: Array(Number(row.project_count || 0)).fill(null) }));
    heroProjects = result[4].map(row => ({ ...mapProject(row), heroWeight: Number(row.weight || 1) }));
    curatedRows = result[5].map(row => ({ sectionId: row.section_id, project: mapProject(row) }));
    banners = result[6].map(mapEditorialBanner);
  } catch (error) {
    if (!isHomeSchemaMissing(error)) throw error;
    cmsAvailable = false;
  }
  const viewer = await optionalHomeViewer(request);
  const recommendations = await recommendationContext(sql, viewer, projects)
    .catch(() => ({ items: diversifiedFallback(projects), reference: null }));
  const studioFallback = stableDailyRotate(studios, 'studios');
  const heroFallback = projects.filter(project => project.featured);
  const hero = heroProjects.length ? heroProjects : (heroFallback.length ? heroFallback : projects);
  const resolvedSections = sections.sort((left, right) => left.position - right.position).map(section => {
    const result = { ...section, items: [], href: projectCatalogUrl(section) };
    if (section.sectionType === 'HERO') result.items = hero;
    else if (section.sectionType === 'FEATURED_PROJECTS') result.items = completeManual(manualProjects, projects, section.maxItems, section.configuration.autoFill !== false, 'featured-projects');
    else if (section.sectionType === 'FEATURED_STUDIOS') result.items = completeManual(manualStudios, studioFallback, section.maxItems, section.configuration.autoFill !== false, 'featured-studios');
    else if (section.sectionType === 'CURATED') result.items = curatedRows.filter(row => row.sectionId === section.id).map(row => row.project).slice(0, section.maxItems);
    else if (section.sectionType === 'RECOMMENDED') {
      result.items = recommendations.items.slice(0, section.maxItems);
      if (recommendations.reference) {
        result.title = `Porque viste ${recommendations.reference.title}`;
        result.subtitle = `Si te gustó ${recommendations.reference.title}, quizá te interese.`;
      }
    } else result.items = automaticSectionProjects(section, projects).slice(0, section.maxItems);
    return result;
  }).filter(section => section.items.length || section.sectionType === 'HERO');
  const composed = [];
  for (const section of resolvedSections) {
    composed.push(section);
    banners.filter(banner => banner.position >= section.position && banner.position < section.position + 10)
      .forEach(banner => composed.push({ sectionType: 'BANNER', sectionKey: `banner-${banner.id}`, position: banner.position, banner }));
  }
  banners.filter(banner => !composed.some(item => item.banner?.id === banner.id))
    .forEach(banner => composed.push({ sectionType: 'BANNER', sectionKey: `banner-${banner.id}`, position: banner.position, banner }));
  composed.sort((left, right) => left.position - right.position);
  return { site, sections: composed, catalog: { projects, studios }, cmsAvailable, viewer: viewer ? { authenticated: true } : { authenticated: false } };
}

async function adminHome(sql) {
  let siteRows = [];
  let sections = [];
  let featuredProjects = [];
  let featuredStudios = [];
  let heroProjects = [];
  let curated = [];
  let banners = [];
  try {
    [siteRows, sections, featuredProjects, featuredStudios, heroProjects, curated, banners] = await sql.transaction([
      sql`SELECT * FROM site_settings WHERE id = 1`,
      sql`SELECT * FROM home_sections ORDER BY position, section_key`,
      sql`SELECT fp.*, p.title, p.poster, p.published, p.deleted_at FROM home_featured_projects fp JOIN projects p ON p.id = fp.project_id ORDER BY fp.position, p.title`,
      sql`SELECT fs.*, s.name, s.logo, s.published, s.deleted_at FROM home_featured_studios fs JOIN studios s ON s.id = fs.studio_id ORDER BY fs.position, s.name`,
      sql`SELECT hp.*, p.title, p.poster, p.banner, p.published, p.deleted_at FROM home_hero_projects hp JOIN projects p ON p.id = hp.project_id ORDER BY hp.position, p.title`,
      sql`SELECT cp.*, p.title, p.poster FROM home_curated_projects cp JOIN projects p ON p.id = cp.project_id ORDER BY cp.section_id, cp.position, p.title`,
      sql`SELECT * FROM editorial_banners ORDER BY position, created_at`
    ], { readOnly: true });
  } catch (error) {
    if (isHomeSchemaMissing(error)) throw new AppError(409, 'Aplica primero la migración Home CMS en la base de Preview.');
    throw error;
  }
  return {
    site: mapSiteSettings(siteRows[0]),
    sitePersisted: Boolean(siteRows.length),
    sections: mergeHomeSections(sections),
    featuredProjects: featuredProjects.map(row => ({ projectId: row.project_id, enabled: row.enabled, position: Number(row.position), project: { id: row.project_id, title: row.title, poster: row.poster || '', published: Boolean(row.published), deletedAt: row.deleted_at } })),
    featuredStudios: featuredStudios.map(row => ({ studioId: row.studio_id, enabled: row.enabled, position: Number(row.position), studio: { id: row.studio_id, name: row.name, logo: row.logo || '', published: Boolean(row.published), deletedAt: row.deleted_at } })),
    heroProjects: heroProjects.map(row => ({ projectId: row.project_id, enabled: row.enabled, position: Number(row.position), weight: Number(row.weight), project: { id: row.project_id, title: row.title, poster: row.poster || '', banner: row.banner || '', published: Boolean(row.published), deletedAt: row.deleted_at } })),
    curated: curated.map(row => ({ sectionId: row.section_id, projectId: row.project_id, enabled: row.enabled, position: Number(row.position), project: { id: row.project_id, title: row.title, poster: row.poster || '' } })),
    banners: banners.map(mapEditorialBanner)
  };
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

    if (path[0] === 'home' && path.length === 1) return json(await publicHome(request, sql));

    if (path[0] === 'projects' && path.length === 1) return json(await publicProjects(sql));

    if (path[0] === 'search' && path.length === 1) {
      const query = String(request.nextUrl.searchParams.get('q') || '').trim().slice(0, 120);
      if (query.length < 2) return json({ projects: [], studios: [] });
      const [projects, studios] = await sql.transaction([
        sql`WITH normalized AS (
          SELECT p.*,
            btrim(regexp_replace(translate(lower(p.title), 'áéíóúüñ''’', 'aeiouun  '), '\\s+', ' ', 'g')) AS title_search,
            btrim(regexp_replace(translate(lower(p.alternate_title), 'áéíóúüñ''’', 'aeiouun  '), '\\s+', ' ', 'g')) AS alternate_search,
            btrim(regexp_replace(translate(lower(${query}), 'áéíóúüñ''’', 'aeiouun  '), '\\s+', ' ', 'g')) AS query_search
          FROM projects p WHERE p.published=true AND p.deleted_at IS NULL
        ) SELECT p.*, (SELECT COUNT(*)::int FROM episodes e WHERE e.project_id=p.id AND e.published=true AND e.deleted_at IS NULL) AS episode_count,
          greatest(similarity(p.title_search,p.query_search),similarity(p.alternate_search,p.query_search)) AS score
        FROM normalized p
        WHERE p.title_search=p.query_search OR p.alternate_search=p.query_search
          OR position(p.query_search IN p.title_search)>0 OR position(p.query_search IN p.alternate_search)>0
          OR p.title_search % p.query_search OR p.alternate_search % p.query_search
        ORDER BY CASE WHEN p.title_search=p.query_search OR p.alternate_search=p.query_search THEN 0
          WHEN position(p.query_search IN p.title_search)>0 OR position(p.query_search IN p.alternate_search)>0 THEN 1 ELSE 2 END,
          score DESC,p.title LIMIT 12`,
        sql`SELECT * FROM studios WHERE published=true AND deleted_at IS NULL AND (lower(name) LIKE lower(${'%' + query + '%'}) OR lower(name) % lower(${query})) ORDER BY CASE WHEN lower(name)=lower(${query}) THEN 0 ELSE 1 END, similarity(lower(name),lower(${query})) DESC LIMIT 6`
      ], { readOnly: true });
      return json({ projects: projects.map(mapProject), studios: studios.map(mapStudio) });
    }

    if (path[0] === 'projects' && path[1]) {
      const projectRows = await sql`
        SELECT p.*, COUNT(e.id) FILTER (WHERE e.published = true AND e.deleted_at IS NULL) AS episode_count
        FROM projects p
        LEFT JOIN episodes e ON e.project_id = p.id
        WHERE p.id = ${path[1]} AND p.published = true AND p.deleted_at IS NULL
        GROUP BY p.id
      `;
      if (!projectRows.length) {
        const redirect = aliasRedirect(request, 'projects', path[1], await projectAliasTarget(sql, path[1]));
        if (redirect) return redirect;
        throw new AppError(404, 'Proyecto no encontrado.');
      }
      const [episodes, studios] = await sql.transaction([
        sql`SELECT * FROM episodes WHERE project_id = ${path[1]} AND published = true AND deleted_at IS NULL ORDER BY season, number`,
        sql`SELECT s.*, ps.role, ps.notes
            FROM project_studios ps JOIN studios s ON s.id = ps.studio_id
            WHERE ps.project_id = ${path[1]} AND s.published = true AND s.deleted_at IS NULL
            ORDER BY s.name`
      ], { readOnly: true });
      let promos = [];
      try {
        promos = await sql`SELECT * FROM project_promo_media WHERE project_id = ${path[1]} AND is_active = true ORDER BY position, created_at`;
      } catch (error) {
        if (!isUpdate2SchemaMissing(error)) throw error;
      }
      return json({ ...mapProject(projectRows[0], {
        episodes: episodes.map(row => mapEpisode(row)),
        studios: studios.map(row => ({ ...mapStudio(row), role: row.role, notes: row.notes }))
      }), promos: await Promise.all(promos.map(row => mapPromoResolved(row))) });
    }

    if (path[0] === 'studios' && path.length === 1) return json(await publicStudios(sql));

    if (path[0] === 'studios' && path[1]) {
      const studioRows = await sql`
        SELECT * FROM studios
        WHERE id = ${path[1]} AND published = true AND deleted_at IS NULL
      `;
      if (!studioRows.length) {
        const redirect = aliasRedirect(request, 'studios', path[1], await studioAliasTarget(sql, path[1]));
        if (redirect) return redirect;
        throw new AppError(404, 'Estudio no encontrado.');
      }
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
        SELECT e.*, p.title AS project_title, p.poster AS project_poster, p.banner AS project_banner,
          p.age_rating AS project_age_rating, p.content_warnings AS project_content_warnings
        FROM episodes e JOIN projects p ON p.id = e.project_id
        WHERE e.id = ${path[1]}
          AND e.published = true
          AND e.deleted_at IS NULL
          AND p.published = true
          AND p.deleted_at IS NULL
      `;
      if (!rows.length) {
        const redirect = aliasRedirect(request, 'episodes', path[1], await episodeAliasTarget(sql, path[1]));
        if (redirect) return redirect;
        throw new AppError(404, 'Episodio no encontrado.');
      }
      const row = rows[0];
      return json(mapEpisode(row, {
        project: { id: row.project_id, title: row.project_title, poster: row.project_poster || '', banner: row.project_banner || '', ageRating: row.project_age_rating || 'GENERAL', contentWarnings: row.project_content_warnings || [] },
        playback: episodePlayback(row)
      }));
    }

    if (path[0] === 'admin') requireAdmin(request);

    if (path[0] === 'admin' && path[1] === 'config') {
      return json({
        database: Boolean(process.env.DATABASE_URL),
        adminKey: Boolean(process.env.ADMIN_ACCESS_KEY),
        authSecret: Boolean(process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 32),
        blob: r2ImagesStatus()
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
    if (path[0] === 'admin' && path[1] === 'home' && path.length === 2) return json(await adminHome(sql));

    if (path[0] === 'admin' && path[1] === 'export') {
      const [settings, projects, studios, relations, episodes] = await sql.transaction([
        sql`SELECT * FROM settings ORDER BY key`,
        sql`SELECT * FROM projects ORDER BY title`,
        sql`SELECT * FROM studios ORDER BY name`,
        sql`SELECT * FROM project_studios ORDER BY project_id, studio_id`,
        sql`SELECT * FROM episodes ORDER BY project_id, season, number`
      ], { readOnly: true });
      let homeCms = null;
      try {
        const [siteSettings, homeSections, featuredProjects, featuredStudios, heroProjects, curatedProjects, editorialBanners] = await sql.transaction([
          sql`SELECT * FROM site_settings ORDER BY id`,
          sql`SELECT * FROM home_sections ORDER BY position, section_key`,
          sql`SELECT * FROM home_featured_projects ORDER BY position, project_id`,
          sql`SELECT * FROM home_featured_studios ORDER BY position, studio_id`,
          sql`SELECT * FROM home_hero_projects ORDER BY position, project_id`,
          sql`SELECT * FROM home_curated_projects ORDER BY section_id, position, project_id`,
          sql`SELECT * FROM editorial_banners ORDER BY position, created_at`
        ], { readOnly: true });
        homeCms = { siteSettings, homeSections, featuredProjects, featuredStudios, heroProjects, curatedProjects, editorialBanners };
      } catch (error) {
        if (!isHomeSchemaMissing(error)) throw error;
      }
      let contentAliases = null;
      try {
        const [projectAliases, studioAliases, episodeAliases] = await sql.transaction([
          sql`SELECT * FROM project_slug_aliases ORDER BY created_at, alias`,
          sql`SELECT * FROM studio_slug_aliases ORDER BY created_at, alias`,
          sql`SELECT * FROM episode_slug_aliases ORDER BY created_at, alias`
        ], { readOnly: true });
        contentAliases = { projects: projectAliases, studios: studioAliases, episodes: episodeAliases };
      } catch (error) {
        if (!isAliasSchemaMissing(error)) throw error;
      }
      let update2 = null;
      try {
        const [studioMemberships, studioFollows, watchProgress, projectPromoMedia] = await sql.transaction([
          sql`SELECT * FROM studio_memberships ORDER BY studio_id, created_at`,
          sql`SELECT * FROM studio_follows ORDER BY studio_id, created_at`,
          sql`SELECT * FROM watch_progress ORDER BY user_profile_id, updated_at`,
          sql`SELECT * FROM project_promo_media ORDER BY project_id, position, created_at`
        ], { readOnly: true });
        update2 = { studioMemberships, studioFollows, watchProgress, projectPromoMedia };
      } catch (error) {
        if (!isUpdate2SchemaMissing(error)) throw error;
      }
      const backup = { version: 3, generatedAt: new Date().toISOString(), settings, projects, studios, projectStudios: relations, episodes, contentAliases, homeCms, update2 };
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
      const archive = await inspectArchive(episode.archive_identifier, episode.archive_file || '');
      const status = archive.ready ? 'READY' : 'PROCESSING';
      const selectedFile = archive.resolvedOrig || null;
      const videoUrl = archive.embedUrl || episode.video_url || '';
      await sql`UPDATE episodes SET status = ${status}, archive_file = ${selectedFile}, video_url = ${videoUrl},
        archive_playback_mode = 'ARCHIVE_EMBED', archive_native_status = 'UNVERIFIED', archive_native_url = NULL,
        archive_native_verified_at = NULL, archive_native_verification = NULL, updated_at = now() WHERE id = ${episode.id}`;
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
  if (!r2ImagesStatus()) {
    throw new AppError(503, 'Cloudflare R2 Images todavía no está configurado.');
  }

  const form = await request.formData();
  const file = form.get('file');
  const folder = slugify(String(form.get('folder') || 'dubverse'));

  if (!(file instanceof File)) {
    throw new AppError(400, 'Selecciona una imagen.');
  }

  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new AppError(400, 'Sólo se permiten imágenes JPEG, PNG o WebP.');
  }

  if (file.size > 4_000_000) {
    throw new AppError(413, 'La imagen supera 4 MB. Comprímela antes de subirla.');
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  const extension =
    file.type === 'image/jpeg'
      ? 'jpg'
      : file.type === 'image/png'
        ? 'png'
        : 'webp';

  const filename =
    slugify(file.name.replace(/\.[^.]+$/, '')) || 'imagen';

  const pathname =
    `${folder}/${Date.now()}-${filename}-${crypto.randomUUID()}.${extension}`;

  const image = await uploadR2Image(pathname, bytes, file.type);

  return json({
    ok: true,
    url: image.url,
    pathname: image.pathname
  }, 201);
}

    if (path[0] === 'admin' && path[1] === 'blob' && path[2] === 'cleanup') {
      const body = await bodyJson(request);
      const urls = Array.isArray(body.urls) ? body.urls.map(String).slice(0, 20) : [];
      return json({ ok: true, deleted: await cleanupBlobUrls(sql, urls) });
    }

    if (path[0] === 'admin' && path[1] === 'home' && path[2] === 'settings' && path.length === 3) {
      const raw = await bodyJson(request);
      const [currentRows, legacyRows] = await sql.transaction([
        sql`SELECT * FROM site_settings WHERE id = 1`,
        sql`SELECT key, value FROM settings`
      ], { readOnly: true });
      const legacy = Object.fromEntries(legacyRows.map(row => [row.key, row.value]));
      const existing = currentRows.length ? mapSiteSettings(currentRows[0]) : legacySiteSettings(legacy);
      const body = siteSettingsValue(raw, existing);
      await sql`INSERT INTO site_settings (
          id, site_name, footer_slogan, description, public_email, copyright_text, socials, updated_at
        ) VALUES (1, ${body.siteName}, ${body.footerSlogan}, ${body.description}, ${body.publicEmail},
          ${body.copyrightText}, ${JSON.stringify(body.socials)}::jsonb, now())
        ON CONFLICT (id) DO UPDATE SET site_name = EXCLUDED.site_name, footer_slogan = EXCLUDED.footer_slogan,
          description = EXCLUDED.description, public_email = EXCLUDED.public_email,
          copyright_text = EXCLUDED.copyright_text, socials = EXCLUDED.socials, updated_at = now()`;
      return json({ ok: true, site: body });
    }

    if (path[0] === 'admin' && path[1] === 'home' && path[2] === 'sections' && path.length === 3) {
      const raw = await bodyJson(request);
      const body = sectionValue(raw);
      if (HOME_DEFAULT_KEYS.has(body.sectionKey) && HOME_DEFAULT_TYPES[body.sectionKey] !== body.sectionType) {
        throw new AppError(400, 'La clave de una sección inicial no puede usarse con otro tipo.');
      }
      const curatedIds = curatedIdsValue(raw.projectIds);
      if (body.sectionType !== 'CURATED' && curatedIds?.length) throw new AppError(400, 'Sólo una sección curada admite proyectos manuales.');
      if (curatedIds) {
        for (const projectId of curatedIds) await ensurePublishedProject(sql, projectId);
      }
      const id = crypto.randomUUID();
      await sql`INSERT INTO home_sections (id, section_key, section_type, title, subtitle, enabled, position, max_items, configuration)
        VALUES (${id}::uuid, ${body.sectionKey}, ${body.sectionType}, ${body.title}, ${body.subtitle}, ${body.enabled},
          ${body.position}, ${body.maxItems}, ${JSON.stringify(body.configuration)}::jsonb)`;
      if (body.sectionType === 'CURATED' && curatedIds?.length) {
        const queries = curatedIds.map((projectId, index) => sql`INSERT INTO home_curated_projects (section_id, project_id, position)
          VALUES (${id}::uuid, ${projectId}, ${index})`);
        await sql.transaction(queries);
      }
      return json({ ok: true, id }, 201);
    }

    if (path[0] === 'admin' && path[1] === 'home' && path[2] === 'banners' && path.length === 3) {
      const body = bannerValue(await bodyJson(request));
      const id = crypto.randomUUID();
      await sql`INSERT INTO editorial_banners (
          id, label, title, description, image_url, mobile_image_url, link_url, button_text, enabled, position, starts_at, ends_at
        ) VALUES (${id}::uuid, ${body.label}, ${body.title}, ${body.description}, ${body.imageUrl}, ${body.mobileImageUrl}, ${body.linkUrl},
          ${body.buttonText}, ${body.enabled}, ${body.position}, ${body.startsAt}, ${body.endsAt})`;
      return json({ ok: true, id }, 201);
    }

    if (path[0] === 'admin' && path[1] === 'home' && ['featured-projects', 'featured-studios', 'hero-projects'].includes(path[2]) && path.length === 3) {
      const body = await bodyJson(request);
      const resourceId = requiredText(body.resourceId, 'El recurso');
      const position = Math.min(10000, Math.max(0, Number(body.position ?? 0)));
      if (!Number.isInteger(position)) throw new AppError(400, 'La posición debe ser un entero.');
      const enabled = homeEnabledValue(body.enabled);
      if (path[2] === 'featured-projects') {
        await ensurePublishedProject(sql, resourceId);
        await sql`INSERT INTO home_featured_projects (project_id, enabled, position, updated_at)
          VALUES (${resourceId}, ${enabled}, ${position}, now())
          ON CONFLICT (project_id) DO UPDATE SET enabled = EXCLUDED.enabled, position = EXCLUDED.position, updated_at = now()`;
      }
      if (path[2] === 'featured-studios') {
        await ensurePublishedStudio(sql, resourceId);
        await sql`INSERT INTO home_featured_studios (studio_id, enabled, position, updated_at)
          VALUES (${resourceId}, ${enabled}, ${position}, now())
          ON CONFLICT (studio_id) DO UPDATE SET enabled = EXCLUDED.enabled, position = EXCLUDED.position, updated_at = now()`;
      }
      if (path[2] === 'hero-projects') {
        await ensurePublishedProject(sql, resourceId);
        const weight = Math.min(10, Math.max(1, Number(body.weight || 1)));
        if (!Number.isInteger(weight)) throw new AppError(400, 'El peso debe ser un entero entre 1 y 10.');
        await sql`INSERT INTO home_hero_projects (project_id, enabled, position, weight, updated_at)
          VALUES (${resourceId}, ${enabled}, ${position}, ${weight}, now())
          ON CONFLICT (project_id) DO UPDATE SET enabled = EXCLUDED.enabled, position = EXCLUDED.position,
            weight = EXCLUDED.weight, updated_at = now()`;
      }
      return json({ ok: true });
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
      const type = enumValue(body.type, PROJECT_TYPES, 'SERIES', 'El campo “Tipo”', 'type');
      const status = enumValue(body.status, PROJECT_STATUSES, 'ONGOING', 'El campo “Estado”', 'status');
      const studioIds = studioIdsValue(body.studioIds) || [];
      const metadata = projectMetadataValue(body);
      const queries = [sql`INSERT INTO projects (
          id, type, title, alternate_title, synopsis, project_director, dubbing_info, credits,
          original_title, alternate_titles, search_aliases, age_rating, content_warnings, status, genres, poster, banner,
          published, featured, deleted_at, updated_at
        ) VALUES (
          ${id}, ${type}, ${title}, ${String(body.alternateTitle || '')}, ${String(body.synopsis || '')},
          ${optionalText(body.projectDirector, 'La dirección del proyecto', 240)},
          ${optionalText(body.dubbingInfo, 'La información del fandoblaje')},
          ${optionalText(body.credits, 'Los créditos')}, ${metadata.originalTitle}, ${JSON.stringify(metadata.alternateTitles)}::jsonb,
          ${JSON.stringify(metadata.searchAliases)}::jsonb, ${metadata.ageRating}, ${JSON.stringify(metadata.contentWarnings)}::jsonb,
          ${status}, ${JSON.stringify(genresValue(body.genres))}::jsonb, ${String(body.poster || '') || null},
          ${String(body.banner || '') || null}, ${booleanValue(body.published)}, ${booleanValue(body.featured)}, NULL, now()
        )`];
      for (const studioId of studioIds) {
        queries.push(sql`INSERT INTO project_studios (project_id, studio_id, role, notes)
          SELECT ${id}, ${studioId}, 'Fandoblaje', ''
          WHERE EXISTS (SELECT 1 FROM studios WHERE id = ${studioId} AND deleted_at IS NULL)`);
      }
      await sql.transaction(queries);
      if (booleanValue(body.published)) await notifyGlobalProject(sql, id);
      return json({ ok: true, id }, 201);
    }

    if (path[0] === 'admin' && path[1] === 'studios' && path.length === 2) {
      const body = await bodyJson(request);
      const name = requiredText(body.name, 'El nombre');
      const id = slugify(body.id || name);
      const verified = booleanValue(body.isVerified);
      const published = body.published === undefined ? true : booleanValue(body.published);
      await sql`INSERT INTO studios (id, name, director, description, logo, banner, socials, is_verified, verified_at, verified_by, published, deleted_at, updated_at)
        VALUES (${id}, ${name}, ${String(body.director || '')}, ${String(body.description || '')},
          ${String(body.logo || '') || null}, ${String(body.banner || '') || null}, ${JSON.stringify(socialsValue(body.socials))}::jsonb,
          ${verified}, ${verified ? new Date() : null}, ${verified ? 'global-admin' : null},
          ${published}, NULL, now())`;
      if (published) await notifyGlobalStudio(sql, id);
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
      if (booleanValue(body.published)) await notifyRelatedEpisode(sql, projectId, id);
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

    if (path[1] === 'home' && path[2] === 'sections' && path[3]) {
      const rows = await sql`SELECT * FROM home_sections WHERE id = ${path[3]}::uuid`;
      if (!rows.length) throw new AppError(404, 'Sección no encontrada.');
      const value = sectionValue(body, existingSectionValue(rows[0]));
      if (HOME_DEFAULT_KEYS.has(rows[0].section_key) && value.sectionKey !== rows[0].section_key) throw new AppError(400, 'No puedes cambiar la clave de una sección inicial.');
      if (!HOME_DEFAULT_KEYS.has(rows[0].section_key) && HOME_DEFAULT_KEYS.has(value.sectionKey)) throw new AppError(400, 'Una sección personalizada no puede ocupar una clave inicial.');
      if (HOME_DEFAULT_KEYS.has(rows[0].section_key) && value.sectionType !== HOME_DEFAULT_TYPES[rows[0].section_key]) throw new AppError(400, 'No puedes cambiar el tipo de una sección inicial.');
      const curatedIds = curatedIdsValue(body.projectIds);
      if (curatedIds) {
        for (const projectId of curatedIds) await ensurePublishedProject(sql, projectId);
      }
      await sql`UPDATE home_sections SET section_key = ${value.sectionKey}, section_type = ${value.sectionType},
        title = ${value.title}, subtitle = ${value.subtitle}, enabled = ${value.enabled}, position = ${value.position},
        max_items = ${value.maxItems}, configuration = ${JSON.stringify(value.configuration)}::jsonb, updated_at = now()
        WHERE id = ${path[3]}::uuid`;
      if (curatedIds !== null) {
        const queries = [sql`DELETE FROM home_curated_projects WHERE section_id = ${path[3]}::uuid`];
        curatedIds.forEach((projectId, index) => queries.push(sql`INSERT INTO home_curated_projects (section_id, project_id, position)
          VALUES (${path[3]}::uuid, ${projectId}, ${index})`));
        await sql.transaction(queries);
      }
      return json({ ok: true });
    }

    if (path[1] === 'home' && path[2] === 'banners' && path[3]) {
      const rows = await sql`SELECT * FROM editorial_banners WHERE id = ${path[3]}::uuid`;
      if (!rows.length) throw new AppError(404, 'Banner no encontrado.');
      const value = bannerValue(body, existingBannerValue(rows[0]));
      const oldImage = rows[0].image_url || '';
      const oldMobileImage = rows[0].mobile_image_url || '';
      await sql`UPDATE editorial_banners SET label = ${value.label}, title = ${value.title}, description = ${value.description},
        image_url = ${value.imageUrl}, mobile_image_url = ${value.mobileImageUrl}, link_url = ${value.linkUrl}, button_text = ${value.buttonText}, enabled = ${value.enabled},
        position = ${value.position}, starts_at = ${value.startsAt}, ends_at = ${value.endsAt}, updated_at = now()
        WHERE id = ${path[3]}::uuid`;
      await cleanupBlobUrls(sql, [oldImage !== value.imageUrl ? oldImage : null, oldMobileImage !== value.mobileImageUrl ? oldMobileImage : null]);
      return json({ ok: true });
    }

    if (path[1] === 'home' && ['featured-projects', 'featured-studios', 'hero-projects'].includes(path[2]) && path[3]) {
      const position = Math.min(10000, Math.max(0, Number(body.position ?? 0)));
      if (!Number.isInteger(position)) throw new AppError(400, 'La posición debe ser un entero.');
      const enabled = homeEnabledValue(body.enabled);
      if (path[2] === 'featured-projects') await sql`UPDATE home_featured_projects SET enabled = ${enabled}, position = ${position}, updated_at = now() WHERE project_id = ${path[3]}`;
      if (path[2] === 'featured-studios') await sql`UPDATE home_featured_studios SET enabled = ${enabled}, position = ${position}, updated_at = now() WHERE studio_id = ${path[3]}`;
      if (path[2] === 'hero-projects') {
        const weight = Math.min(10, Math.max(1, Number(body.weight || 1)));
        if (!Number.isInteger(weight)) throw new AppError(400, 'El peso debe ser un entero entre 1 y 10.');
        await sql`UPDATE home_hero_projects SET enabled = ${enabled}, position = ${position}, weight = ${weight}, updated_at = now() WHERE project_id = ${path[3]}`;
      }
      return json({ ok: true });
    }

    if (path[1] === 'projects') {
      const rows = await sql`SELECT * FROM projects WHERE id = ${id} AND deleted_at IS NULL`;
      if (!rows.length) throw new AppError(404, 'Proyecto no encontrado.');
      const old = rows[0];
      const title = body.title !== undefined ? requiredText(body.title, 'El título') : old.title;
      const type = body.type !== undefined ? enumValue(body.type, PROJECT_TYPES, old.type, 'El campo “Tipo”', 'type') : old.type;
      const status = body.status !== undefined ? enumValue(body.status, PROJECT_STATUSES, old.status, 'El campo “Estado”', 'status') : old.status;
      const poster = body.poster !== undefined ? (String(body.poster).trim() || null) : old.poster;
      const banner = body.banner !== undefined ? (String(body.banner).trim() || null) : old.banner;
      const published = body.published !== undefined ? booleanValue(body.published) : old.published;
      const metadata = projectMetadataValue(body, old);
      await sql`UPDATE projects SET
          title = ${title},
          alternate_title = ${body.alternateTitle !== undefined ? String(body.alternateTitle) : old.alternate_title},
          original_title = ${metadata.originalTitle}, alternate_titles = ${JSON.stringify(metadata.alternateTitles)}::jsonb,
          search_aliases = ${JSON.stringify(metadata.searchAliases)}::jsonb, age_rating = ${metadata.ageRating},
          content_warnings = ${JSON.stringify(metadata.contentWarnings)}::jsonb,
          synopsis = ${body.synopsis !== undefined ? String(body.synopsis) : old.synopsis},
          project_director = ${body.projectDirector !== undefined ? optionalText(body.projectDirector, 'La dirección del proyecto', 240) : old.project_director},
          dubbing_info = ${body.dubbingInfo !== undefined ? optionalText(body.dubbingInfo, 'La información del fandoblaje') : old.dubbing_info},
          credits = ${body.credits !== undefined ? optionalText(body.credits, 'Los créditos') : old.credits},
          type = ${type}, status = ${status},
          genres = ${JSON.stringify(body.genres !== undefined ? genresValue(body.genres) : old.genres)}::jsonb,
          poster = ${poster}, banner = ${banner},
          published = ${published},
          featured = ${body.featured !== undefined ? booleanValue(body.featured) : old.featured},
          updated_at = now()
        WHERE id = ${id}`;
      await replaceProjectStudios(sql, id, studioIdsValue(body.studioIds));
      await cleanupBlobUrls(sql, [old.poster !== poster ? old.poster : null, old.banner !== banner ? old.banner : null]);
      if (!old.published && published) await notifyGlobalProject(sql, id);
      return json({ ok: true });
    }

    if (path[1] === 'studios') {
      const rows = await sql`SELECT * FROM studios WHERE id = ${id} AND deleted_at IS NULL`;
      if (!rows.length) throw new AppError(404, 'Estudio no encontrado.');
      const old = rows[0];
      const logo = body.logo !== undefined ? (String(body.logo).trim() || null) : old.logo;
      const banner = body.banner !== undefined ? (String(body.banner).trim() || null) : old.banner;
      const verified = body.isVerified !== undefined ? booleanValue(body.isVerified) : old.is_verified;
      const published = body.published !== undefined ? booleanValue(body.published) : old.published;
      await sql`UPDATE studios SET
          name = ${body.name !== undefined ? requiredText(body.name, 'El nombre') : old.name},
          director = ${body.director !== undefined ? String(body.director) : old.director},
          description = ${body.description !== undefined ? String(body.description) : old.description},
          logo = ${logo},
          banner = ${banner},
          socials = ${JSON.stringify(body.socials !== undefined ? socialsValue(body.socials) : old.socials)}::jsonb,
          is_verified = ${verified},
          verified_at = ${verified ? (old.verified_at || new Date()) : null},
          verified_by = ${verified ? 'global-admin' : null},
          published = ${published},
          updated_at = now()
        WHERE id = ${id}`;
      await cleanupBlobUrls(sql, [old.logo !== logo ? old.logo : null, old.banner !== banner ? old.banner : null]);
      if (!old.published && published) await notifyGlobalStudio(sql, id);
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
      const published = body.published !== undefined ? booleanValue(body.published) : old.published;
      const archiveReferenceChanged = provider !== old.provider || archiveIdentifier !== old.archive_identifier
        || archiveFile !== old.archive_file || videoUrl !== old.video_url;
      await sql`UPDATE episodes SET
          project_id = ${projectId}, season = ${season}, number = ${number},
          title = ${body.title !== undefined ? requiredText(body.title, 'El título') : old.title},
          description = ${body.description !== undefined ? String(body.description) : old.description},
          provider = ${provider}, video_url = ${videoUrl}, archive_identifier = ${archiveIdentifier}, archive_file = ${archiveFile},
          archive_playback_mode = ${archiveReferenceChanged ? 'ARCHIVE_EMBED' : old.archive_playback_mode},
          archive_native_status = ${archiveReferenceChanged ? 'UNVERIFIED' : old.archive_native_status},
          archive_native_url = ${archiveReferenceChanged ? null : old.archive_native_url},
          archive_native_verified_at = ${archiveReferenceChanged ? null : old.archive_native_verified_at},
          archive_native_verification = ${archiveReferenceChanged ? null : old.archive_native_verification},
          status = ${status}, published = ${published}, updated_at = now()
        WHERE id = ${id}`;
      if (!old.published && published) await notifyRelatedEpisode(sql, projectId, id);
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

    if (path[1] === 'home' && ['featured-projects', 'featured-studios', 'hero-projects'].includes(path[2]) && path[3]) {
      if (path[2] === 'featured-projects') await sql`DELETE FROM home_featured_projects WHERE project_id = ${path[3]}`;
      if (path[2] === 'featured-studios') await sql`DELETE FROM home_featured_studios WHERE studio_id = ${path[3]}`;
      if (path[2] === 'hero-projects') await sql`DELETE FROM home_hero_projects WHERE project_id = ${path[3]}`;
      return json({ ok: true, removed: true });
    }

    if (path[1] === 'home' && path[2] === 'sections' && path[3]) {
      const rows = await sql`SELECT section_key FROM home_sections WHERE id = ${path[3]}::uuid`;
      if (!rows.length) throw new AppError(404, 'Sección no encontrada.');
      if (HOME_DEFAULT_KEYS.has(rows[0].section_key)) throw new AppError(400, 'Las secciones iniciales se desactivan; no se eliminan.');
      await sql`DELETE FROM home_sections WHERE id = ${path[3]}::uuid`;
      return json({ ok: true, removed: true });
    }

    if (path[1] === 'home' && path[2] === 'banners' && path[3]) {
      const rows = await sql`DELETE FROM editorial_banners WHERE id = ${path[3]}::uuid RETURNING image_url`;
      if (!rows.length) throw new AppError(404, 'Banner no encontrado.');
      await cleanupBlobUrls(sql, [rows[0].image_url]);
      return json({ ok: true, removed: true });
    }

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
