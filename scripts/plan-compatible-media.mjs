// Creates a local review plan only. No network requests, uploads or DB writes.
import { readFile, writeFile } from 'node:fs/promises';
import existing from '../config/archive-compatible-variants.js';
const args = process.argv.slice(2), arg = name => args.includes(name) ? args[args.indexOf(name) + 1] : '';
const audit = JSON.parse(await readFile(arg('--input') || 'docs/player-catalog-audit-2026-11-24.json', 'utf8'));
const output = arg('--output') || '.codex-player-compatible-plan.json';
const incorrect = new Set(['mao-2026-s01-e018','mao-2026-s01-e020','mao-2026-s01-e022','uma-musume-pretty-derby-s01-e002','uma-musume-pretty-derby-s01-e003']);
const common = variant => variant.video?.codecName === 'h264' && [66,77,100].includes(variant.video.profileId)
  && variant.video.bitDepth === 8 && variant.video.level <= 41 && variant.video.framerate > 0 && variant.video.framerate <= 30.01;
const jobs = [], review = [], blocked = [], alreadyCovered = [];
for (const record of audit.records) {
  if (incorrect.has(record.episodeId)) { blocked.push({ episodeId: record.episodeId, reason: 'Review the correct episode source before deciding whether to encode.' }); continue; }
  if (record.status !== 'READY') { blocked.push({ episodeId: record.episodeId, reason: record.status, provider: record.provider }); continue; }
  const original = record.variants.find(variant => variant.name === record.original);
  if (!original?.video?.codec || !original.md5) { blocked.push({ episodeId: record.episodeId, reason: 'Original technical information/hash is incomplete.' }); continue; }
  const targetHeight = Math.min(1080, original.video.height || original.height || 0);
  if (record.variants.some(variant => common(variant) && (variant.video.height || variant.height || 0) >= targetHeight - 2)) { alreadyCovered.push(record.episodeId); continue; }
  const config = existing.find(item => item.episodeId === record.episodeId);
  const reason = original.video.codecName === 'hevc' ? 'HEVC compatibility gap at original resolution'
    : original.video.bitDepth > 8 || original.video.profileId === 110 ? '10-bit AVC compatibility gap'
    : original.video.codecName === 'vp9' ? 'VP9 compatibility gap at original resolution'
    : 'High resolution, level or frame-rate gap; retain original and prepare a conservative H.264 alternative';
  const entry = { enabled: false, episodeId: record.episodeId, identifier: record.identifier, original: record.original, originalMd5: original.md5,
    files: [{ name: config?.files[0].name || `${record.episodeId}.compatible-h264.mp4`, md5: '' }], reason,
    sourceCodec: original.video.codec, sourceWidth: original.video.width, sourceHeight: original.video.height,
    target: { codec: 'H.264 High', maximumWidth: 1920, maximumHeight: targetHeight, maximumFramerate: 30, bitDepth: 8 },
    authorization: 'NOT_AUTHORIZED_FOR_PUBLICATION', physicalDeviceVerification: 'PENDING' };
  if (['hevc','vp9'].includes(original.video.codecName) || original.video.bitDepth > 8 || original.video.profileId === 110) jobs.push(entry);
  else review.push({ ...entry, action: 'Verify missing timing/actual device behavior before deciding to encode. Not in the executable jobs list.' });
}
const plan = { generatedAt: new Date().toISOString(), auditAt: audit.inspectedAt, jobs, review, blocked, alreadyCovered,
  note: 'Technical coverage is not a real-device playback guarantee. All originals stay available; upload/link operations need separate approval.' };
await writeFile(output, JSON.stringify(plan, null, 2) + '\n');
console.log(JSON.stringify({ output, jobs: jobs.length, review: review.length, blocked: blocked.length, alreadyCovered: alreadyCovered.length }));
