/**
 * A formula, rendered to self-contained static HTML and CSS.
 *
 * The generated web component is meant to be one file that anybody can drop
 * into any page. Showing the formula as `$\(costPerMonth*12\)*years$` met the
 * letter of that and not the spirit — the app itself shows a typeset formula,
 * and so should the thing it hands you.
 *
 * Three parts have to travel together for that to work anywhere:
 *
 * 1. **The markup.** `convertLatexToMarkup` is exported from MathLive's MAIN
 *    entry, which the napkin page has already loaded, so this costs nothing
 *    extra — no SSR chunk, no second copy of the library.
 * 2. **The layout CSS.** MathLive's own `mathlive-static.css`, inlined as a
 *    string at build time. It goes inside the component's shadow root, which
 *    scopes it: a host page cannot be affected by it and cannot break it.
 * 3. **The faces.** KaTeX markup positions glyphs by CSS but *draws* them with
 *    the KaTeX fonts, and a host page has none. Rather than embed all twenty
 *    (260 KB), this asks the browser which families the rendered markup
 *    actually resolved to, and embeds only those.
 *
 * That last step is why this module needs a DOM: the browser is a better
 * oracle for "which font does this span use" than any table mapping MathLive's
 * class names onto faces, which would go stale the first time the library
 * renamed one.
 */
// The layout rules, as a string, inlined at build time. The package's exports
// map calls this `static.css`; the file on disk is `mathlive-static.css`, and
// only the mapped name resolves.
import rawStaticCss from 'mathlive/static.css?raw';
import { encodeBytes } from '../encode/base64';
import { MATH_FONT_FILES } from '../math/fonts';
import { href } from '../paths';

export interface RenderedFormula {
  /** Static HTML — no script, no custom element, no editing affordances. */
  markup: string;
  /** Layout rules, plus an `@font-face` per face when they were embedded. */
  css: string;
  /** Bytes of embedded font data; 0 when the fonts were left out. */
  fontBytes: number;
  /** The faces this formula needs, whether or not they travelled with it. */
  families: string[];
}

/**
 * The layout rules WITHOUT MathLive's own `@font-face` block.
 *
 * That block points at `url(fonts/KaTeX_*.woff2)` — relative, and therefore
 * resolved against whatever page the component ends up on. Left in, it would
 * produce a row of 404s on every host and, worse, would sometimes win over the
 * embedded faces. The data-URI rules this module builds replace it entirely.
 */
const layoutCss = rawStaticCss.replace(/@font-face\s*\{[^}]*\}/g, '');

/** One resolved face: the family and whether it is bold and/or italic. */
interface FaceKey {
  family: string;
  bold: boolean;
  italic: boolean;
}

/**
 * The file that carries a family at a given weight and slant.
 *
 * The names follow KaTeX's own convention, but not every family ships every
 * variant — `KaTeX_Math` has no upright face at all — so the candidates are
 * tried in order and the first one that was vendored wins.
 */
function faceFile(key: FaceKey): string | null {
  const variants = [
    key.bold && key.italic ? 'BoldItalic' : key.bold ? 'Bold' : key.italic ? 'Italic' : 'Regular',
    key.italic ? 'Italic' : 'Regular',
    'Regular',
    'Italic',
  ];
  for (const variant of variants) {
    const name = `${key.family}-${variant}.woff2`;
    if (MATH_FONT_FILES.includes(name)) return name;
  }
  return null;
}

