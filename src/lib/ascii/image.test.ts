import { describe, expect, it } from 'vitest';
import {
  asciiFromPixels,
  asciiText,
  DEFAULT_CELL_ASPECT,
  hexToRgb,
  luminance,
  MAX_COLUMNS,
  MIN_COLUMNS,
  rampById,
  rampCharAt,
  RAMPS,
  rgbToHex,
  rowsFor,
  type Pixels,
} from './image';

/** Build an RGBA buffer from a function of (x, y). */
function pixels(
  width: number,
  height: number,
  at: (x: number, y: number) => [number, number, number, number]
): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = at(x, y);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return { data, width, height };
}

const solid = (w: number, h: number, rgba: [number, number, number, number]) =>
  pixels(w, h, () => rgba);

describe('ramps', () => {
  it('ships a 10-step and a 70-step ramp, both lightest-first', () => {
    expect(RAMPS.map((r) => r.id)).toEqual(['simple', 'detail']);
    expect(rampById('simple').chars).toHaveLength(10);
    expect(rampById('detail').chars).toHaveLength(70);
    for (const ramp of RAMPS) {
      expect(ramp.chars[0]).toBe(' ');
      expect(ramp.chars[ramp.chars.length - 1]).not.toBe(' ');
      // Every character distinct: a ramp with a repeat has a step that does
      // nothing, and the gradient stalls there.
      expect(new Set(ramp.chars).size).toBe(ramp.chars.length);
    }
  });

  it('falls back to the default ramp for an unknown id', () => {
    expect(rampById('nope').id).toBe('simple');
  });

  it('maps ink 0 to the lightest character and 1 to the darkest, clamping outside', () => {
    const chars = ' .:-=+*#%@';
    expect(rampCharAt(0, chars)).toBe(' ');
    expect(rampCharAt(1, chars)).toBe('@');
    expect(rampCharAt(-5, chars)).toBe(' ');
    expect(rampCharAt(5, chars)).toBe('@');
    expect(rampCharAt(0.5, chars)).toBe('+');
    expect(rampCharAt(0.5, '')).toBe(' ');
  });

  it('walks the whole ramp monotonically across a gradient', () => {
    const chars = rampById('detail').chars;
    const seen = Array.from({ length: 71 }, (_, i) => rampCharAt(i / 70, chars));
    const indices = seen.map((c) => chars.indexOf(c));
    for (let i = 1; i < indices.length; i++) expect(indices[i]!).toBeGreaterThanOrEqual(indices[i - 1]!);
    expect(indices[0]).toBe(0);
    expect(indices[indices.length - 1]).toBe(chars.length - 1);
  });
});

describe('luminance', () => {
  it('runs 0 for black to 1 for white, with green weighted heaviest', () => {
    expect(luminance(0, 0, 0)).toBe(0);
    expect(luminance(255, 255, 255)).toBeCloseTo(1, 6);
    expect(luminance(0, 255, 0)).toBeGreaterThan(luminance(255, 0, 0));
    expect(luminance(255, 0, 0)).toBeGreaterThan(luminance(0, 0, 255));
  });
});

describe('hex conversion', () => {
  it('round-trips, accepts the short form, and treats rubbish as white', () => {
    expect(rgbToHex(255, 128, 0)).toBe('#ff8000');
    expect(hexToRgb('#ff8000')).toEqual([255, 128, 0]);
    expect(hexToRgb('#f80')).toEqual([255, 136, 0]);
    expect(hexToRgb('rgb(1,2,3)')).toEqual([255, 255, 255]);
    expect(rgbToHex(-20, 300, 12.6)).toBe('#00ff0d');
  });
});

describe('cell aspect compensation', () => {
  it('halves the row count for cells twice as tall as they are wide', () => {
    expect(rowsFor(100, 100, 80, 0.5)).toBe(40);
    expect(rowsFor(100, 100, 80, 1)).toBe(80);
    expect(rowsFor(200, 100, 80, DEFAULT_CELL_ASPECT)).toBe(20);
  });

  it('never returns zero rows, however wide the picture', () => {
    expect(rowsFor(1000, 1, 10, 0.5)).toBe(1);
    expect(rowsFor(0, 0, 80, 0.5)).toBe(1);
  });
});

