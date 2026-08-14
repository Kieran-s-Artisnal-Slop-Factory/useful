/**
 * Entity types + object-store map. GENERATED from your schema.
 */

/**
 * Bookkeeping fields on every entity. This app is offline-only, but the
 * fields keep soft deletes working and leave the door open to adding a sync
 * backend later without a data migration.
 */
export interface SyncFields {
  id: string; // UUID v4, client-generated
  updated_at: string; // UTC ISO 8601; LWW conflict-resolution field
  deleted_at: string | null; // soft-delete tombstone (null = alive)
  server_seq: number | null; // server sync cursor (null = never synced)
  /**
   * Per-field last-write-wins timestamps (column -> UTC ISO 8601). Present
   * only on stores flagged `fieldMerge` below; written by repo.patch/put.
   * NOTE: the stamps are only WRITTEN today — no merge path consumes them yet.
   * Backup merge-import (export.ts) is still whole-row LWW; per-field folding
   * lands with the first phase that puts real fields on a fieldMerge store
   * (see plan-phases.md Phase 1). Until then this is groundwork, not a
   * guarantee.
   */
  field_updated_at?: Record<string, string>;
}

/**
 * THE single settings-style row: per-tool defaults and remembered values.
 * Read/write ONLY via repo's getSingleton/putSingleton. All fields optional —
 * the row grows as tools are used. Keep tests/local/helpers/schema.ts in
 * lockstep when adding fields.
 */
export interface Preferences extends SyncFields {
  /** Completion-action defaults auto-filled into new timers. */
  timer_default_sound?: boolean;
  timer_default_vibrate?: boolean;
  timer_default_notify?: boolean;
  timer_default_delete_on_complete?: boolean;
  /** Last-used timezone pair on the converter. */
  tz_last_from?: string;
  tz_last_to?: string;
}

/** A countdown timer. While running, `end_at` is the absolute deadline —
 * display recomputes from the wall clock, so there are NO per-tick writes and
 * reload/navigation can't drift it. Finished timers stay as re-runnable
 * presets until deleted. */
export interface Timer extends SyncFields {
  label: string;
  /** Markdown, rendered through src/lib/markdown.ts (sanitized). */
  description_md: string;
  duration_ms: number;
  /** UTC ISO deadline; non-null only while state === 'running'. */
  end_at: string | null;
  /** Remaining budget while paused; non-null only while state === 'paused'. */
  paused_remaining_ms: number | null;
  state: 'idle' | 'running' | 'paused' | 'done';
  sound: boolean;
  vibrate: boolean;
  notify: boolean;
  /** One-shot: the timer soft-deletes itself after it completes. */
  delete_on_complete: boolean;
}

/** The one stopwatch (singleton row). Elapsed = elapsed_before_pause_ms plus
 * (now - started_at) while running; writes happen only on user actions. */
export interface Stopwatch extends SyncFields {
  /** UTC ISO start of the current running span; null unless running. */
  started_at: string | null;
  elapsed_before_pause_ms: number;
  /** Total-elapsed milliseconds captured at each lap press, oldest first. */
  laps: number[];
  state: 'idle' | 'running' | 'paused';
}

export interface StoreIndex {
  name: string;
  multiEntry?: boolean;
}

export interface StoreDef {
  indexes: StoreIndex[];
  /** Reconciled per field rather than whole-row last-write-wins. */
  fieldMerge?: boolean;
  /** Single-row table: read/write it with repo's getSingleton/putSingleton. */
  singleton?: boolean;
}

export const STORES: Record<string, StoreDef> = {
  // singleton: one logical row under repo.SINGLETON_ID, so every device
  // converges on the same row if sync ever lands. fieldMerge: two devices
  // changing DIFFERENT preference fields both keep their edit (folded
  // per-field on backup merge-import — see export.ts).
  preferences: { indexes: [], singleton: true, fieldMerge: true },
  timers: { indexes: [] },
  stopwatch: { indexes: [], singleton: true },
};

export type StoreName = keyof typeof STORES;

/** Stores whose rows carry per-field timestamps (see SyncFields.field_updated_at). */
export const FIELD_MERGED_STORES: string[] = Object.entries(STORES)
  .filter(([, def]) => def.fieldMerge)
  .map(([name]) => name);
