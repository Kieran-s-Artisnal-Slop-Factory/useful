/**
 * Binary operations that show their working (0.4.0 plan, Phase 1). Every
 * function here returns the answer AND the steps that produced it, at the
 * chosen bit width, wrapping the way the hardware wraps and saying when it
 * did.
 *
 * It sits on the bigint plumbing in [numberBase.ts](./numberBase.ts) and keeps
 * its convention: the canonical form of a value is the UNSIGNED number in
 * [0, 2^width), and signed meaning is an interpretation of those same bits,
 * never separate state. `signed` therefore changes the RESULT BITS of division
 * and modulo only — everywhere else it changes how the answer is read, not
 * what it is.
 *
 * The trace contract, which the unit tests hold to:
 *
 *  - `steps` is never empty, and `steps.at(-1).value === result`.
 *  - `value` on each step is the answer as it stands after that step.
 *  - `emit`, where present, is the one bit of the running answer that step
 *    decided. For the operations where every step emits, OR-ing the emitted
 *    bits together reproduces the answer — which is what keeps the drawing
 *    honest by construction rather than by inspection.
 */

import {
  formatInBase,
  mask,
  maxUnsigned,
  minSigned,
  toSigned,
  toUnsigned,
  type BitWidth,
} from './numberBase';

export type BinaryOp =
  | 'add'
  | 'subtract'
  | 'multiply'
  | 'divide'
  | 'modulo'
  | 'and'
  | 'or'
  | 'xor'
  | 'shl'
  | 'shr'
  | 'sar';

export interface OpDef {
  id: BinaryOp;
  /** Menu label. */
  label: string;
  /** How the operation is written in C-family languages. */
  symbol: string;
  /** True when the second operand is a shift COUNT rather than a value. */
  countsBits?: boolean;
  /** True when `signed` changes the result bits, not just the reading. */
  signedMatters?: boolean;
}

export const BINARY_OPS: OpDef[] = [
  { id: 'add', label: 'Add', symbol: '+' },
  { id: 'subtract', label: 'Subtract', symbol: '−' },
  { id: 'multiply', label: 'Multiply', symbol: '×' },
  { id: 'divide', label: 'Divide', symbol: '/', signedMatters: true },
  { id: 'modulo', label: 'Modulo (remainder)', symbol: '%', signedMatters: true },
  { id: 'and', label: 'Bitwise AND', symbol: '&' },
  { id: 'or', label: 'Bitwise OR', symbol: '|' },
  { id: 'xor', label: 'Bitwise XOR', symbol: '^' },
  { id: 'shl', label: 'Shift left', symbol: '<<', countsBits: true },
  { id: 'shr', label: 'Shift right (logical)', symbol: '>>>', countsBits: true },
  { id: 'sar', label: 'Shift right (arithmetic)', symbol: '>>', countsBits: true },
];

export const OP_BY_ID: Record<BinaryOp, OpDef> = Object.fromEntries(
  BINARY_OPS.map((op) => [op.id, op])
) as Record<BinaryOp, OpDef>;

export interface TraceRow {
  label: string;
  /** MSB-first, exactly `width` characters: '0', '1', or ' ' for undecided. */
  bits: string;
  /** Bits that fell off the TOP of the width, MSB-first. Drawn left, muted. */
  lostHigh?: string;
  /** Bits that fell off the BOTTOM. Drawn right, muted. */
  lostLow?: string;
  /** Short trailing note about this row. */
  note?: string;
}

export interface TraceStep {
  /** One sentence describing this step. The description IS the explanation —
   *  the highlight is decoration, and a screen reader gets this instead. */
  text: string;
  /** Bit positions (0 = least significant) this step works on. */
  focus: number[];
  /** The table as it stands after this step. */
  rows: TraceRow[];
  /** The answer so far, unsigned within the width. */
  value: bigint;
  /** The single bit of the running answer this step decided, when it decided one. */
  emit?: { index: number; bit: 0 | 1 };
}

export type FlagId =
  | 'carry'
  | 'borrow'
  | 'overflow'
  | 'truncated'
  | 'shifted-out'
  | 'undefined-in-c';

export interface TraceFlag {
  id: FlagId;
  label: string;
  on: boolean;
  /** What the flag means for THESE operands, not in general. */
  text: string;
}

