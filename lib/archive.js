import { AppError } from '@/lib/db';
import { archiveDownloadUrl } from '@/lib/update2';

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
  const selected = requested
    ? playable.find(file => String(file.name || '') === requested) || null
    : playable.find(file => String(file.name || '').toLowerCase().endsWith('.mp4')) || playable[0] || null;

  return {
    identifier: clean,
    ready: playable.length > 0,
    metadata: data.metadata || {},
    selected,
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
