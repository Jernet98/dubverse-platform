import { AppError } from './db.js';

export const WATCH_COMPLETE_THRESHOLD = 0.92;
export const WATCH_PROGRESS_INTERVAL_MS = 12_000;
export const PROMO_TYPES = new Set(['TRAILER', 'TEASER', 'PV', 'SPECIAL']);
export const PROMO_PROVIDERS = new Set(['YOUTUBE', 'ARCHIVE', 'DIRECT', 'OTHER']);

export function isUpdate2SchemaMissing(error) {
  return ['42P01', '42703', '42704'].includes(error?.code)
    || /studio_memberships|studio_follows|watch_progress|project_promo_media|author_studio_id|mobile_image_url|is_verified/i.test(String(error?.message || ''));
}

export function normalizeYouTubeId(value) {
  const raw = String(value || '').trim();
  if (/^[A-Za-z0-9_-]{6,20}$/.test(raw)) return raw;
  let url;
  try { url = new URL(raw); } catch { return ''; }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  let id = '';
  if (host === 'youtu.be') id = url.pathname.split('/').filter(Boolean)[0] || '';
  if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
    if (url.pathname === '/watch') id = url.searchParams.get('v') || '';
    else if (/^\/(?:embed|shorts)\//.test(url.pathname)) id = url.pathname.split('/').filter(Boolean)[1] || '';
  }
  return /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : '';
}

export function youtubeThumbnailUrl(value) {
  const id = normalizeYouTubeId(value);
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : '';
}

export function normalizeArchiveReference(value, explicitFile = '') {
  const raw = String(value || '').trim();
  let identifier = '';
  let file = String(explicitFile || '').trim();
  if (/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(raw)) identifier = raw;
  else {
    let parsed;
    try { parsed = new URL(raw); } catch { return { identifier: '', file }; }
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (host !== 'archive.org') return { identifier: '', file };
    let parts;
    try { parts = parsed.pathname.split('/').filter(Boolean).map(part => decodeURIComponent(part)); }
    catch { return { identifier: '', file: '' }; }
    if (['details', 'download', 'embed'].includes(parts[0]) && parts[1]) {
      identifier = parts[1];
      if (!file && ['download', 'embed'].includes(parts[0]) && parts.length > 2) file = parts.slice(2).join('/');
    }
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(identifier) || file.includes('..')) return { identifier: '', file: '' };
  return { identifier, file };
}

export function safeHttpUrl(value, label = 'La URL') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let url;
  try { url = new URL(raw); } catch { throw new AppError(400, `${label} no es válida.`); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new AppError(400, `${label} debe usar http o https.`);
  url.username = '';
  url.password = '';
  return url.toString();
}

// Conserved for offline/admin Archive inspection. Public playback never calls it.
export function archiveDownloadUrl(identifier, file) {
  const cleanId = String(identifier || '').trim();
  const cleanFile = String(file || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(cleanId) || !cleanFile || cleanFile.includes('..')) return '';
  return `https://archive.org/download/${encodeURIComponent(cleanId)}/${cleanFile.split('/').map(encodeURIComponent).join('/')}`;
}

export function archiveEmbedUrlSafe(identifier, file = '') {
  const cleanId = String(identifier || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(cleanId)) return '';
  const base = `https://archive.org/embed/${encodeURIComponent(cleanId)}`;
  const cleanFile = String(file || '').trim();
  return cleanFile && !cleanFile.includes('..') ? `${base}/${cleanFile.split('/').map(encodeURIComponent).join('/')}` : base;
}

export function persistedArchiveEmbedUrl(episode) {
  const identifier = String(episode.archive_identifier || episode.archiveIdentifier || '').trim();
  const raw = String(episode.video_url || episode.videoUrl || '').trim();
  if (!identifier || !raw) return '';
  let parsed;
  try { parsed = new URL(raw); } catch { return ''; }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'archive.org' || parsed.search || parsed.hash) return '';
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'embed') return '';
  let embeddedIdentifier;
  try { embeddedIdentifier = decodeURIComponent(parts[1] || ''); } catch { return ''; }
  if (embeddedIdentifier !== identifier) return '';
  if (parts.length === 2) return archiveEmbedUrlSafe(identifier);
  let encodedFile = parts.slice(2).join('/');
  // Old records used `+` as a space. A literal plus is canonically persisted as %2B.
  if (encodedFile.includes('+')) encodedFile = encodedFile.replace(/\+/g, '%20');
  let file;
  try { file = encodedFile.split('/').map(decodeURIComponent).join('/'); } catch { return ''; }
  return file && !file.includes('..') ? archiveEmbedUrlSafe(identifier, file) : '';
}

