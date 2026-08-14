import { describe, expect, it } from 'vitest';
import { EC_LEVELS, qrColorWarning, qrSvg } from './qr';

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

  it('custom colors reach the emitted SVG', async () => {
    const svg = await qrSvg('hello', { size: 256, ecLevel: 'M', dark: '#1e3a5f', light: '#fff8dc' });
    expect(svg).toContain('#1e3a5f');
    expect(svg).toContain('#fff8dc');
  });
});

describe('qrColorWarning', () => {
  it('accepts classic dark-on-light pairs', () => {
    expect(qrColorWarning('#000000', '#ffffff')).toBeNull();
    expect(qrColorWarning('#1e3a5f', '#fff8dc')).toBeNull();
  });

  it('flags inverted (light-on-dark) pairs', () => {
    expect(qrColorWarning('#ffffff', '#000000')).toMatch(/[Ii]nverted/);
    expect(qrColorWarning('#ffd700', '#00008b')).toMatch(/[Ii]nverted/);
  });

  it('flags low-contrast pairs', () => {
    expect(qrColorWarning('#888888', '#aaaaaa')).toMatch(/contrast/);
    expect(qrColorWarning('#ff0000', '#ff8080')).toMatch(/contrast/);
  });
});
