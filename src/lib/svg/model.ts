/**
 * SVG editor document/layer model — generalized from the local-sync-template
 * icon-editor seed (fixed 256x256, single `size`) to arbitrary canvases,
 * independent per-layer width/height, stroke options, and two new drawing
 * kinds (bezier line segments, editable polygons).
 *
 * Dependency-free on purpose: src/lib/db/types.ts imports the layer types for
 * the `svg_documents` store, so everything here must be plain JSON-native
 * data (no Dates, no Maps, no class instances) to round-trip the data layer
 * and JSON backups byte-identically.
 */

export type SvgLayerKind =
  | 'rect'
  | 'circle'
  | 'triangle'
  | 'star'
  | 'text'
  | 'svg'
  | 'line'
  | 'polygon';

export interface SvgPoint {
  x: number;
  y: number;
}

/**
 * A polygon vertex. `c` is an optional quadratic control point governing the
 * edge from this vertex to the NEXT one (relative to the layer center like
 * the vertex itself); null = straight edge. Any curved edge turns the
 * polygon into a closed <path>.
 */
export interface SvgVertex extends SvgPoint {
  c?: SvgPoint | null;
}

/**
 * One layer. (x, y) is the layer's center in canvas coordinates; width and
 * height are independent so shapes can be non-square. Kind-specific fields
 * are carried on every layer (flat shape, like the seed) so normalization
 * and JSON round-trips stay trivial.
 */
export interface SvgLayer {
  id: string;
  kind: SvgLayerKind;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number; // degrees, pivot = (x, y)
  /** Fill color; 'none' = unfilled. Ignored by 'line' and 'svg'. */
  fill: string;
  /** Stroke color; 'none' = no stroke. */
  stroke: string;
  stroke_width: number;
  /** rect only: corner radius. */
  radius: number;
  /** text only. */
  text: string;
  bold: boolean;
  /** svg only: pasted markup, embedded scaled-to-fit width x height. */
  svg: string;
  /**
   * polygon: vertices relative to (x, y) — dragging the layer moves only
   * (x, y), editing a vertex moves only its entry here. Each vertex may carry
   * a bezier control for the edge to the next vertex (see SvgVertex).
   * line: exactly two entries, the endpoints, also relative to (x, y).
   */
  points: SvgVertex[];
  /** line only: first bezier control point (relative). null = straight. */
  c1: SvgPoint | null;
  /** line only: second control point. Set only with c1 (cubic). */
  c2: SvgPoint | null;
}

/** Content fields of an `svg_documents` row (the row adds SyncFields). */
export interface SvgDocumentContent {
  name: string;
  width: number;
  height: number;
  /** Canvas background color; null = transparent. */
  background: string | null;
  layers: SvgLayer[];
}

export const MIN_CANVAS = 16;
export const MAX_CANVAS = 4096;

export function defaultDocumentContent(name: string): SvgDocumentContent {
  return { name, width: 256, height: 256, background: '#ffffff', layers: [] };
}

/** Vertices of a regular n-gon inscribed in a w x h box, first point up top. */
export function regularPolygonPoints(sides: number, width: number, height: number): SvgPoint[] {
  const n = Math.max(3, Math.round(sides));
  const pts: SvgPoint[] = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n - Math.PI / 2;
    pts.push({ x: round2((width / 2) * Math.cos(a)), y: round2((height / 2) * Math.sin(a)) });
  }
  return pts;
}

