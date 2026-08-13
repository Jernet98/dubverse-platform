import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const routeUrl = new URL('../app/api/social/[...path]/route.js', import.meta.url);
const appUrl = new URL('../public/app.js', import.meta.url);
const pageUrl = new URL('../app/page.jsx', import.meta.url);

test('follow deriva identidad de sesión, impide self-follow y crea notificación sólo tras insertar', async () => {
  const route = await readFile(routeUrl, 'utf8');
  assert.match(route, /async function writeFollow/);
  assert.match(route, /target\.id === session\.row\.id/);
  assert.match(route, /INSERT INTO user_follows \(follower_profile_id, followed_profile_id\)[\s\S]*VALUES \(\$\{session\.row\.id\}, \$\{target\.id\}\)/);
  assert.match(route, /WITH followed AS[\s\S]*INSERT INTO social_notifications/);
  assert.match(route, /ON CONFLICT \(dedupe_key\) DO NOTHING/);
  assert.doesNotMatch(route, /body\.(?:follower|followed|actor|recipient|notificationType)/);
});

test('reply y primer like generan notificaciones deduplicadas sin acciones propias', async () => {
  const route = await readFile(routeUrl, 'utf8');
  assert.match(route, /'COMMENT_REPLY'[\s\S]*target\.author_profile_id[\s\S]*<> \$\{session\.row\.id\}/);
  assert.match(route, /WITH liked AS[\s\S]*ON CONFLICT DO NOTHING RETURNING comment_id[\s\S]*'COMMENT_LIKE'/);
  assert.match(route, /'like:' \|\| \$\{session\.row\.id\}::text/);
  assert.match(route, /comment\.author_profile_id[\s\S]*<> \$\{session\.row\.id\}/);
});

test('notificaciones son propias, paginadas y el unread count se recalcula en servidor', async () => {
  const route = await readFile(routeUrl, 'utf8');
  assert.match(route, /const NOTIFICATION_PAGE_SIZE = 15/);
  assert.match(route, /targetId: row\.target_type === 'COMMENT' \? row\.target_id : null/);
  assert.match(route, /WHERE n\.recipient_profile_id = \$\{session\.row\.id\}/);
  assert.match(route, /recipient_profile_id = \$\{session\.row\.id\}[\s\S]*read_at IS NULL/);
  assert.match(route, /UPDATE social_notifications SET read_at = COALESCE\(read_at, now\(\)\)[\s\S]*recipient_profile_id = \$\{session\.row\.id\}/);
  assert.match(route, /markAllNotificationsRead/);
});

test('respuestas reutilizan COMMENT para publicar, reemplazar y quitar imágenes', async () => {
  const route = await readFile(routeUrl, 'utf8');
  const app = await readFile(appUrl, 'utf8');
  assert.match(route, /SELECT id FROM episode_comments[\s\S]*moderation_status <> 'DELETED'/);
  assert.doesNotMatch(route, /parent_comment_id IS NULL AND image_media_id IS NULL/);
  assert.match(route, /oldMedia = await session\.sql[\s\S]*FROM episode_comments c/);
  assert.match(route, /async function deleteCommentImage/);
  assert.match(route, /DELETE FROM social_notifications WHERE target_type = 'COMMENT'/);
  assert.match(app, /result\.reply\.id[\s\S]*uploadUserImage\(file, 'COMMENT'/);
  assert.match(app, /La respuesta no se public.+ para evitar perder el adjunto/);
  assert.match(app, /data-reply-image-preview/);
  assert.match(app, /data-remove-comment-image/);
  assert.match(app, /else if \(removeExistingImage\) await socialWrite/);
});

test('vista visitante usa la API pública y navegación limpia sin filtrar la respuesta privada', async () => {
  const app = await readFile(appUrl, 'utf8');
  assert.match(app, /\/u\/\$\{encodeURIComponent\(profile\.username\)\}\?view=public/);
  assert.match(app, /visitorView[\s\S]*publicUserPage/);
  assert.match(app, /Salir de vista como visitante/);
  assert.match(app, /socialApi\(`\/users\/\$\{encodeURIComponent\(username\)\}`\)/);
  assert.doesNotMatch(app.slice(app.indexOf('async function publicUserPage'), app.indexOf('function historyMarkup')), /socialApi\('\/me'\)/);
});

test('campana, badge y deep links se actualizan sin polling continuo', async () => {
  const [app, page] = await Promise.all([readFile(appUrl, 'utf8'), readFile(pageUrl, 'utf8')]);
  assert.match(page, /id="notificationTrigger"/);
  assert.match(page, /id="notificationBadge"/);
  assert.match(app, /\/notifications\/unread-count/);
  assert.match(app, /\/notifications\?page=\$\{page\}/);
  assert.match(app, /\/notifications\/read-all/);
  assert.match(app, /\?comment=\$\{encodeURIComponent\(item\.targetId\)\}/);
  assert.match(app, /if \(viewer\) await refreshUnreadCount\(\)/);
  assert.doesNotMatch(app, /setInterval\([^)]*notification|setTimeout\([^)]*notification/);
});
