/**
 * Vendors the FIGlet fonts the ASCII-art tool ships with.
 *
 * `figlet` (the library) is a dependency; its ~300 fonts are NOT. Only the
 * curated list below is copied out of `node_modules/figlet/fonts/` into
 * `public/figlet/`, and the ONE rule this script exists to enforce is that a
 * font may not ship unless its own header says, in words, that it may be
 * redistributed. A `.flf` header is free text — plenty of them name an author
 * and stop there — so "make sure you can source the licenses" is turned here
 * into something a person cannot forget: an unlicensed font makes this script
 * exit 1 and write nothing.
 *
 * Two smaller jobs ride along:
 *
 *  - **Transcoding.** Some fonts are Latin-1 (`Ghost`, `Varsity`, `3D
 *    Diagonal` today). The browser reads a `.flf` with `Response.text()`,
 *    which is UTF-8, so a Latin-1 byte would arrive as U+FFFD and the glyph
 *    would be drawn wrong. Non-UTF-8 files are decoded as Latin-1 and written
 *    back as UTF-8; PROVENANCE.txt records that it happened.
 *  - **Provenance.** `public/figlet/PROVENANCE.txt` lists every font with its
 *    author lines, its licence lines quoted verbatim, its byte count and a
 *    SHA-256 of the file as shipped — so "where did this come from" is a file
 *    read, not an archaeology project.
 *
 * The outputs are COMMITTED. This script exists so they are reproducible, not
 * so the app fetches anything at runtime.
 *
 *   node tools/build-figlet-fonts.mjs [--check]
 *
 * `--check` runs every gate and writes nothing — what CI would run.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE_DIR = resolve(HERE, '../node_modules/figlet/fonts');
const OUT_DIR = resolve(HERE, '../public/figlet');
const CATALOGUE = resolve(HERE, '../src/lib/ascii/fonts.json');
const SW = resolve(HERE, '../public/sw.js');

/**
 * The fonts we ship, and why each one is here.
 *
 * `id` is the filename in `public/figlet/` AND the key the app registers with
 * `figlet.parseFont()` — a slug, because a URL with a space in it is a URL
 * with a `%20` in it, and those end up hand-written in three places.
 *
 * `style` is what the picker groups by. The four the release TODO asked for
 * are all present and marked: a blocky 3-D one (3D Diagonal), stroke-based
 * ones (Standard, Slant, Small...), one with flames (Fire Font-k) and one
 * built from block characters (Pagga).
 */
export const CATALOGUE_FONTS = [
  { id: 'standard', source: 'Standard', style: 'Stroke', note: 'The FIGlet default since 1993.' },
  { id: 'slant', source: 'Slant', style: 'Stroke', note: 'Standard, leaning.' },
  { id: 'small', source: 'Small', style: 'Stroke', note: 'Half the height of Standard.' },
  { id: 'mini', source: 'Mini', style: 'Stroke', note: 'Four rows — fits in a comment.' },
  { id: 'bigfig', source: 'Bigfig', style: 'Stroke', note: 'Letters drawn with letters.' },
  { id: 'doom', source: 'Doom', style: 'Stroke', note: 'Heavy pipes and slashes.' },
  { id: 'varsity', source: 'Varsity', style: 'Stroke', note: 'Collegiate outline.' },
  { id: 'script', source: 'Script', style: 'Stroke', note: 'Joined-up handwriting.' },
  { id: 'shadow', source: 'Shadow', style: 'Shadow', note: 'Standard with a drop shadow.' },
  { id: 'ghost', source: 'Ghost', style: 'Shadow', note: 'Outlined and hollow.' },
  { id: '3d-diagonal', source: '3D Diagonal', style: '3-D', note: 'Blocky, extruded, tall.' },
  { id: 'fire-font-k', source: 'Fire Font-k', style: 'Decorative', note: 'Letters on fire.' },
  { id: 'pagga', source: 'Pagga', style: 'Blocks', note: 'Built from ░ ▀ █ — three rows.' },
  { id: 'future', source: 'Future', style: 'Blocks', note: 'Box-drawing strokes, one row tall.' },
];