export interface Trace {
  op: BinaryOp;
  width: BitWidth;
  signed: boolean;
  /** Operands as unsigned values in the width. */
  a: bigint;
  b: bigint;
  /** The answer, unsigned in the width. */
  result: bigint;
  /** One or two sentences about the operation as a whole. */
  summary: string;
  steps: TraceStep[];
  flags: TraceFlag[];
}

export type OpResult = { ok: true; trace: Trace } | { ok: false; error: string };

// --- bit helpers ----------------------------------------------------------

/** `value` as exactly `count` binary digits, MSB-first. */
function padBits(value: bigint, count: number): string {
  if (count <= 0) return '';
  return value.toString(2).padStart(count, '0').slice(-count);
}

function bitsOf(value: bigint, width: BitWidth): string {
  return formatInBase(value & mask(width), 2, width);
}

function blank(width: BitWidth): string[] {
  return Array.from({ length: width }, () => ' ');
}

/** Write one character into a MSB-first char array by BIT index (0 = LSB). */
function setBit(chars: string[], width: BitWidth, index: number, char: string): void {
  chars[width - 1 - index] = char;
}

function bitAt(value: bigint, index: number): bigint {
  return (value >> BigInt(index)) & 1n;
}

function maxSigned(width: BitWidth): bigint {
  return (1n << BigInt(width - 1)) - 1n;
}

/** How a value reads in the base a person is most likely checking against. */
function shown(value: bigint, width: BitWidth): string {
  return `0x${formatInBase(value, 16, width)} (${value})`;
}

// --- add / subtract -------------------------------------------------------

function traceAdd(a: bigint, b: bigint, width: BitWidth): Trace {
  const aBits = bitsOf(a, width);
  const bBits = bitsOf(b, width);
  const carryRow = blank(width);
  const sumRow = blank(width);
  const steps: TraceStep[] = [];

  let carry = 0n;
  let value = 0n;

  for (let i = 0; i < width; i++) {
    const ai = bitAt(a, i);
    const bi = bitAt(b, i);
    const carryIn = carry;
    const total = ai + bi + carryIn;
    const bit = total & 1n;
    carry = total >> 1n;

    setBit(carryRow, width, i, String(carryIn));
    setBit(sumRow, width, i, String(bit));
    if (bit === 1n) value |= 1n << BigInt(i);

    let text =
      `Bit ${i}: ${ai} + ${bi} + carry ${carryIn} = ${total} in binary ${padBits(total, 2)}` +
      ` — write ${bit}, carry ${carry}.`;
    if (i === width - 1) {
      text +=
        carry === 1n
          ? ` That last carry has nowhere to go in ${width} bits, so it is lost: the answer wrapped.`
          : ' Nothing carried out of the top bit.';
    }

    steps.push({
      text,
      focus: [i],
      rows: [
        { label: 'carry in', bits: carryRow.join('') },
        { label: 'a', bits: aBits },
        { label: 'b', bits: bBits },
        { label: 'sum', bits: sumRow.join('') },
      ],
      value,
      emit: { index: i, bit: bit === 1n ? 1 : 0 },
    });
  }

  const carryOut = carry === 1n;
  const sa = toSigned(a, width);
  const sb = toSigned(b, width);
  const signedOverflow = sa + sb !== toSigned(value, width);

  return {
    op: 'add',
    width,
    signed: false,
    a,
    b,
    result: value,
    summary:
      `Add right to left, one column at a time, carrying into the next. ` +
      `Carry and signed overflow are two different questions about the same bits: ` +
      `carry asks whether the UNSIGNED answer fit, overflow asks whether the SIGNED one did.`,
    steps,
    flags: [
      {
        id: 'carry',
        label: 'Carry out',
        on: carryOut,
        text: carryOut
          ? `Unsigned, ${a} + ${b} is ${a + b}, past the ${width}-bit ceiling of ${maxUnsigned(width)}. The top carry was dropped, so the answer wrapped to ${value}.`
          : `Unsigned, ${a} + ${b} = ${a + b}, which fits in ${width} bits. Nothing carried out.`,
      },
      {
        id: 'overflow',
        label: 'Signed overflow',
        on: signedOverflow,
        text: signedOverflow
          ? `Signed, ${sa} + ${sb} is ${sa + sb}, outside ${minSigned(width)} … ${maxSigned(width)}. The bits now read ${toSigned(value, width)} — a positive answer that came out negative, or the reverse.`
          : `Signed, ${sa} + ${sb} = ${toSigned(value, width)}, inside ${minSigned(width)} … ${maxSigned(width)}. No signed overflow.`,
      },
    ],
  };
}

