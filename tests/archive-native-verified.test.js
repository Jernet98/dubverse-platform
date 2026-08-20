import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { episodePlayback, persistedArchiveNativeUrl } from '../lib/update2.js';

const source = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const nativeEpisode = {
  provider: 'ARCHIVE', archive_identifier: 'item', archive_file: 'Episode 1.mp4',
  video_url: 'https://archive.org/embed/item/Episode%201.mp4',
  archive_playback_mode: 'ARCHIVE_NATIVE_VERIFIED', archive_native_status: 'NATIVE_OK',
  archive_native_url: 'https://archive.org/download/item/Episode%201.ia.mp4'
};

test('ARCHIVE_NATIVE_VERIFIED usa video nativo y conserva un único iframe fallback', () => {
  const playback = episodePlayback(nativeEpisode);
  assert.equal(playback.mode, 'ARCHIVE_NATIVE_VERIFIED');
  assert.deepEqual(playback.source, { kind: 'VIDEO', url: 'https://archive.org/download/item/Episode%201.ia.mp4' });
  assert.equal(playback.fallback.url, 'https://archive.org/embed/item/Episode%201.mp4');
  assert.equal(persistedArchiveNativeUrl(nativeEpisode), playback.source.url);
});

test('fuente nativa no verificada o ajena degrada a ARCHIVE_EMBED', () => {
  const wrongHost = episodePlayback({ ...nativeEpisode, archive_native_url: 'https://cdn.example/Episode.mp4' });
  const unverified = episodePlayback({ ...nativeEpisode, archive_native_status: 'EMBED_ONLY' });
  assert.equal(wrongHost.mode, 'ARCHIVE_EMBED');
  assert.equal(wrongHost.source, null);
  assert.equal(unverified.mode, 'ARCHIVE_EMBED');
  assert.equal(unverified.source, null);
  const nullColumns = episodePlayback({
    provider: 'ARCHIVE', archive_identifier: 'item', archive_file: 'Episode 1.mp4',
    video_url: 'https://archive.org/embed/item/Episode%201.mp4',
    archive_playback_mode: null, archive_native_status: null, archive_native_url: null
  });
  assert.equal(nullColumns.mode, 'ARCHIVE_EMBED');
  assert.equal(nullColumns.source, null);
  assert.equal(nullColumns.fallback.url, 'https://archive.org/embed/item/Episode%201.mp4');
});

test('player restaura currentTime, guarda progreso y hace fallback automático una sola vez', async () => {
  const [player, app] = await Promise.all([source('public/player.js'), source('public/app.js')]);
  assert.match(player, /mode === 'ARCHIVE_NATIVE_VERIFIED'[\s\S]*readyState < 3[\s\S]*useFallback\(\)/);
  assert.match(player, /if \(this\.config\.mode === 'ARCHIVE_NATIVE_VERIFIED'[\s\S]*!this\.fallbackUsed\)[\s\S]*return this\.useFallback\(\)/);
  assert.match(player, /useFallback\(\) \{\s*if \(this\.fallbackUsed\) return;/);
  assert.match(player, /this\.options\.onFallback\?\.\(\)[\s\S]*this\.video\?\.pause/);
  assert.match(player, /initialTime[\s\S]*loadedmetadata/);
  assert.match(app, /playback\.mode !== 'ARCHIVE_NATIVE_VERIFIED'/);
  assert.match(app, /initialTime: Number\(savedProgress/);
  assert.match(app, /onProgress: snapshot => sendProgress/);
  assert.match(app, /progressDisabled = true; queuedProgress = null/);
  assert.match(app, /progressComplete \|\| progressDisabled/);
  const fallbackMethod = player.slice(player.indexOf('    useFallback() {'), player.indexOf('    snapshot()'));
  assert.doesNotMatch(fallbackMethod, /retry\(|setInterval|loadPrimary\(/);
});

test('migración es aditiva, reversible y el auditor escribe sólo con --execute', async () => {
  const [migration, rollback, audit] = await Promise.all([
    source('database/migrations/2026-08-20-archive-native-verified.sql'),
    source('database/migrations/2026-08-20-archive-native-verified.rollback.sql'),
    source('scripts/audit-archive-native.mjs')
  ]);
  for (const column of ['archive_playback_mode', 'archive_native_status', 'archive_native_url', 'archive_native_verified_at', 'archive_native_verification']) {
    assert.match(migration, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`));
    assert.match(rollback, new RegExp(`DROP COLUMN IF EXISTS ${column}`));
  }
  assert.match(audit, /const execute = process\.argv\.includes\('--execute'\)/);
  assert.match(audit, /if \(execute && !process\.env\.DATABASE_URL\) throw/);
  assert.match(audit, /if \(execute\) \{[\s\S]*UPDATE episodes/);
  assert.match(audit, /mode: execute \? 'EXECUTE' : 'DRY_RUN_READ_ONLY'/);
  assert.match(migration, /position\('https:\/\/archive\.org\/download\/' \|\| archive_identifier \|\| '\/' IN archive_native_url\) = 1/);
  assert.match(migration, /archive_native_url ~ '\^https:\/\/archive\[\.\]org\/download\//);
});

test('ninguna ruta cliente acepta archive_native_url ni activa el modo verificado', async () => {
  const api = await source('app/api/[...path]/route.js');
  assert.doesNotMatch(api, /body\.archiveNativeUrl|body\.archive_native_url|body\.archivePlaybackMode|body\.archive_playback_mode/);
  assert.match(api, /archiveReferenceChanged \? 'ARCHIVE_EMBED'/);
  assert.match(api, /archiveReferenceChanged \? 'UNVERIFIED'/);
});

test('Home usa progreso preciso sólo para Archive nativo y actividad para embed', async () => {
  const api = await source('app/api/[...path]/route.js');
  assert.match(api, /e\.provider <> 'ARCHIVE' OR COALESCE\(e\.archive_playback_mode, 'ARCHIVE_EMBED'\) = 'ARCHIVE_NATIVE_VERIFIED'/);
  assert.match(api, /e\.provider = 'ARCHIVE' AND COALESCE\(e\.archive_playback_mode, 'ARCHIVE_EMBED'\) <> 'ARCHIVE_NATIVE_VERIFIED'/);
});
