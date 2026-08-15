/**
 * Canvas glue between the pure pipeline and the two callers that have real
 * bitmaps in hand (the Background remover tool and the image editor's
 * "remove background" action). Kept apart from pipeline.ts so the maths stays
 * unit-testable in node, and apart from runtime.ts so the download/session
 * plumbing has one home.
 */
import { getRunner, type DownloadProgress } from './runtime';
import {
  applyMask,
  maskToAlphaRgba,
  maskToGreyRgba,
  refineMask,
  segmentImage,
  type MaskOptions,
  type RgbColor,
  type RgbaImage,
} from './pipeline';

export function canvasToImage(canvas: HTMLCanvasElement): RgbaImage {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { data: data.data, width: data.width, height: data.height };
}

export function imageToCanvas(image: RgbaImage): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, image.width);
  canvas.height = Math.max(1, image.height);
  // The cast is safe and deliberate: ImageData's constructor demands an
  // ArrayBuffer-backed view, and canvas pixel buffers never come off a
  // SharedArrayBuffer. Copying to satisfy the type would double the memory
  // traffic of every preview repaint on a large photo.
  const data = image.data as Uint8ClampedArray<ArrayBuffer>;
  canvas.getContext('2d')!.putImageData(new ImageData(data, image.width, image.height), 0, 0);
  return canvas;
}

/** A mask as a bitmap: 'alpha' = black pixels with the mask as alpha (a clip
 * source for the editor's mask layer), 'grey' = the visible mask preview. */
export function maskToCanvas(
  mask: Float32Array,
  width: number,
  height: number,
  mode: 'alpha' | 'grey' = 'alpha'
): HTMLCanvasElement {
  const data = mode === 'alpha' ? maskToAlphaRgba(mask, width, height) : maskToGreyRgba(mask, width, height);
  return imageToCanvas({ data, width, height });
}

/**
 * Run the model over a canvas and return the full-resolution 0..1 mask.
 * `onProgress` fires only while the assets download (first use).
 */
export async function computeMask(
  canvas: HTMLCanvasElement,
  onProgress?: (progress: DownloadProgress) => void
): Promise<Float32Array> {
  const runner = await getRunner(onProgress);
  return segmentImage(canvasToImage(canvas), runner);
}

/** Cut-out canvas from a source canvas + mask + the user's cleanup knobs. */
export function applyMaskToCanvas(
  canvas: HTMLCanvasElement,
  mask: Float32Array,
  options: Partial<MaskOptions> = {},
  background: RgbColor | null = null
): HTMLCanvasElement {
  const image = canvasToImage(canvas);
  const refined = refineMask(mask, image.width, image.height, options);
  return imageToCanvas(applyMask(image, refined, background));
}

/** '#rrggbb' → channels. Returns null for anything else (treated as transparent). */
export function parseHexColor(hex: string): RgbColor | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = parseInt(match[1]!, 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}
