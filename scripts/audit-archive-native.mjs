import { resolveArchivePlaylist } from '../lib/archive.js';
import { archiveDownloadUrl } from '../lib/update2.js';

const base = (process.argv.find(value => value.startsWith('--base='))?.slice(7)
  || 'https://dubverse-platform.vercel.app').replace(/\/$/, '');
const concurrency = Math.max(1, Number(process.argv.find(value => value.startsWith('--concurrency='))?.slice(14)) || 4);
const full = process.argv.includes('--full');
const execute = process.argv.includes('--execute');
if (execute && !process.env.DATABASE_URL) throw new Error('--execute requiere DATABASE_URL; no se realizó ninguna auditoría ni escritura.');

async function json(url, timeout = 20_000) {
  const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

async function jsonWithRetry(url, timeout = 30_000) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await json(url, timeout); }
    catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw lastError;
}

function candidateScore(file) {
  const name = String(file.name || '').toLowerCase();
  const format = String(file.format || '').toLowerCase();
  const source = String(file.source || '').toLowerCase();
  const size = Number(file.size) || Number.MAX_SAFE_INTEGER;
  let score = 0;
  if (name.endsWith('.mp4')) score += 100;
  if (/h\.264|mpeg4|mpeg-4/.test(format)) score += 80;
  if (source === 'derivative') score += 60;
  if (/\.ia\.mp4$|512kb|h\.264 ia/.test(name + format)) score += 40;
  if (size <= 1_500_000_000) score += 20;
  if (source === 'original' && size > 1_500_000_000) score -= 200;
  return score;
}

function candidatesFor(entry) {
  return [...entry.sources]
    .filter(file => String(file.name || '').toLowerCase().endsWith('.mp4'))
    .sort((left, right) => candidateScore(right) - candidateScore(left));
}

async function rangeProbe(url, start) {
  const response = await fetch(url, {
    headers: { Range: `bytes=${start}-${start + 1}` }, redirect: 'follow', signal: AbortSignal.timeout(20_000)
  });
  const contentRange = response.headers.get('content-range') || '';
  const total = Number(contentRange.match(/\/(\d+)$/)?.[1]) || 0;
  const result = {
    ok: response.status === 206,
    status: response.status,
    contentType: response.headers.get('content-type') || '',
    acceptRanges: response.headers.get('accept-ranges') || '',
    contentRange,
    cors: response.headers.get('access-control-allow-origin') || '',
    total,
    finalUrl: response.url
  };
  await response.body?.cancel().catch(() => {});
  return result;
}


async function rangeProbeWithRetry(url, start) {
  let result;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      result = await rangeProbe(url, start);
      if (result.ok || (result.status < 500 && result.status !== 429)) return result;
    } catch (error) {
      result = { ok: false, error: error.name === 'TimeoutError' ? 'TIMEOUT' : String(error.message || error) };
    }
  }
  return result;
}

