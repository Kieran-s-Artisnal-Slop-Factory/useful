/**
 * Background removal — the pure half (plan §3.4).
 *
 * Everything here is plain typed-array math with no DOM and no ONNX types, so
 * the whole pre/post-processing chain is unit-testable in node and the runtime
 * (runtime.ts) only has to supply "given a Float32Array, give me back the
 * model's output". That split is deliberate: the parts that can be wrong in
 * subtle, silent ways (normalization, mask scaling, alpha application) are the
 * parts that get tested.
 *
 * The model is U^2-Net small (u2netp, Apache-2.0, vendored by
 * tools/build-bg-assets.mjs). It takes a 320x320 RGB tensor in NCHW layout,
 * normalized the way the reference implementation does it — divide by the
 * image's MAXIMUM channel value (not by 255; that is what U^2-Net's
 * ToTensorLab did during training, and rembg kept it), then per-channel
 * ImageNet mean/std — and returns a 320x320 saliency map that is rescaled to
 * 0..1 and used as the alpha channel.
 */

/** The model's fixed input side length. */
export const MODEL_SIZE = 320;

const MEAN = [0.485, 0.456, 0.406] as const;
const STD = [0.229, 0.224, 0.225] as const;

/** A DOM-free stand-in for ImageData (which does not exist in node). */
export interface RgbaImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export interface MaskOptions {
  /**
   * 0-100. Alpha below this percentage is forced to fully transparent —
   * clears the faint haze the model leaves over busy backgrounds. 0 = off.
   */
  cutoff: number;
  /** Blur radius in mask pixels applied to the alpha; softens hard edges. */
  feather: number;
}

export const DEFAULT_MASK_OPTIONS: MaskOptions = { cutoff: 0, feather: 0 };

/**
 * Bilinear resample of an RGBA buffer. Used for BOTH directions (image down to
 * 320x320, mask back up to full size) — the browser's canvas scaler would do
 * this too, but doing it here keeps the pipeline deterministic across
 * browsers and testable in node.
 */
export function resizeRgba(
  src: Uint8ClampedArray,
  sw: number,
  sh: number,
  dw: number,
  dh: number
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dw * dh * 4);
  if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return out;
  // Map destination pixel CENTRES back into the source, so the resample is
  // symmetric (a corner-aligned map biases everything up-left by half a pixel).
  const fx = sw / dw;
  const fy = sh / dh;
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.max(0, (y + 0.5) * fy - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const wy = sy - y0;
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.max(0, (x + 0.5) * fx - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const wx = sx - x0;
      const i00 = (y0 * sw + x0) * 4;
      const i01 = (y0 * sw + x1) * 4;
      const i10 = (y1 * sw + x0) * 4;
      const i11 = (y1 * sw + x1) * 4;
      const o = (y * dw + x) * 4;
      for (let c = 0; c < 4; c++) {
        const top = src[i00 + c]! * (1 - wx) + src[i01 + c]! * wx;
        const bottom = src[i10 + c]! * (1 - wx) + src[i11 + c]! * wx;
        out[o + c] = Math.round(top * (1 - wy) + bottom * wy);
      }
    }
  }
  return out;
}

/** Bilinear resample of a single-channel 0..1 mask. */
export function resizeMask(
  mask: Float32Array,
  sw: number,
  sh: number,
  dw: number,
  dh: number
): Float32Array {
  const out = new Float32Array(dw * dh);
  if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return out;
  const fx = sw / dw;
  const fy = sh / dh;
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.max(0, (y + 0.5) * fy - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const wy = sy - y0;
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.max(0, (x + 0.5) * fx - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const wx = sx - x0;
      const top = mask[y0 * sw + x0]! * (1 - wx) + mask[y0 * sw + x1]! * wx;
      const bottom = mask[y1 * sw + x0]! * (1 - wx) + mask[y1 * sw + x1]! * wx;
      out[y * dw + x] = top * (1 - wy) + bottom * wy;
    }
  }
  return out;
}

