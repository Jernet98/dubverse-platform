import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../public/player.js', import.meta.url), 'utf8');
function fixture() {
  const timers = [];
  const context = { window: {}, navigator: {}, URL, AbortController, setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {} };
  vm.runInNewContext(source, context);
  const player = Object.create(context.window.DubversePlayer.prototype);
  const events = [];
  const video = new EventTarget();
  Object.assign(video, {
    currentTime: 40, duration: 100, paused: false, ended: false, playbackRate: 1.5,
    readyState: 3, seeking: false, buffered: { length: 0 },
    pause() { this.paused = true; this.dispatchEvent(new Event('pause')); },
    play() { this.paused = false; events.push('play'); return Promise.resolve(); },
    removeAttribute() {}, load() { events.push('load'); }, canPlayType() { return ''; }
  });
  Object.assign(player, {
    video, options: Object.fromEntries(['onPlaying','onPause','onProgress','onSeek','onEnded','onDestroy'].map(name => [name, snapshot => events.push([name, snapshot])])),
    config: {}, loadToken: 1, lastPosition: 40, lastDuration: 100, cleanups: [], savedRate: 1.5,
    mediaAbort: new AbortController(), variants: [], failedVariants: new Set(),
    art: { url: '', template: { $player: { classList: { remove() {} } } }, destroy() { events.push('art-destroy'); } },
    renderState(state) { events.push(['state', state]); }, showControls() {}, updateBuffer() {}, updateSubtitleMenu() {}, updateQualityMenu() {}
  });
  return { player, video, events, timers, context };
}

test('play empieza inmediatamente sin esperar ocho segundos de buffer', () => {
  const { player, events, timers } = fixture();
  player.requestPlay();
  assert.deepEqual(events, ['play']);
  assert.equal(timers.length, 0);
});

test('buscar no pausa ni recarga y conserva los callbacks de Analytics', () => {
  const { player, video, events } = fixture();
  player.bindVideo(1, 0);
  video.dispatchEvent(new Event('playing'));
  video.dispatchEvent(new Event('seeking'));
  video.currentTime = 42;
  video.dispatchEvent(new Event('seeked'));
  video.dispatchEvent(new Event('timeupdate'));
  assert.equal(video.paused, false);
  assert.equal(events.some(event => event === 'load' || event?.[0] === 'onPause'), false);
  assert.equal(events.filter(event => event?.[0] === 'onPlaying').length, 1);
  assert.equal(events.filter(event => event?.[0] === 'onSeek').length, 1);
  assert.equal(events.find(event => event?.[0] === 'onProgress')[1].paused, true);
});

test('calidad manual inmediata reutiliza el video, restaura posición/velocidad y no genera pausa ni seek falsos', async () => {
  const { player, video, events } = fixture();
  player.variants = [{ url: 'https://archive.org/download/item/ep.mp4' }, { url: 'https://archive.org/download/item/ep.ia.mp4' }];
  player.variantIndex = 0;
  player.lastSwitchAt = Date.now();
  player.switchVariant(1);
  assert.equal(player.video, video);
  assert.equal(player.art.url, player.variants[1].url);
  video.currentTime = 0;
  video.dispatchEvent(new Event('timeupdate'));
  video.dispatchEvent(new Event('loadedmetadata'));
  video.dispatchEvent(new Event('seeked'));
  assert.equal(video.currentTime, 40);
  assert.equal(video.playbackRate, 1.5);
  assert.equal(video.paused, false);
  assert.equal(events.some(event => ['onPause','onSeek','onProgress'].includes(event?.[0])), false);
  const token = player.loadToken;
  player.switchVariant(1);
  assert.equal(player.loadToken, token);
});

test('restauración inicial y destrucción conservan un snapshot finito sin eventos tardíos', () => {
  const { player, video, events } = fixture();
  player.restoring = true;
  player.bindVideo(1, 28);
  video.dispatchEvent(new Event('loadedmetadata'));
  video.dispatchEvent(new Event('seeked'));
  assert.equal(video.currentTime, 28);
  player.container = { replaceChildren() {} };
  player.destroy(); player.destroy();
  video.dispatchEvent(new Event('playing'));
  assert.equal(events.filter(event => event?.[0] === 'onDestroy').length, 1);
  assert.equal(events.find(event => event?.[0] === 'onDestroy')[1].position, 28);
  assert.equal(events.filter(event => event?.[0] === 'onPlaying').length, 0);
});

test('stalled con buffer suficiente no interrumpe ni cambia de archivo', () => {
  const { player, video, events, timers } = fixture();
  video.buffered = { length: 2, start: i => [0, 35][i], end: i => [10, 52][i] };
  player.handleStall('stalled', 1);
  assert.equal(player.bufferAhead(), 12);
  assert.equal(timers.length, 0);
  assert.deepEqual(events, []);
});

