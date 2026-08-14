/**
 * Image conversion/resize/compress core (plan §3.3/§3.5/§3.6). The pure math
 * and mapping helpers live at the top (unit-tested in node); the
 * decode/encode pipeline below needs a browser (canvas, createImageBitmap)
 * and is exercised by the Playwright fixture tests.
 *
 * Format policy per the plan: inputs SVG/AVIF/WebP/TIFF/PNG/JPG, outputs
 * ONLY PNG or JPG (canvas AVIF/WebP encoding isn't broadly supported), and
 * clipboard copies are ALWAYS PNG (the async clipboard API accepts nothing
 * else) — the UI labels that.
 */

export type TargetFormat = 'png' | 'jpg';

export const TARGETS: { id: TargetFormat; label: string; mime: string }[] = [
  { id: 'png', label: 'PNG', mime: 'image/png' },
  { id: 'jpg', label: 'JPG', mime: 'image/jpeg' },
];

export const targetMime = (t: TargetFormat): string =>
  t === 'png' ? 'image/png' : 'image/jpeg';

export type InputKind = 'svg' | 'tiff' | 'raster' | 'unsupported';

/** What the file is, judged by extension first (mime types for TIFF/AVIF are
 * unreliable across OSes), falling back to the reported mime. */
export function detectKind(name: string, mime: string): InputKind {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  if (ext === 'svg' || mime === 'image/svg+xml') return 'svg';
  if (ext === 'tif' || ext === 'tiff' || mime === 'image/tiff') return 'tiff';
  if (['png', 'jpg', 'jpeg', 'webp', 'avif'].includes(ext)) return 'raster';
  if (['image/png', 'image/jpeg', 'image/webp', 'image/avif'].includes(mime)) return 'raster';
  return 'unsupported';
}

/** The conversion matrix: PNG→JPG, JPG→PNG, everything else → both. */
export function targetsFor(name: string, mime: string): TargetFormat[] {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  if (ext === 'png' || (ext === '' && mime === 'image/png')) return ['jpg'];
  if (ext === 'jpg' || ext === 'jpeg' || (ext === '' && mime === 'image/jpeg')) return ['png'];
  if (detectKind(name, mime) === 'unsupported') return [];
  return ['png', 'jpg'];
}

/** 'holiday.avif' → 'holiday.png' (dots in the stem survive). */
export function outputFilename(inputName: string, target: TargetFormat): string {
  const stem = inputName.replace(/\.[a-z0-9]+$/i, '');
  return `${(stem || inputName || 'image')}.${target}`;
}

/** Clamp a 1–100 UI quality to canvas's 0..1 (never 0 — that means "default"). */
export function qualityFraction(q: number): number {
  const clamped = Math.min(100, Math.max(1, Math.round(Number.isFinite(q) ? q : 85)));
  return clamped / 100;
}

export interface ResizeRequest {
  /** Original size. */
  width: number;
  height: number;
  /** Desired values — null = derive. */
  targetWidth: number | null;
  targetHeight: number | null;
  /** Keep the aspect ratio (derive the missing/other dimension). */
  lock: boolean;
}

/** The output pixel size for a resize, always ≥ 1×1 and rounded. */
export function fitDimensions(req: ResizeRequest): { width: number; height: number } {
  const w = Math.max(1, Math.round(req.width));
  const h = Math.max(1, Math.round(req.height));
  const tw = req.targetWidth !== null && req.targetWidth > 0 ? req.targetWidth : null;
  const th = req.targetHeight !== null && req.targetHeight > 0 ? req.targetHeight : null;
  if (tw === null && th === null) return { width: w, height: h };
  if (req.lock) {
    // The width wins when both are given under lock.
    if (tw !== null) return { width: Math.max(1, Math.round(tw)), height: Math.max(1, Math.round((tw * h) / w)) };
    return { width: Math.max(1, Math.round((th! * w) / h)), height: Math.max(1, Math.round(th!)) };
  }
  return {
    width: Math.max(1, Math.round(tw ?? w)),
    height: Math.max(1, Math.round(th ?? h)),
  };
}

/** Percentage helper: 50% of 400×300 → 200×150. */
export function percentDimensions(width: number, height: number, percent: number): { width: number; height: number } {
  const p = Math.max(1, percent) / 100;
  return { width: Math.max(1, Math.round(width * p)), height: Math.max(1, Math.round(height * p)) };
}

