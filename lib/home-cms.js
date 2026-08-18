import { AppError } from './db.js';

export const HOME_SECTION_TYPES = new Set([
  'HERO', 'FEATURED_PROJECTS', 'FEATURED_STUDIOS', 'AUTO_STATUS', 'AUTO_TYPE', 'RECENT', 'CURATED', 'RECOMMENDED'
]);
export const HOME_SYSTEM_KEYS = new Set(['hero', 'featured-projects', 'featured-studios']);
export const HOME_SYSTEM_TYPES = Object.freeze({
  hero: 'HERO',
  'featured-projects': 'FEATURED_PROJECTS',
  'featured-studios': 'FEATURED_STUDIOS'
});
export const HOME_PROJECT_TYPES = new Set(['SERIES', 'MOVIE', 'OVA', 'SPECIAL', 'MANGA_COMIC_DUB']);
export const HOME_PROJECT_STATUSES = new Set(['ONGOING', 'UPCOMING', 'FINISHED', 'PAUSED', 'CANCELLED']);
export const SITE_SOCIAL_KEYS = new Set(['website', 'facebook', 'instagram', 'x', 'twitter', 'youtube', 'discord', 'tiktok', 'whatsapp']);

export const DEFAULT_SITE_SETTINGS = Object.freeze({
  siteName: 'DUBVERSE',
  footerSlogan: 'Fandoblaje hecho por amor al arte. Sin anuncios propios.',
  description: 'Fandoblajes en español latino hechos por fans para fans.',
  publicEmail: '',
  copyrightText: '',
  socials: {}
});

export const DEFAULT_HOME_SECTIONS = Object.freeze([
  { sectionKey: 'hero', sectionType: 'HERO', title: '', subtitle: '', enabled: true, position: 0, maxItems: 8, configuration: {} },
  { sectionKey: 'featured-projects', sectionType: 'FEATURED_PROJECTS', title: 'Proyectos destacados', subtitle: 'Series, películas y OVA dobladas por la comunidad.', enabled: true, position: 10, maxItems: 6, configuration: { autoFill: true } },
  { sectionKey: 'ongoing', sectionType: 'AUTO_STATUS', title: 'En emisión', subtitle: 'Historias que siguen creciendo episodio a episodio.', enabled: true, position: 20, maxItems: 8, configuration: { status: 'ONGOING' } },
  { sectionKey: 'recent', sectionType: 'RECENT', title: 'Recién agregados', subtitle: 'Lo más nuevo que llegó al catálogo.', enabled: true, position: 30, maxItems: 8, configuration: {} },
  { sectionKey: 'recommended', sectionType: 'RECOMMENDED', title: 'Quizá te interese', subtitle: 'Una selección variada para seguir explorando.', enabled: true, position: 40, maxItems: 8, configuration: {} },
  { sectionKey: 'movies', sectionType: 'AUTO_TYPE', title: 'Películas', subtitle: 'Fandoblajes para disfrutar de principio a fin.', enabled: true, position: 50, maxItems: 8, configuration: { type: 'MOVIE' } },
  { sectionKey: 'featured-studios', sectionType: 'FEATURED_STUDIOS', title: 'Estudios de fandoblaje', subtitle: 'Cada proyecto conserva sus créditos y responsables.', enabled: true, position: 60, maxItems: 5, configuration: { autoFill: true } }
]);
export const HOME_DEFAULT_KEYS = new Set(DEFAULT_HOME_SECTIONS.map(section => section.sectionKey));
export const HOME_DEFAULT_TYPES = Object.freeze(Object.fromEntries(DEFAULT_HOME_SECTIONS.map(section => [section.sectionKey, section.sectionType])));

function textValue(value, label, max, { required = false } = {}) {
  const text = String(value || '').trim();
  if (required && !text) throw new AppError(400, `${label} es obligatorio.`);
  if (text.length > max) throw new AppError(400, `${label} supera el máximo de ${max} caracteres.`);
  return text;
}

export function homeInteger(value, label, min, max, fallback = min) {
  const number = value === undefined || value === null || value === '' ? fallback : Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new AppError(400, `${label} debe ser un entero entre ${min} y ${max}.`);
  return number;
}

export function homeUrl(value, label, { internal = false } = {}) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (internal && /^\/(?!\/)/.test(raw)) return raw;
  let parsed;
  try { parsed = new URL(raw); } catch { throw new AppError(400, `${label} no contiene una URL válida.`); }
  if (parsed.protocol !== 'https:') throw new AppError(400, `${label} debe usar HTTPS${internal ? ' o una ruta interna' : ''}.`);
  return parsed.toString();
}

