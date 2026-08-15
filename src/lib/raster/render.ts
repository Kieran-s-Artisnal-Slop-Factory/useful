/**
 * Canvas rendering for the raster editor (browser-only — the pure geometry
 * lives in transform.ts). Everything re-renders from the layer tree each
 * time; nothing is ever baked, so deleting a layer is lossless.
 *
 * Pipeline (recursive; bottom → top within every list):
 *   - a CONTENT layer (image, brush, arrow, text, fill) renders into its own
 *     buffer; its children are applied to that buffer in order — effect
 *     children (eraser/crop/adjust) act on the buffer, content children are
 *     rendered (with THEIR subtrees) and composited onto it CLIPPED to the
 *     parent's alpha, so a fill child tints only its parent and a brush child
 *     paints only where the parent has pixels — then the buffer composites
 *     onto the target with the layer's opacity and blend mode;
 *   - a GROUP renders its children as a normal stack into its own buffer
 *     (each child with its own opacity/blend, effects acting on the group's
 *     accumulated buffer), then composites like any content layer;
 *   - an EFFECT layer in a list applies to the accumulated composite of that
 *     list — everything rendered below it (in the root list: the canvas so
 *     far; inside a group: the group so far).
 */
import type { BlendMode, ImageLayer, RasterDocument, RasterLayer, Rect } from './model';
import { isEffectLayer } from './model';
import { arrowHeadPoints, arrowShaftEnd, rotatedSize } from './transform';

/** Map a BlendMode to the canvas globalCompositeOperation name. */
export function blendOp(mode: BlendMode): GlobalCompositeOperation {
  return mode === 'normal' ? 'source-over' : mode;
}

/** crop(rotate(original)) — a bitmap turned `quarter` times, optionally cropped. */
export function renderBase(
  original: HTMLCanvasElement,
  quarter: number,
  crop: Rect | null
): HTMLCanvasElement {
  const q = ((quarter % 4) + 4) % 4;
  const rot = rotatedSize(original.width, original.height, q);
  const out = document.createElement('canvas');
  out.width = Math.max(1, crop ? crop.w : rot.w);
  out.height = Math.max(1, crop ? crop.h : rot.h);
  const ctx = out.getContext('2d')!;
  ctx.save();
  if (crop) ctx.translate(-crop.x, -crop.y);
  // Rotate about the origin, then shift the result back into view.
  if (q === 1) ctx.translate(rot.w, 0);
  else if (q === 2) ctx.translate(rot.w, rot.h);
  else if (q === 3) ctx.translate(0, rot.h);
  ctx.rotate((q * Math.PI) / 2);
  ctx.drawImage(original, 0, 0);
  ctx.restore();
  return out;
}

/** Draw an image layer's (rotated) bitmap into its rect. */
function drawImageLayer(ctx: CanvasRenderingContext2D, layer: ImageLayer): void {
  const bitmap = layer.quarter % 4 === 0 ? layer.source : renderBase(layer.source, layer.quarter, null);
  ctx.drawImage(bitmap, layer.x, layer.y, Math.max(1, layer.width), Math.max(1, layer.height));
}

/**
 * Apply one layer to a target canvas. Content layers paint; effect layers
 * modify what is already on the target. `alpha`/`blend` are the layer's own
 * (children composite onto their parent buffer with them too).
 */
