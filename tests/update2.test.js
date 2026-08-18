import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  episodePlayback,
  mapPromo,
  normalizedProgress,
  normalizeYouTubeId,
  promoValue,
  WATCH_COMPLETE_THRESHOLD
} from '../lib/update2.js';

const source = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('player central soporta Archive directo, fallback, video, HLS, estados y retry', async () => {
  const player = await source('public/player.js');
  const archive = episodePlayback({
    provider: 'ARCHIVE', archive_identifier: 'dubverse-demo', archive_file: 'episodio 01.mp4'
  });
  const direct = episodePlayback({ provider: 'DIRECT', video_url: 'https://cdn.example/video.mp4' });
  const hls = episodePlayback({ provider: 'HLS', video_url: 'https://cdn.example/master.m3u8' });

  assert.equal(archive.source.kind, 'VIDEO');
  assert.equal(archive.source.url, 'https://archive.org/download/dubverse-demo/episodio%2001.mp4');
  assert.match(archive.fallback.url, /^https:\/\/archive\.org\/embed\/dubverse-demo/);
  assert.equal(direct.source.kind, 'VIDEO');
  assert.equal(hls.source.kind, 'HLS');
  assert.match(player, /class DubversePlayer/);
  assert.match(player, /preload = 'metadata'/);
  for (const event of ['waiting', 'stalled', 'canplay', 'playing', 'seeking', 'seeked', 'error']) {
    assert.match(player, new RegExp(`addEventListener\\('${event}'`));
  }
  assert.match(player, /data-player-retry/);
  assert.match(player, /useFallback/);
  assert.match(player, /webkitEnterFullscreen/);
  assert.match(player, /initialTime[\s\S]*loadedmetadata/);
});

test('WatchProgress es único, se actualiza, recupera y completa integrando episode_watched', async () => {
  const migration = await source('database/migrations/2026-08-17-update-2.sql');
  const social = await source('app/api/social/[...path]/route.js');
  const app = await source('public/app.js');

  assert.equal(WATCH_COMPLETE_THRESHOLD, 0.92);
  assert.deepEqual(normalizedProgress(30, 100), { position: 30, duration: 100, ratio: 0.3, complete: false });
  assert.equal(normalizedProgress(92, 100).complete, true);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS watch_progress[\s\S]*PRIMARY KEY\(user_profile_id, episode_id\)/);
  assert.match(migration, /episode_id text NOT NULL REFERENCES episodes\(id\) ON UPDATE CASCADE ON DELETE CASCADE/);
  assert.match(social, /SELECT position_seconds, duration_seconds, updated_at FROM watch_progress/);
  assert.match(social, /INSERT INTO watch_progress[\s\S]*ON CONFLICT \(user_profile_id, episode_id\) DO UPDATE/);
  assert.match(social, /DELETE FROM watch_progress[\s\S]*INSERT INTO episode_watched[\s\S]*INSERT INTO episode_history/);
  assert.match(app, /12000/);
  assert.match(app, /keepalive: true/);
  assert.match(app, /initialTime: Number\(savedProgress/);
  assert.match(app, /CONTINUE_WATCHING|continueWatchingRow/);
});

test('material promocional normaliza YouTube y mantiene adapters seguros', () => {
  const id = 'AbCdEf12345';
  assert.equal(normalizeYouTubeId(`https://www.youtube.com/watch?v=${id}`), id);
  assert.equal(normalizeYouTubeId(`https://youtu.be/${id}`), id);
  assert.equal(normalizeYouTubeId(`https://www.youtube.com/embed/${id}`), id);
  assert.equal(normalizeYouTubeId(`https://youtube.com/shorts/${id}`), id);

  const youtube = promoValue({ type: 'TRAILER', provider: 'YOUTUBE', title: 'Tráiler', url: `https://youtu.be/${id}` });
  assert.equal(youtube.providerIdentifier, id);
  assert.equal(mapPromo({ id: '1', project_id: 'p', ...youtube, provider_identifier: id, provider_file: '', thumbnail_url: '', is_active: true }).playback.kind, 'YOUTUBE');

  const archive = promoValue({ type: 'TEASER', provider: 'ARCHIVE', title: 'Teaser', providerIdentifier: 'demo_item', providerFile: 'teaser.mp4' });
  assert.equal(archive.provider, 'ARCHIVE');
  const direct = promoValue({ type: 'PV', provider: 'DIRECT', title: 'PV', url: 'https://cdn.example/pv.mp4' });
  assert.equal(direct.url, 'https://cdn.example/pv.mp4');
  const other = promoValue({ type: 'SPECIAL', provider: 'OTHER', title: 'Especial', url: 'https://video.example/item' });
  assert.equal(other.provider, 'OTHER');
  assert.throws(() => promoValue({ type: 'TRAILER', provider: 'UNREGISTERED', title: 'X', url: 'https://example.com' }));
});

