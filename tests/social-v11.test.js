import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../database/migrations/2026-08-12-comment-replies-likes.sql', import.meta.url);
const rollbackUrl = new URL('../database/migrations/2026-08-12-comment-replies-likes.rollback.sql', import.meta.url);
const routeUrl = new URL('../app/api/social/[...path]/route.js', import.meta.url);
const moderationUrl = new URL('../app/api/admin/moderation/[...path]/route.js', import.meta.url);
const appUrl = new URL('../public/app.js', import.meta.url);
const stylesUrl = new URL('../public/styles.css', import.meta.url);

test('la migración v1.1 es aditiva, transaccional y conserva comentarios existentes como raíces', async () => {
  const [migration, rollback] = await Promise.all([readFile(migrationUrl, 'utf8'), readFile(rollbackUrl, 'utf8')]);
  assert.match(migration, /^-- Dubverse Social v1\.1/);
  assert.match(migration, /BEGIN;[\s\S]*ALTER TABLE episode_comments[\s\S]*ADD COLUMN IF NOT EXISTS parent_comment_id uuid[\s\S]*COMMIT;/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS comment_likes/);
  assert.match(migration, /PRIMARY KEY\(user_profile_id, comment_id\)/);
  assert.match(migration, /FOREIGN KEY \(parent_comment_id\) REFERENCES episode_comments\(id\) ON DELETE CASCADE/);
  assert.match(migration, /episode_comments_replies_recent_idx/);
  assert.doesNotMatch(migration, /UPDATE episode_comments|INSERT INTO episode_comments|DELETE FROM episode_comments/);
  assert.match(rollback, /ADVERTENCIA:[\s\S]*DROP TABLE IF EXISTS comment_likes/);
});

test('la API normaliza respuestas a una raíz y obtiene identidad, ownership y contadores en servidor', async () => {
  const route = await readFile(routeUrl, 'utf8');
  assert.match(route, /const REPLY_PAGE_SIZE = 5/);
  assert.match(route, /const rootId = target\.parent_comment_id \|\| target\.id/);
  assert.match(route, /parent_comment_id IS NULL[\s\S]*moderation_status = 'VISIBLE'/);
  assert.match(route, /INSERT INTO episode_comments \(id, episode_id, author_profile_id, body, parent_comment_id, reply_to_profile_id\)/);
  assert.match(route, /VALUES \(\$\{crypto\.randomUUID\(\)\}::uuid, \$\{target\.episode_id\}, \$\{session\.row\.id\}/);
  assert.doesNotMatch(route, /body\.(?:parent|parentCommentId|replyToProfileId|author|userId)/);
  assert.match(route, /comment-like', 120, 60/);
  assert.match(route, /ON CONFLICT DO NOTHING/);
  assert.match(route, /SELECT COUNT\(\*\)::int AS count/);
  assert.match(route, /WHERE c\.episode_id = \$\{episodeId\} AND c\.parent_comment_id IS NULL/);
  assert.match(route, /commentReplies\(request, sql, path\[1\], page\)/);
});

test('respuestas reutilizan edición, borrado, reportes y moderación existentes', async () => {
  const [route, moderation] = await Promise.all([readFile(routeUrl, 'utf8'), readFile(moderationUrl, 'utf8')]);
  assert.match(route, /author_profile_id = \$\{session\.row\.id\}[\s\S]*moderation_status <> 'DELETED'/);
  assert.match(route, /targetType === 'COMMENT'[\s\S]*FROM episode_comments/);
  assert.match(moderation, /row\.parent_comment_id \? 'REPLY' : 'COMMENT'/);
  assert.match(moderation, /UPDATE episode_comments SET moderation_status/);
  assert.match(moderation, /DELETE FROM episode_comments/);
});

test('UI incluye carga progresiva, likes, respuesta inline y lightbox accesible', async () => {
  const [app, styles] = await Promise.all([readFile(appUrl, 'utf8'), readFile(stylesUrl, 'utf8')]);
  assert.match(app, /Ver \$\{replyCount\} respuesta/);
  assert.match(app, /\/replies\?page=\$\{page\}/);
  assert.match(app, /Ver más respuestas/);
  assert.match(app, /data-reply-composer/);
  assert.match(app, /maxlength="1500"/);
  assert.match(app, /data-like-comment/);
  assert.match(app, /result\.likeCount/);
  assert.match(app, /aria-modal', 'true'/);
  assert.match(app, /event\.key === 'Escape'/);
  assert.match(app, /addEventListener\('wheel'[\s\S]*passive: false/);
  assert.match(app, /onpointermove/);
  assert.match(app, /document\.body\.classList\.add\('lightbox-open'\)/);
  assert.match(styles, /max-width:min\(100%,360px\);max-height:360px/);
  assert.match(styles, /\.reply-thread:before/);
  assert.match(styles, /touch-action:none/);
});
