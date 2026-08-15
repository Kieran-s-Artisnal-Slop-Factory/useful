import { describe, expect, it } from 'vitest';
import {
  canRedo,
  canUndo,
  cloneLayers,
  createHistory,
  HISTORY_LIMIT,
  push,
  redo,
  signature,
  touchDeep,
  undo,
  type RasterSnapshot,
} from './history';
import { layerDefaults, type ImageLayer, type RasterLayer, type StrokeLayer } from './model';

/** A stand-in bitmap: history must pass these through, never copy them. */
const bitmap = (tag: string) =>
  new (class FakeCanvas {
    tag = tag;
  })() as unknown as HTMLCanvasElement;

function imageLayer(id: string, source: HTMLCanvasElement, x = 0): ImageLayer {
  return {
    ...layerDefaults(id),
    id,
    kind: 'image',
    source,
    fileName: id + '.png',
    x,
    y: 0,
    width: 10,
    height: 10,
    quarter: 0,
  };
}

const snap = (layers: RasterLayer[]): RasterSnapshot => ({
  doc: { width: 100, height: 80, background: null },
  layers,
});

describe('cloneLayers', () => {
  it('deep-copies the tree but shares the bitmaps', () => {
    const source = bitmap('a');
    const child: StrokeLayer = {
      ...layerDefaults('brush'),
      kind: 'stroke',
      mode: 'paint',
      color: '#f00',
      size: 3,
      points: [{ x: 1, y: 2 }],
    };
    const parent = imageLayer('base', source);
    parent.children.push(child);

    const copy = cloneLayers([parent]);
    const copiedParent = copy[0] as ImageLayer;
    expect(copiedParent).not.toBe(parent);
    expect(copiedParent.children[0]).not.toBe(child);
    expect((copiedParent.children[0] as StrokeLayer).points[0]).not.toBe(child.points[0]);
    // The decoded bitmap is shared: copying it would double the memory cost of
    // every undo step, and nothing ever draws into a layer's source.
    expect(copiedParent.source).toBe(source);
    // A real copy: editing it leaves the original alone.
    copiedParent.x = 99;
    expect(parent.x).toBe(0);
  });
});

describe('signature', () => {
  it('ignores key order but notices a real change', () => {
    const source = bitmap('a');
    const a = snap([imageLayer('one', source)]);
    const b = snap([{ ...imageLayer('one', source) }]);
    expect(signature(a)).toBe(signature(b));
    const moved = snap([imageLayer('one', source, 5)]);
    expect(signature(moved)).not.toBe(signature(a));
  });

  it('distinguishes different bitmaps and matches the same one', () => {
    const first = bitmap('first');
    const second = bitmap('second');
    expect(signature(snap([imageLayer('l', first)]))).toBe(signature(snap([imageLayer('l', first)])));
    expect(signature(snap([imageLayer('l', first)]))).not.toBe(signature(snap([imageLayer('l', second)])));
  });
});

describe('history stack', () => {
  it('pushes, undoes and redoes', () => {
    const source = bitmap('a');
    let h = createHistory(snap([imageLayer('l', source, 0)]));
    expect(canUndo(h)).toBe(false);
    h = push(h, snap([imageLayer('l', source, 5)]));
    expect(canUndo(h)).toBe(true);
    expect(canRedo(h)).toBe(false);

    h = undo(h);
    expect((h.present.layers[0] as ImageLayer).x).toBe(0);
    expect(canRedo(h)).toBe(true);
    h = redo(h);
    expect((h.present.layers[0] as ImageLayer).x).toBe(5);
  });

  it('coalesces an unchanged state — a slider drag is one step, not ninety', () => {
    const source = bitmap('a');
    let h = createHistory(snap([imageLayer('l', source, 0)]));
    const same = snap([imageLayer('l', source, 0)]);
    expect(push(h, same)).toBe(h);
    h = push(h, snap([imageLayer('l', source, 1)]));
    expect(h.past.length).toBe(1);
    // Re-recording the state an undo just restored must not add a step.
    const back = undo(h);
    expect(push(back, back.present)).toBe(back);
  });

  it('drops the oldest step past the limit', () => {
    const source = bitmap('a');
    let h = createHistory(snap([imageLayer('l', source, 0)]));
    for (let i = 1; i <= HISTORY_LIMIT + 10; i++) h = push(h, snap([imageLayer('l', source, i)]));
    expect(h.past.length).toBe(HISTORY_LIMIT);
    // The oldest surviving step is not the original state any more.
    expect((h.past[0]!.layers[0] as ImageLayer).x).toBeGreaterThan(0);
  });

  it('a new edit after an undo discards the redo branch', () => {
    const source = bitmap('a');
    let h = createHistory(snap([imageLayer('l', source, 0)]));
    h = push(h, snap([imageLayer('l', source, 1)]));
    h = undo(h);
    expect(canRedo(h)).toBe(true);
    h = push(h, snap([imageLayer('l', source, 2)]));
    expect(canRedo(h)).toBe(false);
  });

  it('undo/redo are no-ops at the ends', () => {
    const h = createHistory(snap([]));
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });

  it('snapshots are isolated from later edits of the live tree', () => {
    const source = bitmap('a');
    const live = [imageLayer('l', source, 0)];
    const h = createHistory(snap(live));
    (live[0] as ImageLayer).x = 42;
    expect((h.present.layers[0] as ImageLayer).x).toBe(0);
  });
});

describe('touchDeep', () => {
  it('reads every nested property (so an effect subscribes to all of it)', () => {
    const read: string[] = [];
    const tree = new Proxy(
      { a: { b: [1, 2] } },
      {
        get(target, key: string) {
          read.push(key);
          return (target as Record<string, unknown>)[key];
        },
      }
    );
    touchDeep(tree);
    expect(read).toContain('a');
  });

  it('does not walk into foreign objects like canvases', () => {
    let touched = false;
    const canvas = new (class {
      get width() {
        touched = true;
        return 1;
      }
    })();
    touchDeep({ source: canvas });
    expect(touched).toBe(false);
  });
});
