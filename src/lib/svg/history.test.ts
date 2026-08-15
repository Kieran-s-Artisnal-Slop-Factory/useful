import { describe, expect, it } from 'vitest';
import { HISTORY_LIMIT, canRedo, canUndo, createHistory, push, redo, undo } from './history';

describe('history stack', () => {
  it('starts empty on both sides', () => {
    const h = createHistory({ n: 1 });
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
    expect(h.present).toEqual({ n: 1 });
  });

  it('push / undo / redo round-trips states', () => {
    let h = createHistory({ n: 1 });
    h = push(h, { n: 2 });
    h = push(h, { n: 3 });
    expect(h.present).toEqual({ n: 3 });
    h = undo(h);
    expect(h.present).toEqual({ n: 2 });
    expect(canRedo(h)).toBe(true);
    h = undo(h);
    expect(h.present).toEqual({ n: 1 });
    expect(canUndo(h)).toBe(false);
    h = redo(h);
    h = redo(h);
    expect(h.present).toEqual({ n: 3 });
    expect(canRedo(h)).toBe(false);
  });

  it('undo/redo at the ends are no-ops, not errors', () => {
    let h = createHistory({ n: 1 });
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });

  it('pushing an identical state is coalesced (same history back)', () => {
    // Editors call push() after every committed gesture; a gesture that ended
    // up changing nothing (drag back to the start) must not pollute the stack.
    let h = createHistory({ a: [1, 2] });
    const same = push(h, { a: [1, 2] });
    expect(same).toBe(h);
  });

  it('push after undo discards the redo branch', () => {
    let h = createHistory({ n: 1 });
    h = push(h, { n: 2 });
    h = undo(h);
    h = push(h, { n: 99 });
    expect(canRedo(h)).toBe(false);
    expect(h.present).toEqual({ n: 99 });
    h = undo(h);
    expect(h.present).toEqual({ n: 1 });
  });

  it('snapshots are deep copies — later mutation cannot corrupt the past', () => {
    const state = { layers: [{ x: 1 }] };
    let h = createHistory(state);
    state.layers[0]!.x = 2;
    h = push(h, state);
    h = undo(h);
    expect(h.present).toEqual({ layers: [{ x: 1 }] });
  });

  it('caps the past at HISTORY_LIMIT', () => {
    let h = createHistory({ n: 0 });
    for (let i = 1; i <= HISTORY_LIMIT + 10; i++) h = push(h, { n: i });
    expect(h.past.length).toBe(HISTORY_LIMIT);
    // The oldest snapshots fell off the end.
    expect(h.past[0]).toEqual({ n: 10 });
  });
});
