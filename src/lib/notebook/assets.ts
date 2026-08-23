/**
 * Where the notebook editor puts the bytes for pasted images.
 *
 * The editor never talks to IndexedDB — it talks to an `AssetStore` (the
 * contract is retoken's, verbatim). Markdown keeps a plain `asset:<id>` ref,
 * which is what a Markdown export writes out; the store maps that ref to a
 * `data:` URL the browser can display, and back to a Blob when the bytes are
 * needed again.
 *
 * Two design facts:
 *
 *  - `resolve()` is SYNCHRONOUS in the contract (Crepe calls it while
 *    rendering an image node), but the bytes live in IndexedDB. So a note's
 *    store is PRIMED once — every asset of the note loaded into a Map — and
 *    `resolve()` answers from that cache, returning undefined for anything it
 *    has not seen. Prime before mounting the editor.
 *  - Every asset is capped at `MAX_ASSET_BYTES`. Backup export builds one
 *    pretty-printed JSON string of the whole database, and base64 inflates
 *    by a third; a few dozen uncapped screenshots is the first thing in this
 *    app able to fail that export on memory.
 *
 * The IndexedDB-backed functions here are thin wrappers over `db/repo.ts` and
 * are exercised by the Playwright suite, not by unit tests; the pure parts
 * (ref parsing, base64, the cap message) are tested in `assets.test.ts`.
 */
import { byIndex, get, put, softDelete, withSyncFields } from '../db/repo';
import { decodeBytes, encodeBytes } from '../encode/base64';
import type { NoteAsset } from '../db/types';

export interface AssetStore {
  /**
   * Store `blob` under a name derived from `filename` and return the src to
   * write into the markdown. Implementations may rename to avoid collisions.
   */
  save(blob: Blob, filename: string): Promise<string>;
  /**
   * Replace the bytes behind an existing src, keeping the src itself valid —
   * this is what lets an edited drawing update every reference to it at
   * once. Optional: without it, editing a drawing inserts a new one.
   */
  replace?(src: string, blob: Blob): Promise<void>;
  /** The bytes behind a src, for reopening a drawing. */
  load?(src: string): Promise<Blob | null>;
  /**
   * The filename a src was saved under, or undefined when the src IS the
   * name (a path) or the store has not seen it. An `asset:<id>` ref carries
   * no name, and the name is what says whether an image is a re-editable
   * drawing (`*.excalidraw.png`). Synchronous, like `resolve`.
   */
  nameOf?(src: string): string | undefined;
  /**
   * A displayable URL for a stored src, or undefined to use the src as
   * written (already a URL the browser can fetch).
   */
  resolve?(src: string): string | undefined;
}

/** The URL scheme a stored asset is referenced by: `![alt](asset:<row id>)`. */
export const ASSET_SCHEME = 'asset:';

/** True when `src` points into the `note_assets` store rather than the web. */
export function isAssetRef(src: string): boolean {
  return src.startsWith(ASSET_SCHEME) && src.length > ASSET_SCHEME.length;
}

