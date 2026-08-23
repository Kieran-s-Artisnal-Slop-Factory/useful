/**
 * Base64, once, for the whole app.
 *
 * `btoa` and `atob` are the platform's own base64 and both are traps. `btoa`
 * throws on any character above U+00FF, so `btoa('café')` is an exception and
 * `btoa(unescape(encodeURIComponent(s)))` — the recipe the internet still
 * hands out — leans on a function deprecated since ES3. `atob` is worse: fed
 * something that is not base64 it does not always throw, it returns whatever
 * it could make of the input, and mojibake that looks like data is far more
 * expensive than an error.
 *
 * So text goes through `TextEncoder`/`TextDecoder` (UTF-8, always) and every
 * decode is validated first, reporting the offset in the ORIGINAL string where
 * the input stopped being base64 — the one thing a person needs in order to
 * fix a pasted token.
 *
 * Pure module: no DOM, no state, no I/O.
 */

/** Thrown by every decode in this module. `offset` indexes the input string. */
export class Base64Error extends Error {
  readonly offset: number;

  constructor(message: string, offset: number) {
    super(message);
    this.name = 'Base64Error';
    this.offset = offset;
  }
}

export interface EncodeOptions {
  /** RFC 4648 §5 alphabet: `-` and `_` in place of `+` and `/`. */
  url?: boolean;
  /** Emit `=` padding. Defaults to true for standard, false for base64url. */
  pad?: boolean;
  /** Break the output every N characters (76 is MIME's). 0 or absent = one line. */
  wrap?: number;
}

const STD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** char code → 0-63, or undefined. Both alphabets, so a decode accepts either. */
const VALUES = (() => {
  const map = new Map<string, number>();
  for (let i = 0; i < STD.length; i += 1) map.set(STD[i]!, i);
  map.set('-', 62);
  map.set('_', 63);
  return map;
})();

/** ASCII code unit → 0-63 for both alphabets, -1 for anything else. Decode's fast path. */
const SIXBITS = (() => {
  const table = new Int8Array(128).fill(-1);
  for (const [ch, value] of VALUES) table[ch.charCodeAt(0)] = value;
  return table;
})();

/** The two alphabets as ASCII codes, for the encoder's byte buffer. */
const STD_CODES = Uint8Array.from(STD, (ch) => ch.charCodeAt(0));
const URL_CODES = Uint8Array.from(URL, (ch) => ch.charCodeAt(0));
const EQUALS = '='.charCodeAt(0);
/** Codes → string. Every code is ASCII, so latin1 is exact and fast. */
const ascii = new TextDecoder('latin1');

const encoder = new TextEncoder();
// fatal: a decode that cannot be UTF-8 must fail loudly rather than sprinkle
// U+FFFD through the result and call it text.
const decoder = new TextDecoder('utf-8', { fatal: true });

/* ---------------------------------------------------------------- encode --- */

export function encodeBytes(bytes: Uint8Array, options: EncodeOptions = {}): string {
  const alphabet = options.url ? URL_CODES : STD_CODES;
  const pad = options.pad ?? !options.url;
  // Into a byte buffer of ASCII codes, then one decode to a string: four
  // string concatenations per three bytes is what made a 2 MB image cost
  // twice what `btoa` does; this is on par with it.
  const codes = new Uint8Array(Math.ceil(bytes.length / 3) * 4);
  let n = 0;
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    codes[n++] = alphabet[b0 >> 2]!;
    codes[n++] = alphabet[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)]!;
    if (b1 === undefined) {
      if (pad) codes[n++] = EQUALS;
    } else {
      codes[n++] = alphabet[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)]!;
    }
    if (b2 === undefined) {
      if (pad) codes[n++] = EQUALS;
    } else {
      codes[n++] = alphabet[b2 & 0x3f]!;
    }
  }
  return wrapLines(ascii.decode(codes.subarray(0, n)), options.wrap ?? 0);
}

export function encodeText(text: string, options: EncodeOptions = {}): string {
  return encodeBytes(encoder.encode(text), options);
}

function wrapLines(text: string, width: number): string {
  if (width <= 0 || text.length <= width) return text;
  const out: string[] = [];
  for (let i = 0; i < text.length; i += width) out.push(text.slice(i, i + width));
  return out.join('\n');
}

/* ---------------------------------------------------------------- decode --- */

export interface Validation {
  ok: boolean;
  /** Plain-language reason, absent when ok. */
  message?: string;
  /** Index into the input string where the problem is, absent when ok. */
  offset?: number;
}

/**
 * Why this string is not base64, or that it is.
 *
 * Whitespace (including newlines, so wrapped MIME bodies work) is skipped.
 * Padding is allowed only at the end, and only in the amount the length
 * permits. A group of exactly one leftover character is impossible in base64 —
 * one character carries six bits and nothing is made of six bits — and that
 * case is the usual sign of a truncated copy/paste, so it is named as one.
 */
