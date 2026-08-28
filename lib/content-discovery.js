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
  const hasAgeRating = raw.ageRating !== undefined;
  const hasContentWarnings = raw.contentWarnings !== undefined;
  const ageRating = String(hasAgeRating ? raw.ageRating : (existing.age_rating ?? 'GENERAL')).toUpperCase();
  if (!AGE_RATINGS.has(ageRating)) throw new AppError(400, 'El campo “Contenido para mayores de 18 años” contiene una opción no permitida.', 'ageRating');
  let contentWarnings;
  try {
    contentWarnings = hasContentWarnings
      ? stringList(raw.contentWarnings, CONTENT_WARNINGS, 12)
      : (Array.isArray(existing.content_warnings) ? existing.content_warnings : []);
  } catch {
    throw new AppError(400, 'El campo “Advertencias” contiene un valor no permitido.', 'contentWarnings');
  }
  return {
    originalTitle: String(raw.originalTitle ?? existing.original_title ?? '').trim().slice(0, 240),
    alternateTitles: stringList(raw.alternateTitles ?? existing.alternate_titles ?? [], null, 20),
    searchAliases: stringList(raw.searchAliases ?? existing.search_aliases ?? [], null, 30),
    ageRating,
    contentWarnings
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
