/**
 * What kind of file is this, read from its first few bytes?
 *
 * A file extension is a claim and a `File.type` is the operating system's
 * guess from that claim; neither is evidence. Base64 has neither in the first
 * place — a pasted blob of characters carries no name at all — so the only
 * honest way to label decoded bytes is to look at them.
 *
 * The signatures below are the standard magic numbers. Each entry is a byte
 * pattern at an offset, where `null` means "any byte", which is what lets the
 * container formats (RIFF, ISO base media) be matched by their brand rather
 * than by their wrapper.
 *
 * Pure module: no DOM, no state, no I/O.
 */

export interface FileKind {
  mime: string;
  /** Extension WITHOUT the dot, for naming a download. */
  extension: string;
  /** What to call it on screen. */
  label: string;
}

interface Signature extends FileKind {
  offset: number;
  /** Byte values; `null` matches anything. */
  pattern: (number | null)[];
}

/** ASCII helper — the signatures read better as text than as hex. */
const ascii = (text: string): number[] => [...text].map((ch) => ch.charCodeAt(0));

const SIGNATURES: Signature[] = [
  {
    offset: 0,
    pattern: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    mime: 'image/png',
    extension: 'png',
    label: 'PNG image',
  },
  { offset: 0, pattern: [0xff, 0xd8, 0xff], mime: 'image/jpeg', extension: 'jpg', label: 'JPEG image' },
  { offset: 0, pattern: ascii('GIF87a'), mime: 'image/gif', extension: 'gif', label: 'GIF image' },
  { offset: 0, pattern: ascii('GIF89a'), mime: 'image/gif', extension: 'gif', label: 'GIF image' },
  // RIFF containers: the four bytes at 8 say which one.
  {
    offset: 8,
    pattern: ascii('WEBP'),
    mime: 'image/webp',
    extension: 'webp',
    label: 'WebP image',
  },
  { offset: 8, pattern: ascii('WAVE'), mime: 'audio/wav', extension: 'wav', label: 'WAV audio' },
  { offset: 0, pattern: ascii('BM'), mime: 'image/bmp', extension: 'bmp', label: 'BMP image' },
  {
    offset: 0,
    pattern: [0x49, 0x49, 0x2a, 0x00],
    mime: 'image/tiff',
    extension: 'tiff',
    label: 'TIFF image',
  },
  {
    offset: 0,
    pattern: [0x4d, 0x4d, 0x00, 0x2a],
    mime: 'image/tiff',
    extension: 'tiff',
    label: 'TIFF image',
  },
  {
    offset: 0,
    pattern: [0x00, 0x00, 0x01, 0x00],
    mime: 'image/x-icon',
    extension: 'ico',
    label: 'Icon',
  },
  // ISO base media: "ftyp" at 4, then the brand.
  { offset: 4, pattern: ascii('ftypavif'), mime: 'image/avif', extension: 'avif', label: 'AVIF image' },
  { offset: 4, pattern: ascii('ftypavis'), mime: 'image/avif', extension: 'avif', label: 'AVIF sequence' },
  { offset: 4, pattern: ascii('ftypheic'), mime: 'image/heic', extension: 'heic', label: 'HEIC image' },
  { offset: 4, pattern: ascii('ftypheix'), mime: 'image/heic', extension: 'heic', label: 'HEIC image' },
  { offset: 4, pattern: ascii('ftypmif1'), mime: 'image/heif', extension: 'heif', label: 'HEIF image' },
  { offset: 4, pattern: ascii('ftypisom'), mime: 'video/mp4', extension: 'mp4', label: 'MP4 video' },
  { offset: 4, pattern: ascii('ftypmp42'), mime: 'video/mp4', extension: 'mp4', label: 'MP4 video' },
  { offset: 4, pattern: ascii('ftypmp41'), mime: 'video/mp4', extension: 'mp4', label: 'MP4 video' },
  // The M4A brand carries a trailing space — the ISO brand field is four
  // bytes wide and "M4A" is three.
  { offset: 4, pattern: ascii('ftypM4A '), mime: 'audio/mp4', extension: 'm4a', label: 'M4A audio' },
  { offset: 0, pattern: ascii('%PDF-'), mime: 'application/pdf', extension: 'pdf', label: 'PDF document' },
  { offset: 0, pattern: [0x50, 0x4b, 0x03, 0x04], mime: 'application/zip', extension: 'zip', label: 'ZIP archive' },
  { offset: 0, pattern: [0x1f, 0x8b], mime: 'application/gzip', extension: 'gz', label: 'gzip archive' },
  { offset: 0, pattern: ascii('wOF2'), mime: 'font/woff2', extension: 'woff2', label: 'WOFF2 font' },
  { offset: 0, pattern: ascii('wOFF'), mime: 'font/woff', extension: 'woff', label: 'WOFF font' },
  { offset: 0, pattern: ascii('OggS'), mime: 'audio/ogg', extension: 'ogg', label: 'Ogg audio' },
  { offset: 0, pattern: ascii('ID3'), mime: 'audio/mpeg', extension: 'mp3', label: 'MP3 audio' },
  { offset: 0, pattern: ascii('fLaC'), mime: 'audio/flac', extension: 'flac', label: 'FLAC audio' },
];

