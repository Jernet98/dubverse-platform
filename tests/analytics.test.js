import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { analyticsDedupe, analyticsPeriod, recordAnalyticsEvent, validateAnalyticsEvent, analyticsDashboard } from '../lib/analytics.js';
import { resolveArchiveEpisodePlayback } from '../lib/archive.js';

const source = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const visitorId = '72de0f60-1466-4e75-8f63-05f4831702bf';
const sessionId = 'c5c2f787-9987-4a81-b271-bfa1d5ff23c0';
const playbackId = '6e991f29-9163-4f04-896a-aa92de19f478';

test('valida eventos, IDs y periodos sin aceptar campos de estudio del cliente', () => {
  assert.deepEqual(validateAnalyticsEvent({ eventType: 'PROJECT_VIEW', projectId: 'demo' }), { eventType: 'PROJECT_VIEW', projectId: 'demo', episodeId: '', playbackId: null });
  assert.deepEqual(validateAnalyticsEvent({ eventType: 'PLAY_START', episodeId: 'ep-1', playbackId }), { eventType: 'PLAY_START', projectId: '', episodeId: 'ep-1', playbackId });
  assert.throws(() => validateAnalyticsEvent({ eventType: 'ADMIN', episodeId: 'ep-1' }));
  assert.throws(() => validateAnalyticsEvent({ eventType: 'PLAY_START', episodeId: 'ep-1', playbackId: 'bad' }));
  assert.throws(() => validateAnalyticsEvent({ eventType: 'PROJECT_VIEW', projectId: 'x/../../y' }));
  assert.equal(analyticsPeriod('today', new Date('2026-09-12T15:30:00Z')).start, '2026-09-12T00:00:00.000Z');
  assert.equal(analyticsPeriod('all').start, null);
  assert.throws(() => analyticsPeriod('999d'));
});

test('dedupe es estable para refresh y único por reproducción', () => {
  const event = validateAnalyticsEvent({ eventType: 'PLAY_START', episodeId: 'ep-1', playbackId });
  assert.equal(analyticsDedupe(sessionId, event), analyticsDedupe(sessionId, event));
  assert.notEqual(analyticsDedupe(sessionId, event), analyticsDedupe(visitorId, event));
  assert.notEqual(analyticsDedupe(sessionId, event), analyticsDedupe(sessionId, { ...event, playbackId: visitorId }));
});

test('registra contenido público, evita duplicado y no confía en studioId arbitrario', async () => {
  let inserted = true;
  const queries = [];
  const sql = async (parts, ...values) => {
    const query = parts.join('?');
    queries.push(query);
    if (query.includes('FROM episodes e JOIN projects')) return [{ project_id: 'p-1', episode_id: 'ep-1' }];
    if (query.includes('SELECT COUNT(*)')) return [{ count: 0 }];
    if (query.includes('INSERT INTO analytics_events')) return inserted ? [{ id: 'new' }] : [];
    return [];
  };
  const event = validateAnalyticsEvent({ eventType: 'PLAY_START', episodeId: 'ep-1', playbackId, studioId: 'attacker' });
  assert.deepEqual(await recordAnalyticsEvent(sql, event, visitorId, sessionId), { recorded: true });
  inserted = false;
  assert.deepEqual(await recordAnalyticsEvent(sql, event, visitorId, sessionId), { recorded: false });
  assert.equal(queries.filter(query => query.includes('INSERT INTO analytics_event_studios')).length, 2);
  assert.ok(queries.some(query => query.includes('JOIN project_studios ps ON ps.project_id = inserted.project_id')));
  assert.ok(queries.some(query => query.includes('ON CONFLICT (dedupe_key) DO NOTHING')));
});

test('rechaza proyecto/episodio inexistente, Papelera y milestone sin PLAY_START', async () => {
  const empty = async () => [];
  await assert.rejects(recordAnalyticsEvent(empty, validateAnalyticsEvent({ eventType: 'PROJECT_VIEW', projectId: 'deleted' }), visitorId, sessionId), { status: 404 });
  await assert.rejects(recordAnalyticsEvent(empty, validateAnalyticsEvent({ eventType: 'EPISODE_VIEW', episodeId: 'missing' }), visitorId, sessionId), { status: 404 });
  const existing = async parts => parts.join('?').includes('FROM episodes e JOIN projects') ? [{ project_id: 'p-1', episode_id: 'ep-1' }] : [];
  await assert.rejects(recordAnalyticsEvent(existing, validateAnalyticsEvent({ eventType: 'PLAY_25', episodeId: 'ep-1', playbackId }), visitorId, sessionId), { status: 409 });
});

