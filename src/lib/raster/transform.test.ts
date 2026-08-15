import { describe, expect, it } from 'vitest';
import type { AdjustLayer, ArrowLayer, RasterLayer, StrokeLayer, TextLayer } from './model';
import {
  arrowHeadLength,
  arrowHeadPoints,
  arrowLongEnough,
  arrowShaftEnd,
  clampRect,
  normalizeRect,
  rotateLayerCW,
  rotatePointCCW,
  rotatePointCW,
  rotateRectCW,
  rotatedSize,
  shiftLayer,
} from './transform';

describe('rotation math', () => {
  it('rotatedSize swaps dimensions on odd quarters only', () => {
    expect(rotatedSize(40, 30, 0)).toEqual({ w: 40, h: 30 });
    expect(rotatedSize(40, 30, 1)).toEqual({ w: 30, h: 40 });
    expect(rotatedSize(40, 30, 2)).toEqual({ w: 40, h: 30 });
    expect(rotatedSize(40, 30, 3)).toEqual({ w: 30, h: 40 });
  });

  it('rotatePointCW maps corners of a w x h space correctly', () => {
    // 40 x 30 image, clockwise: top-left → top-right of the new 30 x 40 space.
    expect(rotatePointCW({ x: 0, y: 0 }, 40, 30)).toEqual({ x: 30, y: 0 });
    expect(rotatePointCW({ x: 40, y: 0 }, 40, 30)).toEqual({ x: 30, y: 40 });
    expect(rotatePointCW({ x: 40, y: 30 }, 40, 30)).toEqual({ x: 0, y: 40 });
    expect(rotatePointCW({ x: 0, y: 30 }, 40, 30)).toEqual({ x: 0, y: 0 });
  });

  it('CW then CCW is the identity (and four CWs compose to it)', () => {
    const p = { x: 7, y: 21 };
    let w = 40;
    let h = 30;
    expect(rotatePointCCW(rotatePointCW(p, w, h), h, w)).toEqual(p);
    let q = { ...p };
    for (let i = 0; i < 4; i++) {
      q = rotatePointCW(q, w, h);
      [w, h] = [h, w];
    }
    expect(q).toEqual(p);
  });

  it('rotateRectCW keeps the same pixels selected', () => {
    // A rect hugging the top-left of a 40 x 30 image lands hugging the
    // top-RIGHT after a clockwise turn, with w/h swapped.
    expect(rotateRectCW({ x: 0, y: 0, w: 10, h: 5 }, 40, 30)).toEqual({
      x: 25,
      y: 0,
      w: 5,
      h: 10,
    });
    // Full-frame stays full-frame.
    expect(rotateRectCW({ x: 0, y: 0, w: 40, h: 30 }, 40, 30)).toEqual({
      x: 0,
      y: 0,
      w: 30,
      h: 40,
    });
  });

  it('four rect rotations compose to the identity', () => {
    let r = { x: 3, y: 8, w: 12, h: 6 };
    let w = 40;
    let h = 30;
    for (let i = 0; i < 4; i++) {
      r = rotateRectCW(r, w, h);
      [w, h] = [h, w];
    }
    expect(r).toEqual({ x: 3, y: 8, w: 12, h: 6 });
  });
});

describe('rect helpers', () => {
  it('normalizeRect accepts any drag direction', () => {
    expect(normalizeRect({ x: 10, y: 20 }, { x: 4, y: 2 })).toEqual({ x: 4, y: 2, w: 6, h: 18 });
    expect(normalizeRect({ x: 4, y: 2 }, { x: 10, y: 20 })).toEqual({ x: 4, y: 2, w: 6, h: 18 });
  });

  it('clampRect confines to the space and never collapses below 1 x 1', () => {
    expect(clampRect({ x: -5, y: -5, w: 20, h: 20 }, 40, 30)).toEqual({ x: 0, y: 0, w: 20, h: 20 });
    expect(clampRect({ x: 35, y: 25, w: 20, h: 20 }, 40, 30)).toEqual({ x: 35, y: 25, w: 5, h: 5 });
    expect(clampRect({ x: 10, y: 10, w: 0, h: 0 }, 40, 30)).toEqual({ x: 10, y: 10, w: 1, h: 1 });
  });
});

