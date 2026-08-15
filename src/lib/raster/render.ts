/**
 * Canvas rendering for the raster editor (browser-only — the pure geometry
 * lives in transform.ts). The pipeline re-renders from the ORIGINAL decoded
 * bitmap every time: base = crop(rotate(original)), then annotation layers in
 * order. Nothing is ever baked, so deleting a layer or resetting the crop is
 * lossless.
 */
import type { RasterLayer, Rect } from './model';
import { arrowHeadPoints, arrowShaftEnd, rotatedSize } from './transform';

/** crop(rotate(original)) — the annotation-free document base. */
export function renderBase(
  original: HTMLCanvasElement,
  quarter: number,
  crop: Rect | null
): HTMLCanvasElement {
  const q = ((quarter % 4) + 4) % 4;
  const rot = rotatedSize(original.width, original.height, q);
  const out = document.createElement('canvas');
  out.width = crop ? crop.w : rot.w;
  out.height = crop ? crop.h : rot.h;
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

/** Apply one annotation layer onto the composite canvas, in order. */
export function drawLayer(canvas: HTMLCanvasElement, layer: RasterLayer): void {
  const ctx = canvas.getContext('2d')!;
  ctx.save();
  switch (layer.kind) {
    case 'stroke': {
      if (layer.points.length === 0) break;
      ctx.globalCompositeOperation = layer.mode === 'erase' ? 'destination-out' : 'source-over';
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
    case 'adjust': {
      const { x, y, w, h } = layer.rect;
      if (w <= 0 || h <= 0) break;
      if (layer.mode === 'blur') {
        // Snapshot the region first — filtered self-drawImage is only
        // reliably defined when the source is a separate bitmap.
        const region = document.createElement('canvas');
        region.width = Math.max(1, Math.round(w));
        region.height = Math.max(1, Math.round(h));
        region.getContext('2d')!.drawImage(canvas, x, y, w, h, 0, 0, w, h);
        const px = Math.max(1, Math.round((layer.amount / 100) * 24));
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.clip();
        ctx.filter = `blur(${px}px)`;
        ctx.drawImage(region, x, y);
      } else {
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

/** Full composite: base + every layer in order. */
export function renderComposite(
  original: HTMLCanvasElement,
  quarter: number,
  crop: Rect | null,
  layers: RasterLayer[]
): HTMLCanvasElement {
  const out = renderBase(original, quarter, crop);
  for (const layer of layers) drawLayer(out, layer);
  return out;
}
