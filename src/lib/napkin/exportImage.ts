/**
 * A calculation as a picture (0.5.0 plan Phase 3).
 *
 * ## Why this does not use `<foreignObject>`
 *
 * The plan said to lay the typeset rows out as HTML inside `<foreignObject>`,
 * which is the obvious way to get MathLive's markup into an SVG, and to
 * rasterise that with a canvas. Measured against a real browser, **it cannot
 * work**: Chromium taints a canvas the moment an SVG containing a
 * `<foreignObject>` is drawn onto it, so `toBlob()` throws
 * `SecurityError: Tainted canvases may not be exported`. A one-element
 * `<foreignObject>` with no external references at all is enough to trigger
 * it. The plan expected trouble only from Safari; the truth is that no
 * browser will rasterise such an image, and the export would have shipped as
 * an SVG that silently refused to become a PNG.
 *
 * ## What it does instead
 *
 * The browser is still the typesetter — nothing here understands maths. The
 * markup is laid out once in an off-screen shadow root, and then **read back
 * as geometry**: every text run with its measured position, font and exact
 * baseline; every rule (fraction bars, the top of a radical) as a rectangle;
 * every inline `<svg>` KaTeX draws for a stretchy glyph, copied across at its
 * measured box. Those become `<text>`, `<rect>` and nested `<svg>` in the
 * output, which is a plain vector image: it rasterises anywhere, in every
 * engine, and it scales without a second render.
 *
 * The baseline is measured rather than estimated. A zero-size inline-block
 * with `vertical-align: baseline` inserted after a text node sits exactly ON
 * that line's baseline, which is the one reliable way to ask the browser
 * where it put the text.
 *
 * The KaTeX faces still travel inside the file as data URIs — an `<img>`
 * rendering an SVG may not fetch anything, so a font referenced by URL would
 * silently fall back to a serif.
 */
import { renderFormulaSet } from '../codegen/formulaMarkup';
import { escapeXml } from '../svg/build';

export interface CalculationRow {
  /**
   * Small caption above the row. Omitted when blank — whitespace counts as
   * blank, so a caption the dialog has turned off or emptied costs no height.
   */
  label: string;
  /** The row's content as LaTeX. */
  latex: string;
}

export interface ExportTheme {
  background: string;
  text: string;
  muted: string;
}

/**
 * The two palettes, as literals. Deliberately NOT read from the running
 * page's computed styles: an SVG file has no `:root` to inherit custom
 * properties from, and a picture is a thing you send to someone whose theme
 * is not yours.
 */
export const EXPORT_THEMES: Record<'light' | 'dark', ExportTheme> = {
  light: { background: '#ffffff', text: '#111111', muted: '#6b7280' },
  dark: { background: '#111827', text: '#f3f4f6', muted: '#9ca3af' },
};

export interface BuildOptions {
  title?: string;
  theme?: 'light' | 'dark';
  padding?: number;
  transparent?: boolean;
}

export interface BuiltCalculationSvg {
  svg: string;
  width: number;
  height: number;
  fontBytes: number;
  /** Text runs drawn. Zero means the rows measured but nothing was painted. */
  runs: number;
}

const GAP = 16;
const LABEL_HEIGHT = 15;
const LABEL_GAP = 3;
const TITLE_HEIGHT = 24;
const ROW_FONT_SIZE = 18;

/** The colour the probe inherits, so an explicitly coloured run stands out. */
const PROBE_COLOR = 'rgb(0, 0, 0)';

interface GlyphRun {
  text: string;
  x: number;
  baseline: number;
  family: string;
  size: number;
  italic: boolean;
  weight: string;
  /** Null when the run just inherited the probe's colour. */
  color: string | null;
}

