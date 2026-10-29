import { copyFile, mkdir, readFile } from 'node:fs/promises';

// Locally serve the lockfile-pinned UMD builds. hls.js includes its worker.
const root = new URL('../', import.meta.url);
const target = new URL('public/vendor/player/', root);
await mkdir(target, { recursive: true });
for (const [name, files] of [
  ['artplayer', [['dist/artplayer.js', 'artplayer'], ['dist/i18n/es.js', 'artplayer-es']]],
  ['hls.js', [['dist/hls.min.js', 'hls']]]
]) {
  const pkg = JSON.parse(await readFile(new URL(`node_modules/${name}/package.json`, root), 'utf8'));
  for (const [source, basename] of files) {
    await copyFile(new URL(`node_modules/${name}/${source}`, root), new URL(`${basename}-${pkg.version}.js`, target));
  }
}
