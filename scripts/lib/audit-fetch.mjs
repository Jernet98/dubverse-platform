// Optional per-process DNS for the read-only audit; never changes Windows/Git.
// HTTPS certificate and hostname verification stay enabled on every redirect.
import https from 'node:https';
import { Resolver } from 'node:dns/promises';
import { Readable } from 'node:stream';
import { createGunzip, createInflate, createBrotliDecompress } from 'node:zlib';

export function createAuditFetch({ dnsServer } = {}) {
  const resolver = new Resolver({ timeout: 2500, tries: 2 });
  const cache = new Map();
  if (dnsServer) resolver.setServers([dnsServer]);
  const lookup = dnsServer ? (hostname, options, callback) => {
    let pending = cache.get(hostname);
    if (!pending || pending.expires < Date.now()) {
      pending = { expires: Date.now() + 60000, value: resolver.resolve4(hostname) };
      cache.set(hostname, pending);
      pending.value.catch(() => cache.delete(hostname));
    }
    pending.value.then(addresses => options?.all ? callback(null, addresses.map(address => ({ address, family: 4 }))) : callback(null, addresses[0], 4), callback);
  } : undefined;
  const agent = new https.Agent({ keepAlive: true, ...(lookup ? { lookup } : {}) });
  return async function auditFetch(input, options = {}) {
    let url = new URL(input);
    for (let redirect = 0; redirect <= 6; redirect++) {
      if (url.protocol !== 'https:') throw new Error('Audit requests require verified HTTPS.');
      const response = await new Promise((resolve, reject) => {
        const request = https.get(url, { agent, signal: options.signal || AbortSignal.timeout(20000),
          headers: { 'accept-encoding': 'identity', ...Object.fromEntries(new Headers(options.headers)) } }, resolve);
        request.on('error', reject);
      });
      if ([301,302,303,307,308].includes(response.statusCode) && response.headers.location) {
        response.destroy(); url = new URL(response.headers.location, url); continue;
      }
      const headers = new Headers();
      for (const [name, value] of Object.entries(response.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
      const decoder = { gzip: createGunzip, deflate: createInflate, br: createBrotliDecompress }[headers.get('content-encoding')];
      const stream = decoder ? response.pipe(decoder()) : response;
      if (decoder) { headers.delete('content-encoding'); headers.delete('content-length'); }
      const result = new Response(Readable.toWeb(stream), { status: response.statusCode, headers });
      Object.defineProperty(result, 'url', { value: url.toString() });
      return result;
    }
    throw new Error('Too many redirects in audit request.');
  };
}
