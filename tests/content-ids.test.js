import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildContentIdAudit,
  contentIdValue,
  recommendedContentId
} from '../lib/content-ids.js';

const migrationUrl = new URL('../database/migrations/2026-08-13-content-id-aliases.sql', import.meta.url);
const rollbackUrl = new URL('../database/migrations/2026-08-13-content-id-aliases.rollback.sql', import.meta.url);
const adminRouteUrl = new URL('../app/api/admin/ids/[...path]/route.js', import.meta.url);
const publicRouteUrl = new URL('../app/api/[...path]/route.js', import.meta.url);

test('valida IDs explícitos sin corregir silenciosamente el valor ingresado', () => {
  assert.equal(contentIdValue('kyoukai-no-rinne-s01-e007'), 'kyoukai-no-rinne-s01-e007');
  for (const invalid of ['', 'Con Mayúsculas', 'doble--guion', '-inicio', 'final-', 'con_underscore', ' con-espacio']) {
    assert.throws(() => contentIdValue(invalid), /obligatorio|minúsculas/);
  }
  assert.throws(() => contentIdValue('a'.repeat(161)), /160/);
});

test('genera recomendaciones deterministas para proyectos, estudios y episodios', () => {
  assert.equal(recommendedContentId('projects', { title: 'Kyoukai no Rinne' }), 'kyoukai-no-rinne');
  assert.equal(recommendedContentId('studios', { name: 'Estudio Ánima' }), 'estudio-anima');
  assert.equal(recommendedContentId('episodes', { project_id: 'kyoukai-no-rinne', season: 1, number: 7 }), 'kyoukai-no-rinne-s01-e007');
});

test('la auditoría es de sólo lectura y distingue correcto, incorrecto y colisiones', () => {
  const input = {
    projects: [
      { id: 'correcto', title: 'Correcto', deleted_at: null },
      { id: 'slug-equivocado', title: 'Nombre Disponible', deleted_at: null },
      { id: 'otro', title: 'Ocupado', deleted_at: null },
      { id: 'ocupado', title: 'Destino', deleted_at: null },
      { id: 'anterior', title: 'Alias Reservado', deleted_at: null }
    ],
    studios: [], episodes: [],
    aliases: { projects: [{ alias: 'alias-reservado', target_id: 'correcto' }], studios: [], episodes: [] }
  };
  const snapshot = structuredClone(input);
  const items = buildContentIdAudit(input);
  assert.deepEqual(input, snapshot);
  assert.equal(items.find(item => item.currentId === 'correcto').status, 'CORRECT');
  assert.equal(items.find(item => item.currentId === 'slug-equivocado').status, 'INCORRECT');
  assert.equal(items.find(item => item.currentId === 'otro').status, 'CONFLICT');
  assert.equal(items.find(item => item.currentId === 'anterior').status, 'CONFLICT');
  assert.equal(items.find(item => item.currentId === 'correcto').aliasCount, 1);
});

test('la migración propaga las 16 relaciones conocidas mediante ON UPDATE CASCADE', async () => {
  const migration = await readFile(migrationUrl, 'utf8');
  const constraints = [
    'project_studios_project_id_fkey', 'project_studios_studio_id_fkey', 'episodes_project_id_fkey',
    'project_likes_project_id_fkey', 'episode_likes_episode_id_fkey', 'favorites_project_id_fkey',
    'watch_later_project_id_fkey', 'episode_history_episode_id_fkey', 'episode_comments_episode_id_fkey',
    'project_reviews_project_id_fkey', 'social_notifications_episode_id_fkey', 'episode_watched_episode_id_fkey',
    'home_featured_projects_project_id_fkey', 'home_featured_studios_studio_id_fkey',
    'home_hero_projects_project_id_fkey', 'home_curated_projects_project_id_fkey'
  ];
  for (const constraint of constraints) {
    assert.match(migration, new RegExp(`ADD CONSTRAINT ${constraint} FOREIGN KEY \\([^)]*\\) REFERENCES (?:projects|studios|episodes)\\(id\\) ON UPDATE CASCADE ON DELETE CASCADE`));
  }
  assert.match(migration, /^BEGIN;/m);
  assert.match(migration, /^COMMIT;/m);
});

test('aliases conservan historial, apuntan sólo a IDs vigentes y bloquean colisiones', async () => {
  const migration = await readFile(migrationUrl, 'utf8');
  for (const table of ['project_slug_aliases', 'studio_slug_aliases', 'episode_slug_aliases']) {
    assert.match(migration, new RegExp(`CREATE TABLE ${table}`));
  }
  assert.match(migration, /project_id text NOT NULL REFERENCES projects\(id\) ON UPDATE CASCADE ON DELETE CASCADE/);
  assert.match(migration, /studio_id text NOT NULL REFERENCES studios\(id\) ON UPDATE CASCADE ON DELETE CASCADE/);
  assert.match(migration, /episode_id text NOT NULL REFERENCES episodes\(id\) ON UPDATE CASCADE ON DELETE CASCADE/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /projects_slug_namespace_guard/);
  assert.match(migration, /project_aliases_slug_namespace_guard/);
});

