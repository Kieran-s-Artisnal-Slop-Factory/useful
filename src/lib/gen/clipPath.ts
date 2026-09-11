/**
 * CSS `clip-path` building (0.6.0 Phase 5, decision 5): a shape description
 * in, the `clip-path:` declaration out, plus the geometry the page draws its
 * overlay from. Everything is a pure function of its arguments so the live
 * preview and the copied text can never disagree.
 *
 * Units. Every emitted value is a percentage of the clipped element's box,
 * so one string works at any size. That rules `path()` out as the primary
 * output: CSS `path()` coordinates are px of the element (no percent units,
 * no viewBox), so a `path()` clip only fits one element size. Blinds and
 * waves are therefore emitted as `polygon()` — a polygon can trace several
 * disjoint rectangles by walking back along a zero-width seam (the seam has
 * no area, so nothing between the strips is kept), and a wave is a polygon
 * sampled along the wavy edge. `wavePath()` still offers `path()` for the
 * one case it is nicer (a fixed-size element wanting fewer vertices).
 *
 * Coordinates: `[x, y]` in percent, origin top-left, y down — the CSS
 * `polygon()` convention and the overlay's `viewBox="0 0 100 100"`.
 */

export type Point = [number, number];

export interface Preset {
  id: string;
  label: string;
  /** Which reference site the point list was copied from (Q3). */
  source: 'cssportal' | 'design.dev';
  points: Point[];
}

/**
 * Point lists copied verbatim from the two reference generators at
 * implementation time (2026-09-10): every polygon preset on
 * https://www.cssportal.com/css-clip-path-generator/ (its `shapePresets`
 * table) plus **chevron** and the pointed **message** from
 * https://design.dev/tools/clip-path-shapes/. cssportal has its own
 * "Message" (a tab-style bubble), so the design.dev one is `message-pointed`.
 * The table is also in docs/dev/tools/clip-path.md.
 */
export const PRESETS: Preset[] = [
  { id: 'triangle', label: 'Triangle', source: 'cssportal', points: [[50, 0], [0, 100], [100, 100]] },
  { id: 'trapezoid', label: 'Trapezoid', source: 'cssportal', points: [[20, 0], [80, 0], [100, 100], [0, 100]] },
  { id: 'parallelogram', label: 'Parallelogram', source: 'cssportal', points: [[25, 0], [100, 0], [75, 100], [0, 100]] },
  { id: 'rhombus', label: 'Rhombus', source: 'cssportal', points: [[50, 0], [100, 50], [50, 100], [0, 50]] },
  { id: 'pentagon', label: 'Pentagon', source: 'cssportal', points: [[50, 0], [100, 38], [82, 100], [18, 100], [0, 38]] },
  { id: 'hexagon', label: 'Hexagon', source: 'cssportal', points: [[50, 0], [100, 25], [100, 75], [50, 100], [0, 75], [0, 25]] },
  { id: 'heptagon', label: 'Heptagon', source: 'cssportal', points: [[50, 0], [90, 20], [100, 60], [75, 100], [25, 100], [0, 60], [10, 20]] },
  { id: 'octagon', label: 'Octagon', source: 'cssportal', points: [[30, 0], [70, 0], [100, 30], [100, 70], [70, 100], [30, 100], [0, 70], [0, 30]] },
  { id: 'nonagon', label: 'Nonagon', source: 'cssportal', points: [[50, 0], [83, 12], [100, 43], [94, 78], [68, 100], [32, 100], [6, 78], [0, 43], [17, 12]] },
  { id: 'decagon', label: 'Decagon', source: 'cssportal', points: [[50, 0], [80, 10], [100, 35], [100, 70], [80, 90], [50, 100], [20, 90], [0, 70], [0, 35], [20, 10]] },
  { id: 'bevel', label: 'Bevel', source: 'cssportal', points: [[20, 0], [80, 0], [100, 20], [100, 80], [80, 100], [20, 100], [0, 80], [0, 20]] },
  { id: 'rabbet', label: 'Rabbet', source: 'cssportal', points: [[0, 15], [15, 15], [15, 0], [85, 0], [85, 15], [100, 15], [100, 85], [85, 85], [85, 100], [15, 100], [15, 85], [0, 85]] },
  { id: 'left-arrow', label: 'Left arrow', source: 'cssportal', points: [[40, 0], [40, 20], [100, 20], [100, 80], [40, 80], [40, 100], [0, 50]] },
  { id: 'right-arrow', label: 'Right arrow', source: 'cssportal', points: [[0, 20], [60, 20], [60, 0], [100, 50], [60, 100], [60, 80], [0, 80]] },
  { id: 'left-point', label: 'Left point', source: 'cssportal', points: [[25, 0], [100, 1], [100, 100], [25, 100], [0, 50]] },
  { id: 'right-point', label: 'Right point', source: 'cssportal', points: [[0, 0], [75, 0], [100, 50], [75, 100], [0, 100]] },
  { id: 'left-chevron', label: 'Left chevron', source: 'cssportal', points: [[100, 0], [75, 50], [100, 100], [25, 100], [0, 50], [25, 0]] },
  { id: 'right-chevron', label: 'Right chevron', source: 'cssportal', points: [[75, 0], [100, 50], [75, 100], [0, 100], [25, 50], [0, 0]] },
  { id: 'star', label: 'Star', source: 'cssportal', points: [[50, 0], [61, 35], [98, 35], [68, 57], [79, 91], [50, 70], [21, 91], [32, 57], [2, 35], [39, 35]] },
  { id: 'cross', label: 'Cross', source: 'cssportal', points: [[10, 25], [35, 25], [35, 0], [65, 0], [65, 25], [90, 25], [90, 50], [65, 50], [65, 100], [35, 100], [35, 50], [10, 50]] },
  { id: 'message', label: 'Message', source: 'cssportal', points: [[0, 0], [100, 0], [100, 75], [75, 75], [75, 100], [50, 75], [0, 75]] },
  { id: 'close', label: 'Close', source: 'cssportal', points: [[20, 0], [0, 20], [30, 50], [0, 80], [20, 100], [50, 70], [80, 100], [100, 80], [70, 50], [100, 20], [80, 0], [50, 30]] },
  { id: 'frame', label: 'Frame', source: 'cssportal', points: [[0, 0], [0, 100], [25, 100], [25, 25], [75, 25], [75, 75], [25, 75], [25, 100], [100, 100], [100, 0]] },
  { id: 'chevron', label: 'Chevron', source: 'design.dev', points: [[0, 0], [75, 0], [100, 50], [75, 100], [0, 100], [25, 50]] },
  { id: 'message-pointed', label: 'Message (pointed)', source: 'design.dev', points: [[0, 0], [100, 0], [100, 75], [50, 100], [0, 75]] },
];

