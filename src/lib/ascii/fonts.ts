/**
 * Words as pictures — the vendored FIGlet fonts and the lazy renderer.
 *
 * `figlet` is an import nobody pays for until they ask for text art: the
 * library (~50 KB) and the `.flf` file are both fetched on first render and
 * kept for the session. `payload.spec.ts` watches the network to prove the
 * chunk stays out of every other page's bundle.
 *
 * Fonts are NOT loaded through figlet's own `loadFont`, which builds a URL
 * from a configured `fontPath`. They are fetched through `href()` like every
 * other app-absolute path — so the app keeps working under a sub-path base —
 * and handed to `parseFont()`. `public/figlet/PROVENANCE.txt` says where each
 * one came from and under what terms; `tools/build-figlet-fonts.mjs` is what
 * refuses to vendor a font that cannot answer that question.
 */
import { href } from '../paths';
import catalogue from './fonts.json';

export interface FigletFont {
  /** Slug: the filename in public/figlet/ and the key figlet knows it by. */
  id: string;
  /** The font's own name, as its header spells it. */
  name: string;
  /** Picker grouping — 'Stroke', 'Shadow', '3-D', 'Blocks', 'Decorative'. */
  style: string;
  /** One line for the picker. */
  note: string;
  bytes: number;
  sha256: string;
  /**
   * How this font is accounted for: 'header' when it states its own terms,
   * 'package' when it states none and ships on the figlet package's MIT
   * licence with its origin recorded. See public/figlet/PROVENANCE.txt.
   */
  basis: 'header' | 'package';
  /** The terms, quoted from the header, or the recorded package basis. */
  licence: string;
}

export const FIGLET_FONTS: FigletFont[] = catalogue as FigletFont[];

export const DEFAULT_FIGLET_FONT = 'standard';

/** Style groups, in catalogue order. */
export const FIGLET_STYLES: string[] = [...new Set(FIGLET_FONTS.map((f) => f.style))];

export function fontById(id: string): FigletFont {
  return FIGLET_FONTS.find((f) => f.id === id) ?? FIGLET_FONTS[0]!;
}

/**
 * Horizontal layouts, in the words the FIGfont spec uses.
 *
 * 'default' is the font's own fitting rules — what `figlet` on a terminal
 * does — and is right almost always; the other three are here because the
 * difference between them is exactly the kind of thing this app should let
 * someone see rather than describe.
 */
export const LAYOUTS = [
  { id: 'default', label: "Default — the font's own rules" },
  { id: 'fitted', label: 'Fitted — letters touch, nothing overlaps' },
  { id: 'full', label: 'Full — one full-width cell per letter' },
  { id: 'universal smushing', label: 'Smushed — letters overlap by one column' },
] as const;

export type LayoutId = (typeof LAYOUTS)[number]['id'];

export type Alignment = 'left' | 'center' | 'right';

type FigletModule = typeof import('figlet').default;

let modulePromise: Promise<FigletModule> | null = null;
const loaded = new Map<string, Promise<void>>();

async function figletModule(): Promise<FigletModule> {
  modulePromise ??= import('figlet').then((m) => m.default);
  return modulePromise;
}

/** Fetch and register one font. Cached per id — including the in-flight
 * promise, so a picker that renders fourteen previews at once fetches each
 * file once rather than fourteen times. */
export async function loadFont(id: string): Promise<void> {
  const cached = loaded.get(id);
  if (cached) return cached;
  const work = (async () => {
    const figlet = await figletModule();
    const res = await fetch(href(`/figlet/${id}.flf`));
    if (!res.ok) throw new Error(`the ${fontById(id).name} font could not be loaded (HTTP ${res.status})`);
    figlet.parseFont(id, await res.text());
  })();
  loaded.set(id, work);
  // A failed load must not be remembered as done, or the retry can never work.
  work.catch(() => loaded.delete(id));
  return work;
}

export interface FigletRequest {
  text: string;
  font: string;
  layout: LayoutId;
  alignment: Alignment;
}

/**
 * Render text as a banner, one input line at a time.
 *
 * Splitting on newlines ourselves rather than handing figlet a multi-line
 * string keeps each line's own height honest and lets alignment work on the
 * finished block: a two-line banner in a nine-row font is two blocks of nine
 * rows, not one block whose second half is padded by chance.
 */
export async function renderFiglet(request: FigletRequest): Promise<string[]> {
  const figlet = await figletModule();
  await loadFont(request.font);
  const options = {
    font: request.font,
    ...(request.layout === 'default' ? {} : { horizontalLayout: request.layout }),
  } as Parameters<FigletModule['textSync']>[1];

  const blocks = (request.text === '' ? [''] : request.text.split('\n')).map((line) =>
    figlet.textSync(line, options).split('\n')
  );
  const lines = blocks.flat();
  // Trailing blank rows are the font's descender space; a banner with three
  // empty lines under it looks like a bug in the tool rather than the font.
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();
  return align(lines, request.alignment);
}

/** Pad every line to the width of the widest, placing the block left, centre
 * or right. Rows stay rectangular so the SVG renderer's grid holds. */
export function align(lines: string[], alignment: Alignment): string[] {
  const width = lines.reduce((w, line) => Math.max(w, line.replace(/\s+$/, '').length), 0);
  return lines.map((line) => {
    const trimmed = line.replace(/\s+$/, '');
    const slack = Math.max(0, width - trimmed.length);
    if (alignment === 'right') return ' '.repeat(slack) + trimmed;
    if (alignment === 'center') return ' '.repeat(Math.floor(slack / 2)) + trimmed.padEnd(width - Math.floor(slack / 2));
    return trimmed.padEnd(width);
  });
}
