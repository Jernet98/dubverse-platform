import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const testableSource = source.slice(0, source.indexOf('function renderAccount'));

function response(value, ok = true, status = 200) {
  return { ok, status, json: async () => value };
}

function browserHarness(fetchSteps) {
  const providerContainer = { innerHTML: '', querySelectorAll: () => [] };
  const loginStatus = { textContent: '' };
  const loginDialog = { open: false, showModal() { this.open = true; } };
  const retryButton = { onclick: null };
  const fetchCalls = [];
  const document = {
    querySelector(selector) {
      if (selector === '#app') return {};
      if (selector === '#loginProviders') return providerContainer;
      if (selector === '#loginStatus') return loginStatus;
      if (selector === '#loginDialog') return loginDialog;
      if (selector === '#retrySocialConfig' && providerContainer.innerHTML.includes('retrySocialConfig')) return retryButton;
      return null;
    },
    querySelectorAll: () => []
  };
  const context = vm.createContext({
    document,
    FormData,
    URL,
    location: { href: 'https://dubverse.example/', assign() {} },
    fetch: async (path, options) => {
      fetchCalls.push({ path, options });
      const step = fetchSteps.shift();
      if (step instanceof Error) throw step;
      return response(step);
    }
  });
  vm.runInContext(`${testableSource}\n;globalThis.socialTest = { state, loadSocialConfig, openLogin, retrySocialConfig };`, context);
  return { ...context.socialTest, providerContainer, loginDialog, retryButton, fetchCalls };
}

const configured = { authAvailable: true, providers: ['google', 'discord'], mediaAvailable: true };

test('config correcta en primera carga conserva proveedores y evita caché HTTP', async () => {
  const harness = browserHarness([configured]);
  const result = await harness.loadSocialConfig();
  assert.equal(result.loaded, true);
  assert.equal(harness.state.social.configLoad.status, 'loaded');
  assert.deepEqual([...harness.state.social.config.providers], ['google', 'discord']);
  assert.equal(harness.fetchCalls[0].path, '/api/social/config');
  assert.equal(harness.fetchCalls[0].options.cache, 'no-store');
});

test('primera carga fallida queda reintentable y el segundo intento funciona', async () => {
  const harness = browserHarness([new Error('offline'), configured]);
  await harness.openLogin();
  assert.equal(harness.state.social.configLoad.status, 'error');
  assert.match(harness.providerContainer.innerHTML, />Reintentar</);
  await harness.retryButton.onclick();
  assert.equal(harness.state.social.configLoad.status, 'loaded');
  assert.deepEqual([...harness.state.social.config.providers], ['google', 'discord']);
  assert.match(harness.providerContainer.innerHTML, /data-provider="google"/);
  assert.match(harness.providerContainer.innerHTML, /data-provider="discord"/);
  assert.equal(harness.fetchCalls.length, 2);
  assert.ok(harness.fetchCalls.every(call => call.options.cache === 'no-store'));
});

test('abrir el modal después de un fallo vuelve a consultar y recupera Google y Discord', async () => {
  const harness = browserHarness([new Error('temporal'), configured]);
  await harness.loadSocialConfig();
  await harness.openLogin();
  assert.equal(harness.loginDialog.open, true);
  assert.match(harness.providerContainer.innerHTML, /data-provider="google"/);
  assert.match(harness.providerContainer.innerHTML, /data-provider="discord"/);
  assert.doesNotMatch(harness.providerContainer.innerHTML, /no está configurado/);
});

test('un fallo temporal muestra Reintentar y nunca se confunde con OAuth no configurado', async () => {
  const harness = browserHarness([new Error('temporal')]);
  await harness.openLogin();
  assert.match(harness.providerContainer.innerHTML, /No pudimos cargar las opciones de inicio de sesión/);
  assert.match(harness.providerContainer.innerHTML, />Reintentar</);
  assert.equal(typeof harness.retryButton.onclick, 'function');
  assert.doesNotMatch(harness.providerContainer.innerHTML, /no está configurado/);
});

test('respuesta exitosa con providers vacío sí muestra inicio de sesión no configurado', async () => {
  const harness = browserHarness([{ authAvailable: false, providers: [], mediaAvailable: false }]);
  await harness.openLogin();
  assert.equal(harness.state.social.configLoad.status, 'loaded');
  assert.match(harness.providerContainer.innerHTML, /El inicio de sesión no está configurado en este entorno/);
  assert.doesNotMatch(harness.providerContainer.innerHTML, /Reintentar/);
});
