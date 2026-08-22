/**
 * Filler images (0.3.0 phase 11).
 *
 * Eight generators, all SVG-first and all seeded: the same seed and the same
 * settings always draw the same picture, so a placeholder can be regenerated
 * on another machine and match. SVG-first because a placeholder is usually
 * flat colour and geometry — it stays a few kilobytes at any size, and the
 * PNG/JPG exports rasterize it through the shared image converter rather than
 * having a second drawing path.
 *
 * Nothing here reaches the network. Every pixel is drawn from the settings.
 */
import { escapeXml } from '../svg/build';
import { DEFAULT_GRADIENT, type GradientDef } from '../gen/gradient';
import { hslToRgb, rgbToHex, rgbToHsl } from '../gen/color';
import { mulberry32, pick, randomInt, seedFrom } from '../random';
import { SCENES, type SceneId } from './scenes';

export type GeneratorId =
  | 'solid'
  | 'heading'
  | 'gradient'
  | 'noise'
  | 'flow'
  | 'material'
  | 'planes'
  | 'icon'
  | 'scene';

export interface GeneratorInfo {
  id: GeneratorId;
  label: string;
  note: string;
}

export const GENERATORS: GeneratorInfo[] = [
  { id: 'solid', label: 'Plain colour', note: 'Grey by default — the honest placeholder.' },
  { id: 'heading', label: 'Colour with a caption', note: 'A heading and sub-heading, centred and fitted.' },
  { id: 'gradient', label: 'Gradient', note: 'The same gradients the gradient tool builds.' },
  { id: 'noise', label: 'Noise', note: 'Fractal turbulence, tinted and optionally blurred.' },
  { id: 'flow', label: 'Flow field', note: 'Seeded streamlines through a smooth field.' },
  { id: 'material', label: 'Layered geometry', note: 'Translucent polygons, in the style of the era.' },
  { id: 'planes', label: 'Cut planes', note: 'Big diagonal slabs that fill the frame.' },
  { id: 'icon', label: 'An icon', note: 'Any Lucide icon, on any background.' },
  { id: 'scene', label: 'A drawn scene', note: 'Nine hand-drawn scenes: nature, sport, city.' },
];

export interface ImageOptions {
  generator: GeneratorId;
  width: number;
  height: number;
  seed: string;
  background: string;
  /** Noise tint, flow-field stroke, icon and caption colour. */
  foreground: string;
  /** Noise: 0.002-0.05, the size of the grain. */
  frequency: number;
  /** Noise: standard deviation of the blur, 0 for none. */
  blur: number;
  /** Flow field: how many streamlines, 10-400. */
  density: number;
  /** Layered geometry and cut planes: 0.05-1, how solid the shapes are. */
  opacity: number;
  /** Icon: 0.1-0.95 of the shorter side. */
  iconScale: number;
  heading: string;
  subheading: string;
  /** Raw Lucide markup, fetched lazily by the page and passed in. */
  iconSvg: string | null;
  scene: SceneId;
  gradient: GradientDef;
}

export const MIN_SIDE = 16;
export const MAX_SIDE = 4096;

export const DEFAULT_IMAGE_OPTIONS: ImageOptions = {
  generator: 'solid',
  width: 1200,
  height: 675,
  seed: 'useful',
  background: '#cfd8e3',
  foreground: '#1e3a5f',
  frequency: 0.012,
  blur: 0,
  density: 90,
  opacity: 0.55,
  iconScale: 0.5,
  heading: '1200 × 675',
  subheading: 'placeholder',
  iconSvg: null,
  scene: 'mountains',
  gradient: DEFAULT_GRADIENT,
};

const clampSide = (n: number): number =>
  Number.isFinite(n) ? Math.min(MAX_SIDE, Math.max(MIN_SIDE, Math.round(n))) : MIN_SIDE;

const clampInt = (n: number, lo: number, hi: number): number =>
  Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : lo;

const clampUnit = (n: number, lo: number, hi: number): number =>
  Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;

const round = (n: number): number => Math.round(n * 100) / 100;