async function verifyCandidate(identifier, file) {
  const url = archiveDownloadUrl(identifier, file.name);
  try {
    const first = await rangeProbeWithRetry(url, 0);
    const expectedSize = Number(file.size) || first.total;
    const middleStart = Math.max(2, Math.floor(expectedSize / 2));
    const middle = first.ok && expectedSize > 4 ? await rangeProbeWithRetry(url, middleStart) : null;
    const videoType = /^video\/mp4(?:;|$)/i.test(first.contentType);
    // DubversePlayer deliberately does not set video.crossOrigin. Browsers may
    // play opaque cross-origin media without ACAO; CORS is only required for
    // canvas/pixel access, which the player never performs.
    const cors = !first.cors || first.cors === '*' || /^https?:\/\//i.test(first.cors);
    const corsMode = first.cors ? 'CORS_HEADER' : 'OPAQUE_MEDIA_OK';
    const sizeConsistent = expectedSize > 0 && first.total > 0 && Math.abs(first.total - expectedSize) <= 1;
    const seek = Boolean(middle?.ok && middle.contentRange.startsWith(`bytes ${middleStart}-`));
    return { ok: first.ok && videoType && cors && sizeConsistent && seek, url, expectedSize, first, middle, videoType, cors, corsMode, sizeConsistent, seek };
  } catch (error) {
    return { ok: false, url, error: error.name === 'TimeoutError' ? 'TIMEOUT' : String(error.message || error) };
  }
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

const projects = await json(`${base}/api/projects`);
const projectDetails = await mapLimit(projects, concurrency, project => json(`${base}/api/projects/${encodeURIComponent(project.id)}`));
const episodes = projectDetails.flatMap(project => project.episodes || [])
  .filter(episode => String(episode.provider).toUpperCase() === 'ARCHIVE');
const identifiers = [...new Set(episodes.map(episode => episode.archive_identifier))];
const metadataPairs = await mapLimit(identifiers, concurrency, async identifier => {
  try { return [identifier, await jsonWithRetry(`https://archive.org/metadata/${encodeURIComponent(identifier)}`, 30_000)]; }
  catch (error) { return [identifier, { error: String(error.message || error) }]; }
});
const metadata = new Map(metadataPairs);

const results = await mapLimit(episodes, concurrency, async episode => {
  const data = metadata.get(episode.archive_identifier);
  if (!data || data.error) return { id: episode.id, classification: 'INVALID', reason: 'METADATA_UNAVAILABLE', identifier: episode.archive_identifier };
  const playlist = resolveArchivePlaylist(data.files, episode.archive_file);
  if (playlist.status !== 'READY') return { id: episode.id, classification: 'INVALID', reason: playlist.status, identifier: episode.archive_identifier, archiveFile: episode.archive_file };
  const candidates = candidatesFor(playlist.selected);
  const probes = [];
  for (const candidate of candidates) {
    const verification = await verifyCandidate(episode.archive_identifier, candidate);
    probes.push({ file: candidate.name, format: candidate.format || '', source: candidate.source || '', size: Number(candidate.size) || 0, ...verification });
    if (verification.ok) {
      return {
        id: episode.id, classification: 'NATIVE_OK', identifier: episode.archive_identifier,
        orig: playlist.selected.orig, selectedFile: candidate.name, nativeUrl: verification.url,
        selectedSource: candidate.source || '', selectedFormat: candidate.format || '', size: verification.expectedSize,
        range: verification.first.contentRange, cors: verification.first.cors, contentType: verification.first.contentType,
        seekRange: verification.middle.contentRange, probes
      };
    }
  }
  return { id: episode.id, classification: 'EMBED_ONLY', reason: candidates.length ? 'NO_VERIFIED_CANDIDATE' : 'NO_MP4', identifier: episode.archive_identifier, orig: playlist.selected.orig, probes };
});

const counts = Object.fromEntries(['NATIVE_OK', 'EMBED_ONLY', 'INVALID'].map(value => [value, results.filter(result => result.classification === value).length]));
if (execute) {
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(process.env.DATABASE_URL, { fetchOptions: { cache: 'no-store' } });
  const queries = results.map(result => {
    const native = result.classification === 'NATIVE_OK';
    const evidence = JSON.stringify({
      classification: result.classification, identifier: result.identifier, orig: result.orig || null,
      selectedFile: result.selectedFile || null, contentType: result.contentType || null,
      size: result.size || null, range: result.range || null, seekRange: result.seekRange || null,
      corsMode: native ? 'OPAQUE_MEDIA_OK' : null, generatedAt: new Date().toISOString()
    });
    return sql`UPDATE episodes SET
      archive_playback_mode = ${native ? 'ARCHIVE_NATIVE_VERIFIED' : 'ARCHIVE_EMBED'},
      archive_native_status = ${result.classification}, archive_native_url = ${native ? result.nativeUrl : null},
      archive_native_verified_at = now(), archive_native_verification = ${evidence}::jsonb, updated_at = now()
      WHERE id = ${result.id} AND provider = 'ARCHIVE' AND published = true AND deleted_at IS NULL`;
  });
  await sql.transaction(queries);
}
const report = {
  generatedAt: new Date().toISOString(), mode: execute ? 'EXECUTE' : 'DRY_RUN_READ_ONLY', base, total: results.length, uniqueIdentifiers: identifiers.length,
  counts, nativeCoveragePercent: results.length ? Number((counts.NATIVE_OK * 100 / results.length).toFixed(2)) : 0,
  results
};
console.log(JSON.stringify(full ? report : {
  ...report,
  results: undefined,
  examples: results.filter(result => result.classification === 'NATIVE_OK').slice(0, 8),
  nonNative: results.filter(result => result.classification !== 'NATIVE_OK')
}, null, 2));
