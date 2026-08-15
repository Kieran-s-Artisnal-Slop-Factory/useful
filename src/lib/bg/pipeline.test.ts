import { describe, expect, it } from 'vitest';
import {
  applyMask,
  blurMask,
  maskFromOutput,
  maskToAlphaRgba,
  maskToGreyRgba,
  MODEL_SIZE,
  preprocess,
  refineMask,
  resizeMask,
  resizeRgba,
  segmentImage,
  type RgbaImage,
} from './pipeline';

/** A w×h image where every pixel is the same colour. */
function solid(width: number, height: number, r: number, g: number, b: number, a = 255): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  return { data, width, height };
}

describe('resizeRgba', () => {
  it('is the identity at the same size', () => {
    const src = solid(4, 4, 10, 20, 30);
    expect(Array.from(resizeRgba(src.data, 4, 4, 4, 4))).toEqual(Array.from(src.data));
  });

  it('keeps a flat colour flat when scaling up and down', () => {
    const src = solid(3, 5, 200, 100, 50, 255);
    const up = resizeRgba(src.data, 3, 5, 320, 320);
    expect(up.length).toBe(320 * 320 * 4);
    for (let i = 0; i < up.length; i += 4) {
      expect([up[i], up[i + 1], up[i + 2], up[i + 3]]).toEqual([200, 100, 50, 255]);
    }
    const down = resizeRgba(up, 320, 320, 2, 2);
    expect(Array.from(down.slice(0, 4))).toEqual([200, 100, 50, 255]);
  });

  it('samples pixel centres — a 2×1 split halves cleanly', () => {
    // left black, right white; downscaling to 1×1 must land exactly halfway
    const data = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]);
    const out = resizeRgba(data, 2, 1, 1, 1);
    expect(out[0]).toBeGreaterThanOrEqual(127);
    expect(out[0]).toBeLessThanOrEqual(128);
  });

  it('returns an empty buffer for degenerate sizes instead of throwing', () => {
    expect(resizeRgba(new Uint8ClampedArray(0), 0, 0, 2, 2).length).toBe(16);
  });
});

describe('preprocess', () => {
  it('produces an NCHW tensor with ImageNet normalization', () => {
    // A single all-white 2×2 "image": max = 255, so each channel is 1.0
    // normalized → (1 - mean) / std.
    const image = solid(2, 2, 255, 255, 255);
    const tensor = preprocess(image.data, 2);
    expect(tensor.length).toBe(2 * 2 * 3);
    expect(tensor[0]).toBeCloseTo((1 - 0.485) / 0.229, 5);
    expect(tensor[4]).toBeCloseTo((1 - 0.456) / 0.224, 5); // second plane
    expect(tensor[8]).toBeCloseTo((1 - 0.406) / 0.225, 5); // third plane
  });

  it('divides by the image maximum, not by 255 (U²-Net convention)', () => {
    const image = solid(1, 1, 128, 64, 32);
    const tensor = preprocess(image.data, 1);
    expect(tensor[0]).toBeCloseTo((128 / 128 - 0.485) / 0.229, 5);
    expect(tensor[1]).toBeCloseTo((64 / 128 - 0.456) / 0.224, 5);
  });

  it('survives an all-black image without NaNs', () => {
    const tensor = preprocess(solid(2, 2, 0, 0, 0).data, 2);
    expect(Array.from(tensor).every((v) => Number.isFinite(v))).toBe(true);
    expect(tensor[0]).toBeCloseTo(-0.485 / 0.229, 5);
  });

  it('ignores alpha — a transparent pixel is not treated as black', () => {
    const opaque = preprocess(solid(1, 1, 90, 90, 90, 255).data, 1);
    const clear = preprocess(solid(1, 1, 90, 90, 90, 0).data, 1);
    expect(Array.from(clear)).toEqual(Array.from(opaque));
  });
});

describe('maskFromOutput', () => {
  it('rescales the raw saliency map to 0..1', () => {
    const mask = maskFromOutput([2, 4, 6, 8]);
    expect(mask[0]).toBe(0);
    expect(mask[1]).toBeCloseTo(1 / 3, 6);
    expect(mask[2]).toBeCloseTo(2 / 3, 6);
    expect(mask[3]).toBe(1);
  });

  it('returns all-zero for a flat output rather than dividing by zero', () => {
    expect(Array.from(maskFromOutput([5, 5, 5]))).toEqual([0, 0, 0]);
  });
});

