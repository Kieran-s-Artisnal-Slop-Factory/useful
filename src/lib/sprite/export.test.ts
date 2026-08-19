import { describe, expect, it } from 'vitest';
import { PET_EXAMPLES } from './pets';
import {
  normalizeSprite,
  parseJson,
  parseText,
  RETOKEN_FORMAT,
  SPRITE_FORMAT,
  toJson,
  toSvgString,
  toText,
} from './export';
import { blankSprite, isSafeColor, resizeSprite, resolveColor, spritePixels } from './types';

const grid = (rows: string[]) => ({ size: Math.max(...rows.map((r) => r.length)), rows });

describe('isSafeColor', () => {
  it('accepts the spellings the legend is allowed to hold', () => {
    for (const v of ['#fff', '#ff8800', '#ff8800cc', 'rgb(1 2 3)', 'rgba(1,2,3,0.5)', 'hsl(10 20% 30%)', 'red', 'transparent']) {
      expect(isSafeColor(v), v).toBe(true);
    }
  });

  it('rejects anything that could escape an attribute or a style', () => {
    // This check is what stops a hostile legend smuggling markup into an
    // exported SVG or a background-image into a cell's inline style.
    for (const v of [
      '',
      '   ',
      'red;background-image:url(x)',
      '"><script>alert(1)</script>',
      'url(http://example.com/x.png)',
      'var(--x)',
      'expression(1)',
      '#'.padEnd(80, 'f'),
    ]) {
      expect(isSafeColor(v), v).toBe(false);
    }
  });
});

describe('resizeSprite / blankSprite', () => {
  it('pads short rows and truncates long ones to a square', () => {
    const out = resizeSprite(grid(['ab', 'abcd']), 3);
    expect(out).toEqual({ size: 3, rows: ['ab.', 'abc', '...'] });
  });

  it('never leaves a ragged grid, whatever it is given', () => {
    for (const size of [1, 4, 16, 48]) {
      const out = resizeSprite(grid(['x']), size);
      expect(out.rows).toHaveLength(size);
      for (const row of out.rows) expect(row).toHaveLength(size);
    }
  });

  it('blankSprite is transparent everywhere', () => {
    const out = blankSprite(5);
    expect(out.rows).toEqual(['.....', '.....', '.....', '.....', '.....']);
    expect(spritePixels(out, { '.': '#fff' })).toEqual([]); // '.' is reserved
  });
});

describe('resolveColor', () => {
  it('treats the reserved characters as nothing, mapped ones as their colour', () => {
    const colors = { k: '#000' };
    expect(resolveColor('k', colors)).toBe('#000');
    expect(resolveColor('.', colors)).toBeNull();
    expect(resolveColor(' ', colors)).toBeNull();
    expect(resolveColor('z', colors)).toBeNull(); // unmapped
  });
});

describe('text round trip', () => {
  it('survives toText → parseText', () => {
    const before = grid(['ab.', '.cd', 'e.f']);
    expect(parseText(toText(before))).toEqual(before);
  });

  it('squares up a ragged paste and drops one trailing newline', () => {
    expect(parseText('ab\nabcd\n')).toEqual({ size: 4, rows: ['ab..', 'abcd', '....', '....'] });
  });

  it('handles CRLF', () => {
    expect(parseText('ab\r\ncd').rows).toEqual(['ab', 'cd']);
  });
});

describe('JSON documents', () => {
  it('round-trips grid and legend', () => {
    const sprite = grid(['kk', '.k']);
    const colors = { k: '#1d1d24' };
    const back = parseJson(toJson(sprite, colors));
    expect(back.sprite).toEqual(sprite);
    expect(back.colors).toEqual(colors);
  });

  it('writes this app format and reads retoken files too', () => {
    expect(JSON.parse(toJson(grid(['k']), {})).format).toBe(SPRITE_FORMAT);
    const fromRetoken = JSON.stringify({ format: RETOKEN_FORMAT, version: 1, size: 1, rows: ['k'], colors: { k: 'red' } });
    expect(parseJson(fromRetoken).colors).toEqual({ k: 'red' });
  });

  it('refuses anything that is not a sprite file', () => {
    expect(() => parseJson('not json')).toThrow(/valid JSON/);
    expect(() => parseJson('{}')).toThrow(/format/);
    expect(() => parseJson(JSON.stringify({ format: SPRITE_FORMAT, rows: 'nope' }))).toThrow(/rows/);
    expect(() => parseJson(JSON.stringify({ format: SPRITE_FORMAT, rows: [1, 2] }))).toThrow(/rows/);
  });

  it('drops legend entries that are not a single character mapping to a safe colour', () => {
    const doc = JSON.stringify({
      format: SPRITE_FORMAT,
      version: 1,
      size: 1,
      rows: ['k'],
      colors: { k: '#000', ab: 'red', z: 'url(x)', q: 42 },
    });
    expect(parseJson(doc).colors).toEqual({ k: '#000' });
  });

  it('squares up a hostile or hand-written grid', () => {
    const doc = JSON.stringify({
      format: SPRITE_FORMAT,
      version: 1,
      size: -5,
      rows: ['kkkk', 'k'],
      colors: {},
    });
    const { sprite } = parseJson(doc);
    expect(sprite.size).toBe(4);
    expect(sprite.rows).toEqual(['kkkk', 'k...', '....', '....']);
  });
});

