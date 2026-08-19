import { describe, expect, it } from 'vitest';
import {
  leadingBlanks,
  MIN_SPAN_MINUTES,
  minuteFromOffset,
  MINUTES_PER_DAY,
  normalizeSpan,
  packOverlaps,
  timeLabel,
  weekdayOrder,
} from './timegrid';

describe('normalizeSpan', () => {
  it('gives a short or zero-length entry a minimum height', () => {
    expect(normalizeSpan({ startMin: 600, endMin: 600 })).toEqual({ startMin: 600, endMin: 600 + MIN_SPAN_MINUTES });
    expect(normalizeSpan({ startMin: 600, endMin: 605 })).toEqual({ startMin: 600, endMin: 615 });
  });

  it('clamps into the day', () => {
    expect(normalizeSpan({ startMin: -60, endMin: 30 })).toEqual({ startMin: 0, endMin: 30 });
    expect(normalizeSpan({ startMin: 1430, endMin: 2000 })).toEqual({ startMin: 1430, endMin: MINUTES_PER_DAY });
  });
});

describe('packOverlaps', () => {
  it('leaves entries that do not overlap full width', () => {
    const out = packOverlaps([
      { startMin: 540, endMin: 600 },
      { startMin: 660, endMin: 720 },
    ]);
    expect(out).toEqual([
      { column: 0, columns: 1 },
      { column: 0, columns: 1 },
    ]);
  });

  it('splits two overlapping entries in half, earlier one on the left', () => {
    const out = packOverlaps([
      { startMin: 600, endMin: 700 },
      { startMin: 630, endMin: 720 },
    ]);
    expect(out).toEqual([
      { column: 0, columns: 2 },
      { column: 1, columns: 2 },
    ]);
  });

  it('clusters transitively: A-B and B-C share one width, and A may reuse the column C uses', () => {
    // A and C never touch, but both touch B. The cluster must be sized as ONE
    // group (or B would be drawn over one of them), while A and C — which do
    // not overlap each other — may still share a column.
    const out = packOverlaps([
      { startMin: 600, endMin: 660 }, // A
      { startMin: 630, endMin: 750 }, // B
      { startMin: 700, endMin: 780 }, // C
    ]);
    expect(new Set(out.map((p) => p.columns)).size).toBe(1);
    expect(out[0]!.column).not.toBe(out[1]!.column); // A vs B overlap
    expect(out[1]!.column).not.toBe(out[2]!.column); // B vs C overlap
  });

  it('never puts two entries that overlap in the same column', () => {
    // The invariant that actually matters, over a fixed but awkward set.
    const spans = [
      { startMin: 540, endMin: 600 },
      { startMin: 545, endMin: 700 },
      { startMin: 560, endMin: 575 },
      { startMin: 600, endMin: 900 },
      { startMin: 610, endMin: 620 },
      { startMin: 880, endMin: 1000 },
      { startMin: 1200, endMin: 1260 },
    ];
    const out = packOverlaps(spans);
    const norm = spans.map(normalizeSpan);
    for (let i = 0; i < spans.length; i++) {
      for (let j = i + 1; j < spans.length; j++) {
        const overlap = norm[i]!.startMin < norm[j]!.endMin && norm[j]!.startMin < norm[i]!.endMin;
        if (overlap) {
          expect(
            out[i]!.column === out[j]!.column,
            `entries ${i} and ${j} overlap but share column ${out[i]!.column}`
          ).toBe(false);
        }
      }
      // A column index is always inside the width it was given.
      expect(out[i]!.column).toBeLessThan(out[i]!.columns);
    }
  });

  it('reuses a column once its entry has finished', () => {
    const out = packOverlaps([
      { startMin: 600, endMin: 660 },
      { startMin: 600, endMin: 780 },
      { startMin: 660, endMin: 720 }, // starts exactly when the first ends
    ]);
    // Three entries but only two columns: the third slots back into the first.
    expect(out.map((p) => p.columns)).toEqual([2, 2, 2]);
    expect(out[0]!.column).toBe(out[2]!.column);
  });

  it('puts the longer entry on the left when two start together', () => {
    const out = packOverlaps([
      { startMin: 600, endMin: 630 }, // short
      { startMin: 600, endMin: 900 }, // long
    ]);
    expect(out[1]!.column).toBe(0);
    expect(out[0]!.column).toBe(1);
  });

  it('returns one placement per input, in input order, however they are sorted', () => {
    const spans = [
      { startMin: 900, endMin: 960 },
      { startMin: 540, endMin: 600 },
      { startMin: 930, endMin: 990 },
    ];
    const out = packOverlaps(spans);
    expect(out).toHaveLength(3);
    expect(out[1]).toEqual({ column: 0, columns: 1 }); // the lone morning one
    expect(out[0]!.columns).toBe(2);
    expect(out[2]!.columns).toBe(2);
  });

  it('handles an empty list', () => {
    expect(packOverlaps([])).toEqual([]);
  });
});

describe('minuteFromOffset', () => {
  it('maps a fraction of the column to a snapped minute', () => {
    expect(minuteFromOffset(0, 1440)).toBe(0);
    expect(minuteFromOffset(720, 1440)).toBe(720); // midday
    expect(minuteFromOffset(540, 1440)).toBe(540);
  });

  it('snaps to the nearest quarter hour by default', () => {
    expect(minuteFromOffset(547, 1440)).toBe(540);
    expect(minuteFromOffset(553, 1440)).toBe(555);
    expect(minuteFromOffset(547, 1440, 30)).toBe(540);
    expect(minuteFromOffset(560, 1440, 60)).toBe(540);
  });

  it('clamps out-of-range offsets into the day', () => {
    expect(minuteFromOffset(-100, 1440)).toBe(0);
    expect(minuteFromOffset(9999, 1440)).toBe(MINUTES_PER_DAY - 15);
  });

  it('survives a zero-height column', () => {
    expect(minuteFromOffset(10, 0)).toBe(0);
  });
});

describe('timeLabel', () => {
  it('pads to HH:MM', () => {
    expect(timeLabel(0)).toBe('00:00');
    expect(timeLabel(540)).toBe('09:00');
    expect(timeLabel(1439)).toBe('23:59');
  });
});

describe('week start', () => {
  it('orders the weekdays from the chosen first day', () => {
    expect(weekdayOrder(0)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(weekdayOrder(1)).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });

  it('counts the blanks before the 1st for either start', () => {
    // A month starting on a Friday (5).
    expect(leadingBlanks(5, 0)).toBe(5); // Sun-start: Sun..Thu are blank
    expect(leadingBlanks(5, 1)).toBe(4); // Mon-start: Mon..Thu are blank
    // A month starting on Sunday (0).
    expect(leadingBlanks(0, 0)).toBe(0);
    expect(leadingBlanks(0, 1)).toBe(6); // a Monday-start week ends on Sunday
    // A month starting on Monday (1).
    expect(leadingBlanks(1, 0)).toBe(1);
    expect(leadingBlanks(1, 1)).toBe(0);
  });
});
