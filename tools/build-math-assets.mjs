/**
 * Vendors MathLive's KaTeX web fonts into public/math/.
 *
 * The napkin-math editor renders formulas with MathLive, which draws them out
 * of twenty KaTeX faces. Those faces have to be served from this origin: the
 * app is offline-first and nothing in it may reach the network to work.
 *
 * `mathlive-fonts.css` is copied VERBATIM, not rewritten. Its `url(fonts/…)`
 * are relative and resolve correctly once the file sits beside a `fonts/`
 * directory — and its trailing `:root{--ML__static-fonts:true}` is the line
 * that tells MathLive's own font loader to stand down, so the library never
 * constructs a `FontFace` or probes for a fonts directory of its own.
 *
 * NOT vendored, deliberately:
 *  - `mathlive-static.css` — 13 KB of layout rules the library already injects
 *    itself. Shipping both gives two sources for the same rules.
 *  - the five `.wav` keypress sounds (227 KB). `soundsDirectory = null`
 *    switches them off; a Playwright check asserts none is ever requested.
 *  - `@cortex-js/compute-engine` — plain JavaScript, so Vite bundles it.
 *
 * The output is COMMITTED. This script exists so the provenance is
 * reproducible, not so anything is fetched at run time.
 *
 *   node tools/build-math-assets.mjs [--force]
 *
 * Licences: MathLive is MIT (Copyright (c) 2017 Arno Gourdol). The KaTeX faces
 * are MIT (Copyright (c) 2013-2020 Khan Academy and contributors).
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SRC_DIR = resolve(ROOT, 'node_modules/mathlive');
const SRC_FONTS = join(SRC_DIR, 'fonts');
const OUT_DIR = resolve(ROOT, 'public/math');
const OUT_FONTS = join(OUT_DIR, 'fonts');
const CSS_NAME = 'mathlive-fonts.css';

/** The face count is the invariant: a partial copy renders half the glyphs. */
const EXPECTED_FONTS = 20;

const force = process.argv.includes('--force');
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

if (!existsSync(SRC_FONTS)) {
  throw new Error('mathlive is not installed — run npm install first.');
}

const faces = readdirSync(SRC_FONTS)
  .filter((name) => name.endsWith('.woff2'))
  .sort();

if (faces.length !== EXPECTED_FONTS) {
  throw new Error(
    `expected ${EXPECTED_FONTS} faces in ${SRC_FONTS}, found ${faces.length} — refusing to write.`
  );
}

const cssSource = join(SRC_DIR, CSS_NAME);
if (!existsSync(cssSource)) {
  throw new Error(`${CSS_NAME} is missing from the mathlive package — refusing to write.`);
}

mkdirSync(OUT_FONTS, { recursive: true });

const copied = [];
let skipped = 0;
for (const name of [...faces.map((f) => join('fonts', f)), CSS_NAME]) {
  const from = join(SRC_DIR, name);
  const to = join(OUT_DIR, name);
  if (existsSync(to) && !force) {
    skipped++;
  } else {
    copyFileSync(from, to);
    copied.push(name);
  }
}

const version = JSON.parse(readFileSync(join(SRC_DIR, 'package.json'), 'utf8')).version;
const entries = [...faces.map((f) => join('fonts', f).replaceAll('\\', '/')), CSS_NAME].map((name) => {
  const path = join(OUT_DIR, name);
  return { name, bytes: statSync(path).size, hash: sha256(path) };
});
const total = entries.reduce((sum, e) => sum + e.bytes, 0);

writeFileSync(
  join(OUT_DIR, 'PROVENANCE.txt'),
  [
    'MathLive KaTeX web fonts, vendored for offline use.',
    '',
    `source:      node_modules/mathlive @ ${version}`,
    'licence:     MIT (MathLive, (c) 2017 Arno Gourdol)',
    '             MIT (KaTeX faces, (c) 2013-2020 Khan Academy and contributors)',
    'regenerate:  node tools/build-math-assets.mjs --force',
    '',
    'Not vendored: mathlive-static.css (the library injects those rules itself),',
    'the five .wav keypress sounds (soundsDirectory = null switches them off), and',
    '@cortex-js/compute-engine (plain JS, bundled by Vite).',
    '',
    `${entries.length} files, ${total} bytes total`,
    '',
    ...entries.map((e) => `${String(e.bytes).padStart(7)}  ${e.hash}  ${e.name}`),
    '',
  ].join('\n'),
  'utf8'
);

console.log(
  `${copied.length} copied, ${skipped} already present — ${entries.length} files, ${total} bytes.`
);
if (skipped > 0 && copied.length === 0) console.log('Pass --force to overwrite.');
