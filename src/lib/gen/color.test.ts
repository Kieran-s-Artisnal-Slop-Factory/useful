import { describe, expect, it } from 'vitest';
import { allFormats, NAMED_COLORS, parseCssColor, type ParsedColor } from './color';

const rgb255 = (c: ParsedColor): number[] => c.rgb.map((v) => Math.round(v * 255));

function parsed(input: string): ParsedColor {
  const c = parseCssColor(input);
  if (!c) throw new Error('failed to parse: ' + input);
  return c;
}

describe('parseCssColor', () => {
  it('parses hex in all four lengths', () => {
    expect(rgb255(parsed('#ff0000'))).toEqual([255, 0, 0]);
    expect(rgb255(parsed('#f00'))).toEqual([255, 0, 0]);
    expect(parsed('#f008').alpha).toBeCloseTo(0x88 / 255, 2);
    expect(parsed('#ff000080').alpha).toBeCloseTo(0x80 / 255, 2);
    expect(parseCssColor('#ff00')).toBeTruthy(); // #rgba
    expect(parseCssColor('#ff000')).toBeNull(); // 5 digits is never valid
    expect(parseCssColor('#gg0000')).toBeNull();
  });

  it('parses rgb() in modern and legacy syntax, numbers and percents', () => {
    expect(rgb255(parsed('rgb(255 128 0)'))).toEqual([255, 128, 0]);
    expect(rgb255(parsed('rgb(255, 128, 0)'))).toEqual([255, 128, 0]);
    expect(rgb255(parsed('rgba(255, 128, 0, 0.5)'))).toEqual([255, 128, 0]);
    expect(parsed('rgba(255, 128, 0, 0.5)').alpha).toBe(0.5);
    expect(parsed('rgb(100% 50% 0% / 50%)').alpha).toBe(0.5);
    expect(rgb255(parsed('rgb(100% 0% 0%)'))).toEqual([255, 0, 0]);
    expect(parseCssColor('rgb(1 2)')).toBeNull();
  });

  it('parses hsl()/hwb() with hue units', () => {
    expect(rgb255(parsed('hsl(120 100% 25.1%)'))).toEqual([0, 128, 0]);
    expect(rgb255(parsed('hsl(120deg, 100%, 25.1%)'))).toEqual([0, 128, 0]);
    expect(rgb255(parsed('hsl(0.5turn 100% 50%)'))).toEqual([0, 255, 255]);
    expect(rgb255(parsed('hwb(0 0% 0%)'))).toEqual([255, 0, 0]);
    // w + b >= 100% collapses to gray w/(w+b).
    expect(rgb255(parsed('hwb(200 60% 60%)'))).toEqual([128, 128, 128]);
  });

  it('parses lab/lch/oklab/oklch, with % scaling per the spec', () => {
    expect(rgb255(parsed('lab(100 0 0)'))).toEqual([255, 255, 255]);
    expect(rgb255(parsed('lab(100% 0% 0%)'))).toEqual([255, 255, 255]);
    expect(rgb255(parsed('lch(0 0 0)'))).toEqual([0, 0, 0]);
    expect(rgb255(parsed('oklab(100% 0 0)'))).toEqual([255, 255, 255]);
    // oklch of pure sRGB red (well-known reference values).
    expect(rgb255(parsed('oklch(0.628 0.2577 29.234)'))).toEqual([255, 0, 0]);
  });

  it('parses named colors and transparent', () => {
    expect(rgb255(parsed('rebeccapurple'))).toEqual([0x66, 0x33, 0x99]);
    expect(rgb255(parsed('RED'))).toEqual([255, 0, 0]);
    expect(parsed('transparent').alpha).toBe(0);
    expect(parseCssColor('notacolor')).toBeNull();
    expect(parseCssColor('')).toBeNull();
  });
});

describe('allFormats', () => {
  it('produces the reference spellings for red', () => {
    const f = allFormats(parsed('#ff0000'));
    expect(f.hex).toBe('#ff0000');
    expect(f.rgb).toBe('rgb(255 0 0)');
    expect(f.hsl).toBe('hsl(0 100% 50%)');
    expect(f.hwb).toBe('hwb(0 0% 0%)');
    expect(f.named).toBe('red');
    expect(f.inGamut).toBe(true);
    // Well-known conversions (CSS Color 4 sample values).
    expect(f.oklch).toMatch(/^oklch\(0\.628\d? 0\.257\d? 29\.2\d?\)$/);
    expect(f.lch).toMatch(/^lch\(54\.29 106\.8\d? 40\.8\d?\)$/);
  });

  it('white and black are neutral in every space', () => {
    const w = allFormats(parsed('white'));
    expect(w.lab).toBe('lab(100 0 0)');
    expect(w.oklab).toBe('oklab(1 0 0)');
    const b = allFormats(parsed('black'));
    expect(b.lab).toBe('lab(0 0 0)');
    expect(b.hsl).toBe('hsl(0 0% 0%)');
  });

  it('carries alpha through every format', () => {
    const f = allFormats(parsed('rgb(0 128 0 / 0.5)'));
    expect(f.hex).toBe('#00800080');
    expect(f.rgb).toBe('rgb(0 128 0 / 0.5)');
    expect(f.hsl).toContain('/ 0.5');
    expect(f.oklch).toContain('/ 0.5');
    expect(f.named).toBeNull(); // translucent green is not "green"
  });

  it('flags and clips out-of-sRGB colors', () => {
    const f = allFormats(parsed('oklch(0.7 0.35 150)')); // hyper-green
    expect(f.inGamut).toBe(false);
    const c = parsed(f.hex);
    for (const v of c.rgb) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('every emitted format string parses back to the same color (round trip)', () => {
    const samples = ['#ff0000', '#00ff7f', 'rebeccapurple', 'rgb(12 34 56)', 'hsl(210 50% 40%)',
      'oklch(0.7 0.1 200)', 'lab(60 -30 40)', '#336699cc'];
    for (const input of samples) {
      const source = parsed(input);
      const f = allFormats(source);
      for (const spelling of [f.hex, f.rgb, f.hsl, f.hwb, f.lab, f.lch, f.oklab, f.oklch]) {
        const back = parsed(spelling);
        for (let i = 0; i < 3; i++) {
          expect(
            Math.abs(back.rgb[i]! - Math.min(1, Math.max(0, source.rgb[i]!))),
            `${input} → ${spelling} channel ${i}`
          ).toBeLessThan(1.5 / 255);
        }
        expect(Math.abs(back.alpha - source.alpha), `${input} → ${spelling} alpha`).toBeLessThan(0.005);
      }
    }
  });
});

describe('NAMED_COLORS', () => {
  it('has the full CSS list (148 names, verified against the browser)', () => {
    expect(Object.keys(NAMED_COLORS)).toHaveLength(148);
    expect(NAMED_COLORS.rebeccapurple).toBe('#663399');
    expect(NAMED_COLORS.gray).toBe(NAMED_COLORS.grey);
  });
});