describe('resizeMask', () => {
  it('scales a mask up without leaving the 0..1 range', () => {
    const mask = Float32Array.from([0, 1, 1, 0]);
    const out = resizeMask(mask, 2, 2, 8, 8);
    expect(out.length).toBe(64);
    for (const v of out) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('refineMask', () => {
  it('is a no-op copy with the default options', () => {
    const mask = Float32Array.from([0, 0.25, 0.5, 1]);
    const out = refineMask(mask, 2, 2);
    expect(Array.from(out)).toEqual([0, 0.25, 0.5, 1]);
    expect(out).not.toBe(mask); // never mutates its input
  });

  it('cuts off haze and rescales what survives back to full opacity', () => {
    const mask = Float32Array.from([0.1, 0.5, 1]);
    const out = refineMask(mask, 3, 1, { cutoff: 20 });
    expect(out[0]).toBe(0);
    expect(out[1]).toBeCloseTo((0.5 - 0.2) / 0.8, 5);
    expect(out[2]).toBeCloseTo(1, 5);
  });

  it('feathers a hard edge into a gradient', () => {
    const mask = Float32Array.from([0, 0, 1, 1, 1, 1]);
    const out = refineMask(mask, 6, 1, { feather: 1 });
    expect(out[1]).toBeGreaterThan(0);
    expect(out[1]).toBeLessThan(1);
  });
});

describe('blurMask', () => {
  it('leaves a flat mask untouched and preserves length', () => {
    const mask = new Float32Array(16).fill(0.5);
    const out = blurMask(mask, 4, 4, 2);
    expect(out.length).toBe(16);
    for (const v of out) expect(v).toBeCloseTo(0.5, 6);
  });

  it('returns a copy for radius 0', () => {
    const mask = Float32Array.from([0, 1]);
    const out = blurMask(mask, 2, 1, 0);
    expect(Array.from(out)).toEqual([0, 1]);
    expect(out).not.toBe(mask);
  });
});

describe('applyMask', () => {
  it('writes the mask into the alpha channel', () => {
    const image = solid(2, 1, 10, 20, 30);
    const out = applyMask(image, Float32Array.from([1, 0]));
    expect(Array.from(out.data.slice(0, 4))).toEqual([10, 20, 30, 255]);
    expect(out.data[7]).toBe(0);
  });

  it('keeps already-transparent source pixels transparent', () => {
    const image = solid(1, 1, 10, 20, 30, 100);
    const out = applyMask(image, Float32Array.from([1]));
    expect(out.data[3]).toBe(100);
  });

  it('composites over a background colour and produces an opaque result', () => {
    const image = solid(1, 1, 200, 200, 200);
    const out = applyMask(image, Float32Array.from([0.5]), { r: 0, g: 0, b: 0 });
    expect(out.data[0]).toBe(100);
    expect(out.data[3]).toBe(255);
  });

  it('clamps out-of-range mask values', () => {
    const image = solid(2, 1, 9, 9, 9);
    const out = applyMask(image, Float32Array.from([2, -1]));
    expect(out.data[3]).toBe(255);
    expect(out.data[7]).toBe(0);
  });
});

describe('mask bitmaps', () => {
  it('alpha bitmaps are black with the mask as alpha', () => {
    const rgba = maskToAlphaRgba(Float32Array.from([1, 0]), 2, 1);
    expect(Array.from(rgba)).toEqual([0, 0, 0, 255, 0, 0, 0, 0]);
  });

  it('grey bitmaps are opaque greyscale', () => {
    const rgba = maskToGreyRgba(Float32Array.from([1, 0]), 2, 1);
    expect(Array.from(rgba)).toEqual([255, 255, 255, 255, 0, 0, 0, 255]);
  });
});

describe('segmentImage', () => {
  it('feeds a 320×320 NCHW tensor to the runner and scales the mask back', async () => {
    const image = solid(64, 32, 255, 255, 255);
    let seen: Float32Array | null = null;
    const mask = await segmentImage(image, async (input) => {
      seen = input;
      // "Everything on the left half is the subject."
      const out = new Float32Array(MODEL_SIZE * MODEL_SIZE);
      for (let y = 0; y < MODEL_SIZE; y++) {
        for (let x = 0; x < MODEL_SIZE; x++) out[y * MODEL_SIZE + x] = x < MODEL_SIZE / 2 ? 1 : 0;
      }
      return out;
    });
    expect(seen).not.toBeNull();
    expect(seen!.length).toBe(3 * MODEL_SIZE * MODEL_SIZE);
    expect(mask.length).toBe(64 * 32);
    expect(mask[0]).toBeCloseTo(1, 3); // left edge kept
    expect(mask[63]).toBeCloseTo(0, 3); // right edge dropped
  });

  it('propagates a runner failure instead of returning a blank mask', async () => {
    await expect(
      segmentImage(solid(4, 4, 1, 2, 3), async () => {
        throw new Error('session died');
      })
    ).rejects.toThrow('session died');
  });
});
