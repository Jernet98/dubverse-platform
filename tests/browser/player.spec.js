import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const mediaRoot = new URL('../fixtures/player-media/', import.meta.url);
const archiveBase = 'https://archive.org/download/dubverse-player-fixture/';
const fallback = 'https://archive.org/embed/dubverse-player-fixture/Episodio%201.mp4';

async function serveMedia(route, name) {
  const body = await readFile(new URL(name, mediaRoot));
  const contentType = name.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : name.endsWith('.vtt') ? 'text/vtt' : 'video/mp4';
  const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range || '');
  if (range) {
    const start = Number(range[1]), end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
    return route.fulfill({ status: 206, contentType, headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${body.length}` }, body: body.subarray(start, end + 1) });
  }
  return route.fulfill({ contentType, headers: { 'Accept-Ranges': 'bytes' }, body });
}

async function prepare(page, { kind = 'DIRECT', initialTime = 3, broken = false, noSource = false, decoderMode = '', freezeHighFrames = false, singleVariant = false, unresolved = false, hangHigh = false } = {}) {
  const analytics = [], progress = [], errors = [], requests = [], heldMedia = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  const direct = '/__player_fixture/episode.mp4';
  const source = kind === 'HLS' ? { kind: 'HLS', url: '/__player_fixture/master.m3u8' }
    : { kind: 'VIDEO', url: kind === 'ARCHIVE' ? `${archiveBase}Episodio%201.mp4` : direct };
  const playback = { provider: kind, source: noSource ? null : source,
    subtitles: [{ url: '/__player_fixture/captions.vtt', language: 'es', label: 'Español' }],
    ...(kind === 'ARCHIVE' ? { identifier: 'dubverse-player-fixture', archive: { orig: 'Episodio 1.mp4' }, fallback: { kind: 'IFRAME', url: fallback },
      variants: [{ name: 'Episodio 1.ia.mp4', url: `${archiveBase}Episodio%201.ia.mp4`, height: 180, estimatedBitrate: 200000 },
        { name: 'Episodio 1.mp4', url: `${archiveBase}Episodio%201.mp4`, height: 360, estimatedBitrate: 400000 }] } : {}) };
  if (decoderMode) playback.variants.forEach((variant, index) => {
    const codec = index ? 'hvc1.2.4.L120.90' : 'avc1.4D401E';
    variant.video = { hasVideo: true, codec, contentType: `video/mp4; codecs="${codec}"`, width: index ? 640 : 320, height: variant.height, framerate: 24 };
  });
  if (singleVariant) playback.variants = [playback.variants.at(-1)];
  if (unresolved) { playback.status = 'UNRESOLVED'; playback.reason = 'NO_VIDEO'; playback.source = null; playback.variants = []; }
  const episode = { id: 'player-ep-1', project_id: 'player-project', season: 1, number: 1, title: 'Episodio de prueba', provider: kind, playback, video_url: source.url,
    project: { id: 'player-project', title: 'Prueba del reproductor' } };
  const next = { ...episode, id: 'player-ep-2', number: 2, title: 'Segundo episodio' };
  const project = { id: 'player-project', title: 'Prueba del reproductor', type: 'SERIES', status: 'ONGOING', synopsis: 'Prueba de integración', published: true, genres: [], episodes: [episode, next], studios: [] };
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    let json = {};
    if (path === '/api/home') json = { site: {}, catalog: { projects: [project], studios: [] }, sections: [] };
    else if (path === '/api/social/config') json = { authAvailable: true, providers: [], mediaAvailable: false };
    else if (path === '/api/social/session') json = { user: { id: 'viewer', username: 'fan', displayName: 'Fan', managedStudios: [] } };
    else if (path === '/api/projects/player-project') json = project;
    else if (path === '/api/episodes/player-ep-1') json = episode;
    else if (path === '/api/episodes/player-ep-2') json = next;
    else if (path === '/api/analytics') { analytics.push(request.postDataJSON()); json = { ok: true }; }
    else if (path.endsWith('/progress')) {
      if (request.method() === 'PUT') { progress.push(request.postDataJSON()); json = { complete: false }; }
      else json = { progress: { positionSeconds: initialTime, durationSeconds: 24 } };
    } else if (/\/api\/social\/episodes\/[^/]+$/.test(path)) json = { likes: 0, viewer: { authenticated: true, liked: false, watched: false }, comments: { items: [], hasMore: false } };
    else if (path === '/api/social/projects/player-project') json = { likes: 0, reviewCount: 0, reviewAverage: 0, viewer: {}, watchedEpisodeIds: [], reviews: { items: [] } };
    await route.fulfill({ json });
  });
  await page.route('**/__player_fixture/**', async route => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1);
    if (broken && name === 'episode.mp4') return route.fulfill({ status: 404, body: '' });
    await serveMedia(route, name);
  });
  await page.route('https://archive.org/download/dubverse-player-fixture/**', async route => {
    if (hangHigh && decodeURIComponent(route.request().url()).endsWith('/Episodio 1.mp4')) { heldMedia.push(route); return; }
    if (broken) return route.fulfill({ status: 404, body: '' });
    await serveMedia(route, 'episode.mp4');
  });
  await page.route('https://archive.org/embed/dubverse-player-fixture/**', route => route.fulfill({ contentType: 'text/html', body: '<html lang="es"><body>Archive iframe fixture</body></html>' }));
  await page.addInitScript(() => localStorage.setItem('dubverse:news:v1.2:hidden', '1'));
  if (decoderMode || freezeHighFrames) await page.addInitScript(({ decoderMode, freezeHighFrames }) => {
    // Deliberate decoder/compositor doubles; native H.264 media still plays.
    // These scenarios test recovery behavior, not the device's HEVC support.
    if (decoderMode) {
      const canPlay = HTMLMediaElement.prototype.canPlayType;
      HTMLMediaElement.prototype.canPlayType = function(type) { return /hvc1/.test(type) ? 'probably' : canPlay.call(this, type); };
      Object.defineProperty(navigator, 'mediaCapabilities', { value: { decodingInfo: async ({ video }) => ({ supported: decoderMode !== 'unsupported-high' || !video.contentType.includes('hvc1'), smooth: true, powerEfficient: false }) } });
    }
    if (freezeHighFrames) {
      const high = video => decodeURIComponent(video.currentSrc || video.src || '').endsWith('/Episodio 1.mp4');
      const quality = HTMLVideoElement.prototype.getVideoPlaybackQuality;
      HTMLVideoElement.prototype.getVideoPlaybackQuality = function() { return high(this) ? { totalVideoFrames: 0, droppedVideoFrames: 0, corruptedVideoFrames: 0 } : quality.call(this); };
      const request = HTMLVideoElement.prototype.requestVideoFrameCallback;
      const cancel = HTMLVideoElement.prototype.cancelVideoFrameCallback;
      let pending = -1;
      HTMLVideoElement.prototype.requestVideoFrameCallback = function(callback) { return high(this) ? pending-- : request.call(this, callback); };
      HTMLVideoElement.prototype.cancelVideoFrameCallback = function(id) { if (id >= 0) cancel.call(this, id); };
    }
  }, { decoderMode, freezeHighFrames });
  if (kind === 'HLS') await page.addInitScript(() => {
    // These projects run Chromium with mobile layouts, not the Safari engine.
    const canPlay = HTMLMediaElement.prototype.canPlayType;
    HTMLMediaElement.prototype.canPlayType = function(type) { return /mpegurl/.test(type) ? '' : canPlay.call(this, type); };
  });
  await page.goto('/ver/player-ep-1');
  return { analytics, progress, errors, requests, playback, releaseHigh: () => Promise.all(heldMedia.splice(0).map(route => serveMedia(route, 'episode.mp4'))) };
}

async function ready(page) {
  await expect(page.locator('.art-video')).toBeAttached();
  await expect.poll(() => page.locator('.art-video').evaluate(video => video.readyState)).toBeGreaterThanOrEqual(2);
}
test('episodio real: MP4, restauración, controles, subtítulos, Analytics, progreso y navegación', async ({ page }, info) => {
  const state = await prepare(page);
  await ready(page);
  await expect.poll(() => page.locator('.art-video').evaluate(video => video.currentTime)).toBeCloseTo(3, 0);
  expect(state.analytics.filter(item => item.eventType === 'PLAY_START')).toHaveLength(0);
  // The center mask starts playback on touch; explicitly invoke the accessible control once.
  await page.getByRole('button', { name: 'Reproducir o pausar', exact: true }).click();
  await expect.poll(() => page.locator('.art-video').evaluate(video => video.currentTime)).toBeGreaterThan(3.1);
  await expect.poll(() => state.analytics.filter(item => item.eventType === 'PLAY_START').length).toBe(1);
  await page.getByRole('button', { name: 'Reproducir o pausar', exact: true }).click();
  await expect.poll(() => page.locator('.art-video').evaluate(video => video.paused)).toBe(true);
  const timeline = page.getByRole('slider', { name: 'Posición del video' });
  await timeline.focus(); await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.locator('.art-video').evaluate(video => video.currentTime)).toBeGreaterThan(8);
  await page.getByRole('button', { name: 'Retroceder 10 segundos', exact: true }).click();
  await expect.poll(() => page.locator('.art-video').evaluate(video => video.currentTime)).toBe(0);
  await page.getByRole('button', { name: 'Ajustes de reproducción', exact: true }).click();
  await page.locator('.art-setting-item[data-name="playback-rate"]').click();
  await page.locator('.art-setting-item[data-name="playback-rate-1.5"]').click();
  await expect.poll(() => page.locator('.art-video').evaluate(video => video.playbackRate)).toBe(1.5);
  await page.evaluate(() => { activePlayer.art.setting.show = false; activePlayer.art.setting.show = true; });
  await page.locator('.art-setting-item[data-name="dv-subtitles"]').click();
  await page.locator('.art-setting-panel.art-current .art-setting-item').filter({ hasText: 'Español' }).click();
  await expect.poll(() => page.locator('.art-video').evaluate(video => [...video.textTracks].some(track => track.mode === 'showing'))).toBe(true);
  await page.evaluate(() => { activePlayer.art.setting.show = false; activePlayer.showControls(); });
  await page.getByRole('button', { name: 'Volumen y silencio', exact: true }).click();
  await expect.poll(() => page.locator('.art-video').evaluate(video => video.muted)).toBe(true);
  await expect(page.locator('.dv-buffer-ranges i').first()).toBeAttached();
  await expect(page.locator('.art-control-progress-inner')).toHaveCSS('height', '5px');
  if (info.project.name === 'desktop') {
    await page.locator('.art-control-fullscreen').click();
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
    await page.locator('.art-control-fullscreen').click();
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
    await page.locator('.art-control-fullscreenWeb').click();
    await expect.poll(() => page.evaluate(() => activePlayer.art.fullscreenWeb)).toBe(true);
    expect(await page.evaluate(() => activePlayer.root.contains(document.elementFromPoint(innerWidth / 2, 10)))).toBe(true);
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => activePlayer.art.fullscreenWeb)).toBe(false);
  }
  const bounds = await page.locator('.art-controls').boundingBox();
  const shell = await page.locator('#dubversePlayer').boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(shell.x - 1);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(shell.x + shell.width + 1);
  for (const control of await page.locator('.art-controls .art-control:visible').all()) {
    const box = await control.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(shell.x - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(shell.x + shell.width + 1);
  }
  await page.locator('#dubversePlayer').screenshot({ path: `.codex-player-${info.project.name}.png` });
  await page.getByRole('link', { name: 'Siguiente →', exact: true }).click();
  await ready(page);
  await expect(page.locator('.watch-title h1')).toHaveText('Segundo episodio');
  await page.getByRole('link', { name: /Volver a/ }).click();
  await expect(page.locator('.art-video')).toHaveCount(0);
  await page.getByRole('link', { name: 'Catálogo', exact: true }).first().click();
  await expect(page.locator('#app')).toContainText('Prueba del reproductor');
  expect(state.errors).toEqual([]);
  expect(state.requests.some(url => /vendor\/player\/hls-/.test(url))).toBe(false);
  expect(state.progress.some(snapshot => snapshot.positionSeconds > 3)).toBe(true);
});

test('Archive: calidad manual conserva video, posición y estado; start no se duplica', async ({ page }) => {
  const state = await prepare(page, { kind: 'ARCHIVE', initialTime: 5 });
  await ready(page);
  await page.getByRole('button', { name: 'Reproducir o pausar', exact: true }).click();
  await expect.poll(() => state.analytics.filter(item => item.eventType === 'PLAY_START').length).toBe(1);
  await page.evaluate(() => { window.__oldVideo = activePlayer.video; activePlayer.video.playbackRate = 1.5; });
  await page.getByRole('button', { name: 'Ajustes de reproducción', exact: true }).click();
  await page.locator('.art-setting-item[data-name="dv-quality"]').click();
  await page.getByRole('button', { name: '180p', exact: true }).click();
  await expect.poll(() => page.evaluate(() => activePlayer.variantIndex)).toBe(0);
  await expect.poll(() => page.locator('.art-video').evaluate(video => !video.paused && video.currentTime > 5 && video.playbackRate === 1.5)).toBe(true);
  expect(await page.evaluate(() => activePlayer.video === window.__oldVideo)).toBe(true);
  // Switching back immediately must not be blocked by an automatic-switch cooldown.
  await page.evaluate(() => activePlayer.switchVariant(1));
  await expect.poll(() => page.evaluate(() => !activePlayer.switching && activePlayer.variantIndex === 1)).toBe(true);
  expect(state.analytics.filter(item => item.eventType === 'PLAY_START')).toHaveLength(1);
  expect(state.errors).toEqual([]);
});

test('Archive rechaza fuentes directas y ofrece iframe exacto sin Analytics ficticios', async ({ page }) => {
  const state = await prepare(page, { kind: 'ARCHIVE', broken: true });
  await expect(page.locator('.dv-player-error')).toBeVisible();
  await page.locator('[data-player-fallback]').click();
  const iframe = page.locator('#dubversePlayer iframe');
  await expect(iframe).toHaveAttribute('src', fallback);
  await expect(page.locator('.art-video')).toHaveCount(0);
  expect(state.analytics.filter(item => item.eventType.startsWith('PLAY_'))).toHaveLength(0);
  expect(state.errors).toEqual([]);
});

test('Archive sin fuente conserva el reproductor compatible existente', async ({ page }) => {
  const state = await prepare(page, { kind: 'ARCHIVE', noSource: true });
  await expect(page.locator('#dubversePlayer iframe')).toHaveAttribute('src', fallback);
  expect(state.requests.some(url => /vendor\/player\//.test(url))).toBe(false);
});

test('Archive sin archivos públicos explica el problema y reconsulta fuentes sin duplicar vista ni sesión', async ({ page }) => {
  const state = await prepare(page, { kind: 'ARCHIVE', unresolved: true });
  await expect(page.locator('.dv-player-error')).toBeVisible();
  await expect(page.locator('[data-player-error-message]')).toContainText('no tiene una fuente de video reproducible');
  await expect(page.locator('#dubversePlayer iframe')).toHaveCount(0);
  expect(state.analytics.filter(event => event.eventType.startsWith('PLAY_'))).toHaveLength(0);
  const views = state.analytics.filter(event => event.eventType === 'EPISODE_VIEW').length;
  state.playback.status = 'READY'; state.playback.source = { kind: 'VIDEO', url: `${archiveBase}Episodio%201.mp4` };
  state.playback.variants = [{ name: 'Episodio 1.mp4', url: state.playback.source.url, height: 360, estimatedBitrate: 400000 }];
  await page.locator('[data-player-retry]').click();
  await ready(page);
  await page.getByRole('button', { name: 'Reproducir o pausar', exact: true }).click();
  await expect.poll(() => state.analytics.filter(event => event.eventType === 'PLAY_START').length).toBe(1);
  expect(state.analytics.filter(event => event.eventType === 'EPISODE_VIEW')).toHaveLength(views);
  expect(state.errors).toEqual([]);
});

test('HLS: manifiesto con variantes, reproducción, selección manual y Auto sin recrear video', async ({ page }) => {
  const state = await prepare(page, { kind: 'HLS', initialTime: 0 });
  await ready(page);
  await page.getByRole('button', { name: 'Reproducir o pausar', exact: true }).click();
  await expect.poll(() => page.locator('.art-video').evaluate(video => video.currentTime)).toBeGreaterThan(.2);
  await page.evaluate(() => { window.__oldVideo = activePlayer.video; });
  await page.evaluate(() => { window.__oldHls = activePlayer.hls; });
  await page.getByRole('button', { name: 'Ajustes de reproducción', exact: true }).click();
  await page.locator('.art-setting-item[data-name="dv-quality"]').click();
  await page.getByRole('button', { name: '180p', exact: true }).click();
  expect(await page.evaluate(() => activePlayer.hls.loadLevel)).toBe(0);
  await page.locator('.art-setting-item[data-name="dv-quality"]').click();
  await page.getByRole('button', { name: 'Auto', exact: true }).click();
  expect(await page.evaluate(() => activePlayer.hls.autoLevelEnabled)).toBe(true);
  expect(await page.evaluate(() => activePlayer.video === window.__oldVideo)).toBe(true);
  const hlsSource = await page.evaluate(() => activePlayer.hls.url);
  expect(hlsSource).toContain('master.m3u8');
  await page.getByRole('link', { name: /Volver a/ }).click();
  await expect(page.locator('.art-video')).toHaveCount(0);
  expect(await page.evaluate(() => window.__oldHls.media === null)).toBe(true);
  expect(state.errors).toEqual([]);
});

test('oculta controles y permite recuperarlos; el final envía completion una sola vez', async ({ page }, info) => {
  const state = await prepare(page, { initialTime: 0 });
  await ready(page);
  await page.getByRole('button', { name: 'Reproducir o pausar', exact: true }).click();
  await page.evaluate(() => document.activeElement.blur());
  await page.mouse.move(0, 0);
  await expect.poll(() => page.evaluate(() => activePlayer.art.controls.show), { timeout: 6000 }).toBe(false);
  if (info.project.name === 'desktop') await page.locator('.art-video').hover();
  else await page.locator('.art-video').tap();
  await expect.poll(() => page.evaluate(() => activePlayer.art.controls.show)).toBe(true);
  if (info.project.name !== 'desktop') {
    const before = await page.locator('.art-video').evaluate(video => video.currentTime);
    const box = await page.locator('.art-video').boundingBox();
    const cdp = await page.context().newCDPSession(page);
    const y = box.y + box.height * .4;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width * .3, y }] });
    for (let i = 1; i <= 5; i += 1) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + box.width * (.3 + i * .05), y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    await expect.poll(() => page.locator('.art-video').evaluate(video => video.currentTime)).toBeGreaterThan(before + 1);
  }
  await page.evaluate(() => { activePlayer.video.currentTime = activePlayer.video.duration - .3; });
  await expect.poll(() => state.analytics.filter(item => item.eventType === 'PLAY_COMPLETE').length).toBe(1);
  expect(state.analytics.filter(item => item.eventType === 'PLAY_START')).toHaveLength(1);
  expect(state.errors).toEqual([]);
});

test('error directo permite reintentar y recupera el episodio', async ({ page }) => {
  const state = await prepare(page, { broken: true });
  await expect(page.locator('.dv-player-error')).toBeVisible();
  await page.route('**/__player_fixture/episode.mp4', route => serveMedia(route, 'episode.mp4'));
  await page.getByRole('button', { name: 'Reintentar', exact: true }).click();
  await ready(page);
  await expect(page.locator('.dv-player-error')).toBeHidden();
  expect(state.errors).toEqual([]);
});

test('Auto filtra el códec rechazado antes de pedir la variante alta', async ({ page }) => {
  const state = await prepare(page, { kind: 'ARCHIVE', decoderMode: 'unsupported-high' });
  await ready(page);
  expect(await page.evaluate(() => activePlayer.variantIndex)).toBe(0);
  expect(state.requests.some(url => decodeURIComponent(url).endsWith('/Episodio 1.mp4'))).toBe(false);
  await page.getByRole('button', { name: 'Reproducir o pausar', exact: true }).click();
  await expect.poll(() => state.analytics.filter(event => event.eventType === 'PLAY_START').length).toBe(1);
  expect(state.errors).toEqual([]);
});

test('Auto conserva calidad alta cuando la consulta de decodificación permite reproducirla', async ({ page }) => {
  const state = await prepare(page, { kind: 'ARCHIVE', decoderMode: 'supported-high' });
  await ready(page);
  expect(await page.evaluate(() => activePlayer.variantIndex)).toBe(1);
  expect(await page.evaluate(() => activePlayer.variantSupport.get(1).supported)).toBe(true);
  expect(state.errors).toEqual([]);
});

test('una conexión lenta conserva la fuente y su precarga sin agotar el detector de decodificación', async ({ page }) => {
  const state = await prepare(page, { kind: 'ARCHIVE', decoderMode: 'supported-high', hangHigh: true, initialTime: 0 });
  await expect(page.locator('.art-video')).toBeAttached();
  await expect.poll(() => page.evaluate(() => activePlayer.stage.inert)).toBe(false);
  await page.getByRole('button', { name: 'Reproducir o pausar', exact: true }).click();
  const before = await page.evaluate(() => {
    const player = activePlayer, video = player.video;
    window.__bufferVideo = video;
    const now = Date.now();
    for (let i = 1; i <= 25; i++) player.checkPlaybackClock(now + i * 1000);
    return { index: player.variantIndex, failed: [...player.failedVariants], wall: player.playbackWatch.wall, preload: video.preload, ready: video.readyState };
  });
  expect(before).toEqual({ index: 1, failed: [], wall: 0, preload: 'auto', ready: 0 });
  expect(state.requests.some(url => decodeURIComponent(url).endsWith('/Episodio 1.ia.mp4'))).toBe(false);
  // Let the same pending request finish; no load(), src change or retry is needed.
  await state.releaseHigh();
  await ready(page);
  await expect.poll(() => page.locator('.art-video').evaluate(video => !video.paused && video.currentTime > .1)).toBe(true);
  expect(await page.evaluate(() => activePlayer.video === window.__bufferVideo)).toBe(true);
  expect(state.analytics.filter(event => event.eventType === 'PLAY_START')).toHaveLength(1);
  expect(state.errors).toEqual([]);
});

test('HEVC único incompatible explica la falta de copia compatible sin pedir el original ni inventar reproducción', async ({ page }) => {
  const state = await prepare(page, { kind: 'ARCHIVE', decoderMode: 'unsupported-high', singleVariant: true });
  await expect(page.locator('.dv-player-error')).toBeVisible();
  await expect(page.locator('[data-player-error-message]')).toContainText('Hace falta una copia de video compatible');
  expect(state.requests.some(url => url.startsWith(archiveBase))).toBe(false);
  expect(state.analytics.filter(event => event.eventType.startsWith('PLAY_'))).toHaveLength(0);
  await page.locator('[data-player-fallback]').click();
  await expect(page.locator('#dubversePlayer iframe')).toHaveAttribute('src', fallback);
  expect(state.errors).toEqual([]);
});

test('fuente única sin imagen detiene audio, explica el fallo y permite el iframe sin duplicar sesión', async ({ page }) => {
  const state = await prepare(page, { kind: 'ARCHIVE', decoderMode: 'supported-high', singleVariant: true, freezeHighFrames: true });
  await ready(page);
  await page.getByRole('button', { name: 'Reproducir o pausar', exact: true }).click();
  await expect(page.locator('.dv-player-error')).toBeVisible({ timeout: 16000 });
  await expect(page.locator('[data-player-error-message]')).toContainText('no hay otra fuente compatible');
  expect(await page.locator('.art-video').evaluate(video => video.paused)).toBe(true);
  // A queued pause/canplay after showError must not hide the explanation.
  await page.evaluate(() => activePlayer.video.dispatchEvent(new Event('canplay')));
  await expect(page.locator('.dv-player-error')).toBeVisible();
  await page.locator('[data-player-fallback]').click();
  await expect(page.locator('#dubversePlayer iframe')).toHaveAttribute('src', fallback);
  await expect(page.locator('.dv-player-recovery')).toBeHidden();
  await expect(page.locator('.art-video')).toHaveCount(0);
  expect(state.analytics.filter(event => event.eventType === 'PLAY_START')).toHaveLength(1);
  expect(state.errors).toEqual([]);
});

test('audio sin fotogramas: Auto recupera imagen, posición, volumen y velocidad sin duplicar Analytics', async ({ page }) => {
  const state = await prepare(page, { kind: 'ARCHIVE', decoderMode: 'supported-high', freezeHighFrames: true });
  await ready(page);
  await page.evaluate(() => { activePlayer.video.volume = .27; activePlayer.video.muted = true; activePlayer.video.playbackRate = 1.5; });
  await page.getByRole('button', { name: 'Reproducir o pausar', exact: true }).click();
  await expect.poll(() => page.evaluate(() => activePlayer.variantIndex), { timeout: 16000 }).toBe(0);
  await expect.poll(() => page.locator('.art-video').evaluate(video => !video.paused && video.currentTime > 8 && video.playbackRate === 1.5 && Math.abs(video.volume - .27) < .01 && video.muted)).toBe(true);
  await expect.poll(() => page.locator('.art-video').evaluate(video => video.getVideoPlaybackQuality().totalVideoFrames)).toBeGreaterThan(0);
  expect(state.analytics.filter(event => event.eventType === 'PLAY_START')).toHaveLength(1);
  expect(new Set(state.analytics.filter(event => event.playbackId).map(event => event.playbackId)).size).toBe(1);
  expect(state.progress.some(snapshot => snapshot.positionSeconds > 3)).toBe(true);
  expect(state.errors).toEqual([]);
});

test('calidad manual se mantiene ante fallo silencioso y ofrece recuperar imagen con una acción', async ({ page }) => {
  const state = await prepare(page, { kind: 'ARCHIVE', decoderMode: 'supported-high', freezeHighFrames: true });
  await ready(page);
  await page.getByRole('button', { name: 'Ajustes de reproducción', exact: true }).click();
  await page.locator('.art-setting-item[data-name="dv-quality"]').click();
  await page.getByRole('button', { name: '360p', exact: true }).click();
  await page.evaluate(() => { activePlayer.art.setting.show = false; });
  await page.getByRole('button', { name: 'Reproducir o pausar', exact: true }).click();
  await expect(page.locator('.dv-player-recovery')).toBeVisible({ timeout: 16000 });
  expect(await page.evaluate(() => ({ index: activePlayer.variantIndex, auto: activePlayer.autoQuality }))).toEqual({ index: 1, auto: false });
  await page.locator('[data-recover-image]').click();
  await expect.poll(() => page.evaluate(() => activePlayer.variantIndex)).toBe(0);
  expect(await page.evaluate(() => activePlayer.autoQuality)).toBe(false);
  expect(state.errors).toEqual([]);
});