describe('toSvgString', () => {
  it('emits one rect per painted pixel and nothing for transparent ones', () => {
    const svg = toSvgString(grid(['k.', '.k']), { k: '#000' }, 64);
    expect(svg.match(/<rect/g)).toHaveLength(2);
    expect(svg).toContain('viewBox="0 0 2 2"');
    expect(svg).toContain('width="64"');
    expect(svg).toContain('shape-rendering="crispEdges"');
  });

  it('escapes a colour that was never validated', () => {
    // The function is reusable, so it cannot assume the legend came from the
    // editor: a quote must not be able to close the fill attribute.
    const svg = toSvgString(grid(['k']), { k: '"><script>alert(1)</script>' }, 32);
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&quot;&gt;&lt;script&gt;');
  });
});

describe('normalizeSprite', () => {
  it('accepts a well-formed row', () => {
    const { sprite, colors } = normalizeSprite(2, ['ab', 'cd'], { a: 'red' });
    expect(sprite).toEqual({ size: 2, rows: ['ab', 'cd'] });
    expect(colors).toEqual({ a: 'red' });
  });

  it('survives the array the generic data suite writes into a json column', () => {
    // schema.ts's sample value for `json` is an array, and it lands in BOTH
    // columns — this must not throw on load.
    const { sprite, colors } = normalizeSprite(4, ['a', 'b', 'ünï 😀', 3], ['a', 'b', 'ünï 😀', 3]);
    expect(colors).toEqual({});
    // The non-string entry is dropped and the grid grows to fit the longest
    // surviving row rather than truncating it — square either way, which is
    // the invariant the renderer and the SVG export depend on.
    expect(sprite.rows).toHaveLength(sprite.size);
    for (const row of sprite.rows) expect(row).toHaveLength(sprite.size);
  });

  it('survives nulls, junk and negative sizes', () => {
    for (const args of [
      [null, null, null],
      [undefined, undefined, undefined],
      [-3, [], {}],
      ['16', 'rows', 'colors'],
      [Number.NaN, ['ab'], { a: 'url(x)' }],
    ] as const) {
      const { sprite, colors } = normalizeSprite(args[0], args[1], args[2]);
      expect(sprite.size).toBeGreaterThan(0);
      expect(sprite.rows).toHaveLength(sprite.size);
      for (const row of sprite.rows) expect(row).toHaveLength(sprite.size);
      expect(Object.keys(colors).every((k) => k.length === 1)).toBe(true);
    }
  });
});

describe('the bundled examples', () => {
  it('are square grids with safe colours', () => {
    expect(PET_EXAMPLES.length).toBeGreaterThan(0);
    for (const example of PET_EXAMPLES) {
      expect(example.id, 'every example needs an id').toBeTruthy();
      expect(example.variants.length, `${example.id} has no variants`).toBeGreaterThan(0);
      for (const [char, color] of Object.entries(example.colors)) {
        expect(char, `${example.id} legend key "${char}"`).toHaveLength(1);
        expect(isSafeColor(color), `${example.id} colour ${color}`).toBe(true);
      }
      for (const variant of example.variants) {
        expect(variant.grid.rows, `${example.id}/${variant.name} row count`).toHaveLength(
          variant.grid.size
        );
        for (const row of variant.grid.rows) {
          expect(row.length, `${example.id}/${variant.name} row width`).toBe(variant.grid.size);
        }
      }
    }
  });

  it('have unique ids', () => {
    const ids = PET_EXAMPLES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
