/**
 * Message types shared between a database worker and its client.
 * `{ id, type, ...payload }` requests; `{ id, ok, result|error }` responses.
 *
 * One protocol for every engine — the SQLite and PGlite workers both speak it,
 * which is why a single `SqlClient` can drive either.
 */
import type { Row, TableData } from './types';

export type { Row, TableData };

export type SqlRequest =
  | { id: number; type: 'reset' }
  | { id: number; type: 'exec'; sql: string }
  | { id: number; type: 'query'; sql: string; params: unknown[] }
  | { id: number; type: 'validate'; sql: string }
  | { id: number; type: 'listTables' }
  | { id: number; type: 'tableData'; name: string }
  | { id: number; type: 'dump'; includeData: boolean }
  | { id: number; type: 'serialize'; includeData: boolean }
  | { id: number; type: 'exportJson'; includeData: boolean }
  | { id: number; type: 'importDb'; bytes: Uint8Array };

export type SqlResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };

/** Omit that distributes over a union (plain Omit collapses SqlRequest). */
export type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
