import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pageSource = () => readFile(new URL('../app/page.jsx', import.meta.url), 'utf8');
const appSource = () => readFile(new URL('../public/app.js', import.meta.url), 'utf8');

test('el modal de Dubverse v1.2 contiene todas las novedades y controles requeridos', async () => {
  const source = await pageSource();
  for (const copy of [
    'Dubverse v1.2 — La comunidad ya está aquí',
    'Inicio de sesión con Google y Discord.',
    'Perfiles de usuario.',
    'Likes, favoritos y Ver después.',
    'Historial y episodios vistos.',
    'Comentarios, respuestas y likes.',
    'Seguidores y notificaciones.',
    'Nueva página principal con secciones, destacados y banners editoriales.',
    'No volver a mostrar en este dispositivo'
  ]) assert.match(source, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(source, /<dialog[\s\S]*id="newsDialog"[\s\S]*aria-labelledby="newsTitle"/);
  assert.match(source, /<form method="dialog" className="news-shell">/);
});

test('la preferencia del modal es local, versionada y se consulta sólo al resolver Home', async () => {
  const source = await appSource();
  assert.match(source, /NEWS_V12_HIDDEN_KEY = 'dubverse:news:v1\.2:hidden'/);
  assert.match(source, /localStorage\.getItem\(NEWS_V12_HIDDEN_KEY\) === '1'/);
  assert.match(source, /localStorage\.setItem\(NEWS_V12_HIDDEN_KEY, '1'\)/);
  assert.match(source, /if \(!parts\.length\) \{[\s\S]*?home\(\);[\s\S]*?showNewsV12\(\);[\s\S]*?return;[\s\S]*?\}/);
  assert.match(source, /newsDialog\?\.addEventListener\('close'/);
  assert.doesNotMatch(source, /fetch\([^\n]*newsDialog|\/api\/news/);
});
