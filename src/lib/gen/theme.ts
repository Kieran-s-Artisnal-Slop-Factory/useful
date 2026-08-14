/**
 * CSS theme building (follow-ups 2026-08-14): turn a swatch of up to five
 * colors into a pure-CSS `:root` theme — custom properties with light/dark
 * variants via `light-dark()`, readable on-colors picked by WCAG contrast,
 * and spacing/radius knobs. The daisyUI theme-generator idea, but emitting
 * plain CSS variables instead of a framework config.
 *
 * Role order: primary, secondary, accent, neutral, base. BOTH scheme slots
 * are user-overridable per role: a blank light slot derives from the primary
 * on the HSL wheel; a blank dark slot derives from that role's light value.
 * One color is enough for a complete theme.
 *
 * buildTheme also audits each brand role against the theme's own background
 * per scheme (WCAG 1.4.11's 3:1 component threshold) and reports warnings.
 */
import { hslToRgb, parseCssColor, rgbToHex, rgbToHsl } from './color';

export interface RoleInput {
  light: string | null;
  dark: string | null;
}

export interface ThemeInput {
  /** Up to five roles (primary, secondary, accent, neutral, base). */
  colors: RoleInput[];
  paddingPx: number;
  radiusPx: number;
}

export const THEME_ROLES = ['primary', 'secondary', 'accent', 'neutral', 'base'] as const;
export type ThemeRole = (typeof THEME_ROLES)[number];

export interface ThemeSwatch {
  role: ThemeRole;
  light: string;
  dark: string;
  derivedLight: boolean;
  derivedDark: boolean;
  /** Text color that reads on the role color (per scheme). */
  onLight: string;
  onDark: string;
}

export interface ThemeWarning {
  scheme: 'light' | 'dark';
  role: ThemeRole;
  /** Contrast ratio vs the scheme's background, rounded to 0.1. */
  ratio: number;
}

