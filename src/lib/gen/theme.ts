/**
 * CSS theme building (follow-up 2026-08-14): turn a swatch of up to five
 * colors into a pure-CSS `:root` theme — custom properties with automatic
 * light/dark variants via `light-dark()`, readable on-colors picked by WCAG
 * contrast, and spacing/radius knobs. The daisyUI theme-generator idea, but
 * emitting plain CSS variables instead of a framework config.
 *
 * Role order for the swatch: primary, secondary, accent, neutral, base.
 * Missing/unparseable entries are derived from the primary on the HSL wheel,
 * so one color is enough to get a complete theme.
 */
import { hslToRgb, parseCssColor, rgbToHex, rgbToHsl } from './color';

export interface ThemeInput {
  /** Up to five CSS colors (primary, secondary, accent, neutral, base). */
  colors: (string | null)[];
  paddingPx: number;
  radiusPx: number;
}

export const THEME_ROLES = ['primary', 'secondary', 'accent', 'neutral', 'base'] as const;
export type ThemeRole = (typeof THEME_ROLES)[number];

export interface ThemeSwatch {
  role: ThemeRole;
  /** Whether this came from the user or was derived from the primary. */
  derived: boolean;
  light: string;
  dark: string;
  /** Text color that reads on the role color (per scheme). */
  onLight: string;
  onDark: string;
}

export interface BuiltTheme {
  swatches: ThemeSwatch[];
  /** Every variable, for driving a live preview via inline style. */
  vars: [string, string][];
  css: string;
}

type Rgb = [number, number, number];

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

const hsl = (rgb: Rgb): Rgb => rgbToHsl(rgb.map((v) => clamp(v, 0, 1)) as Rgb);

const fromHsl = (h: number, s: number, l: number): string =>
  rgbToHex(hslToRgb([(h + 360) % 360, clamp(s, 0, 1), clamp(l, 0, 1)]));

/** WCAG relative luminance. */
function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((c) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  ) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Near-black or white, whichever contrasts harder with the color. */
export function contrastOn(hex: string): string {
  const c = parseCssColor(hex);
  if (!c) return '#111111';
  const l = luminance(c.rgb as Rgb);
  const vsWhite = 1.05 / (l + 0.05);
  const vsBlack = (l + 0.05) / 0.055; // luminance of #111 ≈ 0.005 → +0.05
  return vsWhite >= vsBlack ? '#ffffff' : '#111111';
}

/** Brand colors get a lightness bump for dark backgrounds. */
function darkVariant(rgb: Rgb): string {
  const [h, s, l] = hsl(rgb);
  return fromHsl(h, s, clamp(l + 0.12, 0.35, 0.8));
}

export function buildTheme(input: ThemeInput): BuiltTheme {
  const parsed = input.colors.map((c) => (c ? parseCssColor(c) : null));
  const primaryRgb: Rgb = (parsed[0]?.rgb as Rgb | undefined) ?? [
    0x1e / 255, 0x3a / 255, 0x5f / 255,
  ];
  const [ph, ps, pl] = hsl(primaryRgb);

  // Fill the missing roles from the primary's position on the wheel.
  const roleRgb = (i: number): { rgb: Rgb; derived: boolean } => {
    const given = parsed[i]?.rgb as Rgb | undefined;
    if (given) return { rgb: given.map((v) => clamp(v, 0, 1)) as Rgb, derived: false };
    switch (THEME_ROLES[i]) {
      case 'secondary':
        return { rgb: hslToRgb([(ph + 180) % 360, ps, pl]) as Rgb, derived: true };
      case 'accent':
        return { rgb: hslToRgb([(ph + 60) % 360, ps, clamp(pl + 0.05, 0, 1)]) as Rgb, derived: true };
      case 'neutral':
        return { rgb: hslToRgb([ph, ps * 0.12, 0.45]) as Rgb, derived: true };
      case 'base':
        return { rgb: hslToRgb([ph, clamp(ps * 0.4, 0, 1), 0.96]) as Rgb, derived: true };
      default:
        return { rgb: primaryRgb, derived: parsed[0] === null || parsed[0] === undefined };
    }
  };

  const swatches: ThemeSwatch[] = THEME_ROLES.map((role, i) => {
    const { rgb, derived } = roleRgb(i);
    const light = rgbToHex(rgb);
    const dark = role === 'base' ? baseDark(rgb) : darkVariant(rgb);
    return { role, derived, light, dark, onLight: contrastOn(light), onDark: contrastOn(dark) };
  });

  // Surfaces and text ride on base/neutral hues so themes feel tinted, not gray.
  const [bh, bs] = hsl(swatches[4]!.light === '#ffffff' ? primaryRgb : parseCssColor(swatches[4]!.light)!.rgb as Rgb);
  const [nh, ns] = hsl(parseCssColor(swatches[3]!.light)!.rgb as Rgb);

  const vars: [string, string][] = [];
  for (const s of swatches) {
    vars.push([`--${s.role}`, `light-dark(${s.light}, ${s.dark})`]);
    vars.push([`--on-${s.role}`, `light-dark(${s.onLight}, ${s.onDark})`]);
  }
  vars.push(
    ['--surface', `light-dark(${swatches[4]!.light}, ${swatches[4]!.dark})`],
    ['--surface-2', `light-dark(${fromHsl(bh, bs * 0.4, 0.9)}, ${fromHsl(bh, bs * 0.3, 0.18)})`],
    ['--text', `light-dark(${fromHsl(nh, ns * 0.5, 0.13)}, ${fromHsl(nh, ns * 0.3, 0.92)})`],
    ['--border', `light-dark(${fromHsl(nh, ns * 0.4, 0.78)}, ${fromHsl(nh, ns * 0.3, 0.32)})`],
    ['--padding', `${Math.round(input.paddingPx)}px`],
    ['--radius', `${Math.round(input.radiusPx)}px`]
  );

  const css =
    ':root {\n  color-scheme: light dark;\n\n' +
    vars.map(([name, value]) => `  ${name}: ${value};`).join('\n') +
    '\n}';

  return { swatches, vars, css };
}

/** The base color's dark-scheme counterpart: same hue family, near-black. */
function baseDark(rgb: Rgb): string {
  const [h, s] = hsl(rgb);
  return fromHsl(h, clamp(s * 0.5, 0, 0.4), 0.12);
}
