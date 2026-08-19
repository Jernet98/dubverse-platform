import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeArchiveReference, normalizeYouTubeId, promoValue, youtubeThumbnailUrl } from '../lib/update2.js';
import { panelMediaPolicy, uploadPanelImage, validatePanelMediaFile } from '../lib/blob-media.js';

const source = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('perfil del estudio usa archivos, previews y redes individuales sin exponer JSON ni URLs internas', async () => {
  const [panel, page] = await Promise.all([source('public/studio-panel.js'), source('app/panel-estudio/page.jsx')]);
  assert.doesNotMatch(panel, /URL del logo|URL del banner|Redes sociales \(JSON\)|ID de YouTube \/ Archive/);
  for (const label of ['Facebook', 'Instagram', 'YouTube', 'TikTok', 'X / Twitter', 'Discord', 'Sitio web']) assert.match(panel, new RegExp(label.replace('/', '\\/')));
  assert.match(panel, /type=\"file\"[\s\S]*image\/jpeg,image\/png,image\/webp/);
  assert.match(panel, /URL\.createObjectURL\(file\)/);
  assert.match(panel, /body\.socials = buildSocials\(form\)/);
  assert.match(panel, /const socials = \{ \.\.\.\(panelEditor\.originalSocials \|\| \{\}\) \}/);
  assert.match(page, /aria-live="polite"/);
});

test('upload del panel usa Vercel Blob directo y exige membresía antes de procesar archivos', async () => {
  const [route, media, access] = await Promise.all([
    source('app/api/studio-panel/[[...path]]/route.js'),
    source('lib/blob-media.js'),
    source('lib/studio-access.js')
  ]);
  const image = (type, size = 256, name = 'imagen') => ({ name, type, size, arrayBuffer: async () => new ArrayBuffer(size) });
  assert.equal(panelMediaPolicy('studio-logo').maxBytes, 2 * 1024 * 1024);
  assert.equal(panelMediaPolicy('studio-banner').maxBytes, 5 * 1024 * 1024);
  assert.equal(validatePanelMediaFile(image('image/jpeg', 256, 'logo.jpg'), 'studio-logo').contentType, 'image/jpeg');
  assert.equal(validatePanelMediaFile(image('image/png', 256, 'logo.png'), 'studio-logo').contentType, 'image/png');
  assert.equal(validatePanelMediaFile(image('image/webp', 256, 'logo.webp'), 'studio-logo').contentType, 'image/webp');
  assert.throws(() => validatePanelMediaFile(image('image/svg+xml', 256, 'bad.svg'), 'studio-logo'), /JPEG, PNG o WebP/);
  assert.throws(() => validatePanelMediaFile({ name: 'bad.jpg', type: 'image/jpeg', size: 10 }, 'studio-logo'), /imagen válida/);
  assert.throws(() => validatePanelMediaFile(image('image/jpeg', 2 * 1024 * 1024 + 1, 'large.jpg'), 'studio-logo'), /supera el límite/);
  const previousToken = process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  try {
    await assert.rejects(uploadPanelImage(image('image/jpeg', 256, 'logo.jpg'), { studioId: 'studio', kind: 'studio-logo' }), error => error.status === 503 && /no está disponible/.test(error.message));
  } finally {
    if (previousToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = previousToken;
  }
  assert.doesNotMatch(media, /processImageBuffer|sharp\(/i);
  assert.doesNotMatch(media, /instanceof File/);
  assert.match(media, /const token = process\.env\.BLOB_READ_WRITE_TOKEN/);
  assert.match(media, /put\(pathname, file,[\s\S]*access: 'public'[\s\S]*addRandomSuffix: true[\s\S]*token/);
  assert.doesNotMatch(media, /contentType: file\.type/);
  assert.match(route, /studioAdminSession\(request, studioId\)[\s\S]*request\.formData\(\)[\s\S]*const file = form\.get\('file'\)[\s\S]*requireManagedProject[\s\S]*validatePanelMediaFile\(file, kind\)[\s\S]*uploadPanelImage\(file/);
  assert.match(access, /sm\.user_profile_id = \$\{session\.row\.id\}[\s\S]*sm\.studio_id = \$\{studioId\}/);
});

test('endpoint de media registra la etapa completa sin incluir secretos', async () => {
  const route = await source('app/api/studio-panel/[[...path]]/route.js');
  assert.match(route, /let stage = 'start'[\s\S]*stage = 'session'[\s\S]*stage = 'formData'[\s\S]*stage = 'validation'[\s\S]*stage = 'upload'[\s\S]*stage = 'done'/);
  assert.match(route, /console\.error\('\[Studio media endpoint\]'[\s\S]*stage,[\s\S]*studioId,[\s\S]*message: error\?\.message,[\s\S]*stack: error\?\.stack/);
  assert.doesNotMatch(route, /console\.error[\s\S]{0,300}(cookie|authorization|DATABASE_URL|BLOB_READ_WRITE_TOKEN)/i);
});

test('panelApi normaliza errores estructurados sin mostrar object Object', async () => {
  const panel = await source('public/studio-panel.js');
  assert.match(panel, /typeof body\.error === 'string'[\s\S]*typeof body\.error\?\.message === 'string'/);
  assert.match(panel, /No pudimos completar esta acción\. Inténtalo de nuevo\./);
  assert.doesNotMatch(panel, /new Error\(body\.error \|\|/);
});

test('reemplazos limpian Blob sólo después de actualizar referencias del estudio, proyecto o promo', async () => {
  const [route, media] = await Promise.all([source('app/api/studio-panel/[[...path]]/route.js'), source('lib/blob-media.js')]);
  assert.match(route, /UPDATE studios SET[\s\S]*cleanupBlobUrls\(session\.sql, \[old\.logo !== logo/);
  assert.match(route, /UPDATE projects SET[\s\S]*cleanupBlobUrls\(session\.sql, \[old\.poster !== poster/);
  assert.match(route, /UPDATE project_promo_media SET[\s\S]*rows\[0\]\.thumbnail_url !== value\.thumbnailUrl/);
  assert.match(media, /studios WHERE logo = \$\{url\} OR banner = \$\{url\}/);
  assert.match(media, /project_promo_media WHERE thumbnail_url = \$\{url\}/);
  assert.match(media, /blobReferenceCount\(sql, url\)/);
});

test('promos normalizan YouTube, Archive y limpian campos incompatibles al cambiar proveedor', () => {
  const id = 'dQw4w9WgXcQ';
  assert.equal(normalizeYouTubeId(`https://youtube.com/watch?v=${id}`), id);
  assert.equal(normalizeYouTubeId(`https://youtu.be/${id}`), id);
  assert.equal(normalizeYouTubeId(`https://youtube.com/shorts/${id}`), id);
  assert.equal(youtubeThumbnailUrl(id), `https://i.ytimg.com/vi/${id}/hqdefault.jpg`);
  const youtube = promoValue({ provider: 'YOUTUBE', type: 'TRAILER', title: 'Tráiler', url: `https://youtu.be/${id}` });
  assert.equal(youtube.providerIdentifier, id);
  assert.equal(youtube.thumbnailUrl, youtubeThumbnailUrl(id));

  assert.deepEqual(normalizeArchiveReference('https://archive.org/download/dubverse-item/video final.mp4'), { identifier: 'dubverse-item', file: 'video final.mp4' });
  const archive = promoValue({ provider: 'ARCHIVE', type: 'TEASER', title: 'Teaser', url: 'https://archive.org/download/dubverse-item/video.mp4' });
  assert.equal(archive.providerIdentifier, 'dubverse-item');
  assert.equal(archive.providerFile, 'video.mp4');

  const direct = promoValue({ provider: 'DIRECT', type: 'PV', title: 'PV', url: 'https://cdn.example/video.mp4' }, { provider: 'ARCHIVE', provider_identifier: 'old', provider_file: 'old.mp4' });
  assert.equal(direct.providerIdentifier, '');
  assert.equal(direct.providerFile, '');
  const manual = promoValue({ provider: 'YOUTUBE', type: 'SPECIAL', title: 'Especial', url: `https://youtube.com/embed/${id}`, thumbnailUrl: 'https://cdn.example/custom.webp' });
  assert.equal(manual.thumbnailUrl, 'https://cdn.example/custom.webp');
});

test('formulario promocional es condicional y nunca solicita el ID técnico de YouTube', async () => {
  const panel = await source('public/studio-panel.js');
  assert.match(panel, /provider === 'YOUTUBE'[\s\S]*Enlace de YouTube/);
  assert.match(panel, /provider === 'ARCHIVE'[\s\S]*Enlace o identifier de Archive\.org/);
  assert.match(panel, /provider === 'DIRECT'[\s\S]*URL directa del video/);
  assert.match(panel, /provider === 'OTHER'[\s\S]*Enlace externo/);
  assert.match(panel, /Miniatura oficial de YouTube detectada/);
  assert.doesNotMatch(panel, /panelField\('providerIdentifier'/);
});

test('modal y formularios responden como full-screen sheet móvil sin perder el footer', async () => {
  const css = await source('public/studio-panel.css');
  assert.match(css, /@media\(max-width:560px\)/);
  assert.match(css, /#studioPanelDialog\{inset:0;width:100%;max-width:none;height:100dvh/);
  assert.match(css, /\.panel-section-grid,\.provider-section #promoProviderFields\{grid-template-columns:1fr/);
  assert.match(css, /min-height:44px/);
  assert.match(css, /#studioPanelForm>footer[\s\S]*flex:none/);
  assert.match(css, /overflow-y:auto/);
});