/** Cap the longest edge (compressor): 4000×2000 capped 1000 → 1000×500. */
export function capDimensions(width: number, height: number, maxEdge: number | null): { width: number; height: number } {
  if (maxEdge === null || maxEdge <= 0 || Math.max(width, height) <= maxEdge) {
    return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
  }
  const scale = maxEdge / Math.max(width, height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** '2.4 MB' / '830 KB' / '412 B' — decimal units like the rest of the app. */
export function formatBytes(bytes: number): string {
  if (!(bytes >= 0) || !Number.isFinite(bytes)) return '—';
  if (bytes < 1e3) return `${Math.round(bytes)} B`;
  if (bytes < 1e6) return `${Number((bytes / 1e3).toPrecision(3))} KB`;
  return `${Number((bytes / 1e6).toPrecision(3))} MB`;
}

/* ----------------------------------------------------- browser pipeline --- */

export interface DecodedImage {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

export class DecodeError extends Error {}

/**
 * Decode any supported input onto a canvas. SVG rasterizes at `svgWidth`
 * (aspect from its intrinsic ratio, square fallback). TIFF goes through the
 * bundled utif2 decoder and throws DecodeError on exotic variants.
 */
export async function decodeToCanvas(file: File, svgWidth = 1024): Promise<DecodedImage> {
  const kind = detectKind(file.name, file.type);
  if (kind === 'unsupported') throw new DecodeError('Unsupported file type.');
  if (kind === 'svg') return decodeSvg(file, svgWidth);
  if (kind === 'tiff') return decodeTiff(file);
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = drawToCanvas(bitmap, bitmap.width, bitmap.height);
    bitmap.close();
    return { canvas, width: canvas.width, height: canvas.height };
  } catch {
    throw new DecodeError("This image couldn't be decoded — is the file corrupted?");
  }
}

async function decodeSvg(file: File, svgWidth: number): Promise<DecodedImage> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    // Some SVGs have no intrinsic size; fall back to square at the target.
    const ratio = img.naturalWidth > 0 && img.naturalHeight > 0 ? img.naturalHeight / img.naturalWidth : 1;
    const width = Math.max(1, Math.round(svgWidth));
    const height = Math.max(1, Math.round(width * ratio));
    const canvas = drawToCanvas(img, width, height);
    return { canvas, width, height };
  } catch {
    throw new DecodeError("This SVG couldn't be rendered.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function decodeTiff(file: File): Promise<DecodedImage> {
  try {
    const { default: UTIF } = await import('utif2');
    const buffer = await file.arrayBuffer();
    const pages = UTIF.decode(buffer);
    if (!pages.length) throw new Error('no pages');
    const page = pages[0]!;
    UTIF.decodeImage(buffer, page);
    const rgba = UTIF.toRGBA8(page);
    const width = page.width;
    const height = page.height;
    if (!width || !height || !rgba?.length) throw new Error('empty');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, 0, width * height * 4), width, height), 0, 0);
    return { canvas, width, height };
  } catch {
    throw new DecodeError(
      "This TIFF couldn't be decoded — exotic compression variants aren't supported."
    );
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = url;
  });
}

function drawToCanvas(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(source, 0, 0, width, height);
  return canvas;
}

/** Scale a decoded canvas to new dimensions. */
export function scaleCanvas(src: HTMLCanvasElement, width: number, height: number): HTMLCanvasElement {
  if (src.width === width && src.height === height) return src;
  return drawToCanvas(src, Math.max(1, width), Math.max(1, height));
}

/**
 * Encode to the target. JPG can't carry alpha, so transparent pixels are
 * composited over white first (canvas would otherwise paint them black).
 */
export function encodeCanvas(
  canvas: HTMLCanvasElement,
  target: TargetFormat,
  quality1to100: number
): Promise<Blob> {
  let source = canvas;
  if (target === 'jpg') {
    const flat = document.createElement('canvas');
    flat.width = canvas.width;
    flat.height = canvas.height;
    const ctx = flat.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, flat.width, flat.height);
    ctx.drawImage(canvas, 0, 0);
    source = flat;
  }
  return new Promise((resolve, reject) => {
    source.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('encoding failed'))),
      targetMime(target),
      target === 'jpg' ? qualityFraction(quality1to100) : undefined
    );
  });
}
