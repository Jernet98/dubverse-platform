import { AppError, slugify } from './db.js';

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;
export const COMMENT_MAX = 1500;
export const REVIEW_MAX = 2000;
export const BIO_MAX = 500;
export const DISPLAY_NAME_MAX = 80;
export const REPORT_DETAILS_MAX = 500;
export const REPORT_REASONS = new Set(['SPAM', 'HARASSMENT', 'INAPPROPRIATE', 'SPOILER', 'OTHER']);
export const MEDIA_POLICIES = Object.freeze({
  AVATAR: { maxBytes: 2 * 1024 * 1024, width: 512, height: 512, prefix: 'avatar' },
  BANNER: { maxBytes: 5 * 1024 * 1024, width: 1600, height: 600, prefix: 'banner' },
  COMMENT: { maxBytes: 3 * 1024 * 1024, width: 1600, height: 1600, prefix: 'comments' }
});
export const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function normalizeUsername(value = '') {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, USERNAME_MAX);
}

export function usernameValue(value) {
  const username = normalizeUsername(value);
  if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) {
    throw new AppError(400, `El username debe tener entre ${USERNAME_MIN} y ${USERNAME_MAX} caracteres.`);
  }
  if (!/^[a-z0-9_]+$/.test(username)) {
    throw new AppError(400, 'El username sólo puede contener letras minúsculas, números y guion bajo.');
  }
  return username;
}

export function initialUsername(name, authUserId = '') {
  const base = normalizeUsername(name).slice(0, 22) || 'fan';
  const suffix = slugify(authUserId).replace(/-/g, '').slice(-6) || 'dub';
  const value = `${base}_${suffix}`.slice(0, USERNAME_MAX);
  return value.length >= USERNAME_MIN ? value : `fan_${suffix}`;
}

export function plainText(value, label, max, { required = false } = {}) {
  const text = String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();
  if (/<\s*\/?\s*[a-z][^>]*>/i.test(text)) throw new AppError(400, `${label} debe contener sólo texto, sin HTML.`);
  if (required && !text) throw new AppError(400, `${label} es obligatorio.`);
  if (text.length > max) throw new AppError(400, `${label} no puede superar ${max} caracteres.`);
  return text;
}

export function displayNameValue(value) {
  return plainText(value, 'El nombre visible', DISPLAY_NAME_MAX, { required: true });
}

export function bioValue(value) {
  return plainText(value, 'La biografía', BIO_MAX);
}

export function commentValue(value) {
  return plainText(value, 'El comentario', COMMENT_MAX, { required: true });
}

export function reviewValue(value) {
  return plainText(value, 'La reseña', REVIEW_MAX, { required: true });
}

export function ratingValue(value) {
  const rating = Number(value);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new AppError(400, 'La calificación debe ser un número entero entre 1 y 5.');
  }
  return rating;
}

export function reportReasonValue(value) {
  const reason = String(value || '').toUpperCase();
  if (!REPORT_REASONS.has(reason)) throw new AppError(400, 'Motivo de reporte no permitido.');
  return reason;
}

export function mediaRequestValue(purpose, contentType, size) {
  const normalizedPurpose = String(purpose || '').toUpperCase();
  const policy = MEDIA_POLICIES[normalizedPurpose];
  if (!policy) throw new AppError(400, 'Tipo de imagen no permitido.');
  const normalizedType = String(contentType || '').toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.has(normalizedType)) throw new AppError(400, 'Sólo se permiten imágenes JPEG, PNG o WebP.');
  const bytes = Number(size);
  if (!Number.isInteger(bytes) || bytes < 1 || bytes > policy.maxBytes) {
    throw new AppError(400, `La imagen supera el límite de ${Math.round(policy.maxBytes / 1024 / 1024)} MB.`);
  }
  return { purpose: normalizedPurpose, contentType: normalizedType, size: bytes, policy };
}

export function pageValue(value, fallback = 1) {
  const page = Number(value || fallback);
  return Number.isInteger(page) && page > 0 ? Math.min(page, 10000) : fallback;
}

export function uuidValue(value, label = 'El identificador') {
  const id = String(value || '').toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) {
    throw new AppError(400, `${label} no es válido.`);
  }
  return id;
}

export function normalizeGenre(value = '') {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('es');
}

export function rankProjectsByGenres(projects, selectedGenres) {
  const selected = [...new Set((selectedGenres || []).map(normalizeGenre).filter(Boolean))];
  if (!selected.length) return [...projects];
  return projects
    .map((project, index) => {
      const genres = new Set((project.genres || []).map(normalizeGenre));
      return { project, index, matches: selected.reduce((total, genre) => total + Number(genres.has(genre)), 0) };
    })
    .filter(item => item.matches > 0)
    .sort((left, right) => right.matches - left.matches || left.index - right.index)
    .map(item => item.project);
}
