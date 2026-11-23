import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../public/player.js', import.meta.url), 'utf8');
function fixture() {
  const timers = [];
  const context = { window: {}, document: { hidden: false }, navigator: {}, URL, AbortController, setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {} };
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
    art: { url: '', setting: {}, template: { $player: { classList: { remove() {} } } }, destroy() { events.push('art-destroy'); } },
    variantSupport: new Map(),
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
  video.volume = .27; video.muted = true;
  player.switchVariant(1);
  assert.equal(player.video, video);
  assert.equal(player.art.url, player.variants[1].url);
  video.currentTime = 0;
  video.volume = 1; video.muted = false;
  video.dispatchEvent(new Event('timeupdate'));
  video.dispatchEvent(new Event('loadedmetadata'));
  video.dispatchEvent(new Event('seeked'));
  assert.equal(video.currentTime, 40);
  assert.equal(video.playbackRate, 1.5);
  assert.equal(video.volume, .27);
  assert.equal(video.muted, true);
  assert.equal(video.paused, false);
  assert.equal(events.some(event => ['onPause','onSeek','onProgress'].includes(event?.[0])), false);
  const token = player.loadToken;
  player.switchVariant(1);
  assert.equal(player.loadToken, token);
});

const codecFixtures = JSON.parse(await readFile(new URL('./fixtures/archive-decoding.json', import.meta.url), 'utf8'));
function decodedFixture() {
  const fixtureData = fixture();
  const { player, video, context } = fixtureData;
  player.config = { provider: 'ARCHIVE' };
  player.variants = codecFixtures.records[0].variants;
  player.variantIndex = 1; player.autoQuality = true;
  video.canPlayType = () => 'probably';
  video.readyState = 4; video.videoWidth = 1920;
  video.buffered = { length: 1, start: () => 0, end: () => 1000 };
  let clock = 0, frames = 0;
  context.Date = { now: () => clock };
  video.getVideoPlaybackQuality = () => ({ totalVideoFrames: frames, droppedVideoFrames: 0, corruptedVideoFrames: 0 });
  player.showVideoRecovery = message => fixtureData.events.push(['recovery', message]);
  return { ...fixtureData, setFrames: value => { frames = value; }, tick: () => { clock += 1000; video.currentTime += 1; player.checkVideoFrames(clock); } };
}

test('Auto excluye HEVC Main 10 rechazado por MediaCapabilities, sin forzar 480p en H.264 compatible', async () => {
  const { player, context } = decodedFixture();
  const checked = [];
  context.navigator.connection = { downlink: 100 };
  context.navigator.mediaCapabilities = { decodingInfo: async config => {
    checked.push(config);
    return { supported: !config.video.contentType.includes('hvc1'), smooth: true, powerEfficient: false };
  } };
  await player.prepareVariantSupport();
  assert.equal(player.chooseInitialVariant(), 0);
  assert.equal(checked[1].video.framerate, 30);
  assert.equal(checked[1].video.contentType, 'video/mp4; codecs="hvc1.2.4.L120.90"');
  player.variants = codecFixtures.records[2].variants; player.variantSupport.clear();
  await player.prepareVariantSupport();
  assert.equal(player.chooseInitialVariant(), 0);
  assert.equal(player.variants[player.chooseInitialVariant()].height, 1080);
});

test('Auto mantiene la calidad alta HEVC cuando es soportada y fluida aunque no sea eficiente energéticamente', async () => {
  const { player, context } = decodedFixture();
  context.navigator.connection = { downlink: 100 };
  context.navigator.mediaCapabilities = { decodingInfo: async () => ({ supported: true, smooth: true, powerEfficient: false }) };
  await player.prepareVariantSupport();
  assert.equal(player.chooseInitialVariant(), 1);
});

