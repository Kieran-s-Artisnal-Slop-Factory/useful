/**
 * PGlite Web Worker — the Postgres counterpart to `worker.ts`. Owns a single
 * in-memory database so a slow or looping query never freezes the UI thread.
 *
 * All the work is in `pglite-engine.ts`; this is only the protocol shim, which
 * is what lets the engine be tested in Node.
 *
 * Protocol: the client posts `{ id, type, ...payload }` and the worker
 * replies `{ id, ok: true, result }` or `{ id, ok: false, error }`.
 */
import { PgliteEngine } from './pglite-engine';
import type { SqlRequest, SqlResponse } from './protocol';

const engine = new PgliteEngine();

/**
 * PGlite throws `DatabaseError`s carrying the position, hint and detail
 * Postgres reported. The client only moves a string, so fold the useful
 * fields into it rather than dropping them.
 */
function describe(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const extras = err as Partial<Record<'hint' | 'detail' | 'position', string>>;
  const parts = [err.message];
  if (extras.detail) parts.push(extras.detail);
  if (extras.hint) parts.push(`Hint: ${extras.hint}`);
  if (extras.position) parts.push(`(at character ${extras.position})`);
  return parts.join(' — ');
}

self.onmessage = async (event: MessageEvent<SqlRequest>) => {
  const msg = event.data;
  const reply = (response: SqlResponse) => self.postMessage(response);
  try {
    switch (msg.type) {
      case 'reset':
        await engine.reset();
        reply({ id: msg.id, ok: true, result: undefined });
        break;
      case 'exec':
        reply({ id: msg.id, ok: true, result: await engine.exec(msg.sql) });
        break;
      case 'query':
        reply({ id: msg.id, ok: true, result: await engine.query(msg.sql, msg.params) });
        break;
      case 'validate':
        await engine.validate(msg.sql);
        reply({ id: msg.id, ok: true, result: undefined });
        break;
      case 'listTables':
        reply({ id: msg.id, ok: true, result: await engine.listTables() });
        break;
      case 'tableData':
        reply({ id: msg.id, ok: true, result: await engine.tableData(msg.name) });
        break;
      case 'dump':
        reply({ id: msg.id, ok: true, result: await engine.dump(msg.includeData) });
        break;
      case 'serialize':
        reply({ id: msg.id, ok: true, result: await engine.serialize(msg.includeData) });
        break;
      case 'exportJson':
        reply({ id: msg.id, ok: true, result: await engine.exportJson(msg.includeData) });
        break;
      case 'importDb':
        await engine.importDb(msg.bytes);
        reply({ id: msg.id, ok: true, result: undefined });
        break;
    }
  } catch (err) {
    reply({ id: msg.id, ok: false, error: describe(err) });
  }
};
