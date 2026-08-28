import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { projectMetadataValue, safeAnnouncementLink } from '../lib/content-discovery.js';

const source = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('metadata restringida valida edad, advertencias y listas compatibles', () => {
  const value = projectMetadataValue({ originalTitle: '進撃の巨人', alternateTitles: 'Shingeki no Kyojin\nAtaque a los Titanes', searchAliases: 'AOT, SNK', ageRating: 'AGE_18', contentWarnings: ['GRAPHIC_VIOLENCE'] });
  assert.deepEqual(value.alternateTitles, ['Shingeki no Kyojin', 'Ataque a los Titanes']);
  assert.deepEqual(value.searchAliases, ['AOT', 'SNK']);
  assert.equal(value.ageRating, 'AGE_18');
  assert.throws(() => projectMetadataValue({ ageRating: 'AGE_21' }), /no permitida/);
  assert.throws(() => projectMetadataValue({ contentWarnings: ['INVENTED'] }), /no permitido/);
});

test('links administrativos bloquean protocolos peligrosos', () => {
  assert.equal(safeAnnouncementLink('/proyecto/demo'), '/proyecto/demo');
  assert.equal(safeAnnouncementLink('https://status.example.com/incidente'), 'https://status.example.com/incidente');
  assert.throws(() => safeAnnouncementLink('javascript:alert(1)'), /HTTPS/);
  assert.throws(() => safeAnnouncementLink('//evil.example'), /válido/);
});

test('migración es aditiva, activa pg_trgm y conserva alternative_title', async () => {
  const migration = await source('database/migrations/2026-08-28-discovery-safety-announcements.sql');
  assert.match(migration, /CREATE EXTENSION IF NOT EXISTS pg_trgm/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS original_title/);
  assert.match(migration, /UPDATE projects[\s\S]*alternate_title/);
  assert.match(migration, /NOT EXISTS \([\s\S]*jsonb_array_elements_text\(alternate_titles\)/);
  assert.match(migration, /projects_search_trgm_idx/);
  assert.match(migration, /studios_name_trgm_idx/);
  assert.match(migration, /user_profiles\.id debe ser uuid/);
  assert.doesNotMatch(migration, /DROP COLUMN|DELETE FROM projects/);
});

test('migración simple crea índices actuales antes de retirar el índice amplio', async () => {
  const migration = await source('database/migrations/2026-08-28-simplify-title-search.sql');
  assert.match(migration, /^--[\s\S]*BEGIN;[\s\S]*COMMIT;/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS projects_title_search_trgm_idx/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS projects_alternate_title_search_trgm_idx/);
  assert.ok(migration.indexOf('projects_title_search_trgm_idx') < migration.indexOf('DROP INDEX IF EXISTS projects_search_trgm_idx'));
  assert.doesNotMatch(migration, /UPDATE|INSERT|DELETE FROM|DROP COLUMN|ALTER TABLE/);
});

test('backend impone permisos, búsqueda fuzzy y distribución sin N+1', async () => {
  const api = await source('app/api/[...path]/route.js');
  const panel = await source('app/api/studio-panel/[[...path]]/route.js');
  const notifications = await source('lib/content-notifications.js');
  const announcements = await source('app/api/admin/announcements/route.js');
  assert.match(api, /similarity\(/);
  assert.match(api, /title_search[\s\S]*alternate_search/);
  assert.doesNotMatch(api.match(/if \(path\[0\] === 'search'[\s\S]*?return json\(\{ projects:/)?.[0] || '', /original_title|alternate_titles|search_aliases/);
  assert.doesNotMatch(panel, /alternate_title =/);
  assert.match(announcements, /requireAdmin\(request\)/);
  assert.match(notifications, /SELECT DISTINCT|UNION/);
  assert.match(notifications, /ON CONFLICT \(dedupe_key\) DO NOTHING/);
  assert.match(notifications, /INSERT INTO admin_announcements[\s\S]*ON CONFLICT \(dedupe_key\) DO NOTHING[\s\S]*INSERT INTO social_notifications/);
  assert.match(notifications, /announcement:\$\{value\.requestId\}/);
  assert.match(announcements, /requestId/);
});

test('frontend conserva Mi perfil, perfil público, share y gate persistente', async () => {
  const app = await source('public/app.js');
  assert.match(app, /parts\[0\] === 'perfil'[\s\S]*ownProfilePage/);
  assert.match(app, /parts\[0\] === 'u'[\s\S]*publicUserPage/);
  assert.match(app, /navigator\.clipboard\.writeText/);
  assert.match(app, /dubverse:age-18-confirmed:v1/);
  assert.match(app, /socialApi\('\/age-confirmation'/);
});
