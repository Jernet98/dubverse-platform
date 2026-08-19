import { AppError } from './db.js';
import { archiveDownloadUrl } from './update2.js';

export function selectArchivePlayableFile(files, expectedFile = '') {
  const playable = Array.isArray(files) ? files : [];
  const requested = String(expectedFile || '').trim();
  if (requested) return playable.find(file => String(file.name || '') === requested) || null;
  return playable.length === 1 ? playable[0] : null;
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
  const selected = selectArchivePlayableFile(playable, requested);

  return {
    identifier: clean,
    ready: playable.length > 0,
    metadata: data.metadata || {},
    selected,
    ambiguous: !requested && playable.length > 1,
    requestedFileFound: requested ? Boolean(selected) : null,
    directUrl: selected ? archiveDownloadUrl(clean, selected.name) : '',
    files: playable.map(file => ({ name: file.name, format: file.format, size: file.size || null }))
  };
}

export function archiveEmbedUrl(identifier, file = '') {
  const base = `https://archive.org/embed/${encodeURIComponent(identifier)}`;
  if (!file) return base;
  return `${base}/${encodeURIComponent(file).replace(/%2F/g, '/')}`;
}