export function siteSettingsValue(body, legacy = {}) {
  const socialsInput = body?.socials ?? legacy.socials ?? {};
  if (!socialsInput || typeof socialsInput !== 'object' || Array.isArray(socialsInput)) throw new AppError(400, 'Las redes del sitio deben ser un objeto.');
  const socials = {};
  for (const [key, value] of Object.entries(socialsInput)) {
    if (!SITE_SOCIAL_KEYS.has(key)) throw new AppError(400, `Red social no permitida: ${key}.`);
    const url = homeUrl(value, `La URL de ${key}`);
    if (url) socials[key] = url;
  }
  const email = textValue(body?.publicEmail ?? legacy.publicEmail, 'El correo público', 254);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError(400, 'El correo público no es válido.');
  return {
    siteName: textValue(body?.siteName ?? legacy.siteName, 'El nombre del sitio', 80, { required: true }),
    footerSlogan: textValue(body?.footerSlogan ?? legacy.footerSlogan, 'El slogan', 240),
    description: textValue(body?.description ?? legacy.description, 'La descripción', 500),
    publicEmail: email,
    copyrightText: textValue(body?.copyrightText ?? legacy.copyrightText, 'El copyright', 240),
    socials
  };
}

export function sectionValue(body, existing = {}) {
  const sectionType = String(body?.sectionType ?? existing.sectionType ?? '').toUpperCase();
  if (!HOME_SECTION_TYPES.has(sectionType)) throw new AppError(400, 'Tipo de sección no permitido.');
  const sectionKey = textValue(body?.sectionKey ?? existing.sectionKey, 'La clave de sección', 60, { required: true }).toLowerCase();
  if (!/^[a-z0-9_-]{2,60}$/.test(sectionKey)) throw new AppError(400, 'La clave de sección sólo admite letras minúsculas, números, guion y guion bajo.');
  const rawConfiguration = body?.configuration ?? existing.configuration ?? {};
  if (!rawConfiguration || typeof rawConfiguration !== 'object' || Array.isArray(rawConfiguration)) throw new AppError(400, 'La configuración de sección debe ser un objeto.');
  const configuration = {};
  if (sectionType === 'AUTO_STATUS') {
    const status = String(rawConfiguration.status || '').toUpperCase();
    if (!HOME_PROJECT_STATUSES.has(status)) throw new AppError(400, 'Estado automático no permitido.');
    configuration.status = status;
  }
  if (sectionType === 'AUTO_TYPE') {
    const type = String(rawConfiguration.type || '').toUpperCase();
    if (!HOME_PROJECT_TYPES.has(type)) throw new AppError(400, 'Tipo automático no permitido.');
    configuration.type = type;
  }
  if (['FEATURED_PROJECTS', 'FEATURED_STUDIOS'].includes(sectionType)) configuration.autoFill = rawConfiguration.autoFill !== false;
  return {
    sectionKey,
    sectionType,
    title: textValue(body?.title ?? existing.title, 'El título de sección', 120),
    subtitle: textValue(body?.subtitle ?? existing.subtitle, 'El subtítulo de sección', 300),
    enabled: booleanInput(body?.enabled, existing.enabled !== false),
    position: homeInteger(body?.position, 'La posición', 0, 10000, Number(existing.position || 0)),
    maxItems: homeInteger(body?.maxItems, 'La cantidad', 1, 12, Number(existing.maxItems || 6)),
    configuration
  };
}

export function bannerValue(body, existing = {}) {
  const startsAt = body?.startsAt === undefined ? existing.startsAt || null : dateOrNull(body.startsAt, 'La fecha de inicio');
  const endsAt = body?.endsAt === undefined ? existing.endsAt || null : dateOrNull(body.endsAt, 'La fecha de fin');
  if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) throw new AppError(400, 'La fecha de fin debe ser posterior al inicio.');
  return {
    label: textValue(body?.label ?? existing.label, 'La etiqueta', 40),
    title: textValue(body?.title ?? existing.title, 'El título del banner', 120, { required: true }),
    description: textValue(body?.description ?? existing.description, 'La descripción del banner', 500),
    imageUrl: homeUrl(body?.imageUrl ?? existing.imageUrl, 'La imagen del banner', { internal: true }),
    mobileImageUrl: homeUrl(body?.mobileImageUrl ?? existing.mobileImageUrl, 'La imagen móvil del banner', { internal: true }),
    linkUrl: homeUrl(body?.linkUrl ?? existing.linkUrl, 'El enlace del banner', { internal: true }),
    buttonText: textValue(body?.buttonText ?? existing.buttonText, 'El texto del botón', 60),
    enabled: booleanInput(body?.enabled, existing.enabled !== false),
    position: homeInteger(body?.position, 'La posición', 0, 10000, Number(existing.position || 0)),
    startsAt,
    endsAt
  };
}

