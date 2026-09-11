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
import { mulberry32, pick, randomInt, seedFrom, shuffled } from '../random';
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
  | 'scene'
  | 'mosaic'
  | 'swirl';

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
  { id: 'mosaic', label: 'Mosaic', note: 'Blocks from up to four colours, with pieces cut out.' },
  { id: 'swirl', label: 'Swirl', note: 'A two-tone spiral, turns and arm width to taste.' },
];

/** The mosaic and swirl default: warm, cool, and a dark to anchor them. */
export const DEFAULT_PALETTE = ['#e76f51', '#f4a261', '#2a9d8f', '#264653'];
export const MAX_PALETTE = 4;

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
  /** Mosaic and swirl: 1–4 colours. Mosaic paints every block from it; swirl
   * uses the first two (the second falls back to the background). */
  palette: string[];
  /** Mosaic: block side as a percent of the shorter side, 2–50. */
  blockSize: number;
  /** Mosaic: 0–1, the share of blocks cut out to the background. */
  cutRatio: number;
  /** Swirl: how many times the spiral goes round before it leaves the frame, 1–12. */
  turns: number;
  /** Swirl: 0.1–0.9, the share of each turn painted in the first colour. */
  armWidth: number;
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
  palette: DEFAULT_PALETTE,
  blockSize: 8,
  cutRatio: 0.25,
  turns: 3,
  armWidth: 0.5,
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

/** The palette as the generators read it: blanks dropped, at most four, and
 * the default when nothing is left — a mosaic with no colours is no mosaic. */
export function paletteOf(options: ImageOptions): string[] {
  const colours = (options.palette ?? []).map((c) => c.trim()).filter((c) => c.length > 0);
  return (colours.length > 0 ? colours : DEFAULT_PALETTE).slice(0, MAX_PALETTE);
}

/**
 * A mosaic: a grid of square blocks, each painted from the palette or cut
 * out to the background.
 *
 * Two things stop it reading as a checkerboard with holes. The cut-outs are
 * biased by a smooth seeded field, so they gather into missing patches
 * rather than salt-and-pepper, and every painted block is inset by a seeded
 * amount, so the tiles sit at slightly different sizes with the background
 * showing between them like grout. `cutRatio` 0 paints every block and 1
 * paints none, exactly — the bias only moves the odds in between.
 */
function mosaicLayer(options: ImageOptions, w: number, h: number, rng: () => number): string {
  const palette = paletteOf(options).map(escapeXml);
  const short = Math.min(w, h);
  const block = Math.max(2, (short * clampUnit(options.blockSize, 2, 50)) / 100);
  const cutRatio = clampUnit(options.cutRatio, 0, 1);
  const cols = Math.ceil(w / block);
  const rows = Math.ceil(h / block);
  // Centre the grid so a partial block, if any, is split between both edges.
  const ox = (w - cols * block) / 2;
  const oy = (h - rows * block) / 2;
  const phases = [rng() * 10, rng() * 10, rng() * 10];
  const scale = (2.5 + rng() * 2) / Math.max(cols, rows);
  const field = (c: number, r: number): number =>
    (Math.sin(c * scale + phases[0]!) + Math.cos(r * scale + phases[1]!) + Math.sin((c - r) * scale * 0.7 + phases[2]!)) / 3;

  const blocks: string[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Always the same rng calls per block, so one block's outcome never
      // shifts its neighbours': the odds move with the field, not the draws.
      const roll = rng();
      const colour = pick(rng, palette)!;
      const inset = rng() * block * 0.1;
      const odds = cutRatio <= 0 ? 0 : cutRatio >= 1 ? 1 : clampUnit(cutRatio + field(c, r) * 0.35, 0, 1);
      if (roll < odds) continue;
      const x = ox + c * block + inset;
      const y = oy + r * block + inset;
      const side = block - inset * 2;
      blocks.push(`<rect x="${round(x)}" y="${round(y)}" width="${round(side)}" height="${round(side)}" fill="${colour}"/>`);
    }
  }
  return solidLayer(options, w, h) + blocks.join('');
}

