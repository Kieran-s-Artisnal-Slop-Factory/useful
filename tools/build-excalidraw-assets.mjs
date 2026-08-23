/**
 * Vendors Excalidraw's web fonts into public/excalidraw/fonts/.
 *
 * The notebook's drawing canvas is Excalidraw, and Excalidraw draws its text
 * with fonts it fetches at run time — by default from unpkg. That is a network
 * request an offline-first app may not make, so the faces are served from
 * this origin: `src/lib/notebook/excalidraw.ts` sets
 * `window.EXCALIDRAW_ASSET_PATH` to `public/excalidraw/` before the library
 * loads, and the service worker keeps whatever it fetches from there in the
 * font bucket. (Excalidraw still lists its CDN as a LAST resort after the
 * local path, so a face missing here degrades to a download, never to a
 * crash.)
 *
 * NOT vendored, deliberately: the Xiaolai family (13 MB of CJK glyphs across
 * six files, against ~500 KB for the other eight families together). A
 * drawing that uses it falls through to the CDN; everything else is local.
 *
 * The output is COMMITTED. This script exists so the provenance is
 * reproducible, not so anything is fetched at run time.
 *
 *   node tools/build-excalidraw-assets.mjs [--force]
 *
 * Licences: Excalidraw is MIT (Copyright (c) 2020 Excalidraw). The faces are
 * OFL (Excalifont, Virgil, Lilita One, Nunito, Assistant, Cascadia Code,
 * Liberation Sans) and MIT (Comic Shanns).
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const PKG_DIR = resolve(ROOT, 'node_modules/@excalidraw/excalidraw');
const SRC_FONTS = join(PKG_DIR, 'dist/prod/fonts');
const OUT_DIR = resolve(ROOT, 'public/excalidraw');
const OUT_FONTS = join(OUT_DIR, 'fonts');

/** Families left to the CDN fallback, by directory name. */
const SKIP_FAMILIES = new Set(['Xiaolai']);
/** The family count is the invariant: a partial copy renders half the text. */
const EXPECTED_FAMILIES = 8;

const force = process.argv.includes('--force');
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

if (!existsSync(SRC_FONTS)) {
  throw new Error('@excalidraw/excalidraw is not installed — run npm install first.');
}

const version = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8')).version;

const families = readdirSync(SRC_FONTS)
  .filter((name) => statSync(join(SRC_FONTS, name)).isDirectory() && !SKIP_FAMILIES.has(name))
  .sort();

if (families.length !== EXPECTED_FAMILIES) {
  throw new Error(
    `expected ${EXPECTED_FAMILIES} families in ${SRC_FONTS} (after skipping ${[...SKIP_FAMILIES].join(', ')}), ` +
      `found ${families.length} — refusing to write.`
  );
}

/** `Family/File.woff2`, sorted, for every vendored face. */
const files = families.flatMap((family) =>
  readdirSync(join(SRC_FONTS, family))
    .filter((name) => name.endsWith('.woff2'))
    .sort()
    .map((name) => `${family}/${name}`)
);

const copied = [];
let skipped = 0;
for (const rel of files) {
  const from = join(SRC_FONTS, rel);
  const to = join(OUT_FONTS, rel);
  mkdirSync(dirname(to), { recursive: true });
  if (existsSync(to) && !force) {
    skipped++;
  } else {
    copyFileSync(from, to);
    copied.push(rel);
  }
}

const total = files.reduce((sum, rel) => sum + statSync(join(OUT_FONTS, rel)).size, 0);

const provenance = [
  'Excalidraw web fonts, vendored for offline use.',
  '',
  `source:      node_modules/@excalidraw/excalidraw @ ${version} (dist/prod/fonts/)`,
  'licence:     MIT (Excalidraw, (c) 2020 Excalidraw)',
  '             OFL (Excalifont, Virgil, Lilita One, Nunito, Assistant,',
  '             Cascadia Code, Liberation Sans); MIT (Comic Shanns)',
  'regenerate:  node tools/build-excalidraw-assets.mjs --force',
  '',
  `Not vendored: ${[...SKIP_FAMILIES].join(', ')} (CJK, 13 MB) — Excalidraw falls back to its CDN`,
  'for that family only.',
  '',
  `files:       ${files.length} faces in ${families.length} families`,
  `bytes:       ${total}`,
  '',
  ...files.map((rel) => `${sha256(join(OUT_FONTS, rel))}  ${statSync(join(OUT_FONTS, rel)).size}  fonts/${rel}`),
  '',
].join('\n');
writeFileSync(join(OUT_DIR, 'PROVENANCE.txt'), provenance, 'utf8');

console.log(
  `excalidraw fonts: ${files.length} faces in ${families.length} families, ${total} bytes ` +
    `(${copied.length} copied, ${skipped} already present) → public/excalidraw/`
);
