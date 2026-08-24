import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { detectPromotionalMediaUrl, mapPromo, promoValue } from '../lib/update2.js';

const source = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const detected = url => detectPromotionalMediaUrl(url).provider;

test('detecta y normaliza proveedores promocionales desde una única URL', () => {
  assert.equal(detected('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'YOUTUBE');
  assert.equal(detected('https://youtu.be/dQw4w9WgXcQ'), 'YOUTUBE');
  assert.equal(detected('https://youtube.com/shorts/dQw4w9WgXcQ'), 'YOUTUBE');
  assert.equal(detected('https://www.tiktok.com/@dubverse/video/7421234567890123456'), 'TIKTOK');
  assert.equal(detected('https://vimeo.com/76979871'), 'VIMEO');
  assert.equal(detected('https://archive.org/embed/demo_item/video%20final.mp4'), 'ARCHIVE');
  assert.equal(detected('https://cdn.example/video.mp4?token=ok'), 'DIRECT');
  assert.equal(detected('https://cdn.example/video.webm'), 'DIRECT');
  assert.equal(detected('https://cdn.example/master.m3u8'), 'HLS');
  assert.equal(detected('https://example.com/watch/123'), 'OTHER');
  assert.equal(detected('javascript:alert(1)'), 'INVALID');
  assert.equal(detected('no-es-url'), 'INVALID');
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
