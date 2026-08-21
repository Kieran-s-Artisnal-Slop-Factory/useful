/**
 * A parsed JSON/YAML document as rows for the DataTable — the config
 * playground's Data card.
 *
 * Two shapes, chosen by the document's root:
 *
 * - an **array** is a list of records: one row per element, nested objects
 *   flattened into dotted columns (`address.city`), arrays kept as JSON text
 *   so a cell is always one value. A list of scalars is one `value` column.
 * - an **object** is a list of entries: one row per leaf (`path`, `type`,
 *   `value`), which is the useful view of a config file — a 20-key document
 *   as a 20-column single row would be unreadable and unfilterable.
 *
 * Pure and synchronous. It runs only when the user asks (a large document
 * would otherwise freeze the page on every keystroke), so the caps here are
 * for the table's sake, not the parser's: `MAX_ROWS` bounds what the grid has
 * to filter and sort, and `truncated` says when it bit.
 */
import type { DataRow } from '../table/types';

export type TabulationKind = 'records' | 'entries';

export interface Tabulation {
  kind: TabulationKind;
  rows: DataRow[];
  /** Column keys in first-seen order — the union over every row, not row 0's. */
  columns: string[];
  /** Rows the document had before the cap. */
  total: number;
  truncated: boolean;
}

export const MAX_ROWS = 20_000;
/** Nesting past this is kept as one JSON cell rather than more columns. */
const MAX_FLATTEN_DEPTH = 8;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** A scalar or JSON text — never a live object, so a cell is one value. */
function cell(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  return JSON.stringify(value);
}

function flattenRecord(
  record: Record<string, unknown>,
  out: DataRow,
  prefix: string,
  depth: number,
): void {
  for (const [key, value] of Object.entries(record)) {
    const path = prefix + key;
    if (isPlainObject(value) && depth < MAX_FLATTEN_DEPTH && Object.keys(value).length > 0) {
      flattenRecord(value, out, path + '.', depth + 1);
    } else {
      out[path] = cell(value);
    }
  }
}

function leafType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

function collectEntries(
  record: Record<string, unknown>,
  rows: DataRow[],
  prefix: string,
  depth: number,
): void {
  for (const [key, value] of Object.entries(record)) {
    if (rows.length > MAX_ROWS) return;
    const path = prefix + key;
    if (isPlainObject(value) && depth < MAX_FLATTEN_DEPTH && Object.keys(value).length > 0) {
      collectEntries(value, rows, path + '.', depth + 1);
    } else {
      rows.push({ path, type: leafType(value), value: cell(value) });
    }
  }
}

/** Rows for the DataTable, or a sentence saying why there are none. */
export function tabulateDocument(value: unknown): Tabulation | { error: string } {
  if (Array.isArray(value)) {
    if (value.length === 0) return { error: 'The document is an empty array — nothing to tabulate.' };
    const total = value.length;
    const slice = value.slice(0, MAX_ROWS);
    const allObjects = slice.every(isPlainObject);
    const rows: DataRow[] = [];
    const columns: string[] = [];
    const seen = new Set<string>();
    for (const element of slice) {
      const row: DataRow = {};
      if (allObjects) flattenRecord(element as Record<string, unknown>, row, '', 0);
      else row.value = cell(element);
      for (const key of Object.keys(row)) {
        if (!seen.has(key)) {
          seen.add(key);
          columns.push(key);
        }
      }
      rows.push(row);
    }
    return { kind: 'records', rows, columns, total, truncated: total > MAX_ROWS };
  }
  if (isPlainObject(value)) {
    const rows: DataRow[] = [];
    collectEntries(value, rows, '', 0);
    const total = rows.length;
    const truncated = total > MAX_ROWS;
    return {
      kind: 'entries',
      rows: truncated ? rows.slice(0, MAX_ROWS) : rows,
      columns: ['path', 'type', 'value'],
      total,
      truncated,
    };
  }
  return { error: 'The document must be an object or an array to tabulate.' };
}
