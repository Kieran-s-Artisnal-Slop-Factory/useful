/**
 * The change queue: which rows this device has changed.
 *
 * This app is offline-only, so nothing drains the queue today — it exists so
 * that adding a sync backend later is a drop-in change rather than a data
 * migration, and so backup/restore can tell "changed since" without resorting
 * to a timestamp watermark (which silently drops writes that race the scan).
 */
import { getDB } from './db';
import { STORES } from './types';
import type { SyncFields } from './types';

export const OUTBOX_STORE = 'sync_outbox';

export interface OutboxEntry {
  key: string; // "<store>:<id>"
  store: string;
  id: string;
  /** The row's updated_at when it was queued — the version this entry covers. */
  updated_at: string;
  queued_at: string;
  /** Set when the server refused this exact version (see markRejected). */
  error?: string;
  error_at?: string;
}

export const outboxKey = (store: string, id: string): string => store + ':' + id;

function entryFor(store: string, id: string, updatedAt: string): OutboxEntry {
  return {
    key: outboxKey(store, id),
    store,
    id,
    updated_at: updatedAt,
    queued_at: new Date().toISOString(),
  };
}

/**
 * Queue a locally-changed row inside the SAME transaction that writes it, so
 * the row and the "remember to send this" note commit together. A queue write
 * that could fail on its own would let a row change with nothing recording it.
 *
 * Synchronous on purpose: awaiting a non-IndexedDB promise mid-transaction lets
 * the browser auto-commit it out from under the caller.
 */
export function enqueueIn(
  tx: { objectStore(name: string): { put(value: unknown): unknown } },
  store: string,
  id: string,
  updatedAt: string
): void {
  tx.objectStore(OUTBOX_STORE).put(entryFor(store, id, updatedAt));
}

/**
 * Queue a locally-changed row on its own. Called by EVERY write in repo.ts —
 * if you add a write path that bypasses repo.ts, queue it here yourself or the
 * change will never leave this device.
 */
export async function enqueue(store: string, id: string, updatedAt: string): Promise<void> {
  await (await getDB()).put(OUTBOX_STORE, entryFor(store, id, updatedAt));
}

/** Every queued entry, oldest first. */
export async function drainOutbox(): Promise<OutboxEntry[]> {
  const rows = (await (await getDB()).getAll(OUTBOX_STORE)) as OutboxEntry[];
  return rows.sort((a, b) => (a.queued_at < b.queued_at ? -1 : a.queued_at > b.queued_at ? 1 : 0));
}

export async function clearOutbox(): Promise<void> {
  await (await getDB()).clear(OUTBOX_STORE);
}