function dateOrNull(value, label) {
  if (value === null || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new AppError(400, `${label} no es válida.`);
  return date.toISOString();
}

export function isHomeSchemaMissing(error) {
  return error?.code === '42P01' || /relation .+ does not exist/i.test(String(error?.message || ''));
}

export function rankRecommendations(references, candidates, { completedIds = [] } = {}) {
  const referenceList = (references || []).filter(item => item?.id);
  const excluded = new Set([...referenceList.map(item => item.id), ...completedIds]);
  const normalizedReferences = referenceList.map((item, index) => ({
    ...item,
    index,
    genres: new Set((item.genres || []).map(genre => String(genre).toLowerCase()))
  }));
  const ranked = (candidates || []).map((project, index) => {
    if (!project?.published || project.deletedAt || excluded.has(project.id)) return null;
    const genres = new Set((project.genres || []).map(genre => String(genre).toLowerCase()));
    let best = { matches: 0, typeMatch: 0, referenceIndex: Number.MAX_SAFE_INTEGER };
    for (const reference of normalizedReferences) {
      const score = {
        matches: [...genres].filter(genre => reference.genres.has(genre)).length,
        typeMatch: Number(project.type === reference.type),
        referenceIndex: reference.index
      };
      if (score.matches > best.matches || (score.matches === best.matches && score.typeMatch > best.typeMatch)) best = score;
    }
    return { project, index, ...best };
  }).filter(item => item && item.matches > 0)
    .sort((left, right) => right.matches - left.matches || right.typeMatch - left.typeMatch || left.referenceIndex - right.referenceIndex || left.index - right.index);
  return { items: ranked.map(item => item.project), reference: referenceList[0] || null };
}

export function diversifiedFallback(projects, limit = 8) {
  const groups = new Map();
  for (const project of projects || []) {
    if (!project?.published || project.deletedAt) continue;
    if (!groups.has(project.type)) groups.set(project.type, []);
    groups.get(project.type).push(project);
  }
  const keys = [...groups.keys()];
  const result = [];
  while (result.length < limit && keys.some(key => groups.get(key).length)) {
    for (const key of keys) {
      const item = groups.get(key).shift();
      if (item) result.push(item);
      if (result.length >= limit) break;
    }
  }
  return result;
}

export function stableDailyRotate(items, salt = '') {
  if (!items?.length) return [];
  const day = Math.floor(Date.now() / 86400000);
  let hash = day;
  for (const char of String(salt)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const offset = hash % items.length;
  return [...items.slice(offset), ...items.slice(0, offset)];
}

function booleanInput(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new AppError(400, 'El valor de activación debe ser booleano.');
  return value;
}

export function nextShuffleBag(items, previous = null, random = Math.random) {
  const unique = [...new Map((items || []).filter(item => item?.id).map(item => [item.id, item])).values()];
  if (!unique.length) return { selected: null, state: { signature: '', queue: [], last: '' } };
  const signature = unique.map(item => `${item.id}:${Math.max(1, Math.min(10, Number(item.heroWeight || item.weight || 1)))}`).sort().join('|');
  let state = previous && previous.signature === signature && Array.isArray(previous.queue)
    && previous.queue.every(id => unique.some(item => item.id === id))
    ? { signature, queue: [...previous.queue], last: String(previous.last || '') }
    : { signature, queue: [], last: '' };
  if (!state.queue.length) {
    state.queue = unique.map(item => ({
      id: item.id,
      key: Math.pow(Math.max(Number.EPSILON, random()), 1 / Math.max(1, Math.min(10, Number(item.heroWeight || item.weight || 1))))
    })).sort((left, right) => right.key - left.key).map(item => item.id);
    if (unique.length > 1 && state.queue[0] === state.last) {
      const swap = state.queue.findIndex(id => id !== state.last);
      [state.queue[0], state.queue[swap]] = [state.queue[swap], state.queue[0]];
    }
  }
  const selectedId = state.queue.shift();
  state.last = selectedId;
  return { selected: unique.find(item => item.id === selectedId) || unique[0], state };
}
