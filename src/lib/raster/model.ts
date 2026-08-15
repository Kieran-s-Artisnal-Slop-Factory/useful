/**
 * Raster image editor session model. SESSION-ONLY by decision (plan §3.2):
 * binary image data cannot round-trip the JSON data layer, so nothing in this
 * tool may ever touch IndexedDB — the whole session lives in component state
 * and is gone on reload. Layers are annotation data in DOCUMENT space (the
 * post-rotation, post-crop coordinate system the user sees); rotating or
 * cropping remaps them through the pure helpers in transform.ts.
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

/** A freehand stroke: paint composites normally, erase punches transparency
 * through everything below it (destination-out). */
export interface StrokeLayer {
  id: string;
  kind: 'stroke';
  mode: 'paint' | 'erase';
  color: string;
  size: number;
  points: RasterPoint[];
}

export interface ArrowLayer {
  id: string;
  kind: 'arrow';
  from: RasterPoint;
  to: RasterPoint;
  color: string;
  size: number;
}

export interface TextLayer {
  id: string;
  kind: 'text';
  text: string;
  x: number;
  y: number;
  size: number;
  color: string;
  bold: boolean;
}

/** A rectangular region adjustment. `amount` is 1-100: opacity percent for
 * darken/lighten, blur strength for blur. */
export interface AdjustLayer {
  id: string;
  kind: 'adjust';
  mode: 'darken' | 'lighten' | 'blur';
  rect: Rect;
  amount: number;
}

export type RasterLayer = StrokeLayer | ArrowLayer | TextLayer | AdjustLayer;

export function layerLabel(layer: RasterLayer): string {
  switch (layer.kind) {
    case 'stroke':
      return layer.mode === 'erase' ? 'eraser' : 'brush';
    case 'arrow':
      return 'arrow';
    case 'text':
      return `“${layer.text}”`;
    case 'adjust':
      return layer.mode;
  }
}