test('renombrar usa una transacción, actualiza la PK y guarda el alias sin borrar/recrear', async () => {
  const [route, migration] = await Promise.all([readFile(adminRouteUrl, 'utf8'), readFile(migrationUrl, 'utf8')]);
  assert.match(route, /await sql\.transaction\(\[query\]\)/);
  assert.match(route, /SELECT dubverse_rename_project_slug/);
  assert.match(route, /SELECT dubverse_rename_studio_slug/);
  assert.match(route, /SELECT dubverse_rename_episode_slug/);
  assert.match(migration, /UPDATE projects SET id = p_new_id/);
  assert.match(migration, /UPDATE studios SET id = p_new_id/);
  assert.match(migration, /UPDATE episodes SET id = p_new_id/);
  assert.match(migration, /INSERT INTO project_slug_aliases \(alias, project_id\)/);
  assert.doesNotMatch(route, /DELETE FROM (projects|studios|episodes)/);
  assert.doesNotMatch(migration, /DELETE FROM (projects|studios|episodes)/);
  assert.match(route, /23503[\s\S]*revertido completamente/);
});

test('colisiones y confirmación incorrecta abortan antes de aceptar el cambio', async () => {
  const [route, migration] = await Promise.all([readFile(adminRouteUrl, 'utf8'), readFile(migrationUrl, 'utf8')]);
  assert.match(migration, /IF EXISTS \(SELECT 1 FROM projects WHERE id = p_new_id\)/);
  assert.match(migration, /IF EXISTS \(SELECT 1 FROM project_slug_aliases WHERE alias = p_new_id\)/);
  assert.match(route, /body\.confirmId[\s\S]*!== currentId/);
  assert.match(route, /nuevo ID ya está ocupado por un registro o alias histórico/);
});

test('Admin muestra auditoría y exige confirmación explícita antes de renombrar', async () => {
  const [admin, page] = await Promise.all([
    readFile(new URL('../public/admin.js', import.meta.url), 'utf8'),
    readFile(new URL('../app/admin/page.jsx', import.meta.url), 'utf8')
  ]);
  for (const label of ['Tipo', 'Nombre', 'ID actual', 'ID recomendado', 'Estado', 'Cambiar ID / slug']) {
    assert.match(`${admin}\n${page}`, new RegExp(label));
  }
  assert.match(page, /Escribe el ID actual para confirmar/);
  assert.match(admin, /confirmId !== idRenameTarget\.currentId/);
  assert.match(admin, /api\('\/api\/admin\/ids\/rename'/);
});

test('URLs antiguas reciben 308 y la SPA normaliza proyecto, estudio y episodio', async () => {
  const [route, app] = await Promise.all([
    readFile(publicRouteUrl, 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8')
  ]);
  assert.match(route, /NextResponse\.redirect\(target, 308\)/);
  assert.match(route, /project_slug_aliases WHERE alias/);
  assert.match(route, /studio_slug_aliases WHERE alias/);
  assert.match(route, /episode_slug_aliases WHERE alias/);
  assert.match(app, /canonicalizeContentPath\('proyecto'/);
  assert.match(app, /canonicalizeContentPath\('estudio'/);
  assert.match(app, /canonicalizeContentPath\('ver'/);
  assert.match(app, /history\.replaceState/);
});

test('el respaldo administrativo incluye el historial de aliases sin exigir la migración para datos existentes', async () => {
  const route = await readFile(publicRouteUrl, 'utf8');
  assert.match(route, /contentAliases = \{ projects: projectAliases, studios: studioAliases, episodes: episodeAliases \}/);
  assert.match(route, /if \(!isAliasSchemaMissing\(error\)\) throw error/);
  assert.match(route, /version: 3[\s\S]*contentAliases/);
});

test('rollback está separado, advierte la pérdida de aliases y restaura NO ACTION implícito', async () => {
  const rollback = await readFile(rollbackUrl, 'utf8');
  assert.match(rollback, /ROLLBACK DESTRUCTIVO/);
  assert.match(rollback, /^BEGIN;/m);
  assert.match(rollback, /DROP TABLE IF EXISTS project_slug_aliases/);
  assert.doesNotMatch(rollback, /ON UPDATE CASCADE/);
  assert.match(rollback, /^COMMIT;/m);
});
