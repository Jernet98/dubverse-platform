import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../database/migrations/2026-08-09-social-v1.sql', import.meta.url);
const watchedMigrationUrl = new URL('../database/migrations/2026-08-12-manual-episode-watched.sql', import.meta.url);
const socialV12MigrationUrl = new URL('../database/migrations/2026-08-12-follows-notifications.sql', import.meta.url);
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

test('visto manual usa una migración aditiva independiente del historial', async () => {
  const [sql, route] = await Promise.all([readFile(watchedMigrationUrl, 'utf8'), readFile(routeUrl, 'utf8')]);
  assert.match(sql, /^-- Dubverse Social: estado manual de episodios vistos\./);
  assert.match(sql, /BEGIN;[\s\S]*CREATE TABLE IF NOT EXISTS episode_watched[\s\S]*COMMIT;/);
  assert.match(sql, /PRIMARY KEY\(user_profile_id, episode_id\)/);
  assert.doesNotMatch(sql, /INSERT INTO episode_watched[\s\S]*SELECT[\s\S]*episode_history/i);
  assert.match(route, /SELECT w\.episode_id FROM episode_watched/);
  assert.match(route, /INSERT INTO episode_watched/);
  assert.match(route, /DELETE FROM episode_watched/);
  assert.match(route, /historyRecorded: true/);
  assert.doesNotMatch(route, /episode_history[^\n]+AS (?:seen|watched)/i);
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
  assert.match(source, /@oauth\.invalid/);
  assert.doesNotMatch(source, /ADMIN_ACCESS_KEY|dubverse_session/);
});

test('las rutas sociales no contienen DDL ni confían en user_id del body', async () => {
  const source = await readFile(routeUrl, 'utf8');
  assert.doesNotMatch(source, /\b(?:CREATE|ALTER|DROP)\s+TABLE\b/i);
  assert.doesNotMatch(source, /body\.(?:userId|user_id|role)/);
  assert.match(source, /socialSession\(request, \{ required: true, active: true \}\)/);
  assert.match(source, /author_profile_id = \$\{session\.row\.id\}/);
});

test('Social v1.2 agrega follows y notificaciones de forma explícita y aditiva', async () => {
  const sql = await readFile(socialV12MigrationUrl, 'utf8');
  assert.match(sql, /^-- Dubverse Social v1\.2/);
  assert.match(sql, /BEGIN;[\s\S]*CREATE TABLE IF NOT EXISTS user_follows[\s\S]*CREATE TABLE IF NOT EXISTS social_notifications[\s\S]*COMMIT;/);
  assert.match(sql, /PRIMARY KEY\(follower_profile_id, followed_profile_id\)/);
  assert.match(sql, /user_follows_not_self CHECK \(follower_profile_id <> followed_profile_id\)/);
  assert.match(sql, /dedupe_key text NOT NULL UNIQUE/);
  assert.match(sql, /social_notifications_recipient_read_recent_idx[\s\S]*recipient_profile_id, read_at, created_at DESC/);
  assert.doesNotMatch(sql, /UPDATE user_profiles|UPDATE episode_comments|DELETE FROM/);
});
