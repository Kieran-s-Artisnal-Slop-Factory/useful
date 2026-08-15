import { describe, expect, it } from 'vitest';
import type {
  AdjustLayer,
  ArrowLayer,
  CropLayer,
  ImageLayer,
  MaskLayer,
  RasterLayer,
  StrokeLayer,
  TextLayer,
} from './model';
import {
  canHost,
  canNestUnder,
  flattenLayers,
  isEffectLayer,
  isWithin,
  layerDefaults,
  locateLayer,
  moveLayer,
  removeLayer,
  type FillLayer,
  type GroupLayer,
} from './model';
import {
  arrowHeadLength,
  arrowHeadPoints,
  arrowLongEnough,
  arrowShaftEnd,
  clampRect,
  layerBounds,
  normalizeRect,
  rectContains,
  rotateImageLayerCW,
  rotateLayerCW,
  rotatePointCCW,
  rotatePointCW,
  rotateRectCW,
  rotatedSize,
  scaleLayer,
  scaleLayerTree,
  shiftLayer,
  shiftLayerTree,
} from './transform';

const common = (name: string) => ({ ...layerDefaults(name), id: name });

const stroke: StrokeLayer = {
  ...common('s'),
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
  ...common('a'),
  kind: 'arrow',
  from: { x: 1, y: 2 },
  to: { x: 20, y: 10 },
  color: '#f00',
  size: 4,
};
const text: TextLayer = {
  ...common('t'),
  kind: 'text',
  text: 'hi',
  x: 5,
  y: 6,
  size: 24,
  color: '#fff',
  bold: false,
};
const adjust: AdjustLayer = {
  ...common('d'),
  kind: 'adjust',
  mode: 'blur',
  rect: { x: 2, y: 4, w: 8, h: 6 },
  amount: 50,
};
const crop: CropLayer = { ...common('c'), kind: 'crop', rect: { x: 1, y: 1, w: 5, h: 5 } };
const mask: MaskLayer = {
  ...common('m'),
  kind: 'mask',
  source: { width: 40, height: 30 } as unknown as HTMLCanvasElement,
  rect: { x: 10, y: 20, w: 40, h: 30 },
  quarter: 0,
  invert: false,
};
const fill: FillLayer = { ...common('f'), kind: 'fill', color: '#fff' };
const group: GroupLayer = { ...common('g'), kind: 'group' };
/** A stand-in bitmap — transform math never touches pixels. */
const fakeSource = { width: 40, height: 30 } as unknown as HTMLCanvasElement;
const image: ImageLayer = {
  ...common('i'),
  kind: 'image',
  source: fakeSource,
  fileName: 'p.png',
  x: 10,
  y: 20,
  width: 40,
  height: 30,
  quarter: 0,
};

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
    expect(rotateRectCW({ x: 0, y: 0, w: 10, h: 5 }, 40, 30)).toEqual({ x: 25, y: 0, w: 5, h: 10 });
    expect(rotateRectCW({ x: 0, y: 0, w: 40, h: 30 }, 40, 30)).toEqual({ x: 0, y: 0, w: 30, h: 40 });
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

  it('clampRect intersects with the space (edges clamp independently)', () => {
    // A marquee dragged past the top-left keeps only its on-canvas span: the
    // rect must NOT slide inward and keep its full size.
    expect(clampRect({ x: -5, y: -5, w: 20, h: 20 }, 40, 30)).toEqual({ x: 0, y: 0, w: 15, h: 15 });
    expect(clampRect({ x: 35, y: 25, w: 20, h: 20 }, 40, 30)).toEqual({ x: 35, y: 25, w: 5, h: 5 });
    // Off-canvas drag to the left from x=10 keeps 0..10.
    expect(clampRect({ x: -100, y: 5, w: 110, h: 20 }, 40, 30)).toEqual({ x: 0, y: 5, w: 10, h: 20 });
  });

  it('clampRect never collapses below 1 x 1', () => {
    expect(clampRect({ x: 10, y: 10, w: 0, h: 0 }, 40, 30)).toEqual({ x: 10, y: 10, w: 1, h: 1 });
    expect(clampRect({ x: 100, y: 100, w: 5, h: 5 }, 40, 30)).toEqual({ x: 39, y: 29, w: 1, h: 1 });
  });

  it('rectContains is inclusive of edges', () => {
    const r = { x: 0, y: 0, w: 10, h: 10 };
    expect(rectContains(r, { x: 10, y: 10 })).toBe(true);
    expect(rectContains(r, { x: 11, y: 5 })).toBe(false);
  });
});

