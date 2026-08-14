import { AppError, slugify } from './db.js';

export const CONTENT_ID_KINDS = new Set(['projects', 'studios', 'episodes']);
export const CONTENT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function contentIdValue(value, label = 'El nuevo ID') {
  const raw = String(value ?? '');
  const id = raw.trim();
  if (!id) throw new AppError(400, `${label} es obligatorio.`);
  if (raw !== id || id.length > 160 || !CONTENT_ID_PATTERN.test(id)) {
    throw new AppError(400, `${label} debe usar sólo minúsculas, números y guiones simples, sin espacios, y tener máximo 160 caracteres.`);
  }
  return id;
}

export function contentKindValue(value) {
  const kind = String(value || '').trim();
  if (!CONTENT_ID_KINDS.has(kind)) throw new AppError(400, 'El tipo de contenido no es válido.');
  return kind;
}

export function recommendedContentId(kind, row) {
  if (kind === 'projects') return slugify(row.title);
  if (kind === 'studios') return slugify(row.name);
  if (kind === 'episodes') {
    const season = String(Number(row.season || 1)).padStart(2, '0');
    const number = String(Number(row.number || 1)).padStart(3, '0');
    return slugify(`${row.project_id}-s${season}-e${number}`);
  }
  throw new AppError(400, 'El tipo de contenido no es válido.');
}

function displayName(kind, row) {
  if (kind === 'projects') return row.title;
  if (kind === 'studios') return row.name;
  return `${row.project_title || row.project_id} · T${row.season} E${String(row.number).padStart(2, '0')} — ${row.title}`;
}

function auditKind(kind, rows, aliases) {
  const currentIds = new Set(rows.map(row => row.id));
  const aliasTargets = new Map(aliases.map(row => [row.alias, row.target_id]));
  const aliasesPerTarget = new Map();
  for (const alias of aliases) aliasesPerTarget.set(alias.target_id, (aliasesPerTarget.get(alias.target_id) || 0) + 1);

  return rows.map(row => {
    const recommendedId = recommendedContentId(kind, row);
    const currentConflict = recommendedId !== row.id && currentIds.has(recommendedId);
    const aliasConflict = aliasTargets.has(recommendedId);
    const correct = recommendedId === row.id;
    const status = correct ? 'CORRECT' : currentConflict || aliasConflict ? 'CONFLICT' : 'INCORRECT';
    const detail = currentConflict
      ? 'El ID recomendado ya pertenece a otro registro vigente.'
      : aliasConflict
        ? `El ID recomendado ya está reservado como alias de ${aliasTargets.get(recommendedId)}.`
        : correct ? 'El ID coincide con la recomendación actual.' : 'Disponible para corrección manual.';
    return {
      kind,
      name: displayName(kind, row),
      currentId: row.id,
      recommendedId,
      status,
      detail,
      deleted: Boolean(row.deleted_at),
      aliasCount: aliasesPerTarget.get(row.id) || 0
    };
  });
}

export function buildContentIdAudit({ projects = [], studios = [], episodes = [], aliases = {} } = {}) {
  return [
    ...auditKind('projects', projects, aliases.projects || []),
    ...auditKind('studios', studios, aliases.studios || []),
    ...auditKind('episodes', episodes, aliases.episodes || [])
  ].sort((left, right) => {
    const order = { CONFLICT: 0, INCORRECT: 1, CORRECT: 2 };
    return order[left.status] - order[right.status] || left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name, 'es');
  });
}

export function isAliasSchemaMissing(error) {
  return ['42P01', '42703', '42883'].includes(error?.code);
}