/** SVG has no conic gradient. Rather than silently drawing something else,
 * the page offers the two kinds SVG can draw and says why the third is
 * missing. */
export const SVG_GRADIENT_KINDS = ['linear', 'radial'] as const;

function gradientDefs(def: GradientDef, id: string): string {
  const stops = def.stops
    .map((stop, i) => {
      const offset = stop.position ?? (def.stops.length === 1 ? 0 : (i / (def.stops.length - 1)) * 100);
      return `<stop offset="${round(offset)}%" stop-color="${escapeXml(stop.color)}"/>`;
    })
    .join('');

  if (def.kind === 'radial') {
    return `<radialGradient id="${id}" cx="50%" cy="50%" r="70%">${stops}</radialGradient>`;
  }
  // CSS measures the angle clockwise from "up"; SVG wants a vector. This is
  // the same 90° offset the gradient tool's preview applies, so a def built
  // there draws the same way here.
  const radians = ((def.angle - 90) * Math.PI) / 180;
  const x = Math.cos(radians) / 2;
  const y = Math.sin(radians) / 2;
  return (
    `<linearGradient id="${id}" x1="${round(50 - x * 100)}%" y1="${round(50 - y * 100)}%" ` +
    `x2="${round(50 + x * 100)}%" y2="${round(50 + y * 100)}%">${stops}</linearGradient>`
  );
}

/** Font size that fits `text` across `width` in a sans-serif face. 0.55em per
 * character is the rule of thumb that has never let a caption overflow. */
export function fitFontSize(text: string, width: number, max: number): number {
  const length = Math.max(1, text.length);
  return round(Math.max(8, Math.min(max, (width * 0.86) / (length * 0.55))));
}

function solidLayer(options: ImageOptions, w: number, h: number): string {
  return `<rect width="${w}" height="${h}" fill="${escapeXml(options.background)}"/>`;
}

function headingLayer(options: ImageOptions, w: number, h: number): string {
  const heading = options.heading.trim();
  const sub = options.subheading.trim();
  const headSize = fitFontSize(heading || ' ', w, h * 0.22);
  const subSize = round(Math.max(8, headSize * 0.42));
  const gap = sub ? headSize * 0.75 : 0;
  const parts = [solidLayer(options, w, h)];
  const family = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  if (heading) {
    parts.push(
      `<text x="${w / 2}" y="${round(h / 2 - gap / 2)}" text-anchor="middle" dominant-baseline="central" ` +
        `font-family="${family}" font-size="${headSize}" font-weight="600" ` +
        `fill="${escapeXml(options.foreground)}">${escapeXml(heading)}</text>`
    );
  }
  if (sub) {
    parts.push(
      `<text x="${w / 2}" y="${round(h / 2 + gap)}" text-anchor="middle" dominant-baseline="central" ` +
        `font-family="${family}" font-size="${subSize}" opacity="0.75" ` +
        `fill="${escapeXml(options.foreground)}">${escapeXml(sub)}</text>`
    );
  }
  return parts.join('');
}

function gradientLayer(options: ImageOptions, w: number, h: number): string {
  const id = 'ph-gradient';
  return (
    `<defs>${gradientDefs(options.gradient, id)}</defs>` +
    `<rect width="${w}" height="${h}" fill="url(#${id})"/>`
  );
}

function noiseLayer(options: ImageOptions, w: number, h: number, seed: number): string {
  const frequency = round(Math.min(0.5, Math.max(0.001, options.frequency)));
  const blur = Math.max(0, options.blur);
  // feTurbulence's own seed is an integer; the filter is what makes the grain
  // reproducible, so it has to come from the page's seed rather than be left
  // to the renderer's default.
  const stages = [
    `<feTurbulence type="fractalNoise" baseFrequency="${frequency}" numOctaves="4" seed="${seed % 65536}"/>`,
    '<feColorMatrix type="saturate" values="0" result="mono"/>',
    `<feFlood flood-color="${escapeXml(options.foreground)}" result="tint"/>`,
    // arithmetic k1=1 multiplies the two, which tints the grey noise without
    // flattening its contrast the way a blend would.
    '<feComposite in="tint" in2="mono" operator="arithmetic" k1="1" k2="0" k3="0" k4="0"/>',
  ];
  if (blur > 0) stages.push(`<feGaussianBlur stdDeviation="${round(blur)}"/>`);
  return (
    `<defs><filter id="ph-noise" x="0" y="0" width="100%" height="100%">${stages.join('')}</filter></defs>` +
    solidLayer(options, w, h) +
    `<rect width="${w}" height="${h}" filter="url(#ph-noise)"/>`
  );
}

