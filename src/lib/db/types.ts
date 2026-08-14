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
 * THE single settings-style row: per-tool defaults and remembered values
 * (timer completion defaults, last-used timezone pair, …) land here as fields
 * when their tools ship. Read/write ONLY via repo's getSingleton/putSingleton.
 */
export interface Preferences extends SyncFields {
  // (only sync fields — tool phases add concrete fields here)
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
  // converges on the same row if sync ever lands. fieldMerge: per-field stamps
  // are recorded so that, once a per-field merge path ships (plan-phases.md
  // Phase 1), two devices changing DIFFERENT preference fields both keep
  // their edit.
  preferences: { indexes: [], singleton: true, fieldMerge: true },
};

export type StoreName = keyof typeof STORES;

/** Stores whose rows carry per-field timestamps (see SyncFields.field_updated_at). */
export const FIELD_MERGED_STORES: string[] = Object.entries(STORES)
  .filter(([, def]) => def.fieldMerge)
  .map(([name]) => name);
