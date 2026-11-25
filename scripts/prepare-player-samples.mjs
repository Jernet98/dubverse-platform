// Two short, local QA samples. No chapter downloads, uploads or source changes.
import { createServer } from 'node:http';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
const args = process.argv.slice(2), arg = name => args.includes(name) ? args[args.indexOf(name) + 1] : '';
const ffmpeg = arg('--ffmpeg') || 'ffmpeg', ffprobe = arg('--ffprobe') || 'ffprobe';
const audit = JSON.parse(await readFile('docs/player-catalog-audit-2026-11-24.json', 'utf8'));
const jobs = [1,4].map(number => {
  const record = audit.records.find(record => record.episodeId === `black-butler-book-of-circus-s01-e00${number}`);
  const variant = record.variants.find(variant => variant.name === record.original);
  return { id: `bb${number}`, url: variant.url, originalMd5: variant.md5, start: 30,
    output: `.codex-player-compatible-samples/bb${number}-h264-1080.mp4` };
});
if (!args.includes('--prepare')) { console.log(JSON.stringify({ mode: 'plan-only', duration: 12, byteLimitPerSource: 16 * 1024 * 1024, jobs }, null, 2)); process.exit(0); }
for (const job of jobs) {
  if (new URL(job.url).hostname !== 'archive.org') throw Error('Unexpected sample source.');
  try { await access(job.output); throw Error(`Refusing to overwrite: ${job.output}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
await mkdir('.codex-player-compatible-samples', { recursive: true });
const limit = 16 * 1024 * 1024, bytes = new Map(jobs.map(job => [job.id, 0])), requests = [];
function run(command, parameters, timeout) {
  return new Promise((resolve, reject) => {
    const process = spawn(command, parameters, { windowsHide: true });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => process.kill(), timeout);
    process.stdout.on('data', chunk => stdout += chunk);
    process.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-6000); });
    process.on('error', error => { clearTimeout(timer); reject(error); });
    process.on('close', code => { clearTimeout(timer); code === 0 ? resolve(stdout) : reject(Error(stderr)); });
  });
}
const server = createServer(async (request, response) => {
  const job = jobs.find(job => `/${job.id}.mp4` === new URL(request.url, 'http://localhost').pathname);
  if (!job || request.method !== 'GET') { response.writeHead(404); response.end(); return; }
  try {
    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || 'bytes=0-');
    if (!range || bytes.get(job.id) >= limit) throw Error('Invalid range or sample byte budget reached.');
    const start = Number(range[1]), end = Math.min(range[2] ? Number(range[2]) : Infinity, start + 2 * 1024 * 1024 - 1);
    const upstream = await fetch(job.url, { headers: { Range: `bytes=${start}-${end}` }, signal: AbortSignal.timeout(30000) });
    const contentRange = upstream.headers.get('content-range'), match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange || '');
    if (upstream.status !== 206 || !match || Number(match[1]) !== start || Number(match[2]) > end) { await upstream.body?.cancel(); throw Error('Origin did not honor bounded Range.'); }
    requests.push({ id: job.id, range: contentRange });
    response.writeHead(206, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Range': contentRange, 'Content-Length': Number(match[2]) - start + 1 });
    const reader = upstream.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        bytes.set(job.id, bytes.get(job.id) + value.length);
        if (bytes.get(job.id) > limit) throw Error('Sample byte budget exceeded.');
        if (response.destroyed) break;
        response.write(Buffer.from(value));
      }
      response.end();
    } finally { await reader.cancel().catch(() => {}); }
  } catch (error) {
    if (!response.headersSent) response.writeHead(502);
    response.end(); requests.push({ id: job.id, error: error.message });
  }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(4180, '127.0.0.1', resolve); });
const result = [];
try {
  for (const job of jobs) {
    await run(ffmpeg, ['-n','-hide_banner','-loglevel','warning','-ss',String(job.start),'-i',`http://127.0.0.1:4180/${job.id}.mp4`,
      '-t','12','-map','0:v:0','-map','0:a:0?','-c:v','libx264','-profile:v','high','-level:v','4.1','-pix_fmt','yuv420p','-r','30',
      '-preset','fast','-crf','18','-c:a','aac','-ac','2','-b:a','160k','-movflags','+faststart',job.output], 90000);
    const probe = JSON.parse(await run(ffprobe, ['-v','error','-show_streams','-show_format','-of','json',job.output], 15000));
    const video = probe.streams.find(stream => stream.codec_type === 'video');
    if (video?.codec_name !== 'h264' || video.pix_fmt !== 'yuv420p' || video.height !== 1080 || Math.abs(Number(probe.format.duration) - 12) > .5) throw Error(`Sample validation failed: ${job.id}`);
    result.push({ ...job, duration: 12, upstreamBytes: bytes.get(job.id), byteLimit: limit, probe });
    await writeFile('.codex-player-compatible-samples/evidence.json', JSON.stringify({ result, requests }, null, 2));
    console.log(`Prepared ${job.id}: 12s H.264 1080p; read ${bytes.get(job.id)} bytes from original.`);
  }
} finally { server.close(); server.closeAllConnections(); }
