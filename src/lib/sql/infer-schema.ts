/**
 * A DataTable schema for an arbitrary result set.
 *
 * `tableSchemaFrom` works from a table's declared column types, which the
 * catalogue always knows. A query's result set is different: a SQLite
 * expression column (`select price * qty`) has no declared type at all, and a
 * `count(*)` comes back typed only on Postgres. So the rule here is
 * **declared type first, sniffed type as the fallback** — never the reverse,
 * because the engine knows things the values cannot show (an all-integer
 * `numeric` column is still a float column, and a column with no rows still
 * has a type).
 *
 * Lives in `sql/` rather than `table/` on purpose: `src/lib/table/` is a
 * self-contained module that imports nothing outward, and this needs
 * `columnTypeFor`.
 */
import { columnTypeFor } from './table-schema';
import { isBlank } from '../table/format';
import type { DataRow, TableSchema } from '../table/types';
import type { ResultColumn } from './types';

/** How many rows to look at when a column has no declared type. */
const SAMPLE = 200;
/** How many rows to scan for column names when the engine did not say. */
const KEY_SCAN = 50;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Guess a column's type from up to `SAMPLE` of its non-blank values. */
function sniff(rows: DataRow[], key: string): string {
  const values: unknown[] = [];
  for (const row of rows.slice(0, SAMPLE)) {
    const value = row[key];
    if (!isBlank(value)) values.push(value);
  }
  // Nothing to go on. `text` renders anything, which is the safe default.
  if (values.length === 0) return 'text';

  const every = (test: (value: unknown) => boolean) => values.every(test);

  if (every((v) => typeof v === 'boolean')) return 'bool';
  if (every((v) => typeof v === 'number' || typeof v === 'bigint')) {
    return every((v) => (typeof v === 'bigint' ? true : Number.isInteger(v))) ? 'int' : 'float';
  }
  if (every((v) => v instanceof Date)) return 'datetime';
  if (every((v) => typeof v === 'object' && v !== null && !(v instanceof Date))) return 'json';
  if (every((v) => typeof v === 'string' && ISO_DATE.test(v))) return 'date';
  if (every((v) => typeof v === 'string' && ISO_DATETIME.test(v))) return 'datetime';
  if (every((v) => typeof v === 'string' && UUID.test(v))) return 'uuid';
  return 'text';
}

/**
 * Build a schema for `rows`, preferring whatever `columns` declares.
 *
 * Passing `columns` is also what gives an EMPTY result set its headers:
 * `select id, name from t where false` returns no rows to sniff, but the
 * engine still describes the two columns.
 */
export function inferSchema(rows: DataRow[], columns?: ResultColumn[]): TableSchema {
  const schema: TableSchema = {};

  if (columns && columns.length > 0) {
    for (const column of columns) {
      const declared = (column.type ?? '').trim();
      schema[column.name] = {
        // An engine that cannot say (SQLite, always) sends '', which is not a
        // claim about the type — fall through to the values.
        type: declared ? columnTypeFor(declared) : sniff(rows, column.name),
        label: column.name,
      };
    }
    return schema;
  }

  // No description: take the union of the keys, not just row 0's. A first row
  // that happens to be sparse must not cost the result set a column.
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const row of rows.slice(0, KEY_SCAN)) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }
  for (const key of keys) {
    schema[key] = { type: sniff(rows, key), label: key };
  }
  return schema;
}