function traceSubtract(a: bigint, b: bigint, width: BitWidth): Trace {
  const aBits = bitsOf(a, width);
  const bBits = bitsOf(b, width);
  const borrowRow = blank(width);
  const diffRow = blank(width);
  const steps: TraceStep[] = [];

  let borrow = 0n;
  let value = 0n;

  for (let i = 0; i < width; i++) {
    const ai = bitAt(a, i);
    const bi = bitAt(b, i);
    const borrowIn = borrow;
    let difference = ai - bi - borrowIn;
    const borrowed = difference < 0n;
    if (borrowed) difference += 2n;
    borrow = borrowed ? 1n : 0n;

    setBit(borrowRow, width, i, String(borrowIn));
    setBit(diffRow, width, i, String(difference));
    if (difference === 1n) value |= 1n << BigInt(i);

    let text = borrowed
      ? `Bit ${i}: ${ai} − ${bi} − borrow ${borrowIn} would go below zero, so borrow 1 from bit ${i + 1}: ${ai + 2n} − ${bi} − ${borrowIn} = ${difference}. Write ${difference}, borrow 1.`
      : `Bit ${i}: ${ai} − ${bi} − borrow ${borrowIn} = ${difference} — write ${difference}, no borrow.`;
    if (i === width - 1) {
      text += borrowed
        ? ` There is no bit ${width} to borrow from, so the answer wrapped.`
        : ' Nothing was borrowed past the top bit.';
    }

    steps.push({
      text,
      focus: [i],
      rows: [
        { label: 'borrow in', bits: borrowRow.join('') },
        { label: 'a', bits: aBits },
        { label: 'b', bits: bBits },
        { label: 'difference', bits: diffRow.join('') },
      ],
      value,
      emit: { index: i, bit: difference === 1n ? 1 : 0 },
    });
  }

  const borrowOut = borrow === 1n;
  const sa = toSigned(a, width);
  const sb = toSigned(b, width);
  const signedOverflow = sa - sb !== toSigned(value, width);

  return {
    op: 'subtract',
    width,
    signed: false,
    a,
    b,
    result: value,
    summary:
      'Subtract right to left, borrowing from the next column when a bit will not cover ' +
      'what is taken from it. A borrow out of the top is the unsigned answer going below ' +
      'zero; signed overflow is a different question about the same bits.',
    steps,
    flags: [
      {
        id: 'borrow',
        label: 'Borrow out',
        on: borrowOut,
        text: borrowOut
          ? `Unsigned, ${a} − ${b} is ${a - b}, below zero. Unsigned numbers have no below zero, so the answer wrapped to ${value}.`
          : `Unsigned, ${a} − ${b} = ${a - b}, at or above zero. Nothing was borrowed past the top.`,
      },
      {
        id: 'overflow',
        label: 'Signed overflow',
        on: signedOverflow,
        text: signedOverflow
          ? `Signed, ${sa} − ${sb} is ${sa - sb}, outside ${minSigned(width)} … ${maxSigned(width)}. The bits now read ${toSigned(value, width)}.`
          : `Signed, ${sa} − ${sb} = ${toSigned(value, width)}, inside ${minSigned(width)} … ${maxSigned(width)}. No signed overflow.`,
      },
    ],
  };
}

// --- multiply -------------------------------------------------------------