/**
 * Streamlines through a smooth field.
 *
 * The field is three sine terms with seeded phases rather than real Perlin
 * noise: it is a dozen lines of arithmetic, it is smooth everywhere, and at
 * this scale nobody can tell the difference.
 */
function flowLayer(options: ImageOptions, w: number, h: number, rng: () => number): string {
  const phases = [rng() * 10, rng() * 10, rng() * 10];
  const scale = 0.004 + rng() * 0.004;
  const angleAt = (x: number, y: number): number =>
    Math.sin(x * scale + phases[0]!) * 1.4 +
    Math.cos(y * scale + phases[1]!) * 1.4 +
    Math.sin((x + y) * scale * 0.6 + phases[2]!);

  const lines: string[] = [];
  // Density is the count of streamlines. Clamped at 400 because past that the
  // lines stop reading as lines and the file stops being small — 400 of them
  // is already ~300 KB of path data.
  const count = clampInt(options.density, 10, 400);
  const steps = 90;
  const step = Math.max(w, h) / 90;
  for (let i = 0; i < count; i++) {
    let x = rng() * w;
    let y = rng() * h;
    const points: string[] = [`M${round(x)} ${round(y)}`];
    for (let s = 0; s < steps; s++) {
      const angle = angleAt(x, y);
      x += Math.cos(angle) * step;
      y += Math.sin(angle) * step;
      if (x < -step || y < -step || x > w + step || y > h + step) break;
      points.push(`L${round(x)} ${round(y)}`);
    }
    if (points.length < 4) continue;
    lines.push(
      `<path d="${points.join(' ')}" fill="none" stroke="${escapeXml(options.foreground)}" ` +
        `stroke-width="${round(0.6 + rng() * 1.6)}" stroke-opacity="${round(0.25 + rng() * 0.5)}" ` +
        'stroke-linecap="round"/>'
    );
  }
  return solidLayer(options, w, h) + lines.join('');
}

/** The material-design palette both geometry generators draw from. */
const MATERIAL_PALETTE = ['#ef5350', '#ab47bc', '#42a5f5', '#26a69a', '#ffca28', '#8d6e63', '#78909c'];

/**
 * Layered translucent polygons — the flat, overlapping shapes of the
 * material-design era.
 *
 * `opacity` is the CENTRE of the range each shape draws from rather than a
 * flat value: shapes all at one opacity stop looking layered and start
 * looking like a single flat stencil, which is the thing this generator is
 * for.
 */
function materialLayer(options: ImageOptions, w: number, h: number, rng: () => number): string {
  const centre = clampUnit(options.opacity, 0.05, 1);
  const shapes: string[] = [];
  const count = randomInt(rng, 5, 9);
  for (let i = 0; i < count; i++) {
    const corners = randomInt(rng, 3, 5);
    const cx = rng() * w;
    const cy = rng() * h;
    const radius = (0.25 + rng() * 0.5) * Math.min(w, h);
    const points: string[] = [];
    for (let c = 0; c < corners; c++) {
      const angle = (c / corners) * Math.PI * 2 + rng() * 0.6;
      const r = radius * (0.6 + rng() * 0.6);
      points.push(`${round(cx + Math.cos(angle) * r)},${round(cy + Math.sin(angle) * r)}`);
    }
    const spread = Math.min(centre, 1 - centre) * 0.6;
    shapes.push(
      `<polygon points="${points.join(' ')}" fill="${pick(rng, MATERIAL_PALETTE)}" ` +
        `opacity="${round(clampUnit(centre + (rng() - 0.5) * 2 * spread, 0.03, 1))}"/>`
    );
  }
  return solidLayer(options, w, h) + shapes.join('');
}

