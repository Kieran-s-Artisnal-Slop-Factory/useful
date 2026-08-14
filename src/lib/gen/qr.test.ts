import { describe, expect, it } from 'vitest';
import { EC_LEVELS, qrSvg } from './qr';

describe('qrSvg', () => {
  it('renders an SVG document for a URL payload', async () => {
    const svg = await qrSvg('https://example.com/', { size: 256, ecLevel: 'M' });
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox');
    expect(svg).toContain('path');
  });

  it('error-correction level changes the emitted modules', async () => {
    const low = await qrSvg('hello world', { size: 256, ecLevel: 'L' });
    const high = await qrSvg('hello world', { size: 256, ecLevel: 'H' });
    expect(high).not.toBe(low);
  });

  it('rejects an empty payload instead of emitting a blank code', async () => {
    await expect(qrSvg('', { size: 256, ecLevel: 'M' })).rejects.toThrow();
  });

  it('exposes all four standard EC levels', () => {
    expect(EC_LEVELS.map((l) => l.id)).toEqual(['L', 'M', 'Q', 'H']);
  });
});
