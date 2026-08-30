import { describe, expect, it } from 'vitest';
import {
  BINARY_OPS,
  runOp,
  type BinaryOp,
  type Trace,
  type TraceStep,
} from './binaryOps';
import { mask, maxUnsigned, minSigned, toSigned, toUnsigned, type BitWidth } from './numberBase';
import { mulberry32 } from '../random';

const WIDTHS: BitWidth[] = [8, 16, 32, 64];
const ALL_OPS = BINARY_OPS.map((op) => op.id);

function trace(op: BinaryOp, a: bigint, b: bigint, width: BitWidth, signed = false): Trace {
  const result = runOp(op, a, b, { width, signed });
  if (!result.ok) throw new Error(result.error);
  return result.trace;
}

function value(op: BinaryOp, a: bigint, b: bigint, width: BitWidth, signed = false): bigint {
  return trace(op, a, b, width, signed).result;
}

/**
 * What the answer must be, worked out a completely different way: BigInt's own
 * arithmetic, which already has C's semantics for `/` (truncate toward zero),
 * `%` (sign of the dividend) and `>>` (arithmetic). The traces are checked
 * against this rather than against numbers copied out of their own output.
 */
function reference(
  op: BinaryOp,
  a: bigint,
  b: bigint,
  width: BitWidth,
  signed: boolean
): bigint {
  const m = mask(width);
  const sa = toSigned(a, width);
  const sb = toSigned(b, width);
  const wide = BigInt(width);
  switch (op) {
    case 'add':
      return (a + b) & m;
    case 'subtract':
      return (a - b) & m;
    case 'multiply':
      return (a * b) & m;
    case 'divide':
      return signed ? toUnsigned(sa / sb, width) : a / b;
    case 'modulo':
      return signed ? toUnsigned(sa % sb, width) : a % b;
    case 'and':
      return a & b;
    case 'or':
      return a | b;
    case 'xor':
      return a ^ b;
    case 'shl':
      return b >= wide ? 0n : (a << b) & m;
    case 'shr':
      return b >= wide ? 0n : a >> b;
    case 'sar':
      return b >= wide ? toUnsigned(sa < 0n ? -1n : 0n, width) : toUnsigned(sa >> b, width);
  }
}

/** Read one drawn row back into a number; a blank column is a bit not yet decided. */
function bitsToValue(bits: string): bigint {
  return BigInt(`0b${bits.replaceAll(' ', '0')}`);
}

/** The answer assembled from nothing but the bits the steps claim to have decided. */
function replayEmits(t: Trace): bigint {
  let out = 0n;
  for (const step of t.steps) {
    if (step.emit?.bit === 1) out |= 1n << BigInt(step.emit.index);
  }
  return out;
}

function flag(t: Trace, id: string): boolean {
  const found = t.flags.find((f) => f.id === id);
  if (!found) throw new Error(`no ${id} flag on a ${t.op} trace`);
  return found.on;
}

/** Every operand pair the generic sweep runs, per width. */
function vectors(width: BitWidth): [bigint, bigint][] {
  const top = maxUnsigned(width);
  const sign = 1n << BigInt(width - 1);
  const fixed: [bigint, bigint][] = [
    [0n, 0n],
    [0n, 1n],
    [1n, 0n],
    [1n, 1n],
    [5n, 3n],
    [3n, 5n],
    [top, 1n], // ripples a carry the whole width
    [top, top],
    [sign - 1n, 1n], // signed overflow with no carry
    [sign, 1n],
    [sign, top], // the most negative value
    [top, sign],
    [0b1010n & top, 0b0110n & top],
    [BigInt(width), 3n],
    [7n, BigInt(width)], // shift by exactly the width
    [7n, BigInt(width) + 1n], // and past it
  ];
  // A seeded sample so the sweep sees pairs nobody chose. Same seed, same
  // pairs, every run — the app's one PRNG, not Math.random.
  const random = mulberry32(20260830);
  const sampled: [bigint, bigint][] = [];
  for (let i = 0; i < 24; i++) {
    const pick = (): bigint => {
      let out = 0n;
      for (let chunk = 0; chunk < width; chunk += 16) {
        out = (out << 16n) | BigInt(Math.floor(random() * 65536));
      }
      return out & top;
    };
    sampled.push([pick(), pick()]);
  }
  return [...fixed, ...sampled];
}

