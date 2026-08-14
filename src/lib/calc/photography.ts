/**
 * Photography equivalence and stop math (plan §4.2).
 *
 * The model is TOTAL-LIGHT equivalence: per-area exposure is identical across
 * formats at the same settings; what differs is total light gathered (noise /
 * depth of field). Equivalents across formats with crop ratio r = fromCrop/toCrop:
 * focal × r, f-number × r, ISO × r², shutter unchanged.
 *
 * Stop differences are computed exactly per the plan's definitions:
 *   shutter  log2(t1/t2)      ISO     log2(i1/i2)
 *   aperture 2·log2(N1/N2)    sensor  2·log2(crop1/crop2)
 * Sign convention: each is "how many stops set 1 sits above set 2 on that
 * dial" — the UI translates into more/less light per component.
 */

export type SensorFormatId = 'mft' | 'apsc' | 'apsc-canon' | 'ff';

export interface SensorFormat {
  id: SensorFormatId;
  label: string;
  crop: number;
}

export const FORMATS: SensorFormat[] = [
  { id: 'mft', label: 'Micro 4/3', crop: 2.0 },
  { id: 'apsc', label: 'APS-C', crop: 1.5 },
  { id: 'apsc-canon', label: 'APS-C (Canon)', crop: 1.6 },
  { id: 'ff', label: 'Full frame', crop: 1.0 },
];

export function formatById(id: string): SensorFormat | null {
  return FORMATS.find((f) => f.id === id) ?? null;
}

export interface Settings {
  focal: number; // mm
  aperture: number; // f-number
  iso: number;
}

/** Total-light-equivalent settings when moving from crop `fromCrop` to `toCrop`. */
export function equivalentSettings(s: Settings, fromCrop: number, toCrop: number): Settings {
  const r = fromCrop / toCrop;
  return { focal: s.focal * r, aperture: s.aperture * r, iso: s.iso * r * r };
}

/* ---------------------------------------------------------------- stops --- */

export function shutterStops(t1: number, t2: number): number {
  return Math.log2(t1 / t2);
}

export function isoStops(i1: number, i2: number): number {
  return Math.log2(i1 / i2);
}

export function apertureStops(n1: number, n2: number): number {
  return 2 * Math.log2(n1 / n2);
}

export function sensorStops(crop1: number, crop2: number): number {
  return 2 * Math.log2(crop1 / crop2);
}

/* ------------------------------------------------------- 1/3-stop scales --- */

/**
 * Nominal 1/3-stop f-numbers, indexed in thirds-of-a-stop from f/1.0 (each
 * step is 2^(1/6) in N; the marketing numbers round that). Used for snapping —
 * values outside the table fall back to the exact 2^(k/6).
 */
const APERTURE_THIRDS: number[] = [
  1.0, 1.1, 1.2, 1.4, 1.6, 1.8, 2, 2.2, 2.5, 2.8, 3.2, 3.5, 4, 4.5, 5.0, 5.6, 6.3, 7.1, 8, 9, 10,
  11, 13, 14, 16, 18, 20, 22, 25, 29, 32,
];

/**
 * Nominal 1/3-stop ISOs from 25 up (index 0 = ISO 25, each step ×2^(1/3)).
 * The sequence is the standard doubling ladder with the familiar 125/160,
 * 1250/1600 … in-between values; 12800-and-up keep the camera spellings.
 */
const ISO_THIRDS: number[] = [
  25, 32, 40, 50, 64, 80, 100, 125, 160, 200, 250, 320, 400, 500, 640, 800, 1000, 1250, 1600, 2000,
  2500, 3200, 4000, 5000, 6400, 8000, 10000, 12800, 16000, 20000, 25600, 32000, 40000, 51200,
  64000, 80000, 102400,
];

/** Snap an f-number to the nearest nominal 1/3-stop value. */
export function snapAperture(n: number): number {
  if (!(n > 0)) return NaN;
  const thirds = Math.round(6 * Math.log2(n));
  const nominal = APERTURE_THIRDS[thirds];
  if (nominal !== undefined) return nominal;
  // Outside the marketing table: exact geometric value, 2 significant digits.
  return Number((2 ** (thirds / 6)).toPrecision(2));
}

/** Snap an ISO to the nearest nominal 1/3-stop value. */
export function snapIso(iso: number): number {
  if (!(iso > 0)) return NaN;
  const thirds = Math.round(3 * Math.log2(iso / 25));
  const nominal = ISO_THIRDS[thirds];
  if (nominal !== undefined) return nominal;
  return Number((25 * 2 ** (thirds / 3)).toPrecision(2));
}

/** Focal lengths aren't a stop scale — round to whole mm (one decimal < 10mm). */
export function snapFocal(mm: number): number {
  if (!(mm > 0)) return NaN;
  return mm < 10 ? Math.round(mm * 10) / 10 : Math.round(mm);
}

/* ------------------------------------------------------------- shutter ---- */

/**
 * Parse a shutter speed: "1/250", "0.5", "2", "2s", "0.4s" → seconds.
 * Returns null when unparseable or non-positive.
 */
export function parseShutter(text: string): number | null {
  const s = text.trim().toLowerCase().replace(/s$/, '').replaceAll(/\s/g, '');
  const frac = s.match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
  if (frac) {
    const num = Number(frac[1]);
    const den = Number(frac[2]);
    if (num > 0 && den > 0) return num / den;
    return null;
  }
  const plain = Number(s);
  return Number.isFinite(plain) && plain > 0 ? plain : null;
}

/** Display seconds the photographic way: 2s, 0.5s → 1/2, 0.004 → 1/250. */
export function formatShutter(seconds: number): string {
  if (!(seconds > 0)) return '—';
  if (seconds >= 1) {
    const rounded = Math.round(seconds * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}s`;
  }
  return `1/${Math.round(1 / seconds)}`;
}

/* --------------------------------------------------------------- output --- */

/** "+1", "-0.83", "0" — stops with a leading sign, trimmed to 2 decimals. */
export function formatStops(stops: number): string {
  const rounded = Math.round(stops * 100) / 100;
  if (rounded === 0) return '0';
  return (rounded > 0 ? '+' : '−') + String(Math.abs(rounded));
}