interface Painted {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Embedded extends Painted {
  markup: string;
  viewBox: string | null;
}

export interface RowLayout {
  width: number;
  height: number;
  runs: GlyphRun[];
  rules: Painted[];
  embedded: Embedded[];
}

const isPainted = (color: string | null | undefined): boolean =>
  Boolean(color) && color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent';

/** Whether a pseudo-element exists AND paints something. */
function hasPaintedPseudo(element: Element, which: '::before' | '::after'): boolean {
  const style = getComputedStyle(element, which);
  if (!style.content || style.content === 'none') return false;
  return isPainted(style.backgroundColor) || (parseFloat(style.borderTopWidth) || 0) > 0;
}

/**
 * The caption as it is drawn: trimmed and in capitals, or the empty string
 * when there is nothing to draw. The builder skips the caption line entirely
 * on an empty result, so this is the single place that decides "blank means
 * none".
 */
export function captionText(label: string | null | undefined): string {
  return (label ?? '').trim().toUpperCase();
}

/**
 * One calculation's share of a comparison picture (0.6.0 feedback round 1).
 *
 * Both strings are already LaTeX: the caller has run `substitutedLatex` and
 * `formatNumberLatex`, and hands `null` for a row it is not drawing — because
 * the row is switched off, or because that calculation could not be
 * substituted or evaluated.
 */
export interface ComparedCalculation {
  /** Caption for this calculation. Blank on the first entry means "use the row caption". */
  title: string;
  substituted: string | null;
  result: string | null;
}

export interface ComparisonRowsInput {
  /** The formula row, or null when it is switched off. */
  formula: { label: string; latex: string } | null;
  /** The "With your values" caption as the dialog holds it — blank when off. */
  substitutedLabel: string;
  /** The "Result" caption as the dialog holds it — blank when off. */
  resultLabel: string;
  /** The current calculation first, then every comparison in the order added. */
  calculations: readonly ComparedCalculation[];
}

/** What the first calculation is called in a result caption when it was given no title. */
export const UNTITLED_CURRENT = 'Current';

/**
 * The rows of a picture that compares one or more calculations.
 *
 * The formula is drawn once. Then one substituted row per calculation, the
 * current one first — captioned with its title when it has one and with the
 * dialog's own caption otherwise — and then one result per calculation,
 * captioned `Result — <title>` as soon as there is more than one, because two
 * bare `= …` rows say nothing about which is which.
 *
 * Titles exist to tell calculations apart, so a lone calculation ignores its
 * title: with one calculation this returns exactly the three rows the 0.5.0
 * dialog built, whatever the dialog holds, and a picture with no comparison
 * added is the same picture it always was — including after the last
 * comparison is removed. Pure, so that promise is held by a unit test.
 */
export function comparisonRows(input: ComparisonRowsInput): CalculationRow[] {
  const { formula, substitutedLabel, resultLabel, calculations } = input;
  const rows: CalculationRow[] = [];
  if (formula) rows.push({ label: formula.label, latex: formula.latex });

  const several = calculations.length > 1;
  const titleOf = (calc: ComparedCalculation, index: number): string =>
    calc.title.trim() || (index === 0 ? UNTITLED_CURRENT : '');

  for (const [index, calc] of calculations.entries()) {
    if (calc.substituted === null) continue;
    const own = several ? calc.title.trim() : '';
    rows.push({
      label: index === 0 && !own ? substitutedLabel : own,
      latex: calc.substituted,
    });
  }

  for (const [index, calc] of calculations.entries()) {
    if (calc.result === null) continue;
    const label = several
      ? [resultLabel.trim(), titleOf(calc, index)].filter(Boolean).join(' — ')
      : resultLabel;
    rows.push({ label, latex: calc.result });
  }
  return rows;
}

/** Only the `@font-face` rules — the layout CSS is for measuring, not output. */
export function fontFaceRules(css: string): string {
  return (css.match(/@font-face\s*\{[^}]*\}/g) ?? []).join('');
}

/**
 * Lay a rendered markup string out and read its geometry back.
 *
 * Everything is measured relative to the row's own box, so a caller can place
 * the row anywhere by adding one offset.
 */