describe('every operation, every width, against BigInt arithmetic', () => {
  for (const width of WIDTHS) {
    for (const op of ALL_OPS) {
      for (const signed of [false, true]) {
        it(`${op} at ${width} bits, ${signed ? 'signed' : 'unsigned'}`, () => {
          for (const [a, b] of vectors(width)) {
            const run = runOp(op, a, b, { width, signed });
            if ((op === 'divide' || op === 'modulo') && b === 0n) {
              expect(run.ok).toBe(false);
              continue;
            }
            expect(run.ok).toBe(true);
            if (!run.ok) return;
            expect(run.trace.result).toBe(reference(op, a, b, width, signed));
          }
        });
      }
    }
  }
});

describe('the trace is a faithful account of the answer', () => {
  for (const width of WIDTHS) {
    for (const op of ALL_OPS) {
      for (const signed of [false, true]) {
        it(`${op} at ${width} bits, ${signed ? 'signed' : 'unsigned'}`, () => {
          for (const [a, b] of vectors(width)) {
            if ((op === 'divide' || op === 'modulo') && b === 0n) continue;
            const t = trace(op, a, b, width, signed);
            const where = `${op} ${a} ${b} @${width}${signed ? ' signed' : ''}`;

            // Replaying the steps has to land on the answer, or the drawing is
            // a decoration rather than a derivation.
            expect(t.steps.length, where).toBeGreaterThan(0);
            expect(t.steps.at(-1)!.value, where).toBe(t.result);

            // Every value a step claims stays inside the width.
            for (const step of t.steps) {
              expect(step.value >= 0n && step.value <= mask(width), where).toBe(true);
            }

            // Every drawn row is exactly the width, in the alphabet the UI
            // renders. A ragged row is a bug the eye would not catch.
            for (const step of t.steps) {
              for (const row of step.rows) {
                expect(row.bits.length, `${where} row ${row.label}`).toBe(width);
                expect(/^[01 ]+$/.test(row.bits), `${where} row ${row.label}`).toBe(true);
              }
            }

            // Where every step decides one bit, those bits alone must add up
            // to the running answer at the end of the loop.
            const emitting = t.steps.filter((s) => s.emit);
            if (emitting.length === t.steps.length && emitting.length > 0) {
              expect(replayEmits(t), where).toBe(t.result);
              expect(new Set(emitting.map((s) => s.emit!.index)).size, where).toBe(width);
            }
          }
        });
      }
    }
  }
});

describe('add', () => {
  it('carries the whole way up', () => {
    const t = trace('add', 0xffn, 1n, 8);
    expect(t.result).toBe(0n);
    // Every column but the first carried into the next, and the carry row
    // says so — bit 0 can never be carried INTO, which is why it reads 0.
    const last = t.steps.at(-1)!;
    expect(last.rows.find((r) => r.label === 'carry in')!.bits).toBe('11111110');
    expect(last.rows.find((r) => r.label === 'sum')!.bits).toBe('00000000');
    expect(t.steps).toHaveLength(8);
  });

  /** The distinction the tool exists to teach, in the two cases that separate it. */
  it('tells carry and signed overflow apart', () => {
    const carried = trace('add', 0xffn, 1n, 8);
    expect(flag(carried, 'carry')).toBe(true);
    expect(flag(carried, 'overflow')).toBe(false); // -1 + 1 = 0, perfectly fine signed

    const overflowed = trace('add', 0x7fn, 1n, 8);
    expect(flag(overflowed, 'carry')).toBe(false); // 127 + 1 = 128 fits unsigned
    expect(flag(overflowed, 'overflow')).toBe(true); // 127 + 1 signed is -128
    expect(overflowed.result).toBe(0x80n);
    expect(toSigned(overflowed.result, 8)).toBe(-128n);

    const both = trace('add', 0x80n, 0x80n, 8);
    expect(flag(both, 'carry')).toBe(true);
    expect(flag(both, 'overflow')).toBe(true); // -128 + -128 = -256

    const neither = trace('add', 1n, 1n, 8);
    expect(flag(neither, 'carry')).toBe(false);
    expect(flag(neither, 'overflow')).toBe(false);
  });

  it('describes each column in words, not colour', () => {
    // 5 + 3: the carry ripples through three columns before a 1 is written.
    const t = trace('add', 0b0101n, 0b0011n, 8);
    expect(t.steps[0]!.text).toContain('Bit 0: 1 + 1 + carry 0 = 2');
    expect(t.steps[1]!.text).toContain('Bit 1: 0 + 1 + carry 1 = 2');
    expect(t.steps[0]!.emit).toEqual({ index: 0, bit: 0 });
    expect(t.steps[1]!.emit).toEqual({ index: 1, bit: 0 });
    expect(t.steps[2]!.emit).toEqual({ index: 2, bit: 0 });
    expect(t.steps[3]!.emit).toEqual({ index: 3, bit: 1 });
    expect(t.result).toBe(8n);
  });
});

