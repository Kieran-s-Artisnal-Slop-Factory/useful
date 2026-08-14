/**
 * Color-theory harmonies on the classic HSL color wheel (the model tools
 * like Canva's color wheel use): rotate hue, keep saturation and lightness.
 * Monochromatic instead keeps the hue and walks lightness.
 */
import { hslToRgb, rgbToHex, rgbToHsl, type ParsedColor } from './color';

export interface Harmony {
  id: 'complementary' | 'monochromatic' | 'analogous' | 'tetradic';
  label: string;
  description: string;
  /** Hex swatches, the base color always first. */
  colors: string[];
}

const rotate = (h: number, s: number, l: number, deg: number): string =>
  rgbToHex(hslToRgb([(h + deg + 360) % 360, s, l]));

export function harmonies(color: ParsedColor): Harmony[] {
  const [h, s, l] = rgbToHsl(color.rgb.map((v) => Math.min(1, Math.max(0, v))) as [number, number, number]);
  const base = rgbToHex(color.rgb);
  return [
    {
      id: 'complementary',
      label: 'Complementary',
      description: 'The color directly across the wheel (180°) — maximum contrast.',
      colors: [base, rotate(h, s, l, 180)],
    },
    {
      id: 'monochromatic',
      label: 'Monochromatic',
      description: 'One hue, stepped through lightness — calm and cohesive.',
      colors: [
        base,
        ...[0.2, 0.4, 0.6, 0.8]
          .map((step) => rgbToHex(hslToRgb([h, s, step])))
          .filter((c) => c !== base),
      ],
    },
    {
      id: 'analogous',
      label: 'Analogous',
      description: 'The neighbors 30° either side — harmonious, low tension.',
      colors: [rotate(h, s, l, -30), base, rotate(h, s, l, 30)],
    },
    {
      id: 'tetradic',
      label: 'Tetradic',
      description: 'A rectangle on the wheel (+60°, +180°, +240°) — two complementary pairs.',
      colors: [base, rotate(h, s, l, 60), rotate(h, s, l, 180), rotate(h, s, l, 240)],
    },
  ];
}
