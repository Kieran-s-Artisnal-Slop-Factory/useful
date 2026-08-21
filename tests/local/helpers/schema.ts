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
    fieldMerge: true,
    singleton: true,
    columns: [
      { name: 'timer_default_sound', type: 'boolean', nullable: true, references: null },
      { name: 'timer_default_vibrate', type: 'boolean', nullable: true, references: null },
      { name: 'timer_default_notify', type: 'boolean', nullable: true, references: null },
      { name: 'timer_default_delete_on_complete', type: 'boolean', nullable: true, references: null },
      { name: 'timer_alarm_seconds', type: 'integer', nullable: true, references: null },
      { name: 'auto_remember_based_on_last_value', type: 'boolean', nullable: true, references: null },
      { name: 'scheduler_view', type: 'text', nullable: true, references: null },
      { name: 'scheduler_calendar_view', type: 'text', nullable: true, references: null },
      { name: 'scheduler_week_start', type: 'integer', nullable: true, references: null },
      { name: 'tz_last_from', type: 'text', nullable: true, references: null },
      { name: 'tz_last_to', type: 'text', nullable: true, references: null },
      { name: 'photo_last_format', type: 'text', nullable: true, references: null },
      { name: 'convert_jpg_quality', type: 'integer', nullable: true, references: null },
      { name: 'svg_last_doc_id', type: 'text', nullable: true, references: null },
      { name: 'sprite_last_doc_id', type: 'text', nullable: true, references: null },
      { name: 'sql_last_engine', type: 'text', nullable: true, references: null },
      { name: 'config_last_mode', type: 'text', nullable: true, references: null },
      { name: 'config_last_schema_id', type: 'text', nullable: true, references: null },
      { name: 'offline_prompt_seen', type: 'boolean', nullable: true, references: null },
      { name: 'offline_ready_at', type: 'timestamp', nullable: true, references: null },
    ],
  },
  {
    name: 'timers',
    fieldMerge: false,
    singleton: false,
    columns: [
      { name: 'label', type: 'text', nullable: false, references: null },
      { name: 'description_md', type: 'text', nullable: false, references: null },
      { name: 'duration_ms', type: 'integer', nullable: false, references: null },
      { name: 'end_at', type: 'timestamp', nullable: true, references: null },
      { name: 'paused_remaining_ms', type: 'integer', nullable: true, references: null },
      { name: 'state', type: 'text', nullable: false, references: null },
      { name: 'sound', type: 'boolean', nullable: false, references: null },
      { name: 'vibrate', type: 'boolean', nullable: false, references: null },
      { name: 'notify', type: 'boolean', nullable: false, references: null },
      { name: 'delete_on_complete', type: 'boolean', nullable: false, references: null },
    ],
  },
  {
    name: 'stopwatch',
    fieldMerge: false,
    singleton: true,
    columns: [
      { name: 'started_at', type: 'timestamp', nullable: true, references: null },
      { name: 'elapsed_before_pause_ms', type: 'integer', nullable: false, references: null },
      { name: 'laps', type: 'json', nullable: false, references: null },
      { name: 'state', type: 'text', nullable: false, references: null },
    ],
  },
  {
    name: 'events',
    fieldMerge: false,
    singleton: false,
    columns: [
      { name: 'title', type: 'text', nullable: false, references: null },
      { name: 'description_md', type: 'text', nullable: false, references: null },
      { name: 'start', type: 'timestamp', nullable: false, references: null },
      { name: 'end', type: 'timestamp', nullable: true, references: null },
      { name: 'all_day', type: 'boolean', nullable: false, references: null },
      { name: 'notify', type: 'boolean', nullable: false, references: null },
      { name: 'recurrence', type: 'json', nullable: true, references: null },
      { name: 'exdates', type: 'json', nullable: false, references: null },
      { name: 'series_id', type: 'text', nullable: true, references: 'events' },
      { name: 'original_start', type: 'timestamp', nullable: true, references: null },
    ],
  },
  {
    name: 'todos',
    fieldMerge: true,
    singleton: false,
    columns: [
      { name: 'title', type: 'text', nullable: false, references: null },
      { name: 'description_md', type: 'text', nullable: false, references: null },
      { name: 'due_date', type: 'date', nullable: true, references: null },
      { name: 'due_time', type: 'text', nullable: true, references: null },
      { name: 'priority', type: 'text', nullable: false, references: null },
      { name: 'status', type: 'text', nullable: false, references: null },
      { name: 'completed_at', type: 'timestamp', nullable: true, references: null },
      { name: 'recurrence', type: 'json', nullable: true, references: null },
      { name: 'recurrence_parent_id', type: 'text', nullable: true, references: 'todos' },
      { name: 'rank', type: 'text', nullable: false, references: null },
      { name: 'notify', type: 'boolean', nullable: false, references: null },
    ],
  },
  {
    name: 'todo_comments',
    fieldMerge: false,
    singleton: false,
    columns: [
      { name: 'todo_id', type: 'text', nullable: false, references: 'todos' },
      { name: 'body_md', type: 'text', nullable: false, references: null },
    ],
  },
  {
    name: 'svg_documents',
    fieldMerge: false,
    singleton: false,
    columns: [
      { name: 'name', type: 'text', nullable: false, references: null },
      { name: 'width', type: 'integer', nullable: false, references: null },
      { name: 'height', type: 'integer', nullable: false, references: null },
      { name: 'background', type: 'text', nullable: true, references: null },
      { name: 'layers', type: 'json', nullable: false, references: null },
    ],
  },
  {
    name: 'sprites',
    fieldMerge: false,
    singleton: false,
    columns: [
      { name: 'name', type: 'text', nullable: false, references: null },
      { name: 'size', type: 'integer', nullable: false, references: null },
      { name: 'rows', type: 'json', nullable: false, references: null },
      { name: 'colors', type: 'json', nullable: false, references: null },
    ],
  },
  {
    name: 'napkin_templates',
    fieldMerge: false,
    singleton: false,
    columns: [
      { name: 'name', type: 'text', nullable: false, references: null },
      { name: 'description', type: 'text', nullable: false, references: null },
      { name: 'formula_latex', type: 'text', nullable: false, references: null },
      { name: 'formula_json', type: 'json', nullable: true, references: null },
      { name: 'fields', type: 'json', nullable: false, references: null },
    ],
  },
  {
    name: 'napkin_calculations',
    fieldMerge: false,
    singleton: false,
    columns: [
      { name: 'template_id', type: 'text', nullable: false, references: 'napkin_templates' },
      { name: 'name', type: 'text', nullable: false, references: null },
      { name: 'values', type: 'json', nullable: false, references: null },
      { name: 'result', type: 'real', nullable: true, references: null },
    ],
  },
  {
    name: 'sql_playgrounds',
    fieldMerge: false,
    singleton: false,
    columns: [
      { name: 'engine', type: 'text', nullable: false, references: null },
      { name: 'buffer', type: 'text', nullable: false, references: null },
      { name: 'snapshot', type: 'text', nullable: true, references: null },
      { name: 'snapshot_at', type: 'timestamp', nullable: true, references: null },
    ],
  },
  {
    name: 'config_schemas',
    fieldMerge: false,
    singleton: false,
    columns: [
      { name: 'name', type: 'text', nullable: false, references: null },
      { name: 'format', type: 'text', nullable: false, references: null },
      { name: 'fields', type: 'json', nullable: false, references: null },
      { name: 'source', type: 'text', nullable: false, references: null },
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
