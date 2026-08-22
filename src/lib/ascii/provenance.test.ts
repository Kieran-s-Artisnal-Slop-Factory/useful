/**
 * The font-licence gate, tested where it can actually fail.
 *
 * `tools/build-figlet-fonts.mjs` is the only thing standing between "a font
 * looks nice" and shipping a file we cannot account for, so its refusal path
 * is tested directly rather than trusted — and the vendored output is checked
 * against the checksums it recorded, which is what would catch a font edited
 * by hand or a rebuild nobody re-ran.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  authorLines,
  CATALOGUE_FONTS,
  fontPath,
  licenceLines,
  provenanceFor,
  readFlf,
} from '../../../tools/build-figlet-fonts.mjs';
import { FIGLET_FONTS } from './fonts';

const ROOT = resolve(__dirname, '../../..');
const font = (id: string) => resolve(ROOT, 'public/figlet', `${id}.flf`);

/** A minimal but real FIGfont: signature, N comment lines, then glyph rows. */
const makeFlf = (comment: string[], { hardblank = '$', magic = 'flf2a' } = {}) =>
  [`${magic}${hardblank} 2 2 4 -1 ${comment.length}`, ...comment, ' $@', ' $@@'].join('\n');

describe('readFlf', () => {
  it('takes the comment-line count from the signature, not from guesswork', () => {
    const parsed = readFlf(makeFlf(['one', 'two', 'three']));
    expect(parsed.commentLines).toBe(3);
    expect(parsed.comment).toEqual(['one', 'two', 'three']);
  });

  it('reads a font whose hardblank is a space', () => {
    // `Future` is one of these: the sixth character IS the hardblank, so
    // splitting the whole line on whitespace shifts every field by one.
    expect(readFlf(makeFlf(['x'], { hardblank: ' ' })).commentLines).toBe(1);
  });

  it('accepts TOIlet fonts, which are the same format under another magic', () => {
    expect(readFlf(makeFlf(['x'], { magic: 'tlf2a' })).commentLines).toBe(1);
  });

  it('refuses a file that is not a FIGfont at all', () => {
    expect(() => readFlf('PK not a font')).toThrow(/not a FIGfont/);
  });
});

describe('licenceLines', () => {
  it('finds the classic FIGlet grant and follows it to the end of the sentence', () => {
    expect(
      licenceLines([
        'Big by Glenn Chappell 4/93',
        'Permission is hereby given to modify this font, as long as the',
        "modifier's name is placed on a comment line.",
      ])
    ).toEqual([
      "Permission is hereby given to modify this font, as long as the modifier's name is placed on a comment line.",
    ]);
  });

  it('finds the named licences too', () => {
    expect(licenceLines(['This font is free to use and distribute / MIT License'])).toHaveLength(1);
    expect(licenceLines(['released into the public domain.'])).toHaveLength(1);
    expect(licenceLines(['the terms of the Do What The Fuck You Want To Public License, Version 2.'])).toHaveLength(1);
  });

  it('does NOT accept a name and an email address as a licence', () => {
    expect(licenceLines(['Font Author: ?', 'More Info:', 'http://example.com/thedrawfonts'])).toEqual([]);
    expect(licenceLines(['Figlet conversion by patorjk, April 17, 2008'])).toEqual([]);
    expect(licenceLines([])).toEqual([]);
  });
});

describe('authorLines', () => {
  it('picks out the header lines that name a person', () => {
    expect(authorLines(['Font Author: MJP', 'Version: 1.0'])).toEqual(['Font Author: MJP']);
  });
});

describe('provenanceFor — the refusal', () => {
  it('refuses a font whose header states no licence', () => {
    const unlicensed = Buffer.from(makeFlf(['Font Author: ?', 'More Info:', '']), 'utf8');
    expect(() => provenanceFor(unlicensed)).toThrow(/states no licence/);
  });

  it('accepts one that does, and checksums exactly what it would write', () => {
    const buffer = Buffer.from(makeFlf(['Permission is hereby given to modify this font.']), 'utf8');
    const p = provenanceFor(buffer);
    expect(p.licence).toEqual(['Permission is hereby given to modify this font.']);
    expect(p.transcoded).toBe(false);
    expect(p.sha256).toBe(createHash('sha256').update(buffer).digest('hex'));
  });

  it('transcodes a Latin-1 font to UTF-8 and says so', () => {
    // 0xE9 is é in Latin-1 and an illegal lone byte in UTF-8: read the file as
    // UTF-8 in the browser and the glyph arrives as U+FFFD.
    const latin1 = Buffer.from(makeFlf(['Permission is hereby given. Caf\xe9 font.']), 'latin1');
    const p = provenanceFor(latin1);
    expect(p.transcoded).toBe(true);
    expect(p.text).toContain('Café');
    expect(p.bytes.toString('utf8')).toContain('Café');
  });
});

describe('the vendored fonts', () => {
  const sw = readFileSync(resolve(ROOT, 'public/sw.js'), 'utf8');

  it('are exactly the catalogue the build script curates', () => {
    expect(FIGLET_FONTS.map((f) => f.id)).toEqual(CATALOGUE_FONTS.map((f) => f.id));
    expect(FIGLET_FONTS.length).toBeGreaterThanOrEqual(12);
  });

  it('cover the four shapes the release asked for', () => {
    const styles = new Set(FIGLET_FONTS.map((f) => f.style));
    expect(styles).toContain('3-D');
    expect(styles).toContain('Stroke');
    expect(styles).toContain('Blocks');
    expect(FIGLET_FONTS.some((f) => f.id === 'fire-font-k')).toBe(true);
  });

  it('are on disk, unmodified, and every one carries a licence', () => {
    for (const f of FIGLET_FONTS) {
      expect(existsSync(font(f.id)), `${f.id}.flf is missing`).toBe(true);
      const bytes = readFileSync(font(f.id));
      expect(bytes.length, `${f.id}.flf changed size`).toBe(f.bytes);
      expect(createHash('sha256').update(bytes).digest('hex'), `${f.id}.flf changed`).toBe(f.sha256);
      expect(f.licence.length, `${f.id} has no licence recorded`).toBeGreaterThan(10);
    }
  });

  it('are every one of them precached by the service worker', () => {
    for (const f of FIGLET_FONTS) {
      expect(sw, `sw.js SHELL is missing ${fontPath(f.id)}`).toContain(`'${fontPath(f.id)}'`);
    }
  });

  it('are listed in PROVENANCE.txt with their licence quoted', () => {
    const provenance = readFileSync(resolve(ROOT, 'public/figlet/PROVENANCE.txt'), 'utf8');
    for (const f of FIGLET_FONTS) {
      expect(provenance).toContain(`## ${f.name}`);
      expect(provenance).toContain(f.sha256);
    }
  });
});