function traceMultiply(a: bigint, b: bigint, width: BitWidth): Trace {
  const aBits = bitsOf(a, width);
  const bBits = bitsOf(b, width);
  const partials: TraceRow[] = [];
  const steps: TraceStep[] = [];
  const productRow = blank(width);

  let value = 0n;

  const frame = (): TraceRow[] => [
    { label: 'a', bits: aBits },
    { label: 'b', bits: bBits },
    ...partials,
    { label: 'product', bits: productRow.join('') },
  ];

  const writeProduct = () => {
    const bits = bitsOf(value, width);
    for (let i = 0; i < width; i++) productRow[i] = bits[i]!;
  };

  writeProduct();

  for (let i = 0; i < width; i++) {
    const bi = bitAt(b, i);
    if (bi === 0n) {
      steps.push({
        text: `Bit ${i} of b is 0, so this row contributes nothing — shift-and-add only adds where the multiplier has a 1.`,
        focus: [i],
        rows: frame(),
        value,
      });
      continue;
    }

    const shifted = a << BigInt(i);
    const kept = shifted & mask(width);
    const lost = shifted >> BigInt(width);
    partials.push({
      label: `a << ${i}`,
      bits: bitsOf(kept, width),
      lostHigh: lost === 0n ? undefined : padBits(lost, i),
    });
    value = (value + kept) & mask(width);
    writeProduct();

    steps.push({
      text:
        `Bit ${i} of b is 1, so add ` +
        (i === 0
          ? 'a itself — the ones column needs no shift'
          : `a shifted left ${i} place${i === 1 ? '' : 's'}`) +
        ` — ${shown(kept, width)}` +
        `${lost !== 0n ? `, after the bits above bit ${width - 1} fell off` : ''}. ` +
        `Running product: ${shown(value, width)}.`,
      focus: [i],
      rows: frame(),
      value,
    });
  }

  const trueProduct = a * b;
  const truncated = trueProduct > maxUnsigned(width);
  const sa = toSigned(a, width);
  const sb = toSigned(b, width);
  const signedOverflow = sa * sb !== toSigned(value, width);

  return {
    op: 'multiply',
    width,
    signed: false,
    a,
    b,
    result: value,
    summary:
      'Shift and add: for every 1 in the multiplier, add the multiplicand shifted into that ' +
      "column, then total the rows. It is long multiplication with only two times tables, " +
      'which is why hardware likes it.',
    steps,
    flags: [
      {
        id: 'truncated',
        label: 'Bits dropped',
        on: truncated,
        text: truncated
          ? `Unsigned, ${a} × ${b} is ${trueProduct}, which needs ${trueProduct.toString(2).length} bits. Only the low ${width} were kept, so the answer is ${value}.`
          : `Unsigned, ${a} × ${b} = ${trueProduct}, which fits in ${width} bits. Nothing was dropped.`,
      },
      {
        id: 'overflow',
        label: 'Signed overflow',
        on: signedOverflow,
        text: signedOverflow
          ? `Signed, ${sa} × ${sb} is ${sa * sb}, outside ${minSigned(width)} … ${maxSigned(width)}. The bits now read ${toSigned(value, width)}.`
          : `Signed, ${sa} × ${sb} = ${toSigned(value, width)}, which fits. The same bits are the right answer either way.`,
      },
    ],
  };
}

// --- divide / modulo ------------------------------------------------------

/**
 * Restoring long division, one quotient bit per step, exactly as it is taught
 * on paper and close to how a divider without a fast path does it: shift the
 * remainder left, bring the next dividend bit down, subtract the divisor if it
 * fits, and record whether it did.
 *
 * Signed operands are divided as MAGNITUDES and given their signs back at the
 * end, which is what makes division truncate toward zero: −7 / 2 is −3, not
 * −4, and the remainder takes the sign of the dividend so that
 * `(a / b) * b + a % b == a` still holds.
 */
