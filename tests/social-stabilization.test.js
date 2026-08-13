import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appUrl = new URL('../public/app.js', import.meta.url);
const stylesUrl = new URL('../public/styles.css', import.meta.url);

function functionSource(source, name, nextName) {
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf(`function ${nextName}`, start + 1);
  assert.notEqual(start, -1, `No se encontró ${name}`);
  assert.notEqual(end, -1, `No se encontró ${nextName}`);
  return source.slice(start, end);
}

test('comentarios y reseñas se editan inline sin prompts nativos', async () => {
  const source = await readFile(appUrl, 'utf8');
  const reviews = functionSource(source, 'bindReviewActions', 'projectPage');
  const comments = functionSource(source, 'bindCommentActions', 'watch');
  for (const editor of [reviews, comments]) {
    const editFlow = editor.slice(editor.indexOf("$$('[data-edit-"));
    assert.doesNotMatch(editFlow, /\b(?:prompt|confirm)\s*\(/);
    assert.match(editor, /dataset\.inlineEditor/);
    assert.match(editor, /data-cancel-edit/);
    assert.match(editor, /method omitted|socialWrite/);
  }
  assert.match(reviews, /ratingPicker/);
  assert.match(comments, /maxlength="1500"/);
});

test('la lista de episodios usa visto manual y el reproductor sólo registra historial', async () => {
  const source = await readFile(appUrl, 'utf8');
  const project = functionSource(source, 'projectPage', 'commentMarkup');
  const player = functionSource(source, 'watch', 'studios');
  assert.match(project, /watchedEpisodeIds/);
  assert.match(project, /data-episode-watched/);
  assert.match(project, /\/watched/);
  assert.doesNotMatch(project, /seenEpisodeIds|episode_history/);
  assert.match(player, /\/view/);
  assert.doesNotMatch(player, /\/watched/);
});

test('avatar e imágenes adjuntas tienen límites y capas explícitas', async () => {
  const styles = await readFile(stylesUrl, 'utf8');
  assert.match(styles, /\.user-identity\{position:relative;z-index:2\}/);
  assert.match(styles, /\.user-identity>img\{position:relative;z-index:3\}/);
  assert.match(styles, /\.comment-card \.comment-image\{[^}]*max-width:min\(100%,360px\)[^}]*max-height:360px[^}]*object-fit:contain/);
  assert.match(styles, /@media\(max-width:720px\)[\s\S]*\.comment-image-button,\.comment-card \.comment-image\{max-width:100%;max-height:360px\}/);
});
