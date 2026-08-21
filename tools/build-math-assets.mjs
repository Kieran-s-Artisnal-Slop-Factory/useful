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
 * `katex.css` is KaTeX's own `katex.min.css` with every `@font-face` block
 * REMOVED. KaTeX declares the same twenty families (the MathLive faces ARE the
 * KaTeX faces), so `mathlive-fonts.css` already provides them — what remains
 * is ~20 KB of layout rules the notebook needs to render `$…$` maths, and the
 * one stylesheet the self-contained HTML export inlines.
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
 * Licences: MathLive is MIT (Copyright (c) 2017 Arno Gourdol). KaTeX, its
 * stylesheet and the faces are MIT (Copyright (c) 2013-2020 Khan Academy and
 * contributors).
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
const KATEX_DIR = resolve(ROOT, 'node_modules/katex');
const KATEX_SRC = join(KATEX_DIR, 'dist/katex.min.css');
const KATEX_CSS_NAME = 'katex.css';

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

if (!existsSync(KATEX_SRC)) {
  throw new Error('katex is not installed — run npm install first.');
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

/**
 * katex.min.css minus its twenty `@font-face` blocks. The blocks are minified
 * onto one line with no nested braces, so a non-greedy brace match is exact;
 * the count is asserted so a KaTeX release that changes shape fails loudly
 * instead of shipping a stylesheet that quietly re-declares the faces.
 */
const katexFull = readFileSync(KATEX_SRC, 'utf8');
const faceBlocks = katexFull.match(/@font-face\{[^{}]*\}/g) ?? [];
if (faceBlocks.length !== EXPECTED_FONTS) {
  throw new Error(
    `expected ${EXPECTED_FONTS} @font-face blocks in katex.min.css, found ${faceBlocks.length} ` +
      '— refusing to write.'
  );
}
const katexLayout = katexFull.replace(/@font-face\{[^{}]*\}/g, '').trim() + '\n';
if (/@font-face|url\(/.test(katexLayout)) {
  throw new Error('katex.css still references a font or URL after stripping — refusing to write');
}
{
  const to = join(OUT_DIR, KATEX_CSS_NAME);
  if (existsSync(to) && !force) {
    skipped++;
  } else {
    writeFileSync(to, katexLayout, 'utf8');
    copied.push(KATEX_CSS_NAME);
  }
}

const version = JSON.parse(readFileSync(join(SRC_DIR, 'package.json'), 'utf8')).version;
const katexVersion = JSON.parse(readFileSync(join(KATEX_DIR, 'package.json'), 'utf8')).version;
const entries = [
  ...faces.map((f) => join('fonts', f).replaceAll('\\', '/')),
  CSS_NAME,
  KATEX_CSS_NAME,
].map((name) => {
  const path = join(OUT_DIR, name);
  return { name, bytes: statSync(path).size, hash: sha256(path) };
});
const total = entries.reduce((sum, e) => sum + e.bytes, 0);

writeFileSync(
  join(OUT_DIR, 'PROVENANCE.txt'),
  [
    'MathLive KaTeX web fonts and the KaTeX layout stylesheet, vendored for offline use.',
    '',
    `source:      node_modules/mathlive @ ${version}`,
    `             node_modules/katex @ ${katexVersion} (katex.css = dist/katex.min.css`,
    '             with its 20 @font-face blocks removed; mathlive-fonts.css declares',
    '             the same families over the same faces)',
    'licence:     MIT (MathLive, (c) 2017 Arno Gourdol)',
    '             MIT (KaTeX, its stylesheet and faces, (c) 2013-2020 Khan Academy',
    '             and contributors)',
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
