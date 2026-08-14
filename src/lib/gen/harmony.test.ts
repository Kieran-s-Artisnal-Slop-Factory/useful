import { describe, expect, it } from 'vitest';
import { parseCssColor } from './color';
import { harmonies } from './harmony';

const of = (input: string) => harmonies(parseCssColor(input)!);
const byId = (input: string, id: string) => of(input).find((h) => h.id === id)!;

describe('harmonies', () => {
  it('complementary is the 180° hue rotation', () => {
    expect(byId('#ff0000', 'complementary').colors).toEqual(['#ff0000', '#00ffff']);
    expect(byId('#0000ff', 'complementary').colors).toEqual(['#0000ff', '#ffff00']);
  });

  it('analogous is ±30° with the base in the middle', () => {
    expect(byId('#ff0000', 'analogous').colors).toEqual(['#ff0080', '#ff0000', '#ff8000']);
  });

  it('tetradic is the +60/+180/+240 rectangle', () => {
    expect(byId('#ff0000', 'tetradic').colors).toEqual([
      '#ff0000',
      '#ffff00',
      '#00ffff',
      '#0000ff',
    ]);
  });

  it('monochromatic keeps the hue and walks lightness', () => {
    const mono = byId('#ff0000', 'monochromatic');
    expect(mono.colors[0]).toBe('#ff0000');
    expect(mono.colors.length).toBeGreaterThanOrEqual(4);
    for (const hex of mono.colors.slice(1)) {
      const [h, s] = (() => {
        const c = parseCssColor(hex)!;
        const max = Math.max(...c.rgb);
        const min = Math.min(...c.rgb);
        const d = max - min;
        let hue = 0;
        if (d > 1e-9) {
          if (max === c.rgb[0]) hue = (((c.rgb[1] - c.rgb[2]) / d) % 6) * 60;
        }
        return [((hue % 360) + 360) % 360, d];
      })();
      expect(h, hex).toBeCloseTo(0, 0); // red hue preserved
      expect(s).toBeGreaterThan(0);
    }
  });

  it('every harmony returns the base color and unique swatches', () => {
    for (const h of of('#336699')) {
      expect(h.colors).toContain('#336699');
      expect(new Set(h.colors).size).toBe(h.colors.length);
    }
  });

  it('grays do not explode (hue is degenerate)', () => {
    const gray = of('#808080');
    expect(gray.find((h) => h.id === 'complementary')!.colors).toHaveLength(2);
  });
});
