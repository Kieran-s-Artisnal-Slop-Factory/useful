/**
 * Pictures as text (0.3.0 phase 8).
 *
 * The whole conversion is pure and canvas-free: it takes a flat RGBA buffer —
 * whatever `getImageData()` handed us — and returns rows of characters. That
 * split is deliberate. Decoding an image needs a browser; deciding which
 * character stands for a patch of pixels does not, so the decision is unit
 * tested against synthetic gradients in node rather than eyeballed in a
 * screenshot.
 *
 * Three things this module gets right that a naive `luminance → character`
 * loop gets wrong:
 *
 *  1. **A character cell is not square.** Monospace cells are roughly twice as
 *     tall as they are wide, so an image mapped one row per source row comes
 *     out stretched to double height. Every row count goes through
 *     {@link rowsFor}, which folds the cell ratio in.
 *  2. **A cell is an average, not a sample.** Each cell box-averages its whole
 *     source rectangle. Point-sampling a photo produces noise that reads as
 *     detail and changes with the output width in ways nobody can predict.
 *  3. **Transparency has to land somewhere.** RGBA pixels are composited over
 *     the chosen background before luminance is taken; otherwise a transparent
 *     PNG reads as solid black and the picture arrives as a rectangle of `@`.
 */

/** A flat RGBA buffer, exactly as `CanvasRenderingContext2D.getImageData()` gives it. */
export interface Pixels {
  data: Uint8ClampedArray | number[];
  width: number;
  height: number;
}

/** A character ramp, ordered LIGHTEST first. */
export interface Ramp {
  id: string;
  label: string;
  chars: string;
}

/**
 * Paul Bourke's 70-character ramp, written darkest-first the way he published
 * it and reversed here rather than retyped: the sequence is the whole point of
 * the ramp, and a transcription slip in a 70-character string is invisible.
 */
const BOURKE_DARK_FIRST =
  '$@B%8&WM#*oahkbdpqwmZO0QLCJUYXzcvunxrjft/\\|()1{}[]?-_+~<>i!lI;:,"^`\'. ';

export const RAMPS: Ramp[] = [
  { id: 'simple', label: '10 steps — bold, reads at a glance', chars: ' .:-=+*#%@' },
  {
    id: 'detail',
    label: '70 steps — fine gradient, wants a big output',
    chars: [...BOURKE_DARK_FIRST].reverse().join(''),
  },
];

export const DEFAULT_RAMP = 'simple';

/** Width ÷ height of one monospace character cell. Close enough for every
 * terminal font in common use; exposed as an option because "close enough"
 * stops being true for the wide ones. */
export const DEFAULT_CELL_ASPECT = 0.5;

/** Bounds on the output width. Below 8 there is no picture; above 400 the
 * output stops being text anyone can paste anywhere. */
export const MIN_COLUMNS = 8;
export const MAX_COLUMNS = 400;