export const presetById = (id: string): Preset | undefined => PRESETS.find((p) => p.id === id);

/** A deep copy of a preset's points, safe to hand to `$state`. */
export const presetPoints = (id: string): Point[] =>
  (presetById(id) ?? PRESETS[0]).points.map(([x, y]) => [x, y] as Point);

export type WaveKind = 'sine' | 'triangle' | 'square' | 'sawtooth';
export type WaveEdge = 'top' | 'bottom';
export type BlindsDirection = 'horizontal' | 'vertical';

export interface BlindsOptions {
  /** Number of strips, 1 or more. */
  count: number;
  /** Gap between strips in percent of the box (along the stacking axis). */
  gap: number;
  /** `horizontal` = bars stacked top to bottom; `vertical` = side by side. */
  direction: BlindsDirection;
}

export interface WaveOptions {
  /** Whole waves across the edge, 1 or more. */
  waves: number;
  /** Peak-to-trough height in percent of the box. */
  amplitude: number;
  /** Degrees, shifts the wave along the edge. */
  phase: number;
  edge: WaveEdge;
  kind: WaveKind;
}

export type Shape =
  | { type: 'polygon'; points: Point[] }
  | { type: 'circle'; radius: number; cx: number; cy: number }
  | { type: 'ellipse'; rx: number; ry: number; cx: number; cy: number }
  | ({ type: 'blinds' } & BlindsOptions)
  | ({ type: 'wave' } & WaveOptions);

export type ShapeType = Shape['type'];

export const DEFAULT_CIRCLE = { radius: 40, cx: 50, cy: 50 };
export const DEFAULT_ELLIPSE = { rx: 45, ry: 30, cx: 50, cy: 50 };
export const DEFAULT_BLINDS: BlindsOptions = { count: 5, gap: 6, direction: 'horizontal' };
export const DEFAULT_WAVE: WaveOptions = { waves: 3, amplitude: 14, phase: 0, edge: 'top', kind: 'sine' };

/** Two decimals, no trailing zeros — `33.33`, not `33.333333` or `33.00`. */
const fmt = (n: number): string => String(Math.round(n * 100) / 100);

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

// ---------------------------------------------------------------- CSS values

export function polygonCss(points: Point[]): string {
  return `polygon(${points.map(([x, y]) => `${fmt(x)}% ${fmt(y)}%`).join(', ')})`;
}

export function circleCss(radius: number, cx: number, cy: number): string {
  return `circle(${fmt(radius)}% at ${fmt(cx)}% ${fmt(cy)}%)`;
}

