import test from 'node:test';
import assert from 'node:assert/strict';
import {
  commentValue,
  mediaRequestValue,
  normalizeGenre,
  rankProjectsByGenres,
  ratingValue,
  usernameValue,
  uuidValue
} from '../lib/social-validation.js';
import sharp from 'sharp';
import { activeObjectKey, pendingObjectKey, processImageBuffer } from '../lib/r2.js';

test('normaliza géneros sin alterar el ranking visual', () => {
  assert.equal(normalizeGenre('  Acción '), 'accion');
  assert.equal(normalizeGenre('MECHA'), 'mecha');
});

test('ranking OR ordena coincidencias 3, 2 y 1 de forma estable', () => {
  const projects = [
    { id: 'dos-a', genres: ['Romance', 'Mecha'] },
    { id: 'uno', genres: ['Acción'] },
    { id: 'tres', genres: ['Romance', 'Mecha', 'Accion'] },
    { id: 'cero', genres: ['Comedia'] },
    { id: 'dos-b', genres: ['Acción', 'Romance'] }
  ];
  assert.deepEqual(
    rankProjectsByGenres(projects, ['Romance', 'Mecha', 'Acción']).map(project => project.id),
    ['tres', 'dos-a', 'dos-b', 'uno']
  );
});

test('sin géneros conserva el orden y sin coincidencias devuelve vacío', () => {
  const projects = [{ id: 'a', genres: ['Drama'] }, { id: 'b', genres: ['Comedia'] }];
  assert.deepEqual(rankProjectsByGenres(projects, []).map(project => project.id), ['a', 'b']);
  assert.deepEqual(rankProjectsByGenres(projects, ['Mecha']), []);
});

test('valida username, UUID, rating y rechaza HTML en comentarios', () => {
  assert.equal(usernameValue('Fan_Seguro'), 'fan_seguro');
  assert.throws(() => usernameValue('!'), /username/i);
  assert.equal(uuidValue('550e8400-e29b-41d4-a716-446655440000'), '550e8400-e29b-41d4-a716-446655440000');
  assert.throws(() => uuidValue('../otro'), /no es válido/i);
  assert.equal(ratingValue(5), 5);
  assert.throws(() => ratingValue(6), /entre 1 y 5/i);
  assert.throws(() => commentValue('<script>alert(1)</script>'), /sin HTML/i);
});

test('valida límites y MIME declarado antes de firmar una subida', () => {
  assert.equal(mediaRequestValue('avatar', 'image/png', 1024).purpose, 'AVATAR');
  assert.throws(() => mediaRequestValue('avatar', 'image/svg+xml', 1024), /JPEG, PNG o WebP/i);
  assert.throws(() => mediaRequestValue('avatar', 'image/png', 2 * 1024 * 1024 + 1), /límite/i);
});

test('las object keys son totalmente controladas por servidor', () => {
  const profile = '550e8400-e29b-41d4-a716-446655440000';
  const upload = '63f3027e-0b65-4b23-a36b-1e98aa6f5e90';
  assert.equal(pendingObjectKey(profile, 'AVATAR', upload), `pending/${profile}/avatar/${upload}`);
  assert.equal(activeObjectKey(profile, 'AVATAR', upload), `users/${profile}/avatar/${upload}.webp`);
  assert.equal(activeObjectKey(profile, 'COMMENT', upload, upload), `comments/${profile}/${upload}/${upload}.webp`);
});

test('Sharp decodifica, limita dimensiones y re-encodea a WebP sin usar R2', async () => {
  const png = await sharp({ create: { width: 1000, height: 800, channels: 4, background: '#ff2244' } }).png().toBuffer();
  const { detectedType, output } = await processImageBuffer(png, 'AVATAR');
  assert.equal(detectedType, 'image/png');
  assert.ok(output.info.width <= 512);
  assert.ok(output.info.height <= 512);
  assert.equal(output.info.format, 'webp');
  await assert.rejects(processImageBuffer(Buffer.from('<svg><script/></svg>'), 'AVATAR'), /JPEG, PNG o WebP válida/i);
});
