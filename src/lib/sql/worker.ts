/**
 * SQLite WASM Web Worker. Owns a single in-memory database so a slow or
 * looping query never freezes the UI thread.
 *
 * In-memory only (no OPFS): OPFS needs SharedArrayBuffer and therefore
 * COOP/COEP headers, which many static hosts can't set. A fresh in-memory DB
 * keeps deployment host-agnostic.
 *
 * Ported from learn-anywhere / lite-learner, plus `importDb` (load a binary
 * `.sqlite` file via sqlite3_deserialize) so the export round-trip is
 * complete.
 *
 * Protocol: the client posts `{ id, type, ...payload }` and the worker
 * replies `{ id, ok: true, result }` or `{ id, ok: false, error }`.
 */
import sqlite3InitModule, { type Database, type Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import type { Row } from './types';
import type { SqlRequest, SqlResponse, TableData } from './protocol';

let sqlite3: Sqlite3Static | null = null;
let db: Database | null = null;

/** Compiled regexes, keyed by pattern — REGEXP is called once per row. */
const regexCache = new Map<string, RegExp | null>();

/**
 * SQLite ships no REGEXP implementation: the `X REGEXP Y` operator parses,
 * then fails at run time with "no such function: regexp" unless the host
 * registers one. This is that function, so a `matches` filter works on SQLite
 * as it does on Postgres.
 *
 * SQLite calls it with the arguments the other way round — `X REGEXP Y` means
 * `regexp(Y, X)` — and it matches the browser-side engine deliberately:
 * case-insensitive, and a NULL tested as the empty string, because
 * client-side a missing value reads as `''`.
 */
function registerRegexp(database: Database): void {
  database.createFunction(
    'regexp',
    (_ctx: number, pattern: unknown, value: unknown): number => {
      const source = pattern === null || pattern === undefined ? '' : String(pattern);
      let compiled = regexCache.get(source);
      if (compiled === undefined) {
        try {
          compiled = new RegExp(source, 'i');
        } catch {
          compiled = null; // an invalid pattern matches nothing
        }
        if (regexCache.size > 100) regexCache.clear();
        regexCache.set(source, compiled);
      }
      if (!compiled) return 0;
      const text = value === null || value === undefined ? '' : String(value);
      return compiled.test(text) ? 1 : 0;
    },
    { arity: 2, deterministic: true }
  );
}

async function ensureDb(): Promise<Database> {
  if (!sqlite3) {
    // The published typings take no arguments, but the Emscripten loader
    // accepts print/printErr overrides — silence its console chatter.
    const init = sqlite3InitModule as unknown as (config?: {
      print?: (msg: string) => void;
      printErr?: (msg: string) => void;
    }) => Promise<Sqlite3Static>;
    sqlite3 = await init({ print: () => {}, printErr: () => {} });
  }
  if (!db) {
    db = new sqlite3.oo1.DB(':memory:');
    // Per connection, so every path that makes a new DB has to do it too.
    registerRegexp(db);
  }
  return db;
}

/** Discard the current DB and start from a blank in-memory file. */
async function reset(): Promise<void> {
  if (db) {
    db.close();
    db = null;
  }
  await ensureDb();
}

/** Run one or more statements, collecting any result rows produced. */
async function exec(sql: string): Promise<Row[]> {
  const database = await ensureDb();
  const resultRows: Row[] = [];
  database.exec({ sql, rowMode: 'object', callback: (row) => void resultRows.push(row as Row) });
  return resultRows;
}

/**
 * One parameterized statement. `bind` takes the values positionally for `?`
 * placeholders, so nothing is ever spliced into the SQL text.
 */
async function query(sql: string, params: unknown[]): Promise<Row[]> {
  const database = await ensureDb();
  const rows: Row[] = [];
  database.exec({
    sql,
    bind: params as never,
    rowMode: 'object',
    callback: (row) => void rows.push(row as Row),
  });
  return rows;
}

/**
 * Compile every statement in `sql` without executing any of them —
 * sqlite3_prepare_v3 across the whole string, finalizing each statement.
 * Throws (and the error bubbles to the client) on the first invalid one.
 */
async function validate(sql: string): Promise<void> {
  const database = await ensureDb();
  const s = sqlite3!;
  const { capi, wasm } = s;
  const scope = wasm.scopedAllocPush();
  try {
    // Two pointer slots: *ppStmt (out: compiled stmt), *pzTail (out: rest of SQL).
    const [pSql, sqlByteLen] = wasm.scopedAllocCString(sql, true) as unknown as [number, number];
    const [ppStmt, pzTail] = wasm.scopedAllocPtr(2) as unknown as [number, number];
    let pCurrent = pSql;
    const pEnd = pSql + sqlByteLen;
    while (pCurrent < pEnd) {
      const rc = capi.sqlite3_prepare_v3(
        database.pointer!,
        pCurrent,
        pEnd - pCurrent,
        0,
        ppStmt,
        pzTail
      );
      if (rc !== 0) {
        throw new Error(capi.sqlite3_errmsg(database.pointer!));
      }
      const pStmt = wasm.peekPtr(ppStmt);
      pCurrent = wasm.peekPtr(pzTail);
      if (pStmt) capi.sqlite3_finalize(pStmt);
      else break; // only whitespace/comments remained
    }
  } finally {
    wasm.scopedAllocPop(scope);
  }
}

/** SQL literal for a value read back from the DB (INTEGER/REAL/TEXT/BLOB/NULL). */
function quoteValue(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (v instanceof Uint8Array) {
    return "X'" + Array.from(v, (b) => b.toString(16).padStart(2, '0')).join('') + "'";
  }
  return "'" + String(v).replaceAll("'", "''") + "'";
}

/** Double-quote an identifier, escaping embedded quotes. */
const quoteId = (name: string): string => '"' + name.replaceAll('"', '""') + '"';

/**
 * Serialize the whole database to re-runnable SQL — our own `.dump`, since the
 * WASM build has no shell. Emits each table's schema followed by INSERTs, then
 * indexes/triggers/views. Generated columns are skipped in the INSERT column
 * list (you can't write them); virtual tables (FTS5, R*Tree) are dumped by
 * their logical columns and their internal shadow tables are omitted.
 */
async function dump(includeData: boolean): Promise<string> {
  const database = await ensureDb();
  const query = (sql: string): Row[] => {
    const out: Row[] = [];
    database.exec({ sql, rowMode: 'object', callback: (row) => void out.push(row as Row) });
    return out;
  };

  const objects = query(
    "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid;"
  );
  const tables = objects.filter((o) => o.type === 'table');
  const virtualNames = tables
    .filter((t) => /^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(String(t.sql)))
    .map((t) => String(t.name));
  // A virtual table's shadow tables are named "<vtab>_something".
  const isShadow = (name: string) =>
    virtualNames.some((vt) => name !== vt && name.startsWith(vt + '_'));

  const lines: string[] = ['PRAGMA foreign_keys=OFF;', 'BEGIN TRANSACTION;'];

  for (const t of tables) {
    const name = String(t.name);
    if (isShadow(name)) continue;
    lines.push(String(t.sql) + ';');
    if (!includeData) continue;
    // hidden = 0 excludes generated columns (and other non-writable columns).
    const cols = query(
      `SELECT name FROM pragma_table_xinfo(${quoteValue(name)}) WHERE hidden = 0 ORDER BY cid;`
    ).map((c) => String(c.name));
    if (cols.length === 0) continue;
    const colList = cols.map(quoteId).join(', ');
    for (const r of query(`SELECT ${colList} FROM ${quoteId(name)};`)) {
      lines.push(
        `INSERT INTO ${quoteId(name)} (${colList}) VALUES (${cols.map((c) => quoteValue(r[c])).join(', ')});`
      );
    }
  }

  // Indexes, triggers, and views after all table data (so restore doesn't fire
  // triggers or hit half-built views).
  for (const o of objects) {
    if (o.type === 'table' || isShadow(String(o.name))) continue;
    lines.push(String(o.sql) + ';');
  }

  lines.push('COMMIT;');
  return lines.join('\n');
}

/**
 * Serialize the database to a binary SQLite file image (`.db`). Schema only
 * (`includeData` false) replays just the schema into a throwaway DB first, so
 * the exported file has the tables but no rows.
 */
async function serialize(includeData: boolean): Promise<Uint8Array> {
  const database = await ensureDb();
  if (includeData) {
    // Copy out of WASM memory so the transferred bytes outlive the DB.
    return sqlite3!.capi.sqlite3_js_db_export(database.pointer!);
  }
  const schema = await dump(false);
  const temp = new sqlite3!.oo1.DB(':memory:');
  try {
    temp.exec(schema);
    return sqlite3!.capi.sqlite3_js_db_export(temp.pointer!);
  } finally {
    temp.close();
  }
}

/**
 * Replace the current database with a binary SQLite file image via
 * sqlite3_deserialize. The old DB is kept until the new one validates, so a
 * bad file leaves the session usable. FREEONCLOSE hands the copied bytes to
 * SQLite, which frees them when the DB closes.
 */
async function importDb(bytes: Uint8Array): Promise<void> {
  await ensureDb(); // guarantees sqlite3 is initialized
  const s = sqlite3!;
  const old = db;
  const fresh = new s.oo1.DB(':memory:');
  // User functions are per connection — an imported database needs its own.
  registerRegexp(fresh);
  const p = s.wasm.allocFromTypedArray(bytes);
  const caps = s.capi as unknown as Record<string, number>;
  const flags = (caps.SQLITE_DESERIALIZE_FREEONCLOSE ?? 1) | (caps.SQLITE_DESERIALIZE_RESIZEABLE ?? 2);
  const rc = s.capi.sqlite3_deserialize(fresh.pointer!, 'main', p, bytes.length, bytes.length, flags);
  if (rc) {
    // deserialize failed before taking ownership of the buffer under
    // FREEONCLOSE, so free it ourselves; the fresh DB never attached it.
    s.wasm.dealloc(p);
    fresh.close();
    throw new Error('That file is not a valid SQLite database.');
  }
  try {
    // Force SQLite to read the header now, so a non-database file fails here.
    // p is owned by `fresh` now (FREEONCLOSE), so close() frees it — no manual dealloc.
    fresh.exec('SELECT count(*) FROM sqlite_master;');
  } catch {
    fresh.close();
    throw new Error('That file is not a valid SQLite database.');
  }
  old?.close();
  db = fresh;
}

/** Export every base table as JSON. With data: `{ table: [rowObjects] }`. */
async function exportJson(includeData: boolean): Promise<string> {
  const database = await ensureDb();
  const query = (sql: string): Row[] => {
    const out: Row[] = [];
    database.exec({ sql, rowMode: 'object', callback: (row) => void out.push(row as Row) });
    return out;
  };
  const tables = query(
    "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name;"
  );
  const virtualNames = tables
    .filter((t) => /^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(String(t.sql)))
    .map((t) => String(t.name));
  const isShadow = (name: string) =>
    virtualNames.some((vt) => name !== vt && name.startsWith(vt + '_'));

  const result: Record<string, Row[]> = {};
  for (const t of tables) {
    const name = String(t.name);
    if (isShadow(name)) continue;
    result[name] = includeData
      ? query(`SELECT * FROM ${quoteId(name)};`)
      : query(
          `SELECT name, type, "notnull" AS "notnull", pk FROM pragma_table_info(${quoteValue(name)}) ORDER BY cid;`
        );
  }
  const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
  return JSON.stringify(
    result,
    (_key, value) =>
      typeof value === 'bigint'
        ? // Keep exact: precise as a number within 2^53, else a string so
          // large INTEGERs aren't silently rounded.
          value <= MAX_SAFE && value >= -MAX_SAFE
          ? Number(value)
          : value.toString()
        : value instanceof Uint8Array
          ? Array.from(value)
          : value,
    2
  );
}

/** Table names, alphabetical (the DB viewer opens the first one). */
async function listTables(): Promise<string[]> {
  const rows = await exec(
    "SELECT tbl_name FROM sqlite_master WHERE type='table' AND tbl_name NOT LIKE 'sqlite_%' ORDER BY name;"
  );
  return rows.map((r) => String(r['tbl_name']));
}

/** Column metadata + the first 50 rows of one table, for the DB viewer. */
async function tableData(name: string): Promise<TableData> {
  const database = await ensureDb();
  const columns: TableData['columns'] = [];
  // `pk` is the column's 1-based position in the primary key, 0 if it isn't
  // part of one — so it both identifies and orders the key columns.
  const keyed: { name: string; pk: number }[] = [];
  database.exec({
    // Parameter binding doesn't work inside PRAGMA on all builds; quote by
    // doubling embedded quotes instead.
    sql: `PRAGMA table_info("${name.replaceAll('"', '""')}");`,
    rowMode: 'object',
    callback: (row: Row) => {
      columns.push({ name: String(row['name']), type: String(row['type']) });
      const pk = Number(row['pk'] ?? 0);
      if (pk > 0) keyed.push({ name: String(row['name']), pk });
    },
  });
  const keys = keyed.sort((a, b) => a.pk - b.pk).map((c) => c.name);
  const rows: Row[] = [];
  database.exec({
    sql: `SELECT * FROM "${name.replaceAll('"', '""')}" LIMIT 50;`,
    rowMode: 'object',
    callback: (row) => void rows.push(row as Row),
  });
  return { name, columns, rows, keys };
}

self.onmessage = async (event: MessageEvent<SqlRequest>) => {
  const msg = event.data;
  const reply = (response: SqlResponse) => self.postMessage(response);
  try {
    switch (msg.type) {
      case 'reset':
        await reset();
        reply({ id: msg.id, ok: true, result: undefined });
        break;
      case 'exec':
        reply({ id: msg.id, ok: true, result: await exec(msg.sql) });
        break;
      case 'query':
        reply({ id: msg.id, ok: true, result: await query(msg.sql, msg.params) });
        break;
      case 'validate':
        await validate(msg.sql);
        reply({ id: msg.id, ok: true, result: undefined });
        break;
      case 'listTables':
        reply({ id: msg.id, ok: true, result: await listTables() });
        break;
      case 'tableData':
        reply({ id: msg.id, ok: true, result: await tableData(msg.name) });
        break;
      case 'dump':
        reply({ id: msg.id, ok: true, result: await dump(msg.includeData) });
        break;
      case 'serialize':
        reply({ id: msg.id, ok: true, result: await serialize(msg.includeData) });
        break;
      case 'exportJson':
        reply({ id: msg.id, ok: true, result: await exportJson(msg.includeData) });
        break;
      case 'importDb':
        await importDb(msg.bytes);
        reply({ id: msg.id, ok: true, result: undefined });
        break;
    }
  } catch (err) {
    reply({ id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