/** The row id behind an `asset:` ref, or null for anything else. */
export function assetIdOf(src: string): string | null {
  if (!isAssetRef(src)) return null;
  // Tolerate a query/fragment the editor may have appended (`asset:id#x`).
  const id = src.slice(ASSET_SCHEME.length).split(/[?#]/)[0]!.trim();
  return id.length > 0 ? id : null;
}

/** Per-asset cap, in decoded bytes. */
export const MAX_ASSET_BYTES = 2 * 1024 * 1024;

/** A paste the cap refuses. The message is shown to the user as-is. */
export class AssetTooLarge extends Error {
  readonly bytes: number;
  readonly limit: number;

  constructor(bytes: number, limit = MAX_ASSET_BYTES) {
    super(`${formatMb(bytes)} MB is over the ${formatMb(limit)} MB limit for one image`);
    this.name = 'AssetTooLarge';
    this.bytes = bytes;
    this.limit = limit;
  }
}

function formatMb(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  // Whole numbers stay whole ("2 MB"); anything else gets one decimal so a
  // 2.04 MB paste does not read as "2 MB is over the 2 MB limit".
  return Number.isInteger(mb) ? String(mb) : mb.toFixed(1);
}

/* ── base64 ─────────────────────────────────────────────────────────── */
// Both on the shared encoder in lib/encode/base64.ts (Phase 14 folded the
// hand-rolled `btoa`-in-chunks pair that lived here onto it).

/** The blob's bytes as base64 — no `data:` prefix. */
export async function blobToBase64(blob: Blob): Promise<string> {
  return encodeBytes(new Uint8Array(await blob.arrayBuffer()));
}

/** The inverse: base64 (no prefix) back to a Blob of the given type. */
export function base64ToBlob(b64: string, mime: string): Blob {
  return new Blob([decodeBytes(b64)], { type: mime });
}

/** A `data:` URL for a stored row. */
export function dataUrlOf(row: Pick<NoteAsset, 'mime' | 'data'>): string {
  return `data:${row.mime || 'application/octet-stream'};base64,${row.data}`;
}

/** Total decoded bytes across rows — what Settings shows as the notebook's size. */
export function assetBytesOf(rows: readonly Pick<NoteAsset, 'bytes'>[]): number {
  return rows.reduce((sum, row) => sum + (Number.isFinite(row.bytes) ? row.bytes : 0), 0);
}

/* ── IndexedDB-backed ───────────────────────────────────────────────── */

/** Every live asset of a note. */
export function listAssets(noteId: string): Promise<NoteAsset[]> {
  return byIndex<NoteAsset>('note_assets', 'note_id', noteId);
}

/** Tombstone one asset. The markdown ref, if still present, stops resolving. */
export function removeAsset(id: string): Promise<void> {
  return softDelete('note_assets', id);
}

/** An `AssetStore` that must be primed before `resolve()` answers. */
export interface NoteAssetStore extends AssetStore {
  /** Load every asset of the note into the cache. Safe to call again. */
  prime(): Promise<void>;
  /** Forget an id (after `removeAsset`) so `resolve()` stops answering for it. */
  forget(id: string): void;
}

/**
 * The store for one note, backed by `note_assets` through `db/repo.ts`.
 *
 * `save` rejects with `AssetTooLarge` past the cap; `replace` keeps the id
 * (and so every ref) and swaps the bytes; `load` returns the Blob; `resolve`
 * answers from the primed cache only.
 */
export function noteAssetStore(noteId: string): NoteAssetStore {
  const cache = new Map<string, NoteAsset>();

  const remember = (row: NoteAsset): void => {
    cache.set(row.id, row);
  };

  const rowFor = async (src: string): Promise<NoteAsset | undefined> => {
    const id = assetIdOf(src);
    if (!id) return undefined;
    const cached = cache.get(id);
    if (cached) return cached;
    const row = await get<NoteAsset>('note_assets', id);
    if (row) remember(row);
    return row;
  };

  return {
    async prime() {
      for (const row of await listAssets(noteId)) remember(row);
    },
    forget(id) {
      cache.delete(id);
    },
    async save(blob, filename) {
      if (blob.size > MAX_ASSET_BYTES) throw new AssetTooLarge(blob.size);
      const row = await put<NoteAsset>(
        'note_assets',
        withSyncFields({
          note_id: noteId,
          name: filename || 'image.png',
          mime: blob.type || 'application/octet-stream',
          bytes: blob.size,
          data: await blobToBase64(blob),
        })
      );
      remember(row);
      return ASSET_SCHEME + row.id;
    },
    async replace(src, blob) {
      const row = await rowFor(src);
      if (!row) return;
      if (blob.size > MAX_ASSET_BYTES) throw new AssetTooLarge(blob.size);
      // A whole-row put: the row was read moments ago and an asset has no
      // field another device edits independently.
      const next = await put<NoteAsset>('note_assets', {
        ...row,
        mime: blob.type || row.mime,
        bytes: blob.size,
        data: await blobToBase64(blob),
      });
      remember(next);
    },
    async load(src) {
      const row = await rowFor(src);
      return row ? base64ToBlob(row.data, row.mime) : null;
    },
    resolve(src) {
      const id = assetIdOf(src);
      if (!id) return undefined;
      const row = cache.get(id);
      return row ? dataUrlOf(row) : undefined;
    },
    nameOf(src) {
      const id = assetIdOf(src);
      return id ? cache.get(id)?.name : undefined;
    },
  };
}