/**
 * A palette built around one colour: two neighbouring hues, one much darker,
 * one much lighter.
 *
 * The cut-planes generator draws from this rather than from the fixed
 * material palette, because a few big slabs in unrelated colours look like a
 * mistake where a dozen small ones look playful. Deriving the set from the
 * chosen background also makes the Background picker mean something for this
 * generator — otherwise it only shows in the gaps.
 */
export function harmonise(background: string): string[] {
  const match = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(background.trim());
  const rgb: [number, number, number] = match
    ? [parseInt(match[1]!, 16) / 255, parseInt(match[2]!, 16) / 255, parseInt(match[3]!, 16) / 255]
    : [0.81, 0.85, 0.89];
  const [h, s] = rgbToHsl(rgb);
  // A grey background has no hue to build on, so the palette falls back to a
  // usable saturation rather than producing five greys.
  const saturation = Math.max(0.35, Math.min(0.85, s || 0.55));
  const at = (dh: number, l: number, ds = 0) =>
    rgbToHex(
      hslToRgb([
        (h + dh + 360) % 360,
        Math.max(0, Math.min(1, saturation + ds)),
        Math.max(0.08, Math.min(0.92, l)),
      ]) as [number, number, number]
    );
  return [at(0, 0.5), at(-28, 0.62, -0.1), at(24, 0.38), at(0, 0.14, 0.05), at(40, 0.78, -0.2)];
}

/**
 * Cut planes: a handful of big diagonal slabs that fill the frame.
 *
 * The sibling of `materialLayer` and its opposite — few shapes, each with
 * four corners, each big enough to run off the edge. Small polygons scattered
 * on a background read as confetti; the flat-design wallpapers this is after
 * are made of a few large planes overlapping at a consistent angle, with a
 * shadow where one crosses another.
 */
function planesLayer(options: ImageOptions, w: number, h: number, rng: () => number): string {
  const centre = clampUnit(options.opacity, 0.05, 1);
  const palette = harmonise(options.background);
  const diagonal = Math.hypot(w, h);
  // One angle for the whole picture, jittered per slab: parallel-ish edges
  // are what make it read as cut paper rather than as broken glass.
  const base = (rng() * Math.PI) / 2 + Math.PI / 8;
  const shapes: string[] = [];
  const count = randomInt(rng, 4, 6);

  for (let i = 0; i < count; i++) {
    const angle = base + (rng() - 0.5) * 0.5;
    const thickness = diagonal * (0.18 + rng() * 0.42);
    // A point the band runs through, biased towards the middle so no slab
    // ends up entirely off-frame.
    const cx = w * (0.15 + rng() * 0.7);
    const cy = h * (0.15 + rng() * 0.7);
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    // Perpendicular, half a thickness either way; along, far enough past the
    // corners that both ends leave the frame.
    const px = -dy * (thickness / 2);
    const py = dx * (thickness / 2);
    const ex = dx * diagonal;
    const ey = dy * diagonal;
    const corners = [
      [cx + px - ex, cy + py - ey],
      [cx + px + ex, cy + py + ey],
      [cx - px + ex, cy - py + ey],
      [cx - px - ex, cy - py - ey],
    ];
    const points = corners.map(([x, y]) => `${round(x!)},${round(y!)}`).join(' ');
    const spread = Math.min(centre, 1 - centre) * 0.4;
    shapes.push(
      `<polygon points="${points}" fill="${pick(rng, palette)}" ` +
        `opacity="${round(clampUnit(centre + (rng() - 0.5) * 2 * spread, 0.05, 1))}"/>`
    );
  }

  return (
    solidLayer(options, w, h) +
    // The shadow is what gives the slabs an order; without it they read as one
    // flat collage rather than as sheets laid over each other.
    `<defs><filter id="ph-plane-shadow" x="-20%" y="-20%" width="140%" height="140%">` +
    `<feDropShadow dx="0" dy="${round(diagonal * 0.006)}" stdDeviation="${round(diagonal * 0.004)}" ` +
    'flood-opacity="0.25"/></filter></defs>' +
    `<g filter="url(#ph-plane-shadow)">${shapes.join('')}</g>`
  );
}

