/**
 * Promise-based client for a database worker. One client = one worker = one
 * in-memory database. Structurally satisfies `DatabaseSession` (plus extras
 * the playground uses: serialize / exportJson / importDb / checkSolution).
 *
 * Engine-agnostic: it owns the request/response bookkeeping and the
 * dead-worker handling, and knows nothing about SQLite or Postgres. Each
 * adapter constructs the `Worker` — the `new URL('./worker.ts', import.meta.url)`
 * form has to appear in the adapter's own module for Vite to see it — and
 * hands it here.
 */
import type { DatabaseSession, Row, TableData } from './types';
import type { DistributiveOmit, SqlRequest, SqlResponse } from './protocol';

export class SqlClient implements DatabaseSession {
  #worker: Worker;
  #nextId = 1;
  #pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  // Set when the worker dies (load failure / uncaught error). Once dead every
  // pending and future call rejects immediately, so a boot failure surfaces as
  // an error instead of hanging the UI forever.
  #dead: Error | null = null;

  /**
   * @param worker A module worker speaking the protocol in `protocol.ts`.
   * @param engineLabel Names the engine in worker-failure messages.
   */
  constructor(worker: Worker, engineLabel = 'database') {
    this.#worker = worker;
    this.#worker.onmessage = (event: MessageEvent<SqlResponse>) => {
      const msg = event.data;
      const pending = this.#pending.get(msg.id);
      if (!pending) return;
      this.#pending.delete(msg.id);
      if (msg.ok) pending.resolve(msg.result);
      else pending.reject(new Error(msg.error));
    };
    this.#worker.onerror = (event) => {
      this.#fail(new Error(event.message || `The ${engineLabel} engine failed to load.`));
    };
    this.#worker.onmessageerror = () => {
      this.#fail(new Error(`The ${engineLabel} engine sent a message that could not be read.`));
    };
  }

  #fail(error: Error): void {
    this.#dead = error;
    for (const { reject } of this.#pending.values()) reject(error);
    this.#pending.clear();
  }

  #send<T>(request: DistributiveOmit<SqlRequest, 'id'>): Promise<T> {
    if (this.#dead) return Promise.reject(this.#dead);
    const id = this.#nextId++;
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.#worker.postMessage({ ...request, id });
    });
  }

  /** Discard the in-memory DB and start blank. */
  reset(): Promise<void> {
    return this.#send({ type: 'reset' });
  }

  /** Run one or more statements; returns any result rows produced. */
  exec(sql: string): Promise<Row[]> {
    return this.#send({ type: 'exec', sql });
  }

  /** Run one parameterized statement and return its rows. */
  query(sql: string, params: unknown[] = []): Promise<Row[]> {
    return this.#send({ type: 'query', sql, params });
  }

  /** Compile (but don't run) every statement; rejects with the engine error. */
  validate(sql: string): Promise<void> {
    return this.#send({ type: 'validate', sql });
  }

  listTables(): Promise<string[]> {
    return this.#send({ type: 'listTables' });
  }

  tableData(name: string): Promise<TableData> {
    return this.#send({ type: 'tableData', name });
  }

  /** Re-runnable SQL (schema, plus INSERTs when `includeData`). */
  dump(includeData = true): Promise<string> {
    return this.#send({ type: 'dump', includeData });
  }

  /** Binary database file image; schema-only when `includeData` is false. */
  serialize(includeData = true): Promise<Uint8Array> {
    return this.#send({ type: 'serialize', includeData });
  }

  /**
   * Per-table JSON. With data: `{ table: rows[] }`. Schema only:
   * `{ table: columnInfo[] }`.
   */
  exportJson(includeData = true): Promise<string> {
    return this.#send({ type: 'exportJson', includeData });
  }

  /** Replace the database from a binary file image. */
  importDb(bytes: Uint8Array): Promise<void> {
    return this.#send({ type: 'importDb', bytes });
  }

  /** Terminate the worker (kills any runaway query). */
  destroy(): void {
    this.#worker.terminate();
    const error = new Error('Database worker terminated');
    for (const { reject } of this.#pending.values()) reject(error);
    this.#pending.clear();
  }
}