export function drawLayer(canvas: HTMLCanvasElement, layer: RasterLayer): void {
  if (!layer.visible) return;
  const ctx = canvas.getContext('2d')!;
  ctx.save();
  ctx.globalAlpha = Math.min(1, Math.max(0, layer.opacity / 100));
  ctx.globalCompositeOperation = blendOp(layer.blend);
  switch (layer.kind) {
    case 'image':
      drawImageLayer(ctx, layer);
      break;
    case 'stroke': {
      if (layer.points.length === 0) break;
      if (layer.mode === 'erase') ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = layer.color;
      ctx.fillStyle = layer.color;
      ctx.lineWidth = layer.size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const pts = layer.points;
      if (pts.length === 1) {
        // A click without movement paints a dot.
        ctx.beginPath();
        ctx.arc(pts[0]!.x, pts[0]!.y, layer.size / 2, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      // Quadratic smoothing through segment midpoints — freehand input is
      // noisy and straight polylines look jagged at brush sizes.
      ctx.beginPath();
      ctx.moveTo(pts[0]!.x, pts[0]!.y);
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i]!.x + pts[i + 1]!.x) / 2;
        const my = (pts[i]!.y + pts[i + 1]!.y) / 2;
        ctx.quadraticCurveTo(pts[i]!.x, pts[i]!.y, mx, my);
      }
      ctx.lineTo(pts[pts.length - 1]!.x, pts[pts.length - 1]!.y);
      ctx.stroke();
      break;
    }
    case 'arrow': {
      const shaftEnd = arrowShaftEnd(layer.from, layer.to, layer.size);
      ctx.strokeStyle = layer.color;
      ctx.fillStyle = layer.color;
      ctx.lineWidth = layer.size;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(layer.from.x, layer.from.y);
      ctx.lineTo(shaftEnd.x, shaftEnd.y);
      ctx.stroke();
      const [tip, l, r] = arrowHeadPoints(layer.from, layer.to, layer.size);
      ctx.beginPath();
      ctx.moveTo(tip!.x, tip!.y);
      ctx.lineTo(l!.x, l!.y);
      ctx.lineTo(r!.x, r!.y);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'text': {
      ctx.fillStyle = layer.color;
      ctx.font = `${layer.bold ? 700 : 400} ${layer.size}px system-ui, -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(layer.text, layer.x, layer.y);
      break;
    }
    case 'fill': {
      ctx.fillStyle = layer.color;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      break;
    }
    case 'group':
      // Groups never draw directly — renderLayerBuffer renders their stack.
      break;
    case 'crop': {
      // Keep only the rect: destination-in with an opaque rect. Opacity
      // softens the crop (partial keep) — deliberate, it is a knob like any.
      const { x, y, w, h } = layer.rect;
      ctx.globalCompositeOperation = 'destination-in';
      ctx.fillStyle = '#000';
      ctx.fillRect(x, y, Math.max(0, w), Math.max(0, h));
      break;
    }
    case 'adjust': {
      const { x, y, w, h } = layer.rect;
      if (w <= 0 || h <= 0) break;
      if (layer.mode === 'blur') {
        const px = Math.max(1, Math.round((layer.amount / 100) * 24));
        // Snapshot the region WITH a margin of surrounding pixels: a blur has
        // ~one radius of edge falloff, and a snapshot with transparent
        // surroundings would fade to see-through at the rect border, letting
        // the sharp original bleed back in (bad for redaction). The margin
        // gives the filter real context; the clip keeps the effect inside
        // the rect. (Filtered self-drawImage is only well-defined from a
        // separate bitmap, hence the snapshot.)
        const pad = px * 3;
        const sx = Math.max(0, Math.floor(x - pad));
        const sy = Math.max(0, Math.floor(y - pad));
        const ex = Math.min(canvas.width, Math.ceil(x + w + pad));
        const ey = Math.min(canvas.height, Math.ceil(y + h + pad));
        const region = document.createElement('canvas');
        region.width = Math.max(1, ex - sx);
        region.height = Math.max(1, ey - sy);
        region
          .getContext('2d')!
          .drawImage(canvas, sx, sy, region.width, region.height, 0, 0, region.width, region.height);
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.clip();
        ctx.filter = `blur(${px}px)`;
        // The blurred replacement fully covers the region (normal alpha).
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(region, sx, sy);
      } else {
        // source-atop: only tint pixels that exist on the target, so a
        // darken under a cut-out image doesn't paint the transparent holes.
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle =
          layer.mode === 'darken'
            ? `rgba(0, 0, 0, ${layer.amount / 100})`
            : `rgba(255, 255, 255, ${layer.amount / 100})`;
        ctx.fillRect(x, y, w, h);
      }
      break;
    }
  }
  ctx.restore();
}

/** Composite one list of layers (bottom → top) onto a target. */
export function renderInto(target: HTMLCanvasElement, doc: RasterDocument, layers: RasterLayer[]): void {
  const ctx = target.getContext('2d')!;
  for (const layer of layers) {
    if (!layer.visible) continue;
    if (isEffectLayer(layer)) {
      // Acts on everything below in this list.
      drawLayer(target, layer);
      continue;
    }
    const buf = renderLayerBuffer(doc, layer);
    ctx.save();
    ctx.globalAlpha = Math.min(1, Math.max(0, layer.opacity / 100));
    ctx.globalCompositeOperation = blendOp(layer.blend);
    ctx.drawImage(buf, 0, 0);
    ctx.restore();
  }
}

/** Render one content layer (or group) plus its subtree into a fresh buffer. */
export function renderLayerBuffer(doc: RasterDocument, layer: RasterLayer): HTMLCanvasElement {
  const buf = document.createElement('canvas');
  buf.width = Math.max(1, doc.width);
  buf.height = Math.max(1, doc.height);
  if (layer.kind === 'group') {
    renderInto(buf, doc, layer.children);
    return buf;
  }
  // The layer's own opacity/blend apply when the buffer composites, not
  // while painting its content — so draw it at full strength here.
  drawLayer(buf, { ...layer, opacity: 100, blend: 'normal' });
  const ctx = buf.getContext('2d')!;
  for (const child of layer.children) {
    if (!child.visible) continue;
    if (isEffectLayer(child)) {
      drawLayer(buf, child);
      continue;
    }
    // Content child: render its subtree, clip it to the parent's current
    // alpha (a clipping mask), then composite with its opacity/blend.
    const cb = renderLayerBuffer(doc, child);
    const cctx = cb.getContext('2d')!;
    cctx.save();
    cctx.globalCompositeOperation = 'destination-in';
    cctx.drawImage(buf, 0, 0);
    cctx.restore();
    ctx.save();
    ctx.globalAlpha = Math.min(1, Math.max(0, child.opacity / 100));
    ctx.globalCompositeOperation = blendOp(child.blend);
    ctx.drawImage(cb, 0, 0);
    ctx.restore();
  }
  return buf;
}

/** Full composite of the document. */
export function renderDocument(doc: RasterDocument, layers: RasterLayer[]): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = Math.max(1, doc.width);
  out.height = Math.max(1, doc.height);
  if (doc.background) {
    const ctx = out.getContext('2d')!;
    ctx.fillStyle = doc.background;
    ctx.fillRect(0, 0, out.width, out.height);
  }
  renderInto(out, doc, layers);
  return out;
}
