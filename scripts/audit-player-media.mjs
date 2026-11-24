// Read-only public-source audit. No credentials, database access or write APIs.
import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolveArchivePlaylist, archivePlaybackVariants, configuredArchiveSources } from '../lib/archive.js';
import { inspectMp4Video } from '../lib/media-probe.js';
import { createAuditFetch } from './lib/audit-fetch.mjs';

const args = process.argv.slice(2);
const argument = name => args.includes(name) ? args[args.indexOf(name) + 1] : '';
const site = 'https://dubversefandub.vercel.app';
const output = argument('--output') || '.codex-player-audit-report.json';
const ffprobe = argument('--ffprobe');
const playerUrl = argument('--player-url');
const catalog = args.includes('--catalog');
const snapshotPath = argument('--snapshot');
const resumePath = argument('--resume');
const fetch = createAuditFetch({ dnsServer: argument('--dns-server') || undefined });
const budgetMs = Math.max(1, Math.min(60, Number(argument('--budget-minutes')) || 10)) * 60000;
const selectedEpisodes = argument('--episode').split(',').filter(Boolean);
if (playerUrl && !['127.0.0.1','localhost','[::1]'].includes(new URL(playerUrl).hostname)) throw new Error('--player-url must be a local test server.');
const report = { inspectedAt: new Date().toISOString(), site, scope: catalog ? 'public-catalog' : 'reported-projects', projects: [], errors: [], records: [] };
const json = async url => {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`${response.status}: ${url}`);
      return await response.json();
    } catch (error) { lastError = error; }
  }
  throw lastError;
};
async function workers(values, callback) {
  let next = 0;
  await Promise.all([0,1,2].map(async () => { while (next < values.length) await callback(values[next++]); }));
}
const snapshot = snapshotPath ? JSON.parse(await readFile(snapshotPath, 'utf8')) : null;
const previous = resumePath ? JSON.parse(await readFile(resumePath, 'utf8')) : null;
const projectList = catalog ? (snapshot?.home?.catalog?.projects || await json(`${site}/api/projects`)) : ['black-butler-book-of-circus','mikadono-sanshimai-wa-angai-choroi'].map(id => ({ id }));
report.catalogInspectedAt = snapshot?.inspectedAt || report.inspectedAt;
const items = new Map();
await workers(projectList, async ({ id: projectId }) => {
  let project;
  try { project = snapshot?.projects.find(project => project.id === projectId) || await json(`${site}/api/projects/${projectId}`); }
  catch (error) { report.errors.push({ projectId, error: error.message }); return; }
  report.projects.push({ id: project.id, title: project.title, episodeCount: project.episodes.length });
  for (const episode of project.episodes) {
    if (selectedEpisodes.length && !selectedEpisodes.includes(episode.id)) continue;
    const identifier = episode.archive_identifier;
    const record = { projectId, projectTitle: project.title, episodeId: episode.id, title: episode.title, season: episode.season, number: episode.number, provider: episode.provider, identifier, file: episode.archive_file, variants: [] };
    report.records.push(record);
    if (episode.provider !== 'ARCHIVE') {
      record.status = 'EXTERNAL_PROVIDER'; record.externalUrl = episode.video_url;
      continue;
    }
    const prior = previous?.records.find(item => item.episodeId === record.episodeId && item.identifier === identifier && item.file === record.file);
    try {
      if (!items.has(identifier)) items.set(identifier, json(`https://archive.org/metadata/${encodeURIComponent(identifier)}`).catch(error => ({ auditError: error.message })));
      const item = await items.get(identifier);
      if (item.auditError) throw new Error(item.auditError);
      const playlist = resolveArchivePlaylist(item.files, episode.archive_file);
      const selected = configuredArchiveSources(episode, identifier, playlist.selected, item);
      Object.assign(record, { status: playlist.status, original: playlist.selected?.orig, entryCount: playlist.entries.length,
        metadataFileCount: item.files?.length || 0,
        publicFileList: Array.isArray(item.files), isDark: Boolean(item.is_dark),
        groupedSources: playlist.selected?.sources.filter(file => /\.(?:mp4|m4v|webm|ogv|mkv)$/i.test(file.name)).map(file => ({ name: file.name, format: file.format, source: file.source, original: file.original })) || [],
        variants: archivePlaybackVariants(identifier, selected, item.metadata).map(variant => {
          const file = selected.sources.find(file => file.name === variant.name);
          const known = prior?.variants.find(previous => previous.url === variant.url && previous.md5 && previous.md5 === file.md5 && previous.size === variant.size);
          return { ...variant, original: playlist.selected.orig, archiveOriginal: file.original || null, md5: file.md5,
            ...(known ? { video: known.video, http: known.http, probedAt: known.probedAt, codecEvidence: known.codecEvidence, evidenceInspectedAt: known.evidenceInspectedAt || previous.inspectedAt } : {}) };
        }) });
    } catch (error) { record.status = 'INSPECTION_FAILED'; record.error = error.message; }
  }
  console.log(`${projectId}: ${project.episodes.length} episodios públicos`);
});
report.records.sort((a, b) => a.projectId.localeCompare(b.projectId) || a.season - b.season || a.number - b.number);

