import { describe, expect, it } from 'vitest';
import {
  buildSvg,
  ensureSvgNamespace,
  escapeXml,
  linePath,
  looksLikeSvg,
  namespaceIds,
  paintAttrs,
  polygonPoints,
  renderLayer,
  starPoints,
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

  it('starPoints emits 10 alternating outer/inner vertices', () => {
    const star = starPoints(128, 128, 60, 60);
    expect(star.match(/[-\d.]+,[-\d.]+/g)).toHaveLength(10);
  });

  it('trianglePoints fills the layer box', () => {
    expect(trianglePoints(100, 100, 80, 60)).toBe('100,70 60,130 140,130');
  });
});

// ---- paint ------------------------------------------------------------------

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