describe('subtract', () => {
  it('borrows across a whole run of zeros', () => {
    const t = trace('subtract', 0x100n & mask(16), 1n, 16);
    expect(t.result).toBe(0xffn);
    expect(t.steps[0]!.text).toContain('borrow');
  });

  it('separates unsigned underflow from signed overflow', () => {
    const under = trace('subtract', 0n, 1n, 8);
    expect(under.result).toBe(0xffn);
    expect(flag(under, 'borrow')).toBe(true); // 0 - 1 unsigned wrapped
    expect(flag(under, 'overflow')).toBe(false); // signed 0 - 1 = -1, fine

    const over = trace('subtract', 0x80n, 1n, 8);
    expect(flag(over, 'borrow')).toBe(false); // 128 - 1 = 127 unsigned, fine
    expect(flag(over, 'overflow')).toBe(true); // -128 - 1 is -129
  });
});

describe('multiply', () => {
  it('adds one shifted partial product per set bit and no more', () => {
    const t = trace('multiply', 5n, 0b101n, 8); // 5 * 5 = 25
    expect(t.result).toBe(25n);
    const partials = t.steps.at(-1)!.rows.filter((r) => r.label.startsWith('a <<'));
    expect(partials.map((r) => r.label)).toEqual(['a << 0', 'a << 2']);
    // The drawn rows, added up, ARE the answer.
    const drawn = partials.reduce((sum, r) => sum + bitsToValue(r.bits), 0n) & mask(8);
    expect(drawn).toBe(t.result);
  });

  it('shows the high bits falling off when the product will not fit', () => {
    const t = trace('multiply', 0xffn, 0xffn, 8); // 65025, keeps 0x01
    expect(t.result).toBe(1n);
    expect(flag(t, 'truncated')).toBe(true);
    const partials = t.steps.at(-1)!.rows.filter((r) => r.label.startsWith('a <<'));
    expect(partials).toHaveLength(8);
    // a << 1 loses one bit, a << 7 loses seven.
    expect(partials[1]!.lostHigh).toBe('1');
    expect(partials[7]!.lostHigh).toHaveLength(7);
    expect(partials[0]!.lostHigh).toBeUndefined();
  });

  it('keeps the same bits right for a signed reading that fits', () => {
    const t = trace('multiply', toUnsigned(-3n, 8), 5n, 8);
    expect(toSigned(t.result, 8)).toBe(-15n);
    expect(flag(t, 'overflow')).toBe(false);
    expect(flag(t, 'truncated')).toBe(true); // 253 * 5 does not fit unsigned
  });

  it('says nothing was added for a zero multiplier bit', () => {
    const t = trace('multiply', 5n, 0b10n, 8);
    expect(t.steps[0]!.text).toContain('is 0');
    expect(t.steps[0]!.value).toBe(0n);
    expect(t.result).toBe(10n);
  });
});