export function layoutRow(markup: string, layoutCss: string): RowLayout {
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML =
    `<style>${layoutCss}</style>` +
    `<div id="row" style="display:inline-block;color:${PROBE_COLOR};font-size:${ROW_FONT_SIZE}px">${markup}</div>`;
  document.body.append(host);

  try {
    const row = root.getElementById('row') as HTMLElement | null;
    if (!row) return { width: 0, height: 0, runs: [], rules: [], embedded: [] };
    const base = row.getBoundingClientRect();

    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if ((node as Text).nodeValue?.trim()) textNodes.push(node as Text);
    }

    const runs: GlyphRun[] = [];
    for (const text of textNodes) {
      const parent = text.parentElement;
      if (!parent) continue;

      // A zero-size inline-block aligned to the baseline lands exactly on it.
      const marker = document.createElement('span');
      marker.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
      parent.insertBefore(marker, text.nextSibling);
      const baseline = marker.getBoundingClientRect().top - base.top;
      marker.remove();

      const range = document.createRange();
      range.selectNodeContents(text);
      const box = range.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) continue;

      const style = getComputedStyle(parent);
      runs.push({
        text: text.nodeValue ?? '',
        x: box.left - base.left,
        baseline,
        family: (style.fontFamily.split(',')[0] ?? '').trim().replace(/^["']|["']$/g, ''),
        size: parseFloat(style.fontSize) || ROW_FONT_SIZE,
        italic: style.fontStyle !== 'normal',
        weight: style.fontWeight,
        color: style.color === PROBE_COLOR ? null : style.color,
      });
    }

    const rules: Painted[] = [];
    const embedded: Embedded[] = [];
    for (const element of row.querySelectorAll<HTMLElement>('*')) {
      const box = element.getBoundingClientRect();
      if (box.width <= 0) continue;

      // KaTeX draws stretchy glyphs — the surd of a root, big delimiters,
      // extensible arrows — as inline SVG. Copy those across whole.
      if (element.tagName.toLowerCase() === 'svg') {
        embedded.push({
          x: box.left - base.left,
          y: box.top - base.top,
          width: box.width,
          height: box.height,
          markup: element.innerHTML,
          viewBox: element.getAttribute('viewBox'),
        });
        continue;
      }
      if (element.closest('svg')) continue;

      // A rule can be painted three different ways, and MathLive uses the
      // least obvious of them: a fraction bar is `.ML__frac-line::after` with
      // a background, so scanning elements alone finds nothing at all. Check
      // the element and both its pseudo-elements.
      const style = getComputedStyle(element);
      const borderTop = parseFloat(style.borderTopWidth) || 0;
      if (borderTop > 0) {
        rules.push({ x: box.left - base.left, y: box.top - base.top, width: box.width, height: borderTop });
        continue;
      }
      const borderBottom = parseFloat(style.borderBottomWidth) || 0;
      if (borderBottom > 0) {
        rules.push({
          x: box.left - base.left,
          y: box.bottom - base.top - borderBottom,
          width: box.width,
          height: borderBottom,
        });
        continue;
      }

      const painted =
        isPainted(style.backgroundColor) ||
        hasPaintedPseudo(element, '::before') ||
        hasPaintedPseudo(element, '::after');
      // Only hairlines: a background on a tall box is a highlight, not a rule,
      // and painting it would cover the glyphs underneath.
      if (painted && box.height > 0 && box.height <= 4) {
        rules.push({ x: box.left - base.left, y: box.top - base.top, width: box.width, height: box.height });
      }
    }

    return { width: base.width, height: base.height, runs, rules, embedded };
  } finally {
    host.remove();
  }
}

const round = (n: number): string => (Math.round(n * 100) / 100).toString();

function drawRow(layout: RowLayout, dx: number, dy: number, color: string): string {
  const parts: string[] = [];
  for (const rule of layout.rules) {
    parts.push(
      `<rect x="${round(dx + rule.x)}" y="${round(dy + rule.y)}" width="${round(rule.width)}" ` +
        `height="${round(Math.max(0.6, rule.height))}" fill="${color}"/>`
    );
  }
  for (const item of layout.embedded) {
    const viewBox = item.viewBox ? ` viewBox="${item.viewBox}"` : '';
    parts.push(
      `<svg x="${round(dx + item.x)}" y="${round(dy + item.y)}" width="${round(item.width)}" ` +
        `height="${round(item.height)}"${viewBox} fill="${color}" preserveAspectRatio="none">${item.markup}</svg>`
    );
  }
  for (const run of layout.runs) {
    parts.push(
      `<text x="${round(dx + run.x)}" y="${round(dy + run.baseline)}" ` +
        `font-family="${escapeXml(run.family)}" font-size="${round(run.size)}" ` +
        `font-style="${run.italic ? 'italic' : 'normal'}" font-weight="${escapeXml(run.weight)}" ` +
        `fill="${run.color ?? color}" xml:space="preserve">${escapeXml(run.text)}</text>`
    );
  }
  return parts.join('');
}

/**
 * Build the picture. Returns null when nothing could be typeset — an empty
 * formula, or MathLive failing to load.
 */
