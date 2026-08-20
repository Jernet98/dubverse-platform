import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { episodePlayback } from '../lib/update2.js';

const source = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Archive monta inmediatamente el iframe oficial fuera del reproductor nativo', async () => {
  const app = await source('public/app.js');
  const playback = episodePlayback({ provider: 'ARCHIVE', archive_identifier: 'serie-item', archive_file: 'episodio 8.mp4' });
  assert.equal(playback.source, null);
  assert.equal(playback.fallback.url, 'https://archive.org/embed/serie-item/episodio%208.mp4');
  assert.equal(playback.identifier, 'serie-item');
  assert.match(app, /if \(isArchivePlayback\) \{\s*mountArchiveEmbed/);
  assert.match(app, /else if \(window\.DubversePlayer\)/);
  assert.match(app, /frame\.addEventListener\('load'[^;]+loader\.classList\.add\('hidden'\)/);
  assert.match(app, /frame\.addEventListener\('load'[\s\S]*frame\.src = embed/);
  const mount = app.slice(app.indexOf('function mountArchiveEmbed'), app.indexOf('function initializeEditorialCarousel'));
  assert.doesNotMatch(mount, /new window\.DubversePlayer|<video|retry|setTimeout|setInterval/);
});

test('Seguir viendo combina progreso preciso con actividad Archive sin porcentajes falsos', async () => {
  const [api, app] = await Promise.all([source('app/api/[...path]/route.js'), source('public/app.js')]);
  assert.match(api, /WITH precise_progress AS[\s\S]*e\.provider <> 'ARCHIVE'/);
  assert.match(api, /archive_activity AS[\s\S]*FROM episode_history h[\s\S]*e\.provider = 'ARCHIVE'/);
  assert.match(api, /row_number\(\) OVER \(PARTITION BY project_id ORDER BY updated_at DESC/);
  assert.match(api, /NOT EXISTS \(SELECT 1 FROM episode_watched/);
  assert.match(api, /activityOnly: Boolean\(row\.activity_only\)/);
  assert.match(api, /positionSeconds: row\.activity_only \? null/);
  assert.match(api, /durationSeconds: row\.activity_only \? null/);
  assert.match(api, /progress: row\.activity_only \? null/);
  assert.match(app, /item\.activityOnly \? 'Continuar episodio' : `Continuar desde/);
  assert.match(app, /item\.activityOnly \? '' : `<i class="continue-progress"/);
  assert.doesNotMatch(app, /activityOnly[^\n]+Continuar desde 0:00/);
});

test('Archive conserva embed oficial sin enlace de salida visible ni sandbox no comprobado', async () => {
  const app = await source('public/app.js');
  const mount = app.slice(app.indexOf('function mountArchiveEmbed'), app.indexOf('function initializeEditorialCarousel'));
  assert.match(mount, /frame\.src = embed/);
  assert.doesNotMatch(mount, /Abrir en Archive\.org|archive\.org\/details|sandbox|\/download\//);
});

test('carrusel de Seguir viendo reutiliza follow y permite quitar, marcar visto y limpiar', async () => {
  const [app, api, social] = await Promise.all([
    source('public/app.js'), source('app/api/[...path]/route.js'), source('app/api/social/[...path]/route.js')
  ]);
  assert.match(app, /data-continue-previous/);
  assert.match(app, /data-continue-next/);
  assert.match(app, /scrollBy\(\{ left:[\s\S]*behavior: 'smooth'/);
  assert.match(app, /\/studios\/\$\{encodeURIComponent\(button\.dataset\.studioId\)\}\/follow/);
  assert.match(app, /Ya terminé este episodio/);
  assert.match(app, /No quiero continuar viéndolo/);
  assert.match(app, /\/continue-watching\/\$\{encodeURIComponent\(card\.dataset\.episodeId\)\}/);
  assert.match(app, /socialWrite\('\/continue-watching', 'DELETE'\)/);
  assert.match(social, /removeContinueWatching[\s\S]*DELETE FROM watch_progress[\s\S]*DELETE FROM episode_history/);
  assert.match(social, /clearContinueWatching[\s\S]*DELETE FROM watch_progress[\s\S]*DELETE FROM episode_history/);
  assert.doesNotMatch(social.slice(social.indexOf('async function clearContinueWatching'), social.indexOf('async function notifications')), /favorites|likes|comments|studio_follows|user_follows/);
  assert.match(api, /LEFT JOIN LATERAL[\s\S]*project_studios[\s\S]*studio_follows/);
  assert.match(api, /studio: row\.studio_id/);
  assert.match(api, /episode_likes[\s\S]*AS episode_liked/);
  assert.match(app, /data-continue-like/);
  assert.match(app, /\/episodes\/\$\{encodeURIComponent\(card\.dataset\.episodeId\)\}\/like/);
});

test('abrir Archive registra historial y marcar visto reutiliza episode_watched', async () => {
  const [app, social] = await Promise.all([source('public/app.js'), source('app/api/social/[...path]/route.js')]);
  assert.match(app, /state\.social\.viewer && recordHistory\) \{[\s\S]*void socialWrite\(`\/episodes\/\$\{encodeURIComponent\(episodeId\)\}\/view`/);
  assert.doesNotMatch(app, /await socialWrite\(`\/episodes\/\$\{encodeURIComponent\(episodeId\)\}\/view`/);
  assert.match(app, /id="episodeWatched"[\s\S]*Marcar como visto/);
  assert.match(app, /\/episodes\/\$\{encodeURIComponent\(episodeId\)\}\/watched/);
  assert.match(social, /INSERT INTO episode_watched[\s\S]*DELETE FROM watch_progress/);
});

test('sesión conserva no-store, deduplicación y errores reintentables', async () => {
  const app = await source('public/app.js');
  assert.match(app, /socialApi\('\/session', \{ cache: 'no-store' \}\)/);
  assert.match(app, /if \(sessionSyncPromise\) return sessionSyncPromise/);
  assert.match(app, /state\.social\.sessionLoaded = wasLoaded/);
  assert.doesNotMatch(app, /catch \{[\s\S]{0,200}sessionLoaded = true/);
});