describe('divide and modulo', () => {
  it('refuses division by zero with words rather than infinity', () => {
    for (const op of ['divide', 'modulo'] as const) {
      const run = runOp(op, 7n, 0n, { width: 8 });
      expect(run.ok).toBe(false);
      if (run.ok) return;
      expect(run.error).toContain('Divide by zero');
      expect(run.error).not.toContain('Infinity');
    }
  });

  it('produces one quotient bit per step, most significant first', () => {
    const t = trace('divide', 200n, 7n, 8);
    expect(t.result).toBe(28n);
    expect(t.steps).toHaveLength(8);
    expect(t.steps[0]!.emit!.index).toBe(7);
    expect(t.steps.at(-1)!.emit!.index).toBe(0);
    expect(replayEmits(t)).toBe(28n);
  });

  it('truncates signed division toward zero at every width, and says so', () => {
    for (const width of WIDTHS) {
      const minusSeven = toUnsigned(-7n, width);
      const quotient = trace('divide', minusSeven, 2n, width, true);
      // Toward zero gives -3. Toward minus infinity would give -4.
      expect(toSigned(quotient.result, width), `divide @${width}`).toBe(-3n);
      expect(quotient.steps.at(-1)!.text).toContain('TOWARD ZERO');

      const remainder = trace('modulo', minusSeven, 2n, width, true);
      // The remainder takes the sign of the dividend, so the identity holds.
      expect(toSigned(remainder.result, width), `modulo @${width}`).toBe(-1n);
      expect(-3n * 2n + -1n).toBe(-7n);
    }
  });

  it('divides unsigned when told to, which is a different answer entirely', () => {
    const unsigned = trace('divide', toUnsigned(-7n, 8), 2n, 8, false);
    expect(unsigned.result).toBe(124n); // 249 / 2
    const signed = trace('divide', toUnsigned(-7n, 8), 2n, 8, true);
    expect(toSigned(signed.result, 8)).toBe(-3n);
  });

  it('names the one division that overflows', () => {
    for (const width of WIDTHS) {
      const t = trace('divide', toUnsigned(minSigned(width), width), toUnsigned(-1n, width), width, true);
      expect(flag(t, 'overflow'), `@${width}`).toBe(true);
      expect(toSigned(t.result, width)).toBe(minSigned(width));
      const ordinary = trace('divide', 10n, toUnsigned(-1n, width), width, true);
      expect(flag(ordinary, 'overflow'), `@${width}`).toBe(false);
    }
  });

  it('runs the long division on magnitudes and applies the sign as its own step', () => {
    const t = trace('divide', toUnsigned(-7n, 8), 2n, 8, true);
    expect(t.steps[0]!.text).toContain('magnitudes 7 and 2');
    // The loop's running value is the magnitude; only the last step is signed.
    expect(t.steps.at(-2)!.value).toBe(3n);
    expect(toSigned(t.steps.at(-1)!.value, 8)).toBe(-3n);
    expect(replayEmits(t)).toBe(3n);
  });
});

describe('bitwise AND, OR, XOR', () => {
  it('decides each column on its own', () => {
    const a = 0b1100n;
    const b = 0b1010n;
    expect(value('and', a, b, 8)).toBe(0b1000n);
    expect(value('or', a, b, 8)).toBe(0b1110n);
    expect(value('xor', a, b, 8)).toBe(0b0110n);
  });

  it('draws one row per operand and one for the result', () => {
    const t = trace('xor', 0b1100n, 0b1010n, 8);
    expect(t.steps.at(-1)!.rows.map((r) => r.label)).toEqual(['a', 'b', 'result']);
    expect(t.steps.at(-1)!.rows[2]!.bits).toBe('00000110');
    expect(t.steps).toHaveLength(8);
    expect(t.flags).toEqual([]);
  });

  it('is width-independent for the columns that exist in both', () => {
    for (const width of WIDTHS) {
      expect(value('and', 0b1100n, 0b1010n, width)).toBe(0b1000n);
    }
  });
});

