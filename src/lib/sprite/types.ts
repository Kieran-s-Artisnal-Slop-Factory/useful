/**
 * Pixel-art sprites as coded character grids — no binary assets, diffs stay
 * reviewable, and a renderer emits one crisp SVG `<rect>` per pixel.
 *
 * Ported and generalized from workoutt's pet-collection sprites. Where that
 * project baked in a fixed alphabet (`1`–`4` = a species' palette, `w/k/g/d`
 * = shared colours), here a sprite carries its OWN legend: any character maps
 * to any CSS colour. The transparent characters are the only reserved ones.
 * That is what turns a fixed sprite format into a general drawing system.
 */

/** A pixel grid: `size` rows, each `size` characters. */
export interface Sprite {
  /** Edge length. `rows` should be exactly `size` strings of `size` chars. */
  size: number;
  rows: string[];
}

/**
 * A legend: which CSS colour each grid character paints. Characters absent
 * from the map (and the reserved transparent ones) render as nothing.
 */
export type ColorMap = Record<string, string>;

/** Characters that always mean "no pixel here", never painted. */
export const TRANSPARENT_CHARS = new Set(['.', ' ', '']);

/**
 * Whether a string is a colour value safe to interpolate into an SVG
 * attribute or an inline style. Deliberately strict: hex, rgb/rgba/hsl/hsla
 * with only numeric/percent/separator characters inside, or a plain colour
 * keyword (letters only). Anything with markup or CSS-structural characters
 * (`< > " ' ; ( ) { } /`, outside the constrained function bodies) is
 * rejected — which is what stops a hostile legend from smuggling a `<script>`
 * into an exported SVG or a `background-image` into a cell's style.
 */
export function isSafeColor(value: string): boolean {
  const v = value.trim();
  if (!v || v.length > 64) return false;
  if (/^#[0-9a-fA-F]{3,8}$/.test(v)) return true;
  if (/^(rgb|rgba|hsl|hsla)\(\s*[0-9a-fA-F.,%\s/-]+\)$/i.test(v)) return true;
  if (/^[a-zA-Z]+$/.test(v)) return true; // keyword: red, transparent, …
  return false;
}

/**
 * The colour a grid character resolves to, or null for transparent. A
 * mapped character wins; the reserved transparent chars and any unmapped
 * character are null.
 */
export function resolveColor(char: string, colors: ColorMap): string | null {
  if (TRANSPARENT_CHARS.has(char)) return null;
  return colors[char] ?? null;
}

/** The `{x, y, color}` of every painted pixel, top-left to bottom-right. */
export function spritePixels(
  sprite: Sprite,
  colors: ColorMap
): { x: number; y: number; color: string }[] {
  const out: { x: number; y: number; color: string }[] = [];
  for (let y = 0; y < sprite.rows.length; y++) {
    const row = sprite.rows[y] ?? '';
    for (let x = 0; x < row.length; x++) {
      const color = resolveColor(row[x]!, colors);
      if (color) out.push({ x, y, color });
    }
  }
  return out;
}

/**
 * Normalize a grid to exactly `size × size`: right-pad short rows with the
 * transparent char, truncate long ones, and add or drop rows to match. Used
 * when the editor resizes a grid so the data never goes ragged.
 */
export function resizeSprite(sprite: Sprite, size: number, fill = '.'): Sprite {
  const rows: string[] = [];
  for (let y = 0; y < size; y++) {
    const row = sprite.rows[y] ?? '';
    rows.push(row.slice(0, size).padEnd(size, fill));
  }
  return { size, rows };
}

/** A blank `size × size` grid of the transparent char. */
export function blankSprite(size: number, fill = '.'): Sprite {
  return { size, rows: Array.from({ length: size }, () => fill.repeat(size)) };
}

/**
 * A named example: a legend plus one or more grids that share it. Pets use
 * the variants for evolution stages (baby → jacked); a one-off sprite has a
 * single variant.
 */
export interface SpriteExample {
  id: string;
  label: string;
  colors: ColorMap;
  variants: { name: string; grid: Sprite }[];
}
