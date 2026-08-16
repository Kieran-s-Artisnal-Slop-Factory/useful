/**
 * The Postgres runtime adapter — PGlite behind the same `RuntimeAdapter`
 * contract as `adapter.ts`'s SQLite. Nothing about the components changes to
 * use it: pass it as the `adapter` prop, or list it in `engines`.
 *
 * PGlite is a real Postgres compiled to WebAssembly, so the dialect is the
 * real one — window functions, CTEs, `jsonb`, `generate_series`, arrays.
 */
import type { BinaryFormat, DatabaseSession, RuntimeAdapter } from './types';
import { SqlClient } from './client';

/** gzip's magic number: every PGlite `dumpDataDir('gzip')` starts with it. */
const GZIP_MAGIC = [0x1f, 0x8b];
/** "ustar" at offset 257 — an uncompressed tar, which PGlite also accepts. */
const TAR_MAGIC_OFFSET = 257;
const TAR_MAGIC = 'ustar';

const pgliteFile: BinaryFormat = {
  extension: '.tar.gz',
  mimeType: 'application/gzip',
  label: 'PGlite data directory (.tar.gz)',
  accept: ['.tar.gz', '.tgz', '.tar', 'application/gzip', 'application/x-tar'],
  looksBinary(bytes) {
    if (bytes.length >= GZIP_MAGIC.length && GZIP_MAGIC.every((b, i) => bytes[i] === b)) return true;
    if (bytes.length < TAR_MAGIC_OFFSET + TAR_MAGIC.length) return false;
    return TAR_MAGIC.split('').every(
      (ch, i) => bytes[TAR_MAGIC_OFFSET + i] === ch.charCodeAt(0)
    );
  },
};

export const pgliteAdapter: RuntimeAdapter = {
  id: 'pglite',
  label: 'Postgres',
  kind: 'database',
  dialect: 'PostgreSQL',
  blurb: 'PGlite — a real Postgres server, compiled to WebAssembly.',
  binaryFormat: pgliteFile,
  async editorLanguage() {
    const { sql, PostgreSQL } = await import('@codemirror/lang-sql');
    return sql({ dialect: PostgreSQL });
  },
  async createSession(): Promise<DatabaseSession> {
    // The URL has to be a literal here: Vite rewrites `new Worker(new URL(…,
    // import.meta.url))` at build time and can't follow the path through a
    // variable or another module.
    return new SqlClient(
      new Worker(new URL('./pglite-worker.ts', import.meta.url), { type: 'module' }),
      'Postgres'
    );
  },
};