function traceDivide(
  a: bigint,
  b: bigint,
  width: BitWidth,
  signed: boolean,
  wantRemainder: boolean
): Trace {
  const op: BinaryOp = wantRemainder ? 'modulo' : 'divide';
  const sa = signed ? toSigned(a, width) : a;
  const sb = signed ? toSigned(b, width) : b;
  const magnitudeA = sa < 0n ? -sa : sa;
  const magnitudeB = sb < 0n ? -sb : sb;

  const dividendBits = padBits(magnitudeA, width);
  const divisorBits = padBits(magnitudeB, width);
  const quotientRow = blank(width);
  const steps: TraceStep[] = [];

  let remainder = 0n;
  let quotient = 0n;

  const negativeQuotient = (sa < 0n) !== (sb < 0n);
  const hasSignStep = signed && (sa < 0n || sb < 0n);

  /**
   * The loop's running answer is the MAGNITUDE, so a step's `emit` really is a
   * bit of the number that step just moved. The sign is a separate, visible
   * step at the end — which is both the honest trace and the thing that makes
   * truncation toward zero obvious.
   */
  const magnitudeSoFar = (): bigint => (wantRemainder ? remainder : quotient);
  const signedAnswer = (): bigint =>
    toUnsigned(
      wantRemainder
        ? sa < 0n
          ? -remainder
          : remainder
        : negativeQuotient
          ? -quotient
          : quotient,
      width
    );

  const frame = (): TraceRow[] => [
    { label: signed ? '|dividend|' : 'dividend', bits: dividendBits },
    { label: signed ? '|divisor|' : 'divisor', bits: divisorBits },
    { label: 'remainder', bits: padBits(remainder, width) },
    { label: 'quotient', bits: quotientRow.join('') },
  ];

  if (hasSignStep) {
    steps.push({
      text:
        `Read as signed, this is ${sa} ${wantRemainder ? '%' : '/'} ${sb}. Long division runs on the ` +
        `magnitudes ${magnitudeA} and ${magnitudeB}; the signs go back on at the end.`,
      focus: [],
      rows: frame(),
      value: magnitudeSoFar(),
    });
  }

  // Most significant bit first: this is the "bring down the next digit" loop.
  for (let i = width - 1; i >= 0; i--) {
    const brought = bitAt(magnitudeA, i);
    remainder = (remainder << 1n) | brought;
    const fits = remainder >= magnitudeB;
    if (fits) remainder -= magnitudeB;
    if (fits) quotient |= 1n << BigInt(i);
    setBit(quotientRow, width, i, fits ? '1' : '0');

    steps.push({
      text:
        `Bring down bit ${i} of the dividend (${brought}). ` +
        (fits
          ? `The remainder is now at least ${magnitudeB}, so the divisor goes in once: subtract it, leaving ${remainder}. Quotient bit ${i} is 1.`
          : `The remainder is still below ${magnitudeB}, so the divisor does not go in. Quotient bit ${i} is 0.`),
      focus: [i],
      rows: frame(),
      value: magnitudeSoFar(),
      emit: wantRemainder ? undefined : { index: i, bit: fits ? 1 : 0 },
    });
  }

  const magnitudeQuotient = quotient;
  const magnitudeRemainder = remainder;

  if (hasSignStep) {
    const signedQuotient = negativeQuotient ? -magnitudeQuotient : magnitudeQuotient;
    const signedRemainder = sa < 0n ? -magnitudeRemainder : magnitudeRemainder;
    steps.push({
      text: wantRemainder
        ? `Put the signs back: a remainder takes the sign of the DIVIDEND, so ${sa} % ${sb} is ${signedRemainder}. That is what keeps (a / b) × b + a % b equal to a.`
        : `Put the signs back: the operands have ${negativeQuotient ? 'different signs' : 'the same sign'}, so the quotient is ${signedQuotient}. Dividing the magnitudes is what makes division truncate TOWARD ZERO — ${sa} / ${sb} is ${signedQuotient}, not ${signedQuotient - (negativeQuotient && magnitudeRemainder !== 0n ? 1n : 0n)}.`,
      focus: [],
      rows: frame(),
      value: signedAnswer(),
    });
  }

  const result = signedAnswer();
  const quotientOverflows =
    signed && sa === minSigned(width) && sb === -1n && !wantRemainder;

  const flags: TraceFlag[] = [
    {
      id: 'overflow',
      label: 'Signed overflow',
      on: quotientOverflows,
      text: quotientOverflows
        ? `${minSigned(width)} / −1 is ${-minSigned(width)}, one past the signed ceiling of ${maxSigned(width)} — the single division that overflows. C calls it undefined; x86 raises the same fault as divide by zero. Here the bits wrap to ${toSigned(result, width)}.`
        : 'The answer fits. Division only overflows in one case: the most negative value divided by −1.',
    },
  ];

  return {
    op,
    width,
    signed,
    a,
    b,
    result,
    summary: wantRemainder
      ? 'The remainder is what long division leaves behind — the same trace as divide, read from the remainder register instead of the quotient.'
      : 'Restoring long division: shift the remainder left, bring the next dividend bit down, and subtract the divisor whenever it fits. One quotient bit per step.',
    steps,
    flags,
  };
}

