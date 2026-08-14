import { describe, expect, it } from 'vitest';
import { formatCountdown, formatElapsed, hmsToMs, msToHms, remainingMs } from './duration';

describe('hmsToMs / msToHms', () => {
  it('round-trips', () => {
    expect(msToHms(hmsToMs({ hours: 1, minutes: 2, seconds: 3 }))).toEqual({ hours: 1, minutes: 2, seconds: 3 });
    expect(hmsToMs({ hours: 0, minutes: 0, seconds: 0 })).toBe(0);
  });

  it('clamps negatives to zero', () => {
    expect(hmsToMs({ hours: 0, minutes: -5, seconds: 0 })).toBe(0);
    expect(msToHms(-100)).toEqual({ hours: 0, minutes: 0, seconds: 0 });
  });
});

describe('formatCountdown', () => {
  it('rounds UP so a running timer never shows 0:00 early', () => {
    expect(formatCountdown(1)).toBe('0:01');
    expect(formatCountdown(59_001)).toBe('1:00');
  });

  it('formats hours with padded minutes', () => {
    expect(formatCountdown(3_661_000)).toBe('1:01:01');
    expect(formatCountdown(0)).toBe('0:00');
  });
});

describe('formatElapsed', () => {
  it('shows tenths, rounding down', () => {
    expect(formatElapsed(0)).toBe('0:00.0');
    expect(formatElapsed(1_234)).toBe('0:01.2');
    expect(formatElapsed(3_600_000)).toBe('1:00:00.0');
  });
});

describe('remainingMs', () => {
  it('clamps at zero once the deadline passes', () => {
    const end = '2024-01-01T00:00:00.000Z';
    expect(remainingMs(end, Date.parse(end) - 5000)).toBe(5000);
    expect(remainingMs(end, Date.parse(end) + 5000)).toBe(0);
  });
});