/**
 * A two-tone swirl: one logarithmic spiral, drawn twice.
 *
 * The frame is painted the second colour, then one filled band in the first
 * colour: the region between the spiral r = r₀·e^(kθ) and the same spiral
 * turned by `armWidth` of a revolution. Rotating a log spiral never makes it
 * cross itself, so the band is one simple path, and because the strip is
 * measured in angle its share of every turn is `armWidth` at every radius —
 * the arms stay in proportion from the centre to the corners. `k` is chosen
 * so the spiral reaches the far corner after exactly `turns` revolutions;
 * beyond that the path carries on off-frame, which is what closes it without
 * a chord across the picture.
 */
function swirlLayer(options: ImageOptions, w: number, h: number, rng: () => number): string {
  const palette = paletteOf(options).map(escapeXml);
  const arm = palette[0]!;
  const rest = palette[1] ?? escapeXml(options.background);
  const turns = clampUnit(options.turns, 1, 12);
  const phi = clampUnit(options.armWidth, 0.1, 0.9) * Math.PI * 2;
  // Seeded: where the spiral starts, which way it winds, and a nudge off
  // dead centre so two seeds are not the same picture rotated.
  const start = rng() * Math.PI * 2;
  const wind = rng() < 0.5 ? 1 : -1;
  const cx = w / 2 + (rng() - 0.5) * w * 0.1;
  const cy = h / 2 + (rng() - 0.5) * h * 0.1;
  const reach = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy)) * 1.02;
  const r0 = reach / 400;
  const theta = turns * Math.PI * 2;
  const k = Math.log(reach / r0) / theta;
  const radius = (t: number): number => r0 * Math.exp(k * t);
  const at = (t: number, angle: number): string =>
    `${round(cx + radius(t) * Math.cos(start + wind * angle))} ${round(cy + radius(t) * Math.sin(start + wind * angle))}`;

  const step = (Math.PI * 2) / 96;
  const end = theta + phi;
  const outward: string[] = [];
  for (let t = 0; t <= end; t += step) outward.push(at(t, t));
  outward.push(at(end, end));
  // Round the far end at a radius that is already off-frame, then trace the
  // turned spiral back to the centre.
  const rim: string[] = [];
  for (let a = end - step; a > theta; a -= step) rim.push(at(end, a));
  const inward: string[] = [];
  for (let t = end; t >= 0; t -= step) inward.push(at(t, t - phi));
  inward.push(at(0, -phi));

  const d = `M${outward.join(' L')} L${[...rim, ...inward].join(' L')} Z`;
  return (
    `<rect width="${w}" height="${h}" fill="${rest}"/>` +
    `<path d="${d}" fill="${arm}"/>`
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
    case 'mosaic':
      body = mosaicLayer(options, w, h, rng);
      break;
    case 'swirl':
      body = swirlLayer(options, w, h, rng);
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
 * How a batch may differ from item to item (0.6.0 phase 6).
 *
 * Everything off is the default, and with everything off a batch is exactly
 * what it was before this type existed: the seed varied per item and nothing
 * else. Each rule is one line of the TODO: a `null`/`false` is off, anything
 * else is the rule's parameter. Rules for a generator that is not selected
 * change fields that generator never reads, so passing them all is harmless.
 */
export interface BatchVariation {
  /** One size per item: `sizes[i]` applies to item `i`, item 0 included. A
   * shorter list leaves the remaining items at the base size. */
  sizes: { width: number; height: number }[] | null;
  /** A seeded random background per item. */
  background: boolean;
  /** A seeded random `foreground` (the ink) per item. */
  ink: boolean;
  /** Gradient: item `i` adds `i × offset` degrees to the angle, wrapping at 360. */
  angleOffset: number | null;
  /** Gradient: a random first stop, re-rolled until it differs from the second. */
  stop1: boolean;
  /** Gradient: a random second stop, re-rolled until it differs from the first. */
  stop2: boolean;
  /** Gradient: linear → radial → linear… from the base kind. SVG has no conic
   * gradient, so there are two kinds to cycle through, not three. */
  cycleKind: boolean;
  /** Noise: item `i` adds `i × delta` to the grain, clamped to 0.002–0.08. */
  grainDelta: number | null;
  /** Noise: item `i` adds `i × delta` to the blur, clamped to 0–8. */
  blurDelta: number | null;
  /** Twelve random alphanumerics as the seed, per item. */
  randomSeed: boolean;
  /** Flow field: item `i` adds `i × delta` lines; past 400 it wraps back to
   * `0 + remainder`. */
  lineDelta: number | null;
  /** Layered geometry and cut planes: item `i` adds `i × delta` opacity,
   * clamped to 0.05–1. */
  opacityDelta: number | null;
  /** Icon: item `i` adds `i × delta` to the scale; past 0.95 it wraps back to
   * `0 + remainder`, with a floor of 0.1 so the icon never vanishes. */
  sizeDelta: number | null;
  /** Icon: Lucide markup already resolved by the page (this module never
   * fetches); item `i` draws `randomIcon[i % length]`. */
  randomIcon: string[] | null;
  /** Scene: the allowed scenes, one picked per item. */
  scenes: SceneId[] | null;
  /** Mosaic: item `i` adds `i × delta` percent to the block size, clamped to
   * the slider's 2–25. */
  blockSizeDelta: number | null;
  /** Mosaic: item `i` adds `i × delta` to the cut-out share, clamped to 0–1. */
  cutRatioDelta: number | null;
  /** Mosaic and swirl: `shuffle` deals each item its colours from a pool
   * (`shufflePool`, or the base palette when that is empty — the same
   * colours in a new order, so a batch stays one family); `random` draws new
   * ones, as many as the base palette has. */
  palette: 'off' | 'shuffle' | 'random';
  /** The pool `shuffle` deals from (feedback round 2). Empty means the
   * generator's own palette; a bigger pool lets each image take a different
   * subset. Blanks are dropped; the page caps it at `MAX_SHUFFLE_POOL`. */
  shufflePool: string[];
}

export const DEFAULT_BATCH_VARIATION: BatchVariation = {
  sizes: null,
  background: false,
  ink: false,
  angleOffset: null,
  stop1: false,
  stop2: false,
  cycleKind: false,
  grainDelta: null,
  blurDelta: null,
  randomSeed: false,
  lineDelta: null,
  opacityDelta: null,
  sizeDelta: null,
  randomIcon: null,
  scenes: null,
  blockSizeDelta: null,
  cutRatioDelta: null,
  palette: 'off',
  shufflePool: [],
};

/** The most colours the page lets into the shuffle pool. The library takes
 * any length; this is a UI cap so the row of fields stays a row. */
export const MAX_SHUFFLE_POOL = 8;

/** Bounds the deltas clamp or wrap to — the same ones the page's sliders use. */
export const VARIATION_BOUNDS = {
  frequency: [0.002, 0.08],
  blur: [0, 8],
  density: [10, 400],
  opacity: [0.05, 1],
  iconScale: [0.1, 0.95],
  blockSize: [2, 25],
  cutRatio: [0, 1],
} as const;

/** The long side of a randomized batch size: wide enough to be a real
 * placeholder, small enough that a PNG batch of fifty still rasterizes. */
export const RANDOM_SIZE_RANGE = [200, 2000] as const;

/**
 * `n` seeded random sizes for the sizes table (feedback round 1).
 *
 * With `keepRatio` the long side is rolled and the short side follows the
 * base's proportions, so a 16:9 base gives `n` 16:9 sizes at different
 * scales; without it both sides are rolled on their own. Pure — the page
 * calls it with an rng from the batch seed and the numbers land in the
 * table, where they stay editable; `buildBatch` only ever reads the table.
 */
export function randomSizes(
  base: { width: number; height: number },
  n: number,
  keepRatio: boolean,
  rng: () => number
): { width: number; height: number }[] {
  const count = Number.isFinite(n) ? Math.min(50, Math.max(1, Math.trunc(n))) : 1;
  const bw = clampSide(base.width);
  const bh = clampSide(base.height);
  const [lo, hi] = RANDOM_SIZE_RANGE;
  return Array.from({ length: count }, () => {
    if (!keepRatio) return { width: randomInt(rng, lo, hi), height: randomInt(rng, lo, hi) };
    const long = randomInt(rng, lo, hi);
    const short = clampSide((long * Math.min(bw, bh)) / Math.max(bw, bh));
    return bw >= bh ? { width: long, height: short } : { width: short, height: long };
  });
}

const SEED_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** Twelve alphanumerics from the rng — a seed someone could have typed. */
export function randomSeedText(rng: () => number): string {
  return Array.from({ length: 12 }, () => SEED_ALPHABET[Math.floor(rng() * SEED_ALPHABET.length)]).join('');
}

/** A random colour that reads as a colour rather than as mud: any hue, a
 * middling saturation and lightness. */
export function randomColor(rng: () => number): string {
  return rgbToHex(hslToRgb([rng() * 360, 0.35 + rng() * 0.5, 0.3 + rng() * 0.45]) as [number, number, number]);
}

/**
 * `k` colours dealt from `pool`: a Fisher–Yates shuffle of the pool (the
 * shared `shuffled`, so one rng call per swap) and the first `k` of it. A
 * pool larger than `k` yields a different subset per call; a pool smaller
 * than `k` CYCLES — the shuffled pool repeats until `k` is reached, so a
 * two-colour pool dealt to a four-colour mosaic gives `[a, b, a, b]` in
 * some order. An empty pool yields an empty list; the caller falls back.
 * Pure: the same rng state and inputs give the same answer.
 */
export function shufflePalette(pool: readonly string[], k: number, rng: () => number): string[] {
  if (pool.length === 0 || k <= 0) return [];
  const dealt = shuffled(rng, pool);
  return Array.from({ length: k }, (_, i) => dealt[i % dealt.length]!);
}

/** Past `max`, back to zero plus the remainder — the TODO's wrap rule. */
const wrapPast = (value: number, max: number): number => (value > max ? value % max : value);

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/**
 * Item `i` of `n`'s options, derived from the base by the rules in
 * `variation`. Pure: the same rng state and inputs give the same answer,
 * which is what makes a varied batch reproducible.
 *
 * Only an enabled rule pulls from the rng, so turning one rule on does not
 * reshuffle the others' results. Rules are applied in a fixed order (sizes,
 * background, ink, gradient, noise, seed, lines, opacity, icon, scene,
 * mosaic, palette) for the same reason.
 */
export function varyOptions(
  base: ImageOptions,
  i: number,
  n: number,
  variation: BatchVariation,
  rng: () => number
): ImageOptions {
  const out: ImageOptions = {
    ...base,
    gradient: { ...base.gradient, stops: base.gradient.stops.map((s) => ({ ...s })) },
    palette: [...base.palette],
  };
  // `n` is part of the signature so a rule can depend on the batch size (a
  // future "spread evenly" rule would); none of the current ones do.
  void n;

  const size = variation.sizes?.[i];
  if (size) {
    out.width = clampSide(size.width);
    out.height = clampSide(size.height);
  }
  if (variation.background) out.background = randomColor(rng);
  if (variation.ink) out.foreground = randomColor(rng);

  if (variation.angleOffset !== null) {
    const angle = base.gradient.angle + i * variation.angleOffset;
    out.gradient.angle = ((angle % 360) + 360) % 360;
  }
  const rerollStop = (index: number, other: number) => {
    const stop = out.gradient.stops[index];
    if (!stop) return;
    const avoid = out.gradient.stops[other]?.color;
    let color = randomColor(rng);
    while (color === avoid) color = randomColor(rng);
    stop.color = color;
  };
  if (variation.stop1) rerollStop(0, 1);
  if (variation.stop2) rerollStop(1, 0);
  if (variation.cycleKind) {
    const start = Math.max(0, SVG_GRADIENT_KINDS.indexOf(base.gradient.kind as (typeof SVG_GRADIENT_KINDS)[number]));
    out.gradient.kind = SVG_GRADIENT_KINDS[(start + i) % SVG_GRADIENT_KINDS.length]!;
  }

  if (variation.grainDelta !== null) {
    out.frequency = round3(clampUnit(base.frequency + i * variation.grainDelta, ...VARIATION_BOUNDS.frequency));
  }
  if (variation.blurDelta !== null) {
    out.blur = round3(clampUnit(base.blur + i * variation.blurDelta, ...VARIATION_BOUNDS.blur));
  }

  if (variation.randomSeed) out.seed = randomSeedText(rng);

  if (variation.lineDelta !== null) {
    out.density = Math.round(wrapPast(base.density + i * variation.lineDelta, VARIATION_BOUNDS.density[1]));
  }
  if (variation.opacityDelta !== null) {
    out.opacity = round3(clampUnit(base.opacity + i * variation.opacityDelta, ...VARIATION_BOUNDS.opacity));
  }

  if (variation.sizeDelta !== null) {
    const wrapped = wrapPast(round3(base.iconScale + i * variation.sizeDelta), VARIATION_BOUNDS.iconScale[1]);
    out.iconScale = round3(Math.max(VARIATION_BOUNDS.iconScale[0], wrapped));
  }
  if (variation.randomIcon && variation.randomIcon.length > 0) {
    out.iconSvg = variation.randomIcon[i % variation.randomIcon.length]!;
  }

  if (variation.scenes && variation.scenes.length > 0) {
    out.scene = pick(rng, variation.scenes)!;
  }

  if (variation.blockSizeDelta !== null) {
    out.blockSize = round3(clampUnit(base.blockSize + i * variation.blockSizeDelta, ...VARIATION_BOUNDS.blockSize));
  }
  if (variation.cutRatioDelta !== null) {
    out.cutRatio = round3(clampUnit(base.cutRatio + i * variation.cutRatioDelta, ...VARIATION_BOUNDS.cutRatio));
  }

  if (variation.palette === 'shuffle') {
    // The generator's own colours are the pool unless a bigger one was
    // given; each item takes as many as the generator uses — two for the
    // swirl, the (cleaned, capped) palette's count for the mosaic.
    const own = paletteOf(base);
    const given = (variation.shufflePool ?? []).map((c) => c.trim()).filter((c) => c.length > 0);
    const pool = given.length > 0 ? given : own;
    // A one-colour pool leaves the swirl one colour and its background, as
    // the panel does, rather than cycling to the same colour twice.
    const k = base.generator === 'swirl' ? Math.min(2, pool.length) : own.length;
    out.palette = shufflePalette(pool, k, rng);
  }
  if (variation.palette === 'random') out.palette = base.palette.map(() => randomColor(rng));

  return out;
}

export interface BatchItem {
  name: string;
  svg: string;
  /** The options item `i` was drawn from — the page rasterizes and names PNGs
   * from these, so a varied size comes out at that size. */
  options: ImageOptions;
}

/**
 * A batch: the same settings with the seed varied per item, and optionally
 * more — see `BatchVariation`.
 *
 * The seed is what changes by default, so item 3 of a batch is exactly what
 * you get by typing that seed on its own — a batch is not a separate code
 * path. `varyOptions` runs for every item, item 0 included, so `sizes[0]`
 * applies to the first image. The variation rng is seeded from the base seed
 * (`seed + ':batch'`) once per batch, so a varied batch is as reproducible as
 * a plain one.
 */
export function buildBatch(
  options: ImageOptions,
  count: number,
  variation: BatchVariation = DEFAULT_BATCH_VARIATION
): BatchItem[] {
  const n = Number.isFinite(count) ? Math.min(50, Math.max(1, Math.trunc(count))) : 1;
  const rng = mulberry32(seedFrom(`${options.seed}:batch`));
  return Array.from({ length: n }, (_, i) => {
    const seeded = i === 0 ? options : { ...options, seed: `${options.seed}-${i + 1}` };
    const varied = varyOptions(seeded, i, n, variation, rng);
    return { name: batchName(varied, i + 1, n), svg: buildImage(varied), options: varied };
  });
}

/** `noise-1200x675-03.svg` — generator, size, index, zero-padded so a file
 * listing sorts the way the batch was made. */
export function batchName(options: ImageOptions, index: number, total: number, extension = 'svg'): string {
  const width = clampSide(options.width);
  const height = clampSide(options.height);
  const pad = String(total).length;
  return `${options.generator}-${width}x${height}-${String(index).padStart(pad, '0')}.${extension}`;
}