describe('layer remapping', () => {
  it('rotateLayerCW remaps every layer kind through the same point math', () => {
    const w = 40;
    const h = 30;
    expect((rotateLayerCW(stroke, w, h) as StrokeLayer).points[1]).toEqual(rotatePointCW({ x: 10, y: 5 }, w, h));
    const ra = rotateLayerCW(arrow, w, h) as ArrowLayer;
    expect(ra.from).toEqual(rotatePointCW(arrow.from, w, h));
    expect(ra.to).toEqual(rotatePointCW(arrow.to, w, h));
    const rt = rotateLayerCW(text, w, h) as TextLayer;
    expect({ x: rt.x, y: rt.y }).toEqual(rotatePointCW({ x: 5, y: 6 }, w, h));
    expect((rotateLayerCW(adjust, w, h) as AdjustLayer).rect).toEqual(rotateRectCW(adjust.rect, w, h));
    expect((rotateLayerCW(crop, w, h) as CropLayer).rect).toEqual(rotateRectCW(crop.rect, w, h));
    const ri = rotateLayerCW(image, w, h) as ImageLayer;
    expect(ri.quarter).toBe(1);
    expect({ x: ri.x, y: ri.y, w: ri.width, h: ri.height }).toEqual(rotateRectCW({ x: 10, y: 20, w: 40, h: 30 }, w, h));
  });

  it('rotateLayerCW returns copies — the original layers are untouched', () => {
    const before = JSON.parse(JSON.stringify(stroke));
    rotateLayerCW(stroke, 40, 30);
    expect(stroke).toEqual(before);
  });

  it('shiftLayer translates every kind; shiftLayerTree carries children', () => {
    expect((shiftLayer(stroke, -2, -4) as StrokeLayer).points[0]).toEqual({ x: -2, y: -4 });
    expect((shiftLayer(arrow, -2, -4) as ArrowLayer).to).toEqual({ x: 18, y: 6 });
    const st = shiftLayer(text, -2, -4) as TextLayer;
    expect({ x: st.x, y: st.y }).toEqual({ x: 3, y: 2 });
    expect((shiftLayer(adjust, -2, -4) as AdjustLayer).rect).toEqual({ x: 0, y: 0, w: 8, h: 6 });
    expect((shiftLayer(crop, 1, 1) as CropLayer).rect).toEqual({ x: 2, y: 2, w: 5, h: 5 });
    const si = shiftLayer(image, 5, 5) as ImageLayer;
    expect({ x: si.x, y: si.y }).toEqual({ x: 15, y: 25 });

    const parent: ImageLayer = { ...image, children: [crop, stroke] };
    const moved = shiftLayerTree(parent, 3, 4) as ImageLayer;
    expect(moved.x).toBe(13);
    expect((moved.children[0] as CropLayer).rect.x).toBe(4);
    expect((moved.children[1] as StrokeLayer).points[0]).toEqual({ x: 3, y: 4 });
    // shiftLayer alone leaves children where they were.
    expect((shiftLayer(parent, 3, 4) as ImageLayer).children).toBe(parent.children);
  });

  it('shift then unshift round-trips exactly', () => {
    for (const layer of [stroke, arrow, text, adjust, crop, image] as RasterLayer[]) {
      expect(shiftLayer(shiftLayer(layer, -7, -9), 7, 9)).toEqual(layer);
    }
  });

  it('rotateImageLayerCW turns about the image center and carries children', () => {
    // Image at (10,20) 40x30 → center (30,35). After CW: 30x40 on the same
    // center → x = 15, y = 15.
    const withCrop: ImageLayer = {
      ...image,
      children: [{ ...crop, rect: { x: 10, y: 20, w: 10, h: 5 } }], // top-left corner of the image
    };
    const r = rotateImageLayerCW(withCrop);
    expect({ x: r.x, y: r.y, w: r.width, h: r.height, q: r.quarter }).toEqual({ x: 15, y: 15, w: 30, h: 40, q: 1 });
    // The child crop hugged the image's top-left; after a CW turn it hugs the
    // image's top-RIGHT (x+w-5 .. x+w), swapped size.
    expect((r.children[0] as CropLayer).rect).toEqual({ x: 40, y: 15, w: 5, h: 10 });
    // Four turns bring everything home.
    let back = withCrop;
    for (let i = 0; i < 4; i++) back = rotateImageLayerCW(back);
    expect({ x: back.x, y: back.y, w: back.width, h: back.height, q: back.quarter }).toEqual({ x: 10, y: 20, w: 40, h: 30, q: 0 });
    expect((back.children[0] as CropLayer).rect).toEqual({ x: 10, y: 20, w: 10, h: 5 });
  });

  it('layerBounds covers every kind and pads strokes/arrows', () => {
    expect(layerBounds(image)).toEqual({ x: 10, y: 20, w: 40, h: 30 });
    expect(layerBounds(crop)).toEqual(crop.rect);
    expect(layerBounds(adjust)).toEqual(adjust.rect);
    const sb = layerBounds(stroke)!;
    expect(sb.x).toBe(-2);
    expect(sb.w).toBe(14);
    expect(layerBounds({ ...stroke, points: [] })).toBeNull();
    const tb = layerBounds(text)!;
    expect(rectContains(tb, { x: 5, y: 6 })).toBe(true);
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
    const mk = (tx: number): ArrowLayer => ({ ...arrow, to: { x: tx, y: 0 }, from: { x: 0, y: 0 } });
    expect(arrowLongEnough(mk(3))).toBe(false);
    expect(arrowLongEnough(mk(30))).toBe(true);
  });
});