export function newLayer(kind: SvgLayerKind, canvasWidth: number, canvasHeight: number): SvgLayer {
  const size = Math.round(Math.min(canvasWidth, canvasHeight) * 0.5);
  const layer: SvgLayer = {
    id: crypto.randomUUID(),
    kind,
    x: Math.round(canvasWidth / 2),
    y: Math.round(canvasHeight / 2),
    width: size,
    height: size,
    rotation: 0,
    fill: kind === 'line' ? 'none' : '#f59e0b',
    stroke: kind === 'line' ? '#f59e0b' : 'none',
    stroke_width: 4,
    radius: 0,
    text: 'Aa',
    bold: true,
    svg: '',
    points: [],
    c1: null,
    c2: null,
  };
  if (kind === 'line') {
    layer.points = [
      { x: -Math.round(size / 2), y: 0 },
      { x: Math.round(size / 2), y: 0 },
    ];
  }
  if (kind === 'polygon') {
    layer.points = regularPolygonPoints(5, size, size);
  }
  if (kind === 'text') {
    // Height doubles as the font size; width is only a selection-box hint.
    layer.height = Math.max(12, Math.round(size / 2));
    layer.width = layer.height * 2;
    layer.fill = '#ffffff';
  }
  return layer;
}

const NUMERIC_LAYER_FIELDS = ['x', 'y', 'width', 'height', 'rotation', 'stroke_width', 'radius'] as const;

/**
 * Back-fill a stored/imported layer (older or partial shape) against the
 * defaults, so fields added after a document was saved never read undefined.
 * Non-finite numerics (an emptied number input binds `null`) fall back to
 * `fallback`'s value for that field when given — the last committed state —
 * else to the kind's defaults; sizes are kept ≥ 1 so a layer can't vanish.
 */
export function normalizeLayer(layer: Partial<SvgLayer>, fallback?: SvgLayer): SvgLayer {
  const base = fallback ?? newLayer(layer.kind ?? 'rect', 256, 256);
  const merged: SvgLayer = { ...base, ...layer, id: layer.id ?? base.id };
  for (const f of NUMERIC_LAYER_FIELDS) merged[f] = num(merged[f], base[f]);
  merged.width = Math.max(1, merged.width);
  merged.height = Math.max(1, merged.height);
  merged.stroke_width = Math.max(0, merged.stroke_width);
  merged.radius = Math.max(0, merged.radius);
  merged.points = Array.isArray(layer.points)
    ? layer.points.map((p) => {
        const v: SvgVertex = { x: num(p?.x, 0), y: num(p?.y, 0) };
        // Only carry the key when a control exists — keeps straight-edged
        // documents byte-identical to those saved before curves shipped.
        if (p?.c) v.c = { x: num(p.c.x, 0), y: num(p.c.y, 0) };
        return v;
      })
    : base.points;
  merged.c1 = layer.c1 ? { x: num(layer.c1.x, 0), y: num(layer.c1.y, 0) } : null;
  merged.c2 = layer.c2 ? { x: num(layer.c2.x, 0), y: num(layer.c2.y, 0) } : null;
  // A cubic control without a first control is unreachable via the UI; keep
  // the invariant so build.ts only has straight/quadratic/cubic to render.
  if (!merged.c1) merged.c2 = null;
  return merged;
}

/**
 * Back-fill a whole stored document's content (see normalizeLayer). With
 * `fallback` (the last committed content), invalid numerics revert to it
 * instead of the defaults — the editor runs every commit through this so an
 * emptied number field can never be persisted as null.
 */
export function normalizeDocumentContent(
  content: Partial<SvgDocumentContent>,
  fallback?: SvgDocumentContent
): SvgDocumentContent {
  const d = fallback ?? defaultDocumentContent(typeof content.name === 'string' ? content.name : 'Untitled');
  const prevLayers = new Map((fallback?.layers ?? []).map((l) => [l.id, l]));
  return {
    name: typeof content.name === 'string' ? content.name : d.name,
    width: clampCanvas(num(content.width, d.width)),
    height: clampCanvas(num(content.height, d.height)),
    // null is a deliberate "transparent"; only an absent/invalid field falls
    // back to the default background.
    background:
      content.background === null
        ? null
        : typeof content.background === 'string'
          ? content.background
          : d.background,
    layers: Array.isArray(content.layers)
      ? content.layers.map((l) => normalizeLayer(l, l.id ? prevLayers.get(l.id) : undefined))
      : [],
  };
}

export function clampCanvas(v: number): number {
  return Math.min(MAX_CANVAS, Math.max(MIN_CANVAS, Math.round(v)));
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
