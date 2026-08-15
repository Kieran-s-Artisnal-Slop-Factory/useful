/**
 * Undo/redo snapshot stack for the SVG editor. Pure and generic: states are
 * deep-cloned via JSON on the way in (matching the data layer's JSON-native
 * row shape exactly, so a snapshot IS what would be persisted) and identical
 * consecutive snapshots are coalesced. Redo history is truncated on push —
 * the standard branch-discard model.
 */

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

/** Snapshots kept in `past` before the oldest is dropped. */
export const HISTORY_LIMIT = 100;

function clone<T>(state: T): T {
  return JSON.parse(JSON.stringify(state)) as T;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function createHistory<T>(initial: T): History<T> {
  return { past: [], present: clone(initial), future: [] };
}

/** Record a new state. No-op (same object back) if nothing changed. */
export function push<T>(h: History<T>, state: T): History<T> {
  if (same(h.present, state)) return h;
  const past = [...h.past, h.present];
  if (past.length > HISTORY_LIMIT) past.shift();
  return { past, present: clone(state), future: [] };
}

export function canUndo<T>(h: History<T>): boolean {
  return h.past.length > 0;
}

export function canRedo<T>(h: History<T>): boolean {
  return h.future.length > 0;
}

/** Step back; returns the same history when there is nothing to undo. */
export function undo<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h;
  return {
    past: h.past.slice(0, -1),
    present: h.past[h.past.length - 1]!,
    future: [h.present, ...h.future],
  };
}

/** Step forward; returns the same history when there is nothing to redo. */
export function redo<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h;
  return {
    past: [...h.past, h.present],
    present: h.future[0]!,
    future: h.future.slice(1),
  };
}
