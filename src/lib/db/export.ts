/**
 * JSON backup export/import. Exports are a full copy of every store,
 * tombstoned rows included — restoring one reproduces the exact local state.
 *
 * Envelope format: { schemaVersion, exportedAt, data: { storeName: rows[] } }
 *
 * Two import modes:
 *   'replace' — full restore. Clears each store the FILE covers, then loads it.
 *               Stores absent from the file are left alone, so restoring an
 *               older backup cannot silently wipe data added by a later
 *               version of the app.
 *   'merge'   — fold the file into what is already here under last-write-wins.
 *               An imported row only overwrites a local one when it is newer,
 *               and it never resurrects a row deleted more recently. A blind
 *               put-by-id here regresses live data to the backup's copy.
 *
 * Either way every row is validated BEFORE anything is written: a truncated or
 * hand-edited file fails cleanly instead of half-applying, and a malformed row
 * never reaches the store (where it would be pushed to the server on every
 * sync and rejected forever).
 */
import { getDB, DB_VERSION } from './db';
import { FIELD_MERGED_STORES, STORES } from './types';
import type { SyncFields } from './types';
import { domainKeys } from './repo';
import { clearOutbox, enqueue } from './outbox';

export interface ExportEnvelope {
  schemaVersion: number;
  exportedAt: string;
  data: Record<string, unknown[]>;
}

export type ImportMode = 'replace' | 'merge';

/**
 * Drift guard. The backup covers Object.keys(STORES), so adding a store to the
 * schema automatically adds it to the backup — this assertion exists to fail
 * loudly if that ever stops being true (a hand-maintained list silently
 * dropping a store is how backups quietly stop covering half the app).
 */
const BACKED_UP_STORES = Object.keys(STORES);
if (BACKED_UP_STORES.length === 0) {
  throw new Error('Backup covers no stores — db/types.ts STORES is empty?');
}

export async function exportData(): Promise<ExportEnvelope> {
  const db = await getDB();
  // One transaction over every store: a backup taken with a read per store can
  // capture a parent from before a change and its children from after it.
  const tx = db.transaction(BACKED_UP_STORES, 'readonly');
  const data: Record<string, unknown[]> = {};
  for (const name of BACKED_UP_STORES) {
    data[name] = await tx.objectStore(name).getAll();
  }
  await tx.done;
  return {
    schemaVersion: DB_VERSION,
    exportedAt: new Date().toISOString(),
    data,
  };
}