export function validate(input: string): Validation {
  let count = 0;
  let padding = 0;
  for (let i = 0; i < input.length; i += 1) {
    // Fast path first: nearly every character of real input is an ASCII
    // base64 character, and a regex per character over a 2 MB asset is
    // ~100 ms of pure overhead.
    const code = input.charCodeAt(i);
    if (code < 128 && SIXBITS[code]! >= 0) {
      if (padding > 0) {
        return { ok: false, message: 'Padding (=) must come last — this string continues after it.', offset: i };
      }
      count += 1;
      continue;
    }
    const ch = input[i]!;
    if (/\s/.test(ch)) continue;
    if (ch === '=') {
      padding += 1;
      if (padding > 2) return { ok: false, message: 'More than two padding characters (=).', offset: i };
      continue;
    }
    if (padding > 0) {
      return { ok: false, message: 'Padding (=) must come last — this string continues after it.', offset: i };
    }
    if (!VALUES.has(ch)) {
      // A control character has no printable form worth showing, so it is
      // named by code point instead: U+0000 beats an invisible gap.
      const code = ch.codePointAt(0)!;
      const shown =
        code < 0x20 || code === 0x7f
          ? `U+${code.toString(16).toUpperCase().padStart(4, '0')}`
          : `"${ch}"`;
      return { ok: false, message: `${shown} is not a base64 character.`, offset: i };
    }
    count += 1;
  }
  if (count === 0 && padding === 0) return { ok: true };
  const remainder = (count + padding) % 4;
  if (padding > 0 && remainder !== 0) {
    return { ok: false, message: 'Padded base64 must be a multiple of 4 characters long.', offset: input.length };
  }
  if (count % 4 === 1) {
    return {
      ok: false,
      message: 'Ends one character short — a base64 group cannot be a single character. The input looks truncated.',
      offset: input.length,
    };
  }
  return { ok: true };
}

export function isValid(input: string): boolean {
  return validate(input).ok;
}

/** Bytes from base64, either alphabet, padding optional. Throws `Base64Error`. */
export function decodeBytes(input: string): Uint8Array {
  const check = validate(input);
  if (!check.ok) throw new Base64Error(check.message ?? 'Not base64.', check.offset ?? 0);

  // `validate` has already rejected everything that is neither base64 nor
  // whitespace, so this loop can be a plain one: every code unit below 128 is
  // either a base64 character (the table knows its value), `=`, or ASCII
  // whitespace; anything at or above 128 can only be one of the Unicode
  // spaces `\s` accepts. Measured at 2 MB: a per-character regex and a
  // growing array cost 130 ms here; this costs 8 — the difference between a
  // notebook asset reopening instantly and visibly not.
  const out = new Uint8Array(decodedLength(input));
  let n = 0;
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    if (code >= 128) continue;
    const value = SIXBITS[code]!;
    if (value < 0) continue;
    buffer = ((buffer << 6) | value) & 0xffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[n++] = (buffer >> bits) & 0xff;
    }
  }
  return n === out.length ? out : out.subarray(0, n);
}

/** UTF-8 text from base64. Throws `Base64Error` for both failure modes. */
export function decodeText(input: string): string {
  const bytes = decodeBytes(input);
  try {
    return decoder.decode(bytes);
  } catch {
    throw new Base64Error('Decodes cleanly, but the bytes are not UTF-8 text.', 0);
  }
}

/* --------------------------------------------------------------- sizing --- */

/** How long the encoding of `byteLength` bytes will be. Base64 costs ~33%. */
export function encodedLength(byteLength: number, options: EncodeOptions = {}): number {
  const pad = options.pad ?? !options.url;
  const groups = Math.ceil(byteLength / 3);
  const chars = pad ? groups * 4 : Math.ceil((byteLength * 8) / 6);
  const wrap = options.wrap ?? 0;
  return wrap > 0 && chars > wrap ? chars + Math.floor((chars - 1) / wrap) : chars;
}

/** How many bytes a base64 string of this length decodes to (whitespace ignored). */
export function decodedLength(input: string): number {
  let count = 0;
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    if (code < 128 && SIXBITS[code]! >= 0) count += 1;
  }
  return Math.floor((count * 6) / 8);
}

/* ------------------------------------------------------------- data URLs --- */

export interface DataUrl {
  /** The media type, `text/plain` when the URL omitted one (RFC 2397 default). */
  mime: string;
  /** Parameters after the type, e.g. `charset=utf-8`. */
  parameters: string[];
  /** True when the payload was base64 rather than percent-encoded. */
  base64: boolean;
  bytes: Uint8Array;
}

const DATA_URL = /^data:([^,]*),([\s\S]*)$/;

/**
 * Parse a `data:` URL into its type and its bytes. Returns null when the
 * string is not a data URL at all; throws `Base64Error` when it is one and its
 * payload is broken, because those are different problems with different fixes.
 */
export function parseDataUrl(input: string): DataUrl | null {
  const match = DATA_URL.exec(input.trim());
  if (!match) return null;
  const meta = match[1]!.split(';').filter((p) => p !== '');
  const payload = match[2]!;
  const base64 = meta[meta.length - 1]?.toLowerCase() === 'base64';
  if (base64) meta.pop();
  const mime = meta[0] && meta[0].includes('/') ? meta.shift()! : 'text/plain';
  const bytes = base64 ? decodeBytes(payload) : encoder.encode(decodeURIComponent(payload));
  return { mime, parameters: meta, base64, bytes };
}

export function buildDataUrl(mime: string, bytes: Uint8Array): string {
  return `data:${mime};base64,${encodeBytes(bytes)}`;
}

/** Is this string a data URL? Cheap enough to call on every keystroke. */
export function looksLikeDataUrl(input: string): boolean {
  return /^\s*data:/i.test(input);
}
