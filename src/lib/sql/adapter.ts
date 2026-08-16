/**
 * The SQLite runtime adapter — wraps `worker.ts` behind the shared
 * `RuntimeAdapter` contract. Its sibling `pglite-adapter.ts` does the same for
 * Postgres; the components take either one unchanged.
 *
 * The components default to this adapter, so the simple case needs no wiring.
 */
import type { BinaryFormat, DatabaseSession, RuntimeAdapter } from './types';
import { SqlClient } from './client';

/** "SQLite format 3\0" — the first 16 bytes of every SQLite database file. */
const SQLITE_MAGIC = 'SQLite format 3\0';

const sqliteFile: BinaryFormat = {
  extension: '.sqlite',
  mimeType: 'application/x-sqlite3',
  label: 'SQLite file (.sqlite)',
  accept: ['.sqlite', '.sqlite3', '.db', 'application/x-sqlite3'],
  looksBinary(bytes) {
    if (bytes.length < SQLITE_MAGIC.length) return false;
    for (let i = 0; i < SQLITE_MAGIC.length; i++) {
      if (bytes[i] !== SQLITE_MAGIC.charCodeAt(i)) return false;
    }
    return true;
  },
};

export const sqliteAdapter: RuntimeAdapter = {
  id: 'sqlite',
  label: 'SQLite',
  kind: 'database',
  dialect: 'SQLite',
  blurb: 'sqlite-wasm — the real SQLite, compiled to WebAssembly.',
  binaryFormat: sqliteFile,
  async editorLanguage() {
    const { sql, SQLite } = await import('@codemirror/lang-sql');
    return sql({ dialect: SQLite });
  },
  async createSession(): Promise<DatabaseSession> {
    // The URL has to be a literal here: Vite rewrites `new Worker(new URL(…,
    // import.meta.url))` at build time and can't follow the path through a
    // variable or another module.
    return new SqlClient(
      new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }),
      'SQLite'
    );
  },
};