describe('shifts', () => {
  it('drops bits off the top going left and shows them', () => {
    const t = trace('shl', 0b1000_0001n, 1n, 8);
    expect(t.result).toBe(0b0000_0010n);
    expect(t.steps.at(-1)!.rows.find((r) => r.label === 'now')!.lostHigh).toBe('1');
    expect(flag(t, 'shifted-out')).toBe(true);
  });

  it('takes one step per place shifted', () => {
    expect(trace('shl', 1n, 3n, 8).steps).toHaveLength(3);
    expect(trace('shr', 0xffn, 5n, 8).steps).toHaveLength(5);
    expect(trace('shl', 1n, 0n, 8).steps).toHaveLength(1);
    expect(trace('shl', 1n, 0n, 8).steps[0]!.text).toContain('zero');
  });

  it('separates arithmetic from logical on a negative value', () => {
    const negative = toUnsigned(-8n, 8); // 1111 1000
    const logical = trace('shr', negative, 1n, 8);
    const arithmetic = trace('sar', negative, 1n, 8);
    expect(logical.result).toBe(0b0111_1100n); // 124 — the sign is gone
    expect(toSigned(logical.result, 8)).toBe(124n);
    expect(arithmetic.result).toBe(0b1111_1100n);
    expect(toSigned(arithmetic.result, 8)).toBe(-4n); // -8 / 2
    expect(arithmetic.steps[0]!.text).toContain('sign bit');
  });

  it('rounds an arithmetic shift toward minus infinity, unlike division', () => {
    const minusOne = toUnsigned(-1n, 8);
    expect(toSigned(value('sar', minusOne, 1n, 8), 8)).toBe(-1n);
    expect(toSigned(value('divide', minusOne, 2n, 8, true), 8)).toBe(0n);
  });

  it('shifts everything out in one step past the width, and names the C rule', () => {
    for (const width of WIDTHS) {
      const t = trace('shl', 0xffn, BigInt(width), width);
      expect(t.result, `@${width}`).toBe(0n);
      expect(t.steps, `@${width}`).toHaveLength(1);
      expect(flag(t, 'undefined-in-c'), `@${width}`).toBe(true);
      expect(t.flags.find((f) => f.id === 'undefined-in-c')!.text).toContain('undefined behaviour');

      // An arithmetic shift past the width fills with the sign bit instead.
      const negative = toUnsigned(-1n, width);
      expect(toSigned(value('sar', negative, BigInt(width) + 5n, width), width)).toBe(-1n);
      expect(value('shr', negative, BigInt(width) + 5n, width)).toBe(0n);
    }
  });

  it('is well defined below the width and says that too', () => {
    const t = trace('shl', 1n, 3n, 8);
    expect(flag(t, 'undefined-in-c')).toBe(false);
    expect(t.flags.find((f) => f.id === 'undefined-in-c')!.text).toContain('well defined');
  });

  it('reports nothing lost when only zeros left the width', () => {
    const t = trace('shl', 0b0000_0011n, 2n, 8);
    expect(t.result).toBe(0b0000_1100n);
    expect(flag(t, 'shifted-out')).toBe(false);
    expect(t.flags.find((f) => f.id === 'shifted-out')!.text).toContain('nothing was actually lost');
  });
});

describe('the operation catalogue', () => {
  it('has a unique id, a label and a symbol for each entry', () => {
    expect(new Set(ALL_OPS).size).toBe(BINARY_OPS.length);
    for (const op of BINARY_OPS) {
      expect(op.label).toMatch(/\S/);
      expect(op.symbol).toMatch(/\S/);
    }
  });

  it('marks exactly the operations whose second operand counts bits', () => {
    expect(BINARY_OPS.filter((o) => o.countsBits).map((o) => o.id)).toEqual([
      'shl',
      'shr',
      'sar',
    ]);
  });

  it('marks exactly the operations whose RESULT BITS depend on signedness', () => {
    expect(BINARY_OPS.filter((o) => o.signedMatters).map((o) => o.id)).toEqual([
      'divide',
      'modulo',
    ]);
    // And proves the claim: for everything else, the bits are the same either way.
    for (const width of WIDTHS) {
      for (const [a, b] of vectors(width)) {
        for (const op of ALL_OPS) {
          if (op === 'divide' || op === 'modulo') continue;
          expect(value(op, a, b, width, false), `${op} ${a} ${b} @${width}`).toBe(
            value(op, a, b, width, true)
          );
        }
      }
    }
  });
});

describe('every flag and step carries a sentence', () => {
  it('never leaves a description empty', () => {
    for (const width of WIDTHS) {
      for (const op of ALL_OPS) {
        const t = trace(op, 0b1011_0110n & mask(width), 3n, width, true);
        expect(t.summary, op).toMatch(/\S/);
        for (const step of t.steps as TraceStep[]) expect(step.text, op).toMatch(/\S/);
        for (const f of t.flags) {
          expect(f.label, `${op} ${f.id}`).toMatch(/\S/);
          expect(f.text, `${op} ${f.id}`).toMatch(/\S/);
        }
      }
    }
  });
});