export async function buildCalculationSvg(
  rows: readonly CalculationRow[],
  options: BuildOptions = {}
): Promise<BuiltCalculationSvg | null> {
  const usable = rows.filter((row) => row.latex.trim().length > 0);
  if (usable.length === 0) return null;

  const { title = '', theme = 'light', padding = 24, transparent = false } = options;
  const palette = EXPORT_THEMES[theme];

  const rendered = await renderFormulaSet(
    usable.map((row) => row.latex),
    { embedFonts: true }
  );
  if (!rendered) return null;

  // Nothing may be measured until the faces are in, or every row is sized
  // against a fallback serif and the picture comes out clipped.
  if (typeof document !== 'undefined' && document.fonts?.ready) await document.fonts.ready;

  const layouts = rendered.markups.map((markup) => layoutRow(markup, rendered.css));

  const titleText = title.trim();
  // A title can be wider than the maths; the box has to hold both.
  const titleWidth = titleText ? titleText.length * 8.2 : 0;
  const contentWidth = Math.max(120, titleWidth, ...layouts.map((row) => row.width));
  const labelled = usable.map((row, index) => ({
    label: captionText(row.label),
    layout: layouts[index]!,
  }));

  const width = Math.ceil(contentWidth + padding * 2);
  const height = Math.ceil(
    padding * 2 +
      (titleText ? TITLE_HEIGHT + GAP : 0) +
      labelled.reduce(
        (sum, row) => sum + row.layout.height + (row.label ? LABEL_HEIGHT + LABEL_GAP : 0),
        0
      ) +
      GAP * (labelled.length - 1)
  );

  const parts: string[] = [];
  let y = padding;

  if (titleText) {
    parts.push(
      `<text x="${padding}" y="${y + 16}" font-family="ui-sans-serif, system-ui, sans-serif" ` +
        `font-size="15" font-weight="600" fill="${palette.text}">${escapeXml(titleText)}</text>`
    );
    y += TITLE_HEIGHT + GAP;
  }

  let runCount = 0;
  for (const [index, row] of labelled.entries()) {
    if (row.label) {
      parts.push(
        `<text x="${padding}" y="${y + 11}" font-family="ui-sans-serif, system-ui, sans-serif" ` +
          `font-size="11" letter-spacing="0.06em" fill="${palette.muted}">` +
          `${escapeXml(row.label)}</text>`
      );
      y += LABEL_HEIGHT + LABEL_GAP;
    }
    parts.push(drawRow(row.layout, padding, y, palette.text));
    runCount += row.layout.runs.length;
    y += row.layout.height + (index < labelled.length - 1 ? GAP : 0);
  }

  const background = transparent
    ? ''
    : `<rect width="${width}" height="${height}" fill="${palette.background}"/>`;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}">` +
    `<style>${fontFaceRules(rendered.css)}</style>` +
    background +
    parts.join('') +
    `</svg>`;

  return { svg, width, height, fontBytes: rendered.fontBytes, runs: runCount };
}

/**
 * A number as LaTeX, grouped the way the Compute Engine groups one.
 *
 * The middle row's numbers come from the engine, which writes a thousands
 * separator as `\,` — so the result row underneath has to do the same or the
 * picture contradicts itself half way down.
 *
 * `decimals: null` means "exactly what the page shows", which is JavaScript's
 * own `String(number)`. There is no precision preference in this app and this
 * export is not the place to invent one; the dialog offers a rounding for the
 * picture and changes nothing about the calculation.
 */
export function formatNumberLatex(value: number, decimals: number | null = null): string {
  if (!Number.isFinite(value)) return String(value);
  const fixed = decimals === null ? String(value) : value.toFixed(decimals);
  const negative = fixed.startsWith('-');
  const [whole = '', fraction] = (negative ? fixed.slice(1) : fixed).split('.');
  // Four digits stay unbroken: 1000 reads worse as 1,000 in a formula.
  const grouped = whole.length > 4 ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, '\\,') : whole;
  return `${negative ? '-' : ''}${grouped}${fraction ? `.${fraction}` : ''}`;
}

/**
 * `Monthly-cost.svg` from a template name, or a sensible default.
 *
 * The name is user-controlled and ends up in a download, so it is stripped
 * rather than escaped: no separators, and no run of dots that could read as a
 * traversal to something downstream.
 */
export function imageFilename(templateName: string, extension: 'svg' | 'png'): string {
  const stem =
    templateName
      .trim()
      .replace(/[^\w\s.-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/\.{2,}/g, '.')
      .replace(/^[.\-]+|[.\-]+$/g, '')
      .slice(0, 60)
      .replace(/[.\-]+$/g, '') || 'calculation';
  return `${stem}.${extension}`;
}
