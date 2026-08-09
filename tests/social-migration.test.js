import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../database/migrations/2026-08-09-social-v1.sql', import.meta.url);
const routeUrl = new URL('../app/api/social/[...path]/route.js', import.meta.url);
const sessionUrl = new URL('../lib/social.js', import.meta.url);
const authUrl = new URL('../lib/user-auth.js', import.meta.url);
const moderationUrl = new URL('../app/api/admin/moderation/[...path]/route.js', import.meta.url);

test('la migración es explícita, transaccional y contiene las tablas sociales', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /^-- Dubverse Social v1\./);
  assert.match(sql, /BEGIN;[\s\S]*COMMIT;/);
  for (const table of ['auth_users', 'user_profiles', 'project_likes', 'episode_likes', 'favorites', 'watch_later', 'episode_history', 'episode_comments', 'project_reviews', 'content_reports', 'user_media_uploads', 'social_rate_limits']) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
  }
  assert.match(sql, /PRIMARY KEY\(user_profile_id, project_id\)/);
  assert.match(sql, /PRIMARY KEY\(user_profile_id, episode_id\)/);
  assert.match(sql, /UNIQUE\(author_profile_id, project_id\)/);
  assert.match(sql, /content_reports_reporter_target_unique/);
});

test('suspensión bloquea escrituras e invalida sesiones públicas', async () => {
  const [session, moderation] = await Promise.all([readFile(sessionUrl, 'utf8'), readFile(moderationUrl, 'utf8')]);
  assert.match(session, /active && row\.status !== 'ACTIVE'/);
  assert.match(moderation, /status === 'SUSPENDED'[\s\S]*DELETE FROM auth_sessions WHERE user_id/);
});

test('Better Auth mantiene admin separado y desactiva linking implícito', async () => {
  const source = await readFile(authUrl, 'utf8');
  assert.match(source, /disableImplicitLinking: true/);
  assert.match(source, /allowDifferentEmails: false/);
  assert.match(source, /emailAndPassword: \{ enabled: false \}/);
  assert.doesNotMatch(source, /ADMIN_ACCESS_KEY|dubverse_session/);
});

test('las rutas sociales no contienen DDL ni confían en user_id del body', async () => {
  const source = await readFile(routeUrl, 'utf8');
  assert.doesNotMatch(source, /\b(?:CREATE|ALTER|DROP)\s+TABLE\b/i);
  assert.doesNotMatch(source, /body\.(?:userId|user_id|role)/);
  assert.match(source, /socialSession\(request, \{ required: true, active: true \}\)/);
  assert.match(source, /author_profile_id = \$\{session\.row\.id\}/);
});
