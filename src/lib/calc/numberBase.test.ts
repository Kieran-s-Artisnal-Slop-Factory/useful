import { describe, expect, it } from 'vitest';
import {
  bitwiseNot,
  formatInBase,
  groupDigits,
  maxUnsigned,
  minSigned,
  onesComplement,
  parseInBase,
  toSigned,
  toUnsigned,
  twosComplement,
  type Base,
  type BitWidth,
} from './numberBase';

function parsed(text: string, base: Base, width: BitWidth): bigint {
  const r = parseInBase(text, base, width);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

describe('parseInBase', () => {
  it('parses each base', () => {
    expect(parsed('101', 2, 8)).toBe(5n);
    expect(parsed('17', 8, 8)).toBe(15n);
    expect(parsed('42', 10, 8)).toBe(42n);
    expect(parsed('ff', 16, 8)).toBe(255n);
    expect(parsed('FF', 16, 8)).toBe(255n);
  });

  it('accepts prefixes and digit separators', () => {
    expect(parsed('0b1010', 2, 8)).toBe(10n);
    expect(parsed('0o17', 8, 8)).toBe(15n);
    expect(parsed('0xFF', 16, 8)).toBe(255n);
    expect(parsed('1111_0000', 2, 8)).toBe(240n);
    expect(parsed('1 000', 10, 16)).toBe(1000n);
  });

  it('encodes negative decimals as two\'s complement', () => {
    expect(parsed('-5', 10, 8)).toBe(251n);
    expect(parsed('-1', 10, 8)).toBe(255n);
    expect(parsed('-128', 10, 8)).toBe(128n);
    expect(parsed('-1', 10, 64)).toBe(maxUnsigned(64));
  });

  it('rejects junk, wrong-base digits, and empty input', () => {
    expect(parseInBase('', 10, 8).ok).toBe(false);
    expect(parseInBase('  ', 2, 8).ok).toBe(false);
    expect(parseInBase('102', 2, 8).ok).toBe(false);
    expect(parseInBase('8', 8, 8).ok).toBe(false);
    expect(parseInBase('g', 16, 8).ok).toBe(false);
    expect(parseInBase('1.5', 10, 8).ok).toBe(false);
    expect(parseInBase('-5', 16, 8).ok).toBe(false); // minus is decimal-only
  });

  it('enforces the width range on both ends', () => {
    expect(parseInBase('256', 10, 8).ok).toBe(false);
    expect(parsed('255', 10, 8)).toBe(255n);
    expect(parseInBase('-129', 10, 8).ok).toBe(false);
    expect(parseInBase('100000000', 2, 8).ok).toBe(false);
    expect(parseInBase('1' + '0'.repeat(64), 2, 64).ok).toBe(false);
    expect(parsed('f'.repeat(16), 16, 64)).toBe(maxUnsigned(64));
  });
});

describe('formatInBase', () => {
  it('pads binary/hex/octal to the width, never decimal', () => {
    expect(formatInBase(5n, 2, 8)).toBe('00000101');
    expect(formatInBase(5n, 16, 8)).toBe('05');
    expect(formatInBase(5n, 8, 8)).toBe('005');
    expect(formatInBase(5n, 10, 8)).toBe('5');
    expect(formatInBase(255n, 16, 16)).toBe('00ff');
    expect(formatInBase(0n, 2, 64)).toBe('0'.repeat(64));
    expect(formatInBase(maxUnsigned(64), 16, 64)).toBe('f'.repeat(16));
  });
});

describe('groupDigits', () => {
  it('groups from the right', () => {
    expect(groupDigits('00000101', 4)).toBe('0000 0101');
    expect(groupDigits('101', 4)).toBe('101');
    expect(groupDigits('10110', 4)).toBe('1 0110');
  });
});

describe('signed interpretation', () => {
  it('round-trips signed <-> unsigned', () => {
    expect(toSigned(251n, 8)).toBe(-5n);
    expect(toSigned(127n, 8)).toBe(127n);
    expect(toSigned(128n, 8)).toBe(-128n);
    expect(toSigned(maxUnsigned(64), 64)).toBe(-1n);
    expect(toUnsigned(-5n, 8)).toBe(251n);
    expect(toUnsigned(minSigned(16), 16)).toBe(32768n);
  });
});

describe('bit operations', () => {
  // Hand-computed table: width, value, NOT/one's, two's.
  const cases: [BitWidth, bigint, bigint, bigint][] = [
    [8, 5n, 250n, 251n],
    [8, 0n, 255n, 0n], // two's complement of 0 wraps to 0
    [8, 255n, 0n, 1n],
    [8, 128n, 127n, 128n], // -(-128) overflows back to itself
    [16, 1n, 65534n, 65535n],
    [32, 0xdeadbeefn, 0x21524110n, 0x21524111n],
    [64, 1n, maxUnsigned(64) - 1n, maxUnsigned(64)],
  ];

  it('one\'s complement / NOT flips every bit in the width', () => {
    for (const [w, v, not] of cases) {
      expect(onesComplement(v, w), `${v} @ ${w}`).toBe(not);
      expect(bitwiseNot(v, w)).toBe(not);
    }
  });

  it('two\'s complement is flip-plus-one (mod 2^w)', () => {
    for (const [w, v, , twos] of cases) {
      expect(twosComplement(v, w), `${v} @ ${w}`).toBe(twos);
    }
  });

  it('two\'s complement negates the signed reading', () => {
    for (const w of [8, 16, 32, 64] as BitWidth[]) {
      expect(toSigned(twosComplement(5n, w), w)).toBe(-5n);
      expect(toSigned(twosComplement(toUnsigned(-42n, w), w), w)).toBe(42n);
    }
  });
});