/**
 * Header lines that count as permission to redistribute.
 *
 * Deliberately narrow. "Font Author: ?" is not a licence, and neither is a
 * name and an email address — the classic FIGlet grant ("Permission is hereby
 * given to modify this font...") is, and so are the explicit ones (MIT,
 * WTFPL, public domain, a copyright line with terms attached).
 */
const LICENCE_PATTERNS = [
  /permission is hereby (given|granted)/i,
  /permission is granted/i,
  /public domain/i,
  /free to use/i,
  /freeware/i,
  /\bMIT License\b/i,
  /\bWTFPL\b/i,
  /Do What The Fuck You Want/i,
  /Creative Commons|\bCC0\b|\bCC BY\b/i,
  /\bGPL\b|\bBSD\b/i,
  /copyright \(c\)/i,
];

const AUTHOR_PATTERNS = [/^\s*(font\s+)?author\s*[:\-]/i, /\bby\b .*\d{1,2}\/\d{2}/i, /created by/i];

/**
 * Split a `.flf` file into its signature line, its comment block and the rest.
 *
 * The signature is `flf2a<hardblank> height baseline maxLength oldLayout
 * commentLines ...`, so the comment block is exactly `commentLines` long — no
 * sniffing, and no risk of reading a glyph row as prose.
 *
 * Two details the spec makes easy to get wrong, and both bite here:
 *  - the six-character prefix is `flf2a` plus the hardblank CHARACTER, which
 *    may itself be a space (`Future` uses one), so the fields are read from
 *    `slice(6)` rather than by splitting the whole line;
 *  - TOIlet fonts announce themselves as `tlf2a`. They are the same format
 *    with Unicode glyphs, `figlet` parses them, and two of the block fonts we
 *    ship are ones.
 */
export function readFlf(text) {
  const lines = text.split(/\r?\n/);
  const signature = lines[0] ?? '';
  if (!/^[ft]lf2a/.test(signature)) {
    throw new Error(`not a FIGfont file (signature was ${JSON.stringify(signature.slice(0, 20))})`);
  }
  const count = Number(signature.slice(6).trim().split(/\s+/)[4]);
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`unreadable comment-line count in the signature: ${signature}`);
  }
  return { signature, comment: lines.slice(1, 1 + count), commentLines: count };
}

/**
 * The header lines that state a licence. Empty when the font states none.
 *
 * A grant is a sentence, and a `.flf` header is hard-wrapped prose, so a
 * match is followed to the end of its sentence (up to two continuation
 * lines): the classic FIGlet grant breaks right after "as long as the", and
 * quoting only that half in PROVENANCE.txt would record a condition with no
 * condition in it.
 */
export function licenceLines(comment) {
  const out = [];
  for (let i = 0; i < comment.length; i++) {
    if (!LICENCE_PATTERNS.some((re) => re.test(comment[i]))) continue;
    let text = comment[i].trim();
    for (let n = 0; n < 2 && !/[.!?]$/.test(text); n++) {
      const next = (comment[i + 1 + n] ?? '').trim();
      if (!next) break;
      text += ` ${next}`;
    }
    if (!out.includes(text)) out.push(text);
  }
  return out;
}

/** The header lines that name a person. Best-effort; provenance, not proof. */
export function authorLines(comment) {
  return comment.filter((line) => AUTHOR_PATTERNS.some((re) => re.test(line))).map((l) => l.trim());
}

/**
 * Everything we record about one font — and the refusal.
 *
 * Throws when the header carries no licence statement. That is the whole
 * point of the script: the failure is loud, it names the font, and it stops
 * the build rather than shipping something we cannot account for.
 */
export function provenanceFor(buffer) {
  const utf8Clean = Buffer.from(buffer.toString('utf8'), 'utf8').equals(buffer);
  const text = utf8Clean ? buffer.toString('utf8') : buffer.toString('latin1');
  const { comment, commentLines } = readFlf(text);
  const licence = licenceLines(comment);
  if (licence.length === 0) {
    throw new Error(
      'the font header states no licence — refusing to vendor it. ' +
        `Header (${commentLines} comment lines): ${comment.join(' / ').slice(0, 200) || '(empty)'}`
    );
  }
  const out = Buffer.from(text, 'utf8');
  return {
    text,
    bytes: out,
    transcoded: !utf8Clean,
    licence,
    authors: authorLines(comment),
    sha256: createHash('sha256').update(out).digest('hex'),
  };
}

