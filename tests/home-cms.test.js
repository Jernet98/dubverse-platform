import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  bannerValue,
  diversifiedFallback,
  nextShuffleBag,
  rankRecommendations,
  sectionValue,
  siteSettingsValue
} from '../lib/home-cms.js';

function memoryRound(items, randomValues = []) {
  let index = 0;
  let state = null;
  const chosen = [];
  const random = () => randomValues[index++] ?? ((index * 0.173) % 1);
  for (let count = 0; count < items.length; count += 1) {
    const result = nextShuffleBag(items, state, random);
    chosen.push(result.selected?.id);
    state = result.state;
  }
  return { chosen, state, random };
}

test('shuffle bag recorre seis proyectos sin repetir dentro de la ronda', () => {
  const items = Array.from({ length: 6 }, (_, index) => ({ id: String.fromCharCode(65 + index) }));
  const { chosen } = memoryRound(items);
  assert.equal(chosen.length, 6);
  assert.equal(new Set(chosen).size, 6);
  assert.deepEqual([...chosen].sort(), items.map(item => item.id));
});

test('shuffle bag evita la frontera repetida, invalida cambios y cubre 0/1 elementos', () => {
  const items = [{ id: 'A' }, { id: 'B' }, { id: 'C' }];
  const first = memoryRound(items, [0.8, 0.5, 0.2]);
  const previousLast = first.state.last;
  const next = nextShuffleBag(items, first.state, () => previousLast === 'A' ? 0.9 : 0.1);
  assert.notEqual(next.selected.id, previousLast);
  const changed = nextShuffleBag([...items, { id: 'D' }], next.state, () => 0.5);
  assert.match(changed.state.signature, /D/);
  assert.equal(nextShuffleBag([], null).selected, null);
  assert.equal(nextShuffleBag([{ id: 'único' }], null).selected.id, 'único');
});

test('recomendaciones ordenan 3, 2 y 1 coincidencias y excluyen referencias/no publicados', () => {
  const reference = { id: 'A', type: 'SERIES', genres: ['Romance', 'Comedia', 'Escolar'], published: true };
  const candidates = [
    reference,
    { id: 'D', type: 'MOVIE', genres: ['Romance'], published: true },
    { id: 'B', type: 'SERIES', genres: ['Romance', 'Comedia', 'Escolar'], published: true },
    { id: 'E', type: 'SERIES', genres: ['Terror'], published: true },
    { id: 'C', type: 'SERIES', genres: ['Romance', 'Escolar'], published: true },
    { id: 'oculto', type: 'SERIES', genres: ['Romance', 'Comedia', 'Escolar'], published: false }
  ];
  assert.deepEqual(rankRecommendations([reference], candidates).items.map(item => item.id), ['B', 'C', 'D']);
  assert.deepEqual(rankRecommendations([reference], candidates, { completedIds: ['B'] }).items.map(item => item.id), ['C', 'D']);
});

test('fallback sin historial es diversificado y sólo usa proyectos publicados', () => {
  const result = diversifiedFallback([
    { id: 's1', type: 'SERIES', published: true }, { id: 's2', type: 'SERIES', published: true },
    { id: 'm1', type: 'MOVIE', published: true }, { id: 'x', type: 'OVA', published: false }
  ], 3);
  assert.deepEqual(result.map(item => item.id), ['s1', 'm1', 's2']);
});

test('validadores del CMS aceptan configuración estructurada y rechazan URLs/JSON peligrosos', () => {
  const section = sectionValue({ sectionKey: 'peliculas', sectionType: 'AUTO_TYPE', title: 'Películas', enabled: true, position: 20, maxItems: 8, configuration: { type: 'MOVIE', ignored: '<script>' } });
  assert.deepEqual(section.configuration, { type: 'MOVIE' });
  assert.throws(() => sectionValue({ sectionKey: 'x', sectionType: 'HTML', configuration: {} }), /Tipo de sección/);
  assert.throws(() => bannerValue({ title: 'Peligro', linkUrl: 'javascript:alert(1)' }), /URL válida|HTTPS/);
  assert.throws(() => bannerValue({ title: 'Fechas', startsAt: '2026-08-12', endsAt: '2026-08-11' }), /posterior/);
  assert.throws(() => siteSettingsValue({ siteName: 'Dubverse', socials: { unknown: 'https://example.com' } }), /no permitida/);
  assert.equal(bannerValue({ title: 'Seguro', linkUrl: '/proyecto/alpha', enabled: false }).linkUrl, '/proyecto/alpha');
});

test('API Home mantiene lectura pública agregada y escrituras bajo requireAdmin', async () => {
  const source = await readFile(new URL('../app/api/[...path]/route.js', import.meta.url), 'utf8');
  assert.match(source, /path\[0\] === 'home'[\s\S]*publicHome/);
  assert.match(source, /requireAdmin\(request\);[\s\S]*path\[1\] === 'home'/);
  assert.match(source, /assertWriteOrigin\(request\)/);
  assert.match(source, /starts_at IS NULL OR starts_at <= now\(\)/);
});

test('migración y rollback son explícitos, aditivos y no se invocan desde requests', async () => {
  const migration = await readFile(new URL('../database/migrations/2026-08-12-home-cms.sql', import.meta.url), 'utf8');
  const rollback = await readFile(new URL('../database/migrations/2026-08-12-home-cms.rollback.sql', import.meta.url), 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS site_settings/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS home_sections/);
  assert.match(migration, /REFERENCES projects\(id\) ON DELETE CASCADE/);
  assert.doesNotMatch(migration, /ALTER TABLE|TRUNCATE|DELETE FROM projects|UPDATE projects/);
  assert.match(rollback, /ADVERTENCIA/);
  assert.match(rollback, /DROP TABLE IF EXISTS site_settings/);
});

test('admin expone los siete controles editoriales requeridos', async () => {
  const source = await readFile(new URL('../public/admin.js', import.meta.url), 'utf8');
  for (const label of ['Hero', 'Proyectos destacados', 'Estudios destacados', 'Secciones de contenido', 'Banners / Novedades', 'Configuración general', 'Completar espacios automáticamente']) assert.match(source, new RegExp(label));
  assert.match(source, /data-section-move/);
  assert.match(source, /data-home-enabled/);
  assert.match(source, /\/api\/admin\/home\/settings/);
});