test('canPlayType negativo excluye sólo el códec verificado; APIs ausentes o rechazadas no inventan incompatibilidad', async () => {
  const { player, video, context } = decodedFixture();
  video.canPlayType = type => type.includes('hvc1') ? '' : 'maybe';
  await player.prepareVariantSupport();
  assert.equal(player.chooseInitialVariant(), 0);
  video.canPlayType = () => 'probably';
  context.navigator.mediaCapabilities = { decodingInfo: async () => { throw new TypeError('unsupported query'); } };
  await player.prepareVariantSupport();
  assert.equal(player.chooseInitialVariant(), 1);
  assert.equal(player.variantSupport.get(1).supported, true);
});

test('ancho de banda y ahorro de datos siguen limitando el coste entre variantes compatibles', () => {
  const { player, context } = decodedFixture();
  context.navigator.connection = { downlink: 1.5 };
  assert.equal(player.chooseInitialVariant(), 0);
  context.navigator.connection = { downlink: 100, saveData: true };
  assert.equal(player.chooseInitialVariant(), 0);
  player.variantSupport.set(0, { supported: false });
  assert.equal(player.chooseInitialVariant(), 1);
});

test('ausencia sostenida de fotogramas con audio/tiempo avanzando cambia de variante una vez y no vuelve a la fallida', () => {
  const { player, tick, events } = decodedFixture();
  const switched = [];
  player.switchVariant = index => switched.push(index);
  player.startFrameMonitor(1);
  for (let i = 0; i < 7; i += 1) tick();
  assert.deepEqual(switched, []);
  for (let i = 0; i < 13; i += 1) tick();
  assert.deepEqual(switched, [0]);
  assert.equal(player.failedVariants.has(1), true);
  player.failedVariants.add(0);
  assert.equal(player.chooseInitialVariant(), -1);
  assert.equal(events.some(event => event?.[0] === 'onDestroy'), false);
});

test('calidad manual no se sustituye al detectar imagen detenida; recuperar imagen requiere la acción del visitante', () => {
  const { player, tick, events } = decodedFixture();
  const switched = [];
  player.autoQuality = false;
  player.switchVariant = index => switched.push(index);
  player.startFrameMonitor(1);
  for (let i = 0; i < 10; i += 1) tick();
  assert.deepEqual(switched, []);
  assert.equal(events.filter(event => event?.[0] === 'recovery').length, 1);
  player.recoverImage();
  assert.deepEqual(switched, [0]);
  assert.equal(player.autoQuality, false);
});

test('escenas oscuras con fotogramas nuevos nunca provocan recuperación', () => {
  const { player, tick, setFrames, events } = decodedFixture();
  player.switchVariant = () => assert.fail('unexpected switch');
  player.startFrameMonitor(1);
  for (let i = 1; i <= 20; i += 1) { setFrames(i * 30); tick(); }
  assert.equal(events.some(event => event?.[0] === 'recovery'), false);
});

test('rVFC que presenta fotogramas impide un falso positivo aunque el contador de calidad falle', () => {
  const { player, video, tick } = decodedFixture();
  let callback;
  video.requestVideoFrameCallback = fn => { callback = fn; return 1; };
  video.cancelVideoFrameCallback = () => {};
  player.switchVariant = () => assert.fail('unexpected switch');
  player.startFrameMonitor(1);
  for (let i = 0; i < 20; i += 1) { callback(); tick(); }
  assert.equal(player.failedVariants.size, 0);
});

test('pausa, pestaña oculta, espera, búsqueda, viewport vacío y PiP no disparan recuperación', () => {
  for (const condition of ['pause', 'hidden', 'waiting', 'seeking', 'offscreen', 'pip']) {
    const { player, video, context, tick, events } = decodedFixture();
    player.switchVariant = () => assert.fail(condition);
    player.startFrameMonitor(1);
    if (condition === 'pause') video.paused = true;
    if (condition === 'hidden') context.document.hidden = true;
    if (condition === 'waiting') player.frameWaiting = true;
    if (condition === 'seeking') video.seeking = true;
    if (condition === 'offscreen') video.getBoundingClientRect = () => ({ top: -1000, bottom: -100, left: 0, right: 100, width: 100, height: 900 });
    if (condition === 'pip') context.document.pictureInPictureElement = video;
    for (let i = 0; i < 20; i += 1) tick();
    assert.equal(events.some(event => event?.[0] === 'recovery'), false, condition);
  }
});

