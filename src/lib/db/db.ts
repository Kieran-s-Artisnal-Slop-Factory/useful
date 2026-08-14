/**
 * IndexedDB connection + versioned migrations.
 *
 * MIGRATIONS is an ordered list of upgrade functions, one per version, run in
 * sequence from the client's current version. Never edit an existing
 * migration once shipped — append a new one.
 *
 * CONVENTION for every store-creating migration: name stores with string
 * LITERALS and guard with `db.objectStoreNames.contains(...)`. A migration
 * that iterates the live STORES map changes behaviour every time the map
 * grows — a fresh install would create tomorrow's stores in v1 and then crash
 * when the later migration creates them again. Migrations must describe what
 * the schema looked like AT THAT VERSION, forever.
 */
import { openDB, type IDBPDatabase, type IDBPTransaction } from 'idb';

export const DB_NAME = 'useful';

type Migration = (
  db: IDBPDatabase,
  tx: IDBPTransaction<unknown, string[], 'versionchange'>
) => void;

const MIGRATIONS: Migration[] = [
  // v1 — the schema as generated: one placeholder store. (Frozen to literals;
  // this used to iterate STORES, which breaks fresh installs the moment a
  // later migration adds a store — see the convention note above.)
  (db) => {
    if (!db.objectStoreNames.contains('preferences')) {
      db.createObjectStore('preferences', { keyPath: 'id' });
    }
  },
  // v2 — local-only change queue. NOT in STORES (never exported/synced). This
  // app has no server today; the queue exists so adding one later is a drop-in
  // change instead of a data migration.
  (db) => {
    if (!db.objectStoreNames.contains('sync_outbox')) {
      db.createObjectStore('sync_outbox', { keyPath: 'key' });
    }
  },
];

export const DB_VERSION = MIGRATIONS.length;

let dbPromise: Promise<IDBPDatabase> | null = null;

export function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, tx) {
        for (let v = oldVersion; v < MIGRATIONS.length; v++) {
          MIGRATIONS[v]!(db, tx);
        }
      },
    });
  }
  return dbPromise;
}
