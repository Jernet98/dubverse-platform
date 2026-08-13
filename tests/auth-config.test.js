import test from 'node:test';
import assert from 'node:assert/strict';
import { configuredSocialProviders, userAuthStatus } from '../lib/user-auth.js';

const names = ['DATABASE_URL', 'BETTER_AUTH_SECRET', 'BETTER_AUTH_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET'];

test('auth queda deshabilitada sin credenciales y no muestra proveedores incompletos', () => {
  const original = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    process.env.GOOGLE_CLIENT_ID = 'id-sin-secreto';
    assert.deepEqual(configuredSocialProviders(), []);
    assert.equal(userAuthStatus().available, false);
  } finally {
    for (const [name, value] of Object.entries(original)) value === undefined ? delete process.env[name] : process.env[name] = value;
  }
});

test('auth sólo queda disponible con DB, secret fuerte, origen y proveedor completo', () => {
  const original = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    process.env.DATABASE_URL = 'postgresql://local.invalid/example';
    process.env.BETTER_AUTH_SECRET = 'x'.repeat(32);
    process.env.BETTER_AUTH_URL = 'https://dubverse.example';
    process.env.DISCORD_CLIENT_ID = 'discord-id';
    process.env.DISCORD_CLIENT_SECRET = 'discord-secret';
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    const status = userAuthStatus();
    assert.equal(status.available, true);
    assert.deepEqual(status.providers, ['discord']);
    assert.equal(status.baseUrl, 'https://dubverse.example');
  } finally {
    for (const [name, value] of Object.entries(original)) value === undefined ? delete process.env[name] : process.env[name] = value;
  }
});
