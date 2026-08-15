/**
 * Undo/redo for the raster editor.
 *
 * The SVG editor's history (src/lib/svg/history.ts) snapshots through JSON,
 * which is exactly right there — an SVG document IS its JSON. It cannot work
 * here: raster layers hold decoded bitmaps (`HTMLCanvasElement`), which JSON
 * would turn into `{}` and quietly erase every image in the document.
 *
 * So this module deep-copies the layer tree but passes NON-PLAIN objects
 * (canvases) through by reference. That is sound because bitmaps in this
 * editor are immutable: every operation that changes pixels builds a new
 * canvas rather than drawing into an existing layer's source.
 *
 * Change detection uses the same walk: a structural signature in which each
 * canvas is a stable `#canvas<n>` token. Snapshots that signature-match are
 * coalesced, which is what makes a slider drag one undo step instead of
 * ninety, and makes re-recording a state restored by undo a no-op.
 */
import type { RasterDocument, RasterLayer } from './model';

export interface RasterSnapshot {
  doc: RasterDocument | null;
  layers: RasterLayer[];
}

export interface RasterHistory {
  past: RasterSnapshot[];
  present: RasterSnapshot;
  /** Signature of `present`, kept so a push costs one walk, not two. */
  presentKey: string;
  future: RasterSnapshot[];
}

/** Steps kept before the oldest is dropped (each holds bitmap REFERENCES). */
export const HISTORY_LIMIT = 60;

/** Is this a plain object/array we own, or foreign state (a canvas)? */
function isPlain(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return true;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map(cloneValue) as unknown as T;
  if (isPlain(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = cloneValue(inner);
    }
    return out as T;
  }
  // Canvases and anything else exotic: shared, never copied.
  return value;
}

export function cloneLayers(layers: RasterLayer[]): RasterLayer[] {
  return cloneValue(layers);
}

export function cloneSnapshot(snapshot: RasterSnapshot): RasterSnapshot {
  return { doc: cloneValue(snapshot.doc), layers: cloneLayers(snapshot.layers) };
}

// Identity for foreign objects: the SAME canvas must produce the same token
// every time, or every signature would differ and nothing would coalesce.
const foreignIds = new WeakMap<object, string>();
let foreignCount = 0;

function foreignId(value: object): string {
  let id = foreignIds.get(value);
  if (!id) {
    id = `#canvas${++foreignCount}`;
    foreignIds.set(value, id);
  }
  return id;
}

/** A stable structural key for a snapshot (bitmaps by identity, not content). */
export function signature(snapshot: RasterSnapshot): string {
  const seen = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(seen);
    if (isPlain(value)) {
      const out: Record<string, unknown> = {};
      // Sorted keys: property insertion order is not part of the state, and a
      // rebuilt object with the same fields must not read as a change.
      for (const key of Object.keys(value as Record<string, unknown>).sort()) {
        out[key] = seen((value as Record<string, unknown>)[key]);
      }
      return out;
    }
    if (value && typeof value === 'object') return foreignId(value);
    return value;
  };
  return JSON.stringify(seen(snapshot));
}

export function createHistory(initial: RasterSnapshot): RasterHistory {
  const present = cloneSnapshot(initial);
  return { past: [], present, presentKey: signature(present), future: [] };
}

/** Record a state. Returns the SAME history when nothing structural changed. */
export function push(history: RasterHistory, snapshot: RasterSnapshot): RasterHistory {
  const key = signature(snapshot);
  if (key === history.presentKey) return history;
  const past = [...history.past, history.present];
  if (past.length > HISTORY_LIMIT) past.shift();
  return { past, present: cloneSnapshot(snapshot), presentKey: key, future: [] };
}

export function canUndo(history: RasterHistory): boolean {
  return history.past.length > 0;
}

export function canRedo(history: RasterHistory): boolean {
  return history.future.length > 0;
}

export function undo(history: RasterHistory): RasterHistory {
  if (history.past.length === 0) return history;
  const present = history.past[history.past.length - 1]!;
  return {
    past: history.past.slice(0, -1),
    present,
    presentKey: signature(present),
    future: [history.present, ...history.future],
  };
}

export function redo(history: RasterHistory): RasterHistory {
  if (history.future.length === 0) return history;
  const present = history.future[0]!;
  return {
    past: [...history.past, history.present],
    present,
    presentKey: signature(present),
    future: history.future.slice(1),
  };
}

/**
 * Read every property of the state so a Svelte `$effect` that calls this
 * subscribes to the WHOLE tree. Deliberately allocation-free: it runs on every
 * change (including each point of a brush stroke), while the expensive
 * signature/clone work waits for the user to pause.
 */
export function touchDeep(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) touchDeep(item);
    return;
  }
  if (isPlain(value)) {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      touchDeep((value as Record<string, unknown>)[key]);
    }
  }
}