test('sin métricas fiables ofrece recuperación visible y no adivina una avería', () => {
  const { player, video, tick, events } = decodedFixture();
  video.getVideoPlaybackQuality = undefined;
  player.switchVariant = () => assert.fail('unconfirmed switch');
  player.startFrameMonitor(1);
  for (let i = 0; i < 10; i += 1) tick();
  assert.equal(events.filter(event => event?.[0] === 'recovery').length, 1);
  assert.equal(player.failedVariants.size, 0);
});

test('error de decodificación alto intenta otra calidad en Auto y respeta la selección manual', () => {
  for (const auto of [true, false]) {
    const { player, video } = decodedFixture();
    video.error = { code: 3 }; player.autoQuality = auto;
    const changed = [], errors = [];
    player.switchVariant = index => changed.push(index);
    player.showError = message => errors.push(message);
    player.handleMediaError(1);
    assert.deepEqual(changed, auto ? [0] : []);
    assert.equal(errors.length, auto ? 0 : 1);
  }
});

test('destruir cancela el callback de vídeo y las respuestas tardías de compatibilidad', async () => {
  const { player, video, context } = decodedFixture();
  let cancelled = 0, pending = [];
  video.requestVideoFrameCallback = () => 7;
  video.cancelVideoFrameCallback = id => { assert.equal(id, 7); cancelled += 1; };
  player.startFrameMonitor(1);
  context.navigator.mediaCapabilities = { decodingInfo: () => new Promise(resolve => pending.push(resolve)) };
  const preparing = player.prepareVariantSupport();
  player.destroyed = true; player.releaseMedia();
  pending.forEach(resolve => resolve({ supported: true, smooth: true }));
  await preparing;
  assert.equal(cancelled, 1);
  assert.equal(player.variantSupport.size, 0);
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

test('cambiar de calidad cerca del final no reinicia el episodio y acota la posición si el derivado es más corto', () => {
  const { player, video } = fixture();
  player.variants = [{ url: '/low.mp4' }, { url: '/high.mp4' }]; player.variantIndex = 1;
  video.currentTime = 99.7;
  player.switchVariant(0);
  video.currentTime = 0; video.duration = 99.5;
  video.dispatchEvent(new Event('loadedmetadata'));
  assert.equal(video.currentTime, 99.45);
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

test('reintentar HLS conserva el nivel manual hasta que el visitante elige Auto', async () => {
  const { player, video, context } = fixture();
  class Hls {
    static Events = { MANIFEST_PARSED: 'manifest', SUBTITLE_TRACKS_UPDATED: 'subs', ERROR: 'error' };
    static isSupported() { return true; }
    levels = [{ height: 480 }, { height: 1080 }]; handlers = {};
    on(name, callback) { this.handlers[name] = callback; }
    loadSource() {} attachMedia() {} destroy() {}
  }
  context.window.Hls = Hls;
  player.source = { kind: 'HLS', url: 'https://example.com/master.m3u8' };
  player.hls = { autoLevelEnabled: false, loadLevel: 1, destroy() {} };
  player.mountVideo(player.source, { restoreTime: 40, resume: true });
  player.hls.handlers.manifest();
  assert.equal(player.hls.loadLevel, 1);
  video.currentTime = 0;
  video.dispatchEvent(new Event('loadedmetadata'));
  assert.equal(video.currentTime, 40);
  assert.equal(video.playbackRate, 1.5);
});

test('cada build sirve exactamente las versiones instaladas del player sin CDN', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(source.includes(`artplayer-${pkg.dependencies.artplayer}.js`));
  assert.ok(source.includes(`hls-${pkg.dependencies['hls.js']}.js`));
});