describe('layer tree', () => {
  const tree = (): RasterLayer[] => [
    { ...image, children: [{ ...crop }, { ...stroke, mode: 'erase' }] },
    { ...text },
    { ...arrow },
  ];

  it('locateLayer finds top-level and nested layers with their parent', () => {
    const t = tree();
    expect(locateLayer(t, 't')).toMatchObject({ index: 1, parent: null });
    const loc = locateLayer(t, 'c')!;
    expect(loc.parent?.id).toBe('i');
    expect(loc.index).toBe(0);
    expect(locateLayer(t, 'nope')).toBeNull();
  });

  it('flattenLayers lists top-first with children right under their parent', () => {
    expect(flattenLayers(tree()).map((e) => e.layer.id + (e.parent ? '<' + e.parent.id : ''))).toEqual([
      'a',
      't',
      'i',
      's<i',
      'c<i',
    ]);
  });

  it('removeLayer removes anywhere; a top-level removal takes its children', () => {
    const t = tree();
    expect(removeLayer(t, 'c')?.id).toBe('c');
    expect(t[0]!.children.map((c) => c.id)).toEqual(['s']);
    expect(removeLayer(t, 'i')?.id).toBe('i');
    expect(t.map((l) => l.id)).toEqual(['t', 'a']);
    expect(removeLayer(t, 'zzz')).toBeNull();
  });

  it('moveLayer reorders within a level and re-parents under hosts', () => {
    const t = tree();
    // Top-level reorder: arrow to the bottom.
    expect(moveLayer(t, 'a', { parentId: null, index: 0 })).toBe(true);
    expect(t.map((l) => l.id)).toEqual(['a', 'i', 't']);
    // Nest the text under the image (appends at the given child index).
    expect(moveLayer(t, 't', { parentId: 'i', index: 99 })).toBe(true);
    expect(t.map((l) => l.id)).toEqual(['a', 'i']);
    expect(t[1]!.children.map((c) => c.id)).toEqual(['c', 's', 't']);
    // Un-nest the crop to top level above the image.
    expect(moveLayer(t, 'c', { parentId: null, index: 2 })).toBe(true);
    expect(t.map((l) => l.id)).toEqual(['a', 'i', 'c']);
    // Refusals: into yourself / your own subtree; images under non-groups;
    // anything under an effect layer (the top-level crop 'c').
    expect(moveLayer(t, 'i', { parentId: 'i', index: 0 })).toBe(false);
    expect(moveLayer(t, 'i', { parentId: 't', index: 0 })).toBe(false);
    expect(moveLayer(t, 'i', { parentId: 'c', index: 0 })).toBe(false);
    expect(moveLayer(t, 'a', { parentId: 'c', index: 0 })).toBe(false);
    expect(canHost(crop)).toBe(false);
    expect(canHost(image)).toBe(true);
    expect(canNestUnder(image, text)).toBe(false);
    expect(canNestUnder(image, group)).toBe(true);
    expect(canNestUnder(image, null)).toBe(true);
    expect(canNestUnder(text, image)).toBe(true);
  });

  it('groups host anything (incl. images) at any depth; subtrees move whole', () => {
    // Fresh children arrays: spreading a fixture would share (and mutate) its list.
    const t: RasterLayer[] = [
      { ...group, id: 'g1', children: [] },
      { ...image, id: 'photo', children: [] },
      { ...text, id: 'label', children: [] },
    ];
    // Image into the group; a nested group inside it; text into that.
    expect(moveLayer(t, 'photo', { parentId: 'g1', index: 0 })).toBe(true);
    const g1 = t.find((l) => l.id === 'g1')!;
    g1.children.push({ ...group, id: 'g2', children: [] });
    expect(moveLayer(t, 'label', { parentId: 'g2', index: 0 })).toBe(true);
    expect(locateLayer(t, 'label')).toMatchObject({ depth: 2 });
    expect(locateLayer(t, 'label')!.parent!.id).toBe('g2');
    // The whole subtree flattens top-first, depth-first.
    expect(flattenLayers(t).map((e) => e.layer.id + ':' + e.depth)).toEqual(['g1:0', 'g2:1', 'label:2', 'photo:1']);
    // Cannot move g1 into its own descendant g2.
    expect(isWithin(t, 'g1', 'label')).toBe(true);
    expect(moveLayer(t, 'g1', { parentId: 'g2', index: 0 })).toBe(false);
    // Moving g2 out to root carries label with it.
    expect(moveLayer(t, 'g2', { parentId: null, index: 99 })).toBe(true);
    expect(t.map((l) => l.id)).toEqual(['g1', 'g2']);
    expect(t[1]!.children.map((c) => c.id)).toEqual(['label']);
    // Removing a group removes its subtree.
    expect(removeLayer(t, 'g2')?.id).toBe('g2');
    expect(locateLayer(t, 'label')).toBeNull();
  });

  it('scaleLayer maps geometry between rects; scaleLayerTree carries children', () => {
    const from = { x: 10, y: 20, w: 40, h: 30 };
    const to = { x: 0, y: 0, w: 80, h: 60 }; // ×2, moved to origin
    const si = scaleLayer(image, from, to) as ImageLayer;
    expect({ x: si.x, y: si.y, w: si.width, h: si.height }).toEqual({ x: 0, y: 0, w: 80, h: 60 });
    // A stroke point at the image's top-left corner lands at the new corner;
    // its brush size doubles (geometric mean of ×2, ×2).
    const s2 = scaleLayer({ ...stroke, points: [{ x: 10, y: 20 }, { x: 50, y: 50 }] }, from, to) as StrokeLayer;
    expect(s2.points).toEqual([{ x: 0, y: 0 }, { x: 80, y: 60 }]);
    expect(s2.size).toBe(8);
    expect((scaleLayer(crop, from, to) as CropLayer).rect).toEqual({ x: -18, y: -38, w: 10, h: 10 });
    expect(scaleLayer(fill, from, to)).toBe(fill);
    const parent: ImageLayer = { ...image, children: [{ ...crop, rect: { x: 10, y: 20, w: 20, h: 15 } }] };
    const st = scaleLayerTree(parent, from, to) as ImageLayer;
    expect((st.children[0] as CropLayer).rect).toEqual({ x: 0, y: 0, w: 40, h: 30 });
  });

  it('layerBounds: fills have none, groups bound their children', () => {
    expect(layerBounds(fill)).toBeNull();
    expect(layerBounds(group)).toBeNull();
    const g: GroupLayer = { ...group, children: [image, { ...crop, rect: { x: 0, y: 0, w: 5, h: 5 } }] };
    expect(layerBounds(g)).toEqual({ x: 0, y: 0, w: 50, h: 50 });
  });

  it('a background mask moves, scales and turns with the layer it is stuck to', () => {
    // Same geometry rules as a crop, plus its stencil bitmap turns with it.
    expect((shiftLayer(mask, 3, 4) as MaskLayer).rect).toEqual({ x: 13, y: 24, w: 40, h: 30 });
    const turned = rotateLayerCW(mask, 100, 80) as MaskLayer;
    expect(turned.quarter).toBe(1);
    expect(turned.rect).toEqual(rotateRectCW(mask.rect, 100, 80));
    const scaled = scaleLayer(mask, { x: 10, y: 20, w: 40, h: 30 }, { x: 0, y: 0, w: 80, h: 30 }) as MaskLayer;
    expect(scaled.rect).toEqual({ x: 0, y: 0, w: 80, h: 30 });
    expect(layerBounds(mask)).toEqual(mask.rect);
    // Carried along when its parent image is scaled or turned.
    const parent: ImageLayer = { ...image, children: [mask] };
    const grown = scaleLayerTree(parent, { x: 10, y: 20, w: 40, h: 30 }, { x: 10, y: 20, w: 80, h: 60 }) as ImageLayer;
    expect((grown.children[0] as MaskLayer).rect).toEqual({ x: 10, y: 20, w: 80, h: 60 });
    const spun = rotateImageLayerCW(parent);
    expect((spun.children[0] as MaskLayer).quarter).toBe(1);
  });

  it('isEffectLayer: crop/mask/adjust/eraser act on a target; content layers do not', () => {
    expect(isEffectLayer(crop)).toBe(true);
    expect(isEffectLayer(mask)).toBe(true);
    expect(canHost(mask)).toBe(false);
    expect(isEffectLayer(adjust)).toBe(true);
    expect(isEffectLayer({ ...stroke, mode: 'erase' })).toBe(true);
    expect(isEffectLayer(stroke)).toBe(false);
    expect(isEffectLayer(image)).toBe(false);
    expect(isEffectLayer(text)).toBe(false);
  });
});