/**
 * RGBA (already at MODEL_SIZE) → the model's NCHW float tensor. Alpha is
 * ignored: a transparent input pixel would otherwise read as black and the
 * model would happily segment the checkerboard.
 */
export function preprocess(rgba: Uint8ClampedArray, size = MODEL_SIZE): Float32Array {
  const pixels = size * size;
  const tensor = new Float32Array(pixels * 3);
  let max = 0;
  for (let i = 0; i < pixels; i++) {
    const o = i * 4;
    if (rgba[o]! > max) max = rgba[o]!;
    if (rgba[o + 1]! > max) max = rgba[o + 1]!;
    if (rgba[o + 2]! > max) max = rgba[o + 2]!;
  }
  // A fully black image has no scale to divide by — fall back to 255 rather
  // than producing NaNs the runtime would silently turn into a blank mask.
  const scale = max > 0 ? max : 255;
  for (let i = 0; i < pixels; i++) {
    const o = i * 4;
    tensor[i] = (rgba[o]! / scale - MEAN[0]) / STD[0];
    tensor[pixels + i] = (rgba[o + 1]! / scale - MEAN[1]) / STD[1];
    tensor[pixels * 2 + i] = (rgba[o + 2]! / scale - MEAN[2]) / STD[2];
  }
  return tensor;
}

/**
 * The model's raw saliency map → a 0..1 mask, rescaled by its own min/max
 * (the reference implementation does the same: the network's output is not
 * calibrated, only ordered). A flat output means "no salient object" and
 * yields an all-zero mask rather than a divide-by-zero.
 */
export function maskFromOutput(output: ArrayLike<number>): Float32Array {
  const out = new Float32Array(output.length);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < output.length; i++) {
    const v = output[i]!;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = max - min;
  if (!(span > 0)) return out;
  for (let i = 0; i < output.length; i++) out[i] = (output[i]! - min) / span;
  return out;
}

/** Separable box blur (two passes ≈ a gaussian) over a 0..1 mask. */
export function blurMask(mask: Float32Array, w: number, h: number, radius: number): Float32Array {
  const r = Math.round(radius);
  if (r <= 0 || w <= 0 || h <= 0) return mask.slice();
  // Annotated (not inferred): the two buffers are swapped between passes, and
  // an inferred pair disagrees about its backing-buffer type.
  let src: Float32Array = mask;
  let dst: Float32Array = new Float32Array(mask.length);
  for (let pass = 0; pass < 2; pass++) {
    // horizontal
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        let sum = 0;
        let n = 0;
        for (let k = -r; k <= r; k++) {
          const xx = x + k;
          if (xx < 0 || xx >= w) continue;
          sum += src[row + xx]!;
          n++;
        }
        dst[row + x] = sum / n;
      }
    }
    [src, dst] = [dst, src];
    // vertical
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        let sum = 0;
        let n = 0;
        for (let k = -r; k <= r; k++) {
          const yy = y + k;
          if (yy < 0 || yy >= h) continue;
          sum += src[yy * w + x]!;
          n++;
        }
        dst[y * w + x] = sum / n;
      }
    }
    [src, dst] = [dst, src];
  }
  return src;
}

/** Apply the user's cleanup knobs to a 0..1 mask. Pure — returns a new mask. */
export function refineMask(
  mask: Float32Array,
  w: number,
  h: number,
  options: Partial<MaskOptions> = {}
): Float32Array {
  const { cutoff, feather } = { ...DEFAULT_MASK_OPTIONS, ...options };
  const limit = Math.min(100, Math.max(0, cutoff)) / 100;
  let out = mask;
  if (limit > 0) {
    out = new Float32Array(mask.length);
    // Below the cutoff: gone. Above it: rescaled back up to full opacity, so
    // raising the cutoff cleans the haze without dimming the subject.
    for (let i = 0; i < mask.length; i++) {
      const v = mask[i]!;
      out[i] = v <= limit ? 0 : Math.min(1, (v - limit) / (1 - limit));
    }
  }
  const blurRadius = Math.max(0, feather);
  if (blurRadius > 0) out = blurMask(out, w, h, blurRadius);
  return out === mask ? mask.slice() : out;
}

