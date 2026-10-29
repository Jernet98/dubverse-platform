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

async function prepare(page, { kind = 'DIRECT', initialTime = 3, broken = false, noSource = false } = {}) {
  const analytics = [], progress = [], errors = [], requests = [];
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
    if (broken) return route.fulfill({ status: 404, body: '' });
    await serveMedia(route, 'episode.mp4');
  });
  await page.route('https://archive.org/embed/dubverse-player-fixture/**', route => route.fulfill({ contentType: 'text/html', body: '<html lang="es"><body>Archive iframe fixture</body></html>' }));
  await page.addInitScript(() => localStorage.setItem('dubverse:news:v1.2:hidden', '1'));
  if (kind === 'HLS') await page.addInitScript(() => {
    // These projects run Chromium with mobile layouts, not the Safari engine.
    const canPlay = HTMLMediaElement.prototype.canPlayType;
    HTMLMediaElement.prototype.canPlayType = function(type) { return /mpegurl/.test(type) ? '' : canPlay.call(this, type); };
  });
  await page.goto('/ver/player-ep-1');
  return { analytics, progress, errors, requests, playback };
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

test('Archive rechaza fuentes directas y conserva iframe exacto sin Analytics ficticios', async ({ page }) => {
  const state = await prepare(page, { kind: 'ARCHIVE', broken: true });
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
