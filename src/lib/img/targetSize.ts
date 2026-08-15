/**
 * Target-size search for the image compressor: find encoder settings that
 * bring an image under a byte budget. Pure over an injected `measure`
 * function (encode at quality q + scale s, return the byte size), so the
 * strategy is unit-testable in node while the component supplies the real
 * canvas encoder.
 *
 * Strategy (honest about what "smaller" costs):
 *   1. JPG only: lower quality, but never below `minQuality` — past that
 *      point the picture is mush and dimensions are the better lever.
 *   2. Both formats: scale dimensions down (longest edge), never below
 *      `minScale`. PNG is lossless, so this is its ONLY lever.
 * If even the smallest allowed encode is over budget the result says so
 * (`reached: false`) and carries the best it managed — the UI must tell the
 * user a target "may not be possible", not silently pretend.
 *
 * Both stages binary-search assuming size is monotone in the knob. Real
 * encoders are only roughly monotone, so the search keeps the best
 * satisfying candidate it has actually measured rather than trusting the
 * midpoint math.
 */
import type { TargetFormat } from './convert';

export interface TargetSearchOptions {
  targetBytes: number;
  format: TargetFormat;
  /** Upper quality bound (the user's chosen quality); default 100. */
  maxQuality?: number;
  /** Quality floor before dimensions start shrinking; default 20. */
  minQuality?: number;
  /** Smallest dimension scale to try; default 0.05. */
  minScale?: number;
  /** Aborts between measurements when it returns true. */
  isStale?: () => boolean;
}

export interface TargetSearchResult {
  reached: boolean;
  /** 1-100; meaningless for PNG (always maxQuality). */
  quality: number;
  /** Dimension scale 0-1 applied to both axes. */
  scale: number;
  bytes: number;
  /** How many encodes the search performed. */
  encodes: number;
}

export type Measure = (quality: number, scale: number) => Promise<number>;

export class StaleSearch extends Error {}

export async function searchForTarget(
  measure: Measure,
  opts: TargetSearchOptions
): Promise<TargetSearchResult> {
  const target = Math.max(1, Math.floor(opts.targetBytes));
  const maxQ = clampInt(opts.maxQuality ?? 100, 1, 100);
  const minQ = clampInt(opts.minQuality ?? 20, 1, maxQ);
  const minScale = Math.min(1, Math.max(0.01, opts.minScale ?? 0.05));
  const isStale = opts.isStale ?? (() => false);
  let encodes = 0;
  const probe = async (q: number, s: number): Promise<number> => {
    if (isStale()) throw new StaleSearch();
    encodes++;
    return measure(q, s);
  };

  // Stage 0: does the plain encode already fit?
  let quality = maxQ;
  let bytes = await probe(maxQ, 1);
  if (bytes <= target) return { reached: true, quality, scale: 1, bytes, encodes };

  // Stage 1 (JPG): quality search between minQ and maxQ at full size.
  if (opts.format === 'jpg' && minQ < maxQ) {
    const atFloor = await probe(minQ, 1);
    if (atFloor <= target) {
      // Largest quality in [minQ, maxQ) that fits.
      let lo = minQ; // known to fit
      let hi = maxQ; // known not to fit
      let best = { q: minQ, bytes: atFloor };
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        const b = await probe(mid, 1);
        if (b <= target) {
          lo = mid;
          best = { q: mid, bytes: b };
        } else hi = mid;
      }
      return { reached: true, quality: best.q, scale: 1, bytes: best.bytes, encodes };
    }
    quality = minQ;
    bytes = atFloor;
  }

  // Stage 2 (both): dimension scale search at the chosen quality.
  const atMin = await probe(quality, minScale);
  if (atMin > target) {
    return { reached: false, quality, scale: minScale, bytes: atMin, encodes };
  }
  let lo = minScale; // fits
  let hi = 1; // doesn't
  let best = { s: minScale, bytes: atMin };
  for (let i = 0; i < 10 && hi - lo > 0.01; i++) {
    const mid = (lo + hi) / 2;
    const b = await probe(quality, mid);
    if (b <= target) {
      lo = mid;
      best = { s: mid, bytes: b };
    } else hi = mid;
  }
  return { reached: true, quality, scale: round3(best.s), bytes: best.bytes, encodes };
}

/** Byte budget for a "percent of the original" target. */
export function percentTargetBytes(originalBytes: number, percent: number): number {
  const p = Number.isFinite(percent) ? Math.min(100, Math.max(1, percent)) : 100;
  return Math.max(1, Math.floor((originalBytes * p) / 100));
}

/** Byte budget for a "max size" target given in KB (decimal, like formatBytes). */
export function kbTargetBytes(kb: number): number {
  return Number.isFinite(kb) && kb > 0 ? Math.floor(kb * 1000) : 1;
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(Number.isFinite(v) ? v : hi)));
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