/** `public/figlet/<id>.flf`, as sw.js's SHELL and the app both spell it. */
export const fontPath = (id) => `figlet/${id}.flf`;

function main() {
  const check = process.argv.includes('--check');
  if (!existsSync(SOURCE_DIR)) {
    console.error(`${SOURCE_DIR} does not exist — run \`npm install\` first.`);
    process.exit(2);
  }

  const failures = [];
  const records = [];
  for (const font of CATALOGUE_FONTS) {
    const file = resolve(SOURCE_DIR, `${font.source}.flf`);
    if (!existsSync(file)) {
      failures.push(`${font.source}: not in node_modules/figlet/fonts/`);
      continue;
    }
    try {
      const p = provenanceFor(readFileSync(file));
      records.push({ ...font, ...p });
    } catch (err) {
      failures.push(`${font.source}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (failures.length > 0) {
    console.error('Refusing to vendor FIGlet fonts:\n');
    for (const f of failures) console.error(`  - ${f}\n`);
    process.exit(1);
  }

  // The service worker precaches these with the shell, so a font that is not
  // listed there is a font that is missing offline. Cheap to check, and the
  // failure mode it prevents is invisible until someone is on a plane.
  const shell = readFileSync(SW, 'utf8');
  const unlisted = records.filter((r) => !shell.includes(`'${fontPath(r.id)}'`));
  if (unlisted.length > 0) {
    console.error(
      `public/sw.js SHELL is missing ${unlisted.length} font(s):\n` +
        unlisted.map((r) => `  '${fontPath(r.id)}',`).join('\n')
    );
    process.exit(1);
  }

  const total = records.reduce((n, r) => n + r.bytes.length, 0);
  if (check) {
    console.log(`${records.length} fonts, ${(total / 1024).toFixed(1)} KB — all licensed, all listed in SHELL.`);
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  for (const r of records) writeFileSync(resolve(OUT_DIR, `${r.id}.flf`), r.bytes);

  const provenance = [
    'FIGlet fonts vendored by tools/build-figlet-fonts.mjs — do not edit by hand.',
    '',
    'Source: the `figlet` npm package (MIT, https://github.com/patorjk/figlet.js),',
    'which redistributes the fonts below. Each entry quotes the licence statement',
    "found in that font's own .flf header; a font whose header states no licence is",
    'refused by the build rather than shipped.',
    '',
    `${records.length} fonts, ${(total / 1024).toFixed(1)} KB total.`,
    '',
    ...records.flatMap((r) => [
      `## ${r.source}  (${fontPath(r.id)})`,
      `style:    ${r.style}`,
      `bytes:    ${r.bytes.length}${r.transcoded ? '  (transcoded Latin-1 → UTF-8)' : ''}`,
      `sha256:   ${r.sha256}`,
      ...(r.authors.length ? [`author:   ${r.authors.join(' | ')}`] : []),
      ...r.licence.map((line, i) => `${i === 0 ? 'licence:  ' : '          '}${line}`),
      '',
    ]),
  ].join('\n');
  writeFileSync(resolve(OUT_DIR, 'PROVENANCE.txt'), provenance, 'utf8');

  const catalogue = records.map((r) => ({
    id: r.id,
    name: r.source,
    style: r.style,
    note: r.note,
    bytes: r.bytes.length,
    sha256: r.sha256,
    licence: r.licence.join(' '),
  }));
  writeFileSync(CATALOGUE, `${JSON.stringify(catalogue, null, 2)}\n`, 'utf8');

  console.log(
    `Wrote ${records.length} fonts (${(total / 1024).toFixed(1)} KB) to public/figlet/, ` +
      'plus PROVENANCE.txt and src/lib/ascii/fonts.json.'
  );
}

// Importable for its unit tests (src/lib/ascii/provenance.test.ts) without
// running the copy.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
