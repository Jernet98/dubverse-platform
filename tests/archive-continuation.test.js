import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { episodePlayback } from '../lib/update2.js';

const source = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Archive monta inmediatamente el iframe oficial fuera del reproductor nativo', async () => {
  const app = await source('public/app.js');
  const playback = episodePlayback({ provider: 'ARCHIVE', archive_identifier: 'serie-item', archive_file: 'episodio 8.mp4', video_url: 'https://archive.org/embed/serie-item/episodio%208.mp4' });
  assert.equal(playback.source, null);
  assert.equal(playback.fallback.url, 'https://archive.org/embed/serie-item/episodio%208.mp4');
  assert.equal(playback.identifier, 'serie-item');
  assert.match(app, /if \(isArchivePlayback\) \{\s*mountArchiveEmbed/);
  assert.match(app, /else if \(window\.DubversePlayer\)/);
  const mount = app.slice(app.indexOf('function mountArchiveEmbed'), app.indexOf('function initializeEditorialCarousel'));
  assert.match(mount, /<iframe src="\$\{esc\(embed\)\}"/);
  assert.doesNotMatch(mount, /new window\.DubversePlayer|<video|setTimeout|setInterval|addEventListener|retry|loader/);
});

test('Home no consulta ni renderiza Seguir viendo', async () => {
  const [api, app] = await Promise.all([source('app/api/[...path]/route.js'), source('public/app.js')]);
  assert.doesNotMatch(api, /function continueWatching|sectionType: 'CONTINUE_WATCHING'|title: 'Seguir viendo'/);
  assert.doesNotMatch(app, /function continueWatchingRow|function initializeContinueWatching|Seguir viendo|Continuar desde|data-continue-/);
  assert.match(app, /'CONTINUE_WATCHING'\]\.includes\(section\.sectionType\)/);
});

test('Archive conserva embed oficial sin enlace de salida visible ni sandbox no comprobado', async () => {
  const app = await source('public/app.js');
  const mount = app.slice(app.indexOf('function mountArchiveEmbed'), app.indexOf('function initializeEditorialCarousel'));
  assert.match(mount, /iframe src="\$\{esc\(embed\)\}"/);
  assert.doesNotMatch(mount, /Abrir en Archive\.org|archive\.org\/details|sandbox|\/download\/|retry|loader/);
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
