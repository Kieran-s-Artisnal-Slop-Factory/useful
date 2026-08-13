/** The harness's own mirror of the schema, generated alongside the app. */
export type ColumnType = 'text' | 'integer' | 'real' | 'boolean' | 'json' | 'date' | 'timestamp';

export interface ColumnMeta {
  name: string;
  type: ColumnType;
  nullable: boolean;
  references: string | null;
}

export interface TableMeta {
  name: string;
  fieldMerge: boolean;
  singleton: boolean;
  columns: ColumnMeta[];
}

export const TABLES: TableMeta[] = [
  {
    name: 'preferences',
    fieldMerge: false,
    singleton: false,
    columns: [

    ],
  },
];

export const STORE_NAMES = TABLES.map((t) => t.name);
export const tableOf = (name: string): TableMeta =>
  TABLES.find((t) => t.name === name) ?? (() => { throw new Error('no such table: ' + name); })();

/** A representative value for a column, distinct per `variant`. */
export function sampleValue(col: ColumnMeta, variant: number): unknown {
  switch (col.type) {
    case 'text':
      // A quote, a backslash, a newline and non-ASCII on purpose: these are
      // what break naive escaping and JSON round-trips.
      return variant === 0 ? 'value ' + variant : 'wërt "' + variant + '" \\ ünï\ncödé 😀';
    case 'integer':
      return variant === 0 ? 0 : -2147483649 + variant;
    case 'real':
      return variant === 0 ? 0.5 : 62.4999;
    case 'boolean':
      return variant % 2 === 0; // BOTH values — a false stored as 0 is a bug
    case 'json':
      return variant === 0 ? [] : ['a', 'b', 'ünï 😀', 3];
    case 'date':
      return variant === 0 ? '2024-01-01' : '2024-12-31';
    case 'timestamp':
      return variant === 0 ? '2024-01-01T00:00:00.000Z' : '2024-12-31T23:59:59.999Z';
  }
}

export function buildRow(
  table: TableMeta,
  id: string,
  parents: Record<string, string>,
  variant = 0
): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id,
    updated_at: new Date().toISOString(),
    deleted_at: null,
    server_seq: null,
  };
  if (table.fieldMerge) row.field_updated_at = {};
  for (const col of table.columns) {
    row[col.name] = col.references ? (parents[col.references] ?? null) : sampleValue(col, variant);
  }
  return row;
}
