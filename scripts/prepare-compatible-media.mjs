// Local preparation only. Never downloads, uploads, edits Archive or the DB.
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join, dirname, sep } from 'node:path';
import { spawn } from 'node:child_process';
import mappings from '../config/archive-compatible-variants.js';

const args = process.argv.slice(2), arg = name => args.includes(name) ? args[args.indexOf(name) + 1] : '';
const sourceRoot = arg('--source-root');
const outputRoot = resolve(arg('--output-root') || '.codex-player-compatible-media');
const ffmpeg = arg('--ffmpeg') || 'ffmpeg', ffprobe = arg('--ffprobe') || 'ffprobe';
const encode = args.includes('--encode');
const preset = arg('--preset') || 'slow';
if (!['fast','medium','slow'].includes(preset)) throw Error('--preset must be fast, medium or slow; CRF 18 and the output compatibility constraints are unchanged.');
const manifestInput = arg('--manifest') ? JSON.parse(await readFile(arg('--manifest'), 'utf8')) : mappings;
const manifest = Array.isArray(manifestInput) ? manifestInput : manifestInput.jobs;
if (!Array.isArray(manifest)) throw Error('A manifest must contain an array of reviewed jobs.');
const selected = arg('--episodes') ? new Set(arg('--episodes').split(',')) : null;
const jobs = manifest.filter(item => !selected || selected.has(item.episodeId)).map(item => ({ episodeId: item.episodeId, identifier: item.identifier, original: item.original, originalMd5: item.originalMd5, output: item.files[0].name }));
if (!jobs.length || selected && jobs.length !== selected.size) throw Error('Every --episodes ID must match exactly one reviewed job.');
if (!encode) {
  console.log(JSON.stringify({ mode: 'plan-only', outputRoot, jobs, next: 'Place authorized originals under <source-root>/<identifier>/<original>; review SDR/color, then run with --encode. No file was transcoded or published.' }, null, 2));
  process.exit(0);
}
if (!sourceRoot) throw Error('--source-root is required; inputs must already exist locally and be authorized.');
function run(command, parameters) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, parameters, { windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', value => { stdout += value; });
    child.stderr.on('data', value => { stderr = (stderr + value).slice(-12000); });
    child.on('error', reject); child.on('close', code => code === 0 ? resolve(stdout) : reject(Error(`${command}: exit ${code}\n${stderr}`)));
  });
}
const probe = async path => JSON.parse(await run(ffprobe, ['-v','error','-show_streams','-show_format','-of','json',path]));
async function md5(path) { const hash = createHash('md5'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex'); }
const plan = [];
for (const job of jobs) {
  const source = join(resolve(sourceRoot), job.identifier, job.original), output = join(outputRoot, job.output);
  if (!resolve(source).toLowerCase().startsWith((resolve(sourceRoot) + sep).toLowerCase()) || dirname(resolve(output)) !== outputRoot) throw Error('Manifest paths must stay inside the input and output roots.');
  await access(source);
  if (!/^[a-f0-9]{32}$/i.test(job.originalMd5 || '') || await md5(source) !== job.originalMd5.toLowerCase()) throw Error(`Original hash mismatch; verify the exact episode before encoding: ${source}`);
  try { await access(output); throw Error(`Output exists; refusing to overwrite: ${output}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const before = await probe(source), video = before.streams.find(stream => stream.codec_type === 'video');
  if (!video) throw Error(`No video track: ${source}`);
  const transfer = video.color_transfer;
  if (['smpte2084','arib-std-b67'].includes(transfer)) throw Error(`HDR requires a separately reviewed color/tone-mapping plan: ${source}`);
  if ((!transfer || transfer === 'unknown') && !args.includes('--assume-sdr')) throw Error(`SDR is unconfirmed for ${source}; review it before explicitly using --assume-sdr.`);
  if (before.streams.some(stream => stream.codec_type === 'subtitle')) throw Error(`Review embedded subtitles before converting ${source}; the script will not silently discard them.`);
  const [frames, seconds] = String(video.avg_frame_rate || '').split('/').map(Number), fps = frames / seconds;
  if (!(fps > 0 && fps <= 60)) throw Error(`Unverified frame rate: ${source}`);
  if (!(video.width > 0 && video.height > 0)) throw Error(`Unverified dimensions: ${source}`);
  const [sarWidth, sarHeight] = String(video.sample_aspect_ratio || '1:1').split(':').map(Number);
  const sar = sarWidth > 0 && sarHeight > 0 ? sarWidth / sarHeight : 1;
  const width = video.width * sar, factor = Math.min(1, 1920 / width, 1080 / video.height);
  const targetWidth = Math.max(2, Math.floor(width * factor / 2) * 2), targetHeight = Math.max(2, Math.floor(video.height * factor / 2) * 2);
  plan.push({ ...job, source, output, before, targetWidth, targetHeight, level: '4.1', frameRate: fps <= 30 ? video.avg_frame_rate : '30' });
}
// All inputs are checked before encoding the first file. -n additionally protects
// against overwriting a file created after this preflight.
await mkdir(outputRoot, { recursive: true });
const results = [];
for (const job of plan) {
  console.log(`Preparing ${job.episodeId} locally…`);
  await run(ffmpeg, ['-n','-hide_banner','-loglevel','warning','-i',job.source,
    '-map','0:v:0','-map','0:a:0?','-vf',`scale=${job.targetWidth}:${job.targetHeight},setsar=1`,
    '-r',job.frameRate,'-c:v','libx264','-profile:v','high','-level:v',job.level,'-pix_fmt','yuv420p','-preset',preset,'-crf','18','-maxrate','16M','-bufsize','32M',
    '-c:a','aac','-ac','2','-b:a','160k','-movflags','+faststart',job.output]);
  const after = await probe(job.output), video = after.streams.find(stream => stream.codec_type === 'video');
  const durationDifference = Math.abs(Number(after.format.duration) - Number(job.before.format.duration));
  if (video?.codec_name !== 'h264' || video.pix_fmt !== 'yuv420p' || durationDifference > 1) throw Error(`Output verification failed; keep it unpublished and inspect ${job.output}`);
  results.push({ episodeId: job.episodeId, identifier: job.identifier, original: job.original, originalMd5: job.originalMd5, output: job.output, md5: await md5(job.output), after, durationDifference, preset, crf: 18, publication: 'NOT_PUBLISHED', physicalDeviceVerification: 'PENDING' });
  await writeFile(join(outputRoot, 'preparation-report.json'), JSON.stringify(results, null, 2));
}
console.log('Local copies prepared. Validate image, audio, color, subtitles and real phones before requesting publication. Nothing was uploaded or linked.');
