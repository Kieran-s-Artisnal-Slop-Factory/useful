/**
 * ASCII art as a picture — monospace SVG and HTML.
 *
 * Both renderers take the same {@link AsciiArt} the image converter produces
 * and the figlet side borrows (a banner is rows of characters with no
 * colours), so there is one place where "how wide is a character cell"
 * is decided.
 *
 * The cell geometry is the entire trick. `image.ts` chose how many rows to
 * emit on the assumption that a cell is `cellAspect` as wide as it is tall, so
 * the renderer has to lay characters out on exactly that grid or the picture
 * comes back stretched. Character advance is taken as 0.6em — every monospace
 * face in common use is within a percent of that — and the line box is
 * whatever makes the ratio come out right.
 */
import { escapeXml } from '../svg/build';
import { DEFAULT_CELL_ASPECT, type AsciiArt } from './image';

/** The advance width of one character, in ems. DejaVu Sans Mono, Menlo,
 * Consolas and Courier are all 0.60 ± 0.01. */
export const ADVANCE_EM = 0.6;

/** The font stack both renderers ask for, and the one the SVG carries with it.
 * An SVG that leaves this machine renders in whatever the reader has, so the
 * generic `monospace` at the end is the promise that actually holds. */
export const MONO_STACK =
  "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";

export interface RenderOptions {
  /** Font size in px. */
  fontSize?: number;
  /** Must match the aspect the art was generated with, or it distorts. */
  cellAspect?: number;
  /** Page colour, or null for transparent. */
  background?: string | null;
  /** Ink colour for art with no per-character colours. */
  foreground?: string;
}

interface Geometry {
  fontSize: number;
  cellWidth: number;
  cellHeight: number;
  width: number;
  height: number;
}

function geometry(art: AsciiArt, options: RenderOptions): Geometry {
  const fontSize = options.fontSize ?? 12;
  const cellWidth = fontSize * ADVANCE_EM;
  const cellHeight = cellWidth / (options.cellAspect ?? DEFAULT_CELL_ASPECT);
  return {
    fontSize,
    cellWidth,
    cellHeight,
    width: Math.max(1, Math.round(cellWidth * art.columns)),
    height: Math.max(1, Math.round(cellHeight * art.lines.length)),
  };
}

interface Run {
  start: number;
  text: string;
  colour: string;
}

/** Group a row into runs of one colour. A photograph's flat areas turn into
 * one span instead of eighty, which is the difference between an SVG that
 * opens instantly and one that does not. */
export function colourRuns(line: string, colours: string[]): Run[] {
  const runs: Run[] = [];
  for (let i = 0; i < line.length; i++) {
    const colour = colours[i] ?? '#000000';
    const last = runs[runs.length - 1];
    if (last && last.colour === colour) last.text += line[i];
    else runs.push({ start: i, text: line[i]!, colour });
  }
  return runs;
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * A colour, made safe to drop into a CSS declaration.
 *
 * The SVG path escapes for XML and that is enough, but the HTML path writes
 * into a `style=""` attribute, where a semicolon would end the declaration
 * and start another one. Colours here are either `#rrggbb` this module
 * computed or a value from `<input type="color">`, so anything that is not a
 * hex triple or a bare keyword is a bug or an attack; both get 'inherit'.
 */
export function cssColour(colour: string): string {
  const c = (colour ?? '').trim();
  return /^#[\da-f]{3,8}$/i.test(c) || /^[a-z]{3,20}$/i.test(c) ? c : 'inherit';
}

/**
 * A standalone SVG document.
 *
 * Rows without colour are one `<text>` with `textLength`, which pins the row
 * to the grid even if the reader's monospace font advances slightly
 * differently. Coloured rows place each run at an explicit `x`, which pins
 * every run for the same reason and costs a few bytes per colour change.
 */
export function asciiSvg(art: AsciiArt, options: RenderOptions = {}): string {
  const g = geometry(art, options);
  const fg = options.foreground ?? '#000000';
  const bg = options.background ?? null;
  const parts: string[] = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${g.width}" height="${g.height}" ` +
      `viewBox="0 0 ${g.width} ${g.height}" font-family="${escapeXml(MONO_STACK)}" ` +
      `font-size="${round(g.fontSize)}" xml:space="preserve">`
  );
  if (bg) parts.push(`<rect width="${g.width}" height="${g.height}" fill="${escapeXml(bg)}"/>`);

  art.lines.forEach((line, row) => {
    // 0.78 of the line box is where a monospace baseline sits closely enough
    // that ascenders and descenders both stay inside the picture.
    const y = round((row + 0.78) * g.cellHeight);
    const colours = art.colours?.[row];
    if (colours) {
      const runs = colourRuns(line, colours).filter((run) => run.text.trim() !== '');
      if (runs.length === 0) return;
      const spans = runs
        .map(
          (run) =>
            `<tspan x="${round(run.start * g.cellWidth)}" fill="${escapeXml(run.colour)}">` +
            `${escapeXml(run.text)}</tspan>`
        )
        .join('');
      parts.push(`<text y="${y}">${spans}</text>`);
    } else {
      if (line.trim() === '') return;
      parts.push(
        `<text x="0" y="${y}" fill="${escapeXml(fg)}" textLength="${g.width}" ` +
          `lengthAdjust="spacing">${escapeXml(line)}</text>`
      );
    }
  });

  parts.push('</svg>');
  return parts.join('\n');
}

/** The same picture as an HTML `<pre>` — markup to paste into a page, and
 * what the coloured preview on the page itself renders. */
export function asciiHtml(art: AsciiArt, options: RenderOptions = {}): string {
  const g = geometry(art, options);
  const fg = cssColour(options.foreground ?? '#000000');
  const bg = options.background === null ? 'transparent' : cssColour(options.background ?? 'transparent');
  const style =
    `font-family: ${MONO_STACK}; font-size: ${round(g.fontSize)}px; ` +
    `line-height: ${round(g.cellHeight)}px; background: ${bg}; color: ${fg}; ` +
    'white-space: pre; overflow-x: auto;';

  const body = art.lines
    .map((line, row) => {
      const colours = art.colours?.[row];
      if (!colours) return escapeXml(line);
      return colourRuns(line, colours)
        .map((run) => `<span style="color: ${cssColour(run.colour)}">${escapeXml(run.text)}</span>`)
        .join('');
    })
    .join('\n');

  return `<pre style="${style}">${body}</pre>`;
}
