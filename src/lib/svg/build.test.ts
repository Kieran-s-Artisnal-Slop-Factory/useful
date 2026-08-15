import { describe, expect, it } from 'vitest';
import {
  buildSvg,
  ensureSvgNamespace,
  escapeXml,
  layerBounds,
  linePath,
  looksLikeSvg,
  namespaceIds,
  paintAttrs,
  paintValue,
  polygonIsCurved,
  polygonPath,
  polygonPoints,
  renderLayer,
  starPoints,
  subtractLayers,
  svgInner,
  svgRootAttrs,
  svgViewBox,
  trianglePoints,
} from './build';
import {
  defaultDocumentContent,
  newLayer,
  normalizeDocumentContent,
  normalizeLayer,
  regularPolygonPoints,
  type SvgLayer,
} from './model';

function layer(kind: SvgLayer['kind'], overrides: Partial<SvgLayer> = {}): SvgLayer {
  return { ...newLayer(kind, 256, 256), ...overrides };
}

// ---- geometry builders ------------------------------------------------------

describe('geometry builders', () => {
  it('linePath renders straight, quadratic and cubic variants', () => {
    const pts = [
      { x: -50, y: 0 },
      { x: 50, y: 0 },
    ];
    expect(linePath(100, 100, pts, null, null)).toBe('M 50 100 L 150 100');
    expect(linePath(100, 100, pts, { x: 0, y: -40 }, null)).toBe('M 50 100 Q 100 60 150 100');
    expect(linePath(100, 100, pts, { x: -20, y: -40 }, { x: 20, y: 40 })).toBe(
      'M 50 100 C 80 60 120 140 150 100'
    );
  });

  it('linePath with missing endpoints renders nothing', () => {
    expect(linePath(0, 0, [], null, null)).toBe('');
    expect(linePath(0, 0, [{ x: 1, y: 1 }], null, null)).toBe('');
  });

  it('polygonPoints translates relative vertices to canvas coordinates', () => {
    const pts = [
      { x: 0, y: -10 },
      { x: 10, y: 10 },
      { x: -10, y: 10 },
    ];
    expect(polygonPoints(50, 60, pts)).toBe('50,50 60,70 40,70');
  });

  it('regularPolygonPoints produces n vertices on the w x h ellipse, apex up', () => {
    const tri = regularPolygonPoints(3, 100, 100);
    expect(tri).toHaveLength(3);
    expect(tri[0]).toEqual({ x: 0, y: -50 });
    // Fewer than 3 sides is clamped, not an error.
    expect(regularPolygonPoints(1, 100, 100)).toHaveLength(3);
    // Non-square boxes scale each axis independently.
    const squished = regularPolygonPoints(4, 200, 100);
    for (const p of squished) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(100);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(50);
    }
  });

  it('polygonPath curves only the edges whose vertex carries a control', () => {
    const pts = [
      { x: 0, y: -10, c: { x: 20, y: 0 } }, // curved edge 0→1
      { x: 10, y: 10 },
      { x: -10, y: 10 },
    ];
    expect(polygonIsCurved(pts)).toBe(true);
    expect(polygonPath(50, 50, pts)).toBe('M 50 40 Q 70 50 60 60 L 40 60 L 50 40 Z');
    expect(polygonIsCurved([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(false);
    expect(polygonPath(0, 0, [{ x: 1, y: 1 }])).toBe('');
  });

  it('a curved polygon renders as a closed <path>, a straight one as <polygon>', () => {
    const straight = layer('polygon');
    expect(renderLayer(straight)).toContain('<polygon');
    const curved = layer('polygon');
    curved.points[0]!.c = { x: 0, y: -80 };
    const svg = renderLayer(curved);
    expect(svg).toContain('<path d="M');
    expect(svg).toContain(' Q ');
    expect(svg).toContain(' Z"');
  });

  it('starPoints emits 10 alternating outer/inner vertices', () => {
    const star = starPoints(128, 128, 60, 60);
    expect(star.match(/[-\d.]+,[-\d.]+/g)).toHaveLength(10);
  });

  it('trianglePoints fills the layer box', () => {
    expect(trianglePoints(100, 100, 80, 60)).toBe('100,70 60,130 140,130');
  });
});

// ---- paint ------------------------------------------------------------------

describe('paintValue (user-typed colors are attribute-escaped)', () => {
  it('escapes quotes and angle brackets so a typo cannot break the document', () => {
    // A trailing quote typed into the Fill field would otherwise end the
    // attribute early and blank the ENTIRE canvas preview.
    expect(paintValue('#ff0000"')).toBe('#ff0000&quot;');
    const injected = 'red"/><script>alert(1)</script><rect fill="red';
    const out = paintValue(injected);
    expect(out).not.toContain('<script>');
    expect(out).not.toContain('"');
    expect(paintValue('rgb(1, 2, 3)')).toBe('rgb(1, 2, 3)');
  });

  it('empty / whitespace reads as none', () => {
    expect(paintValue('')).toBe('none');
    expect(paintValue('   ')).toBe('none');
  });

  it('flows through renderLayer and buildSvg for fill, stroke, line, background', () => {
    const l = layer('rect', { fill: 'a"b', stroke: 'c"d', stroke_width: 2 });
    const rect = renderLayer(l);
    expect(rect).toContain('fill="a&quot;b"');
    expect(rect).toContain('stroke="c&quot;d"');
    expect(renderLayer(layer('line', { stroke: 'e"f' }))).toContain('stroke="e&quot;f"');
    const content = { ...defaultDocumentContent('x'), background: 'g"h' };
    expect(buildSvg(content)).toContain('fill="g&quot;h"');
  });

  it('an emptied background text is transparent, not black', () => {
    // fill="" is an invalid presentation attribute → renderers fall back to
    // black; the editor treats an empty field like "transparent" instead.
    const content = { ...defaultDocumentContent('x'), background: '' };
    expect(buildSvg(content)).not.toContain('<rect');
  });
});

describe('paintAttrs', () => {
  it('always emits fill; stroke only when set and wide enough', () => {
    expect(paintAttrs(layer('rect', { fill: '#123456', stroke: 'none' }))).toBe('fill="#123456"');
    expect(
      paintAttrs(layer('rect', { fill: 'none', stroke: '#ff0000', stroke_width: 3 }))
    ).toBe('fill="none" stroke="#ff0000" stroke-width="3"');
    expect(paintAttrs(layer('rect', { stroke: '#ff0000', stroke_width: 0 }))).not.toContain(
      'stroke='
    );
  });
});

// ---- renderLayer ------------------------------------------------------------

describe('renderLayer', () => {
  it('rect uses independent width/height around the center', () => {
    const svg = renderLayer(layer('rect', { x: 100, y: 50, width: 80, height: 40, radius: 8 }));
    expect(svg).toContain('x="60"');
    expect(svg).toContain('y="30"');
    expect(svg).toContain('width="80"');
    expect(svg).toContain('height="40"');
    expect(svg).toContain('rx="8"');
  });

  it('circle renders an ellipse so w and h stay independent', () => {
    const svg = renderLayer(layer('circle', { width: 100, height: 60 }));
    expect(svg).toContain('<ellipse');
    expect(svg).toContain('rx="50"');
    expect(svg).toContain('ry="30"');
  });

  it('text uses height as the font size and escapes content', () => {
    const svg = renderLayer(layer('text', { height: 48, text: '<b> & "q"' }));
    expect(svg).toContain('font-size="48"');
    expect(svg).toContain('&lt;b&gt; &amp; &quot;q&quot;');
    expect(svg).not.toContain('<b>');
  });

  it('line falls back to a visible stroke color when stroke is none', () => {
    // A line whose stroke is 'none' would be invisible artwork — the tool
    // never wants that, so the renderer substitutes the default accent.
    const svg = renderLayer(layer('line', { stroke: 'none' }));
    expect(svg).toContain('stroke="#f59e0b"');
    expect(svg).toContain('fill="none"');
  });

  it('rotation wraps the element only when non-zero', () => {
    expect(renderLayer(layer('rect', { rotation: 0 }))).not.toContain('rotate(');
    const svg = renderLayer(layer('rect', { x: 10, y: 20, rotation: 45 }));
    expect(svg).toContain('rotate(45 10 20)');
  });

  it('pasted svg is scaled to fit the layer box and its ids are namespaced', () => {
    const pasted =
      '<svg viewBox="0 0 24 24"><defs><linearGradient id="g"/></defs><rect fill="url(#g)"/></svg>';
    const svg = renderLayer(layer('svg', { svg: pasted, width: 48, height: 48, id: 'abc123' }));
    expect(svg).toContain('scale(2)');
    expect(svg).toContain('id="labc123-g"');
    expect(svg).toContain('url(#labc123-g)');
  });

  it('pasted svg keeps root paint attributes (the Bootstrap Icons regression)', () => {
    // Icon sets put fill/stroke on the root tag and leave the paths bare;
    // dropping the root tag silently repaints the artwork black.
    const pasted = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M1 1h1"/></svg>';
    const svg = renderLayer(layer('svg', { svg: pasted }));
    expect(svg).toContain('fill="currentColor"');
  });

  it('invalid pasted svg contributes nothing', () => {
    expect(renderLayer(layer('svg', { svg: 'not svg' }))).toBe('');
    expect(renderLayer(layer('svg', { svg: '' }))).toBe('');
  });
});

// ---- buildSvg ---------------------------------------------------------------

describe('buildSvg', () => {
  it('emits a namespaced document with viewBox AND intrinsic size', () => {
    // width/height attributes matter: rasterizers derive the aspect ratio
    // from the intrinsic size, and a viewBox alone has none.
    const svg = buildSvg(defaultDocumentContent('x'));
    expect(svg).toContain(`xmlns="http://www.w3.org/2000/svg"`);
    expect(svg).toContain('viewBox="0 0 256 256"');
    expect(svg).toContain('width="256"');
    expect(svg).toContain('height="256"');
  });

  it('background rect appears only when background is set', () => {
    const content = defaultDocumentContent('x');
    content.background = '#112233';
    expect(buildSvg(content)).toContain('<rect width="256" height="256" fill="#112233"/>');
    content.background = null;
    expect(buildSvg(content)).not.toContain('<rect');
  });

  it('layers render bottom-to-top in array order', () => {
    const content = defaultDocumentContent('x');
    content.layers = [layer('rect', { fill: '#aa0000' }), layer('circle', { fill: '#00bb00' })];
    const svg = buildSvg(content);
    expect(svg.indexOf('#aa0000')).toBeLessThan(svg.indexOf('#00bb00'));
  });

  it('re-declares xmlns:xlink when a pasted layer uses xlink', () => {
    const content = defaultDocumentContent('x');
    content.layers = [
      layer('svg', {
        svg: '<svg viewBox="0 0 24 24"><use xlink:href="#a"/><g id="a"/></svg>',
      }),
    ];
    expect(buildSvg(content)).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
  });

  it('non-square canvases carry through', () => {
    const content = { ...defaultDocumentContent('x'), width: 640, height: 360 };
    const svg = buildSvg(content);
    expect(svg).toContain('viewBox="0 0 640 360"');
  });
});

// ---- bounds + subtraction ---------------------------------------------------

describe('layerBounds', () => {
  it('unrotated shapes: the w x h box around the center, padded by stroke', () => {
    expect(layerBounds(layer('rect', { x: 100, y: 50, width: 40, height: 20 }))).toEqual({
      x: 80,
      y: 40,
      w: 40,
      h: 20,
    });
    const stroked = layer('rect', { x: 100, y: 50, width: 40, height: 20, stroke: '#000', stroke_width: 4 });
    expect(layerBounds(stroked)).toEqual({ x: 78, y: 38, w: 44, h: 24 });
  });

  it('rotation enlarges the axis-aligned box', () => {
    const b = layerBounds(layer('rect', { x: 0, y: 0, width: 100, height: 20, rotation: 90 }));
    expect(b.w).toBeCloseTo(20, 5);
    expect(b.h).toBeCloseTo(100, 5);
  });

  it('lines/polygons bound their points (and controls), padded by the stroke', () => {
    const line = layer('line', {
      x: 100,
      y: 100,
      points: [
        { x: -50, y: 0 },
        { x: 50, y: 0 },
      ],
      c1: { x: 0, y: -40 },
      stroke_width: 6,
    });
    expect(layerBounds(line)).toEqual({ x: 47, y: 57, w: 106, h: 46 });
  });
});

describe('subtractLayers', () => {
  it('bakes base-minus-cutter into a pasted-SVG layer positioned over the base', () => {
    const square = layer('rect', { id: 'sq', x: 100, y: 100, width: 80, height: 80, fill: '#123456' });
    const slice = layer('line', {
      id: 'ln',
      x: 100,
      y: 100,
      points: [
        { x: -60, y: 0 },
        { x: 60, y: 0 },
      ],
      stroke_width: 6,
    });
    const out = subtractLayers(square, slice);
    expect(out.kind).toBe('svg');
    expect(out.id).not.toBe('sq');
    // Sits exactly where the square was, no rotation of its own.
    expect({ x: out.x, y: out.y, w: out.width, h: out.height }).toEqual({ x: 100, y: 100, w: 80, h: 80 });
    expect(out.rotation).toBe(0);
    // Markup: a luminance mask (white bounds, cutter forced black by filter)
    // over the base's own rendering, all inside a viewBox of the bounds.
    expect(out.svg).toContain('viewBox="60 60 80 80"');
    expect(out.svg).toContain('<mask id="cut"');
    expect(out.svg).toContain('fill="#fff"');
    expect(out.svg).toContain('feFlood flood-color="#000"');
    expect(out.svg).toContain('<path d="M 40 100 L 160 100"'); // the cutter line
    expect(out.svg).toContain('fill="#123456"'); // the base keeps its color
    expect(out.svg).toMatch(/<g mask="url\(#cut\)"><rect/);
    expect(looksLikeSvg(out.svg)).toBe(true);
  });

  it('the baked layer renders through the normal pasted-SVG path with ids namespaced', () => {
    const base = layer('circle', { id: 'c1' });
    const cutter = layer('rect', { id: 'r1', width: 30, height: 30 });
    const out = subtractLayers(base, cutter);
    const rendered = renderLayer(out);
    expect(rendered).toContain('<g');
    // Ids re-homed so two subtractions in one document don't collide.
    expect(rendered).not.toContain('id="cut"');
    expect(rendered).toMatch(/mask="url\(#l[a-zA-Z0-9]+-cut\)"/);
    expect(rendered).toMatch(/filter="url\(#l[a-zA-Z0-9]+-blk\)"/);
  });
});

// ---- paste hardening (ported from the icon-editor seed) --------------------

describe('paste hardening', () => {
  it('ensureSvgNamespace injects xmlns only when missing', () => {
    expect(ensureSvgNamespace('<svg viewBox="0 0 24 24"/>')).toContain(
      'xmlns="http://www.w3.org/2000/svg"'
    );
    const ok = '<svg xmlns="http://www.w3.org/2000/svg"/>';
    expect(ensureSvgNamespace(ok)).toBe(ok);
    expect(ensureSvgNamespace('plain text')).toBe('plain text');
  });

  it('svgViewBox reads viewBox, falls back to width/height, then 24x24', () => {
    expect(svgViewBox('<svg viewBox="0 0 100 50"/>')).toEqual({ x: 0, y: 0, w: 100, h: 50 });
    expect(svgViewBox('<svg viewBox="-8, -8, 16, 16"/>')).toEqual({ x: -8, y: -8, w: 16, h: 16 });
    expect(svgViewBox('<svg width="30" height="10"/>')).toEqual({ x: 0, y: 0, w: 30, h: 10 });
    // stroke-width must not be mistaken for width.
    expect(svgViewBox('<svg stroke-width="9"/>')).toEqual({ x: 0, y: 0, w: 24, h: 24 });
    expect(svgViewBox('<svg viewBox="0 0 0 0"/>')).toEqual({ x: 0, y: 0, w: 24, h: 24 });
  });

  it('svgRootAttrs keeps paint, drops structure', () => {
    const attrs = svgRootAttrs(
      '<svg xmlns="x" viewBox="0 0 1 1" width="9" class="c" fill="currentColor" stroke="#123" stroke-width="2"/>'
    );
    expect(attrs).toContain('fill="currentColor"');
    expect(attrs).toContain('stroke="#123"');
    expect(attrs).toContain('stroke-width="2"');
    for (const dropped of ['xmlns', 'viewBox', 'width="9"', 'class']) {
      expect(attrs, `${dropped} should not survive`).not.toContain(dropped);
    }
  });

  it('namespaceIds rewrites ids and their references, with regex metachars', () => {
    const out = namespaceIds('<g id="a.b"><use href="#a.b"/><rect fill="url(#a.b)"/></g>', 'p-');
    expect(out).toContain('id="p-a.b"');
    expect(out).toContain('href="#p-a.b"');
    expect(out).toContain('url(#p-a.b)');
    expect(out).not.toContain('"#a.b"');
  });

  it('svgInner / looksLikeSvg / escapeXml basics', () => {
    expect(svgInner('<svg viewBox="0 0 1 1"><g/></svg>')).toBe('<g/>');
    expect(looksLikeSvg('<svg xmlns="a"/>')).toBe(true);
    expect(looksLikeSvg('<div>')).toBe(false);
    expect(escapeXml('a < b & "c"')).toBe('a &lt; b &amp; &quot;c&quot;');
  });
});

// ---- normalization ----------------------------------------------------------

describe('normalization', () => {
  it('back-fills fields added after a document was saved', () => {
    const stored = {
      name: 'doc',
      width: 300,
      height: 200,
      layers: [{ id: 'keep-me', kind: 'rect', x: 10, y: 20 }],
    };
    const content = normalizeDocumentContent(stored as never);
    expect(content.layers[0]!.id).toBe('keep-me');
    expect(content.layers[0]!.x).toBe(10);
    expect(content.layers[0]!.stroke).toBe('none');
    expect(content.layers[0]!.points).toEqual([]);
    // Absent background falls back to the default, null stays transparent.
    expect(content.background).toBe('#ffffff');
    expect(normalizeDocumentContent({ background: null } as never).background).toBeNull();
  });

  it('heals null/NaN numerics (an emptied number input binds null)', () => {
    // Without a fallback: kind defaults, sizes kept ≥ 1.
    const healed = normalizeLayer({ kind: 'rect', width: null, height: NaN, x: null } as never);
    expect(healed.width).toBeGreaterThanOrEqual(1);
    expect(healed.height).toBeGreaterThanOrEqual(1);
    expect(Number.isFinite(healed.x)).toBe(true);
    // With a fallback (the last committed layer): its values win.
    const prev = layer('rect', { id: 'L', width: 77, height: 33, x: 12 });
    const reverted = normalizeLayer({ ...prev, width: null, x: undefined } as never, prev);
    expect(reverted.width).toBe(77);
    expect(reverted.x).toBe(12);
    expect(reverted.height).toBe(33);
    // Whole-document form: layers matched by id, canvas clamped, name kept.
    const committed = { ...defaultDocumentContent('doc'), layers: [prev] };
    const dirty = { ...committed, width: 2, layers: [{ ...prev, width: null }] };
    const clean = normalizeDocumentContent(dirty as never, committed);
    expect(clean.width).toBe(16);
    expect(clean.name).toBe('doc');
    expect(clean.layers[0]!.width).toBe(77);
  });

  it('drops a dangling cubic control (c2 without c1)', () => {
    const norm = normalizeLayer({ kind: 'line', c2: { x: 1, y: 1 } });
    expect(norm.c1).toBeNull();
    expect(norm.c2).toBeNull();
  });

  it('clamps canvas dimensions into the supported range', () => {
    const content = normalizeDocumentContent({ width: 1, height: 99999 } as never);
    expect(content.width).toBe(16);
    expect(content.height).toBe(4096);
  });

  it('every kind gets sensible newLayer defaults centered on the canvas', () => {
    for (const kind of ['rect', 'circle', 'triangle', 'star', 'text', 'svg', 'line', 'polygon'] as const) {
      const l = newLayer(kind, 400, 300);
      expect(l.kind).toBe(kind);
      expect(l.x).toBe(200);
      expect(l.y).toBe(150);
      expect(l.width).toBeGreaterThan(0);
      expect(l.height).toBeGreaterThan(0);
    }
    expect(newLayer('line', 256, 256).points).toHaveLength(2);
    expect(newLayer('polygon', 256, 256).points).toHaveLength(5);
  });
});