test('agregaciones se calculan en SQL, limitadas por periodo y sin datos personales', async () => {
  const queries = [];
  const sql = async parts => {
    const query = parts.join('?');
    queries.push(query);
    if (query.includes('active_studios')) return [{ visitors: 0, project_views: 0, episode_views: 0, plays: 0, completed: 0, active_studios: 0, active_projects: 0 }];
    return [];
  };
  const result = await analyticsDashboard(sql, { studioId: 'studio-a', projectId: 'p-1', period: '7d' });
  assert.equal(result.summary.visitors, 0);
  assert.deepEqual(result.daily, []);
  assert.deepEqual(result.projects, []);
  assert.ok(queries.some(query => query.includes('COUNT(DISTINCT a.visitor_id)')));
  assert.ok(queries.some(query => query.includes('GROUP BY 1 ORDER BY 1 DESC LIMIT 365')));
  assert.ok(queries.some(query => query.includes('GROUP BY e.id')));
  assert.ok(queries.some(query => query.includes('analytics_event_studios')));
  assert.ok(!JSON.stringify(result).includes('visitor_id'));
});

test('cliente sólo registra PLAY_START al reproducir y no convierte seeks en milestones', async () => {
  const sent = [];
  const context = { window: {}, crypto: { randomUUID: () => playbackId }, fetch: async (url, options) => { sent.push(JSON.parse(options.body)); return { ok: true }; } };
  vm.runInNewContext(await source('public/analytics.js'), context);
  const tracker = new context.window.DubverseAnalytics.Playback('ep-1');
  tracker.progress({ position: 80, duration: 100, paused: false });
  assert.equal(sent.length, 0);
  tracker.start();
  tracker.progress({ position: 0, duration: 100, paused: false });
  tracker.progress({ position: 90, duration: 100, paused: false });
  await tracker.pending;
  assert.deepEqual(sent.map(item => item.eventType), ['PLAY_START']);
  for (let i = 91; i <= 100; i += 1) tracker.progress({ position: i, duration: 100, paused: false });
  tracker.complete();
  await tracker.pending;
  assert.equal(sent.filter(item => item.eventType === 'PLAY_COMPLETE').length, 1);
});

test('ARCHIVE nativo separa vista de reproducción real y deduplica hitos, completion y refresh', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({
    metadata: { identifier: 'analytics-archive-fixture' },
    files: [
      { name: 'Capitulo 1.mp4', source: 'original', format: 'MPEG4', size: '100000000' },
      { name: 'Capitulo 1.ia.mp4', original: 'Capitulo 1.mp4', source: 'derivative', format: 'h.264', size: '20000000' },
      { name: 'Capitulo 2.mp4', source: 'original', format: 'MPEG4', size: '100000000' }
    ]
  }) });
  let playback;
  try {
    playback = await resolveArchiveEpisodePlayback({ archive_identifier: 'analytics-archive-fixture', archive_file: 'Capitulo+1.mp4', video_url: 'https://archive.org/embed/analytics-archive-fixture/Capitulo%201.mp4' });
  } finally { globalThis.fetch = originalFetch; }
  assert.equal(playback.status, 'READY');
  assert.match(playback.source.url, /^https:\/\/archive\.org\/download\/analytics-archive-fixture\/Capitulo%201/);
  assert.ok(playback.variants.every(variant => !variant.name.includes('Capitulo 2')));
  assert.equal(playback.fallback.kind, 'IFRAME');

  const sent = [];
  const context = { window: {}, crypto: { randomUUID: () => playbackId }, fetch: async (_, options) => { sent.push(JSON.parse(options.body)); return { ok: true }; } };
  vm.runInNewContext(await source('public/analytics.js'), context);
  context.window.DubverseAnalytics.trackEpisode('ep-archive');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(sent.map(event => event.eventType), ['EPISODE_VIEW']);
  const tracker = new context.window.DubverseAnalytics.Playback('ep-archive');
  tracker.progress({ position: 0, duration: 100, paused: false });
  assert.equal(sent.length, 1);
  tracker.start(); // evento real `playing` del reproductor
  for (let second = 0; second <= 100; second += 1) tracker.progress({ position: second, duration: 100, paused: false });
  tracker.complete();
  tracker.complete();
  await tracker.pending;
  assert.deepEqual(sent.map(event => event.eventType), ['EPISODE_VIEW', 'PLAY_START', 'PLAY_25', 'PLAY_50', 'PLAY_75', 'PLAY_90', 'PLAY_COMPLETE']);
  context.window.DubverseAnalytics.trackEpisode('ep-archive'); // nueva visita, sin nuevo `playing`
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sent.filter(event => event.eventType === 'PLAY_START').length, 1);
  assert.equal(sent.filter(event => event.eventType === 'EPISODE_VIEW').length, 2);
});

