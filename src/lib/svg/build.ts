/**
 * Pure SVG composition for the SVG editor — layer state in, standalone SVG
 * document string out. Ported from the local-sync-template icon-editor seed
 * (same hardened paste/namespace handling) and generalized: arbitrary
 * canvas/viewBox size, independent width/height per layer, fill AND stroke,
 * bezier line segments, free-form polygons.
 *
 * Previews render through svgDataUri + <img>, which never executes scripts —
 * safe even for pasted SVG markup.
 */
import type { SvgDocumentContent, SvgLayer, SvgPoint, SvgVertex } from './model';

const XMLNS = 'http://www.w3.org/2000/svg';
const XLINK = 'http://www.w3.org/1999/xlink';

/**
 * Guarantee the markup renders as a standalone SVG *document*: a file with no
 * `xmlns` on the root element silently fails in `<img>` and `<link rel="icon">`.
 * Inline SVG inside HTML needs no namespace, so pasted markup routinely omits
 * it. No-op for well-formed markup.
 */
export function ensureSvgNamespace(svg: string): string {
  const doc = svg.trim();
  const open = /<svg\b[^>]*>/i.exec(doc);
  if (!open) return svg;
  let tag = open[0];
  if (!/\sxmlns\s*=/i.test(tag)) tag = tag.replace(/^<svg\b/i, `<svg xmlns="${XMLNS}"`);
  // `svgInner` drops the root tag when embedding a pasted layer, taking any
  // xmlns:xlink with it — re-declare it wherever xlink: is actually used.
  if (/xlink:/i.test(doc) && !/\sxmlns:xlink\s*=/i.test(tag)) {
    tag = tag.replace(/^<svg\b/i, `<svg xmlns:xlink="${XLINK}"`);
  }
  return tag === open[0]
    ? doc
    : doc.slice(0, open.index) + tag + doc.slice(open.index + open[0].length);
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Render an SVG string as an <img> src (scripts never run inside <img>). */
export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** True when `text` looks like standalone SVG markup. */
export function looksLikeSvg(text: string): boolean {
  return /<svg[\s>]/i.test(text);
}

const round = (n: number): number => Math.round(n * 100) / 100;
/** Scale factors need more digits than coordinates — 0.12 vs 0.1172 is visible. */
const round4 = (n: number): number => Math.round(n * 10000) / 10000;

/**
 * User coordinate box of an SVG string: its `viewBox` if it has one, else its
 * `width`/`height`, else lucide's 24x24 (the most common paste source).
 */
export function svgViewBox(svg: string): { x: number; y: number; w: number; h: number } {
  const vb = /viewBox\s*=\s*["']\s*(-?[\d.]+)[,\s]+(-?[\d.]+)[,\s]+(-?[\d.]+)[,\s]+(-?[\d.]+)/i.exec(
    svg
  );
  if (vb) {
    const [w, h] = [Number(vb[3]), Number(vb[4])];
    if (w > 0 && h > 0) return { x: Number(vb[1]), y: Number(vb[2]), w, h };
  }
  const attr = (name: string): number => {
    const m = new RegExp(`<svg[^>]*\\s${name}\\s*=\\s*["']([\\d.]+)`, 'i').exec(svg);
    return m ? Number(m[1]) : 0;
  };
  const [w, h] = [attr('width'), attr('height')];
  return w > 0 && h > 0 ? { x: 0, y: 0, w, h } : { x: 0, y: 0, w: 24, h: 24 };
}

/** Extract the inner markup of an SVG document (everything inside <svg>). */
export function svgInner(svg: string): string {
  const match = /<svg[^>]*>([\s\S]*)<\/svg>/i.exec(svg);
  return match ? match[1]!.trim() : '';
}

/**
 * Prefix every `id` in a markup fragment (and the `url(#…)` / `href="#…"`
 * references to it) so two pasted-SVG layers from the same source can't
 * collide on gradient/clipPath ids. Class names in embedded `<style>` blocks
 * are NOT namespaced; paste self-contained markup where possible.
 */
export function namespaceIds(markup: string, prefix: string): string {
  const ids = [...markup.matchAll(/\sid\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]!);
  let out = markup;
  for (const id of new Set(ids)) {
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out
      .replace(new RegExp(`(\\sid\\s*=\\s*["'])${esc}(["'])`, 'g'), `$1${prefix}${id}$2`)
      .replace(new RegExp(`url\\((["']?)#${esc}\\1\\)`, 'g'), `url($1#${prefix}${id}$1)`)
      .replace(new RegExp(`((?:xlink:)?href\\s*=\\s*["'])#${esc}(["'])`, 'g'), `$1#${prefix}${id}$2`);
  }
  return out;
}

/** Stable, XML-safe id prefix for one layer's embedded markup. */
function layerPrefix(id: string): string {
  return `l${id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || '0'}-`;
}

/**
 * Attributes on the root `<svg>` that describe the *document*, not how it
 * paints. Everything else is a presentation attribute and has to survive
 * unwrapping (icon sets put fill/stroke on the root and leave paths bare —
 * dropping the tag would silently repaint the artwork black).
 */
const STRUCTURAL_ROOT_ATTR =
  /^(?:xmlns(?::.+)?|xml:.+|viewBox|width|height|version|baseProfile|preserveAspectRatio|x|y|id|class|role|transform|aria-.+|data-.+)$/i;

/** Presentation attributes carried on a pasted root `<svg>` tag, re-emitted. */
export function svgRootAttrs(svg: string): string {
  const open = /<svg\b([^>]*)>/i.exec(svg);
  if (!open) return '';
  const out: string[] = [];
  for (const m of open[1]!.matchAll(/([a-zA-Z_:][-\w:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const name = m[1]!;
    if (STRUCTURAL_ROOT_ATTR.test(name)) continue;
    // Values come straight from source markup, so they are already escaped —
    // only the quoting has to be re-chosen.
    const value = m[2] ?? m[3] ?? '';
    out.push(value.includes('"') ? `${name}='${value}'` : `${name}="${value}"`);
  }
  return out.join(' ');
}

// ---- geometry builders (pure, unit-tested) ----------------------------------

/**
 * A user-typed color, made safe for an attribute value. Colors come from a
 * free-form text field, so they are escaped like any other user text — a
 * stray quote must never break the document (or, in an exported file opened
 * directly, inject markup). Empty/whitespace reads as "none".
 */
export function paintValue(color: string): string {
  const c = (color ?? '').trim();
  return c ? escapeXml(c) : 'none';
}

/** fill/stroke/stroke-width attribute string for a shape layer. */
export function paintAttrs(layer: SvgLayer): string {
  const parts = [`fill="${paintValue(layer.fill)}"`];
  const stroke = paintValue(layer.stroke);
  if (stroke !== 'none' && layer.stroke_width > 0) {
    parts.push(`stroke="${stroke}"`, `stroke-width="${round(layer.stroke_width)}"`);
  }
  return parts.join(' ');
}

/** Star: 5 outer points on the layer's w x h ellipse, inner at 42%. */
export function starPoints(cx: number, cy: number, rx: number, ry: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const k = i % 2 === 0 ? 1 : 0.42;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    pts.push(`${round(cx + rx * k * Math.cos(a))},${round(cy + ry * k * Math.sin(a))}`);
  }
  return pts.join(' ');
}

/** Triangle: apex up, filling the layer's w x h box. */
export function trianglePoints(cx: number, cy: number, w: number, h: number): string {
  return [
    `${round(cx)},${round(cy - h / 2)}`,
    `${round(cx - w / 2)},${round(cy + h / 2)}`,
    `${round(cx + w / 2)},${round(cy + h / 2)}`,
  ].join(' ');
}

/** Polygon `points` attribute from relative vertices around (cx, cy). */
export function polygonPoints(cx: number, cy: number, points: SvgPoint[]): string {
  return points.map((p) => `${round(cx + p.x)},${round(cy + p.y)}`).join(' ');
}

/** True when any polygon edge carries a bezier control. */
export function polygonIsCurved(points: SvgVertex[]): boolean {
  return points.some((p) => !!p.c);
}

/**
 * Closed path `d` for a polygon whose edges may be quadratic curves: edge i
 * runs from vertex i to vertex i+1 (wrapping), bent by vertex i's control.
 */
export function polygonPath(cx: number, cy: number, points: SvgVertex[]): string {
  if (points.length < 2) return '';
  const at = (p: SvgPoint): string => `${round(cx + p.x)} ${round(cy + p.y)}`;
  const parts = [`M ${at(points[0]!)}`];
  for (let i = 0; i < points.length; i++) {
    const from = points[i]!;
    const to = points[(i + 1) % points.length]!;
    parts.push(from.c ? `Q ${at(from.c)} ${at(to)}` : `L ${at(to)}`);
  }
  parts.push('Z');
  return parts.join(' ');
}

/**
 * Path `d` for a line layer: straight (no controls), quadratic (c1 only), or
 * cubic (c1 + c2). All coordinates are relative to (cx, cy) in the layer.
 */
export function linePath(
  cx: number,
  cy: number,
  points: SvgPoint[],
  c1: SvgPoint | null,
  c2: SvgPoint | null
): string {
  const [p1, p2] = [points[0], points[1]];
  if (!p1 || !p2) return '';
  const at = (p: SvgPoint): string => `${round(cx + p.x)} ${round(cy + p.y)}`;
  if (c1 && c2) return `M ${at(p1)} C ${at(c1)} ${at(c2)} ${at(p2)}`;
  if (c1) return `M ${at(p1)} Q ${at(c1)} ${at(p2)}`;
  return `M ${at(p1)} L ${at(p2)}`;
}

// ---- layer + document rendering ---------------------------------------------

export function renderLayer(layer: SvgLayer): string {
  const { x, y, width: w, height: h } = layer;
  const paint = paintAttrs(layer);
  let el: string;
  switch (layer.kind) {
    case 'rect':
      el = `<rect x="${round(x - w / 2)}" y="${round(y - h / 2)}" width="${round(w)}" height="${round(h)}" rx="${round(layer.radius)}" ${paint}/>`;
      break;
    case 'circle':
      el = `<ellipse cx="${round(x)}" cy="${round(y)}" rx="${round(w / 2)}" ry="${round(h / 2)}" ${paint}/>`;
      break;
    case 'triangle':
      el = `<polygon points="${trianglePoints(x, y, w, h)}" ${paint}/>`;
      break;
    case 'star':
      el = `<polygon points="${starPoints(x, y, w / 2, h / 2)}" ${paint}/>`;
      break;
    case 'polygon':
      el = polygonIsCurved(layer.points)
        ? `<path d="${polygonPath(x, y, layer.points)}" ${paint}/>`
        : `<polygon points="${polygonPoints(x, y, layer.points)}" ${paint}/>`;
      break;
    case 'line': {
      const d = linePath(x, y, layer.points, layer.c1, layer.c2);
      if (!d) return '';
      // A line's stroke is the artwork: fall back to fill's default color so a
      // stroke of 'none' doesn't render an invisible path.
      const strokeValue = paintValue(layer.stroke);
      const strokeColor = strokeValue !== 'none' ? strokeValue : '#f59e0b';
      el = `<path d="${d}" fill="none" stroke="${strokeColor}" stroke-width="${round(Math.max(1, layer.stroke_width))}" stroke-linecap="round"/>`;
      break;
    }
    case 'text':
      // Height doubles as the font size (width is only a selection-box hint).
      el = `<text x="${round(x)}" y="${round(y)}" font-size="${round(h)}" font-family="system-ui, -apple-system, sans-serif" font-weight="${layer.bold ? 700 : 400}" text-anchor="middle" dominant-baseline="central" ${paint}>${escapeXml(layer.text)}</text>`;
      break;
    case 'svg': {
      // Fit the pasted markup's own coordinate box into the layer's w x h box
      // centered on (x, y), then re-home its ids so pastes stay independent.
      if (!looksLikeSvg(layer.svg)) return '';
      const box = svgViewBox(layer.svg);
      const scale = Math.min(w / box.w, h / box.h);
      const tx = round(x - scale * (box.x + box.w / 2));
      const ty = round(y - scale * (box.y + box.h / 2));
      const inner = namespaceIds(svgInner(layer.svg), layerPrefix(layer.id));
      if (!inner) return '';
      // The root tag's paint comes with it, or the artwork loses its colors.
      const rootPaint = svgRootAttrs(layer.svg);
      el = `<g ${rootPaint ? `${rootPaint} ` : ''}transform="translate(${tx} ${ty}) scale(${round4(scale)})">${inner}</g>`;
      break;
    }
  }
  return layer.rotation
    ? `<g transform="rotate(${round(layer.rotation)} ${round(x)} ${round(y)})">${el}</g>`
    : el;
}

// ---- bounds + boolean subtraction -------------------------------------------

/**
 * Axis-aligned canvas-space bounds of a layer, rotation-aware and padded by
 * its stroke (text gets extra horizontal room — its width is only a hint).
 */
export function layerBounds(layer: SvgLayer): { x: number; y: number; w: number; h: number } {
  let minX = -layer.width / 2;
  let maxX = layer.width / 2;
  let minY = -layer.height / 2;
  let maxY = layer.height / 2;
  if (layer.kind === 'line' || layer.kind === 'polygon') {
    const pts: SvgPoint[] = [...layer.points];
    for (const p of layer.points) if (p.c) pts.push(p.c);
    if (layer.c1) pts.push(layer.c1);
    if (layer.c2) pts.push(layer.c2);
    if (pts.length > 0) {
      minX = Math.min(...pts.map((p) => p.x));
      maxX = Math.max(...pts.map((p) => p.x));
      minY = Math.min(...pts.map((p) => p.y));
      maxY = Math.max(...pts.map((p) => p.y));
    }
  }
  let pad = 0;
  if (layer.kind === 'line') pad = Math.max(1, layer.stroke_width) / 2;
  else if (layer.stroke && layer.stroke !== 'none') pad = layer.stroke_width / 2;
  if (layer.kind === 'text') {
    minX -= layer.height;
    maxX += layer.height;
    pad += layer.height * 0.2;
  }
  minX -= pad;
  maxX += pad;
  minY -= pad;
  maxY += pad;
  const a = (layer.rotation * Math.PI) / 180;
  const corners = [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ].map(([px, py]) => ({
    x: layer.x + px! * Math.cos(a) - py! * Math.sin(a),
    y: layer.y + px! * Math.sin(a) + py! * Math.cos(a),
  }));
  const bx = Math.min(...corners.map((c) => c.x));
  const by = Math.min(...corners.map((c) => c.y));
  const bw = Math.max(...corners.map((c) => c.x)) - bx;
  const bh = Math.max(...corners.map((c) => c.y)) - by;
  return { x: round(bx), y: round(by), w: round(Math.max(1, bw)), h: round(Math.max(1, bh)) };
}

/**
 * `base` minus `cutter`, baked into a pasted-SVG layer (plan TODO: the
 * split doesn't need parametric controls). Done with SVG's own compositing
 * instead of polygon clipping, so ANY layer kind cuts any other — a stroked
 * line slices a square into two rectangles, text punches letters, a pasted
 * icon stamps its silhouette:
 *   - a luminance <mask>: white over the base's bounds, then the cutter drawn
 *     through an feFlood/feComposite filter that turns every opaque pixel of
 *     it solid black regardless of its own colors;
 *   - the base rendered under that mask.
 * The result keeps the base's colors and sits exactly where the base was.
 */
export function subtractLayers(base: SvgLayer, cutter: SvgLayer): SvgLayer {
  const b = layerBounds(base);
  const region = `x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}"`;
  const svg =
    `<svg xmlns="${XMLNS}" viewBox="${b.x} ${b.y} ${b.w} ${b.h}">` +
    `<defs>` +
    `<filter id="blk" filterUnits="userSpaceOnUse" ${region}>` +
    `<feFlood flood-color="#000"/><feComposite in2="SourceAlpha" operator="in"/>` +
    `</filter>` +
    `<mask id="cut" maskUnits="userSpaceOnUse" ${region}>` +
    `<rect ${region} fill="#fff"/>` +
    `<g filter="url(#blk)">${renderLayer(cutter)}</g>` +
    `</mask>` +
    `</defs>` +
    `<g mask="url(#cut)">${renderLayer(base)}</g>` +
    `</svg>`;
  return {
    id: crypto.randomUUID(),
    kind: 'svg',
    x: round(b.x + b.w / 2),
    y: round(b.y + b.h / 2),
    width: b.w,
    height: b.h,
    rotation: 0,
    fill: 'none',
    stroke: 'none',
    stroke_width: 0,
    radius: 0,
    text: '',
    bold: false,
    svg,
    points: [],
    c1: null,
    c2: null,
  };
}

/**
 * Compose the document SVG: optional background rect + layers bottom-to-top.
 * width/height attributes are emitted alongside the viewBox so the file has
 * an intrinsic size (rasterizers and <img> need it for the aspect ratio).
 */
export function buildSvg(content: SvgDocumentContent): string {
  const layers = content.layers
    .map((l) => renderLayer(l))
    .filter((s) => s !== '')
    .map((s) => `  ${s}`)
    .join('\n');
  // A pasted layer's own root tag is stripped when it is embedded, so if its
  // markup uses xlink: the declaration has to be re-made out here.
  const xlink = /xlink:/i.test(layers) ? ` xmlns:xlink="${XLINK}"` : '';
  // null AND an emptied text field both mean transparent — an empty `fill=""`
  // would be ignored by renderers and paint the canvas black.
  const bgColor = content.background === null ? 'none' : paintValue(content.background);
  const bg =
    bgColor === 'none'
      ? ''
      : `  <rect width="${round(content.width)}" height="${round(content.height)}" fill="${bgColor}"/>\n`;
  return `<svg xmlns="${XMLNS}"${xlink} width="${round(content.width)}" height="${round(content.height)}" viewBox="0 0 ${round(content.width)} ${round(content.height)}">
${bg}${layers}${layers ? '\n' : ''}</svg>
`;
}
