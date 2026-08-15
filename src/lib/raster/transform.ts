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
import type { ArrowLayer, ImageLayer, RasterLayer, RasterPoint, Rect } from './model';

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

/**
 * Intersect a rect with a w x h space, rounding to whole pixels (≥1 x 1).
 * Each EDGE is clamped independently — a marquee dragged off-canvas keeps
 * exactly its on-canvas span rather than sliding inward and growing.
 */
export function clampRect(r: Rect, w: number, h: number): Rect {
  const cx = (v: number): number => Math.min(Math.max(0, Math.round(v)), w);
  const cy = (v: number): number => Math.min(Math.max(0, Math.round(v)), h);
  let x1 = cx(r.x);
  let x2 = cx(r.x + r.w);
  let y1 = cy(r.y);
  let y2 = cy(r.y + r.h);
  // Degenerate (fully outside or zero-width) collapses to a 1px cell at the
  // nearest in-bounds edge instead of an empty rect.
  if (x2 <= x1) {
    x1 = Math.min(x1, Math.max(0, w - 1));
    x2 = x1 + 1;
  }
  if (y2 <= y1) {
    y1 = Math.min(y1, Math.max(0, h - 1));
    y2 = y1 + 1;
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/**
 * One layer's geometry through one clockwise turn of a w x h space whose
 * origin is (0, 0). Children are NOT touched here (callers decide — see
 * rotateImageLayerCW, which turns an image about its own center and carries
 * its children with it).
 */
export function rotateLayerCW(layer: RasterLayer, w: number, h: number): RasterLayer {
  switch (layer.kind) {
    case 'image': {
      // The image's rect turns about the origin like any rect; its bitmap
      // turns one more quarter.
      const r = rotateRectCW({ x: layer.x, y: layer.y, w: layer.width, h: layer.height }, w, h);
      return { ...layer, x: r.x, y: r.y, width: r.w, height: r.h, quarter: (layer.quarter + 1) % 4 };
    }
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
    case 'crop':
      return { ...layer, rect: rotateRectCW(layer.rect, w, h) };
  }
}

/** Shift a layer's own geometry by (dx, dy). Children are left alone. */
export function shiftLayer(layer: RasterLayer, dx: number, dy: number): RasterLayer {
  switch (layer.kind) {
    case 'image':
      return { ...layer, x: layer.x + dx, y: layer.y + dy };
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
    case 'crop':
      return { ...layer, rect: { ...layer.rect, x: layer.rect.x + dx, y: layer.rect.y + dy } };
  }
}

/** Shift a layer AND its children together (moving a parent on the canvas). */
export function shiftLayerTree(layer: RasterLayer, dx: number, dy: number): RasterLayer {
  const moved = shiftLayer(layer, dx, dy);
  return { ...moved, children: layer.children.map((c) => shiftLayer(c, dx, dy)) };
}

/**
 * Rotate an image layer 90° clockwise ABOUT ITS OWN CENTER (its center stays
 * put, its width/height swap) and carry its children through the same turn,
 * so a crop or eraser stuck to the photo stays stuck.
 */
export function rotateImageLayerCW(layer: ImageLayer): ImageLayer {
  const cx = layer.x + layer.width / 2;
  const cy = layer.y + layer.height / 2;
  // Work in the image's own w x h frame: translate so its origin is (0,0),
  // rotate that frame, then re-home the (now h x w) frame on the same center.
  const nx = cx - layer.height / 2;
  const ny = cy - layer.width / 2;
  const children = layer.children.map((c) => {
    const local = shiftLayer(c, -layer.x, -layer.y);
    const turned = rotateLayerCW(local, layer.width, layer.height);
    return shiftLayer(turned, nx, ny);
  });
  return {
    ...layer,
    x: nx,
    y: ny,
    width: layer.height,
    height: layer.width,
    quarter: (layer.quarter + 1) % 4,
    children,
  };
}

/** Axis-aligned bounds of a layer's own geometry (for hit-testing / fit). */
export function layerBounds(layer: RasterLayer): Rect | null {
  switch (layer.kind) {
    case 'image':
      return { x: layer.x, y: layer.y, w: layer.width, h: layer.height };
    case 'stroke': {
      if (layer.points.length === 0) return null;
      const xs = layer.points.map((p) => p.x);
      const ys = layer.points.map((p) => p.y);
      const pad = layer.size / 2;
      const x = Math.min(...xs) - pad;
      const y = Math.min(...ys) - pad;
      return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y };
    }
    case 'arrow': {
      const pad = Math.max(6, layer.size);
      const x = Math.min(layer.from.x, layer.to.x) - pad;
      const y = Math.min(layer.from.y, layer.to.y) - pad;
      return {
        x,
        y,
        w: Math.max(layer.from.x, layer.to.x) + pad - x,
        h: Math.max(layer.from.y, layer.to.y) + pad - y,
      };
    }
    case 'text': {
      const hw = Math.max(20, (layer.text.length * layer.size * 0.6) / 2);
      const hh = layer.size / 2 + 6;
      return { x: layer.x - hw, y: layer.y - hh, w: hw * 2, h: hh * 2 };
    }
    case 'adjust':
    case 'crop':
      return { ...layer.rect };
  }
}

/** Point-in-rect. */
export function rectContains(r: Rect, p: RasterPoint): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
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