// --- bitwise --------------------------------------------------------------

function traceBitwise(op: 'and' | 'or' | 'xor', a: bigint, b: bigint, width: BitWidth): Trace {
  const aBits = bitsOf(a, width);
  const bBits = bitsOf(b, width);
  const resultRow = blank(width);
  const steps: TraceStep[] = [];

  const apply = (x: bigint, y: bigint): bigint =>
    op === 'and' ? x & y : op === 'or' ? x | y : x ^ y;

  const rule: Record<typeof op, string> = {
    and: 'AND keeps a 1 only where BOTH operands have one',
    or: 'OR keeps a 1 where EITHER operand has one',
    xor: 'XOR keeps a 1 where the two operands DISAGREE',
  };

  let value = 0n;

  for (let i = 0; i < width; i++) {
    const ai = bitAt(a, i);
    const bi = bitAt(b, i);
    const bit = apply(ai, bi);
    setBit(resultRow, width, i, String(bit));
    if (bit === 1n) value |= 1n << BigInt(i);

    steps.push({
      text: `Bit ${i}: ${ai} ${OP_BY_ID[op].symbol} ${bi} = ${bit}.`,
      focus: [i],
      rows: [
        { label: 'a', bits: aBits },
        { label: 'b', bits: bBits },
        { label: 'result', bits: resultRow.join('') },
      ],
      value,
      emit: { index: i, bit: bit === 1n ? 1 : 0 },
    });
  }

  return {
    op,
    width,
    signed: false,
    a,
    b,
    result: value,
    summary: `${rule[op]}. Each column is decided on its own — no carries, no borrows, so the width never changes the answer for a given pair of columns.`,
    steps,
    flags: [],
  };
}

// --- shifts ---------------------------------------------------------------