test('waiting persistente baja sólo una variante en Auto; manual no cambia de fuente', () => {
  const { player, video, timers } = fixture();
  player.autoQuality = true; player.variantIndex = 1;
  player.variants = [{ url: 'low' }, { url: 'high' }];
  const switched = [];
  player.switchVariant = index => switched.push(index);
  video.readyState = 2;
  player.handleStall('waiting', 1);
  assert.equal(timers[0].ms, 6000);
  timers[0].fn();
  assert.deepEqual(switched, [0]);
  player.autoQuality = false;
  player.handleStall('waiting', 1); timers[1].fn();
  assert.deepEqual(switched, [0]);
});

test('error de red reintenta una vez y restaura el último progreso aunque el navegador lo reinicie', () => {
  const { player, video, timers } = fixture();
  video.error = { code: 2 }; video.currentTime = 0;
  player.source = { kind: 'VIDEO', url: '/episode.mp4' };
  player.wantedPlay = true;
  const mounts = [], errors = [];
  player.mountVideo = (source, options) => mounts.push({ source, options });
  player.showError = message => errors.push(message);
  player.handleMediaError(1);
  assert.equal(timers[0].ms, 1000);
  timers[0].fn();
  assert.equal(mounts[0].options.restoreTime, 40);
  assert.equal(mounts[0].options.resume, true);
  player.handleMediaError(1);
  assert.equal(timers.length, 1);
  assert.equal(errors.length, 1);
});

test('buffer dibuja todos los rangos reales y mantiene huecos sin simular carga', () => {
  const { player, video } = fixture();
  delete player.updateBuffer;
  player.bufferLayer = {};
  player.art.template.$progress = { setAttribute() {} };
  video.buffered = { length: 2, start: i => [0, 60][i], end: i => [10, 80][i] };
  player.updateBuffer();
  assert.equal(player.bufferLayer.innerHTML, '<i style="left:0%;width:10%"></i><i style="left:60%;width:20%"></i>');
  video.duration = Infinity;
  player.updateBuffer();
  assert.equal(player.bufferLayer.innerHTML, '');
});

test('variantes Archive rechazan otro identifier y eliminan URLs duplicadas', () => {
  const { player } = fixture();
  player.config = { provider: 'ARCHIVE', identifier: 'item', variants: [
    { url: 'https://archive.org/download/item/ep.mp4' }, { url: 'https://archive.org/download/otro/ep.mp4' },
    { url: 'https://archive.org/download/item/ep.mp4' }, { url: 'javascript:alert(1)' }
  ] };
  assert.equal(player.archiveVariants().length, 1);
});

test('HLS nativo y MP4 no crean hls.js; fuentes incompatibles muestran error', async () => {
  const { player, video, context, events } = fixture();
  context.window.Hls = class { static isSupported() { return false; } };
  await player.attachSource({ kind: 'VIDEO', url: 'https://example.com/ep.mp4' }, 1);
  assert.match(player.art.url, /ep.mp4$/);
  video.canPlayType = () => 'maybe';
  context.navigator.vendor = 'Apple Computer, Inc.';
  await player.attachSource({ kind: 'HLS', url: 'https://example.com/master.m3u8' }, 1);
  assert.match(player.art.url, /master.m3u8$/);
  video.canPlayType = () => '';
  player.showError = message => events.push(message);
  await player.attachSource({ kind: 'HLS', url: 'https://example.com/master.m3u8' }, 1);
  assert.match(events.at(-1), /no admite/);
});

test('hls.js ofrece ABR real y limita recuperación fatal; destroy invalida sus eventos', async () => {
  const { player, context, events, timers } = fixture();
  class Hls {
    static Events = { MANIFEST_PARSED: 'manifest', SUBTITLE_TRACKS_UPDATED: 'subs', ERROR: 'error' };
    static ErrorTypes = { NETWORK_ERROR: 'network', MEDIA_ERROR: 'media' };
    static isSupported() { return true; }
    handlers = {};
    on(name, fn) { this.handlers[name] = fn; }
    loadSource(url) { this.url = url; }
    attachMedia(video) { this.video = video; }
    startLoad() { events.push('hls-start'); }
    recoverMediaError() { events.push('hls-recover'); }
    destroy() { events.push('hls-destroy'); }
  }
  context.window.Hls = Hls;
  await player.attachSource({ kind: 'HLS', url: '/master.m3u8' }, 1);
  const hls = player.hls;
  assert.equal(hls.video, player.video);
  player.handleMediaError = () => events.push('fatal');
  hls.handlers.error(null, { fatal: true, type: 'network' });
  timers.at(-1).fn();
  hls.handlers.error(null, { fatal: true, type: 'media' });
  hls.handlers.error(null, { fatal: true, type: 'media' });
  assert.deepEqual(events.filter(item => typeof item === 'string'), ['hls-start','hls-recover','fatal']);
  player.releaseMedia();
  const count = events.length;
  hls.handlers.error(null, { fatal: true, type: 'network' });
  assert.equal(events.length, count);
  assert.equal(player.hls, null);
});

test('cada build sirve exactamente las versiones instaladas del player sin CDN', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(source.includes(`artplayer-${pkg.dependencies.artplayer}.js`));
  assert.ok(source.includes(`hls-${pkg.dependencies['hls.js']}.js`));
});
