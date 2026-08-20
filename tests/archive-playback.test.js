import assert from 'node:assert/strict';
import test from 'node:test';
import { selectArchivePlayableFile } from '../lib/archive.js';

test('selección Archive prioriza un derivado H.264 razonable sobre un MP4 original enorme', () => {
  const selected = selectArchivePlayableFile([
    { name: 'original.mp4', format: 'QuickTime', source: 'original', size: '9000000000' },
    { name: 'stream.mp4', format: 'h.264 IA', source: 'derivative', size: '450000000' }
  ]);
  assert.equal(selected.name, 'stream.mp4');
});

test('selección Archive respeta el archivo solicitado y no sustituye uno ausente', () => {
  const files = [{ name: 'stream.mp4', format: 'h.264 IA', source: 'derivative' }];
  assert.equal(selectArchivePlayableFile(files, 'stream.mp4'), files[0]);
  assert.equal(selectArchivePlayableFile(files, 'missing.mp4'), null);
});
