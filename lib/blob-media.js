import { AppError, slugify } from './db.js';
import { ALLOWED_IMAGE_TYPES, MEDIA_POLICIES } from './social-validation.js';
import {
  deleteR2ImageByUrl,
  isManagedR2ImageUrl,
  r2ImagesStatus,
  uploadR2Image
} from './r2-images.js';

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
  ) {
    throw new AppError(400, 'Selecciona una imagen válida.');
  }

  const contentType = String(file.type || '').toLowerCase();

  if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
    throw new AppError(400, 'Sólo se permiten imágenes JPEG, PNG o WebP.');
  }

  if (!Number.isInteger(file.size) || file.size < 1 || file.size > policy.maxBytes) {
    throw new AppError(
      413,
      `La imagen supera el límite de ${Math.round(policy.maxBytes / 1024 / 1024)} MB.`
    );
  }

  return { policy, contentType };
}

export function validatePanelImageSignature(bytes, contentType) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);

  const jpeg =
    data.length >= 3 &&
    data[0] === 0xff &&
    data[1] === 0xd8 &&
    data[2] === 0xff;

  const png =
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a &&
    data[6] === 0x1a &&
    data[7] === 0x0a;

  const webp =
    data.length >= 12 &&
    String.fromCharCode(...data.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...data.slice(8, 12)) === 'WEBP';

  const valid =
    contentType === 'image/jpeg'
      ? jpeg
      : contentType === 'image/png'
        ? png
        : contentType === 'image/webp'
          ? webp
          : false;

  if (!valid) {
    throw new AppError(
      400,
      'El contenido del archivo no coincide con una imagen JPEG, PNG o WebP válida.'
    );
  }

  return true;
}

export async function uploadPanelImage(file, { studioId, kind }) {
  if (!r2ImagesStatus()) {
    throw new AppError(503, 'Cloudflare R2 Images no está configurado.');
  }

  const { policy, contentType } = validatePanelMediaFile(file, kind);
  const bytes = new Uint8Array(await file.arrayBuffer());

  validatePanelImageSignature(bytes, contentType);

  const studio = slugify(studioId) || 'studio';
  const extension =
    contentType === 'image/jpeg' ? 'jpg' : contentType.split('/')[1];

  const filename =
    slugify(file.name.replace(/\.[^.]+$/, '')) || 'imagen';

  const pathname =
    `studios/${studio}/${policy.folder}/${Date.now()}-${filename}.${extension}`;

  return uploadR2Image(pathname, bytes, contentType);
}

/*
 * Conservamos estos nombres para no romper el resto del proyecto.
 * Ahora administran imágenes de R2, no Vercel Blob.
 */
export function isManagedBlobUrl(value) {
  return isManagedR2ImageUrl(value);
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
  if (!isManagedR2ImageUrl(url)) return false;
  if (await blobReferenceCount(sql, url)) return false;

  try {
    await deleteR2ImageByUrl(url);
    return true;
  } catch (error) {
    console.warn(
      '[Dubverse R2 Images] No se pudo eliminar',
      url,
      error?.message || error
    );
    return false;
  }
}

export async function cleanupBlobUrls(sql, values) {
  let deleted = 0;

  for (const value of [...new Set((values || []).filter(Boolean))]) {
    if (await deleteBlobIfUnreferenced(sql, value)) {
      deleted += 1;
    }
  }

  return deleted;
}