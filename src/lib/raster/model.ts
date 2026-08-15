/**
 * Raster image editor session model. SESSION-ONLY by decision (plan §3.2):
 * binary image data cannot round-trip the JSON data layer, so nothing in this
 * tool may ever touch IndexedDB — the whole session lives in component state
 * and is gone on reload.
 *
 * Structure: a document (canvas size + background) holding a two-level layer
 * tree. TOP-LEVEL layers each render into their own buffer and composite
 * onto the canvas with their opacity + blend mode. CHILD layers apply to
 * their parent's buffer only: an eraser under an image erases just that
 * image, a crop under it clips just that image, a blur under it blurs just
 * that image. The same kinds at top level act on everything rendered below
 * them (the accumulated composite). See render.ts for the exact pipeline.
 */

export interface RasterPoint {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Canvas 2D globalCompositeOperation values the editor exposes. */
export type BlendMode = 'normal' | 'multiply' | 'overlay' | 'soft-light' | 'hard-light' | 'color';

export const BLEND_MODES: { id: BlendMode; label: string; hint: string }[] = [
  { id: 'normal', label: 'Normal', hint: 'Paints over what is below.' },
  { id: 'multiply', label: 'Multiply', hint: 'Darkens: multiplies with what is below.' },
  { id: 'overlay', label: 'Overlay', hint: 'Combines Multiply and Screen for contrast.' },
  { id: 'soft-light', label: 'Soft light', hint: 'Gentle dodge/burn depending on the layer tone.' },
  { id: 'hard-light', label: 'Hard light', hint: 'Strong dodge/burn — Multiply/Screen by the layer tone.' },
  { id: 'color', label: 'Color', hint: 'Keeps the luminosity below, takes the layer’s hue and saturation.' },
];

/** Fields every layer carries. `children` is only ever populated on top-level layers. */
interface LayerCommon {
  id: string;
  name: string;
  visible: boolean;
  /** 0-100. */
  opacity: number;
  blend: BlendMode;
  children: RasterLayer[];
}

/**
 * A decoded bitmap placed on the canvas. `source` is the decoded pixels
 * (session-only — never serialized); `quarter` counts 90° clockwise turns
 * applied when drawing; the layer draws into the (x, y, width, height) rect.
 */
export interface ImageLayer extends LayerCommon {
  kind: 'image';
  source: HTMLCanvasElement;
  /** Original file name (export default) — '' for generated content. */
  fileName: string;
  x: number;
  y: number;
  width: number;
  height: number;
  quarter: number;
}

/** A freehand stroke: paint composites normally, erase punches transparency
 * through the target (parent buffer, or everything below at top level). */
export interface StrokeLayer extends LayerCommon {
  kind: 'stroke';
  mode: 'paint' | 'erase';
  color: string;
  size: number;
  points: RasterPoint[];
}

export interface ArrowLayer extends LayerCommon {
  kind: 'arrow';
  from: RasterPoint;
  to: RasterPoint;
  color: string;
  size: number;
}

export interface TextLayer extends LayerCommon {
  kind: 'text';
  text: string;
  x: number;
  y: number;
  size: number;
  color: string;
  bold: boolean;
}

/** A rectangular region adjustment of the target. `amount` is 1-100:
 * opacity percent for darken/lighten, blur strength for blur. */
export interface AdjustLayer extends LayerCommon {
  kind: 'adjust';
  mode: 'darken' | 'lighten' | 'blur';
  rect: Rect;
  amount: number;
}

/** A crop: keeps only `rect` of the target (parent buffer, or everything
 * below at top level). Non-destructive — delete the layer to un-crop. */
export interface CropLayer extends LayerCommon {
  kind: 'crop';
  rect: Rect;
}

export type RasterLayer = ImageLayer | StrokeLayer | ArrowLayer | TextLayer | AdjustLayer | CropLayer;
export type RasterLayerKind = RasterLayer['kind'];

/** Layer kinds that ACT ON a target (parent buffer / composite below)
 * rather than contributing pixels of their own. */
export function isEffectLayer(layer: RasterLayer): boolean {
  return (
    layer.kind === 'crop' ||
    layer.kind === 'adjust' ||
    (layer.kind === 'stroke' && layer.mode === 'erase')
  );
}

/** Only non-image layers may nest (images are always top-level). */
export function canNest(layer: RasterLayer): boolean {
  return layer.kind !== 'image';
}

export interface RasterDocument {
  width: number;
  height: number;
  /** Canvas background color; null = transparent. */
  background: string | null;
}

export const MIN_CANVAS = 1;
export const MAX_CANVAS = 8192;

export function clampCanvas(v: number): number {
  return Math.min(MAX_CANVAS, Math.max(MIN_CANVAS, Math.round(Number.isFinite(v) ? v : MIN_CANVAS)));
}

export function layerLabel(layer: RasterLayer): string {
  switch (layer.kind) {
    case 'image':
      return layer.fileName || 'image';
    case 'stroke':
      return layer.mode === 'erase' ? 'eraser' : 'brush';
    case 'arrow':
      return 'arrow';
    case 'text':
      return `“${layer.text}”`;
    case 'adjust':
      return layer.mode;
    case 'crop':
      return 'crop';
  }
}

/** Common fields for a freshly created layer. */
export function layerDefaults(name: string): LayerCommon {
  return {
    id: crypto.randomUUID(),
    name,
    visible: true,
    opacity: 100,
    blend: 'normal',
    children: [],
  };
}

// ---- tree helpers (pure) ----------------------------------------------------

export interface LayerLocation {
  /** The array the layer lives in (top-level list or a parent's children). */
  list: RasterLayer[];
  index: number;
  parent: RasterLayer | null;
}

/** Find a layer anywhere in the two-level tree. */
export function locateLayer(layers: RasterLayer[], id: string): LayerLocation | null {
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i]!;
    if (l.id === id) return { list: layers, index: i, parent: null };
    for (let j = 0; j < l.children.length; j++) {
      if (l.children[j]!.id === id) return { list: l.children, index: j, parent: l };
    }
  }
  return null;
}

