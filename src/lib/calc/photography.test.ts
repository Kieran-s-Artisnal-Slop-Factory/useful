import { describe, expect, it } from 'vitest';
import {
  apertureStops,
  equivalentSettings,
  formatById,
  FORMATS,
  formatShutter,
  formatStops,
  isoStops,
  parseShutter,
  sensorStops,
  shutterStops,
  snapAperture,
  snapFocal,
  snapIso,
} from './photography';

describe('formats', () => {
  it('carries the plan\'s crop factors', () => {
    expect(formatById('mft')!.crop).toBe(2.0);
    expect(formatById('apsc')!.crop).toBe(1.5);
    expect(formatById('apsc-canon')!.crop).toBe(1.6);
    expect(formatById('ff')!.crop).toBe(1.0);
    expect(formatById('nope')).toBeNull();
    expect(FORMATS).toHaveLength(4);
  });
});

describe('equivalentSettings (total-light model)', () => {
  it('matches the plan\'s worked example: 20mm f/2.8 m4/3 ≈ 40mm f/5.6 at 4× ISO on FF', () => {
    const eq = equivalentSettings({ focal: 20, aperture: 2.8, iso: 200 }, 2.0, 1.0);
    expect(eq.focal).toBeCloseTo(40);
    expect(eq.aperture).toBeCloseTo(5.6);
    expect(eq.iso).toBeCloseTo(800);
  });

  it('is identity within the same format', () => {
    const s = { focal: 50, aperture: 1.8, iso: 400 };
    expect(equivalentSettings(s, 1.5, 1.5)).toEqual(s);
  });

  it('scales ISO by crop-ratio squared in both directions', () => {
    const toM43 = equivalentSettings({ focal: 50, aperture: 2.8, iso: 800 }, 1.0, 2.0);
    expect(toM43.focal).toBeCloseTo(25);
    expect(toM43.aperture).toBeCloseTo(1.4);
    expect(toM43.iso).toBeCloseTo(200);
  });
});

describe('stop math (exact, per the plan formulas)', () => {
  it('shutter: log2(t1/t2)', () => {
    expect(shutterStops(1 / 60, 1 / 125)).toBeCloseTo(Math.log2(125 / 60), 10);
    expect(shutterStops(1 / 125, 1 / 125)).toBe(0);
    expect(shutterStops(2, 1)).toBe(1);
  });

  it('ISO: log2(i1/i2)', () => {
    expect(isoStops(800, 100)).toBe(3);
    expect(isoStops(100, 200)).toBe(-1);
  });

  it('aperture: 2·log2(N1/N2)', () => {
    expect(apertureStops(2.8, 1.4)).toBeCloseTo(2, 10);
    expect(apertureStops(2, 2.8)).toBeCloseTo(-0.9709, 3); // nominal 2.8 is really 2^1.5
  });

  it('sensor: 2·log2(crop1/crop2) — m4/3 vs APS-C ≈ 0.83 stop by crop', () => {
    expect(sensorStops(2.0, 1.5)).toBeCloseTo(0.83, 2);
    expect(sensorStops(2.0, 1.0)).toBe(2);
    expect(sensorStops(1.6, 1.6)).toBe(0);
  });
});

describe('1/3-stop snapping', () => {
  it('snaps apertures to the nominal scale', () => {
    expect(snapAperture(5.657)).toBe(5.6); // exact 2^2.5
    expect(snapAperture(2.8)).toBe(2.8);
    expect(snapAperture(3.73)).toBe(3.5); // 2.8 × (2/1.5), closer to the 3.5 third
    expect(snapAperture(4.48)).toBe(4.5); // 2.8 × 1.6
    expect(snapAperture(1.0)).toBe(1.0);
    expect(snapAperture(32)).toBe(32);
  });

  it('falls back to the geometric value outside the table', () => {
    expect(snapAperture(0.7)).toBeCloseTo(0.71, 2);
    expect(snapAperture(45)).toBeCloseTo(45, 0);
    expect(Number.isNaN(snapAperture(0))).toBe(true);
  });

  it('snaps ISO to the nominal scale', () => {
    expect(snapIso(800)).toBe(800);
    expect(snapIso(355.6)).toBe(320); // 200 × (2/1.5)²
    expect(snapIso(512)).toBe(500);
    expect(snapIso(100 * 2 ** (1 / 3))).toBe(125);
    expect(snapIso(25)).toBe(25);
    expect(snapIso(102400)).toBe(102400);
  });

  it('snaps focal lengths to display precision, not stops', () => {
    expect(snapFocal(26.667)).toBe(27);
    expect(snapFocal(40.0)).toBe(40);
    expect(snapFocal(8.75)).toBe(8.8);
    expect(Number.isNaN(snapFocal(-1))).toBe(true);
  });
});

describe('shutter parsing and formatting', () => {
  it('parses fractions, decimals, and s-suffixed values', () => {
    expect(parseShutter('1/250')).toBeCloseTo(0.004);
    expect(parseShutter('0.5')).toBe(0.5);
    expect(parseShutter('2')).toBe(2);
    expect(parseShutter('2s')).toBe(2);
    expect(parseShutter(' 1 / 250 ')).toBeCloseTo(0.004);
    expect(parseShutter('30S')).toBe(30);
  });

  it('rejects junk and non-positive values', () => {
    expect(parseShutter('')).toBeNull();
    expect(parseShutter('fast')).toBeNull();
    expect(parseShutter('0')).toBeNull();
    expect(parseShutter('-2')).toBeNull();
    expect(parseShutter('1/0')).toBeNull();
  });

  it('formats the photographic way', () => {
    expect(formatShutter(2)).toBe('2s');
    expect(formatShutter(0.5)).toBe('1/2');
    expect(formatShutter(1 / 250)).toBe('1/250');
    expect(formatShutter(1.5)).toBe('1.5s');
    expect(formatShutter(0)).toBe('—');
  });
});

describe('formatStops', () => {
  it('signs and trims', () => {
    expect(formatStops(0)).toBe('0');
    expect(formatStops(1)).toBe('+1');
    expect(formatStops(-2 / 3)).toBe('−0.67');
    expect(formatStops(0.830074)).toBe('+0.83');
    expect(formatStops(-0.0002)).toBe('0'); // rounds to zero — no misleading sign
  });
});
