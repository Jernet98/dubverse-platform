import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { notificationImageUrl } from '../lib/content-notifications.js';

const source = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('notificación de estudio conserva su logo mediante el actor de estudio', async () => {
  assert.equal(notificationImageUrl({ type: 'GLOBAL_NEW_STUDIO', target_type: 'STUDIO', project_poster: 'wrong.jpg' }), '');
  const route = await source('app/api/social/[...path]/route.js');
  assert.match(route, /COALESCE\(actor_studio\.logo, direct_studio\.logo\) AS actor_studio_logo/);
  assert.match(route, /avatar: row\.actor_studio_logo \|\| ''/);
});

test('notificación de proyecto prefiere poster y usa banner como fallback', () => {
  assert.equal(notificationImageUrl({ type: 'GLOBAL_NEW_PROJECT', target_type: 'PROJECT', project_poster: 'poster.jpg', project_banner: 'banner.jpg' }), 'poster.jpg');
  assert.equal(notificationImageUrl({ type: 'GLOBAL_NEW_PROJECT', target_type: 'PROJECT', project_poster: '', project_banner: 'banner.jpg' }), 'banner.jpg');
  assert.equal(notificationImageUrl({ type: 'GLOBAL_NEW_PROJECT', target_type: 'PROJECT', project_poster: null, project_banner: null }), '');
  assert.equal(notificationImageUrl({ type: 'STUDIO_NEW_PROJECT', target_type: 'PROJECT', project_poster: 'studio-project.jpg' }), 'studio-project.jpg');
});

test('notificaciones antiguas se resuelven al leer sin migrar ni duplicar imágenes', async () => {
  const [route, app, notifications] = await Promise.all([
    source('app/api/social/[...path]/route.js'), source('public/app.js'), source('lib/content-notifications.js')
  ]);
  assert.match(route, /direct_project\.poster AS project_poster, direct_project\.banner AS project_banner/);
  assert.match(route, /imageUrl: notificationImageUrl\(row\)/);
  assert.match(app, /item\.imageUrl \|\| avatarImage\(item\.actor\)/);
  assert.match(app, /GLOBAL_NEW_PROJECT[\s\S]*\/proyecto\/\$\{encodeURIComponent\(item\.projectId\)\}/);
  assert.match(notifications, /ON CONFLICT \(dedupe_key\) DO NOTHING/);
  const projectInsert = notifications.match(/export async function notifyGlobalProject[\s\S]*?(?=export async function notifyRelatedEpisode)/)?.[0] || '';
  assert.doesNotMatch(projectInsert, /image_url|project_poster|project_banner/);
});

test('imagen explícita de anuncios mantiene prioridad y filas legacy conservan fallback limpio', () => {
  assert.equal(notificationImageUrl({ image_url: 'announcement.jpg', type: 'GLOBAL_NEW_PROJECT', target_type: 'PROJECT', project_poster: 'poster.jpg' }), 'announcement.jpg');
  assert.equal(notificationImageUrl({ type: 'FOLLOW', target_type: 'PROFILE' }), '');
  assert.equal(notificationImageUrl({}), '');
});
