/**
 * Pure geometry for the raster editor's non-destructive rotate/crop model.
 *
 * The displayed document is crop(rotate(original)). Annotation layers are
 * stored in DOCUMENT space, so every rotate/crop action remaps them through
 * these helpers instead of baking pixels. All functions are side-effect-free
 * and unit-tested; the canvas work lives in render.ts.
 *
 * Convention: image coordinates, origin top-left, x right, y down. `quarter`
 * counts 90° CLOCKWISE turns (0-3).
 */
import type { ArrowLayer, RasterLayer, RasterPoint, Rect } from './model';

/** Dimensions of a w x h image after `quarter` clockwise turns. */
export function rotatedSize(w: number, h: number, quarter: number): { w: number; h: number } {
  return quarter % 2 === 0 ? { w, h } : { w: h, h: w };
}

/**
 * Map a point in a w x h space through ONE 90° clockwise turn (the space
 * becomes h x w): the top-left corner lands at the new top-right.
 */
export function rotatePointCW(p: RasterPoint, _w: number, h: number): RasterPoint {
  return { x: h - p.y, y: p.x };
}

/** Inverse of rotatePointCW: one counter-clockwise turn of a w x h space. */
export function rotatePointCCW(p: RasterPoint, w: number, _h: number): RasterPoint {
  return { x: p.y, y: w - p.x };
}

/** Map a rect through one clockwise turn of its w x h space. */
export function rotateRectCW(r: Rect, w: number, h: number): Rect {
  // The rect's bottom-left corner becomes the rotated rect's top-left.
  const p = rotatePointCW({ x: r.x, y: r.y + r.h }, w, h);
  return { x: p.x, y: p.y, w: r.h, h: r.w };
}

/** Normalize a drag rectangle (any two corners) to positive width/height. */
export function normalizeRect(a: RasterPoint, b: RasterPoint): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

/** Clamp a rect to a w x h space, rounding to whole pixels (≥1 x 1). */
export function clampRect(r: Rect, w: number, h: number): Rect {
  const x = Math.min(Math.max(0, Math.round(r.x)), Math.max(0, w - 1));
  const y = Math.min(Math.max(0, Math.round(r.y)), Math.max(0, h - 1));
  return {
    x,
    y,
    w: Math.max(1, Math.min(Math.round(r.w), w - x)),
    h: Math.max(1, Math.min(Math.round(r.h), h - y)),
  };
}

/** One layer through one clockwise turn of its w x h document space. */
export function rotateLayerCW(layer: RasterLayer, w: number, h: number): RasterLayer {
  switch (layer.kind) {
    case 'stroke':
      return { ...layer, points: layer.points.map((p) => rotatePointCW(p, w, h)) };
    case 'arrow':
      return {
        ...layer,
        from: rotatePointCW(layer.from, w, h),
        to: rotatePointCW(layer.to, w, h),
      };
    case 'text': {
      const p = rotatePointCW({ x: layer.x, y: layer.y }, w, h);
      return { ...layer, x: p.x, y: p.y };
    }
    case 'adjust':
      return { ...layer, rect: rotateRectCW(layer.rect, w, h) };
  }
}

/** Shift a layer by (dx, dy) — the crop/uncrop remap. */
export function shiftLayer(layer: RasterLayer, dx: number, dy: number): RasterLayer {
  switch (layer.kind) {
    case 'stroke':
      return { ...layer, points: layer.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
    case 'arrow':
      return {
        ...layer,
        from: { x: layer.from.x + dx, y: layer.from.y + dy },
        to: { x: layer.to.x + dx, y: layer.to.y + dy },
      };
    case 'text':
      return { ...layer, x: layer.x + dx, y: layer.y + dy };
    case 'adjust':
      return { ...layer, rect: { ...layer.rect, x: layer.rect.x + dx, y: layer.rect.y + dy } };
  }
}

/** Length of an arrow's head, scaled with stroke size but never invisible. */
export function arrowHeadLength(size: number): number {
  return Math.max(10, size * 3.5);
}

/**
 * The three corners of an arrowhead triangle pointing at `to`.
 * Returns [tip, left wing, right wing]; degenerate arrows point right.
 */
export function arrowHeadPoints(from: RasterPoint, to: RasterPoint, size: number): RasterPoint[] {
  const angle =
    from.x === to.x && from.y === to.y ? 0 : Math.atan2(to.y - from.y, to.x - from.x);
  const len = arrowHeadLength(size);
  const wing = 0.46; // radians off the shaft — a reasonably pointy head
  const at = (a: number): RasterPoint => ({
    x: to.x - len * Math.cos(a),
    y: to.y - len * Math.sin(a),
  });
  return [to, at(angle - wing), at(angle + wing)];
}

/** Where an arrow's shaft should stop so it doesn't poke through the head. */
export function arrowShaftEnd(from: RasterPoint, to: RasterPoint, size: number): RasterPoint {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return to;
  const back = Math.min(arrowHeadLength(size) * 0.8, dist);
  return { x: to.x - (dx / dist) * back, y: to.y - (dy / dist) * back };
}

/** True when an arrow drag is long enough to keep. */
export function arrowLongEnough(a: ArrowLayer): boolean {
  return Math.hypot(a.to.x - a.from.x, a.to.y - a.from.y) >= 8;
}
