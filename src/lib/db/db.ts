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
) => void | Promise<void>;

/** Sync bookkeeping — the only fields a tombstone is allowed to keep. */
const TOMBSTONE_KEEP = ['id', 'updated_at', 'deleted_at', 'server_seq', 'field_updated_at'];

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
  // v3 — Phase 1 (Time): countdown timers + the stopwatch singleton.
  (db) => {
    if (!db.objectStoreNames.contains('timers')) {
      db.createObjectStore('timers', { keyPath: 'id' });
    }
    if (!db.objectStoreNames.contains('stopwatch')) {
      db.createObjectStore('stopwatch', { keyPath: 'id' });
    }
  },
  // v4 — Phase 2 (Scheduler): events, todos, todo comments.
  (db) => {
    if (!db.objectStoreNames.contains('events')) {
      const events = db.createObjectStore('events', { keyPath: 'id' });
      events.createIndex('start', 'start', { multiEntry: false });
    }
    if (!db.objectStoreNames.contains('todos')) {
      const todos = db.createObjectStore('todos', { keyPath: 'id' });
      todos.createIndex('status', 'status', { multiEntry: false });
      todos.createIndex('due_date', 'due_date', { multiEntry: false });
    }
    if (!db.objectStoreNames.contains('todo_comments')) {
      const comments = db.createObjectStore('todo_comments', { keyPath: 'id' });
      comments.createIndex('todo_id', 'todo_id', { multiEntry: false });
    }
  },
  // v5 — Phase 6 (SVG editor): named layer-based SVG documents.
  (db) => {
    if (!db.objectStoreNames.contains('svg_documents')) {
      db.createObjectStore('svg_documents', { keyPath: 'id' });
    }
  },
  // v6 — no schema change: a data sweep. Deletes used to tombstone a row in
  // place, keeping every field, so a deleted timer's label and notes stayed in
  // IndexedDB and turned up in every exported backup. repo.ts now clears the
  // payload on delete; this strips the ones already lying around. Clocks
  // (updated_at / deleted_at / stamps) are left EXACTLY as they were — a
  // cleanup pass that restamps rows would beat real edits from another device
  // and is precisely the kind of write repo.ts's rule 4 forbids.
  async (db, tx) => {
    const stores = [
      'preferences',
      'timers',
      'stopwatch',
      'events',
      'todos',
      'todo_comments',
      'svg_documents',
    ].filter((name) => db.objectStoreNames.contains(name));
    for (const name of stores) {
      const store = tx.objectStore(name);
      let cursor = await store.openCursor();
      while (cursor) {
        const row = cursor.value as Record<string, unknown>;
        if (row?.deleted_at) {
          const cleared: Record<string, unknown> = {};
          for (const key of TOMBSTONE_KEEP) {
            if (key in row) cleared[key] = row[key];
          }
          if (Object.keys(cleared).length !== Object.keys(row).length) {
            await cursor.update(cleared);
          }
        }
        cursor = await cursor.continue();
      }
    }
  },
  // v7 — Playgrounds: one SQL-playground workspace per engine (editor buffer
  // plus an optional SQL snapshot). Keyed by the engine id.
  (db) => {
    if (!db.objectStoreNames.contains('sql_playgrounds')) {
      db.createObjectStore('sql_playgrounds', { keyPath: 'id' });
    }
  },
  // v8 — Recurring events: `events` gains recurrence/exdates/series_id/
  // original_start (defaulted at READ time, never backfilled — a backfill on
  // load would be a write on load) plus an index on series_id so a series can
  // find its detached overrides.
  (db, tx) => {
    if (db.objectStoreNames.contains('events')) {
      const events = tx.objectStore('events');
      if (!events.indexNames.contains('series_id')) {
        events.createIndex('series_id', 'series_id', { multiEntry: false });
      }
    }
  },
  // v9 — Phase 5 (Sprite editor): named pixel-grid documents. Text only, so
  // they ride backups like the SVG editor's.
  (db) => {
    if (!db.objectStoreNames.contains('sprites')) {
      db.createObjectStore('sprites', { keyPath: 'id' });
    }
  },
  // v10 — Phase 8 (Napkin math): formula templates and the calculations run
  // against them. Both are JSON-native, so they ride backups unchanged.
  (db) => {
    if (!db.objectStoreNames.contains('napkin_templates')) {
      db.createObjectStore('napkin_templates', { keyPath: 'id' });
    }
    if (!db.objectStoreNames.contains('napkin_calculations')) {
      const store = db.createObjectStore('napkin_calculations', { keyPath: 'id' });
      // A calculation is only ever read through its template.
      store.createIndex('template_id', 'template_id');
    }
  },

  // v11 — Phase 9 (Config playground): named schemas with their Field/Type
  // tables and parse-mode source text. JSON-native, so rows ride backups
  // unchanged.
  (db) => {
    if (!db.objectStoreNames.contains('config_schemas')) {
      db.createObjectStore('config_schemas', { keyPath: 'id' });
    }
  },

  // v12 — Phase 10 (Notebook): notes as one self-referencing tree, and their
  // images as a child store so listing notes never carries image bytes.
  (db) => {
    if (!db.objectStoreNames.contains('notes')) {
      const store = db.createObjectStore('notes', { keyPath: 'id' });
      store.createIndex('parent_id', 'parent_id');
      // multiEntry: one index entry per tag, so a tag lookup is a seek.
      store.createIndex('tags', 'tags', { multiEntry: true });
    }
    if (!db.objectStoreNames.contains('note_assets')) {
      const store = db.createObjectStore('note_assets', { keyPath: 'id' });
      store.createIndex('note_id', 'note_id');
    }
  },

  // v13 — 0.3.0 Phase 12 (Docker Compose): named projects, the whole model in
  // one JSON column. No indexes: the library is listed whole and searched in
  // memory, the same as the other document stores.
  (db) => {
    if (!db.objectStoreNames.contains('compose_projects')) {
      db.createObjectStore('compose_projects', { keyPath: 'id' });
    }
  },
  // v14: web_playgrounds — the web playground's saved sessions. Three text
  // buffers, a name and a language: no indexes, because the library lists
  // every row and there is nothing else to look one up by.
  (db) => {
    if (!db.objectStoreNames.contains('web_playgrounds')) {
      db.createObjectStore('web_playgrounds', { keyPath: 'id' });
    }
  },
  // v15 — 0.4.0 Phase 4 (HTTP playground): environments, saved requests, and
  // secrets. Three stores in one migration because they are one feature, but
  // NOT three stores of the same kind:
  //
  //   http_environments, http_requests  — ordinary, exported, in STORES
  //   http_secrets                      — LOCAL-ONLY, deliberately not in
  //                                       STORES, so it is in no backup
  //
  // The split is the feature. An API key that reached a backup file would sit
  // in a downloads folder forever, and the only structural way to promise it
  // never does is to keep it out of the set the exporter walks. sync_outbox
  // set the precedent in v2; this is the first time it protects a user.
  (db) => {
    if (!db.objectStoreNames.contains('http_environments')) {
      db.createObjectStore('http_environments', { keyPath: 'id' });
    }
    if (!db.objectStoreNames.contains('http_requests')) {
      const store = db.createObjectStore('http_requests', { keyPath: 'id' });
      store.createIndex('environment_id', 'environment_id');
    }
    if (!db.objectStoreNames.contains('http_secrets')) {
      const store = db.createObjectStore('http_secrets', { keyPath: 'id' });
      store.createIndex('environment_id', 'environment_id');
    }
  },
  // v16 — 0.4.0 Phase 5 (HTTP playground): multi-step flows. Steps, their
  // extraction rules and the LAST run's records, all in JSON columns on one
  // row. No indexes: the library lists every flow and there is nothing else
  // to look one up by.
  //
  // A recorded run is safe to back up by construction rather than by care:
  // the request on each record is masked when the record is BUILT, so the
  // secret was never in the row to begin with. Response bodies are capped at
  // 256 KB on the way in for the same class of reason — a recorded download
  // would otherwise take the backup file with it.
  (db) => {
    if (!db.objectStoreNames.contains('http_flows')) {
      db.createObjectStore('http_flows', { keyPath: 'id' });
    }
  },
];

export const DB_VERSION = MIGRATIONS.length;

let dbPromise: Promise<IDBPDatabase> | null = null;

export function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      // Async migrations are allowed to await requests made on THIS
      // transaction (idb keeps it alive across those microtasks); awaiting
      // anything else would let the version-change transaction finish early.
      async upgrade(db, oldVersion, _newVersion, tx) {
        for (let v = oldVersion; v < MIGRATIONS.length; v++) {
          await MIGRATIONS[v]!(db, tx);
        }
      },
    });
  }
  return dbPromise;
}

/**
 * Drop this tab's connection so the database can be deleted or reopened at a
 * different version. Only the test harness needs it: an open connection makes
 * `indexedDB.deleteDatabase` block forever, which is exactly what a migration
 * test has to do to rebuild an older database.
 */
export async function closeDB(): Promise<void> {
  if (!dbPromise) return;
  const db = await dbPromise;
  dbPromise = null;
  db.close();
}