export function findLayer(layers: RasterLayer[], id: string): RasterLayer | null {
  const loc = locateLayer(layers, id);
  return loc ? (loc.list[loc.index] ?? null) : null;
}

/** Every layer, top-first (children listed right after their parent, top-first). */
export function flattenLayers(layers: RasterLayer[]): { layer: RasterLayer; parent: RasterLayer | null }[] {
  const out: { layer: RasterLayer; parent: RasterLayer | null }[] = [];
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i]!;
    out.push({ layer: l, parent: null });
    for (let j = l.children.length - 1; j >= 0; j--) out.push({ layer: l.children[j]!, parent: l });
  }
  return out;
}

/** Remove a layer (and, for a top-level layer, its children) from the tree. */
export function removeLayer(layers: RasterLayer[], id: string): RasterLayer | null {
  const loc = locateLayer(layers, id);
  if (!loc) return null;
  return loc.list.splice(loc.index, 1)[0] ?? null;
}

/**
 * Move a layer to a new position. `target` names a sibling list: top level
 * (`parentId: null`) or a top-level layer's children; `index` is the insert
 * position in that list (after removal). Images refuse to nest; a top-level
 * layer being nested drops its own children (they follow it as siblings
 * would be surprising — they are promoted to top level in its place).
 */
export function moveLayer(
  layers: RasterLayer[],
  id: string,
  target: { parentId: string | null; index: number }
): boolean {
  const loc = locateLayer(layers, id);
  if (!loc) return false;
  const layer = loc.list[loc.index]!;
  if (target.parentId !== null) {
    if (!canNest(layer) || target.parentId === id) return false;
    const parent = layers.find((l) => l.id === target.parentId);
    // Only CONTENT layers can host children — an effect layer's children
    // would never render (see render.ts).
    if (!parent || isEffectLayer(parent)) return false;
  }
  loc.list.splice(loc.index, 1);
  const dest = target.parentId === null ? layers : layers.find((l) => l.id === target.parentId)!.children;
  const idx = Math.max(0, Math.min(target.index, dest.length));
  if (target.parentId !== null && layer.children.length > 0) {
    // Promote its children to top level where the layer used to be.
    const promoted = layer.children.splice(0);
    const at = loc.parent === null ? loc.index : layers.indexOf(loc.parent) + 1;
    layers.splice(at, 0, ...promoted);
  }
  dest.splice(idx, 0, layer);
  return true;
}
