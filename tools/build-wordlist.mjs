/**
 * Vendors the EFF Long Wordlist into src/lib/gen/wordlist.json.
 *
 * The passphrase generator needs a word list with a known size, so the entropy
 * it reports is a fact rather than a guess. The EFF list is 7,776 words —
 * exactly 5 dice rolls, so 12.9 bits per word — and is chosen for words that
 * are easy to type, hard to confuse when spoken, and free of anything
 * unpleasant. It is CC BY 3.0 US, which we honour in the tool's UI and here.
 *
 * The file is COMMITTED: this script exists so the provenance is reproducible,
 * not so the app fetches anything at runtime. Nothing in useful may reach the
 * network to work.
 *
 *   node tools/build-wordlist.mjs [--force]
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../src/lib/gen/wordlist.json');
const SOURCE = 'https://www.eff.org/files/2016/07/18/eff_large_wordlist.txt';
const EXPECTED_WORDS = 7776;

if (existsSync(OUT) && !process.argv.includes('--force')) {
  console.log(`${OUT} exists — pass --force to rebuild.`);
  process.exit(0);
}

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`${SOURCE} → HTTP ${res.status}`);
const text = await res.text();

// Each line is "<dice roll>\t<word>".
const words = text
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const parts = line.split(/\s+/);
    return parts[parts.length - 1];
  })
  // Four entries are hyphenated (drop-down, felt-tip, t-shirt, yo-yo); they
  // are words, and dropping them would change the list size and so the entropy.
  .filter((w) => /^[a-z-]+$/.test(w));

if (words.length !== EXPECTED_WORDS) {
  throw new Error(`expected ${EXPECTED_WORDS} words, parsed ${words.length} — refusing to write`);
}
if (new Set(words).size !== words.length) throw new Error('the list has duplicates');

const payload = {
  source: SOURCE,
  name: 'EFF Long Wordlist (2016)',
  license: 'CC BY 3.0 US — https://creativecommons.org/licenses/by/3.0/us/',
  sha256: createHash('sha256').update(text).digest('hex'),
  bitsPerWord: Math.log2(words.length),
  words,
};

await writeFile(OUT, JSON.stringify(payload) + '\n', 'utf8');
console.log(`wrote ${OUT}: ${words.length} words, sha256 ${payload.sha256.slice(0, 16)}…`);