function iconLayer(options: ImageOptions, w: number, h: number): string {
  const base = solidLayer(options, w, h);
  if (!options.iconSvg) return base;
  // Lucide icons are 24×24 and stroke-drawn, so the colour flows through
  // `stroke` on the wrapper rather than `fill`.
  const size = Math.min(w, h) * clampUnit(options.iconScale, 0.1, 0.95);
  const scale = size / 24;
  const inner = options.iconSvg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  return (
    base +
    `<g transform="translate(${round((w - size) / 2)} ${round((h - size) / 2)}) scale(${round(scale)})" ` +
    `fill="none" stroke="${escapeXml(options.foreground)}" stroke-width="2" stroke-linecap="round" ` +
    `stroke-linejoin="round">${inner}</g>`
  );
}

/**
 * One of the drawn scenes, scaled to fill.
 *
 * `preserveAspectRatio="xMidYMid slice"` on a nested `<svg>` is what makes one
 * drawing work at every aspect ratio: the scene keeps its proportions and the
 * frame crops it, exactly like `object-fit: cover`.
 */
function sceneLayer(options: ImageOptions, w: number, h: number): string {
  const scene = SCENES.find((s) => s.id === options.scene) ?? SCENES[0]!;
  return (
    `<rect width="${w}" height="${h}" fill="${escapeXml(scene.background)}"/>` +
    `<svg x="0" y="0" width="${w}" height="${h}" viewBox="${scene.viewBox}" ` +
    `preserveAspectRatio="xMidYMid slice">${scene.markup}</svg>`
  );
}

/** Build the placeholder as one standalone SVG document. */
export function buildImage(options: ImageOptions): string {
  const w = clampSide(options.width);
  const h = clampSide(options.height);
  const seed = seedFrom(options.seed);
  const rng = mulberry32(seed);

  let body: string;
  switch (options.generator) {
    case 'heading':
      body = headingLayer(options, w, h);
      break;
    case 'gradient':
      body = gradientLayer(options, w, h);
      break;
    case 'noise':
      body = noiseLayer(options, w, h, seed);
      break;
    case 'flow':
      body = flowLayer(options, w, h, rng);
      break;
    case 'material':
      body = materialLayer(options, w, h, rng);
      break;
    case 'planes':
      body = planesLayer(options, w, h, rng);
      break;
    case 'icon':
      body = iconLayer(options, w, h);
      break;
    case 'scene':
      body = sceneLayer(options, w, h);
      break;
    default:
      body = solidLayer(options, w, h);
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `${body}</svg>`
  );
}

/**
 * A batch: the same settings with the seed varied per item.
 *
 * The seed is what changes, so item 3 of a batch is exactly what you get by
 * typing that seed on its own — a batch is not a separate code path.
 */
export function buildBatch(options: ImageOptions, count: number): { name: string; svg: string }[] {
  const n = Number.isFinite(count) ? Math.min(50, Math.max(1, Math.trunc(count))) : 1;
  return Array.from({ length: n }, (_, i) => ({
    name: batchName(options, i + 1, n),
    svg: buildImage(i === 0 ? options : { ...options, seed: `${options.seed}-${i + 1}` }),
  }));
}

/** `noise-1200x675-03.svg` — generator, size, index, zero-padded so a file
 * listing sorts the way the batch was made. */
export function batchName(options: ImageOptions, index: number, total: number, extension = 'svg'): string {
  const width = clampSide(options.width);
  const height = clampSide(options.height);
  const pad = String(total).length;
  return `${options.generator}-${width}x${height}-${String(index).padStart(pad, '0')}.${extension}`;
}
