import { AppError } from './db.js';

export const AGE_RATINGS = new Set(['GENERAL', 'AGE_13', 'AGE_16', 'AGE_18']);
export const CONTENT_WARNINGS = new Set(['NUDITY', 'SEXUAL_CONTENT', 'GRAPHIC_VIOLENCE', 'GORE', 'STRONG_LANGUAGE', 'SENSITIVE_TOPICS']);

export function stringList(value, allowed = null, max = 20) {
  const source = Array.isArray(value) ? value : String(value || '').split(/[\n,]/);
  const list = [...new Set(source.map(item => String(item).trim()).filter(Boolean))].slice(0, max);
  if (allowed && list.some(item => !allowed.has(item))) throw new AppError(400, 'La lista contiene un valor no permitido.');
  return list;
}

export function projectMetadataValue(raw, existing = {}) {
  const ageRating = String(raw.ageRating ?? existing.age_rating ?? 'GENERAL').toUpperCase();
  if (!AGE_RATINGS.has(ageRating)) throw new AppError(400, 'Clasificación de edad no permitida.');
  return {
    originalTitle: String(raw.originalTitle ?? existing.original_title ?? '').trim().slice(0, 240),
    alternateTitles: stringList(raw.alternateTitles ?? existing.alternate_titles ?? [], null, 20),
    searchAliases: stringList(raw.searchAliases ?? existing.search_aliases ?? [], null, 30),
    ageRating,
    contentWarnings: stringList(raw.contentWarnings ?? existing.content_warnings ?? [], CONTENT_WARNINGS, 12)
  };
}

export function safeAnnouncementLink(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw.slice(0, 2000);
  let url;
  try { url = new URL(raw); } catch { throw new AppError(400, 'El enlace del anuncio no es válido.'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new AppError(400, 'El enlace del anuncio debe usar HTTPS.');
  return url.toString().slice(0, 2000);
}