describe('layer remapping', () => {
  const stroke: StrokeLayer = {
    id: 's',
    kind: 'stroke',
    mode: 'paint',
    color: '#f00',
    size: 4,
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 5 },
    ],
  };
  const arrow: ArrowLayer = {
    id: 'a',
    kind: 'arrow',
    from: { x: 1, y: 2 },
    to: { x: 20, y: 10 },
    color: '#f00',
    size: 4,
  };
  const text: TextLayer = {
    id: 't',
    kind: 'text',
    text: 'hi',
    x: 5,
    y: 6,
    size: 24,
    color: '#fff',
    bold: false,
  };
  const adjust: AdjustLayer = {
    id: 'd',
    kind: 'adjust',
    mode: 'blur',
    rect: { x: 2, y: 4, w: 8, h: 6 },
    amount: 50,
  };

  it('rotateLayerCW remaps every layer kind through the same point math', () => {
    const w = 40;
    const h = 30;
    expect((rotateLayerCW(stroke, w, h) as StrokeLayer).points[1]).toEqual(
      rotatePointCW({ x: 10, y: 5 }, w, h)
    );
    const ra = rotateLayerCW(arrow, w, h) as ArrowLayer;
    expect(ra.from).toEqual(rotatePointCW(arrow.from, w, h));
    expect(ra.to).toEqual(rotatePointCW(arrow.to, w, h));
    const rt = rotateLayerCW(text, w, h) as TextLayer;
    expect({ x: rt.x, y: rt.y }).toEqual(rotatePointCW({ x: 5, y: 6 }, w, h));
    expect((rotateLayerCW(adjust, w, h) as AdjustLayer).rect).toEqual(
      rotateRectCW(adjust.rect, w, h)
    );
  });

  it('rotateLayerCW returns copies — the original layers are untouched', () => {
    const before = JSON.parse(JSON.stringify(stroke));
    rotateLayerCW(stroke, 40, 30);
    expect(stroke).toEqual(before);
  });

  it('shiftLayer translates every kind by the crop offset', () => {
    expect((shiftLayer(stroke, -2, -4) as StrokeLayer).points[0]).toEqual({ x: -2, y: -4 });
    expect((shiftLayer(arrow, -2, -4) as ArrowLayer).to).toEqual({ x: 18, y: 6 });
    const st = shiftLayer(text, -2, -4) as TextLayer;
    expect({ x: st.x, y: st.y }).toEqual({ x: 3, y: 2 });
    expect((shiftLayer(adjust, -2, -4) as AdjustLayer).rect).toEqual({ x: 0, y: 0, w: 8, h: 6 });
  });

  it('crop then uncrop round-trips exactly', () => {
    for (const layer of [stroke, arrow, text, adjust] as RasterLayer[]) {
      expect(shiftLayer(shiftLayer(layer, -7, -9), 7, 9)).toEqual(layer);
    }
  });
});

describe('arrow geometry', () => {
  it('head tip is the target point and wings sit behind it, symmetric', () => {
    const [tip, l, r] = arrowHeadPoints({ x: 0, y: 0 }, { x: 100, y: 0 }, 4);
    expect(tip).toEqual({ x: 100, y: 0 });
    expect(l!.x).toBeCloseTo(r!.x);
    expect(l!.y).toBeCloseTo(-r!.y);
    expect(l!.x).toBeLessThan(100);
  });

  it('degenerate zero-length arrows do not produce NaN', () => {
    const pts = arrowHeadPoints({ x: 5, y: 5 }, { x: 5, y: 5 }, 4);
    for (const p of pts) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
    expect(arrowShaftEnd({ x: 5, y: 5 }, { x: 5, y: 5 }, 4)).toEqual({ x: 5, y: 5 });
  });

  it('shaft stops short of the tip so the head stays pointy', () => {
    const end = arrowShaftEnd({ x: 0, y: 0 }, { x: 100, y: 0 }, 4);
    expect(end.x).toBeLessThan(100);
    expect(end.x).toBeGreaterThan(100 - arrowHeadLength(4));
    expect(end.y).toBe(0);
  });

  it('arrowLongEnough rejects accidental clicks', () => {
    const mk = (tx: number): ArrowLayer => ({
      id: 'a',
      kind: 'arrow',
      from: { x: 0, y: 0 },
      to: { x: tx, y: 0 },
      color: '#f00',
      size: 4,
    });
    expect(arrowLongEnough(mk(3))).toBe(false);
    expect(arrowLongEnough(mk(30))).toBe(true);
  });
});
