import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { mp4VideoInfo, inspectMp4Video } from '../lib/media-probe.js';
import { resolveArchiveEpisodePlayback } from '../lib/archive.js';

const header = name => readFile(new URL(`./fixtures/${name}.header`, import.meta.url));
const avc = await header('avc-main-480'), hevc = await header('hevc-main10-1080'), hd = await header('avc-main-1080');
const partial = (bytes, start = 0) => new Response(bytes, { status: 206, headers: { 'Content-Range': `bytes ${start}-${start + bytes.length - 1}/10000000` } });

test('cabeceras reales distinguen HEVC Main 10 de H.264 Main y no confunden contenedor MPEG4 con códec', () => {
  const high = mp4VideoInfo(hevc), low = mp4VideoInfo(avc), fullHd = mp4VideoInfo(hd);
  assert.equal(high.codec, 'hvc1.2.4.L120.90');
  assert.equal(high.bitDepth, 10); assert.equal(high.height, 1080);
  assert.equal(low.codec, 'avc1.4D401E'); assert.equal(low.bitDepth, 8); assert.equal(low.height, 480);
  assert.equal(fullHd.codec, 'avc1.4D4028'); assert.equal(fullHd.height, 1080);
  for (const info of [high, low, fullHd]) assert.equal(info.framerate, 30);
});

test('una sola petición de 4 KiB obtiene el códec sin descargar índices ni datos audiovisuales', async () => {
  const calls = [];
  const info = await inspectMp4Video('https://archive.org/download/fixture/video.mp4', { fetchImpl: async (_, options) => { calls.push(options.headers.Range); return partial(hevc); } });
  assert.equal(info.codecName, 'hevc');
  assert.deepEqual(calls, ['bytes=0-4095']);
});

test('mdat grande se salta con Range hasta moov sin leer el cuerpo del episodio', async () => {
  const first = Buffer.alloc(4096);
  first.writeUInt32BE(8, 0); first.write('ftyp', 4);
  first.writeUInt32BE(1000000, 8); first.write('mdat', 12);
  const moovOffset = hevc.indexOf('moov') - 4;
  const calls = [];
  const info = await inspectMp4Video('https://archive.org/download/fixture/video.mp4', { fetchImpl: async (_, options) => {
    calls.push(options.headers.Range);
    return calls.length === 1 ? partial(first) : partial(hevc.subarray(moovOffset), 1000008);
  } });
  assert.equal(info.codecName, 'hevc');
  assert.deepEqual(calls, ['bytes=0-4095','bytes=1000008-1004103']);
});

test('Range ignorado, respuesta excesiva y datos truncados quedan como desconocidos', async () => {
  assert.equal(await inspectMp4Video('https://example.com/ep.mp4', { fetchImpl: async () => new Response('not a range') }), null);
  assert.equal(await inspectMp4Video('https://example.com/ep.mp4', { fetchImpl: async () => partial(Buffer.alloc(5000)) }), null);
  assert.equal(await inspectMp4Video('https://example.com/ep.mp4', { fetchImpl: async () => new Response(Buffer.alloc(5000), { status: 206, headers: { 'Content-Range': 'bytes 0-4095/10000000' } }) }), null);
  assert.equal(mp4VideoInfo(hevc.subarray(0, 70)), null);
  const invalid = Buffer.alloc(16); invalid.writeUInt32BE(1); invalid.write('moov', 4); invalid.writeBigUInt64BE(2n ** 63n, 8);
  assert.equal(mp4VideoInfo(invalid), null);
});

test('una inspección que agota su presupuesto conserva resultado desconocido', async () => {
  let aborted = false;
  const result = await inspectMp4Video('https://example.com/ep.mp4', { timeoutMs: 5, fetchImpl: (_, { signal }) => new Promise((resolve, reject) => {
    setTimeout(() => { aborted = signal.aborted; if (aborted) reject(signal.reason); else resolve(partial(avc)); }, 20);
  }) });
  assert.equal(result, null);
  assert.equal(aborted, true);
});

test('resolver enriquece variantes del mismo episodio y cachea sin escribir metadatos publicados', async () => {
  const originalFetch = globalThis.fetch, calls = [];
  try {
    globalThis.fetch = async (url, options) => {
      calls.push(String(url));
      if (String(url).includes('/metadata/')) return Response.json({ metadata: { identifier: 'decoder-fixture' }, files: [
        { name: 'e1.mp4', source: 'original', format: 'MPEG4', size: '300000000', length: '1400', height: '1080' },
        { name: 'e1.ia.mp4', original: 'e1.mp4', source: 'derivative', format: 'h.264 IA', size: '140000000', length: '1400', height: '480' },
        { name: 'e2.mp4', source: 'original', format: 'MPEG4' }
      ] });
      assert.equal(options.headers.Range, 'bytes=0-4095');
      assert.doesNotMatch(String(url), /e2/);
      return partial(String(url).endsWith('.ia.mp4') ? avc : hevc);
    };
    const episode = { archive_identifier: 'decoder-fixture', archive_file: 'e1.mp4' };
    const playback = await resolveArchiveEpisodePlayback(episode);
    assert.equal(playback.variants.length, 2);
    assert.equal(playback.variants[1].video.bitDepth, 10);
    assert.match(playback.fallback.url, /e1\.mp4$/);
    await resolveArchiveEpisodePlayback(episode);
    assert.equal(calls.length, 3);
  } finally { globalThis.fetch = originalFetch; }
});