function runProbe(url) {
  return new Promise(resolve => {
    const proc = spawn(ffprobe, ['-v','error','-rw_timeout','12000000','-probesize','1048576','-analyzeduration','1000000','-show_entries','stream=index,codec_type,codec_name,codec_tag_string,profile,level,width,height,pix_fmt,bits_per_raw_sample,r_frame_rate,avg_frame_rate,bit_rate:format=duration,bit_rate,size','-of','json',url], { windowsHide: true });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => proc.kill(), 40000);
    proc.stdout.on('data', data => stdout += data);
    proc.stderr.on('data', data => stderr += data);
    proc.on('error', error => { clearTimeout(timer); resolve({ error: error.message }); });
    proc.on('close', code => {
      clearTimeout(timer);
      try { resolve({ code, ...JSON.parse(stdout), stderr }); }
      catch { resolve({ code, error: stderr || 'No result before timeout' }); }
    });
  });
}

if (selectedEpisodes.length) report.records = report.records.filter(record => selectedEpisodes.includes(record.episodeId));
// Shared URLs are probed once even if several published records use them.
const variants = [...new Map(report.records.flatMap(record => record.variants).map(variant => [variant.url, variant])).values()];
variants.sort((a, b) => String(a.probedAt || '').localeCompare(String(b.probedAt || '')));
const deadline = Date.now() + budgetMs;
let deferred = 0;
let inspected = 0, checkpoint = Promise.resolve();
await workers(variants, async variant => {
  if (variant.video?.codec && variant.http?.status === 206) return;
  if (Date.now() >= deadline) { deferred++; return; }
  const started = Date.now();
  const attempts = catalog ? 2 : 1;
  variant.httpAttempts = [];
  for (let attempt = 1; attempt <= attempts; attempt++) try {
    variant.http = null;
    variant.video = await inspectMp4Video(variant.url, { timeoutMs: catalog ? 20000 : 2200, fetchImpl: async (url, options) => {
      try {
        const response = await fetch(url, { ...options, headers: { ...options.headers, Origin: site } });
        variant.http ||= { status: response.status, finalUrl: response.url, contentRange: response.headers.get('content-range'), contentType: response.headers.get('content-type'), cors: response.headers.get('access-control-allow-origin'), elapsedMs: Date.now() - started };
        return response;
      } catch (error) { variant.http ||= { error: error.message }; throw error; }
    } });
    variant.httpAttempts.push({ attempt, ...variant.http });
    if (variant.video?.codec) break;
  } catch (error) { variant.http = { error: error.message }; variant.httpAttempts.push({ attempt, ...variant.http }); }
  if (ffprobe) variant.ffprobe = await runProbe(variant.url);
  variant.probedAt = new Date().toISOString();
  console.log(`${variant.name}: ${variant.video?.codec || 'codec unknown'}; Range ${variant.http?.status || 'unavailable'}`);
  if (++inspected % 20 === 0) {
    const data = JSON.stringify(report, null, 2);
    checkpoint = checkpoint.then(() => writeFile(`${output}.partial`, data));
    await checkpoint;
  }
});
const byUrl = new Map(variants.map(variant => [variant.url, variant]));
for (const record of report.records) for (const variant of record.variants) {
  const measured = byUrl.get(variant.url);
  Object.assign(variant, { video: measured.video, http: measured.http, probedAt: measured.probedAt, httpAttempts: measured.httpAttempts, ...(measured.ffprobe ? { ffprobe: measured.ffprobe } : {}) });
}
report.summary = {
  projectCount: report.projects.length, episodeCount: report.records.length, uniqueVariantCount: variants.length,
  codecs: variants.reduce((counts, variant) => { const codec = variant.video?.codec || 'UNKNOWN'; counts[codec] = (counts[codec] || 0) + 1; return counts; }, {}),
  unresolved: report.records.filter(record => record.status !== 'READY').map(record => ({ episodeId: record.episodeId, status: record.status })),
  duplicateSources: variants.map(variant => ({ url: variant.url, episodeIds: report.records.filter(record => record.variants.some(item => item.url === variant.url)).map(record => record.episodeId) })).filter(item => item.episodeIds.length > 1)
};
report.summary.deferredByBudget = deferred;
report.summary.note = 'Unmeasured codecs and unavailable sources remain pending; this report never certifies physical-device playback.';

