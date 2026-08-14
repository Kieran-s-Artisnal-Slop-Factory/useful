/**
 * Number-base conversion and bit-width operations (plan §4.1). All values are
 * BigInt because the 64-bit width exceeds Number's safe-integer range; the
 * canonical form everywhere is the UNSIGNED value in [0, 2^width) — signed
 * meaning is a per-display interpretation (two's complement), never separate
 * state.
 */

export type Base = 2 | 8 | 10 | 16;
export type BitWidth = 8 | 16 | 32 | 64;

export const BIT_WIDTHS: BitWidth[] = [8, 16, 32, 64];

export const BASE_LABELS: Record<Base, string> = {
  2: 'Binary',
  8: 'Octal',
  10: 'Decimal',
  16: 'Hexadecimal',
};

/** 2^width. */
export function span(width: BitWidth): bigint {
  return 1n << BigInt(width);
}

/** All-ones mask for the width. */
export function mask(width: BitWidth): bigint {
  return span(width) - 1n;
}

/** Largest unsigned value for the width. */
export function maxUnsigned(width: BitWidth): bigint {
  return mask(width);
}

/** Most negative signed (two's complement) value for the width. */
export function minSigned(width: BitWidth): bigint {
  return -(1n << BigInt(width - 1));
}

export type ParseResult = { ok: true; value: bigint } | { ok: false; error: string };

const DIGITS: Record<Base, RegExp> = {
  2: /^[01]+$/,
  8: /^[0-7]+$/,
  10: /^[0-9]+$/,
  16: /^[0-9a-f]+$/,
};

const PREFIXES: Record<Base, string | null> = { 2: '0b', 8: '0o', 10: null, 16: '0x' };

/**
 * Parse `text` as a number written in `base`, normalized to the unsigned
 * value in [0, 2^width). Accepts the matching prefix (0b/0o/0x), space and
 * underscore digit separators, and — for decimal only — a leading minus,
 * which is encoded as two's complement (so the accepted decimal range is
 * the union of signed and unsigned: [-2^(w-1), 2^w)).
 */
export function parseInBase(text: string, base: Base, width: BitWidth): ParseResult {
  let s = text.trim().toLowerCase().replaceAll(/[ _]/g, '');
  let negative = false;
  if (base === 10 && (s.startsWith('-') || s.startsWith('−'))) {
    negative = true;
    s = s.slice(1);
  }
  const prefix = PREFIXES[base];
  if (prefix && s.startsWith(prefix)) s = s.slice(prefix.length);
  if (s.length === 0) return { ok: false, error: 'Enter a number' };
  if (!DIGITS[base].test(s)) {
    return { ok: false, error: `Not a valid ${BASE_LABELS[base].toLowerCase()} number` };
  }
  // BigInt() accepts 0x/0o/0b prefixes; re-attach ours so all bases parse.
  const magnitude = BigInt((prefix ?? '') + s);
  if (negative) {
    if (-magnitude < minSigned(width)) {
      return { ok: false, error: `Below the signed ${width}-bit minimum (${minSigned(width)})` };
    }
    return { ok: true, value: toUnsigned(-magnitude, width) };
  }
  if (magnitude > maxUnsigned(width)) {
    return { ok: false, error: `Doesn't fit in ${width} bits (max ${formatValue(maxUnsigned(width), base)})` };
  }
  return { ok: true, value: magnitude };
}

/** Format without padding (used in messages). */
function formatValue(value: bigint, base: Base): string {
  const prefix = PREFIXES[base] ?? '';
  return prefix + value.toString(base);
}

/**
 * Format the unsigned `value` in `base`, zero-padded to the width: binary to
 * `width` digits, hex to width/4, octal to ceil(width/3); decimal is never
 * padded.
 */
export function formatInBase(value: bigint, base: Base, width: BitWidth): string {
  if (base === 10) return value.toString(10);
  const digits = base === 2 ? width : base === 16 ? width / 4 : Math.ceil(width / 3);
  return value.toString(base).padStart(digits, '0');
}

/** Group a digit string from the RIGHT for readability ("00000101" → "0000 0101"). */
export function groupDigits(digits: string, size: number): string {
  const groups: string[] = [];
  for (let end = digits.length; end > 0; end -= size) {
    groups.unshift(digits.slice(Math.max(0, end - size), end));
  }
  return groups.join(' ');
}

/** The signed (two's complement) reading of an unsigned value. */
export function toSigned(value: bigint, width: BitWidth): bigint {
  return value >= 1n << BigInt(width - 1) ? value - span(width) : value;
}

/** Unsigned representation of a (possibly negative) signed value. */
export function toUnsigned(value: bigint, width: BitWidth): bigint {
  return ((value % span(width)) + span(width)) % span(width);
}

/** Flip every bit within the width. One's complement IS bitwise NOT — both
 * names are exposed because the tool teaches them as separate ideas. */
export function onesComplement(value: bigint, width: BitWidth): bigint {
  return value ^ mask(width);
}

export const bitwiseNot = onesComplement;

/** Two's complement: flip the bits, add one (i.e. -value mod 2^width). */
export function twosComplement(value: bigint, width: BitWidth): bigint {
  return (onesComplement(value, width) + 1n) & mask(width);
}