test('ARCHIVE sin fuente nativa conserva iframe y no conecta callbacks de reproducción al iframe', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('metadata unavailable'); };
  let playback;
  try {
    playback = await resolveArchiveEpisodePlayback({ archive_identifier: 'analytics-archive-unavailable', archive_file: 'Capitulo+1.mp4', video_url: 'https://archive.org/embed/analytics-archive-unavailable/Capitulo%201.mp4' });
  } finally { globalThis.fetch = originalFetch; }
  assert.equal(playback.source, null);
  assert.equal(playback.fallback.kind, 'IFRAME');
  const app = await source('public/app.js');
  assert.match(app, /useArchiveEmbed = isArchivePlayback && !playback\.source\?\.url/);
  assert.match(app, /if \(!useArchiveEmbed && window\.DubverseAnalytics\) playbackAnalytics/);
  assert.match(app, /if \(useArchiveEmbed\) \{\s*mountArchiveEmbed/);
  assert.match(app, /onPlaying: \(\) => trackPlayback\('start'\)/);
  const player = await source('public/player.js');
  assert.match(player, /video\.addEventListener\('playing', \(\) => \{[\s\S]*?this\.options\.onPlaying\?\.\(\)/);
});

test('roles reales OWNER/ADMIN acceden sólo a su estudio; admin global es distinto', async () => {
  const [migration, accessSource, adminAccess, analyticsRoute] = await Promise.all([
    source('database/migrations/2026-08-17-update-2.sql'), source('lib/studio-access.js'),
    source('app/api/admin/studio-access/[...path]/route.js'), source('app/api/analytics/route.js')
  ]);
  assert.match(migration, /CHECK \(role IN \('OWNER','ADMIN'\)\)/);
  assert.match(adminAccess, /\['OWNER', 'ADMIN'\]/);
  assert.doesNotMatch(migration, /MANAGER|EDITOR/);
  const executable = accessSource.replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
  let profileId = 'owner';
  class AppError extends Error { constructor(status, message) { super(message); this.status = status; } }
  const sql = async (parts, ...values) => ['owner', 'studio-admin'].includes(values[0]) && values[0] === profileId && values[1] === 'studio-a'
    ? [{ id: `membership-${profileId}`, role: profileId === 'owner' ? 'OWNER' : 'ADMIN' }] : [];
  const context = { AppError, socialSession: async () => ({ row: { id: profileId }, sql }), isUpdate2SchemaMissing: () => false };
  vm.runInNewContext(`${executable}\nthis.studioAdminSession = studioAdminSession;`, context);
  assert.equal((await context.studioAdminSession({}, 'studio-a')).membership.role, 'OWNER');
  profileId = 'studio-admin';
  assert.equal((await context.studioAdminSession({}, 'studio-a')).membership.role, 'ADMIN');
  await assert.rejects(context.studioAdminSession({}, 'studio-b'), { status: 403 });
  profileId = 'outsider';
  await assert.rejects(context.studioAdminSession({}, 'studio-a'), { status: 403 });
  assert.match(analyticsRoute, /if \(url\.searchParams\.get\('scope'\) === 'admin'\) \{\s*requireAdmin\(request\)/);
  assert.match(analyticsRoute, /const session = await studioAdminSession\(request, studioId\)/);
  assert.match(analyticsRoute, /if \(!owns\.length\) throw new AppError\(403/);
});

test('permisos: admin global y membresía de estudio se comprueban en servidor', async () => {
  const [route, migration, studioUI, adminUI] = await Promise.all([
    source('app/api/analytics/route.js'), source('database/migrations/2026-09-12-analytics.sql'),
    source('public/studio-panel.js'), source('public/admin.js')
  ]);
  assert.match(route, /requireAdmin\(request\)/);
  assert.match(route, /origin !== new URL\(request\.url\)\.origin/);
  assert.doesNotMatch(route, /socialSession\(/);
  assert.match(route, /studioAdminSession\(request, studioId\)/);
  assert.match(route, /SELECT 1 FROM project_studios WHERE studio_id = \$\{session\.studioId\} AND project_id = \$\{projectId\}/);
  assert.match(migration, /ON UPDATE CASCADE ON DELETE SET NULL/);
  assert.match(migration, /ON UPDATE CASCADE ON DELETE CASCADE/);
  assert.match(studioUI, /data-panel-tab="analytics"/);
  assert.match(adminUI, /scope: 'admin'/);
});

test('dashboard vacío es legible, separa vistas/reproducciones y ofrece filtros y gráfica responsive', async () => {
  const context = { window: {} };
  vm.runInNewContext(await source('public/analytics-dashboard.js'), context);
  const markup = context.window.DubverseAnalyticsDashboard.render({
    summary: { visitors: 0, projectViews: 0, episodeViews: 0, plays: 0, completed: 0 },
    previous: null, daily: [], projects: [], episodes: [], studios: []
  });
  assert.match(markup, /Todavía no hay suficientes datos/);
  assert.match(markup, /Vistas de proyectos/);
  assert.match(markup, /Reproducciones/);
  assert.match(markup, /Archive\.org se abre en iframe, su reproducción no puede medirse/);
  assert.match(markup, /data-analytics-series/);
  assert.match(markup, /Datos disponibles desde la activación/);
  assert.doesNotMatch(markup, /NaN|Infinity|undefined/);
  const styles = await source('public/analytics-dashboard.css');
  assert.match(styles, /@media\(max-width:520px\)/);
  assert.match(styles, /overflow-x:auto/);
});
