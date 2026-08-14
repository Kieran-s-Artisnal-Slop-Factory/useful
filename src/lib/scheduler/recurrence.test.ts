import { describe, expect, it } from 'vitest';
import { describeRule, nextDueDate, weekdayOf } from './recurrence';

describe('nextDueDate — every N', () => {
  it('advances by days and weeks', () => {
    expect(nextDueDate({ kind: 'every', interval: 3, unit: 'days' }, '2024-01-30')).toBe('2024-02-02');
    expect(nextDueDate({ kind: 'every', interval: 2, unit: 'weeks' }, '2024-06-01')).toBe('2024-06-15');
  });

  it('clamps month-end instead of overflowing', () => {
    expect(nextDueDate({ kind: 'every', interval: 1, unit: 'months' }, '2024-01-31')).toBe('2024-02-29');
    expect(nextDueDate({ kind: 'every', interval: 1, unit: 'months' }, '2023-01-31')).toBe('2023-02-28');
    expect(nextDueDate({ kind: 'every', interval: 1, unit: 'months' }, '2024-03-31')).toBe('2024-04-30');
  });

  it('crosses year boundaries', () => {
    expect(nextDueDate({ kind: 'every', interval: 2, unit: 'months' }, '2024-11-30')).toBe('2025-01-30');
    expect(nextDueDate({ kind: 'every', interval: 1, unit: 'days' }, '2024-12-31')).toBe('2025-01-01');
  });

  it('treats bogus intervals as 1', () => {
    expect(nextDueDate({ kind: 'every', interval: 0, unit: 'days' }, '2024-06-01')).toBe('2024-06-02');
  });
});

describe('nextDueDate — weekdays', () => {
  // 2024-06-03 is a Monday.
  it('finds the next listed weekday, strictly after', () => {
    expect(nextDueDate({ kind: 'weekdays', days: [1, 3] }, '2024-06-03')).toBe('2024-06-05'); // Mon → Wed
    expect(nextDueDate({ kind: 'weekdays', days: [1] }, '2024-06-03')).toBe('2024-06-10'); // Mon → next Mon
    expect(nextDueDate({ kind: 'weekdays', days: [0] }, '2024-06-03')).toBe('2024-06-09'); // Mon → Sun
  });

  it('falls back to +1 day on an empty day list', () => {
    expect(nextDueDate({ kind: 'weekdays', days: [] }, '2024-06-03')).toBe('2024-06-04');
  });
});

describe('weekdayOf / describeRule', () => {
  it('computes weekdays', () => {
    expect(weekdayOf('2024-06-03')).toBe(1);
    expect(weekdayOf('2024-06-09')).toBe(0);
  });

  it('labels rules', () => {
    expect(describeRule({ kind: 'every', interval: 1, unit: 'days' })).toBe('every day');
    expect(describeRule({ kind: 'every', interval: 3, unit: 'weeks' })).toBe('every 3 weeks');
    expect(describeRule({ kind: 'weekdays', days: [3, 1] })).toBe('weekly on Mon, Wed');
  });
});