if (args.includes('--browser') || playerUrl) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ channel: process.env.PLAYER_BROWSER_CHANNEL || 'chrome', headless: true });
  const browserVersion = browser.version();
  report.browser = { engine: 'Chromium', browserVersion, os: process.platform, physicalMobileDevice: false, muted: true };
  let next = 0;
  if (args.includes('--browser')) await Promise.all([0,1].map(async () => {
    while (next < variants.length) {
      const variant = variants[next++];
      const page = await browser.newPage();
      // Secure origin for MediaCapabilities, with every site request intercepted:
      // this minimal native-video page never runs Dubverse Analytics or auth.
      await page.route(`${site}/**`, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body style="margin:0;background:#111"><video muted playsinline style="width:800px;height:450px"></video></body></html>' }));
      try {
        await page.goto(site);
        variant.browser = await page.evaluate(async ({ url, info, bitrate }) => {
          const video = document.querySelector('video'); video.muted = true; video.preload = 'metadata';
          let frames = 0, playError = null, frameId;
          const presented = () => { frames += 1; frameId = video.requestVideoFrameCallback(presented); };
          if (video.requestVideoFrameCallback) frameId = video.requestVideoFrameCallback(presented);
          const canPlayType = info?.contentType ? video.canPlayType(info.contentType) : null;
          let capabilities = null;
          if (info?.contentType && info.framerate && navigator.mediaCapabilities) {
            try {
              capabilities = await navigator.mediaCapabilities.decodingInfo({ type: 'file', video: { contentType: info.contentType, width: info.width, height: info.height, framerate: info.framerate, bitrate } });
            } catch (error) { capabilities = { error: error.message }; }
          }
          video.src = url;
          await Promise.race([video.play().catch(error => { playError = error.name; }), new Promise(resolve => setTimeout(resolve, 12000))]);
          const startTime = video.currentTime;
          await new Promise(resolve => setTimeout(resolve, 5000));
          const quality = video.getVideoPlaybackQuality?.();
          const result = { canPlayType, capabilities: capabilities && { supported: capabilities.supported, smooth: capabilities.smooth, powerEfficient: capabilities.powerEfficient, error: capabilities.error }, startTime, endTime: video.currentTime, presentedCallbacks: frames, totalVideoFrames: quality?.totalVideoFrames, droppedVideoFrames: quality?.droppedVideoFrames, width: video.videoWidth, height: video.videoHeight, readyState: video.readyState, mediaError: video.error?.code || null, playError };
          if (frameId !== undefined) video.cancelVideoFrameCallback?.(frameId);
          video.pause(); video.removeAttribute('src'); video.load();
          return result;
        }, { url: variant.url, info: variant.video, bitrate: variant.estimatedBitrate });
        console.log(`${variant.name}: native Chrome time=${variant.browser.endTime.toFixed(2)}, frames=${variant.browser.presentedCallbacks}, error=${variant.browser.mediaError}`);
      } catch (error) { variant.browser = { error: error.message }; }
      finally { await page.close(); }
    }
  }));
  if (playerUrl) {
    for (const record of report.records) {
      if (!record.variants.length) continue;
      const project = await json(`${site}/api/projects/${record.projectId}`);
      const episode = await json(`${site}/api/episodes/${record.episodeId}`);
      episode.playback = { ...episode.playback, provider: 'ARCHIVE', identifier: record.identifier,
        source: { kind: 'VIDEO', url: record.variants.at(-1).url }, variants: record.variants };
      const page = await browser.newPage({ viewport: { width: 1365, height: 900 } });
      const events = [], errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/**', async route => {
        const path = new URL(route.request().url()).pathname;
        let value = {};
        if (path === '/api/home') value = { site: {}, catalog: { projects: [project], studios: [] }, sections: [] };
        else if (path === `/api/projects/${record.projectId}`) value = project;
        else if (path === `/api/episodes/${record.episodeId}`) value = episode;
        else if (path === '/api/social/config') value = { authAvailable: false, providers: [], mediaAvailable: false };
        else if (path === '/api/social/session') value = { user: null };
        else if (path === `/api/social/episodes/${record.episodeId}`) value = { likes: 0, viewer: { authenticated: false }, comments: { items: [], hasMore: false } };
        else if (path === '/api/analytics') { events.push(route.request().postDataJSON()); value = { ok: true }; }
        await route.fulfill({ json: value });
      });
      try {
        await page.goto(`${playerUrl.replace(/\/$/, '')}/ver/${encodeURIComponent(record.episodeId)}`);
        await page.waitForFunction(() => typeof activePlayer !== 'undefined' && activePlayer?.video?.readyState >= 2, undefined, { timeout: 20000 });
        await page.evaluate(() => { activePlayer.video.muted = true; });
        await page.getByRole('button', { name: 'Reproducir o pausar', exact: true }).click();
        await page.waitForFunction(() => activePlayer.video?.currentTime > .1, undefined, { timeout: 15000 });
        await page.waitForTimeout(5000);
        record.playerBrowser = await page.evaluate(() => ({
          artplayerVersion: Artplayer.version, source: activePlayer.source?.url,
          variantIndex: activePlayer.variantIndex, auto: activePlayer.autoQuality, position: activePlayer.video?.currentTime,
          width: activePlayer.video?.videoWidth, height: activePlayer.video?.videoHeight,
          presentedCallbacks: activePlayer.frameMonitor?.callbacks,
          downlink: navigator.connection?.downlink,
          variantSupport: [...activePlayer.variantSupport],
          totalVideoFrames: activePlayer.video?.getVideoPlaybackQuality?.().totalVideoFrames,
          mediaError: activePlayer.video?.error?.code || null, fallbackUsed: Boolean(activePlayer.fallbackUsed)
        }));
        await page.locator('#dubversePlayer').screenshot({ path: `.codex-player-audit-${record.episodeId.replace(/[^a-z0-9-]/gi, '_')}.png` });
        await page.evaluate(() => activePlayer.destroy());
        record.playerBrowser.analytics = events.map(event => event.eventType);
        record.playerBrowser.errors = errors;
        console.log(`${record.episodeId}: ArtPlayer ${record.playerBrowser.height}p, frames=${record.playerBrowser.presentedCallbacks}, start=${events.filter(event => event.eventType === 'PLAY_START').length}`);
      } catch (error) { record.playerBrowser = { error: error.message, errors }; }
      finally { await page.close(); }
    }
  }
  await browser.close();
}

await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Public audit saved: ${output}`);
