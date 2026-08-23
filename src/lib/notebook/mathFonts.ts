/**
 * Which KaTeX faces a rendered note actually uses, as data URLs — what the
 * self-contained HTML export inlines.
 *
 * Measured, not mapped: the faces are read back from the computed
 * `font-family` / `font-weight` / `font-style` of every element inside the
 * rendered maths, the way the napkin-math component does it. A table from
 * KaTeX class names to faces would go stale with the next KaTeX release; the
 * browser's answer cannot. The root must be in the document for computed
 * styles to exist — callers render into an attached, off-screen container.
 *
 * Browser-only (computed styles, fetch); nothing here is unit-tested.
 */
import { buildDataUrl } from '../encode/base64';
import { MATH_FONT_FILES } from '../math/fonts';
import { href } from '../paths';

export interface MathFontFace {
  family: string;
  weight: string;
  style: string;
  dataUrl: string;
}

/** `KaTeX_Main` + bold + italic -> `KaTeX_Main-BoldItalic`. */
function faceName(family: string, bold: boolean, italic: boolean): string {
  const variant = `${bold ? 'Bold' : ''}${italic ? 'Italic' : ''}` || 'Regular';
  return `${family}-${variant}`;
}

async function toDataUrl(blob: Blob): Promise<string> {
  return buildDataUrl('font/woff2', new Uint8Array(await blob.arrayBuffer()));
}

/** The faces used under `root`, each fetched once from the vendored set. */
export async function collectMathFonts(root: ParentNode): Promise<MathFontFace[]> {
  const wanted = new Map<string, { family: string; weight: string; style: string }>();
  for (const el of root.querySelectorAll<HTMLElement>('.katex, .katex *')) {
    const css = getComputedStyle(el);
    const family = css.fontFamily.split(',')[0]?.trim().replace(/^["']|["']$/g, '') ?? '';
    if (!family.startsWith('KaTeX_')) continue;
    const bold = css.fontWeight === 'bold' || Number(css.fontWeight) >= 600;
    const italic = css.fontStyle === 'italic' || css.fontStyle === 'oblique';
    const face = faceName(family, bold, italic);
    if (!MATH_FONT_FILES.includes(`${face}.woff2`)) continue;
    if (!wanted.has(face)) {
      wanted.set(face, { family, weight: bold ? '700' : '400', style: italic ? 'italic' : 'normal' });
    }
  }
  const faces: MathFontFace[] = [];
  for (const [face, meta] of wanted) {
    const response = await fetch(href(`/math/fonts/${face}.woff2`));
    if (!response.ok) continue;
    faces.push({ ...meta, dataUrl: await toDataUrl(await response.blob()) });
  }
  return faces;
}
