/**
 * Which binary response bodies can be shown in the page, and how.
 *
 * Phase 3 shipped binary bodies as a download and nothing else, on the
 * reasoning that "a viewer that renders arbitrary bytes is a decoder surface
 * nobody asked for". That was too broad. The browser already contains
 * decoders for images, PDF, video and audio — they are the same ones that run
 * on every page you visit — and refusing to use them means a JPEG endpoint
 * can only be checked by saving the file and opening it somewhere else, which
 * is exactly the friction the tool exists to remove.
 *
 * So the rules that keep it honest are narrower than "no viewer":
 *
 * 1. **The bytes decide, never the header.** `mediaFor` is fed the *sniffed*
 *    mime from [sniff.ts](../encode/sniff.ts), so a server calling its
 *    executable `image/png` gets a download like any other unrecognised
 *    binary. The `Content-Type` claim never reaches this module.
 * 2. **Only formats the browser really renders.** TIFF, HEIC and Matroska are
 *    all sniffable and none of them draw in Chrome or Firefox; offering a
 *    preview that comes up blank is worse than not offering one. Those get a
 *    named reason instead of a button.
 * 3. **Nothing renders until it is asked for.** The caller shows a button;
 *    the bytes stay bytes until it is pressed. An auto-playing 200 MB video
 *    on every response is not a viewer, it is an ambush.
 * 4. **PDF is the one that gets a frame.** A PDF is a program in a way a JPEG
 *    is not, so it renders in the same no-origin iframe a stranger's HTML
 *    does rather than in a bare `<embed>`.
 *
 * Pure module: no DOM, no state, no I/O.
 */

export type MediaKind = 'image' | 'pdf' | 'video' | 'audio';

export interface MediaOffer {
  kind: MediaKind;
  /** Text for the button that reveals it. */
  label: string;
  /** What the element is called for a screen reader. */
  title: string;
}

/**
 * Formats the `<img>` element draws. TIFF, HEIC and HEIF are deliberately
 * absent — they sniff cleanly and no mainstream browser paints them.
 */
const IMAGE: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/x-icon',
  'image/svg+xml',
];

/** Containers `<video>` plays. Matroska is not one of them, WebM aside. */
const VIDEO: readonly string[] = ['video/mp4', 'video/webm', 'video/ogg'];

/** Containers `<audio>` plays. */
const AUDIO: readonly string[] = [
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/mp4',
  'audio/flac',
  'audio/webm',
  'audio/aac',
];

/**
 * Sniffable formats a browser will NOT render, and the reason. Saying "your
 * browser cannot draw a TIFF" is a fact the reader can act on; silently
 * offering only a download leaves them wondering whether the tool is the
 * thing that is broken.
 */
const UNRENDERABLE: Record<string, string> = {
  'image/tiff':
    'TIFF is a real image, but no mainstream browser draws one — there is nothing here that could render it. Download it and open it in an image viewer.',
  'image/heic':
    'HEIC only renders in Safari on Apple platforms; every other browser, this one included, has no decoder for it. Download it to open it.',
  'image/heif':
    'HEIF only renders in Safari on Apple platforms; every other browser, this one included, has no decoder for it. Download it to open it.',
  'video/x-matroska':
    'Matroska (.mkv) is not a format browsers play, even though WebM — which shares its container — is. Download it and open it in a player.',
};

/**
 * How this body could be shown, or `null` when it cannot be.
 *
 * `mime` must be the SNIFFED type. Passing a `Content-Type` header through
 * here would hand a stranger the choice of which decoder runs on their bytes,
 * which is the whole thing decision 5 of the plan exists to prevent.
 */
export function mediaFor(mime: string | null): MediaOffer | null {
  if (mime === null) return null;
  const type = mime.toLowerCase();
  if (IMAGE.includes(type)) return { kind: 'image', label: 'Show image', title: 'Response image' };
  if (type === 'application/pdf') {
    return { kind: 'pdf', label: 'Show PDF', title: 'Response PDF' };
  }
  if (VIDEO.includes(type)) return { kind: 'video', label: 'Play video', title: 'Response video' };
  if (AUDIO.includes(type)) return { kind: 'audio', label: 'Play audio', title: 'Response audio' };
  return null;
}

/**
 * Why a sniffed format that plainly *is* media still gets no preview. `null`
 * when there is nothing special to say — a ZIP has no viewer for reasons
 * nobody needs explained.
 */
export function unrenderableReason(mime: string | null): string | null {
  if (mime === null) return null;
  return UNRENDERABLE[mime.toLowerCase()] ?? null;
}

/**
 * What to warn about before the preview mounts, or `null` for "nothing worth
 * saying". Only size earns a warning: everything else about these formats is
 * the browser's own business, but decoding a 40 MB image is the reader's
 * machine doing real work, and they should get to decide.
 */
export function mediaCaution(kind: MediaKind, byteLength: number): string | null {
  const mb = byteLength / (1024 * 1024);
  if (kind === 'image' && mb >= 8) {
    return `This is a ${mb.toFixed(1)} MB image — decoding it will hold the page up for a moment and use a good deal of memory.`;
  }
  if ((kind === 'video' || kind === 'audio') && mb >= 64) {
    return `This is a ${mb.toFixed(1)} MB file, held whole in memory. Playing it here works, but downloading it is kinder to the machine.`;
  }
  return null;
}
