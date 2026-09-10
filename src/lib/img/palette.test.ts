import { describe, expect, it } from 'vitest';
import { rgbToOklab } from '../gen/color';
import { buildTheme, THEME_ROLES } from '../gen/theme';
import {
  MAX_COLORS,
  MAX_SAMPLE_SIDE,
  MIN_ALPHA,
  MIN_COLORS,
  PALETTE_SEED,
  clampCount,
  kmeans,
  pixelsToLab,
  sampleSize,
  suggestRoles,
  toPalette,
  toThemeInput,
  type Cluster,
  type Lab,
  type PaletteEntry,
} from './palette';

/* ------------------------------------------------------------- helpers --- */

/** '#rrggbb' → the OKLab point the module would derive from those pixels. */
const lab = (hex: string): Lab => {
  const n = parseInt(hex.slice(1), 16);
  return rgbToOklab([((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]) as Lab;
};

/** `n` identical points of one colour — a blob with no spread at all. */
const flat = (hex: string, n: number): Lab[] => Array.from({ length: n }, () => lab(hex));

/**
 * `n` points scattered symmetrically about a colour, so the blob's MEAN is
 * exactly `lab(hex)` and a correct centroid can be asserted against it.
 */
const blob = (hex: string, n: number, spread = 0.002): Lab[] => {
  const base = lab(hex);
  return Array.from({ length: n }, (_, j) => {
    const d = (j - (n - 1) / 2) * spread;
    return [base[0] + d, base[1] + d, base[2] - d] as Lab;
  });
};

/** RGBA bytes for a run of fully opaque pixels. */
const opaque = (...hexes: string[]): number[] =>
  hexes.flatMap((hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
  });

const clusters = (...pairs: [string, number][]): Cluster[] =>
  pairs.map(([hex, count]) => ({ lab: lab(hex), count }));

const palette = (...pairs: [string, number][]): PaletteEntry[] => toPalette(clusters(...pairs));

const total = (list: Cluster[]): number => list.reduce((sum, c) => sum + c.count, 0);

/* ----------------------------------------------------------- constants --- */

describe('module constants', () => {
  it('caps the sample and fixes the seed, so a palette is a fact about the image', () => {
    expect(MAX_SAMPLE_SIDE).toBe(192);
    expect(MIN_ALPHA).toBe(0.5);
    expect(MIN_COLORS).toBe(2);
    expect(MAX_COLORS).toBe(16);
    expect(PALETTE_SEED).toBe(0x9e3779b9);
  });
});

/* ---------------------------------------------------------- sampleSize --- */

describe('sampleSize', () => {
  it('leaves an image at or under the cap untouched, and shrinks one pixel over it', () => {
    expect(sampleSize(100, 50)).toEqual({ width: 100, height: 50 });
    expect(sampleSize(16, 191)).toEqual({ width: 16, height: 191 });
    expect(sampleSize(192, 192)).toEqual({ width: 192, height: 192 });
    expect(sampleSize(192, 40)).toEqual({ width: 192, height: 40 });
    expect(sampleSize(193, 193)).toEqual({ width: 192, height: 192 });
  });

  it('scales a landscape image so the long edge is exactly the cap', () => {
    expect(sampleSize(1000, 500)).toEqual({ width: 192, height: 96 });
    expect(sampleSize(1600, 900)).toEqual({ width: 192, height: 108 });
  });

  it('scales a portrait image so the long edge is exactly the cap', () => {
    expect(sampleSize(500, 1000)).toEqual({ width: 96, height: 192 });
    expect(sampleSize(900, 1600)).toEqual({ width: 108, height: 192 });
  });

  it('preserves the aspect ratio to within a rounded pixel', () => {
    for (const [w, h] of [
      [1000, 333],
      [4032, 3024],
      [777, 5000],
      [2560, 1440],
      [193, 12],
    ] as [number, number][]) {
      const s = sampleSize(w, h);
      const scale = MAX_SAMPLE_SIDE / Math.max(w, h);
      expect(Math.max(s.width, s.height), `${w}x${h}`).toBe(MAX_SAMPLE_SIDE);
      expect(Math.abs(s.width - w * scale), `${w}x${h}`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(s.height - h * scale), `${w}x${h}`).toBeLessThanOrEqual(0.5);
    }
  });

  it('keeps a 1x1 image at 1x1', () => {
    expect(sampleSize(1, 1)).toEqual({ width: 1, height: 1 });
  });

  it('never returns a zero dimension, however extreme the aspect ratio', () => {
    for (const [w, h] of [
      [4000, 3],
      [3, 4000],
      [10000, 1],
      [1, 10000],
    ] as [number, number][]) {
      const s = sampleSize(w, h);
      expect(s.width, `${w}x${h}`).toBeGreaterThanOrEqual(1);
      expect(s.height, `${w}x${h}`).toBeGreaterThanOrEqual(1);
    }
    expect(sampleSize(4000, 3)).toEqual({ width: 192, height: 1 });
  });

  it('rounds fractional dimensions and floors zero or negative ones at a pixel', () => {
    expect(sampleSize(100.4, 50.6)).toEqual({ width: 100, height: 51 });
    expect(sampleSize(0, 0)).toEqual({ width: 1, height: 1 });
    expect(sampleSize(-5, 10)).toEqual({ width: 1, height: 10 });
  });

  it('honours a custom cap', () => {
    expect(sampleSize(1000, 500, 100)).toEqual({ width: 100, height: 50 });
    expect(sampleSize(80, 40, 100)).toEqual({ width: 80, height: 40 });
  });
});

/* --------------------------------------------------------- pixelsToLab --- */

describe('pixelsToLab', () => {
  it('emits one OKLab point per four RGBA bytes, matching rgbToOklab exactly', () => {
    expect(pixelsToLab(opaque('#ff0000', '#00ff00', '#0000ff'))).toHaveLength(3);
    expect(pixelsToLab(opaque('#2f6fdb'))).toEqual([lab('#2f6fdb')]);
  });

  it('places pure white at OKLab lightness 1', () => {
    const [white] = pixelsToLab([255, 255, 255, 255]);
    expect(white![0]).toBeCloseTo(1, 6);
    expect(white![1]).toBeCloseTo(0, 6);
    expect(white![2]).toBeCloseTo(0, 6);
  });

  it('places pure black at OKLab lightness 0', () => {
    const [black] = pixelsToLab([0, 0, 0, 255]);
    expect(black![0]).toBeCloseTo(0, 6);
    expect(black).toEqual([0, 0, 0]);
  });

  it('gives a mid grey near-zero chroma with its lightness in between', () => {
    const [grey] = pixelsToLab(opaque('#808080'));
    expect(grey![0]).toBeCloseTo(0.5999, 4);
    expect(Math.hypot(grey![1]!, grey![2]!)).toBeCloseTo(0, 6);
  });

  it('skips pixels below the alpha threshold but keeps one sitting on it', () => {
    // 127/255 = 0.498 is absence, not colour; 128/255 = 0.502 is a colour.
    expect(pixelsToLab([255, 0, 0, 127, 0, 0, 255, 255])).toEqual([lab('#0000ff')]);
    expect(pixelsToLab([255, 0, 0, 128])).toEqual([lab('#ff0000')]);
  });

  it('returns an empty array for an all-transparent buffer', () => {
    expect(pixelsToLab([1, 2, 3, 0, 4, 5, 6, 0, 7, 8, 9, 10])).toEqual([]);
  });

  it('returns an empty array for an empty buffer', () => {
    expect(pixelsToLab([])).toEqual([]);
  });

  it('does not read past the end of a buffer whose length is not a multiple of four', () => {
    expect(pixelsToLab([255, 255, 255, 255, 9, 9])).toEqual([lab('#ffffff')]);
    expect(pixelsToLab([1, 2, 3])).toEqual([]);
    expect(pixelsToLab([0, 0, 0, 255, 1, 2, 3])).toHaveLength(1);
  });

  it('honours a custom alpha threshold, so 0 keeps every pixel', () => {
    expect(pixelsToLab([255, 0, 0, 0, 0, 0, 255, 0], 0)).toHaveLength(2);
    expect(pixelsToLab(opaque('#ff0000', '#0000ff'), 1.1)).toEqual([]);
  });

  it('accepts a typed array, which is what getImageData actually hands over', () => {
    expect(pixelsToLab(Uint8ClampedArray.from(opaque('#ff0000')))).toEqual([lab('#ff0000')]);
  });
});

/* -------------------------------------------------------------- kmeans --- */

describe('kmeans', () => {
  const threeBlobs = [...flat('#ff0000', 5), ...flat('#00ff00', 3), ...flat('#0000ff', 2)];
  const jittered = [...blob('#e02020', 9), ...blob('#20a020', 6), ...blob('#2040d0', 4)];

  it('returns nothing for an empty point array', () => {
    expect(kmeans([], 4)).toEqual([]);
  });

  it('returns nothing for k below 1, since zero colours is not a palette', () => {
    expect(kmeans(threeBlobs, 0)).toEqual([]);
    expect(kmeans(threeBlobs, -3)).toEqual([]);
  });

  it('k = 1 returns one cluster of every point, centred on their mean', () => {
    const result = kmeans(threeBlobs, 1);
    expect(result).toHaveLength(1);
    expect(result[0]!.count).toBe(threeBlobs.length);

    const [only] = kmeans(blob('#2f6fdb', 7), 1);
    expect(only!.lab[0]).toBeCloseTo(lab('#2f6fdb')[0], 6);
    expect(only!.lab[1]).toBeCloseTo(lab('#2f6fdb')[1], 6);
    expect(only!.lab[2]).toBeCloseTo(lab('#2f6fdb')[2], 6);
  });

  it('splits three well-separated colours into exactly three clusters of the blob sizes', () => {
    const result = kmeans(threeBlobs, 3);
    expect(result).toHaveLength(3);
    expect(result.map((c) => c.count)).toEqual([5, 3, 2]);
  });

  it('puts each centroid on its blob centre', () => {
    const found = kmeans(jittered, 3);
    const expected = [lab('#e02020'), lab('#20a020'), lab('#2040d0')];
    expect(found.map((c) => c.count)).toEqual([9, 6, 4]);
    found.forEach((cluster, i) => {
      expect(cluster.lab[0]).toBeCloseTo(expected[i]![0], 6);
      expect(cluster.lab[1]).toBeCloseTo(expected[i]![1], 6);
      expect(cluster.lab[2]).toBeCloseTo(expected[i]![2], 6);
    });
  });

  it('sorts clusters by count, descending', () => {
    const counts = kmeans(
      [...flat('#0000ff', 2), ...flat('#ff0000', 11), ...flat('#00ff00', 7)],
      3
    ).map((c) => c.count);
    expect(counts).toEqual([11, 7, 2]);
    for (let i = 1; i < counts.length; i += 1) {
      expect(counts[i]!).toBeLessThanOrEqual(counts[i - 1]!);
    }
  });

  it('the same seed gives an identical result across two calls', () => {
    expect(kmeans(jittered, 4, 12345)).toEqual(kmeans(jittered, 4, 12345));
    expect(kmeans(jittered, 6)).toEqual(kmeans(jittered, 6));
  });

  it('a different seed still assigns every point to exactly one cluster', () => {
    for (const seed of [1, 7, 99, 0x1234abcd]) {
      const result = kmeans(jittered, 4, seed);
      expect(total(result), `seed ${seed}`).toBe(jittered.length);
    }
  });

  it('cluster counts always sum to points.length, whatever k', () => {
    for (const k of [1, 2, 3, 4, 5, 8, 16, 30]) {
      expect(total(kmeans(jittered, k)), `k=${k}`).toBe(jittered.length);
      expect(total(kmeans(threeBlobs, k)), `k=${k}`).toBe(threeBlobs.length);
    }
  });

  it('drops empty clusters rather than reporting six more blacks', () => {
    for (const k of [4, 8, 16]) {
      const result = kmeans(threeBlobs, k);
      for (const cluster of result) expect(cluster.count, `k=${k}`).toBeGreaterThan(0);
      // Only three distinct colours exist, so there is nothing else to find.
      expect(result.length, `k=${k}`).toBeLessThanOrEqual(3);
    }
  });

  it('returns at most as many clusters as there are distinct colours', () => {
    expect(kmeans(flat('#2f6fdb', 40), 9)).toHaveLength(1);
    expect(kmeans([...flat('#000000', 4), ...flat('#ffffff', 4)], 16)).toHaveLength(2);
  });

  it('a single repeated colour gives one cluster of every point, whatever k', () => {
    for (const k of [1, 2, 5, 16]) {
      const result = kmeans(flat('#1faa59', 12), k);
      expect(result, `k=${k}`).toHaveLength(1);
      expect(result[0]!.count, `k=${k}`).toBe(12);
      expect(result[0]!.lab[0]).toBeCloseTo(lab('#1faa59')[0], 6);
    }
  });

  it('never returns more clusters than k, and caps k at the number of points', () => {
    for (const k of [1, 2, 3, 5]) {
      expect(kmeans(jittered, k).length, `k=${k}`).toBeLessThanOrEqual(k);
    }
    const two = [...flat('#ff0000', 1), ...flat('#0000ff', 1)];
    expect(kmeans(two, 10)).toHaveLength(2);
    expect(total(kmeans(two, 10))).toBe(2);
  });

  it('leaves the caller’s points untouched and never aliases one as a centroid', () => {
    const points = jittered.map((p) => [...p] as Lab);
    const copy = points.map((p) => [...p] as Lab);
    kmeans(points, 3);
    expect(points).toEqual(copy);

    const flatPoints = flat('#ff0000', 3);
    const [cluster] = kmeans(flatPoints, 1);
    expect(flatPoints.some((p) => p === cluster!.lab)).toBe(false);
  });

  it('still partitions every point when stopped after one iteration', () => {
    const result = kmeans(jittered, 3, PALETTE_SEED, 1);
    expect(total(result)).toBe(jittered.length);
    for (const cluster of result) expect(cluster.count).toBeGreaterThan(0);
  });

  it('converges, so extra iterations change nothing', () => {
    expect(kmeans(threeBlobs, 3, PALETTE_SEED, 4)).toEqual(
      kmeans(threeBlobs, 3, PALETTE_SEED, 200)
    );
  });
});

/* ----------------------------------------------------------- toPalette --- */

describe('toPalette', () => {
  it('returns nothing for an empty cluster list', () => {
    expect(toPalette([])).toEqual([]);
  });

  it('returns nothing when every cluster is empty, rather than dividing by zero', () => {
    expect(toPalette(clusters(['#ff0000', 0], ['#00ff00', 0]))).toEqual([]);
  });

  it('shares sum to 1, including for counts that do not divide evenly', () => {
    expect(
      palette(['#ff0000', 5], ['#00ff00', 3], ['#0000ff', 2]).reduce((s, e) => s + e.share, 0)
    ).toBeCloseTo(1, 6);
    const thirds = palette(['#ff0000', 7], ['#00ff00', 7], ['#0000ff', 7]);
    expect(thirds.reduce((s, e) => s + e.share, 0)).toBeCloseTo(1, 6);
    for (const entry of thirds) expect(entry.share).toBeCloseTo(1 / 3, 6);
  });

  it('shares are proportional to the cluster counts', () => {
    const entries = palette(['#ff0000', 50], ['#00ff00', 30], ['#0000ff', 20]);
    expect(entries.map((e) => e.share)).toEqual([0.5, 0.3, 0.2]);
  });

  it('emits one entry per cluster, in the order given', () => {
    expect(palette(['#ff0000', 5], ['#00ff00', 3]).map((e) => e.hex)).toEqual([
      '#ff0000',
      '#00ff00',
    ]);
  });

  it('hex is a valid six-digit string that round-trips the centroid', () => {
    for (const entry of palette(['#ff0000', 3], ['#808080', 2], ['#000000', 1])) {
      expect(entry.hex).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(palette(['#2f6fdb', 1])[0]!.hex).toBe('#2f6fdb');
    expect(palette(['#e04a2f', 1])[0]!.hex).toBe('#e04a2f');
    expect(palette(['#ffffff', 1])[0]!.hex).toBe('#ffffff');
    expect(palette(['#000000', 1])[0]!.hex).toBe('#000000');
  });

  it('fills every CSS spelling the UI offers to copy', () => {
    const [red] = palette(['#ff0000', 1]);
    expect(red!.rgb).toBe('rgb(255 0 0)');
    expect(red!.hsl).toBe('hsl(0 100% 50%)');
    expect(red!.oklch).toBe('oklch(0.628 0.2577 29.23)');
  });

  it('picks the readable on-colour: white on a dark swatch, near-black on a light one', () => {
    expect(palette(['#000000', 1])[0]!.onColor).toBe('#ffffff');
    expect(palette(['#1e3a5f', 1])[0]!.onColor).toBe('#ffffff');
    expect(palette(['#ffffff', 1])[0]!.onColor).toBe('#111111');
    expect(palette(['#ffd700', 1])[0]!.onColor).toBe('#111111');
  });

  it('every on-colour is one of the two readable extremes', () => {
    for (const entry of palette(['#ff0000', 4], ['#808080', 3], ['#0000ff', 2], ['#eeeeee', 1])) {
      expect(['#ffffff', '#111111'], entry.hex).toContain(entry.onColor);
    }
  });

  it('carries the centroid lightness and chroma through for role assignment', () => {
    const entries = palette(['#ffffff', 2], ['#000000', 1]);
    expect(entries[0]!.lightness).toBeCloseTo(1, 6);
    expect(entries[1]!.lightness).toBeCloseTo(0, 6);

    const [red] = palette(['#ff0000', 1]);
    const source = lab('#ff0000');
    expect(red!.chroma).toBeCloseTo(Math.hypot(source[1], source[2]), 12);
    expect(red!.chroma).toBeCloseTo(0.2577, 4);
  });

  it('a grey centroid reports near-zero chroma, which is what marks it a neutral', () => {
    for (const hex of ['#808080', '#eeeeee', '#111111']) {
      expect(palette([hex, 1])[0]!.chroma, hex).toBeCloseTo(0, 6);
    }
  });

  it('reports the numbers of the colour it DELIVERS, not of an out-of-gamut centroid', () => {
    // lab [0.7, 0.4, 0.15] is far outside sRGB and clips hard to red. The
    // entry used to keep the centroid's lightness and chroma, which made it
    // contradict its own oklch string and made suggestRoles rank by
    // saturation the user never receives.
    const [wild] = toPalette([{ lab: [0.7, 0.4, 0.15], count: 1 }]);
    expect(wild!.hex).toBe('#ff0000');

    const delivered = rgbToOklab([1, 0, 0]);
    expect(wild!.lightness).toBeCloseTo(delivered[0], 12);
    expect(wild!.chroma).toBeCloseTo(Math.hypot(delivered[1], delivered[2]), 12);

    // The reported chroma must agree with the oklch string on the same entry.
    const fromString = Number(/oklch\(\s*[\d.]+\s+([\d.]+)/.exec(wild!.oklch)![1]);
    expect(wild!.chroma).toBeCloseTo(fromString, 3);
  });
});

/* ---------------------------------------------------------- clampCount --- */

describe('clampCount', () => {
  it('passes an in-range integer through untouched', () => {
    expect(clampCount(2)).toBe(2);
    expect(clampCount(6)).toBe(6);
    expect(clampCount(16)).toBe(16);
  });

  it('clamps to the 2..16 bounds the UI input offers', () => {
    expect(clampCount(1)).toBe(MIN_COLORS);
    expect(clampCount(0)).toBe(MIN_COLORS);
    expect(clampCount(-5)).toBe(MIN_COLORS);
    expect(clampCount(17)).toBe(MAX_COLORS);
    expect(clampCount(1000)).toBe(MAX_COLORS);
  });

  it('rounds a fraction to the nearest whole colour', () => {
    expect(clampCount(2.4)).toBe(2);
    expect(clampCount(2.6)).toBe(3);
    expect(clampCount(6.5)).toBe(7);
  });

  it('falls back to six for NaN or an infinity, rather than passing it on as k', () => {
    expect(clampCount(NaN)).toBe(6);
    expect(clampCount(Infinity)).toBe(6);
    expect(clampCount(-Infinity)).toBe(6);
  });
});

/* -------------------------------------------------------- suggestRoles --- */

describe('suggestRoles', () => {
  const photo = palette(['#808080', 50], ['#2f6fdb', 30], ['#e04a2f', 12], ['#1faa59', 8]);

  it('returns five slots in THEME_ROLES order, all null for an empty palette', () => {
    expect(THEME_ROLES).toEqual(['primary', 'secondary', 'accent', 'neutral', 'base']);
    expect(suggestRoles(photo)).toHaveLength(THEME_ROLES.length);
    expect(suggestRoles([])).toEqual([null, null, null, null, null]);
  });

  it('gives base the near-grey and primary the most common real colour', () => {
    const [primary, , , , base] = suggestRoles(photo);
    expect(base).toBe('#808080');
    expect(primary).toBe('#2f6fdb');
  });

  it('gives accent the most chromatic colour left, because highlights should shout', () => {
    // #e04a2f has the highest chroma of the free chromatics, though it is only
    // third by share.
    expect(suggestRoles(photo)[2]).toBe('#e04a2f');
  });

  it('gives secondary the next most common chromatic colour', () => {
    expect(suggestRoles(photo)[1]).toBe('#1faa59');
  });

  it('leaves neutral null when the only grey already went to base', () => {
    expect(suggestRoles(photo)[3]).toBeNull();
  });

  it('gives neutral the grey closest to mid-lightness once base is taken', () => {
    const roles = suggestRoles(
      palette(['#808080', 50], ['#3a3a3a', 5], ['#2f6fdb', 30], ['#e04a2f', 12])
    );
    expect(roles[4]).toBe('#808080');
    expect(roles[3]).toBe('#3a3a3a');
  });

  it('never assigns one hex to two roles', () => {
    const assigned = suggestRoles(photo).filter((hex): hex is string => hex !== null);
    expect(new Set(assigned).size).toBe(assigned.length);
  });

  it('never assigns one hex to two roles, over every three-colour palette of a fixed set', () => {
    const hexes = [
      '#ff0000', '#00ff00', '#0000ff', '#808080', '#111111', '#eeeeee',
      '#2f6fdb', '#e04a2f', '#1faa59', '#7a7a7a', '#c0c0c0', '#ffd700',
    ];
    for (const a of hexes) {
      for (const b of hexes) {
        for (const c of hexes) {
          const roles = suggestRoles(palette([a, 9], [b, 5], [c, 2]));
          expect(roles, `${a}/${b}/${c}`).toHaveLength(5);
          const assigned = roles.filter((hex): hex is string => hex !== null);
          expect(new Set(assigned).size, `${a}/${b}/${c}`).toBe(assigned.length);
        }
      }
    }
  });

  it('only ever returns hexes that are actually in the palette', () => {
    const hexes = new Set(photo.map((e) => e.hex));
    for (const role of suggestRoles(photo)) {
      if (role !== null) expect(hexes).toContain(role);
    }
  });

  it('a single-colour palette fills one slot, leaves the rest null and does not crash', () => {
    const chromatic = suggestRoles(palette(['#2f6fdb', 9]));
    expect(chromatic).toHaveLength(5);
    expect(chromatic.filter((hex): hex is string => hex !== null)).toEqual(['#2f6fdb']);
    // buildTheme derives every blank slot, so one colour is still a whole theme.
    expect(chromatic[0] === '#2f6fdb' || chromatic[4] === '#2f6fdb').toBe(true);

    expect(suggestRoles(palette(['#808080', 3])).filter((hex) => hex !== null)).toEqual([
      '#808080',
    ]);
  });

  it('an all-grey palette still produces a usable base and does not throw', () => {
    const roles = suggestRoles(palette(['#f2f2f2', 60], ['#1a1a1a', 20], ['#7a7a7a', 10]));
    expect(roles).toHaveLength(5);
    expect(roles[4]).toBe('#f2f2f2');
    expect(roles[3]).toBe('#7a7a7a');
    expect(roles[0]).toBe('#1a1a1a');
    // Nothing is chromatic, so accent and secondary have nothing to say.
    expect(roles[2]).toBeNull();
    expect(roles[1]).toBeNull();
  });

  it('leaves base to derive when the image has no near-grey at all', () => {
    // A flat three-colour graphic. Handing the most common SATURATED colour
    // to the page background produces a garish theme that arrives with three
    // contrast warnings, so base is left null and buildTheme derives a pale
    // tint of the primary instead. The chromatic roles still fill up.
    const roles = suggestRoles(palette(['#ff0000', 5], ['#00ff00', 3], ['#0000ff', 2]));
    expect(roles[4]).toBeNull();
    expect(roles[3]).toBeNull();
    expect(roles[0]).toBe('#ff0000');
    expect(roles[1]).toBe('#00ff00');
    expect(roles[2]).toBe('#0000ff');
    const assigned = roles.filter((hex): hex is string => hex !== null);
    expect(new Set(assigned).size).toBe(assigned.length);
  });

  it('survives a palette whose entries share one hex', () => {
    const roles = suggestRoles(palette(['#2f6fdb', 5], ['#2f6fdb', 5]));
    expect(roles).toHaveLength(5);
    expect(roles.filter((hex) => hex !== null)).toEqual(['#2f6fdb']);
  });
});

/* -------------------------------------------------------- toThemeInput --- */

describe('toThemeInput', () => {
  it('always produces five role slots with every dark slot null', () => {
    expect(toThemeInput([]).colors).toHaveLength(5);
    expect(toThemeInput(['#ff0000']).colors).toHaveLength(5);
    const { colors } = toThemeInput(['#ff0000', '#00ff00', '#0000ff', '#808080', '#eeeeee']);
    expect(colors).toHaveLength(5);
    for (const role of colors) expect(role.dark).toBeNull();
  });

  it('passes the suggested hexes through as light slots, missing ones as null', () => {
    expect(toThemeInput(['#ff0000', null, '#0000ff', null, '#eeeeee']).colors.map((c) => c.light))
      .toEqual(['#ff0000', null, '#0000ff', null, '#eeeeee']);
    expect(toThemeInput(['#ff0000']).colors.map((c) => c.light)).toEqual([
      '#ff0000', null, null, null, null,
    ]);
  });

  it('ignores anything past the fifth role', () => {
    const { colors } = toThemeInput([
      '#111111', '#222222', '#333333', '#444444', '#555555', '#666666',
    ]);
    expect(colors.map((c) => c.light)).toEqual([
      '#111111', '#222222', '#333333', '#444444', '#555555',
    ]);
  });

  it('defaults padding to 12px and radius to 8px', () => {
    const input = toThemeInput([]);
    expect(input.paddingPx).toBe(12);
    expect(input.radiusPx).toBe(8);
  });

  it('passes padding and radius through untouched', () => {
    const input = toThemeInput(['#ff0000'], 20, 0);
    expect(input.paddingPx).toBe(20);
    expect(input.radiusPx).toBe(0);
  });

  it('composes with buildTheme to produce a complete :root block', () => {
    const roles = suggestRoles(palette(['#808080', 50], ['#2f6fdb', 30], ['#e04a2f', 12]));
    const theme = buildTheme(toThemeInput(roles));
    expect(theme.css).toContain('--primary:');
    expect(theme.css).toContain('--primary: light-dark(#2f6fdb,');
    expect(theme.css).toContain('--padding: 12px;');
    expect(theme.swatches.map((s) => s.role)).toEqual([...THEME_ROLES]);
    expect(theme.swatches[4]!.light).toBe('#808080');
  });

  it('composes with buildTheme even when every role is null', () => {
    const theme = buildTheme(toThemeInput(suggestRoles([])));
    expect(theme.css).toContain('--primary:');
    expect(theme.swatches).toHaveLength(5);
    for (const swatch of theme.swatches) expect(swatch.light).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('composes with buildTheme from a one-colour palette, knobs and all', () => {
    const theme = buildTheme(toThemeInput(suggestRoles(palette(['#2f6fdb', 9])), 16, 4));
    expect(theme.css).toContain('--primary:');
    expect(theme.css).toContain('--padding: 16px;');
    expect(theme.css).toContain('--radius: 4px;');
  });
});
