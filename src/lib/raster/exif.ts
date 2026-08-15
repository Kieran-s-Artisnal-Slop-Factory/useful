/**
 * EXIF metadata mapping for the raster editor.
 *
 * Reading uses `exifr` (any format it understands); WRITING is scoped to JPEG
 * export via `piexifjs` as a v1 decision — PNG has an eXIf chunk but library
 * support for writing it is thin. Canvas re-encoding strips all metadata by
 * default, so the editable fields below are the ONLY metadata an export can
 * carry, and GPS is never among them.
 *
 * The pure mapping/formatting helpers live up top (unit-tested in node); the
 * piexifjs embed step is browser-only and lives at the bottom.
 */
import { dataUrlToBlob } from '../exportFile';

/** The common JPEG tags the editor lets the user edit (plan §3.2.3). */
export interface ExifEditFields {
  artist: string;
  copyright: string;
  /** ImageDescription. */
  description: string;
  /** datetime-local input value ('YYYY-MM-DDTHH:MM[:SS]') or ''. */
  date: string;
}

// EXIF tag numbers (TIFF 6.0 / EXIF 2.3).
export const TAG = {
  ImageDescription: 270,
  Artist: 315,
  Copyright: 33432,
  DateTime: 306,
  DateTimeOriginal: 36867,
  DateTimeDigitized: 36868,
} as const;

/**
 * 'YYYY-MM-DDTHH:MM[:SS]' (datetime-local) → EXIF 'YYYY:MM:DD HH:MM:SS'.
 * Returns null for anything unparseable — the field is then simply omitted.
 */
export function formatExifDate(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!m) return null;
  return `${m[1]}:${m[2]}:${m[3]} ${m[4]}:${m[5]}:${m[6] ?? '00'}`;
}

/** EXIF 'YYYY:MM:DD HH:MM:SS' (or a Date) → datetime-local input value. */
export function toDateInputValue(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const p = (n: number): string => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())}T${p(value.getHours())}:${p(value.getMinutes())}`;
  }
  if (typeof value === 'string') {
    const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2})/.exec(value.trim());
    if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`;
  }
  return '';
}

/**
 * Build the piexifjs IFD dict for the edited fields. Empty fields are
 * omitted; the GPS IFD is always empty — stripping location data is the
 * point, so there is deliberately no way to carry it through.
 */
export function exifFieldsToDict(
  fields: ExifEditFields
): { '0th': Record<number, string>; Exif: Record<number, string>; GPS: Record<number, never> } {
  const zeroth: Record<number, string> = {};
  const exif: Record<number, string> = {};
  if (fields.artist.trim()) zeroth[TAG.Artist] = fields.artist.trim();
  if (fields.copyright.trim()) zeroth[TAG.Copyright] = fields.copyright.trim();
  if (fields.description.trim()) zeroth[TAG.ImageDescription] = fields.description.trim();
  const date = formatExifDate(fields.date);
  if (date) {
    zeroth[TAG.DateTime] = date;
    exif[TAG.DateTimeOriginal] = date;
    exif[TAG.DateTimeDigitized] = date;
  }
  return { '0th': zeroth, Exif: exif, GPS: {} };
}

/** True when at least one field would actually be embedded. */
export function hasEditedFields(fields: ExifEditFields): boolean {
  const dict = exifFieldsToDict(fields);
  return Object.keys(dict['0th']).length > 0 || Object.keys(dict.Exif).length > 0;
}

/**
 * JS string → binary string of its UTF-8 bytes. piexifjs writes strings
 * byte-per-charCode (latin1), but EXIF readers — exifr included — decode the
 * ASCII-typed tags as UTF-8, so a raw '©' (0xA9) would round-trip as U+FFFD.
 * Encoding to UTF-8 bytes first keeps non-ASCII artists/copyrights intact.
 */
export function utf8Binary(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let out = '';
  for (const b of bytes) out += String.fromCharCode(b);
  return out;
}

/** exifFieldsToDict with every string packed as UTF-8 bytes for piexifjs. */
export function exifFieldsToBinaryDict(
  fields: ExifEditFields
): Record<string, Record<number, string>> {
  const dict = exifFieldsToDict(fields);
  const pack = (ifd: Record<number, string>): Record<number, string> =>
    Object.fromEntries(Object.entries(ifd).map(([tag, v]) => [tag, utf8Binary(v)]));
  return { '0th': pack(dict['0th']), Exif: pack(dict.Exif), GPS: {} };
}

/**
 * Flatten an exifr parse result into displayable rows. Binary blobs and
 * nested structures are elided; long values are truncated — this is a
 * *viewer*, the source file keeps the originals.
 */
export function summarizeExif(parsed: Record<string, unknown> | null | undefined): {
  tag: string;
  value: string;
}[] {
  if (!parsed) return [];
  const rows: { tag: string; value: string }[] = [];
  for (const [tag, raw] of Object.entries(parsed)) {
    if (raw === undefined || raw === null) continue;
    let value: string;
    if (raw instanceof Date) value = Number.isNaN(raw.getTime()) ? '' : raw.toISOString();
    else if (typeof raw === 'number' || typeof raw === 'boolean' || typeof raw === 'string')
      value = String(raw);
    else if (Array.isArray(raw) && raw.every((v) => typeof v === 'number' || typeof v === 'string'))
      value = raw.slice(0, 8).join(', ') + (raw.length > 8 ? ', …' : '');
    else continue; // typed arrays, nested objects, thumbnails
    value = value.trim();
    if (!value) continue;
    if (value.length > 120) value = value.slice(0, 117) + '…';
    rows.push({ tag, value });
  }
  return rows.sort((a, b) => a.tag.localeCompare(b.tag));
}

// ---- browser-only below: piexifjs embed -------------------------------------

/**
 * Re-embed the edited fields into a canvas-encoded JPEG. Takes the canvas
 * directly (piexifjs works on data-URL strings, which toDataURL provides)
 * and returns a Blob ready for download.
 */
export async function encodeJpegWithExif(
  canvas: HTMLCanvasElement,
  quality1to100: number,
  fields: ExifEditFields
): Promise<Blob> {
  const piexif = (await import('piexifjs')).default;
  const q = Math.min(1, Math.max(0.01, Math.round(quality1to100) / 100));
  // Match encodeCanvas's convention: flatten transparency onto white — a bare
  // toDataURL('image/jpeg') would paint transparent areas black.
  const flat = document.createElement('canvas');
  flat.width = canvas.width;
  flat.height = canvas.height;
  const ctx = flat.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, flat.width, flat.height);
  ctx.drawImage(canvas, 0, 0);
  const dataUrl = flat.toDataURL('image/jpeg', q);
  const exifBytes = piexif.dump(exifFieldsToBinaryDict(fields));
  return dataUrlToBlob(piexif.insert(exifBytes, dataUrl));
}
