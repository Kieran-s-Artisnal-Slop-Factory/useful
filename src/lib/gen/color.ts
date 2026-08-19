/**
 * CSS color parsing and conversion (plan §5.1.1) — hex, rgb(a), hsl, hwb,
 * lab, lch, oklab, oklch and named colors, implemented per CSS Color 4 with
 * no dependencies so everything bundles statically and unit-tests as pure
 * functions.
 *
 * Internal hub: gamma-encoded sRGB components in 0..1 (+ alpha). Lab/LCH sit
 * on the D50 white point (as the CSS spec defines), so those paths run
 * sRGB ↔ linear ↔ XYZ(D65) ↔ Bradford ↔ XYZ(D50) ↔ Lab. OKLab converts
 * through its LMS matrices directly from linear sRGB.
 *
 * Out-of-gamut results (e.g. a vivid oklch()) are gamut-clipped per channel
 * for display and flagged via `inGamut` so the UI can say so.
 */

export interface ParsedColor {
  /** Gamma sRGB in 0..1 — MAY lie outside the range before clipping. */
  rgb: [number, number, number];
  alpha: number;
}

/* ------------------------------------------------------------ transfer --- */

const srgbToLinear = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : Math.sign(c) * ((Math.abs(c) + 0.055) / 1.055) ** 2.4;

const linearToSrgb = (c: number): number =>
  c <= 0.0031308 ? c * 12.92 : Math.sign(c) * (1.055 * Math.abs(c) ** (1 / 2.4) - 0.055);

/* ------------------------------------------------------------- matrices --- */

type Vec3 = [number, number, number];
type Mat3 = [Vec3, Vec3, Vec3];

const mul = (m: Mat3, v: Vec3): Vec3 => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];

const LIN_SRGB_TO_XYZ: Mat3 = [
  [0.4123907992659593, 0.357584339383878, 0.1804807884018343],
  [0.2126390058715102, 0.715168678767756, 0.0721923153607337],
  [0.0193308187155918, 0.119194779794626, 0.9505321522496607],
];

const XYZ_TO_LIN_SRGB: Mat3 = [
  [3.2409699419045226, -1.537383177570094, -0.4986107602930034],
  [-0.9692436362808796, 1.8759675015077202, 0.04155505740717559],
  [0.05563007969699366, -0.20397695888897652, 1.0569715142428786],
];

// Bradford chromatic adaptation between the sRGB white (D65) and Lab's D50.
const D65_TO_D50: Mat3 = [
  [1.0479298208405488, 0.022946793341019088, -0.05019222954313557],
  [0.029627815688159344, 0.990434484573249, -0.01707382502938514],
  [-0.009243058152591178, 0.015055144896577895, 0.7518742899580008],
];

const D50_TO_D65: Mat3 = [
  [0.9554734527042182, -0.023098536874261423, 0.0632593086610217],
  [-0.028369706963208136, 1.0099954580058226, 0.021041398966943008],
  [0.012314001688319899, -0.020507696433477912, 1.3303659366080753],
];

// D50 reference white (CSS Color 4).
const WHITE_D50: Vec3 = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];

/* ------------------------------------------------------------ Lab / LCH --- */

const EPS = 216 / 24389;
const KAPPA = 24389 / 27;

export function rgbToLab(rgb: Vec3): Vec3 {
  const xyz = mul(D65_TO_D50, mul(LIN_SRGB_TO_XYZ, rgb.map(srgbToLinear) as Vec3));
  const [fx, fy, fz] = xyz.map((v, i) => {
    const t = v / WHITE_D50[i]!;
    return t > EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116;
  });
  return [116 * fy! - 16, 500 * (fx! - fy!), 200 * (fy! - fz!)];
}

export function labToRgb([L, a, b]: Vec3): Vec3 {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const xr = fx ** 3 > EPS ? fx ** 3 : (116 * fx - 16) / KAPPA;
  const yr = L > KAPPA * EPS ? fy ** 3 : L / KAPPA;
  const zr = fz ** 3 > EPS ? fz ** 3 : (116 * fz - 16) / KAPPA;
  const xyzD65 = mul(D50_TO_D65, [xr * WHITE_D50[0], yr * WHITE_D50[1], zr * WHITE_D50[2]]);
  return mul(XYZ_TO_LIN_SRGB, xyzD65).map(linearToSrgb) as Vec3;
}