function traceShift(op: 'shl' | 'shr' | 'sar', a: bigint, amount: bigint, width: BitWidth): Trace {
  const startBits = bitsOf(a, width);
  const steps: TraceStep[] = [];
  const signBit = bitAt(a, width - 1);

  let value = a & mask(width);
  let lostHigh = '';
  let lostLow = '';

  const frame = (): TraceRow[] => [
    { label: 'start', bits: startBits },
    {
      label: 'now',
      bits: bitsOf(value, width),
      lostHigh: lostHigh || undefined,
      lostLow: lostLow || undefined,
    },
  ];

  const tooFar = amount >= BigInt(width);
  const fill = op === 'sar' ? signBit : 0n;

  if (tooFar) {
    // Every bit leaves. One step, because a hundred identical steps teach nothing.
    const gone = bitsOf(a, width);
    value = op === 'sar' && signBit === 1n ? mask(width) : 0n;
    if (op === 'shl') lostHigh = gone;
    else lostLow = gone;
    steps.push({
      text:
        `Shifting a ${width}-bit value by ${amount} moves every bit out of the width. ` +
        (op === 'sar'
          ? `An arithmetic shift fills from the sign bit, so the answer is all ${signBit}s.`
          : 'Nothing is left but the fill, so the answer is zero.'),
      focus: [],
      rows: frame(),
      value,
    });
  } else if (amount === 0n) {
    steps.push({
      text: 'Shifting by zero moves nothing.',
      focus: [],
      rows: frame(),
      value,
    });
  } else {
    for (let n = 1n; n <= amount; n++) {
      if (op === 'shl') {
        const out = bitAt(value, width - 1);
        lostHigh += String(out);
        value = (value << 1n) & mask(width);
        steps.push({
          text: `Shift ${n}: every bit moves one place left. Bit ${width - 1} (${out}) falls off the top, and a 0 fills bit 0. Now ${shown(value, width)}.`,
          focus: [0, width - 1],
          rows: frame(),
          value,
        });
      } else {
        const out = bitAt(value, 0);
        lostLow = String(out) + lostLow;
        value = (value >> 1n) | (fill << BigInt(width - 1));
        steps.push({
          text:
            `Shift ${n}: every bit moves one place right. Bit 0 (${out}) falls off the bottom, and ` +
            (op === 'sar'
              ? `the sign bit ${signBit} is copied into bit ${width - 1} — that is what makes an arithmetic shift halve a negative number instead of turning it positive.`
              : `a 0 fills bit ${width - 1}.`) +
            ` Now ${shown(value, width)}.`,
          focus: [0, width - 1],
          rows: frame(),
          value,
        });
      }
    }
  }

  const droppedCount = (lostHigh + lostLow).length;
  const droppedOnes = [...(lostHigh + lostLow)].filter((c) => c === '1').length;

  const summaries: Record<typeof op, string> = {
    shl: 'A left shift by n multiplies by 2^n — until a bit reaches the top and leaves the width, which is exactly where the multiplication stops being true.',
    shr: 'A logical right shift feeds in zeros, so it divides an UNSIGNED value by 2^n, rounding down. On a value whose top bit is 1 it produces a large positive number instead, which is the trap.',
    sar: 'An arithmetic right shift copies the sign bit in, so a negative value stays negative. It rounds toward MINUS INFINITY, not toward zero — −1 >> 1 is −1, while −1 / 2 is 0.',
  };

  return {
    op,
    width,
    signed: false,
    a,
    b: amount,
    result: value,
    summary: summaries[op],
    steps,
    flags: [
      {
        id: 'shifted-out',
        label: 'Bits shifted out',
        on: droppedOnes > 0,
        text:
          droppedCount === 0
            ? 'Nothing left the width.'
            : droppedOnes > 0
              ? `${droppedCount} ${droppedCount === 1 ? 'bit' : 'bits'} left the width and ${droppedOnes === 1 ? 'one was a 1' : `${droppedOnes} of them were 1s`} — that information is gone, so shifting back does not undo this.`
              : `${droppedCount} ${droppedCount === 1 ? 'bit' : 'bits'} left the width, all of them 0s, so nothing was actually lost.`,
      },
      {
        id: 'undefined-in-c',
        label: 'Undefined in C',
        on: tooFar,
        text: tooFar
          ? `Shifting by ${amount} when the type is only ${width} bits wide is undefined behaviour in C and C++. Real CPUs disagree about it: x86 masks the count to the low ${width === 64 ? 6 : 5} bits, so it would shift by ${amount % BigInt(width)} instead, while ARM gives zero. The answer above is the mathematical one.`
          : `The shift count is below the ${width}-bit width, so this is well defined everywhere.`,
      },
    ],
  };
}

// --- entry point ----------------------------------------------------------

export interface RunOptions {
  width: BitWidth;
  /** Read the operands as two's complement. Changes the RESULT BITS of
   *  division and modulo only; elsewhere it changes the reading, not the bits. */
  signed?: boolean;
}

/**
 * Run `op` over two unsigned values in the width and return the answer with
 * its working. The only refusal is division by zero, which is refused with
 * words rather than answered with infinity.
 */
export function runOp(op: BinaryOp, a: bigint, b: bigint, options: RunOptions): OpResult {
  const width = options.width;
  const signed = options.signed ?? false;
  const x = a & mask(width);
  const y = b & mask(width);

  switch (op) {
    case 'add':
      return { ok: true, trace: traceAdd(x, y, width) };
    case 'subtract':
      return { ok: true, trace: traceSubtract(x, y, width) };
    case 'multiply':
      return { ok: true, trace: traceMultiply(x, y, width) };
    case 'divide':
    case 'modulo':
      if (y === 0n) {
        return {
          ok: false,
          error:
            'Divide by zero. There is no answer to give, so none is invented: a CPU raises a ' +
            'fault here (x86 calls it #DE) and the program stops. Only floating point has ' +
            'infinities, and this page deals in integers.',
        };
      }
      return { ok: true, trace: traceDivide(x, y, width, signed, op === 'modulo') };
    case 'and':
    case 'or':
    case 'xor':
      return { ok: true, trace: traceBitwise(op, x, y, width) };
    case 'shl':
    case 'shr':
    case 'sar':
      return { ok: true, trace: traceShift(op, x, y, width) };
  }
}