export function ellipseCss(rx: number, ry: number, cx: number, cy: number): string {
  return `ellipse(${fmt(rx)}% ${fmt(ry)}% at ${fmt(cx)}% ${fmt(cy)}%)`;
}

// ------------------------------------------------------------------- blinds

/** The strips as `[start, end]` along the stacking axis, in percent. */
export function blindsStrips({ count, gap }: BlindsOptions): [number, number][] {
  const n = Math.max(1, Math.round(count));
  // The gap can never eat the whole box: with n strips there are n - 1 gaps.
  const g = n === 1 ? 0 : clamp(gap, 0, 100 / (n - 1) - 0.01);
  const w = (100 - g * (n - 1)) / n;
  const strips: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const start = i * (w + g);
    strips.push([start, start + w]);
  }
  return strips;
}

/**
 * The blinds as ONE polygon. Each strip is traced as a rectangle; between
 * strips the outline walks along the box edge (x = 0 for horizontal bars,
 * y = 0 for vertical) and the closing edge walks back the same line. Those
 * two coincident runs enclose no area, so under either fill rule the gaps
 * stay outside and only the strips are kept.
 */
export function blindsPoints(opts: BlindsOptions): Point[] {
  const strips = blindsStrips(opts);
  const pts: Point[] = [];
  for (const [a, b] of strips) {
    if (opts.direction === 'horizontal') pts.push([0, a], [100, a], [100, b], [0, b]);
    else pts.push([a, 0], [a, 100], [b, 100], [b, 0]);
  }
  return pts;
}

export const blindsCss = (opts: BlindsOptions): string => polygonCss(blindsPoints(opts));

/**
 * The same strips as a `path()` — one closed subpath per rectangle. Kept for
 * completeness and the overlay; NOT the copied output, because `path()` is
 * in px (see the module comment).
 */
export function blindsPath(opts: BlindsOptions): string {
  const strips = blindsStrips(opts);
  const d = strips
    .map(([a, b]) =>
      opts.direction === 'horizontal'
        ? `M 0 ${fmt(a)} H 100 V ${fmt(b)} H 0 Z`
        : `M ${fmt(a)} 0 V 100 H ${fmt(b)} V 0 Z`,
    )
    .join(' ');
  return `path("${d}")`;
}

// -------------------------------------------------------------------- waves

/** Waveform in -1..1 over one period t in [0, 1). Every kind peaks at t = 0.25. */
export function waveform(kind: WaveKind, t: number): number {
  const u = ((t % 1) + 1) % 1;
  switch (kind) {
    case 'sine':
      return Math.sin(2 * Math.PI * u);
    case 'triangle':
      return u < 0.25 ? 4 * u : u < 0.75 ? 2 - 4 * u : 4 * u - 4;
    case 'square':
      return u < 0.5 ? 1 : -1;
    case 'sawtooth':
      // Rises through the period and drops at the end — peak just before t = 1.
      return 2 * u - 1;
  }
}

/** How many samples per wave each kind needs to look right. */
const SAMPLES_PER_WAVE: Record<WaveKind, number> = {
  sine: 16,
  triangle: 16,
  square: 16,
  sawtooth: 16,
};

/**
 * The wavy edge as `[x, y]` samples from x = 0 to x = 100 inclusive.
 * Straight-sided kinds get their exact corners added, so a square wave has
 * vertical steps instead of slopes and a sawtooth a clean drop.
 */
export function waveEdgePoints(opts: WaveOptions): Point[] {
  const waves = Math.max(1, Math.round(opts.waves));
  const half = clamp(opts.amplitude, 0, 100) / 2;
  const shift = (opts.phase / 360) % 1;
  const per = SAMPLES_PER_WAVE[opts.kind];
  const total = waves * per;
  const yOf = (t: number): number => {
    const v = waveform(opts.kind, t + shift);
    // The wave hugs its edge: the crest reaches the edge, the trough dips in.
    return opts.edge === 'top' ? half * (1 - v) : 100 - half * (1 - v);
  };
  const xs: number[] = [];
  for (let i = 0; i <= total; i++) xs.push(i / total);
  // Exact corners for the discontinuous kinds (in wave-period units).
  const corners: number[] = [];
  if (opts.kind === 'square') for (let w = 0; w <= waves; w++) corners.push(w - shift, w + 0.5 - shift);
  if (opts.kind === 'sawtooth') for (let w = 0; w <= waves; w++) corners.push(w - shift);
  if (opts.kind === 'triangle') for (let w = 0; w < waves; w++) corners.push(w + 0.25 - shift, w + 0.75 - shift);
  const pts: Point[] = [];
  const EPS = 1e-9;
  // x in box units, y sampled at a (possibly nudged) position along the wave.
  const push = (u: number, at = u) => pts.push([100 * u, yOf(waves * at)]);
  const cornerUs = corners.map((c) => c / waves).filter((u) => u > 0 && u <= 1).sort((a, b) => a - b);
  let ci = 0;
  for (const u of xs) {
    while (ci < cornerUs.length && cornerUs[ci] <= u + EPS) {
      const cu = cornerUs[ci++];
      if (opts.kind === 'triangle') {
        push(cu);
      } else {
        // A step: both sides of the jump at the same x, so the edge is
        // vertical. A step on the far edge only has a near side.
        push(cu, cu - EPS);
        if (cu < 1 - EPS) push(cu, cu + EPS);
      }
    }
    // A regular sample sitting exactly on a corner would only repeat it.
    if (ci > 0 && Math.abs(cornerUs[ci - 1] - u) <= EPS) continue;
    push(u);
  }
  // Two decimals keeps the CSS readable; the shape is unchanged at that scale.
  return pts.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100] as Point);
}

