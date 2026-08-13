import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appUrl = new URL('../public/app.js', import.meta.url);

function section(source, startText, endText) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start + startText.length);
  assert.notEqual(start, -1, `No se encontró ${startText}`);
  assert.notEqual(end, -1, `No se encontró ${endText}`);
  return source.slice(start, end);
}

test('la sesión se reconcilia y deduplica con el endpoint social existente', async () => {
  const source = await readFile(appUrl, 'utf8');
  const sync = section(source, 'let sessionSyncPromise', 'async function loadSocial');
  assert.match(sync, /socialApi\('\/session'\)/);
  assert.match(sync, /if \(sessionSyncPromise\) return sessionSyncPromise/);
  assert.match(sync, /renderAccount\(\)/);
  assert.match(sync, /sessionViewerKey\(viewer\) !== previousKey/);
  assert.doesNotMatch(sync, /sign-out|location\.reload|setInterval|setTimeout/);
});

test('popstate y pageshow actualizan sesión y reconstruyen controles sólo si cambia', async () => {
  const source = await readFile(appUrl, 'utf8');
  const navigation = section(source, 'let navigationVersion', 'function normalizeLegacyHash');
  const events = source.slice(source.indexOf("window.addEventListener('popstate'"));
  assert.match(navigation, /routeAndSyncSession/);
  assert.match(navigation, /syncSocialSession\(\{ force: true \}\)/);
  assert.match(navigation, /result\.changed[\s\S]*router\(\{ preserveScroll: true, recordHistory: false \}\)/);
  assert.match(events, /window\.addEventListener\('popstate',[\s\S]*routeAndSyncSession\(\)/);
  assert.match(events, /window\.addEventListener\('pageshow',[\s\S]*reconcileRestoredSession\(\)/);
  assert.doesNotMatch(events, /sign-out|location\.reload|setInterval/);
  const navigationClick = section(source, "document.addEventListener('click', event => {", "window.addEventListener('popstate'");
  assert.match(navigationClick, /routeAndSyncSession\(\)/);
});
