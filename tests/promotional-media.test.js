import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  detectPromotionalMediaUrl,
  mapPromo,
  mapPromoResolved,
  promoValue,
  resolvedPromoValue,
  resolveTikTokShortUrl
} from '../lib/update2.js';

const source = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const detected = url => detectPromotionalMediaUrl(url).provider;

test('detecta y normaliza proveedores promocionales desde una única URL', () => {
  assert.equal(detected('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'YOUTUBE');
  assert.equal(detected('https://youtu.be/dQw4w9WgXcQ'), 'YOUTUBE');
  assert.equal(detected('https://youtube.com/shorts/dQw4w9WgXcQ'), 'YOUTUBE');
  assert.equal(detected('https://www.tiktok.com/@dubverse/video/7421234567890123456'), 'TIKTOK');
  assert.equal(detected('https://vt.tiktok.com/ZShortOne/'), 'TIKTOK_SHORT');
  assert.equal(detected('https://vm.tiktok.com/ZShortTwo/'), 'TIKTOK_SHORT');
  assert.equal(detected('https://vimeo.com/76979871'), 'VIMEO');
  assert.equal(detected('https://archive.org/embed/demo_item/video%20final.mp4'), 'ARCHIVE');
  assert.equal(detected('https://cdn.example/video.mp4?token=ok'), 'DIRECT');
  assert.equal(detected('https://cdn.example/video.webm'), 'DIRECT');
  assert.equal(detected('https://cdn.example/master.m3u8'), 'HLS');
  assert.equal(detected('https://example.com/watch/123'), 'OTHER');
  assert.equal(detected('javascript:alert(1)'), 'INVALID');
  assert.equal(detected('no-es-url'), 'INVALID');
});

test('resuelve vt/vm sólo mediante redirects HTTPS oficiales y limita el salto', async () => {
  const id = '7421234567890123456';
  for (const host of ['vt.tiktok.com', 'vm.tiktok.com']) {
    const calls = [];
    const resolved = await resolveTikTokShortUrl(`https://${host}/ZShort/`, {
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return new Response(null, { status: 302, headers: { location: `https://www.tiktok.com/@dubverse/video/${id}?is_from_webapp=1` } });
      }
    });
    assert.deepEqual(resolved, { id, url: `https://www.tiktok.com/@_/video/${id}` });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.redirect, 'manual');
  }
  let canonicalFetches = 0;
  assert.equal(detectPromotionalMediaUrl(`https://www.tiktok.com/@dubverse/video/${id}`).provider, 'TIKTOK');
  const canonical = await resolvedPromoValue({ type: 'TRAILER', title: 'Canon', url: `https://www.tiktok.com/@dubverse/video/${id}` }, {}, { fetchImpl: async () => { canonicalFetches += 1; } });
  assert.equal(canonical.providerIdentifier, id);
  assert.equal(canonicalFetches, 0);
  const persisted = await resolvedPromoValue({ type: 'TRAILER', title: 'Short', url: 'https://vt.tiktok.com/ZPersist/' }, {}, {
    fetchImpl: async () => new Response(null, { status: 302, headers: { location: `https://www.tiktok.com/@dubverse/video/${id}` } })
  });
  assert.equal(persisted.provider, 'TIKTOK');
  assert.equal(persisted.url, `https://www.tiktok.com/@_/video/${id}`);
  assert.equal(persisted.providerIdentifier, id);
});

test('rechaza redirects fuera de TikTok y conserva fallback limpio', async () => {
  const rejected = await resolveTikTokShortUrl('https://vt.tiktok.com/ZUnsafe/', {
    fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/@user/video/7421234567890123456' } })
  });
  assert.equal(rejected, null);
  assert.equal(await resolveTikTokShortUrl('http://vt.tiktok.com/ZHttp/'), null);
  assert.equal(await resolveTikTokShortUrl('not-a-url'), null);
  await assert.rejects(
    resolvedPromoValue({ type: 'TRAILER', title: 'Short roto', url: 'https://vt.tiktok.com/ZBroken/' }, {}, { fetchImpl: async () => new Response(null, { status: 404 }) }),
    /No se pudo resolver el enlace corto de TikTok/
  );
  const fallback = await mapPromoResolved({ id: 'legacy', project_id: 'p', type: 'TRAILER', title: 'Legacy', provider: 'OTHER', url: 'https://vt.tiktok.com/ZBroken/', is_active: true }, { fetchImpl: async () => new Response(null, { status: 404 }) });
  assert.equal(fallback.playback.kind, 'UNSUPPORTED');
});