/** The full clip polygon: the wavy edge plus the two far corners. */
export function wavePoints(opts: WaveOptions): Point[] {
  const edge = waveEdgePoints(opts);
  return opts.edge === 'top' ? [...edge, [100, 100], [0, 100]] : [[0, 0], [100, 0], ...edge.slice().reverse()];
}

export const waveCss = (opts: WaveOptions): string => polygonCss(wavePoints(opts));

/**
 * The wave as `path()` in a 0–100 box — a secondary copy for a fixed-size
 * element. `path()` coordinates are px, so this only matches the preview
 * on a 100 × 100 px element; scale the numbers for anything else.
 */
export function wavePath(opts: WaveOptions): string {
  const pts = wavePoints(opts);
  const d = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${fmt(x)} ${fmt(y)}`).join(' ') + ' Z';
  return `path("${d}")`;
}

// ------------------------------------------------------------- entry point

export interface ClipPathResult {
  /** The `clip-path` VALUE, e.g. `polygon(...)`. */
  value: string;
  /** The full copyable declaration: `clip-path: <value>;`. */
  css: string;
  /** SVG `d` for the overlay outline in a `0 0 100 100` viewBox. */
  previewPath: string;
  /** Vertices for point-based shapes (polygon, blinds, wave); null otherwise. */
  points: Point[] | null;
  /** An alternative spelling worth a second copy button (waves: `path()`). */
  alternate: { label: string; css: string; note: string } | null;
}

const pathOf = (points: Point[]): string =>
  points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${fmt(x)} ${fmt(y)}`).join(' ') + ' Z';

export function clipPathCss(shape: Shape): ClipPathResult {
  switch (shape.type) {
    case 'polygon': {
      const value = polygonCss(shape.points);
      return { value, css: `clip-path: ${value};`, previewPath: pathOf(shape.points), points: shape.points, alternate: null };
    }
    case 'circle': {
      const value = circleCss(shape.radius, shape.cx, shape.cy);
      const { radius: r, cx, cy } = shape;
      // Two half-arcs make a full circle; the overlay's viewBox is 0–100 so
      // a percent radius maps 1:1 (the browser's circle() is measured
      // against the box's diagonal, so the preview outline is approximate
      // on a non-square box — see the doc).
      const previewPath = `M ${fmt(cx - r)} ${fmt(cy)} A ${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(cx + r)} ${fmt(cy)} A ${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(cx - r)} ${fmt(cy)} Z`;
      return { value, css: `clip-path: ${value};`, previewPath, points: null, alternate: null };
    }
    case 'ellipse': {
      const value = ellipseCss(shape.rx, shape.ry, shape.cx, shape.cy);
      const { rx, ry, cx, cy } = shape;
      const previewPath = `M ${fmt(cx - rx)} ${fmt(cy)} A ${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(cx + rx)} ${fmt(cy)} A ${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(cx - rx)} ${fmt(cy)} Z`;
      return { value, css: `clip-path: ${value};`, previewPath, points: null, alternate: null };
    }
    case 'blinds': {
      const points = blindsPoints(shape);
      const value = polygonCss(points);
      // The overlay draws the strips as separate rectangles (no seam lines).
      const previewPath = blindsPath(shape).slice('path("'.length, -'")'.length);
      return { value, css: `clip-path: ${value};`, previewPath, points, alternate: null };
    }
    case 'wave': {
      const points = wavePoints(shape);
      const value = polygonCss(points);
      return {
        value,
        css: `clip-path: ${value};`,
        previewPath: pathOf(points),
        points,
        alternate: {
          label: 'path() for a 100 × 100 px element',
          css: `clip-path: ${wavePath(shape)};`,
          note: 'path() coordinates are pixels, not percent — this spelling only fits a 100 × 100 px box. Scale the numbers for another size, or use the polygon() above.',
        },
      };
    }
  }
}
