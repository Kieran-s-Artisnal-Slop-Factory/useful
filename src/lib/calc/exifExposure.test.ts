import { describe, expect, it, vi } from 'vitest';
import { exposureFromExif, readExposure } from './exifExposure';

// The lazy import is the point of the module: mock it so node never loads the
// real parser, and so the test can prove the pick list and the fallbacks.
const parse = vi.fn();
vi.mock('exifr', () => ({ default: { parse: (...args: unknown[]) => parse(...args) } }));

describe('exposureFromExif', () => {
  it('reads the three settings plus model and focal', () => {
    const r = exposureFromExif({
      FNumber: 2.8,
      ExposureTime: 0.004,
      ISO: 100,
      FocalLength: 50,
      Model: ' Fixture Cam ',
    });
    expect(r).toEqual({
      ok: true,
      exposure: { aperture: 2.8, shutter: 0.004, iso: 100, focal: 50, model: 'Fixture Cam' },
    });
  });

  it('tolerates a missing model and focal length — they are not exposure', () => {
    const r = exposureFromExif({ FNumber: 4, ExposureTime: 1 / 60, ISO: [400] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.exposure.iso).toBe(400);
      expect(r.exposure.focal).toBeNull();
      expect(r.exposure.model).toBe('');
    }
  });

  it('names every absent exposure tag, in a fixed order', () => {
    expect(exposureFromExif(undefined)).toEqual({ ok: false, missing: ['FNumber', 'ExposureTime', 'ISO'] });
    expect(exposureFromExif({ FNumber: 2.8, ISO: 100 })).toEqual({ ok: false, missing: ['ExposureTime'] });
    expect(exposureFromExif({ FNumber: 0, ExposureTime: 'fast', ISO: 100 })).toEqual({
      ok: false,
      missing: ['FNumber', 'ExposureTime'],
    });
  });
});

describe('readExposure', () => {
  it('picks exactly the five tags and maps the result', async () => {
    parse.mockResolvedValueOnce({ FNumber: 2.8, ExposureTime: 0.004, ISO: 100 });
    const file = new File([new Uint8Array([0xff, 0xd8])], 'x.jpg', { type: 'image/jpeg' });
    const r = await readExposure(file);
    expect(parse).toHaveBeenCalledWith(file, {
      pick: ['FNumber', 'ExposureTime', 'ISO', 'FocalLength', 'Model'],
    });
    expect(r.ok).toBe(true);
  });

  it('treats a format exifr cannot open as "no tags"', async () => {
    parse.mockRejectedValueOnce(new Error('Unknown file format'));
    const r = await readExposure(new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' }));
    expect(r).toEqual({ ok: false, missing: ['FNumber', 'ExposureTime', 'ISO'] });
  });
});