function mediaKind(url) {
  return /\.m3u8(?:$|[?#])/i.test(url) ? 'HLS' : 'VIDEO';
}

export function episodePlayback(episode) {
  const provider = String(episode.provider || '').toUpperCase();
  if (provider === 'ARCHIVE') {
    const identifier = episode.archive_identifier || episode.archiveIdentifier;
    const file = episode.archive_file || episode.archiveFile;
    const fallback = persistedArchiveEmbedUrl(episode);
    return {
      provider, mode: 'ARCHIVE_EMBED', status: fallback ? 'READY' : 'UNRESOLVED',
      identifier: String(identifier || '').trim(),
      file: String(file || '').trim(),
      source: null,
      fallback: fallback ? { kind: 'IFRAME', url: fallback, mode: 'ARCHIVE_EMBED' } : null
    };
  }
  const rawUrl = String(episode.video_url || episode.videoUrl || '').trim();
  const url = rawUrl.startsWith('/') ? rawUrl : safeHttpUrl(rawUrl, 'La fuente del episodio');
  if (!url) return { provider, source: null, fallback: null };
  return { provider, source: { kind: provider === 'HLS' ? 'HLS' : mediaKind(url), url }, fallback: null };
}

export function promoValue(raw, existing = {}) {
  const type = String(raw.type ?? existing.type ?? 'TRAILER').toUpperCase();
  const provider = String(raw.provider ?? existing.provider ?? 'YOUTUBE').toUpperCase();
  if (!PROMO_TYPES.has(type)) throw new AppError(400, 'Tipo de material promocional no permitido.');
  if (!PROMO_PROVIDERS.has(provider)) throw new AppError(400, 'Proveedor promocional no permitido.');
  const title = String(raw.title ?? existing.title ?? '').trim();
  if (!title || title.length > 160) throw new AppError(400, 'El título promocional debe tener entre 1 y 160 caracteres.');
  const existingProvider = String(existing.provider || '').toUpperCase();
  const providerChanged = Boolean(existingProvider && provider !== existingProvider);
  let url = safeHttpUrl(raw.url ?? (providerChanged ? '' : existing.url) ?? '', 'La URL promocional');
  let providerIdentifier = String(raw.providerIdentifier ?? raw.provider_identifier ?? (providerChanged ? '' : existing.providerIdentifier ?? existing.provider_identifier) ?? '').trim();
  let providerFile = String(raw.providerFile ?? raw.provider_file ?? (providerChanged ? '' : existing.providerFile ?? existing.provider_file) ?? '').trim();
  if (provider === 'YOUTUBE') {
    providerIdentifier = normalizeYouTubeId(providerIdentifier || url);
    if (!providerIdentifier) throw new AppError(400, 'No se pudo reconocer el video de YouTube.');
    url = `https://www.youtube.com/watch?v=${providerIdentifier}`;
    providerFile = '';
  }
  if (provider === 'ARCHIVE') {
    const archive = normalizeArchiveReference(providerIdentifier || url, providerFile);
    providerIdentifier = archive.identifier;
    providerFile = archive.file;
    if (!providerIdentifier) throw new AppError(400, 'No se pudo reconocer el item de Archive.org.');
  }
  if (['DIRECT', 'OTHER'].includes(provider)) {
    providerIdentifier = '';
    providerFile = '';
  }
  if (provider === 'DIRECT' && !url) throw new AppError(400, 'DIRECT requiere una URL http/https.');
  if (provider === 'OTHER' && !url) throw new AppError(400, 'OTHER requiere una URL para abrir el video.');
  const previousIdentifier = existing.providerIdentifier ?? existing.provider_identifier ?? '';
  const previousThumbnail = existing.thumbnailUrl ?? existing.thumbnail_url ?? '';
  const previousWasAutomatic = existingProvider === 'YOUTUBE' && previousThumbnail === youtubeThumbnailUrl(previousIdentifier);
  let thumbnailUrl = safeHttpUrl(raw.thumbnailUrl ?? raw.thumbnail_url ?? (providerChanged || previousWasAutomatic ? '' : previousThumbnail), 'La miniatura');
  if (provider === 'YOUTUBE' && !thumbnailUrl) thumbnailUrl = youtubeThumbnailUrl(providerIdentifier);
  const position = Number(raw.position ?? existing.position ?? 0);
  if (!Number.isInteger(position) || position < 0 || position > 10000) throw new AppError(400, 'La posición promocional no es válida.');
  return { type, provider, title, url, providerIdentifier, providerFile, thumbnailUrl, position, isActive: raw.isActive ?? raw.is_active ?? existing.isActive ?? existing.is_active ?? true };
}

export function mapPromo(row) {
  const base = {
    id: row.id,
    projectId: row.project_id,
    type: row.type,
    provider: row.provider,
    title: row.title,
    url: row.url || '',
    providerIdentifier: row.provider_identifier || '',
    providerFile: row.provider_file || '',
    thumbnailUrl: row.thumbnail_url || '',
    position: Number(row.position || 0),
    isActive: Boolean(row.is_active)
  };
  if (base.provider === 'YOUTUBE') base.playback = { kind: 'YOUTUBE', url: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(base.providerIdentifier)}` };
  else if (base.provider === 'ARCHIVE') {
    base.playback = { kind: 'IFRAME', url: archiveEmbedUrlSafe(base.providerIdentifier, base.providerFile) };
  } else if (base.provider === 'DIRECT') base.playback = { kind: mediaKind(base.url), url: base.url };
  else base.playback = { kind: 'LINK', url: base.url };
  return base;
}

export function normalizedProgress(position, duration) {
  const safeDuration = Math.max(0, Number(duration) || 0);
  const safePosition = Math.min(Math.max(0, Number(position) || 0), safeDuration || Number.MAX_SAFE_INTEGER);
  const ratio = safeDuration > 0 ? safePosition / safeDuration : 0;
  return { position: safePosition, duration: safeDuration, ratio, complete: safeDuration > 0 && ratio >= WATCH_COMPLETE_THRESHOLD };
}
