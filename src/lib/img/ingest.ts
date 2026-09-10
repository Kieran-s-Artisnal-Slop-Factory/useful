/**
 * One way into the app for an image, whichever gesture delivered it — a file
 * picker, a drag-and-drop, or a paste (0.5.0 plan Phase 0, decision 5).
 *
 * Before this, every image tool grew its own `<input type="file">` handling
 * and none of them accepted a paste at all. The colour extractor is the first
 * consumer; the converter, resizer, compressor and editors can adopt it
 * without changing what they support, because the decode itself still goes
 * through `decodeToCanvas` in convert.ts — SVG rasterised, TIFF through
 * utif2, everything else through `createImageBitmap`.
 *
 * Refusals are typed and carry their own sentence: a caller shows
 * `result.message` and never has to phrase "that's not an image" itself.
 *
 * A CANVAS, not an ImageBitmap, is the payload. Everything downstream wants
 * pixels (`getImageData`) or wants to draw it somewhere, and a canvas is what
 * convert.ts already produces for all three input families.
 */
import { DecodeError, decodeToCanvas, detectKind, formatBytes } from './convert';

/** Ceiling on an accepted file. Generous — the palette sampler downsamples
 * hard before it looks at a pixel — but not unbounded, because decoding a
 * gigabyte of PNG onto a canvas takes the tab down with it. */
export const MAX_INGEST_BYTES = 50 * 1024 * 1024;

/** The parts of a `File` the pure helpers here actually read. */
export interface FileLike {
  name: string;
  type: string;
  size: number;
}

export type IngestRefusal = 'nothing-to-read' | 'not-an-image' | 'too-large' | 'undecodable';

export interface IngestedImage {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  /** Display name — a synthetic one for a paste, which carries no filename. */
  name: string;
  bytes: number;
  /** The MIME type the source claimed, or '' when it claimed none. */
  type: string;
}

export type IngestResult =
  | { ok: true; image: IngestedImage }
  | { ok: false; reason: IngestRefusal; message: string };

/**
 * The limit, stated as a round number of megabytes. Only ever used for the
 * ceiling itself — the file's OWN size is reported by `formatBytes`, because
 * rounding both produced "That image is 50 MB, over the 50 MB limit", which
 * reads as a bug in the app rather than a rule.
 */
const limitMb = (bytes: number): string => `${Math.round(bytes / (1024 * 1024))} MB`;

/**
 * The first entry that is an image this app can decode, or null.
 *
 * Deliberately first-match rather than "refuse when there are several": a
 * multi-file drop onto a single-image tool means "use this one", and picking
 * the first is what every other app does. Pure, so it is unit-tested against
 * plain objects.
 */
export function pickImage<T extends FileLike>(files: readonly T[]): T | null {
  for (const file of files) {
    if (detectKind(file.name, file.type) !== 'unsupported') return file;
  }
  return null;
}

/**
 * Why this file cannot be used, or null when it can. Split out from the
 * decode so the whole refusal ladder is testable without a browser.
 */
export function refusalFor(
  file: FileLike | null,
  maxBytes = MAX_INGEST_BYTES
): { reason: IngestRefusal; message: string } | null {
  if (file === null) {
    return {
      reason: 'nothing-to-read',
      message: 'No image here — pick a file, drop one, or paste one.',
    };
  }
  if (detectKind(file.name, file.type) === 'unsupported') {
    return {
      reason: 'not-an-image',
      message: `“${file.name || 'That file'}” is not an image this app can read. PNG, JPG, WebP, AVIF, TIFF and SVG all work.`,
    };
  }
  if (file.size > maxBytes) {
    return {
      reason: 'too-large',
      message: `That image is ${formatBytes(file.size)}, over the ${limitMb(maxBytes)} limit.`,
    };
  }
  return null;
}

/**
 * A name for a pasted image, which arrives with none. The subtype before any
 * `+` is the extension, so `image/svg+xml` becomes `pasted.svg` and not
 * `pasted.svgxml` — the name is shown to the user and used for a download.
 */
export function pastedName(type: string): string {
  const subtype = type.split('/')[1]?.split('+')[0] ?? '';
  const ext = subtype.replace(/[^a-z0-9]/gi, '') || 'png';
  return `pasted.${ext}`;
}

/* ----------------------------------------------------- browser pipeline --- */

/** Every file on a paste. Clipboard entries that are text have no file. */
export function filesFromPaste(event: ClipboardEvent): File[] {
  const items = event.clipboardData?.items;
  if (!items) return [];
  const files: File[] = [];
  for (const item of Array.from(items)) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return files;
}

/** Every file on a drop. */
export function filesFromDrop(event: DragEvent): File[] {
  return Array.from(event.dataTransfer?.files ?? []);
}

/**
 * Decode one already-chosen file. `svgWidth` is the raster width an SVG is
 * drawn at — it has no intrinsic pixels, so somebody has to choose.
 */
export async function ingestFile(file: File, svgWidth = 1024): Promise<IngestResult> {
  const refusal = refusalFor(file);
  if (refusal) return { ok: false, ...refusal };
  try {
    const decoded = await decodeToCanvas(file, svgWidth);
    return {
      ok: true,
      image: {
        canvas: decoded.canvas,
        width: decoded.width,
        height: decoded.height,
        name: file.name || pastedName(file.type),
        bytes: file.size,
        type: file.type,
      },
    };
  } catch (error) {
    return {
      ok: false,
      reason: 'undecodable',
      message:
        error instanceof DecodeError
          ? error.message
          : "This image couldn't be decoded — is the file corrupted?",
    };
  }
}

/** Pick the usable image out of a list, then decode it. */
export async function imageFromFiles(
  files: ArrayLike<File> | null | undefined,
  svgWidth = 1024
): Promise<IngestResult> {
  const list = files ? Array.from(files) : [];
  const chosen = pickImage(list);
  const refusal = refusalFor(chosen ?? (list[0] ?? null));
  if (refusal) return { ok: false, ...refusal };
  return ingestFile(chosen!, svgWidth);
}

/** An image off the clipboard, or a typed refusal. */
export async function imageFromPaste(
  event: ClipboardEvent,
  svgWidth = 1024
): Promise<IngestResult> {
  return imageFromFiles(filesFromPaste(event), svgWidth);
}

/** An image out of a drop, or a typed refusal. */
export async function imageFromDrop(event: DragEvent, svgWidth = 1024): Promise<IngestResult> {
  return imageFromFiles(filesFromDrop(event), svgWidth);
}
