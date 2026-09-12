import crypto from 'node:crypto';
import { AppError } from './db.js';

export const ANALYTICS_EVENTS = new Set(['PROJECT_VIEW','EPISODE_VIEW','PLAY_START','PLAY_25','PLAY_50','PLAY_75','PLAY_90','PLAY_COMPLETE']);
export const ANALYTICS_PERIODS = new Set(['today','7d','30d','90d','all']);
const PLAY_EVENTS = new Set(['PLAY_START','PLAY_25','PLAY_50','PLAY_75','PLAY_90','PLAY_COMPLETE']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function analyticsPeriod(value = '30d', now = new Date()) {
  const period = String(value || '30d');
  if (!ANALYTICS_PERIODS.has(period)) throw new AppError(400, 'Periodo no permitido.');
  if (period === 'all') return { period, start: null, previousStart: null, previousEnd: null };
  if (period === 'today') {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const previousStart = new Date(start.getTime() - 86400000);
    return { period, start: start.toISOString(), previousStart: previousStart.toISOString(), previousEnd: start.toISOString() };
  }
  const days = Number.parseInt(period, 10);
  const start = new Date(now.getTime() - days * 86400000);
  return { period, start: start.toISOString(), previousStart: new Date(start.getTime() - days * 86400000).toISOString(), previousEnd: start.toISOString() };
}

export function validateAnalyticsEvent(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError(400, 'Evento inválido.');
  const eventType = String(body.eventType || '');
  if (!ANALYTICS_EVENTS.has(eventType)) throw new AppError(400, 'Tipo de evento no permitido.');
  const projectId = String(body.projectId || '');
  const episodeId = String(body.episodeId || '');
  const playbackId = String(body.playbackId || '');
  if (projectId.length > 120 || episodeId.length > 120 || !/^[a-zA-Z0-9._-]+$/.test(projectId || episodeId)
    || (projectId && !/^[a-zA-Z0-9._-]+$/.test(projectId)) || (episodeId && !/^[a-zA-Z0-9._-]+$/.test(episodeId))) throw new AppError(400, 'Identificador inválido.');
  if (eventType === 'PROJECT_VIEW' && (!projectId || episodeId || playbackId)) throw new AppError(400, 'Proyecto inválido.');
  if (eventType !== 'PROJECT_VIEW' && (!episodeId || projectId)) throw new AppError(400, 'Episodio inválido.');
  if (PLAY_EVENTS.has(eventType) && !UUID.test(playbackId)) throw new AppError(400, 'Reproducción inválida.');
  if (!PLAY_EVENTS.has(eventType) && playbackId) throw new AppError(400, 'Reproducción inesperada.');
  return { eventType, projectId, episodeId, playbackId: playbackId || null };
}

export function analyticsDedupe(sessionId, event) {
  return crypto.createHash('sha256').update([sessionId, event.eventType, event.projectId || event.episodeId, event.playbackId || 'view'].join(':')).digest('hex');
}

export async function recordAnalyticsEvent(sql, event, visitorId, sessionId) {
  const target = event.eventType === 'PROJECT_VIEW'
    ? await sql`SELECT p.id AS project_id FROM projects p WHERE p.id = ${event.projectId} AND p.published = true AND p.deleted_at IS NULL`
    : await sql`SELECT p.id AS project_id, e.id AS episode_id FROM episodes e JOIN projects p ON p.id = e.project_id
      WHERE e.id = ${event.episodeId} AND e.published = true AND e.deleted_at IS NULL AND p.published = true AND p.deleted_at IS NULL`;
  if (!target.length) throw new AppError(404, 'Contenido no disponible.');
  if (PLAY_EVENTS.has(event.eventType) && event.eventType !== 'PLAY_START') {
    const started = await sql`SELECT 1 FROM analytics_events WHERE session_id = ${sessionId}::uuid
      AND playback_id = ${event.playbackId}::uuid AND episode_id = ${target[0].episode_id} AND event_type = 'PLAY_START' LIMIT 1`;
    if (!started.length) throw new AppError(409, 'La reproducción no ha comenzado.');
  }
  const quota = await sql`SELECT COUNT(*)::int AS count FROM analytics_events
    WHERE session_id = ${sessionId}::uuid AND created_at > now() - interval '1 hour'`;
  if (Number(quota[0]?.count || 0) >= 200) throw new AppError(429, 'Demasiados eventos en esta sesión.');
  const visitorQuota = await sql`SELECT COUNT(*)::int AS count FROM analytics_events
    WHERE visitor_id = ${visitorId}::uuid AND created_at > now() - interval '1 hour'`;
  if (Number(visitorQuota[0]?.count || 0) >= 300) throw new AppError(429, 'Demasiados eventos de este visitante.');
  const id = crypto.randomUUID();
  const inserted = await sql`
    WITH inserted AS (
      INSERT INTO analytics_events
        (id, event_type, project_id, episode_id, visitor_id, session_id, playback_id, dedupe_key)
      VALUES (${id}::uuid, ${event.eventType}, ${target[0].project_id}, ${target[0].episode_id || null},
        ${visitorId}::uuid, ${sessionId}::uuid, ${event.playbackId}::uuid, ${analyticsDedupe(sessionId, event)})
      ON CONFLICT (dedupe_key) DO NOTHING RETURNING id, project_id
    ), linked AS (
      INSERT INTO analytics_event_studios (event_id, studio_id)
      SELECT inserted.id, ps.studio_id FROM inserted
      JOIN project_studios ps ON ps.project_id = inserted.project_id
      ON CONFLICT DO NOTHING RETURNING event_id
    )
    SELECT id FROM inserted`;
  return { recorded: inserted.length > 0 };
}

const number = value => Number(value || 0);
const metrics = row => ({ visitors: number(row?.visitors), projectViews: number(row?.project_views), episodeViews: number(row?.episode_views), plays: number(row?.plays), completed: number(row?.completed) });

export async function analyticsDashboard(sql, { studioId = null, projectId = null, period = '30d' } = {}) {
  const window = analyticsPeriod(period);
  const start = window.start;
  const previousStart = window.previousStart;
  const previousEnd = window.previousEnd;
  const [totals, previous, days, projects, episodes, studios] = await Promise.all([
    sql`SELECT COUNT(DISTINCT a.visitor_id)::int AS visitors,
      COUNT(DISTINCT a.id) FILTER (WHERE a.event_type = 'PROJECT_VIEW')::int AS project_views,
      COUNT(DISTINCT a.id) FILTER (WHERE a.event_type = 'EPISODE_VIEW')::int AS episode_views,
      COUNT(DISTINCT a.id) FILTER (WHERE a.event_type = 'PLAY_START')::int AS plays,
      COUNT(DISTINCT a.id) FILTER (WHERE a.event_type = 'PLAY_COMPLETE')::int AS completed,
      COUNT(DISTINCT s.studio_id)::int AS active_studios,
      COUNT(DISTINCT a.project_id)::int AS active_projects
      FROM analytics_events a LEFT JOIN analytics_event_studios s ON s.event_id = a.id
      WHERE (${start}::timestamptz IS NULL OR a.created_at >= ${start}::timestamptz)
        AND (${projectId}::text IS NULL OR a.project_id = ${projectId})
        AND (${studioId}::text IS NULL OR s.studio_id = ${studioId})`,
    previousStart ? sql`SELECT COUNT(DISTINCT a.visitor_id)::int AS visitors,
      COUNT(*) FILTER (WHERE a.event_type = 'PROJECT_VIEW')::int AS project_views,
      COUNT(*) FILTER (WHERE a.event_type = 'EPISODE_VIEW')::int AS episode_views,
      COUNT(*) FILTER (WHERE a.event_type = 'PLAY_START')::int AS plays,
      COUNT(*) FILTER (WHERE a.event_type = 'PLAY_COMPLETE')::int AS completed
      FROM analytics_events a WHERE a.created_at >= ${previousStart}::timestamptz AND a.created_at < ${previousEnd}::timestamptz
      AND (${projectId}::text IS NULL OR a.project_id = ${projectId})
      AND (${studioId}::text IS NULL OR EXISTS (SELECT 1 FROM analytics_event_studios s WHERE s.event_id = a.id AND s.studio_id = ${studioId}))` : Promise.resolve([]),
    sql`SELECT (a.created_at AT TIME ZONE 'UTC')::date AS day,
      COUNT(DISTINCT a.visitor_id)::int AS visitors,
      COUNT(*) FILTER (WHERE a.event_type IN ('PROJECT_VIEW','EPISODE_VIEW'))::int AS views,
      COUNT(*) FILTER (WHERE a.event_type = 'PLAY_START')::int AS plays
      FROM analytics_events a WHERE (${start}::timestamptz IS NULL OR a.created_at >= ${start}::timestamptz)
      AND (${projectId}::text IS NULL OR a.project_id = ${projectId})
      AND (${studioId}::text IS NULL OR EXISTS (SELECT 1 FROM analytics_event_studios s WHERE s.event_id = a.id AND s.studio_id = ${studioId}))
      GROUP BY 1 ORDER BY 1 DESC LIMIT 365`,
    sql`SELECT p.id, p.title, p.deleted_at, COUNT(DISTINCT a.visitor_id)::int AS visitors,
      COUNT(*) FILTER (WHERE a.event_type = 'PROJECT_VIEW')::int AS views,
      COUNT(*) FILTER (WHERE a.event_type = 'PLAY_START')::int AS plays,
      COUNT(*) FILTER (WHERE a.event_type = 'PLAY_COMPLETE')::int AS completed
      FROM projects p LEFT JOIN analytics_events a ON a.project_id = p.id
        AND (${start}::timestamptz IS NULL OR a.created_at >= ${start}::timestamptz)
      WHERE (${projectId}::text IS NULL OR p.id = ${projectId})
      AND (${studioId}::text IS NULL OR EXISTS (SELECT 1 FROM project_studios ps WHERE ps.project_id = p.id AND ps.studio_id = ${studioId}))
      GROUP BY p.id ORDER BY plays DESC, views DESC, p.title LIMIT 100`,
    sql`SELECT e.id, e.project_id, e.season, e.number, e.title, e.created_at,
      COUNT(*) FILTER (WHERE a.event_type = 'EPISODE_VIEW')::int AS views,
      COUNT(*) FILTER (WHERE a.event_type = 'PLAY_START')::int AS plays,
      COUNT(*) FILTER (WHERE a.event_type = 'PLAY_25')::int AS play_25,
      COUNT(*) FILTER (WHERE a.event_type = 'PLAY_50')::int AS play_50,
      COUNT(*) FILTER (WHERE a.event_type = 'PLAY_75')::int AS play_75,
      COUNT(*) FILTER (WHERE a.event_type = 'PLAY_COMPLETE')::int AS completed
      FROM episodes e LEFT JOIN analytics_events a ON a.episode_id = e.id
        AND (${start}::timestamptz IS NULL OR a.created_at >= ${start}::timestamptz)
      WHERE (${projectId}::text IS NULL OR e.project_id = ${projectId})
      AND (${studioId}::text IS NULL OR EXISTS (SELECT 1 FROM project_studios ps WHERE ps.project_id = e.project_id AND ps.studio_id = ${studioId}))
      GROUP BY e.id ORDER BY e.project_id, e.season, e.number LIMIT 500`,
    studioId ? Promise.resolve([]) : sql`SELECT s.id, s.name,
      COUNT(DISTINCT a.visitor_id)::int AS visitors,
      COUNT(*) FILTER (WHERE a.event_type IN ('PROJECT_VIEW','EPISODE_VIEW'))::int AS views,
      COUNT(*) FILTER (WHERE a.event_type = 'PLAY_START')::int AS plays,
      COUNT(*) FILTER (WHERE a.event_type = 'PLAY_COMPLETE')::int AS completed
      FROM studios s JOIN analytics_event_studios aes ON aes.studio_id = s.id
      JOIN analytics_events a ON a.id = aes.event_id
      WHERE (${start}::timestamptz IS NULL OR a.created_at >= ${start}::timestamptz)
      AND (${projectId}::text IS NULL OR a.project_id = ${projectId})
      GROUP BY s.id ORDER BY plays DESC, views DESC LIMIT 50`
  ]);
  const projectRows = projects.map(row => ({ id: row.id, title: row.title, deleted: Boolean(row.deleted_at), visitors: number(row.visitors), views: number(row.views), plays: number(row.plays), completed: number(row.completed), completionRate: number(row.plays) ? Math.round(number(row.completed) / number(row.plays) * 1000) / 10 : null }));
  const episodeRows = episodes.map(row => ({ id: row.id, projectId: row.project_id, season: number(row.season), number: number(row.number), title: row.title, publishedAt: row.created_at, views: number(row.views), plays: number(row.plays), play25: number(row.play_25), play50: number(row.play_50), play75: number(row.play_75), completed: number(row.completed), completionRate: number(row.plays) ? Math.round(number(row.completed) / number(row.plays) * 1000) / 10 : null }));
  return { period: window.period, since: window.start, summary: { ...metrics(totals[0]), activeStudios: number(totals[0]?.active_studios), activeProjects: number(totals[0]?.active_projects) }, previous: previous.length ? metrics(previous[0]) : null,
    daily: days.reverse().map(row => ({ day: String(row.day).slice(0, 10), visitors: number(row.visitors), views: number(row.views), plays: number(row.plays) })),
    projects: projectRows, episodes: episodeRows,
    studios: studios.map(row => ({ id: row.id, name: row.name, visitors: number(row.visitors), views: number(row.views), plays: number(row.plays), completed: number(row.completed) })) };
}
