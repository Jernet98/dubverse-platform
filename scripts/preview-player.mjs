// Isolated player lab: serves only an explicit static allowlist, never Next,
// .env, database modules, account APIs, or production Analytics endpoints.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, copyFile, open, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { mp4VideoInfo } from '../lib/media-probe.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = name => args.includes(name) ? args[args.indexOf(name) + 1] : '';
const input = arg('--input') || 'docs/player-media-audit-2026-11-22.json';
const port = Number(arg('--port')) || 4173;
const host = args.includes('--lan') ? '0.0.0.0' : '127.0.0.1';
const report = JSON.parse(await readFile(resolve(root, input), 'utf8'));
const episodes = report.records.filter(record => record.provider !== 'PIXELDRAIN' && record.variants?.length).map(record => ({
  id: record.episodeId, title: `${record.projectTitle || record.projectId} · T${record.season || 1} E${record.number || record.episodeId.match(/e(\d+)$/)?.[1] || ''}`,
  playback: { provider: 'ARCHIVE', identifier: record.identifier,
    source: { kind: 'VIDEO', url: record.variants.at(-1).url },
    variants: record.variants.map(({ url, name, width, height, size, length, estimatedBitrate, video }) => ({ url, name, width, height, size, length, estimatedBitrate, video })),
    fallback: { kind: 'IFRAME', url: `https://archive.org/embed/${encodeURIComponent(record.identifier)}/${encodeURIComponent(record.original).replace(/%2F/g, '/')}` } }
}));
const files = new Map([
  ['/', ['preview/player/index.html', 'text/html; charset=utf-8']],
  ['/preview.js', ['preview/player/preview.js', 'text/javascript; charset=utf-8']],
  ['/player.js', ['public/player.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['public/styles.css', 'text/css; charset=utf-8']],
  ['/vendor/player/artplayer-5.4.0.js', ['public/vendor/player/artplayer-5.4.0.js', 'text/javascript; charset=utf-8']],
  ['/vendor/player/artplayer-es-5.4.0.js', ['public/vendor/player/artplayer-es-5.4.0.js', 'text/javascript; charset=utf-8']],
  ['/vendor/player/hls-1.7.4.js', ['public/vendor/player/hls-1.7.4.js', 'text/javascript; charset=utf-8']]
]);
if (args.includes('--samples')) for (const [name, number] of [['bb1', 1], ['bb4', 4]]) {
  const path = `.codex-player-compatible-samples/${name}-h264-1080.mp4`;
  const file = await open(resolve(root, path), 'r');
  const buffer = Buffer.alloc(16384);
  let length;
  try { ({ bytesRead: length } = await file.read(buffer, 0, buffer.length, 0)); } finally { await file.close(); }
  const video = mp4VideoInfo(buffer.subarray(0, length));
  const url = `/samples/${name}-h264-1080.mp4`;
  if (!video?.codec) throw Error(`Sample codec not verified: ${path}`);
  files.set(url, [path, 'video/mp4']);
  episodes.push({ id: `black-butler-e${number}-h264-sample`, title: `Black Butler E${number} · Fragmento H.264 1080p (12 segundos)`, sample: true,
    playback: { provider: 'DIRECT', source: { kind: 'VIDEO', url, video, estimatedBitrate: (await stat(resolve(root, path))).size * 8 / 12 }, fallback: null } });
}
const catalog = JSON.stringify({ inspectedAt: report.inspectedAt, episodes });
if (args.includes('--export')) {
  const output = resolve(root, '.codex-player-preview');
  for (const [url, [path]] of files) {
    const destination = resolve(output, url === '/' ? 'index.html' : `.${url}`);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(resolve(root, path), destination);
  }
  await writeFile(resolve(output, 'catalog.json'), catalog);
  // Exported lab can be hosted on a separate static site with no API runtime.
  await writeFile(resolve(output, 'vercel.json'), JSON.stringify({ framework: null, buildCommand: '', outputDirectory: '.', headers: [{ source: '/(.*)', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] }] }, null, 2));
  console.log(`Static isolated lab exported to ${output}`);
} else {
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Robots-Tag', 'noindex, nofollow');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405); response.end(); return; }
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/catalog.json') { response.setHeader('Content-Type', 'application/json'); response.end(request.method === 'HEAD' ? '' : catalog); return; }
    const asset = files.get(path);
    if (!asset) { response.writeHead(404); response.end(); return; }
    try {
      response.setHeader('Content-Type', asset[1]);
      if (asset[1] === 'video/mp4') {
        const filePath = resolve(root, asset[0]), { size } = await stat(filePath);
        response.setHeader('Accept-Ranges', 'bytes');
        const range = request.headers.range, match = range && /^bytes=(\d*)-(\d*)$/.exec(range);
        const start = match ? (match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]))) : 0;
        const end = match?.[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
        if (range && (!match || (!match[1] && !match[2]) || start > end || start >= size)) { response.writeHead(416, { 'Content-Range': `bytes */${size}` }); response.end(); return; }
        response.setHeader('Content-Length', end - start + 1);
        if (range) response.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${size}` });
        if (request.method === 'HEAD') response.end();
        else createReadStream(filePath, { start, end }).on('error', () => response.destroy()).pipe(response);
      } else { const data = await readFile(resolve(root, asset[0])); response.end(request.method === 'HEAD' ? '' : data); }
    }
    catch { response.writeHead(404); response.end(); }
  });
  server.listen(port, host, () => {
    console.log(`Isolated player lab: http://127.0.0.1:${port} (${episodes.length} episodes)`);
    if (host === '0.0.0.0') for (const addresses of Object.values(networkInterfaces())) for (const address of addresses || []) {
      if (address.family === 'IPv4' && !address.internal) console.log(`LAN: http://${address.address}:${port}`);
    }
    console.log('No account APIs, production Analytics, environment files or database access.');
  });
}