/**
 * Composite the cut-out: the mask becomes the alpha channel. With a
 * `background` colour the result is opaque (what a JPG export needs — JPG has
 * no alpha, so the choice has to be made before encoding, not after).
 */
export function applyMask(
  image: RgbaImage,
  mask: Float32Array,
  background: RgbColor | null = null
): RgbaImage {
  const { width, height } = image;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    const a = Math.min(1, Math.max(0, mask[i] ?? 0));
    if (background) {
      data[o] = image.data[o]! * a + background.r * (1 - a);
      data[o + 1] = image.data[o + 1]! * a + background.g * (1 - a);
      data[o + 2] = image.data[o + 2]! * a + background.b * (1 - a);
      data[o + 3] = 255;
    } else {
      data[o] = image.data[o]!;
      data[o + 1] = image.data[o + 1]!;
      data[o + 2] = image.data[o + 2]!;
      // The source may already be partly transparent (a cut-out re-run, or a
      // PNG with holes) — keep it transparent rather than restoring it.
      data[o + 3] = Math.round(a * image.data[o + 3]!);
    }
  }
  return { data, width, height };
}

/**
 * Fold the user's touch-ups into a model mask.
 *
 * The model gets edges wrong sometimes — a strap read as background, a bright
 * patch of wall read as subject — and no slider fixes a specific spot, so the
 * tool lets you brush the mask directly. Both brushes are kept as separate
 * layers rather than being burnt into the mask, so the cutoff/feather knobs
 * (and a re-run of the model) keep working underneath them.
 *
 * `keep` wins where it is painted (that pixel is subject, whatever the model
 * thought); `remove` then cuts, so painting over your own keep strokes erases
 * them rather than fighting them. Both are read as RGBA bitmaps — the alpha
 * channel of the canvas the strokes were drawn on.
 */
export function applyPaint(
  mask: Float32Array,
  keep: Uint8ClampedArray | null,
  remove: Uint8ClampedArray | null
): Float32Array {
  if (!keep && !remove) return mask;
  const out = new Float32Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    // `?? 0` rather than `!`: a paint layer sized for a different image (a
    // re-import mid-session) must read as "not painted", not as NaN alpha.
    const k = keep ? (keep[i * 4 + 3] ?? 0) / 255 : 0;
    const r = remove ? (remove[i * 4 + 3] ?? 0) / 255 : 0;
    const value = Math.max(mask[i] ?? 0, k) * (1 - r);
    out[i] = value < 0 ? 0 : value > 1 ? 1 : value;
  }
  return out;
}

/** A mask rendered as a black bitmap whose ALPHA is the mask (a clip source). */
export function maskToAlphaRgba(mask: Float32Array, width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4 + 3] = Math.round(Math.min(1, Math.max(0, mask[i] ?? 0)) * 255);
  }
  return data;
}

/** A mask rendered as an opaque greyscale bitmap (the "show mask" preview). */
export function maskToGreyRgba(mask: Float32Array, width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const v = Math.round(Math.min(1, Math.max(0, mask[i] ?? 0)) * 255);
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  return data;
}

/** Runs one 1x3x320x320 tensor through the model and returns its first output. */
export type SegmentRunner = (input: Float32Array) => Promise<Float32Array>;

/**
 * Full pipeline: image → full-resolution 0..1 mask. Kept separate from
 * applyMask so callers can cache the mask and re-tune cutoff/feather/
 * background without paying for another inference pass.
 */
export async function segmentImage(image: RgbaImage, run: SegmentRunner): Promise<Float32Array> {
  const small = resizeRgba(image.data, image.width, image.height, MODEL_SIZE, MODEL_SIZE);
  const output = await run(preprocess(small));
  const mask = maskFromOutput(output);
  return resizeMask(mask, MODEL_SIZE, MODEL_SIZE, image.width, image.height);
}
