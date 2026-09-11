/**
 * Read the exposure settings a camera wrote into a photo's EXIF.
 *
 * Kept apart from photography.ts so that module stays dependency-free and
 * unit-testable in node: this one owns the lazy `exifr` import (the library
 * the image editor already ships — it must not load until a file is chosen,
 * which payload.spec.ts checks) and the "which tags are missing" verdict.
 * EXIF has no absolute light measurement; the four tags picked here are the
 * whole story, plus the camera model for the readout.
 */
import type { Exposure } from './photography';

/** The EXIF tags the comparison needs, in the order they are reported missing. */
export const EXPOSURE_TAGS = ['FNumber', 'ExposureTime', 'ISO'] as const;
export type ExposureTag = (typeof EXPOSURE_TAGS)[number];

export interface PhotoExposure extends Exposure {
  /** Camera model, '' when the tag is absent. */
  model: string;
  /** Focal length in mm, null when the tag is absent — informational only. */
  focal: number | null;
}

export type ExposureRead =
  | { ok: true; exposure: PhotoExposure }
  /** At least one of the three exposure tags is absent or not a positive number. */
  | { ok: false; missing: ExposureTag[] };

/** The shape of an exifr `parse` result narrowed to the picked tags. */
export interface PickedExif {
  FNumber?: unknown;
  ExposureTime?: unknown;
  ISO?: unknown;
  FocalLength?: unknown;
  Model?: unknown;
}

const positive = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;

/**
 * Pure: turn a parsed tag bag (or nothing at all — a file with no EXIF, or one
 * exifr could not open) into the settings or the list of absent tags.
 */
export function exposureFromExif(parsed: PickedExif | null | undefined): ExposureRead {
  const aperture = positive(parsed?.FNumber);
  const shutter = positive(parsed?.ExposureTime);
  // Some writers store ISO as a one-element array (ISOSpeedRatings is a
  // SHORT[] in the spec); exifr usually unwraps it, but be safe.
  const isoRaw = Array.isArray(parsed?.ISO) ? parsed?.ISO[0] : parsed?.ISO;
  const iso = positive(isoRaw);
  const missing: ExposureTag[] = [];
  if (aperture === null) missing.push('FNumber');
  if (shutter === null) missing.push('ExposureTime');
  if (iso === null) missing.push('ISO');
  if (missing.length > 0 || aperture === null || shutter === null || iso === null) {
    return { ok: false, missing };
  }
  const model = typeof parsed?.Model === 'string' ? parsed.Model.trim() : '';
  return { ok: true, exposure: { aperture, shutter, iso, model, focal: positive(parsed?.FocalLength) } };
}

/**
 * Browser-only: parse the file with exifr, loaded on demand. A format exifr
 * does not understand (SVG, WebP without EXIF) throws inside the library;
 * that is the same answer as "no tags", so it is caught and reported as such.
 */
export async function readExposure(file: File): Promise<ExposureRead> {
  const exifr = (await import('exifr')).default;
  const parsed = (await exifr
    .parse(file, { pick: ['FNumber', 'ExposureTime', 'ISO', 'FocalLength', 'Model'] })
    .catch(() => null)) as PickedExif | null | undefined;
  return exposureFromExif(parsed);
}
