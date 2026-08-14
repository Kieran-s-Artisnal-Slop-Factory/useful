import { describe, expect, it } from 'vitest';
import {
  capDimensions,
  detectKind,
  fitDimensions,
  formatBytes,
  outputFilename,
  percentDimensions,
  qualityFraction,
  targetsFor,
} from './convert';

describe('detectKind', () => {
  it('classifies by extension first, mime as fallback', () => {
    expect(detectKind('a.svg', '')).toBe('svg');
    expect(detectKind('a.tif', '')).toBe('tiff');
    expect(detectKind('a.tiff', 'application/octet-stream')).toBe('tiff');
    expect(detectKind('a.png', 'image/png')).toBe('raster');
    expect(detectKind('a.jpeg', '')).toBe('raster');
    expect(detectKind('a.webp', '')).toBe('raster');
    expect(detectKind('a.avif', '')).toBe('raster');
    expect(detectKind('noext', 'image/webp')).toBe('raster');
    expect(detectKind('a.txt', 'text/plain')).toBe('unsupported');
    expect(detectKind('a.gif', 'image/gif')).toBe('unsupported');
  });
});

describe('targetsFor (the conversion matrix)', () => {
  it('PNG→JPG only, JPG→PNG only, everything else → both', () => {
    expect(targetsFor('a.png', 'image/png')).toEqual(['jpg']);
    expect(targetsFor('a.jpg', 'image/jpeg')).toEqual(['png']);
    expect(targetsFor('a.jpeg', '')).toEqual(['png']);
    expect(targetsFor('a.svg', '')).toEqual(['png', 'jpg']);
    expect(targetsFor('a.webp', '')).toEqual(['png', 'jpg']);
    expect(targetsFor('a.avif', '')).toEqual(['png', 'jpg']);
    expect(targetsFor('a.tiff', '')).toEqual(['png', 'jpg']);
    expect(targetsFor('a.txt', 'text/plain')).toEqual([]);
  });
});

describe('outputFilename', () => {
  it('swaps the extension, preserving dotted stems', () => {
    expect(outputFilename('holiday.avif', 'png')).toBe('holiday.png');
    expect(outputFilename('x.tif', 'jpg')).toBe('x.jpg');
    expect(outputFilename('archive.v2.webp', 'png')).toBe('archive.v2.png');
    expect(outputFilename('noext', 'jpg')).toBe('noext.jpg');
  });
});

describe('qualityFraction', () => {
  it('maps 1–100 to 0.01–1 and clamps junk', () => {
    expect(qualityFraction(85)).toBe(0.85);
    expect(qualityFraction(100)).toBe(1);
    expect(qualityFraction(0)).toBe(0.01);
    expect(qualityFraction(500)).toBe(1);
    expect(qualityFraction(NaN)).toBe(0.85);
  });
});

describe('fitDimensions', () => {
  const base = { width: 400, height: 300 };

  it('derives the other dimension under aspect lock', () => {
    expect(fitDimensions({ ...base, targetWidth: 200, targetHeight: null, lock: true })).toEqual({ width: 200, height: 150 });
    expect(fitDimensions({ ...base, targetWidth: null, targetHeight: 150, lock: true })).toEqual({ width: 200, height: 150 });
    // Width wins when both are given under lock.
    expect(fitDimensions({ ...base, targetWidth: 100, targetHeight: 999, lock: true })).toEqual({ width: 100, height: 75 });
  });

  it('takes both dimensions verbatim when unlocked', () => {
    expect(fitDimensions({ ...base, targetWidth: 100, targetHeight: 500, lock: false })).toEqual({ width: 100, height: 500 });
    expect(fitDimensions({ ...base, targetWidth: 120, targetHeight: null, lock: false })).toEqual({ width: 120, height: 300 });
  });

  it('never returns zero and ignores nonsense targets', () => {
    expect(fitDimensions({ width: 3, height: 900, targetWidth: 1, targetHeight: null, lock: true })).toEqual({ width: 1, height: 300 });
    expect(fitDimensions({ ...base, targetWidth: null, targetHeight: null, lock: true })).toEqual({ width: 400, height: 300 });
    expect(fitDimensions({ ...base, targetWidth: -5, targetHeight: null, lock: true })).toEqual({ width: 400, height: 300 });
  });
});

describe('percentDimensions', () => {
  it('scales both edges', () => {
    expect(percentDimensions(400, 300, 50)).toEqual({ width: 200, height: 150 });
    expect(percentDimensions(400, 300, 200)).toEqual({ width: 800, height: 600 });
    expect(percentDimensions(3, 3, 10)).toEqual({ width: 1, height: 1 }); // floor at 1px
  });
});

describe('capDimensions', () => {
  it('caps the longest edge, preserving aspect', () => {
    expect(capDimensions(4000, 2000, 1000)).toEqual({ width: 1000, height: 500 });
    expect(capDimensions(2000, 4000, 1000)).toEqual({ width: 500, height: 1000 });
    expect(capDimensions(800, 600, 1000)).toEqual({ width: 800, height: 600 });
    expect(capDimensions(800, 600, null)).toEqual({ width: 800, height: 600 });
  });
});

describe('formatBytes', () => {
  it('uses decimal units', () => {
    expect(formatBytes(412)).toBe('412 B');
    expect(formatBytes(83_000)).toBe('83 KB');
    expect(formatBytes(2_400_000)).toBe('2.4 MB');
    expect(formatBytes(NaN)).toBe('—');
  });
});
