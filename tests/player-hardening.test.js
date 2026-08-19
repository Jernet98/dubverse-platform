import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { episodePlayback } from '../lib/update2.js';

const source = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('player oculta todos los controles al reproducir y los restaura con interacción o pausa', async () => {
  const [player, styles] = await Promise.all([source('public/player.js'), source('public/styles.css')]);
  assert.match(player, /const AUTO_HIDE_MS = 2800/);
  assert.match(player, /scheduleControlsHide\(\)[\s\S]*root\.dataset\.playerState !== 'playing'/);
  assert.match(player, /global\.setTimeout\(\(\) => this\.hideControls\(\), AUTO_HIDE_MS\)/);
  assert.match(player, /pointermove[\s\S]*event\.pointerType === 'mouse'[\s\S]*noteInteraction/);
  assert.match(player, /\['paused', 'ready', 'buffering', 'seeking', 'ended', 'error'\][\s\S]*showControls/);
  assert.match(styles, /data-controls=hidden[\s\S]*\.dv-player-controls\{opacity:0;transform:translateY\(8px\);pointer-events:none/);
  assert.match(styles, /data-controls=hidden[\s\S]*\.dv-player-center\{opacity:0/);
});

test('desktop alterna play con click y touch sólo administra visibilidad de controles', async () => {
  const player = await source('public/player.js');
  const stageHandler = player.slice(player.indexOf('    onStageClick(event)'), player.indexOf('    onKeydown(event)'));
  assert.match(stageHandler, /touchInteraction[\s\S]*event\.pointerType === 'touch'[\s\S]*if \(!touchInteraction\) return this\.togglePlayback\(\)/);
  assert.match(stageHandler, /root\.dataset\.controls === 'visible'[\s\S]*hideControls\(\)[\s\S]*noteInteraction\(\)/);
  assert.equal((stageHandler.match(/togglePlayback\(\)/g) || []).length, 1);
  assert.match(player, /data-player-center[\s\S]*togglePlayback\(\)/);
});

test('seek, volumen, fullscreen y teclado conservan controles accesibles', async () => {
  const [player, styles] = await Promise.all([source('public/player.js'), source('public/styles.css')]);
  assert.match(player, /seek\.addEventListener\('pointerdown'[\s\S]*this\.seeking = true/);
  assert.match(player, /seek\.addEventListener\('pointerup', finishSeek\)/);
  assert.match(player, /video\.volume = this\.lastVolume \|\| 1/);
  assert.match(player, /this\.lastVolume = video\.volume[\s\S]*video\.muted = true/);
  assert.match(player, /document\.fullscreenElement[\s\S]*document\.exitFullscreen[\s\S]*requestFullscreen[\s\S]*webkitEnterFullscreen/);
  for (const key of ["' '", "'enter'", "'m'", "'f'", "'arrowleft'", "'arrowright'"]) assert.match(player, new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(player, /isEditableTarget\(event\.target\)/);
  assert.match(styles, /min-width:44px;min-height:44px/);
  assert.match(styles, /\.dv-player-volume-group:hover \.dv-player-volume/);
  assert.match(player, /volume\.hidden = this\.touchMode/);
});

test('Archive intenta directo, file embed e item embed en orden y sin ciclos', async () => {
  const playback = episodePlayback({
    provider: 'ARCHIVE',
    archive_identifier: 'dororo-regression',
    archive_file: 'La Historia de Daigo.mp4',
    video_url: 'https://archive.org/embed/dororo-regression/La%20Historia%20de%20Daigo.mp4'
  });
  assert.equal(playback.source.mode, 'DIRECT_ARCHIVE');
  assert.equal(playback.source.url, 'https://archive.org/download/dororo-regression/La%20Historia%20de%20Daigo.mp4');
  assert.deepEqual(playback.fallbacks, [
    { kind: 'IFRAME', url: 'https://archive.org/embed/dororo-regression/La%20Historia%20de%20Daigo.mp4', mode: 'ARCHIVE_FILE_EMBED' },
    { kind: 'IFRAME', url: 'https://archive.org/embed/dororo-regression', mode: 'ARCHIVE_ITEM_EMBED' }
  ]);
  const legacyAnohana = episodePlayback({
    provider: 'ARCHIVE',
    archive_identifier: 'anohana-regression',
    archive_file: '',
    video_url: 'https://archive.org/embed/anohana-regression/Anohana%2001.mp4'
  });
  assert.equal(legacyAnohana.source.url, 'https://archive.org/download/anohana-regression/Anohana%2001.mp4');
  assert.deepEqual(legacyAnohana.fallbacks.map(item => item.mode), ['ARCHIVE_FILE_EMBED', 'ARCHIVE_ITEM_EMBED']);

  const player = await source('public/player.js');
  assert.match(player, /new Set\(\)/);
  assert.match(player, /archiveAttempts\.has/);
  assert.match(player, /archiveAttempts\.add/);
  assert.match(player, /archiveAttempts\.clear\(\)/);
  assert.match(player, /readyState < 1[\s\S]*handleVideoFailure/);
  assert.match(player, /frame\.onerror[\s\S]*advanceArchiveFallback/);
  assert.match(player, /ARCHIVE_FILE_EMBED[\s\S]*ARCHIVE_ITEM_EMBED[\s\S]*FAILED/);
});

test('fallback Archive conserva el progreso conocido y DIRECT/HLS no cambian', async () => {
  const direct = episodePlayback({ provider: 'DIRECT', video_url: 'https://cdn.example/episode.mp4' });
  const hls = episodePlayback({ provider: 'HLS', video_url: 'https://cdn.example/episode.m3u8' });
  assert.deepEqual(direct, { provider: 'DIRECT', source: { kind: 'VIDEO', url: 'https://cdn.example/episode.mp4' }, fallback: null });
  assert.deepEqual(hls, { provider: 'HLS', source: { kind: 'HLS', url: 'https://cdn.example/episode.m3u8' }, fallback: null });

  const player = await source('public/player.js');
  assert.match(player, /lastPosition = this\.initialTime/);
  assert.match(player, /lastDuration = 0/);
  assert.match(player, /position: this\.video\?\.currentTime \|\| this\.lastPosition/);
  assert.match(player, /duration: this\.video\?\.duration \|\| this\.lastDuration/);
  assert.match(player, /progress\.position > 0 && progress\.duration > 0[\s\S]*onPause/);
  assert.doesNotMatch(player, /onProgress\?\.\(\{ position: 0/);
});