/** Trigger a browser download of the backup file. */
export async function downloadExport(): Promise<void> {
  const envelope = await exportData();
  const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `useful-backup-${envelope.exportedAt.slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export interface ImportResult {
  rows: number;
  /** Rows skipped in 'merge' mode because the local copy was newer. */
  skipped: number;
  stores: string[];
}

/**
 * Reject anything that is not a storable row. Runs over the WHOLE file before
 * the first write, so a bad file leaves the database untouched.
 */
function validate(envelope: ExportEnvelope, names: string[]): void {
  for (const name of names) {
    const rows = envelope.data[name];
    if (!Array.isArray(rows)) throw new Error(`Store "${name}" is not an array of rows`);
    rows.forEach((row, i) => {
      const where = `${name}[${i}]`;
      if (typeof row !== 'object' || row === null || Array.isArray(row)) {
        throw new Error(`${where} is not an object`);
      }
      const r = row as Partial<SyncFields>;
      if (typeof r.id !== 'string' || r.id === '') throw new Error(`${where} has no id`);
      if (typeof r.updated_at !== 'string' || r.updated_at === '') {
        throw new Error(`${where} has no updated_at`);
      }
      if (r.deleted_at != null && typeof r.deleted_at !== 'string') {
        throw new Error(`${where} has a non-string deleted_at`);
      }
      if (r.server_seq != null && typeof r.server_seq !== 'number') {
        throw new Error(`${where} has a non-numeric server_seq`);
      }
    });
  }
}

/**
 * Fold an imported row into the local one FIELD BY FIELD on a field-merged
 * store: for each domain field, the copy with the newer per-field stamp wins
 * (ties keep local); stamp maps are unioned to the max per key. This is what
 * the field_updated_at stamps exist for — whole-row LWW on a merged store
 * would let a backup from device A silently revert the one field device B
 * changed.
 *
 * Fields with no stamp fall back to their row's updated_at, so rows written
 * before field stamps existed still merge sanely.
 *
 * Returns null when nothing changed (the import is skipped for this row).
 */
function foldFieldMerged(local: SyncFields, incoming: SyncFields): SyncFields | null {
  const localRec = local as unknown as Record<string, unknown>;
  const incomingRec = incoming as unknown as Record<string, unknown>;
  const localStamps = local.field_updated_at ?? {};
  const incomingStamps = incoming.field_updated_at ?? {};
  const stampOf = (stamps: Record<string, string>, row: SyncFields, field: string): string =>
    stamps[field] ?? row.updated_at;

  const merged: Record<string, unknown> = { ...localRec };
  const stamps: Record<string, string> = { ...localStamps };
  let changed = false;
  for (const field of new Set([...domainKeys(localRec), ...domainKeys(incomingRec)])) {
    if (!(field in incomingRec)) continue; // local-only field stays
    const incomingAt = stampOf(incomingStamps, incoming, field);
    const localAt = field in localRec ? stampOf(localStamps, local, field) : '';
    if (incomingAt > localAt) {
      merged[field] = incomingRec[field];
      stamps[field] = incomingAt;
      changed = true;
    }
  }
  if (!changed) return null;
  merged.field_updated_at = stamps;
  // The row-level clock advances to the newer of the two so a later
  // whole-row comparison can't regress the fold.
  merged.updated_at = incoming.updated_at > local.updated_at ? incoming.updated_at : local.updated_at;
  return merged as unknown as SyncFields;
}

/** Load a backup. Defaults to a full restore; pass 'merge' to fold it in. */
export async function importData(
  envelope: ExportEnvelope,
  mode: ImportMode = 'replace'
): Promise<ImportResult> {
  if (
    typeof envelope !== 'object' ||
    envelope === null ||
    typeof envelope.schemaVersion !== 'number' ||
    typeof envelope.data !== 'object' ||
    envelope.data === null
  ) {
    throw new Error('Not a valid useful backup file');
  }
  if (envelope.schemaVersion > DB_VERSION) {
    throw new Error(
      `Backup is from a newer app version (schema v${envelope.schemaVersion}, app has v${DB_VERSION})`
    );
  }

  // Only touch stores that exist in this app AND appear in the file.
  const known = new Set(BACKED_UP_STORES);
  const names = Object.keys(envelope.data).filter((n) => known.has(n));
  validate(envelope, names);
  if (names.length === 0) return { rows: 0, skipped: 0, stores: [] };

  const db = await getDB();
  const tx = db.transaction(names, 'readwrite');
  const changed = new Map<string, string[]>();
  let rows = 0;
  let skipped = 0;

  for (const name of names) {
    const store = tx.objectStore(name);
    const incoming = (envelope.data[name] ?? []) as SyncFields[];
    if (mode === 'replace') {
      store.clear();
      for (const row of incoming) {
        store.put(row);
        rows++;
      }
      continue;
    }
    const fieldMerged = FIELD_MERGED_STORES.includes(name);
    const ids: string[] = [];
    for (const row of incoming) {
      const local = (await store.get(row.id)) as SyncFields | undefined;
      // Field-merged stores fold per field when both copies are alive — the
      // row-level clock alone must not decide, or the backup's whole row
      // clobbers the one field this device changed. Tombstones keep the
      // whole-row rules below (a fold must never resurrect a deletion).
      if (local && fieldMerged && !local.deleted_at && !row.deleted_at) {
        const folded = foldFieldMerged(local, row);
        if (!folded) {
          skipped++;
          continue;
        }
        store.put({ ...folded, server_seq: null });
        ids.push(row.id);
        rows++;
        continue;
      }
      // Strictly newer only. On a tie the local row stays, which also means an
      // imported row can never un-delete something deleted at the same instant.
      if (local && row.updated_at <= local.updated_at) {
        skipped++;
        continue;
      }
      // The backup's server_seq belongs to whatever server that device talked
      // to; keeping it would mark the row as already-synced and it would never
      // be pushed from here.
      store.put({ ...row, server_seq: null });
      ids.push(row.id);
      rows++;
    }
    changed.set(name, ids);
  }
  await tx.done;

  if (mode === 'replace') {
    await clearOutbox(); // the queue described the data we just replaced
  } else {
    for (const [name, ids] of changed) {
      for (const id of ids) {
        const row = (await db.get(name, id)) as SyncFields | undefined;
        if (row) await enqueue(name, id, row.updated_at);
      }
    }
  }
  return { rows, skipped, stores: names };
}

/**
 * Wipe every store, sync bookkeeping included. Developer-mode escape hatch —
 * the caller is responsible for confirming with the user first.
 */
export async function clearAllData(): Promise<void> {
  const db = await getDB();
  const names = [...Object.keys(STORES), 'sync_outbox'];
  const tx = db.transaction(names, 'readwrite');
  for (const name of names) {
    tx.objectStore(name).clear();
  }
  await tx.done;
}