/** The first family in a computed `font-family`, unquoted. */
function firstFamily(value: string): string {
  const first = value.split(',')[0] ?? '';
  return first.trim().replace(/^["']|["']$/g, '');
}

const base64 = (buffer: ArrayBuffer): string => encodeBytes(new Uint8Array(buffer));

/**
 * Render `latex`, measure which faces it needs, and inline them.
 *
 * Returns null when there is no formula, or when MathLive cannot be loaded —
 * the caller falls back to showing the readable text form, which is worse but
 * never broken.
 */
export async function renderFormula(
  latex: string,
  { embedFonts = true }: { embedFonts?: boolean } = {}
): Promise<RenderedFormula | null> {
  const trimmed = latex.trim();
  if (!trimmed) return null;

  let markup: string;
  try {
    const { convertLatexToMarkup } = await import('mathlive');
    markup = convertLatexToMarkup(trimmed);
  } catch {
    return null;
  }
  if (!markup) return null;

  const faces = await collectFaces(markup);
  const families = [...new Set([...faces.values()].map((key) => key.family))].sort();
  // Without the faces the markup still LAYS OUT correctly — the positioning is
  // all CSS — it just draws in whatever serif the host page has. That is the
  // trade someone makes to keep the file small and share one stylesheet across
  // several components.
  if (!embedFonts) return { markup, css: layoutCss, fontBytes: 0, families };

  const { css: fontCss, bytes } = await embedFaces(faces);
  return { markup, css: `${fontCss}\n${layoutCss}`, fontBytes: bytes, families };
}

export interface RenderedFormulaSet {
  /** One markup string per input, in the same order. Empty inputs give ''. */
  markups: string[];
  /** ONE stylesheet for all of them: the layout rules plus the union of faces. */
  css: string;
  fontBytes: number;
  families: string[];
}

/**
 * Several formulas that will live in ONE document, sharing one stylesheet.
 *
 * Calling `renderFormula` per row and concatenating the results would embed
 * `KaTeX_Math-Italic` once per row that happens to use it — three rows of a
 * calculation share almost every face, so that is the same 40 KB pasted three
 * times into a file someone is going to send to somebody. Measuring the union
 * first embeds each face exactly once.
 *
 * Written for the napkin-math image export (0.5.0 Phase 3), which is why it
 * returns markups rather than a joined string: the caller lays each row out
 * separately and reads its geometry back.
 *
 * That caller does NOT put these into a `<foreignObject>`, and a future one
 * should not either — Chromium taints a canvas the moment an SVG containing
 * one is drawn onto it, so the picture can never become a PNG. See
 * [exportImage.ts](../napkin/exportImage.ts), whose header explains what to
 * do instead.
 */
export async function renderFormulaSet(
  latexes: readonly string[],
  { embedFonts = true }: { embedFonts?: boolean } = {}
): Promise<RenderedFormulaSet | null> {
  const trimmed = latexes.map((latex) => latex.trim());
  if (trimmed.every((latex) => !latex)) return null;

  let convert: (latex: string) => string;
  try {
    ({ convertLatexToMarkup: convert } = await import('mathlive'));
  } catch {
    return null;
  }

  const markups = trimmed.map((latex) => (latex ? convert(latex) : ''));
  if (markups.every((markup) => !markup)) return null;

  const faces = new Map<string, FaceKey>();
  for (const markup of markups) {
    if (!markup) continue;
    for (const [file, key] of await collectFaces(markup)) {
      if (!faces.has(file)) faces.set(file, key);
    }
  }
  const families = [...new Set([...faces.values()].map((key) => key.family))].sort();
  if (!embedFonts) return { markups, css: layoutCss, fontBytes: 0, families };

  const { css: fontCss, bytes } = await embedFaces(faces);
  return { markups, css: `${fontCss}\n${layoutCss}`, fontBytes: bytes, families };
}

/** `@font-face` rules carrying the font bytes themselves. */
async function embedFaces(faces: Map<string, FaceKey>): Promise<{ css: string; bytes: number }> {
  const rules: string[] = [];
  let bytes = 0;
  for (const [file, key] of faces) {
    try {
      const response = await fetch(href(`/math/fonts/${file}`));
      if (!response.ok) continue;
      const buffer = await response.arrayBuffer();
      bytes += buffer.byteLength;
      rules.push(
        `@font-face{font-family:"${key.family}";font-style:${key.italic ? 'italic' : 'normal'};` +
          `font-weight:${key.bold ? 700 : 400};font-display:swap;` +
          `src:url(data:font/woff2;base64,${base64(buffer)}) format("woff2")}`
      );
    } catch {
      // A face that will not load is a formula in a fallback serif, not a
      // broken component — carry on with the rest.
    }
  }
  return { css: rules.join('\n'), bytes };
}

/**
 * A stylesheet carrying ALL twenty faces, for a page hosting several
 * components.
 *
 * `@font-face` is document-scoped rather than tree-scoped, so one `<link>` on
 * the host page reaches inside every component's shadow root. Every face is
 * included rather than only the ones some particular formula needed, because
 * the point of the shared file is that it works for all of them.
 */
export async function allFontsCss(): Promise<string> {
  const faces = new Map<string, FaceKey>();
  for (const file of MATH_FONT_FILES) {
    const match = /^(KaTeX_[A-Za-z0-9]+)-(Regular|Bold|Italic|BoldItalic)\.woff2$/.exec(file);
    if (!match) continue;
    faces.set(file, {
      family: match[1]!,
      bold: match[2]!.includes('Bold'),
      italic: match[2]!.includes('Italic'),
    });
  }
  const { css } = await embedFaces(faces);
  return `/* KaTeX faces for napkin-math web components. Link this ONCE per page. */\n${css}\n`;
}

/**
 * Which faces the markup resolves to, measured rather than guessed.
 *
 * The probe renders into a SHADOW ROOT carrying the same layout CSS the
 * component will carry, which is the whole point: measuring against the
 * napkin page's ambient styles answers a different question, and answers it
 * wrongly — the page has MathLive's fonts registered document-wide, so every
 * span resolves to a KaTeX family whether the rules travelled with it or not.
 */
async function collectFaces(markup: string): Promise<Map<string, FaceKey>> {
  const found = new Map<string, FaceKey>();
  const host = document.createElement('div');
  // Off-screen rather than `display: none`: a hidden subtree still has
  // computed styles, but keeping it laid out avoids any engine that skips
  // work for invisible content.
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${layoutCss}</style>${markup}`;
  document.body.append(host);
  try {
    for (const element of root.querySelectorAll<HTMLElement>('*')) {
      const style = getComputedStyle(element);
      const family = firstFamily(style.fontFamily);
      if (!family.startsWith('KaTeX_')) continue;
      const key: FaceKey = {
        family,
        bold: Number(style.fontWeight) >= 600 || style.fontWeight === 'bold',
        italic: style.fontStyle === 'italic' || style.fontStyle === 'oblique',
      };
      const file = faceFile(key);
      // Key on the FILE: two spans wanting Math-Italic through different
      // routes must not embed the same bytes twice.
      if (file && !found.has(file)) found.set(file, key);
    }
  } finally {
    host.remove();
  }
  return found;
}