test('Próximamente se admite sin episodios y conserva material promocional independiente', async () => {
  const migration = await source('database/migrations/2026-08-17-update-2.sql');
  const api = await source('app/api/[...path]/route.js');
  const app = await source('public/app.js');
  assert.match(migration, /'ONGOING','UPCOMING','FINISHED'/);
  assert.match(api, /PROJECT_STATUSES = new Set\(\['ONGOING', 'UPCOMING'/);
  assert.match(api, /project_promo_media/);
  assert.match(app, /UPCOMING: 'Próximamente'/);
  assert.match(app, /Material promocional/);
  assert.match(app, /Episodios[\s\S]*Próximamente/);
});

test('membresías y panel aplican autorización central contra IDOR', async () => {
  const migration = await source('database/migrations/2026-08-17-update-2.sql');
  const access = await source('lib/studio-access.js');
  const panel = await source('app/api/studio-panel/[...path]/route.js');
  const admin = await source('app/api/admin/studio-access/[...path]/route.js');

  assert.match(migration, /CREATE TABLE IF NOT EXISTS studio_memberships/);
  assert.match(migration, /UNIQUE\(user_profile_id, studio_id\)/);
  assert.match(access, /studioAdminSession[\s\S]*sm\.user_profile_id = \$\{session\.row\.id\}[\s\S]*sm\.studio_id = \$\{studioId\}/);
  assert.match(access, /requireManagedProject[\s\S]*ps\.studio_id = \$\{session\.studioId\}/);
  assert.match(access, /requireManagedEpisode[\s\S]*ps\.studio_id = \$\{session\.studioId\}/);
  assert.match(access, /studioResourceAllowed[\s\S]*new Set\(resourceStudioIds \|\| \[\]\)\.has\(requestedStudioId\)/);
  assert.match(panel, /studioAdminSession\(request, path\[1\]\)/);
  assert.match(admin, /INSERT INTO studio_memberships/);
  assert.match(admin, /DELETE FROM studio_memberships/);
  assert.match(admin, /ON CONFLICT \(user_profile_id, studio_id\) DO UPDATE/);
});

test('identidad de estudio conserva actor real y rechaza membresías ajenas', async () => {
  const migration = await source('database/migrations/2026-08-17-update-2.sql');
  const access = await source('lib/studio-access.js');
  const social = await source('app/api/social/[...path]/route.js');
  assert.match(migration, /author_studio_id text/);
  assert.match(access, /assertStudioIdentity[\s\S]*sm\.user_profile_id = \$\{profileId\}[\s\S]*sm\.studio_id = \$\{studioId\}/);
  assert.match(social, /author_profile_id, author_studio_id, body/);
  assert.match(social, /assertStudioIdentity/);
  assert.match(social, /studioAuthor \|\| \(row\.author_profile_id/);
});

test('follow de estudios es único y las notificaciones sólo nacen al publicar', async () => {
  const migration = await source('database/migrations/2026-08-17-update-2.sql');
  const social = await source('app/api/social/[...path]/route.js');
  const notifications = await source('lib/studio-notifications.js');
  const api = await source('app/api/[...path]/route.js');

  assert.match(migration, /CREATE TABLE IF NOT EXISTS studio_follows[\s\S]*PRIMARY KEY\(user_profile_id, studio_id\)/);
  assert.match(social, /INSERT INTO studio_follows[\s\S]*ON CONFLICT DO NOTHING/);
  assert.match(social, /DELETE FROM studio_follows/);
  assert.match(notifications, /STUDIO_NEW_PROJECT/);
  assert.match(notifications, /STUDIO_NEW_EPISODE/);
  assert.match(notifications, /ON CONFLICT \(dedupe_key\) DO NOTHING/);
  assert.match(api, /if \(!old\.published && published\) await notifyStudioFollowers/);
  assert.doesNotMatch(api, /updated_at = now\(\)[^;]*notifyStudioFollowers/s);
});

test('hard delete elimina fila e imagen, deja sobrevivir respuestas y separa moderación', async () => {
  const migration = await source('database/migrations/2026-08-17-update-2.sql');
  const social = await source('app/api/social/[...path]/route.js');
  const moderation = await source('app/api/admin/moderation/[...path]/route.js');
  assert.match(migration, /episode_comments_parent_fk[\s\S]*ON DELETE SET NULL/);
  assert.match(social, /if \(rows\[0\]\.object_key\) await deleteR2Object/);
  assert.match(social, /UPDATE episode_comments SET parent_comment_id = NULL/);
  assert.match(social, /DELETE FROM episode_comments[\s\S]*author_profile_id = \$\{session\.row\.id\}/);
  assert.match(social, /DELETE FROM social_notifications/);
  assert.match(social, /DELETE FROM content_reports/);
  assert.doesNotMatch(social, /\[Comentario eliminado\]/);
  assert.match(moderation, /action === 'HIDE' \? 'HIDDEN' : 'VISIBLE'/);
});

test('carrusel usa 8 segundos, controles, swipe, visibilidad y reduced motion', async () => {
  const app = await source('public/app.js');
  const styles = await source('public/styles.css');
  const panelStyles = await source('public/studio-panel.css');
  assert.match(app, /setInterval\(\(\) => draw\(index \+ 1\), 8000\)/);
  assert.match(app, /data-carousel-previous/);
  assert.match(app, /data-carousel-next/);
  assert.match(app, /pointerdown/);
  assert.match(app, /pointerup/);
  assert.match(app, /visibilitychange/);
  assert.match(app, /prefers-reduced-motion: reduce/);
  assert.match(app, /mobileImageUrl/);
  assert.match(styles, /@media\(max-width:720px\)/);
  assert.match(panelStyles, /@media\(max-width:850px\)/);
});

test('la migración y rollback son explícitos y nunca se ejecutan desde requests', async () => {
  const migration = await source('database/migrations/2026-08-17-update-2.sql');
  const rollback = await source('database/migrations/2026-08-17-update-2.rollback.sql');
  const routes = (await Promise.all([
    source('app/api/[...path]/route.js'), source('app/api/social/[...path]/route.js'),
    source('app/api/studio-panel/[...path]/route.js')
  ])).join('\n');
  assert.match(migration, /^--[\s\S]*BEGIN;[\s\S]*COMMIT;\s*$/);
  assert.match(rollback, /ROLLBACK DESTRUCTIVO/);
  assert.match(rollback, /RAISE EXCEPTION/);
  assert.doesNotMatch(routes, /2026-08-17-update-2|readFile.*migration|ALTER TABLE|CREATE TABLE/);
});
