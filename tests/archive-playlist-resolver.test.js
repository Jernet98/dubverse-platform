import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolveArchiveEpisodePlayback, resolveArchivePlaylist } from '../lib/archive.js';
import { archiveEmbedUrlSafe, episodePlayback } from '../lib/update2.js';

const fixtures = JSON.parse(await readFile(new URL('./fixtures/archive-playlists.json', import.meta.url), 'utf8'));
const source = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('item single-video resuelve su única entrada audiovisual', () => {
  const result = resolveArchivePlaylist(fixtures.single);
  assert.equal(result.status, 'READY');
  assert.equal(result.entries.length, 1);
  assert.equal(result.selected.orig, 'Episodio único.mp4');
});

test('multiarchivo exige coincidencia y resuelve orig o derivative', () => {
  const original = resolveArchivePlaylist(fixtures.uruwashi, 'dubverse-uruwashi-no-yoi-no-tsuki-s01-e001.mp4');
  const derivative = resolveArchivePlaylist(fixtures.uruwashi, 'dubverse-uruwashi-no-yoi-no-tsuki-s01-e001.ia.mp4');
  assert.equal(original.entries.length, 4);
  assert.equal(original.selected.orig, 'dubverse-uruwashi-no-yoi-no-tsuki-s01-e001.mp4');
  assert.equal(derivative.selected.orig, original.selected.orig);
  assert.equal(resolveArchivePlaylist(fixtures.uruwashi).status, 'FILE_REQUIRED');
  assert.equal(resolveArchivePlaylist(fixtures.uruwashi, 'missing.mp4').status, 'FILE_NOT_FOUND');
});

test('Dororo normaliza el plus legado sólo cuando no existe un filename literal', () => {
  assert.equal(resolveArchivePlaylist(fixtures.dororo, 'Dororo+Capitulo+1.mp4').selected.orig, 'Dororo Capitulo 1.mp4');
  assert.equal(resolveArchivePlaylist(fixtures.literalPlus, 'Capitulo+Especial.mp4').selected.orig, 'Capitulo+Especial.mp4');
});

test('percent encoding, espacios y Unicode se decodifican una sola vez', () => {
  assert.equal(resolveArchivePlaylist(fixtures.single, 'Episodio%20%C3%BAnico.mp4').selected.orig, 'Episodio único.mp4');
  assert.equal(resolveArchivePlaylist(fixtures.single, 'Episodio único.mp4').selected.orig, 'Episodio único.mp4');
  assert.equal(resolveArchivePlaylist(fixtures.unicode, 'Cap%C3%ADtulo%20%C3%B1.mp4').selected.orig, 'Capítulo ñ.mp4');
  assert.equal(archiveEmbedUrlSafe('item', 'Capítulo ñ.mp4'), 'https://archive.org/embed/item/Cap%C3%ADtulo%20%C3%B1.mp4');
  assert.doesNotMatch(archiveEmbedUrlSafe('item', 'Capítulo ñ.mp4'), /%25/);
});

test('item sin video y referencia inválida producen estado explícito', () => {
  assert.equal(resolveArchivePlaylist(fixtures.noVideo, '').status, 'NO_VIDEO');
  assert.equal(resolveArchivePlaylist([], 'episode.mp4').status, 'NO_VIDEO');
});

test('single usa embed de item, multi usa orig exacto e identifier inexistente no genera iframe', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async url => {
      const identifier = String(url).split('/').pop();
      if (identifier === 'missing-fixture') return new Response('', { status: 404 });
      const files = identifier === 'single-fixture' ? fixtures.single : fixtures.uruwashi;
      return Response.json({ metadata: { identifier }, files });
    };
    const single = await resolveArchiveEpisodePlayback({ archive_identifier: 'single-fixture', archive_file: 'Episodio%20%C3%BAnico.mp4' });
    const multi = await resolveArchiveEpisodePlayback({ archive_identifier: 'multi-fixture', archive_file: 'dubverse-uruwashi-no-yoi-no-tsuki-s01-e001.ia.mp4' });
    const missing = await resolveArchiveEpisodePlayback({ archive_identifier: 'missing-fixture', archive_file: 'episode.mp4' });
    assert.equal(single.fallback.url, 'https://archive.org/embed/single-fixture');
    assert.equal(multi.fallback.url, 'https://archive.org/embed/multi-fixture/dubverse-uruwashi-no-yoi-no-tsuki-s01-e001.mp4');
    assert.equal(missing.status, 'UNRESOLVED');
    assert.equal(missing.reason, 'IDENTIFIER_NOT_FOUND');
    assert.equal(missing.fallback, null);
  } finally { globalThis.fetch = originalFetch; }
});

test('la API resuelve Archive antes de emitir iframe y conserva DIRECT/HLS', async () => {
  const [api, archive, app, player] = await Promise.all([
    source('app/api/[...path]/route.js'), source('lib/archive.js'), source('public/app.js'), source('public/player.js')
  ]);
  assert.match(api, /row\.provider === 'ARCHIVE' \? await resolveArchiveEpisodePlayback/);
  assert.match(archive, /playlist\.entries\.length === 1[\s\S]*archiveEmbedUrl\(identifier\)[\s\S]*archiveEmbedUrl\(identifier, playlist\.selected\.orig\)/);
  assert.match(archive, /status: 'UNRESOLVED'/);
  assert.match(app, /Este episodio no pudo cargarse desde Archive\.org/);
  assert.match(app, /data-archive-retry/);
  assert.doesNotMatch(app.slice(app.indexOf('function mountArchiveEmbed'), app.indexOf('function initializeEditorialCarousel')), /allowfullscreen/);
  assert.match(app, /allow="autoplay; fullscreen"/);
  assert.doesNotMatch(archive, /retry|setInterval/);
  assert.equal(episodePlayback({ provider: 'DIRECT', video_url: 'https://cdn.example/episode.mp4' }).source.kind, 'VIDEO');
  assert.equal(episodePlayback({ provider: 'HLS', video_url: 'https://cdn.example/master.m3u8' }).source.kind, 'HLS');
  assert.match(player, /class DubversePlayer/);
});