/** Relative luminance of an sRGB byte triple, 0 (black) to 1 (white). */
export function luminance(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * The character for an ink level: 0 = no ink (lightest), 1 = full ink.
 *
 * Ramps are stored lightest-first, so this is a straight index — the
 * inversion lives one level up, in {@link asciiFromPixels}, where it belongs.
 */
export function rampCharAt(ink: number, chars: string): string {
  if (chars.length === 0) return ' ';
  const index = clamp(Math.round(clamp(ink, 0, 1) * (chars.length - 1)), 0, chars.length - 1);
  return chars[index]!;
}

/** Look a ramp up by id, falling back to the default rather than throwing —
 * a stale id in a URL or a preference should not blank the page. */
export function rampById(id: string): Ramp {
  return RAMPS.find((r) => r.id === id) ?? RAMPS.find((r) => r.id === DEFAULT_RAMP)!;
}

/**
 * How many character rows an image of this shape needs at this width.
 *
 * `columns * (height / width)` is the row count for SQUARE cells; multiplying
 * by the cell's width/height ratio is what stops the output being twice as
 * tall as the picture. Always at least 1.
 */
export function rowsFor(
  imageWidth: number,
  imageHeight: number,
  columns: number,
  cellAspect = DEFAULT_CELL_ASPECT
): number {
  if (imageWidth <= 0 || imageHeight <= 0) return 1;
  return Math.max(1, Math.round(columns * (imageHeight / imageWidth) * cellAspect));
}

export interface AsciiOptions {
  /** Output width in characters. Clamped to [MIN_COLUMNS, MAX_COLUMNS]. */
  columns: number;
  /** Ramp id from {@link RAMPS}. */
  ramp?: string;
  /** Swap ink for paper — what light text on a dark terminal wants. */
  invert?: boolean;
  cellAspect?: number;
  /** Also return the average colour of each cell. */
  colour?: boolean;
  /** `#rrggbb` that transparent pixels are composited onto. */
  background?: string;
}

export interface AsciiArt {
  columns: number;
  rows: number;
  /** One string per row, every one exactly `columns` characters long. */
  lines: string[];
  /** `#rrggbb` per character, or null when colour was not asked for. */
  colours: string[][] | null;
}

/** `#rgb` / `#rrggbb` → bytes. Anything unreadable reads as white, which is
 * the safest background to composite onto. */
export function hexToRgb(hex: string): [number, number, number] {
  const short = /^#?([\da-f])([\da-f])([\da-f])$/i.exec(hex.trim());
  if (short) {
    return [
      parseInt(short[1]! + short[1]!, 16),
      parseInt(short[2]! + short[2]!, 16),
      parseInt(short[3]! + short[3]!, 16),
    ];
  }
  const long = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex.trim());
  if (!long) return [255, 255, 255];
  return [parseInt(long[1]!, 16), parseInt(long[2]!, 16), parseInt(long[3]!, 16)];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const byte = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

/**
 * The conversion.
 *
 * Each output cell owns a rectangle of source pixels — computed from exact
 * fractions rather than a stepped integer, so no source row is dropped or
 * counted twice when the image does not divide evenly by the output size —
 * and averages it. Empty rectangles (an output bigger than the source) fall
 * back to the nearest single pixel.
 */
export function asciiFromPixels(px: Pixels, options: AsciiOptions): AsciiArt {
  // A cleared number field binds as null/NaN, and NaN survives clamping — it
  // would come back as a picture zero characters wide with no error anywhere.
  const asked = Number.isFinite(options.columns) ? Math.round(options.columns) : MIN_COLUMNS;
  const columns = clamp(asked, MIN_COLUMNS, MAX_COLUMNS);
  const chars = rampById(options.ramp ?? DEFAULT_RAMP).chars;
  const invert = options.invert ?? false;
  const wantColour = options.colour ?? false;
  const [bgR, bgG, bgB] = hexToRgb(options.background ?? '#ffffff');
  const rows = rowsFor(px.width, px.height, columns, options.cellAspect ?? DEFAULT_CELL_ASPECT);

  const lines: string[] = [];
  const colours: string[][] | null = wantColour ? [] : null;
  if (px.width <= 0 || px.height <= 0) {
    return { columns, rows: 0, lines: [], colours: wantColour ? [] : null };
  }

  for (let row = 0; row < rows; row++) {
    const y0 = Math.floor((row * px.height) / rows);
    const y1 = Math.max(y0 + 1, Math.floor(((row + 1) * px.height) / rows));
    let line = '';
    const rowColours: string[] = [];

    for (let col = 0; col < columns; col++) {
      const x0 = Math.floor((col * px.width) / columns);
      const x1 = Math.max(x0 + 1, Math.floor(((col + 1) * px.width) / columns));

      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let y = y0; y < y1 && y < px.height; y++) {
        for (let x = x0; x < x1 && x < px.width; x++) {
          const i = (y * px.width + x) * 4;
          // Composite onto the background BEFORE averaging: averaging the raw
          // channels of transparent pixels and compositing afterwards gives a
          // different (and wrong) answer wherever alpha varies inside a cell.
          const a = (px.data[i + 3] ?? 255) / 255;
          r += (px.data[i] ?? 0) * a + bgR * (1 - a);
          g += (px.data[i + 1] ?? 0) * a + bgG * (1 - a);
          b += (px.data[i + 2] ?? 0) * a + bgB * (1 - a);
          n++;
        }
      }
      if (n === 0) {
        r = bgR;
        g = bgG;
        b = bgB;
        n = 1;
      }
      r /= n;
      g /= n;
      b /= n;

      const lum = luminance(r, g, b);
      line += rampCharAt(invert ? lum : 1 - lum, chars);
      if (rowColours) rowColours.push(rgbToHex(r, g, b));
    }

    lines.push(line);
    colours?.push(rowColours);
  }

  return { columns, rows, lines, colours };
}

/** The art as one plain-text block, trailing blanks kept so the rectangle
 * survives a paste into anything that cares about columns. */
export function asciiText(art: AsciiArt): string {
  return art.lines.join('\n');
}