describe('asciiFromPixels', () => {
  it('emits a rectangle of the requested width and the compensated height', () => {
    const art = asciiFromPixels(solid(64, 64, [128, 128, 128, 255]), { columns: 32 });
    expect(art.columns).toBe(32);
    expect(art.rows).toBe(16);
    expect(art.lines).toHaveLength(16);
    for (const line of art.lines) expect(line).toHaveLength(32);
    expect(asciiText(art).split('\n')).toHaveLength(16);
  });

  it('clamps the width to something that is still a picture and still pasteable', () => {
    expect(asciiFromPixels(solid(8, 8, [0, 0, 0, 255]), { columns: 1 }).columns).toBe(MIN_COLUMNS);
    expect(asciiFromPixels(solid(8, 8, [0, 0, 0, 255]), { columns: 10_000 }).columns).toBe(MAX_COLUMNS);
  });

  it('darkens left to right across a horizontal gradient, and reverses when inverted', () => {
    const gradient = pixels(256, 32, (x) => [255 - x, 255 - x, 255 - x, 255]);
    const chars = rampById('simple').chars;

    const art = asciiFromPixels(gradient, { columns: 32, ramp: 'simple' });
    const first = art.lines[0]!;
    expect(first[0]).toBe(' ');
    expect(first[first.length - 1]).toBe('@');
    const ink = [...first].map((c) => chars.indexOf(c));
    for (let i = 1; i < ink.length; i++) expect(ink[i]!).toBeGreaterThanOrEqual(ink[i - 1]!);

    const inverted = asciiFromPixels(gradient, { columns: 32, ramp: 'simple', invert: true });
    expect(inverted.lines[0]![0]).toBe('@');
    expect(inverted.lines[0]![31]).toBe(' ');
  });

  it('averages each cell rather than sampling it', () => {
    // A 1-pixel checkerboard averaged into one cell is mid-grey; a sampler
    // would report whichever pixel it happened to land on (pure black or
    // pure white) and the whole picture would shimmer with the output width.
    const checker = pixels(64, 64, (x, y) => {
      const on = (x + y) % 2 === 0;
      const v = on ? 255 : 0;
      return [v, v, v, 255];
    });
    const art = asciiFromPixels(checker, { columns: 8, ramp: 'simple', colour: true });
    const chars = rampById('simple').chars;
    for (const line of art.lines) {
      for (const c of line) expect(chars.indexOf(c)).toBeGreaterThan(2);
      for (const c of line) expect(chars.indexOf(c)).toBeLessThan(7);
    }
    expect(art.colours![0]![0]).toBe('#808080');
  });

  it('composites transparency onto the chosen background instead of reading it as black', () => {
    const clear = solid(32, 32, [0, 0, 0, 0]);
    const onWhite = asciiFromPixels(clear, { columns: 16, background: '#ffffff' });
    expect(onWhite.lines.every((l) => l.trim() === '')).toBe(true);

    const onBlack = asciiFromPixels(clear, { columns: 16, background: '#000000' });
    expect(onBlack.lines.every((l) => /^@+$/.test(l))).toBe(true);

    // Half-transparent red over white averages to pink, not to red.
    const half = solid(32, 32, [255, 0, 0, 128]);
    const art = asciiFromPixels(half, { columns: 16, background: '#ffffff', colour: true });
    expect(art.colours![0]![0]).toBe('#ff7f7f');
  });

  it('returns per-cell colours only when they are asked for', () => {
    const red = solid(16, 16, [255, 0, 0, 255]);
    expect(asciiFromPixels(red, { columns: 8 }).colours).toBeNull();
    const coloured = asciiFromPixels(red, { columns: 8, colour: true });
    expect(coloured.colours).toHaveLength(coloured.rows);
    expect(coloured.colours![0]).toHaveLength(8);
    expect(new Set(coloured.colours!.flat())).toEqual(new Set(['#ff0000']));
  });

  it('survives an empty image', () => {
    const art = asciiFromPixels({ data: new Uint8ClampedArray(), width: 0, height: 0 }, { columns: 32 });
    expect(art.lines).toEqual([]);
    expect(art.rows).toBe(0);
  });

  it('handles an output larger than the source without dropping cells', () => {
    const tiny = pixels(2, 2, (x) => [x === 0 ? 0 : 255, x === 0 ? 0 : 255, x === 0 ? 0 : 255, 255]);
    const art = asciiFromPixels(tiny, { columns: 16, ramp: 'simple' });
    for (const line of art.lines) expect(line).toHaveLength(16);
    expect(art.lines[0]![0]).toBe('@');
    expect(art.lines[0]![15]).toBe(' ');
  });
});