export interface BuiltTheme {
  swatches: ThemeSwatch[];
  warnings: ThemeWarning[];
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

/** WCAG contrast ratio between two colors (1–21). */
export function contrastRatio(a: string, b: string): number {
  const ca = parseCssColor(a);
  const cb = parseCssColor(b);
  if (!ca || !cb) return 21;
  const la = luminance(ca.rgb as Rgb);
  const lb = luminance(cb.rgb as Rgb);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
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

/** Brand colors get a lightness lift for dark backgrounds — and keep lifting
 * until they clear the 3:1 component threshold against the actual dark
 * surface (perceptually dark hues like purple need more than a fixed bump). */
function darkVariant(rgb: Rgb, surfaceDark: string): string {
  const [h, s, l] = hsl(rgb);
  let lift = clamp(l + 0.18, 0.45, 0.82);
  let hex = fromHsl(h, s, lift);
  while (contrastRatio(hex, surfaceDark) < 3.05 && lift < 0.9) {
    lift += 0.03;
    hex = fromHsl(h, s, lift);
  }
  return hex;
}

/** The base color's dark-scheme counterpart: same hue family, near-black. */
function baseDark(rgb: Rgb): string {
  const [h, s] = hsl(rgb);
  return fromHsl(h, clamp(s * 0.5, 0, 0.4), 0.12);
}

export function buildTheme(input: ThemeInput): BuiltTheme {
  const lightGiven = THEME_ROLES.map((_, i) => {
    const raw = input.colors[i]?.light;
    return raw ? parseCssColor(raw) : null;
  });
  const darkGiven = THEME_ROLES.map((_, i) => {
    const raw = input.colors[i]?.dark;
    return raw ? parseCssColor(raw) : null;
  });

  const primaryRgb: Rgb = (lightGiven[0]?.rgb as Rgb | undefined) ?? [
    0x1e / 255, 0x3a / 255, 0x5f / 255,
  ];
  const [ph, ps, pl] = hsl(primaryRgb);

  // Fill missing LIGHT slots from the primary's position on the wheel.
  const lightRgb = (i: number): Rgb => {
    const given = lightGiven[i]?.rgb as Rgb | undefined;
    if (given) return given.map((v) => clamp(v, 0, 1)) as Rgb;
    switch (THEME_ROLES[i]) {
      case 'secondary':
        return hslToRgb([(ph + 180) % 360, ps, pl]) as Rgb;
      case 'accent':
        return hslToRgb([(ph + 60) % 360, ps, clamp(pl + 0.05, 0, 1)]) as Rgb;
      case 'neutral':
        return hslToRgb([ph, ps * 0.12, 0.45]) as Rgb;
      case 'base':
        return hslToRgb([ph, clamp(ps * 0.4, 0, 1), 0.96]) as Rgb;
      default:
        return primaryRgb;
    }
  };

  // Base first: derived brand darks lift themselves against the REAL surface.
  const baseLightRgb = lightRgb(4);
  const surfaceDark = darkGiven[4]
    ? rgbToHex(darkGiven[4]!.rgb.map((v) => clamp(v, 0, 1)) as Rgb)
    : baseDark(baseLightRgb);

  const swatches: ThemeSwatch[] = THEME_ROLES.map((role, i) => {
    const rgb = i === 4 ? baseLightRgb : lightRgb(i);
    const light = rgbToHex(rgb);
    const darkOverride = darkGiven[i];
    const dark = darkOverride
      ? rgbToHex(darkOverride.rgb.map((v) => clamp(v, 0, 1)) as Rgb)
      : role === 'base'
        ? surfaceDark
        : darkVariant(rgb, surfaceDark);
    return {
      role,
      light,
      dark,
      derivedLight: lightGiven[i] === null,
      derivedDark: darkOverride === null,
      onLight: contrastOn(light),
      onDark: contrastOn(dark),
    };
  });

  // Surfaces and text ride on base/neutral hues so themes feel tinted, not gray.
  const base = swatches[4]!;
  const [bh, bs] = hsl(parseCssColor(base.light)!.rgb as Rgb);
  const [nh, ns] = hsl(parseCssColor(swatches[3]!.light)!.rgb as Rgb);

  const vars: [string, string][] = [];
  for (const s of swatches) {
    vars.push([`--${s.role}`, `light-dark(${s.light}, ${s.dark})`]);
    vars.push([`--on-${s.role}`, `light-dark(${s.onLight}, ${s.onDark})`]);
  }
  vars.push(
    ['--surface', `light-dark(${base.light}, ${base.dark})`],
    ['--surface-2', `light-dark(${fromHsl(bh, bs * 0.4, 0.9)}, ${fromHsl(bh, bs * 0.3, 0.18)})`],
    ['--text', `light-dark(${fromHsl(nh, ns * 0.5, 0.13)}, ${fromHsl(nh, ns * 0.3, 0.92)})`],
    ['--border', `light-dark(${fromHsl(nh, ns * 0.4, 0.78)}, ${fromHsl(nh, ns * 0.3, 0.32)})`],
    ['--padding', `${Math.round(input.paddingPx)}px`],
    ['--radius', `${Math.round(input.radiusPx)}px`]
  );

  // Audit brand roles against the theme's own background, per scheme.
  const warnings: ThemeWarning[] = [];
  for (const s of swatches.slice(0, 4)) {
    for (const scheme of ['light', 'dark'] as const) {
      const ratio = contrastRatio(s[scheme], scheme === 'light' ? base.light : base.dark);
      if (ratio < 3) warnings.push({ scheme, role: s.role, ratio: Math.round(ratio * 10) / 10 });
    }
  }

  const css =
    ':root {\n  color-scheme: light dark;\n\n' +
    vars.map(([name, value]) => `  ${name}: ${value};`).join('\n') +
    '\n}';

  return { swatches, warnings, vars, css };
}