test('OTHER legacy con shortlink TikTok obtiene player oficial 9:16', async () => {
  const id = '7421234567890123456';
  const promo = await mapPromoResolved({ id: 'legacy', project_id: 'p', type: 'TRAILER', title: 'Legacy TikTok', provider: 'OTHER', url: 'https://vm.tiktok.com/ZLegacy/', is_active: true }, {
    fetchImpl: async () => new Response(null, { status: 301, headers: { location: `https://www.tiktok.com/@dubverse/video/${id}` } })
  });
  assert.equal(promo.provider, 'TIKTOK');
  assert.equal(promo.url, `https://www.tiktok.com/@_/video/${id}`);
  assert.deepEqual(promo.playback, { kind: 'TIKTOK', provider: 'TIKTOK', url: `https://www.tiktok.com/player/v1/${id}`, attribution: 'TikTok' });
});

test('promoValue autodetecta sin romper providers existentes', () => {
  const tiktok = promoValue({ type: 'TEASER', title: 'TikTok', url: 'https://www.tiktok.com/@dubverse/video/7421234567890123456' });
  assert.equal(tiktok.provider, 'TIKTOK');
  assert.equal(tiktok.providerIdentifier, '7421234567890123456');
  const hls = promoValue({ type: 'PV', title: 'HLS', url: 'https://cdn.example/master.m3u8' });
  assert.equal(hls.provider, 'HLS');
  const legacy = promoValue({ type: 'SPECIAL', title: 'Legacy', provider: 'OTHER', url: 'https://example.com/watch/123' });
  assert.equal(legacy.provider, 'OTHER');
  assert.throws(() => promoValue({ type: 'SPECIAL', title: 'Inválido', url: 'notaurl' }), /URL promocional no es válida/);
});

test('playback sólo crea iframes para proveedores aprobados y conserva formato TikTok', async () => {
  const vimeo = mapPromo({ id: 'v', project_id: 'p', type: 'TRAILER', title: 'Vimeo', provider: 'VIMEO', provider_identifier: '76979871', url: 'https://vimeo.com/76979871', is_active: true });
  const unknown = mapPromo({ id: 'u', project_id: 'p', type: 'SPECIAL', title: 'Otro', provider: 'OTHER', url: 'https://example.com/watch/123', is_active: true });
  assert.equal(vimeo.playback.url, 'https://player.vimeo.com/video/76979871');
  assert.equal(unknown.playback.kind, 'UNSUPPORTED');
  assert.equal(unknown.playback.url, '');
  const component = await source('public/promotional-media-player.js');
  assert.match(component, /\['YOUTUBE', 'VIMEO', 'ARCHIVE', 'TIKTOK'\]\.includes/);
  assert.match(component, /trustedEmbed\(playback\)/);
  assert.match(component, /playback\.kind === 'TIKTOK' \? ' promo-player-vertical'/);
  assert.match(component, /classList\.toggle\('is-vertical', playback\.kind === 'TIKTOK'\)/);
  assert.match(component, /No se puede reproducir este material dentro de Dubverse/);
  assert.doesNotMatch(component, /window\.open|location\s*=|playback\.url[^\n]+<iframe/);
});

test('todas las vistas del panel comparten shell y contrato anti-overflow', async () => {
  const [panel, page, css] = await Promise.all([
    source('public/studio-panel.js'), source('app/panel-estudio/page.jsx'), source('public/studio-panel.css')
  ]);
  assert.match(page, /className="studio-panel-shell"/);
  assert.match(panel, /class="studio-panel-view"/);
  assert.match(css, /\.studio-panel-shell,\.studio-panel-content,\.studio-panel-view\{width:100%;max-width:100%;min-width:0\}/);
  assert.match(css, /\.studio-panel-sidebar nav\{[^}]*overflow-x:auto;overflow-y:hidden/);
  assert.match(css, /\.studio-panel-sidebar\{[^}]*overflow:visible/);
  assert.match(css, /\.studio-record-list article\{[^}]*grid-template-columns:48px minmax\(0,1fr\)/);
  assert.match(css, /#studioPanelDialog,#studioPanelForm,#studioPanelFields\{width:100%;max-width:100%;min-width:0\}/);
});