/* ---------------------------------------------------------------- OKLab --- */

export function rgbToOklab(rgb: Vec3): Vec3 {
  const [r, g, b] = rgb.map(srgbToLinear) as Vec3;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklabToRgb([L, a, b]: Vec3): Vec3 {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(linearToSrgb) as Vec3;
}

/* ------------------------------------------------------------ HSL / HWB --- */

/** h in degrees, s/l in 0..1. */
export function rgbToHsl([r, g, b]: Vec3): Vec3 {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 1e-9) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [((h * 60) % 360 + 360) % 360, s, l];
}

export function hslToRgb([h, s, l]: Vec3): Vec3 {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let rgb: Vec3;
  if (hp < 1) rgb = [c, x, 0];
  else if (hp < 2) rgb = [x, c, 0];
  else if (hp < 3) rgb = [0, c, x];
  else if (hp < 4) rgb = [0, x, c];
  else if (hp < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const m = l - c / 2;
  return rgb.map((v) => v + m) as Vec3;
}

/** h degrees, w/bk in 0..1. */
export function rgbToHwb(rgb: Vec3): Vec3 {
  const [h] = rgbToHsl(rgb);
  return [h, Math.min(...rgb), 1 - Math.max(...rgb)];
}

export function hwbToRgb([h, w, bk]: Vec3): Vec3 {
  if (w + bk >= 1) {
    const gray = w / (w + bk);
    return [gray, gray, gray];
  }
  return hslToRgb([h, 1, 0.5]).map((v) => v * (1 - w - bk) + w) as Vec3;
}

/* ------------------------------------------------------------- parsing --- */

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/**
 * Parse a CSS color string. Supports hex (#rgb/#rgba/#rrggbb/#rrggbbaa),
 * rgb()/rgba() (0-255 or %), hsl()/hsla(), hwb(), lab(), lch(), oklab(),
 * oklch() — modern space syntax or legacy commas, slash alpha, % alphas —
 * plus the CSS named colors and `transparent`. Returns null when it can't.
 */
export function parseCssColor(input: string): ParsedColor | null {
  const s = input.trim().toLowerCase();
  if (s.length === 0) return null;

  if (s === 'transparent') return { rgb: [0, 0, 0], alpha: 0 };
  const named = NAMED_COLORS[s];
  if (named) return parseCssColor(named);

  if (s.startsWith('#')) return parseHex(s);

  const fn = s.match(/^([a-z]+)\(\s*(.*?)\s*\)$/);
  if (!fn) return null;
  const name = fn[1]!;
  const body = fn[2]!;
  // Split "a b c / d" or legacy "a, b, c, d" into parts + alpha.
  const [main, alphaRaw] = splitAlpha(body);
  if (main === null) return null;
  const alpha = alphaRaw === null ? 1 : parseAlpha(alphaRaw);
  if (alpha === null) return null;
  const p = main;

  switch (name) {
    case 'rgb':
    case 'rgba': {
      if (p.length < 3) return null;
      const rgb = p.slice(0, 3).map((t) => parseNumberOrPercent(t, 255));
      if (rgb.some((v) => v === null)) return null;
      const extra = p.length === 4 ? parseAlpha(p[3]!) : null;
      if (p.length === 4 && extra === null) return null;
      return { rgb: rgb.map((v) => v! / 255) as Vec3, alpha: extra ?? alpha };
    }
    case 'hsl':
    case 'hsla': {
      if (p.length < 3) return null;
      const h = parseHue(p[0]!);
      const sPct = parsePercentOrNumber01(p[1]!);
      const lPct = parsePercentOrNumber01(p[2]!);
      if (h === null || sPct === null || lPct === null) return null;
      const extra = p.length === 4 ? parseAlpha(p[3]!) : null;
      if (p.length === 4 && extra === null) return null;
      return { rgb: hslToRgb([h, clamp01(sPct), clamp01(lPct)]), alpha: extra ?? alpha };
    }
    case 'hwb': {
      if (p.length !== 3) return null;
      const h = parseHue(p[0]!);
      const w = parsePercentOrNumber01(p[1]!);
      const bk = parsePercentOrNumber01(p[2]!);
      if (h === null || w === null || bk === null) return null;
      return { rgb: hwbToRgb([h, clamp01(w), clamp01(bk)]), alpha };
    }
    case 'lab': {
      if (p.length !== 3) return null;
      const L = parseScaled(p[0]!, 100);
      const a = parseScaled(p[1]!, 125);
      const b = parseScaled(p[2]!, 125);
      if (L === null || a === null || b === null) return null;
      return { rgb: labToRgb([L, a, b]), alpha };
    }
    case 'lch': {
      if (p.length !== 3) return null;
      const L = parseScaled(p[0]!, 100);
      const c = parseScaled(p[1]!, 150);
      const h = parseHue(p[2]!);
      if (L === null || c === null || h === null) return null;
      const rad = (h * Math.PI) / 180;
      return { rgb: labToRgb([L, c * Math.cos(rad), c * Math.sin(rad)]), alpha };
    }
    case 'oklab': {
      if (p.length !== 3) return null;
      const L = parseScaled(p[0]!, 1);
      const a = parseScaled(p[1]!, 0.4);
      const b = parseScaled(p[2]!, 0.4);
      if (L === null || a === null || b === null) return null;
      return { rgb: oklabToRgb([L, a, b]), alpha };
    }
    case 'oklch': {
      if (p.length !== 3) return null;
      const L = parseScaled(p[0]!, 1);
      const c = parseScaled(p[1]!, 0.4);
      const h = parseHue(p[2]!);
      if (L === null || c === null || h === null) return null;
      const rad = (h * Math.PI) / 180;
      return { rgb: oklabToRgb([L, c * Math.cos(rad), c * Math.sin(rad)]), alpha };
    }
    default:
      return null;
  }
}

function parseHex(s: string): ParsedColor | null {
  const hex = s.slice(1);
  if (!/^[0-9a-f]+$/.test(hex)) return null;
  const expand = (h: string): number => parseInt(h.length === 1 ? h + h : h, 16) / 255;
  if (hex.length === 3 || hex.length === 4) {
    const parts = hex.split('').map(expand);
    return { rgb: [parts[0]!, parts[1]!, parts[2]!], alpha: parts[3] ?? 1 };
  }
  if (hex.length === 6 || hex.length === 8) {
    const parts: number[] = [];
    for (let i = 0; i < hex.length; i += 2) parts.push(expand(hex.slice(i, i + 2)));
    return { rgb: [parts[0]!, parts[1]!, parts[2]!], alpha: parts[3] ?? 1 };
  }
  return null;
}

/** "a b c / d" → [[a,b,c], d]; "a, b, c, d" → [[a,b,c,d], null]. */
function splitAlpha(body: string): [string[] | null, string | null] {
  const slash = body.split('/');
  if (slash.length > 2) return [null, null];
  const main = slash[0]!.trim();
  const alpha = slash.length === 2 ? slash[1]!.trim() : null;
  const parts = main.includes(',')
    ? main.split(',').map((t) => t.trim())
    : main.split(/\s+/);
  if (parts.some((t) => t.length === 0)) return [null, null];
  return [parts, alpha];
}

function parseAlpha(t: string): number | null {
  const v = parsePercentOrNumber01(t);
  return v === null ? null : clamp01(v);
}

/** "50%" → 0.5; "0.5" → 0.5. */
function parsePercentOrNumber01(t: string): number | null {
  if (t.endsWith('%')) {
    const v = Number(t.slice(0, -1));
    return Number.isFinite(v) ? v / 100 : null;
  }
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

/** rgb components: "128" → 128, "50%" → scale/2. */
function parseNumberOrPercent(t: string, scale: number): number | null {
  if (t.endsWith('%')) {
    const v = Number(t.slice(0, -1));
    return Number.isFinite(v) ? (v / 100) * scale : null;
  }
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

/** lab/oklab components where 100% means `scale`. */
function parseScaled(t: string, scale: number): number | null {
  if (t.endsWith('%')) {
    const v = Number(t.slice(0, -1));
    return Number.isFinite(v) ? (v / 100) * scale : null;
  }
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

function parseHue(t: string): number | null {
  const m = t.match(/^(-?\d*\.?\d+)(deg|grad|rad|turn)?$/);
  if (!m) return null;
  const v = Number(m[1]);
  switch (m[2]) {
    case 'grad':
      return v * 0.9;
    case 'rad':
      return (v * 180) / Math.PI;
    case 'turn':
      return v * 360;
    default:
      return v;
  }
}

/* ---------------------------------------------------------- formatting --- */

/** Round to `digits` decimals and strip trailing zeros. */
const fmt = (v: number, digits: number): string => {
  const r = Number(v.toFixed(digits));
  // Avoid "-0" in output.
  return String(r === 0 ? 0 : r);
};

const to255 = (v: number): number => Math.round(clamp01(v) * 255);

/** '#rrggbb' from gamma sRGB components (clipped into range). */
export function rgbToHex(rgb: [number, number, number]): string {
  return '#' + rgb.map((v) => to255(v).toString(16).padStart(2, '0')).join('');
}

export interface ColorFormats {
  hex: string;
  rgb: string;
  hsl: string;
  hwb: string;
  lab: string;
  lch: string;
  oklab: string;
  oklch: string;
  /** Exact named-color match for the (clipped) value, if any. */
  named: string | null;
  /** False when the source color lies outside sRGB and was clipped. */
  inGamut: boolean;
}

/** Every CSS spelling of the color. Out-of-sRGB inputs are clipped first. */
export function allFormats(color: ParsedColor): ColorFormats {
  const inGamut = color.rgb.every((v) => v >= -1e-6 && v <= 1 + 1e-6);
  const rgb = color.rgb.map(clamp01) as Vec3;
  const a = clamp01(color.alpha);
  const hasAlpha = a < 1;
  const alphaSuffix = hasAlpha ? ` / ${fmt(a, 3)}` : '';

  const [r8, g8, b8] = rgb.map(to255) as Vec3;
  const hexBody = rgbToHex(rgb).slice(1);
  const hex = '#' + hexBody + (hasAlpha ? Math.round(a * 255).toString(16).padStart(2, '0') : '');

  const [h, s, l] = rgbToHsl(rgb);
  const [hw, w, bk] = rgbToHwb(rgb);
  const [L, labA, labB] = rgbToLab(rgb);
  const chroma = Math.hypot(labA, labB);
  const labHue = chroma < 0.005 ? 0 : ((Math.atan2(labB, labA) * 180) / Math.PI + 360) % 360;
  const [oL, oA, oB] = rgbToOklab(rgb);
  const oChroma = Math.hypot(oA, oB);
  const oHue = oChroma < 0.00005 ? 0 : ((Math.atan2(oB, oA) * 180) / Math.PI + 360) % 360;

  return {
    hex,
    rgb: `rgb(${r8} ${g8} ${b8}${alphaSuffix})`,
    hsl: `hsl(${fmt(h, 1)} ${fmt(s * 100, 1)}% ${fmt(l * 100, 1)}%${alphaSuffix})`,
    hwb: `hwb(${fmt(hw, 1)} ${fmt(w * 100, 1)}% ${fmt(bk * 100, 1)}%${alphaSuffix})`,
    lab: `lab(${fmt(L, 2)} ${fmt(labA, 2)} ${fmt(labB, 2)}${alphaSuffix})`,
    lch: `lch(${fmt(L, 2)} ${fmt(chroma, 2)} ${fmt(labHue, 2)}${alphaSuffix})`,
    oklab: `oklab(${fmt(oL, 4)} ${fmt(oA, 4)} ${fmt(oB, 4)}${alphaSuffix})`,
    oklch: `oklch(${fmt(oL, 4)} ${fmt(oChroma, 4)} ${fmt(oHue, 2)}${alphaSuffix})`,
    named: hasAlpha ? null : (HEX_TO_NAME[('#' + hexBody) as keyof typeof HEX_TO_NAME] ?? null),
    inGamut,
  };
}

/* ------------------------------------------------------- alpha editing --- */

/** Which CSS spelling a color string is written in. */
export type ColorFamily =
  | 'hex'
  | 'rgb'
  | 'hsl'
  | 'hwb'
  | 'lab'
  | 'lch'
  | 'oklab'
  | 'oklch'
  | 'named'
  | 'transparent';

/**
 * The syntax family of a color string, or null when it isn't one we parse.
 * Used to re-emit an edited color in the spelling the user wrote it in.
 */
export function colorFamily(input: string): ColorFamily | null {
  const s = input.trim().toLowerCase();
  if (s.length === 0) return null;
  if (s === 'transparent') return 'transparent';
  if (s.startsWith('#')) return parseHex(s) === null ? null : 'hex';

  const fn = s.match(/^([a-z]+)\(/);
  if (fn) {
    switch (fn[1]) {
      case 'rgb':
      case 'rgba':
        return 'rgb';
      case 'hsl':
      case 'hsla':
        return 'hsl';
      case 'hwb':
        return 'hwb';
      case 'lab':
        return 'lab';
      case 'lch':
        return 'lch';
      case 'oklab':
        return 'oklab';
      case 'oklch':
        return 'oklch';
      default:
        return null;
    }
  }
  return NAMED_COLORS[s] ? 'named' : null;
}

/**
 * Return `input` with its alpha replaced, written in the SAME family it came
 * in as — hex stays hex (8-digit while translucent), `oklch()` stays `oklch()`.
 * Unparseable input is returned untouched so a half-typed value is never eaten.
 *
 * Two spellings cannot carry alpha and so have documented exits: a named color
 * becomes `rgb(r g b / a)` while translucent and keeps its name at alpha 1, and
 * `transparent` (which is only ever alpha 0) becomes hex once made opaque.
 */
export function setAlpha(input: string, alpha: number): string {
  const parsed = parseCssColor(input);
  if (parsed === null) return input;

  const a = clamp01(alpha);
  const f = allFormats({ rgb: parsed.rgb, alpha: a });

  switch (colorFamily(input) ?? 'hex') {
    case 'transparent':
      return a === 0 ? 'transparent' : f.hex;
    case 'named':
      // Keep the user's own spelling of the name rather than the canonical
      // one — `cyan` should not silently become `aqua`.
      return a >= 1 ? input.trim().toLowerCase() : f.rgb;
    case 'rgb':
      return f.rgb;
    case 'hsl':
      return f.hsl;
    case 'hwb':
      return f.hwb;
    case 'lab':
      return f.lab;
    case 'lch':
      return f.lch;
    case 'oklab':
      return f.oklab;
    case 'oklch':
      return f.oklch;
    case 'hex':
    default:
      return f.hex;
  }
}

/**
 * A canvas-safe `fillStyle` for a user-typed color, or null when the string is
 * not a color at all.
 *
 * Canvas silently paints an unassignable `fillStyle` with whatever the context
 * last had — opaque black in a fresh context — so a text field that invites
 * `transparent` and `red` needs a guard before it invites typos too. The
 * returned string is the normalized `rgb(r g b / a)` form rather than the
 * user's text, so what the canvas paints is exactly what the preview swatch
 * showed, in a spelling every engine accepts.
 */
export function resolveFillStyle(input: string): string | null {
  const parsed = parseCssColor(input);
  return parsed === null ? null : allFormats(parsed).rgb;
}

/* -------------------------------------------------------- named colors --- */

/** The CSS named colors (Color 4 §6.1). Verified against the browser. */
export const NAMED_COLORS: Record<string, string> = {
  aliceblue: '#f0f8ff', antiquewhite: '#faebd7', aqua: '#00ffff', aquamarine: '#7fffd4',
  azure: '#f0ffff', beige: '#f5f5dc', bisque: '#ffe4c4', black: '#000000',
  blanchedalmond: '#ffebcd', blue: '#0000ff', blueviolet: '#8a2be2', brown: '#a52a2a',
  burlywood: '#deb887', cadetblue: '#5f9ea0', chartreuse: '#7fff00', chocolate: '#d2691e',
  coral: '#ff7f50', cornflowerblue: '#6495ed', cornsilk: '#fff8dc', crimson: '#dc143c',
  cyan: '#00ffff', darkblue: '#00008b', darkcyan: '#008b8b', darkgoldenrod: '#b8860b',
  darkgray: '#a9a9a9', darkgreen: '#006400', darkgrey: '#a9a9a9', darkkhaki: '#bdb76b',
  darkmagenta: '#8b008b', darkolivegreen: '#556b2f', darkorange: '#ff8c00',
  darkorchid: '#9932cc', darkred: '#8b0000', darksalmon: '#e9967a', darkseagreen: '#8fbc8f',
  darkslateblue: '#483d8b', darkslategray: '#2f4f4f', darkslategrey: '#2f4f4f',
  darkturquoise: '#00ced1', darkviolet: '#9400d3', deeppink: '#ff1493', deepskyblue: '#00bfff',
  dimgray: '#696969', dimgrey: '#696969', dodgerblue: '#1e90ff', firebrick: '#b22222',
  floralwhite: '#fffaf0', forestgreen: '#228b22', fuchsia: '#ff00ff', gainsboro: '#dcdcdc',
  ghostwhite: '#f8f8ff', gold: '#ffd700', goldenrod: '#daa520', gray: '#808080',
  green: '#008000', greenyellow: '#adff2f', grey: '#808080', honeydew: '#f0fff0',
  hotpink: '#ff69b4', indianred: '#cd5c5c', indigo: '#4b0082', ivory: '#fffff0',
  khaki: '#f0e68c', lavender: '#e6e6fa', lavenderblush: '#fff0f5', lawngreen: '#7cfc00',
  lemonchiffon: '#fffacd', lightblue: '#add8e6', lightcoral: '#f08080', lightcyan: '#e0ffff',
  lightgoldenrodyellow: '#fafad2', lightgray: '#d3d3d3', lightgreen: '#90ee90',
  lightgrey: '#d3d3d3', lightpink: '#ffb6c1', lightsalmon: '#ffa07a', lightseagreen: '#20b2aa',
  lightskyblue: '#87cefa', lightslategray: '#778899', lightslategrey: '#778899',
  lightsteelblue: '#b0c4de', lightyellow: '#ffffe0', lime: '#00ff00', limegreen: '#32cd32',
  linen: '#faf0e6', magenta: '#ff00ff', maroon: '#800000', mediumaquamarine: '#66cdaa',
  mediumblue: '#0000cd', mediumorchid: '#ba55d3', mediumpurple: '#9370db',
  mediumseagreen: '#3cb371', mediumslateblue: '#7b68ee', mediumspringgreen: '#00fa9a',
  mediumturquoise: '#48d1cc', mediumvioletred: '#c71585', midnightblue: '#191970',
  mintcream: '#f5fffa', mistyrose: '#ffe4e1', moccasin: '#ffe4b5', navajowhite: '#ffdead',
  navy: '#000080', oldlace: '#fdf5e6', olive: '#808000', olivedrab: '#6b8e23',
  orange: '#ffa500', orangered: '#ff4500', orchid: '#da70d6', palegoldenrod: '#eee8aa',
  palegreen: '#98fb98', paleturquoise: '#afeeee', palevioletred: '#db7093',
  papayawhip: '#ffefd5', peachpuff: '#ffdab9', peru: '#cd853f', pink: '#ffc0cb',
  plum: '#dda0dd', powderblue: '#b0e0e6', purple: '#800080', rebeccapurple: '#663399',
  red: '#ff0000', rosybrown: '#bc8f8f', royalblue: '#4169e1', saddlebrown: '#8b4513',
  salmon: '#fa8072', sandybrown: '#f4a460', seagreen: '#2e8b57', seashell: '#fff5ee',
  sienna: '#a0522d', silver: '#c0c0c0', skyblue: '#87ceeb', slateblue: '#6a5acd',
  slategray: '#708090', slategrey: '#708090', snow: '#fffafa', springgreen: '#00ff7f',
  steelblue: '#4682b4', tan: '#d2b48c', teal: '#008080', thistle: '#d8bfd8',
  tomato: '#ff6347', turquoise: '#40e0d0', violet: '#ee82ee', wheat: '#f5deb3',
  white: '#ffffff', whitesmoke: '#f5f5f5', yellow: '#ffff00', yellowgreen: '#9acd32',
};

/** Reverse lookup for exact matches; grey aliases lose to the -ay spelling
 * deliberately (first writer wins). */
const HEX_TO_NAME: Record<string, string> = {};
for (const [name, hex] of Object.entries(NAMED_COLORS)) {
  if (!(hex in HEX_TO_NAME)) HEX_TO_NAME[hex] = name;
}
