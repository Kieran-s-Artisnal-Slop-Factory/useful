/**
 * Where the SQL playground keeps its workspace between visits.
 *
 * retoken's component takes an injectable `PlaygroundStore`; its default keeps
 * everything in localStorage. This app has one source of truth — IndexedDB
 * through repo.ts — so the port supplies a store backed by that instead. The
 * payoff is real: a workspace rides the backup export/import like every other
 * row, and the data-integrity suite audits its writes.
 *
 * One row per engine, keyed by the ENGINE ID, because a Postgres snapshot can
 * never be replayed into SQLite. The live database itself is not in here: it
 * lives in the worker's memory, and this is the SQL text needed to rebuild it.
 */
import { get, patch, put, withSyncFields } from '../db/repo';
import type { SqlPlayground } from '../db/types';

export interface PlaygroundState {
  buffer: string;
  snapshot: string | null;
}

export interface PlaygroundStore {
  /** Load the saved state for an engine id, or null if none. */
  load(id: string): Promise<PlaygroundState | null>;
  /** Autosave the editor buffer. */
  saveBuffer(id: string, buffer: string): Promise<void>;
  /** Persist (or clear, with null) the saved snapshot. */
  saveSnapshot(id: string, snapshot: string | null): Promise<void>;
}

const STORE = 'sql_playgrounds';

/** Create the workspace row on first write — never on read (pages must not
 * write just by being opened; the oracle checks exactly that). */
async function upsert(id: string, fields: Partial<SqlPlayground>): Promise<void> {
  const existing = await get<SqlPlayground>(STORE, id);
  if (existing) {
    await patch<SqlPlayground>(STORE, id, fields);
    return;
  }
  await put<SqlPlayground>(STORE, {
    ...withSyncFields({
      engine: id,
      buffer: '',
      snapshot: null,
      snapshot_at: null,
      ...fields,
    }),
    id,
  } as SqlPlayground);
}

export function indexedDbPlayground(): PlaygroundStore {
  return {
    async load(id) {
      const row = await get<SqlPlayground>(STORE, id);
      if (!row) return null;
      return { buffer: row.buffer ?? '', snapshot: row.snapshot ?? null };
    },
    async saveBuffer(id, buffer) {
      await upsert(id, { buffer });
    },
    async saveSnapshot(id, snapshot) {
      await upsert(id, { snapshot, snapshot_at: snapshot ? new Date().toISOString() : null });
    },
  };
}