/** The EBML header WebM and Matroska share; the DocType tells them apart. */
const EBML = [0x1a, 0x45, 0xdf, 0xa3];

function matches(bytes: Uint8Array, signature: Signature): boolean {
  const { offset, pattern } = signature;
  if (bytes.length < offset + pattern.length) return false;
  for (let i = 0; i < pattern.length; i += 1) {
    const expected = pattern[i];
    if (expected !== null && bytes[offset + i] !== expected) return false;
  }
  return true;
}

const decoder = new TextDecoder('utf-8', { fatal: false });

/**
 * The kind of file these bytes are, or null when nothing matches.
 *
 * SVG is the odd one out: it is XML, so it has no magic number, and the only
 * available evidence is that the text starts with an XML declaration, a
 * comment or an `<svg` tag. That check runs last, on the decoded head, so a
 * binary format can never be mistaken for it.
 */
export function sniff(bytes: Uint8Array): FileKind | null {
  for (const signature of SIGNATURES) {
    if (matches(bytes, signature)) {
      // RIFF containers share a header; only accept the branded ones if the
      // wrapper is really RIFF.
      if (signature.offset === 8 && !matches(bytes, { ...signature, offset: 0, pattern: ascii('RIFF') })) {
        continue;
      }
      return { mime: signature.mime, extension: signature.extension, label: signature.label };
    }
  }
  const ebml = sniffEbml(bytes);
  if (ebml) return ebml;
  if (looksLikeSvg(bytes)) return { mime: 'image/svg+xml', extension: 'svg', label: 'SVG image' };
  if (looksLikeText(bytes)) return { mime: 'text/plain', extension: 'txt', label: 'Text' };
  return null;
}

/**
 * WebM and Matroska share one magic number and differ only in the `DocType`
 * string a little further in, so this cannot be a plain signature row. The
 * DocType lives inside the EBML header, which is small — reading the first
 * 64 bytes for it is enough, and a file whose header does not name either one
 * is reported as Matroska, the container the magic number actually attests to.
 */
function sniffEbml(bytes: Uint8Array): FileKind | null {
  if (bytes.length < EBML.length) return null;
  for (let i = 0; i < EBML.length; i += 1) if (bytes[i] !== EBML[i]) return null;
  const header = decoder.decode(bytes.subarray(0, 64));
  if (header.includes('webm')) {
    return { mime: 'video/webm', extension: 'webm', label: 'WebM video' };
  }
  return { mime: 'video/x-matroska', extension: 'mkv', label: 'Matroska video' };
}

function head(bytes: Uint8Array, length = 512): string {
  return decoder.decode(bytes.subarray(0, length));
}

export function looksLikeSvg(bytes: Uint8Array): boolean {
  // A byte-order mark before the '<' is legal and invisible; strip it first.
  const text = head(bytes).trimStart().replace(/^\uFEFF/, '');
  if (!text.startsWith('<')) return false;
  return /^<(\?xml|!--|!DOCTYPE\s+svg|svg[\s>])/i.test(text);
}

/**
 * Text, by the rule every archiver uses: no NUL bytes, and nothing that
 * decodes to a replacement character in the first block.
 */
export function looksLikeText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  const block = bytes.subarray(0, 512);
  for (const byte of block) if (byte === 0) return false;
  return !head(bytes).includes('�');
}

/** Is this something a browser will draw in an `<img>`? */
export function isDisplayableImage(mime: string): boolean {
  return (
    mime === 'image/png' ||
    mime === 'image/jpeg' ||
    mime === 'image/gif' ||
    mime === 'image/webp' ||
    mime === 'image/avif' ||
    mime === 'image/bmp' ||
    mime === 'image/x-icon' ||
    mime === 'image/svg+xml'
  );
}
