/**
 * Turn a table's SQL column types into a DataTable schema, so the database
 * viewer gets typed columns — right-aligned numbers, Yes/No booleans, real
 * date filters — instead of a wall of strings.
 *
 * Both dialects are covered by one map because the names barely differ, and
 * anything unrecognised falls back to text, which displays anything. SQLite's
 * declared types are famously loose (`VARYING CHARACTER(255)`,
 * `DOUBLE PRECISION`, or nothing at all), so matching is on substrings rather
 * than exact names.
 */
import type { TableSchema } from '../table/types';

/** Ordered: the first pattern that matches a declared type wins. */
const PATTERNS: [RegExp, string][] = [
  // Check the more specific names before the ones they contain.
  [/^bool|boolean/i, 'bool'],
  [/timestamp|datetime/i, 'datetime'],
  [/^date$/i, 'date'],
  [/^time(tz)?$|time without|time with time/i, 'time'],
  [/uuid|guid/i, 'uuid'],
  [/json/i, 'json'],
  [/money/i, 'currency'],
  [/serial|^int|integer|smallint|bigint|^tinyint|mediumint/i, 'int'],
  [/numeric|decimal|real|double|float/i, 'float'],
  [/text|char|clob|string|name$/i, 'text'],
];

/** The DataTable type for one declared SQL type. */
export function columnTypeFor(sqlType: string): string {
  const declared = (sqlType ?? '').trim();
  if (!declared) return 'text';
  for (const [pattern, type] of PATTERNS) {
    if (pattern.test(declared)) return type;
  }
  return 'text';
}

/**
 * A DataTable schema for a table's columns. The label keeps the column's real
 * name — this is a database viewer, so `created_at` should read as
 * `created_at`, not as "Created at".
 */
export function tableSchemaFrom(columns: { name: string; type: string }[]): TableSchema {
  const schema: TableSchema = {};
  for (const column of columns) {
    schema[column.name] = {
      type: columnTypeFor(column.type),
      label: column.name,
    };
  }
  return schema;
}
