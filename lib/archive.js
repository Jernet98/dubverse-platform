import { AppError } from './db.js';
import { archiveDownloadUrl } from './update2.js';

const archiveMetadataCache = new Map();
const ARCHIVE_METADATA_TTL_MS = 10 * 60 * 1000;

function decodedFileCandidates(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.includes('..')) return [];
  let decoded = raw;
  try { decoded = decodeURIComponent(raw); } catch {}
  return [...new Set([raw, decoded, raw.replace(/\+/g, ' '), decoded.replace(/\+/g, ' ')])];
}

function isArchiveVideo(file) {
  const name = String(file?.name || '').toLowerCase();
  const format = String(file?.format || '').toLowerCase();
  return /\.(?:mp4|m4v|ogv|webm)$/.test(name) || /h\.264|mpeg4|mpeg-4|ogg video|webm/.test(format);
}

export function resolveArchivePlaylist(files, expectedFile = '') {
  const list = Array.isArray(files) ? files : [];
  const originals = new Map();
  for (const file of list) {
    if (!isArchiveVideo(file)) continue;
    const name = String(file.name || '');
    const original = String(file.original || '');
    if (String(file.source || '').toLowerCase() === 'original' || !original) originals.set(name, file);
  }
  for (const file of list) {
    if (!isArchiveVideo(file) || !file.original) continue;
    const original = String(file.original);
    if (!originals.has(original)) originals.set(original, { name: original, source: 'original' });
  }
  const entries = [...originals.values()].map(original => ({
    orig: String(original.name),
    title: String(original.title || original.name || ''),
    sources: list.filter(file => String(file.name || '') === original.name || String(file.original || '') === original.name)
  })).sort((left, right) => left.orig.localeCompare(right.orig, 'en'));
  if (!entries.length) return { status: 'NO_VIDEO', entries, selected: null };
  const candidates = decodedFileCandidates(expectedFile);
  let selected = null;
  for (const candidate of candidates) {
    selected = entries.find(entry => entry.orig === candidate)
      || entries.find(entry => entry.sources.some(source => String(source.name || '') === candidate));
    if (selected) break;
  }
  if (!expectedFile && entries.length === 1) selected = entries[0];
  if (!selected) return { status: expectedFile ? 'FILE_NOT_FOUND' : 'FILE_REQUIRED', entries, selected: null };
  return { status: 'READY', entries, selected };
}

async function archiveMetadata(identifier) {
  const cached = archiveMetadataCache.get(identifier);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  const response = await fetch(`https://archive.org/metadata/${encodeURIComponent(identifier)}`, {
    cache: 'no-store', signal: AbortSignal.timeout(6000)
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new AppError(502, `Archive.org respondió ${response.status}.`);
  const data = await response.json();
  archiveMetadataCache.set(identifier, { data, expiresAt: Date.now() + ARCHIVE_METADATA_TTL_MS });
  return data;
}

export async function resolveArchiveEpisodePlayback(episode) {
  const identifier = String(episode.archive_identifier || episode.archiveIdentifier || '').trim();
  const file = String(episode.archive_file || episode.archiveFile || '').trim();
  const unresolved = reason => ({ provider: 'ARCHIVE', identifier, file, status: 'UNRESOLVED', reason, source: null, fallback: null });
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(identifier)) return unresolved('INVALID_IDENTIFIER');
  let metadata;
  try { metadata = await archiveMetadata(identifier); }
  catch { return unresolved('METADATA_UNAVAILABLE'); }
  if (!metadata) return unresolved('IDENTIFIER_NOT_FOUND');
  const finalIdentifier = String(metadata.metadata?.identifier || identifier);
  if (finalIdentifier !== identifier) return unresolved('IDENTIFIER_MISMATCH');
  const playlist = resolveArchivePlaylist(metadata.files, file);
  if (playlist.status !== 'READY') return unresolved(playlist.status);
  const embed = playlist.entries.length === 1
    ? archiveEmbedUrl(identifier)
    : archiveEmbedUrl(identifier, playlist.selected.orig);
  return {
    provider: 'ARCHIVE', identifier, file, status: 'READY', source: null,
    fallback: { kind: 'IFRAME', url: embed, mode: 'ARCHIVE_EMBED' },
    archive: { orig: playlist.selected.orig, entryCount: playlist.entries.length }
  };
}

function archiveFileScore(file) {
  const name = String(file?.name || '').toLowerCase();
  const format = String(file?.format || '').toLowerCase();
  const source = String(file?.source || '').toLowerCase();
  let score = 0;
  if (name.endsWith('.mp4')) score += 20;
  if (/h\.264|mpeg4|mpeg-4/.test(format)) score += 20;
  if (source === 'derivative') score += 15;
  if (/512kb|h\.264 ia|mpeg4/.test(format)) score += 10;
  const size = Number(file?.size);
  if (Number.isFinite(size) && size > 0 && size <= 1_500_000_000) score += 5;
  return score;
}

export function selectArchivePlayableFile(files, expectedFile = '') {
  const playable = Array.isArray(files) ? files : [];
  const requested = String(expectedFile || '').trim();
  if (requested) return playable.find(file => String(file.name || '') === requested) || null;
  return [...playable].sort((left, right) => archiveFileScore(right) - archiveFileScore(left))[0] || null;
}

export async function inspectArchive(identifier, expectedFile = '') {
  const clean = String(identifier || '').trim();
  if (!clean || !/^[A-Za-z0-9._-]+$/.test(clean)) {
    throw new AppError(400, 'Identificador de Archive.org inválido.');
  }

  const response = await fetch(`https://archive.org/metadata/${encodeURIComponent(clean)}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new AppError(502, `Archive.org respondió ${response.status}.`);
  const data = await response.json();
  const files = Array.isArray(data.files) ? data.files : [];
  const playable = files.filter(file => {
    const name = String(file.name || '').toLowerCase();
    const format = String(file.format || '').toLowerCase();
    return name.endsWith('.mp4') || name.endsWith('.ogv') || format.includes('h.264') || format.includes('mpeg4');
  });
  const requested = String(expectedFile || '').trim();
  const playlist = resolveArchivePlaylist(files, requested);
  const selected = playlist.selected
    ? playable.find(file => String(file.name || '') === playlist.selected.orig)
      || playlist.selected.sources.find(file => playable.includes(file)) || null
    : null;
  const resolvedOrig = playlist.selected?.orig || '';
  const embedUrl = playlist.status === 'READY'
    ? archiveEmbedUrl(clean, playlist.entries.length === 1 ? '' : resolvedOrig)
    : '';

  return {
    identifier: clean,
    ready: playlist.status === 'READY',
    status: playlist.status,
    resolvedOrig,
    entryCount: playlist.entries.length,
    embedUrl,
    metadata: data.metadata || {},
    selected,
    requestedFileFound: requested ? playlist.status === 'READY' : null,
    directUrl: selected ? archiveDownloadUrl(clean, selected.name) : '',
    files: playable.map(file => ({ name: file.name, format: file.format, source: file.source || null, original: file.original || null, size: file.size || null }))
  };
}

export function archiveEmbedUrl(identifier, file = '') {
  const base = `https://archive.org/embed/${encodeURIComponent(identifier)}`;
  if (!file) return base;
  return `${base}/${encodeURIComponent(file).replace(/%2F/g, '/')}`;
}
