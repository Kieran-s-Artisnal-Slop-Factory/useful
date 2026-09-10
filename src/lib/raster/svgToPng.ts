/**
 * Rasterise a self-contained SVG string to a PNG blob (0.5.0 plan Phase 0,
 * decision 8).
 *
 * The pipeline is the boring one and that is the point: blob URL → `<Image>`
 * → canvas → the app's existing `encodeCanvas`. Nothing here knows what the
 * SVG draws, so the napkin-math formula export and anything after it share
 * one implementation.
 *
 * THE SVG MUST BE SELF-CONTAINED. An `<img>` loading an SVG is forbidden from
 * fetching anything — no external stylesheet, no webfont URL, no `<image
 * href>` to another file — and the failure is silent: the glyphs simply come
 * out in a fallback face, or the region paints empty. Callers embed what they
 * need as data URIs (see codegen/formulaMarkup.ts, which inlines the KaTeX
 * faces for exactly this reason).
 *
 * A `<foreignObject>` SVG — HTML laid out inside the picture — rasterises
 * correctly in Chromium and Firefox when that rule is honoured. WebKit does
 * not do it reliably: the frame draws blank or drops the text. So the support
 * check below is a stated refusal rather than a silent blank PNG, and the UI
 * offers the SVG instead. There is no desktop build and this is a personal
 * app used from Chromium; building a second, WebKit-specific text-measuring
 * pipeline blind is not a trade worth making.
 */
import { encodeCanvas } from '../img/convert';

export type RasterSupport = 'ok' | 'foreign-object-unreliable';

export interface SvgPixelSize {
  width: number;
  height: number;
}

export type SvgToPngResult =
  | { ok: true; blob: Blob; width: number; height: number }
  | { ok: false; reason: 'unsupported' | 'no-size' | 'load-failed' | 'encode-failed'; message: string };

const NUMBER = /^\s*(-?[\d.]+)\s*(px)?\s*$/;

/**
 * One attribute off the root tag.
 *
 * The boundary is `(?:^|[\s"'])` and NOT `\b`, which is the whole point: `\b`
 * matches between the hyphen and the w of `stroke-width`, so a root carrying
 * `stroke-width="2"` answered a lookup for `width` with 2 and the picture
 * rasterised two pixels wide. An attribute name can only start the string or
 * follow whitespace or the quote that closed the previous value.
 */
const attr = (root: string, name: string): string | null => {
  const match = new RegExp(`(?:^|[\\s"'])${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(root);
  return match ? (match[2] ?? match[3] ?? null) : null;
};

/**
 * The pixel size an `<img>` will give this SVG: the `width`/`height`
 * attributes when both are plain numbers, otherwise the viewBox's extent.
 * Percentages and other units yield null rather than a guess — a caller that
 * cannot size its own picture should say so, not paint 300×150.
 */
export function svgPixelSize(svg: string): SvgPixelSize | null {
  const root = /<svg\b[^>]*>/i.exec(svg)?.[0];
  if (!root) return null;

  const w = attr(root, 'width');
  const h = attr(root, 'height');
  const wNum = w !== null ? NUMBER.exec(w)?.[1] : undefined;
  const hNum = h !== null ? NUMBER.exec(h)?.[1] : undefined;
  if (wNum !== undefined && hNum !== undefined) {
    const width = Number(wNum);
    const height = Number(hNum);
    if (width > 0 && height > 0) return { width, height };
  }

  const box = attr(root, 'viewBox');
  if (box) {
    const parts = box.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      const [, , width, height] = parts as [number, number, number, number];
      if (width > 0 && height > 0) return { width, height };
    }
  }
  return null;
}

/**
 * Whether this engine draws `<foreignObject>` to a canvas dependably.
 *
 * Matches on the user-agent string rather than feature-detecting, because
 * there is nothing to detect: the failure is a blank region, not a thrown
 * error, so by the time you could measure it you have already produced the
 * bad PNG. WebKit means Safari and every iOS browser — desktop Chrome and
 * Edge carry `AppleWebKit` in their UA too, so they have to be excluded by
 * name.
 *
 * `Chrome` alone is the right exclusion, and the token is case-sensitive on
 * purpose. Chromium Edge always carries `Chrome/<version>`, so it needs no
 * branch of its own — and an `Edg`-matching branch is actively wrong, because
 * the iOS builds are WebKit underneath and announce themselves as `EdgiOS`.
 * A case-insensitive `Edg` test cleared exactly the browser this check exists
 * to catch. `CriOS` and `FxiOS` are the same trap and, containing no `Chrome`
 * token, correctly fall through to the refusal.
 */
export function foreignObjectSupport(userAgent: string): RasterSupport {
  const ua = userAgent || '';
  if (!/AppleWebKit/i.test(ua)) return 'ok';
  if (/Chrome|Chromium/.test(ua)) return 'ok';
  return 'foreign-object-unreliable';
}

/** The message the UI shows in place of a PNG button on an engine that would produce a blank one. */
export const WEBKIT_REFUSAL =
  'Safari cannot reliably draw this kind of picture to a canvas, so the PNG would come out blank or missing its text. Download the SVG instead — it is the same image, and it opens everywhere.';

export interface SvgToPngOptions {
  /** Pixel multiplier: 2 gives a 2× PNG of the same drawing. */
  scale?: number;
  /** Painted under the drawing. Omit or pass null to keep the alpha channel. */
  background?: string | null;
  /** Overridden in tests; defaults to the running browser. */
  userAgent?: string;
  /** Set false to rasterise even on an engine flagged unreliable. */
  checkSupport?: boolean;
}

function loadSvgImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('svg failed to load'));
    img.src = url;
  });
}

/**
 * The SVG as a PNG blob at `scale`×. Every failure is a returned result, not
 * a throw — a download button has somewhere to put a sentence and nowhere to
 * put an exception.
 */
export async function svgToPngBlob(
  svg: string,
  options: SvgToPngOptions = {}
): Promise<SvgToPngResult> {
  const {
    scale = 1,
    background = null,
    userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent,
    checkSupport = true,
  } = options;

  if (checkSupport && foreignObjectSupport(userAgent) !== 'ok' && /<foreignObject/i.test(svg)) {
    return { ok: false, reason: 'unsupported', message: WEBKIT_REFUSAL };
  }

  const size = svgPixelSize(svg);
  if (!size) {
    return {
      ok: false,
      reason: 'no-size',
      message: 'This SVG does not state a pixel size, so there is no honest resolution to render it at.',
    };
  }

  const width = Math.max(1, Math.round(size.width * scale));
  const height = Math.max(1, Math.round(size.height * scale));

  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = await loadSvgImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(img, 0, 0, width, height);
    try {
      const blob = await encodeCanvas(canvas, 'png', 100);
      return { ok: true, blob, width, height };
    } catch {
      return { ok: false, reason: 'encode-failed', message: 'The canvas could not be encoded as a PNG.' };
    }
  } catch {
    return {
      ok: false,
      reason: 'load-failed',
      message:
        'The browser refused to render this SVG. That usually means it references something outside itself — a font or an image by URL — which an SVG being rasterised is not allowed to fetch.',
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
