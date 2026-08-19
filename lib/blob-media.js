import { del, put } from '@vercel/blob';
import { AppError, slugify } from './db.js';
import { ALLOWED_IMAGE_TYPES, MEDIA_POLICIES } from './social-validation.js';

const PANEL_MEDIA_KINDS = Object.freeze({
  'studio-logo': { purpose: 'AVATAR', folder: 'logo', label: 'logo del estudio' },
  'studio-banner': { purpose: 'BANNER', folder: 'banner', label: 'banner del estudio' },
  'project-poster': { purpose: 'COMMENT', folder: 'project-poster', label: 'portada del proyecto' },
  'project-banner': { purpose: 'BANNER', folder: 'project-banner', label: 'banner del proyecto' },
  'promo-thumbnail': { purpose: 'COMMENT', folder: 'promo-thumbnail', label: 'miniatura promocional' }
});

export function panelMediaPolicy(kind) {
  const value = PANEL_MEDIA_KINDS[String(kind || '').toLowerCase()];
  if (!value) throw new AppError(400, 'Tipo de imagen del Panel de estudio no permitido.');
  return { ...value, ...MEDIA_POLICIES[value.purpose] };
}

export function validatePanelMediaFile(file, kind) {
  const policy = panelMediaPolicy(kind);
  if (
    !file
    || typeof file !== 'object'
    || typeof file.name !== 'string'
    || typeof file.type !== 'string'
    || typeof file.size !== 'number'
    || typeof file.arrayBuffer !== 'function'
  ) throw new AppError(400, 'Selecciona una imagen válida.');
  const contentType = String(file.type || '').toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.has(contentType)) throw new AppError(400, 'Sólo se permiten imágenes JPEG, PNG o WebP.');
  if (!Number.isInteger(file.size) || file.size < 1 || file.size > policy.maxBytes) {
    throw new AppError(413, `La imagen supera el límite de ${Math.round(policy.maxBytes / 1024 / 1024)} MB.`);
  }
  return { policy, contentType };
}

export async function uploadPanelImage(file, { studioId, kind }) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new AppError(503, 'El almacenamiento de imágenes no está disponible.');
  const { policy, contentType } = validatePanelMediaFile(file, kind);
  const studio = slugify(studioId) || 'studio';
  const extension = contentType === 'image/jpeg' ? 'jpg' : contentType.split('/')[1];
  const filename = slugify(file.name.replace(/\.[^.]+$/, '')) || 'imagen';
  const pathname = `studios/${studio}/${policy.folder}/${Date.now()}-${filename}.${extension}`;
  const blob = await put(pathname, file, {
    access: 'public',
    addRandomSuffix: true,
    token
  });
  return { url: blob.url, pathname: blob.pathname };
}

export function isManagedBlobUrl(value) {
  if (!value || !process.env.BLOB_READ_WRITE_TOKEN) return false;
  try {
    const host = new URL(String(value)).hostname.toLowerCase();
    return host === 'blob.vercel-storage.com' || host.endsWith('.blob.vercel-storage.com');
  } catch {
    return false;
  }
}

export async function blobReferenceCount(sql, url) {
  let rows;
  try {
    rows = await sql`
      SELECT
        (SELECT COUNT(*) FROM projects WHERE poster = ${url} OR banner = ${url}) +
        (SELECT COUNT(*) FROM studios WHERE logo = ${url} OR banner = ${url}) +
        (SELECT COUNT(*) FROM editorial_banners WHERE image_url = ${url} OR mobile_image_url = ${url}) +
        (SELECT COUNT(*) FROM project_promo_media WHERE thumbnail_url = ${url}) AS references
    `;
  } catch (error) {
    if (!['42P01', '42703'].includes(error?.code)) throw error;
    rows = await sql`
      SELECT
        (SELECT COUNT(*) FROM projects WHERE poster = ${url} OR banner = ${url}) +
        (SELECT COUNT(*) FROM studios WHERE logo = ${url}) AS references
    `;
  }
  return Number(rows[0]?.references || 0);
}

export async function deleteBlobIfUnreferenced(sql, url) {
  if (!isManagedBlobUrl(url) || await blobReferenceCount(sql, url)) return false;
  try {
    await del(url);
    return true;
  } catch (error) {
    console.warn('[Dubverse Blob] No se pudo eliminar', url, error?.message || error);
    return false;
  }
}

export async function cleanupBlobUrls(sql, values) {
  let deleted = 0;
  for (const value of [...new Set((values || []).filter(Boolean))]) {
    if (await deleteBlobIfUnreferenced(sql, value)) deleted += 1;
  }
  return deleted;
}
