import { describe, expect, it } from 'vitest';
import {
  StaleSearch,
  kbTargetBytes,
  percentTargetBytes,
  searchForTarget,
  type Measure,
} from './targetSize';

/**
 * A synthetic encoder: size grows with quality (JPG-like) and with the
 * scaled pixel count. Monotone in both knobs, like a real encoder roughly is.
 */
const fakeJpg =
  (base: number): Measure =>
  async (q, s) =>
    Math.round(base * s * s * (0.2 + 0.8 * (q / 100)));

/** PNG-like: quality is ignored, only dimensions matter. */
const fakePng =
  (base: number): Measure =>
  async (_q, s) =>
    Math.round(base * s * s);

describe('searchForTarget', () => {
  it('returns immediately when the plain encode already fits', async () => {
    const r = await searchForTarget(fakeJpg(1000), { targetBytes: 5000, format: 'jpg' });
    expect(r).toMatchObject({ reached: true, quality: 100, scale: 1, bytes: 1000, encodes: 1 });
  });

  it('JPG: lowers quality (largest that fits) before touching dimensions', async () => {
    // base 1000 at q100 → 1000; at q20 → 360. Target 600 → q≈50.
    const r = await searchForTarget(fakeJpg(1000), { targetBytes: 600, format: 'jpg' });
    expect(r.reached).toBe(true);
    expect(r.scale).toBe(1);
    expect(r.bytes).toBeLessThanOrEqual(600);
    // Largest fitting quality: q=50 → 1000*(0.2+0.4)=600 exactly.
    expect(r.quality).toBe(50);
  });

  it('JPG: falls through to dimension scaling once the quality floor is hit', async () => {
    // Even q20 full-size (360) is over a 200-byte target → scale down at q20.
    const r = await searchForTarget(fakeJpg(1000), { targetBytes: 200, format: 'jpg' });
    expect(r.reached).toBe(true);
    expect(r.quality).toBe(20);
    expect(r.scale).toBeLessThan(1);
    expect(r.bytes).toBeLessThanOrEqual(200);
    // Not needlessly small: a slightly larger scale would overflow.
    const s = r.scale + 0.02;
    expect(360 * s * s).toBeGreaterThan(200);
  });

  it('respects the user quality as an upper bound', async () => {
    const r = await searchForTarget(fakeJpg(1000), { targetBytes: 5000, format: 'jpg', maxQuality: 70 });
    expect(r.quality).toBe(70);
  });

  it('PNG: never touches quality, only dimensions', async () => {
    const r = await searchForTarget(fakePng(1000), { targetBytes: 250, format: 'png' });
    expect(r.reached).toBe(true);
    expect(r.quality).toBe(100);
    expect(r.scale).toBeCloseTo(0.5, 1);
    expect(r.bytes).toBeLessThanOrEqual(250);
  });

  it('reports an unreachable target honestly, with the best it managed', async () => {
    // Even at minScale (0.05 → 0.0025 of pixels) 1000 bytes stays over 1.
    const r = await searchForTarget(fakePng(1000), { targetBytes: 1, format: 'png' });
    expect(r.reached).toBe(false);
    expect(r.scale).toBe(0.05);
    expect(r.bytes).toBeGreaterThan(1);
  });

  it('aborts between measurements when the search goes stale', async () => {
    let calls = 0;
    await expect(
      searchForTarget(
        async () => {
          calls++;
          return 10_000;
        },
        { targetBytes: 10, format: 'jpg', isStale: () => calls >= 2 }
      )
    ).rejects.toBeInstanceOf(StaleSearch);
    expect(calls).toBe(2);
  });
});

describe('target helpers', () => {
  it('percentTargetBytes clamps 1-100 and floors', () => {
    expect(percentTargetBytes(1000, 50)).toBe(500);
    expect(percentTargetBytes(1000, 0)).toBe(10);
    expect(percentTargetBytes(1000, 150)).toBe(1000);
    expect(percentTargetBytes(1000, NaN)).toBe(1000);
    expect(percentTargetBytes(999, 33.3)).toBe(332);
  });

  it('kbTargetBytes uses decimal KB and rejects nonsense', () => {
    expect(kbTargetBytes(500)).toBe(500_000);
    expect(kbTargetBytes(0)).toBe(1);
    expect(kbTargetBytes(-3)).toBe(1);
    expect(kbTargetBytes(NaN)).toBe(1);
  });
});
