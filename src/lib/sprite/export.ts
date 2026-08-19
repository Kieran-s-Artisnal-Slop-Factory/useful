/**
 * Turning a sprite into something you can save, share or hand back to the
 * renderer: plain text, and JSON carrying the grid and its legend together.
 *
 * Ported from retoken, minus its DOM helpers: downloading, copying and PNG
 * rasterization go through this app's own pipeline
 * (src/lib/exportFile.ts and src/lib/img/convert.ts) so there is one download
 * path, one clipboard path and one encoder in the codebase.
 */
import { isSafeColor, resizeSprite, resolveColor, type ColorMap, type Sprite } from './types';

/** Escape a string for an XML attribute value. */
function xmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ── Text ─────────────────────────────────────────────────────────────── */

/** The grid as newline-joined rows — the rawest form. */
export function toText(sprite: Sprite): string {
  return sprite.rows.join('\n');
}

/**
 * Parse newline-separated rows back into a grid. The size is the row count;
 * rows are padded/truncated to a square so the result is never ragged.
 */
export function parseText(text: string, fill = '.'): Sprite {
  const rows = text.replace(/\r\n?/g, '\n').split('\n');
  // Drop a single trailing blank line (a file's terminal newline).
  if (rows.length > 1 && rows[rows.length - 1] === '') rows.pop();
  const size = Math.max(rows.length, ...rows.map((r) => r.length), 1);
  return {
    size,
    rows: Array.from({ length: size }, (_, i) => (rows[i] ?? '').slice(0, size).padEnd(size, fill)),
  };
}

/* ── JSON ─────────────────────────────────────────────────────────────── */

/** What this app writes. */
export const SPRITE_FORMAT = 'useful-sprite';
/** What retoken writes — read too, so files move between the two projects. */
export const RETOKEN_FORMAT = 'retoken-sprite';

export interface SpriteDocument {
  format: string;
  version: 1;
  size: number;
  rows: string[];
  colors: ColorMap;
}

/** The grid + its legend as a shareable document — pairs with parseJson. */
export function toJson(sprite: Sprite, colors: ColorMap): string {
  const doc: SpriteDocument = {
    format: SPRITE_FORMAT,
    version: 1,
    size: sprite.size,
    rows: sprite.rows,
    colors,
  };
  return JSON.stringify(doc, null, 2);
}

/**
 * Parse a sprite document (throws with a user-facing message).
 *
 * Everything about the input is treated as hostile: the legend is filtered to
 * single-character keys mapping to colours `isSafeColor` accepts, and the grid
 * is normalized to a true square. A ragged or negative-sized grid would
 * otherwise reach the renderer and the SVG export directly.
 */
export function parseJson(text: string): { sprite: Sprite; colors: ColorMap } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Not valid JSON.');
  }
  const r = raw as Partial<SpriteDocument>;
  if (r?.format !== SPRITE_FORMAT && r?.format !== RETOKEN_FORMAT) {
    throw new Error(`Not a sprite file (expected "format": "${SPRITE_FORMAT}").`);
  }
  if (!Array.isArray(r.rows) || r.rows.some((row) => typeof row !== 'string')) {
    throw new Error('Sprite "rows" must be an array of strings.');
  }
  const colors: ColorMap = {};
  for (const [key, value] of Object.entries(r.colors ?? {})) {
    if (key.length === 1 && typeof value === 'string' && isSafeColor(value)) colors[key] = value;
  }
  const declared = typeof r.size === 'number' && r.size > 0 ? Math.floor(r.size) : 0;
  const rows = r.rows as string[];
  const size = Math.max(1, declared || rows.length, ...rows.map((row) => row.length));
  return { sprite: resizeSprite({ size, rows }, size), colors };
}

/* ── SVG ──────────────────────────────────────────────────────────────── */

/**
 * A standalone SVG string: one `<rect>` per painted pixel, `crispEdges`, on a
 * `size × size` viewBox. `outPx` sets the intrinsic width/height (so it opens
 * at a sensible size and rasterizes crisply); the art itself stays vector.
 */
export function toSvgString(sprite: Sprite, colors: ColorMap, outPx = 512): string {
  const rects: string[] = [];
  for (let y = 0; y < sprite.rows.length; y++) {
    const row = sprite.rows[y] ?? '';
    for (let x = 0; x < row.length; x++) {
      const color = resolveColor(row[x]!, colors);
      // Escape defensively: a ColorMap handed to this function directly may
      // carry values the editor never validated.
      if (color) rects.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${xmlAttr(color)}"/>`);
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${sprite.size} ${sprite.size}" ` +
    `width="${outPx}" height="${outPx}" shape-rendering="crispEdges">` +
    rects.join('') +
    `</svg>`
  );
}

/* ── Normalizing a stored row ─────────────────────────────────────────── */

/**
 * Coerce whatever came out of the database into a usable sprite.
 *
 * The generic data-integrity suite writes an ARRAY into every `json` column,
 * so `colors` can arrive as `['a', 'b', 'ünï 😀', 3]` rather than a legend —
 * and a backup can be hand-edited. Anything unusable becomes an empty legend
 * and a blank grid rather than an exception on load.
 */
export function normalizeSprite(
  size: unknown,
  rows: unknown,
  colors: unknown
): { sprite: Sprite; colors: ColorMap } {
  const rowList = Array.isArray(rows) ? rows.filter((r): r is string => typeof r === 'string') : [];
  const declared = typeof size === 'number' && Number.isFinite(size) && size > 0 ? Math.floor(size) : 0;
  const edge = Math.max(1, declared || rowList.length || 1, ...rowList.map((r) => r.length));
  const legend: ColorMap = {};
  if (colors && typeof colors === 'object' && !Array.isArray(colors)) {
    for (const [key, value] of Object.entries(colors as Record<string, unknown>)) {
      if (key.length === 1 && typeof value === 'string' && isSafeColor(value)) legend[key] = value;
    }
  }
  return { sprite: resizeSprite({ size: edge, rows: rowList }, edge), colors: legend };
}
