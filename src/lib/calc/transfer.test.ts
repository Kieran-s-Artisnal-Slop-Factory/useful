import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  SIZE_UNITS,
  sizeUnitById,
  SPEED_UNITS,
  speedBothWays,
  speedUnitById,
  transferSeconds,
} from './transfer';

describe('unit tables', () => {
  it('sizes are decimal (KB = 1000 B)', () => {
    expect(sizeUnitById('KB')!.bytes).toBe(1e3);
    expect(sizeUnitById('MB')!.bytes).toBe(1e6);
    expect(sizeUnitById('GB')!.bytes).toBe(1e9);
    expect(sizeUnitById('TB')!.bytes).toBe(1e12);
    expect(SIZE_UNITS).toHaveLength(4);
  });

  it('speeds make bits vs bytes explicit', () => {
    expect(speedUnitById('Mbps')!.bitsPerSecond).toBe(1e6);
    expect(speedUnitById('Mbps')!.kind).toBe('bits');
    expect(speedUnitById('MBps')!.bitsPerSecond).toBe(8e6);
    expect(speedUnitById('MBps')!.kind).toBe('bytes');
    expect(speedUnitById('Gbps')!.bitsPerSecond).toBe(1e9);
    expect(speedUnitById('KBps')!.bitsPerSecond).toBe(8e3);
    expect(SPEED_UNITS).toHaveLength(5);
  });
});

describe('transferSeconds', () => {
  // Hand-computed across unit combinations (decimal units).
  it('1 GB over 100 Mbps takes 80 s', () => {
    expect(transferSeconds(1e9, 100e6)).toBeCloseTo(80);
  });

  it('1 GB over 100 MB/s takes 10 s (the bytes-vs-bits 8×)', () => {
    expect(transferSeconds(1e9, 100 * 8e6)).toBeCloseTo(10);
  });

  it('500 KB over 512 Kbps takes ~7.8 s', () => {
    expect(transferSeconds(500e3, 512e3)).toBeCloseTo((500e3 * 8) / 512e3, 6);
  });

  it('2 TB over 1 Gbps takes 16000 s', () => {
    expect(transferSeconds(2e12, 1e9)).toBeCloseTo(16_000);
  });

  it('overhead shrinks effective throughput', () => {
    expect(transferSeconds(1e9, 100e6, 10)).toBeCloseTo(80 / 0.9);
    expect(transferSeconds(1e9, 100e6, 0)).toBeCloseTo(80);
  });

  it('returns null on impossible inputs', () => {
    expect(transferSeconds(0, 1e6)).toBeNull();
    expect(transferSeconds(-1, 1e6)).toBeNull();
    expect(transferSeconds(1e6, 0)).toBeNull();
    expect(transferSeconds(1e6, 1e6, 100)).toBeNull();
    expect(transferSeconds(1e6, 1e6, -5)).toBeNull();
    expect(transferSeconds(NaN, 1e6)).toBeNull();
  });
});

describe('formatDuration', () => {
  it('formats across magnitudes', () => {
    expect(formatDuration(0.4)).toBe('0.4 s');
    expect(formatDuration(10)).toBe('10 s');
    expect(formatDuration(80)).toBe('1 min 20 s');
    expect(formatDuration(160)).toBe('2 min 40 s');
    expect(formatDuration(3600)).toBe('1 h');
    expect(formatDuration(3840)).toBe('1 h 4 min');
    expect(formatDuration(16_000)).toBe('4 h 27 min');
    expect(formatDuration(200_000)).toBe('2 d 8 h');
  });

  it('carries when the minor unit rounds up to a full major unit', () => {
    expect(formatDuration(7_170)).toBe('2 h'); // 1 h 59.5 min
    expect(formatDuration(119.6)).toBe('2 min');
  });

  it('never shows a misleading value for junk', () => {
    expect(formatDuration(NaN)).toBe('—');
    expect(formatDuration(-1)).toBe('—');
    expect(formatDuration(Infinity)).toBe('—');
  });
});

describe('speedBothWays', () => {
  it('spells the same rate in bits and bytes', () => {
    expect(speedBothWays(100e6)).toBe('100 Mbps = 12.5 MB/s');
    expect(speedBothWays(8e3)).toBe('8 Kbps = 1 KB/s');
    expect(speedBothWays(1e9)).toBe('1 Gbps = 125 MB/s');
  });
});
