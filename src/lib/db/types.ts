/**
 * Entity types + object-store map. GENERATED from your schema.
 */
import type { SvgLayer } from '../svg/model';

/**
 * Bookkeeping fields on every entity. This app is offline-only, but the
 * fields keep soft deletes working and leave the door open to adding a sync
 * backend later without a data migration.
 */
export interface SyncFields {
  id: string; // UUID v4, client-generated
  updated_at: string; // UTC ISO 8601; LWW conflict-resolution field
  deleted_at: string | null; // soft-delete tombstone (null = alive)
  server_seq: number | null; // server sync cursor (null = never synced)
  /**
   * Per-field last-write-wins timestamps (column -> UTC ISO 8601). Present
   * only on stores flagged `fieldMerge` below; written by repo.patch/put and
   * CONSUMED by `foldFieldMerged` in export.ts — a merge-import of a
   * field-merged store reconciles column by column (newer stamp wins, stamp
   * maps union) rather than whole-row, so two devices that edited different
   * preference fields both keep their edit. Covered by the "per-field merge
   * folding" group in tests/local/data.spec.ts.
   */
  field_updated_at?: Record<string, string>;
}

/**
 * THE single settings-style row: per-tool defaults and remembered values.
 * Read/write ONLY via repo's getSingleton/putSingleton. All fields optional —
 * the row grows as tools are used. Keep tests/local/helpers/schema.ts in
 * lockstep when adding fields.
 */
export interface Preferences extends SyncFields {
  /** Completion-action defaults auto-filled into new timers. */
  timer_default_sound?: boolean;
  timer_default_vibrate?: boolean;
  timer_default_notify?: boolean;
  timer_default_delete_on_complete?: boolean;
  /** How long a completed timer keeps ringing/vibrating (1-25s, default 25). */
  timer_alarm_seconds?: number;
  /** ON (default): saving a timer updates the defaults above. OFF: the
   * defaults only change on the Preferences page. */
  auto_remember_based_on_last_value?: boolean;
  /** Last-used scheduler view. */
  scheduler_view?: 'list' | 'board' | 'calendar';
  /** Last-used calendar sub-view. Deliberately a SEPARATE field: writing
   * 'week' into scheduler_view would make an older build fall back to the
   * list without saying why. */
  scheduler_calendar_view?: 'month' | 'week' | 'day';
  /** First day of the week in every calendar grid: 0 = Sunday, 1 = Monday. */
  scheduler_week_start?: 0 | 1;
  /** Last-used timezone pair on the converter. */
  tz_last_from?: string;
  tz_last_to?: string;
  /** Last-used sensor format on the photography calculators. */
  photo_last_format?: 'mft' | 'apsc' | 'apsc-canon' | 'ff';
  /** JPG quality default (1-100) shared by the image converter/resizer/compressor. */
  convert_jpg_quality?: number;
  /** Last-open SVG-editor document, resumed on reopen. */
  svg_last_doc_id?: string;
  /** Last-open sprite-editor document, resumed on reopen. */
  sprite_last_doc_id?: string;
  /** The napkin-math template to reopen. */
  napkin_last_template_id?: string;
  /** Last engine picked in the SQL playground ('sqlite' / 'pglite'). */
  sql_last_engine?: string;
  /** Which side of the config playground was open last. */
  config_last_mode?: 'parse' | 'create';
  /** The config-playground schema to reopen. */
  config_last_schema_id?: string;
  /** The web playground session to reopen. Written on save/open, read on load. */
  web_last_playground_id?: string;
  /** The notebook note to reopen. */
  notebook_last_note_id?: string;
  /** Which editor face the notebook shows: WYSIWYG, source or preview. */
  notebook_mode?: 'wysiwyg' | 'source' | 'preview';
  /** True once the post-install "download everything" offer has been made. */
  offline_prompt_seen?: boolean;
  /** When every offline bundle last finished downloading. */
  offline_ready_at?: string;
}

/** A countdown timer. While running, `end_at` is the absolute deadline —
 * display recomputes from the wall clock, so there are NO per-tick writes and
 * reload/navigation can't drift it. Finished timers stay as re-runnable
 * presets until deleted. */
export interface Timer extends SyncFields {
  label: string;
  /** Markdown, rendered through src/lib/markdown.ts (sanitized). */
  description_md: string;
  duration_ms: number;
  /** UTC ISO deadline; non-null only while state === 'running'. */
  end_at: string | null;
  /** Remaining budget while paused; non-null only while state === 'paused'. */
  paused_remaining_ms: number | null;
  state: 'idle' | 'running' | 'paused' | 'done';
  sound: boolean;
  vibrate: boolean;
  notify: boolean;
  /** One-shot: the timer soft-deletes itself after it completes. */
  delete_on_complete: boolean;
}

/** The one stopwatch (singleton row). Elapsed = elapsed_before_pause_ms plus
 * (now - started_at) while running; writes happen only on user actions. */
export interface Stopwatch extends SyncFields {
  /** UTC ISO start of the current running span; null unless running. */
  started_at: string | null;
  elapsed_before_pause_ms: number;
  /** Total-elapsed milliseconds captured at each lap press, oldest first. */
  laps: number[];
  state: 'idle' | 'running' | 'paused';
}

/**
 * A calendar event. Recurring events expand VIRTUALLY: the rule lives here and
 * occurrences are computed at render and scan time (src/lib/scheduler/
 * occurrences.ts), never written. Events are never "completed", so the
 * spawn-on-complete trick todos use has no trigger — and page load, the only
 * other candidate, must not write.
 */
export interface Event extends SyncFields {
  title: string;
  description_md: string;
  /** UTC ISO start instant. For a series this is the anchor AND its first
   * occurrence; the wall time it shows locally is re-applied to every later
   * one, so a 09:00 meeting stays 09:00 across a DST boundary. */
  start: string;
  /** Optional UTC ISO end instant (>= start). A series re-applies this
   * duration to every occurrence. */
  end: string | null;
  all_day: boolean;
  notify: boolean;
  /** Repeat rule, or null for a one-off. Shared shape with todos. */
  recurrence: RecurrenceRule | null;
  /** Occurrence start instants (UTC ISO) that were cancelled — iCal's EXDATE.
   * NOT tombstones: `all()` hides tombstoned rows, so a skipped occurrence
   * would become a hole nobody could see or undo. */
  exdates: string[];
  /** Set on a "detached" row: the series this occurrence was pulled out of.
   * The row is an ordinary event in every other way. */
  series_id: string | null;
  /** The series instant this detached row stands in for; the expander skips
   * that instant on the parent so the two never both render. */
  original_start: string | null;
}

export type TodoStatus = 'todo' | 'in_progress' | 'completed';
export type TodoPriority = 'low' | 'medium' | 'high' | 'urgent';

/** Recurrence rule, stored ON the todo (donetick-style — no full RRULE).
 * Completing a recurring todo creates exactly ONE successor inside the same
 * user action; occurrences are never materialized on render. */
export type RecurrenceRule = (
  | { kind: 'every'; interval: number; unit: 'days' | 'weeks' | 'months' }
  | { kind: 'weekdays'; days: number[] } // 0 = Sunday … 6 = Saturday
) & {
  /** Inclusive local end date 'YYYY-MM-DD'; absent/null = forever. No
   * occurrence COUNT: a virtual expander would have to count from the anchor
   * on every render to honour one. */
  until?: string | null;
};

export interface Todo extends SyncFields {
  title: string;
  description_md: string;
  /** Local calendar date 'YYYY-MM-DD'; null = undated (list/kanban only). */
  due_date: string | null;
  /** Local time 'HH:MM'; only meaningful with a due_date. Date-only todos
   * produce no timed notification. */
  due_time: string | null;
  priority: TodoPriority;
  status: TodoStatus;
  completed_at: string | null;
  recurrence: RecurrenceRule | null;
  /** The todo this one was spawned from when a recurring todo completed. */
  recurrence_parent_id: string | null;
  /** Fractional ordering key for the kanban column (see lib/scheduler/rank). */
  rank: string;
  notify: boolean;
}

/** One comment on a todo — a child row, so edits stay isolated and the FK
 * integrity checks apply. */
export interface TodoComment extends SyncFields {
  todo_id: string;
  body_md: string;
}

/** A named SVG-editor document. Layers are plain JSON structures (see
 * src/lib/svg/model.ts) — text-only, so they round-trip the JSON data layer
 * and backup export/import byte-identically. */
export interface SvgDocument extends SyncFields {
  name: string;
  /** Canvas size in SVG user units (also the viewBox). */
  width: number;
  height: number;
  /** Canvas background color; null = transparent. */
  background: string | null;
  layers: SvgLayer[];
}

/**
 * One SQL-playground workspace — the editor buffer and, optionally, a saved
 * snapshot of the database as SQL text.
 *
 * The row id IS the engine id ('sqlite' / 'pglite'): one workspace per engine,
 * because a Postgres snapshot can never be replayed into SQLite. Everything
 * here is text, so it round-trips the JSON data layer and rides backups like
 * any other row — the live database itself lives only in the worker's memory.
 */
export interface SqlPlayground extends SyncFields {
  /** Engine id — same value as the row id, kept as a field for readability. */
  engine: string;
  buffer: string;
  /** SQL dump of the saved database state; null when nothing is saved. */
  snapshot: string | null;
  snapshot_at: string | null;
}

/**
 * A named sprite-editor document. The grid is an array of strings and the
 * legend a character -> CSS colour map, so the whole thing is text and rides
 * the JSON data layer and backups byte-identically — the same reason the SVG
 * editor's layers do.
 *
 * Nothing here is trusted on read: a backup can be hand-edited, and the
 * generic data suite writes an ARRAY into every json column. `normalizeSprite`
 * in src/lib/sprite/export.ts squares the grid and filters the legend.
 */
export interface Sprite extends SyncFields {
  name: string;
  /** Edge length in pixels (4-48 from the editor). */
  size: number;
  /** `size` strings of `size` characters; '.' and ' ' are transparent. */
  rows: string[];
  /** Single-character key -> a colour `isSafeColor` accepts. */
  colors: Record<string, string>;
}

/**
 * One input to a napkin-math formula, derived from its free variables.
 *
 * The type set stays numeric on purpose: MathJSON has no string arithmetic, so
 * a text field could never take part in the formula it is attached to.
 */
export interface NapkinField {
  /** The Compute Engine symbol this stands for, e.g. `count`. */
  name: string;
  /** Label shown beside the input. Defaults to the name. */
  label: string;
  /**
   * What this input means, in the author's words.
   *
   * Optional, and empty for every field written before it existed — the
   * `fields` column is JSON, so this needed no migration, which is exactly why
   * every reader has to tolerate its absence.
   */
  description: string;
  type: 'integer' | 'number';
  required: boolean;
  /** Which signs the value may take. */
  sign: 'any' | 'positive';
  /** Independent of `sign`: "positive, and not zero" is a different rule. */
  noZero: boolean;
}

export interface NapkinTemplate extends SyncFields {
  name: string;
  description: string;
  /** The formula as the editor holds it. */
  formula_latex: string;
  /** The same formula as MathJSON — what the generator and evaluator read. */
  formula_json: unknown;
  /** One entry per free variable, in the order the formula introduces them. */
  fields: NapkinField[];
}

export interface NapkinCalculation extends SyncFields {
  template_id: string;
  name: string;
  /** Field name -> the number supplied. */
  values: Record<string, number>;
  /** The answer at save time; null when the inputs did not produce one. */
  result: number | null;
}

/**
 * How the config playground types a value: JSON's scalars, the five string
 * formats its inference can spot, and the structural kinds. 'any' is the
 * honest fallback for values the inference cannot pin down; 'union' only ever
 * comes out of inference (the create-mode dropdown does not offer it).
 */
export type ConfigFieldKind =
  | 'string'
  | 'integer'
  | 'number'
  | 'boolean'
  | 'email'
  | 'phone'
  | 'uri'
  | 'date'
  | 'date-time'
  | 'enum'
  | 'union'
  | 'object'
  | 'array'
  | 'any';

export interface ConfigFieldType {
  kind: ConfigFieldKind;
  /** kind 'enum': the allowed values. */
  values?: Array<string | number | boolean>;
  /** kind 'array': the element type. */
  item?: ConfigFieldType;
  /** kind 'object': the nested fields. */
  fields?: ConfigField[];
  /** kind 'union': the alternatives. */
  variants?: ConfigFieldType[];
}

/**
 * One key in a config schema. `optional` (the key may be missing) is tracked
 * separately from `nullable` (the key is there but null) — a config format
 * where the two mean different things to a reader deserves a schema that can
 * say which one it saw.
 */
export interface ConfigField {
  key: string;
  type: ConfigFieldType;
  optional: boolean;
  nullable: boolean;
}

/**
 * A named config-playground schema. Everything is plain JSON, so rows ride
 * backup export/import byte-identically. Nothing read from a stored row is
 * trusted: the generic data suite writes an ARRAY into every json column and
 * a backup can be hand-edited, so `normalizeFields` in src/lib/config/model.ts
 * re-shapes the `fields` column on every read.
 */
export interface ConfigSchema extends SyncFields {
  name: string;
  format: 'json' | 'yaml';
  /** The root object's fields (the Field/Type table). */
  fields: ConfigField[];
  /** Parse mode's document text, so switching modes loses nothing. */
  source: string;
}

/**
 * A saved web-playground session: three buffers, a name, and which language
 * the script is written in. All text, which is why it rides the JSON data
 * layer and a backup byte-identically — the same reasoning as the SQL
 * playground storing SQL rather than a database.
 *
 * Code in a backup is the POINT here, not a leak: the same stance `notes`
 * takes. Nothing is trusted on read — `normalizeSession` in
 * src/lib/playground/model.ts squares up a hand-edited row.
 */
export interface WebPlayground extends SyncFields {
  name: string;
  html: string;
  css: string;
  script: string;
  /** 'js' or 'ts'. TypeScript is stripped, never type-checked. */
  lang: string;
}

/**
 * A notebook note. Folders are notes too: `parent_id` points at another note
 * (Q16), so a note can hold children and the sidebar is one tree. The body is
 * markdown text rendered through src/lib/markdown.ts (sanitized); images live
 * in `note_assets`, never inline, so listing notes stays cheap.
 *
 * Backlinks are computed, never stored — a stored index goes stale the moment
 * a backup is restored, and rebuilding it on load is a write on load.
 *
 * Nothing read from a stored row is trusted: the generic data suite writes an
 * ARRAY into every json column and can self-parent a row, and a backup can be
 * hand-edited. Readers normalize `aliases`/`tags` and treat a missing, cyclic
 * or self parent as "root".
 */
export interface Note extends SyncFields {
  title: string;
  body_md: string;
  /** Old titles, pushed on rename so `[[Old title]]` keeps resolving. */
  aliases: string[];
  /** The note this one sits under; null at the root. */
  parent_id: string | null;
  tags: string[];
}

/**
 * One image (or other file) pasted into a note, as base64. A child store so
 * `all('notes')`, the list view and the link scan never carry image bytes —
 * the same reasoning that made comments their own store. Capped per asset
 * (see src/lib/notebook/assets.ts): backup export is one JSON string of the
 * whole database, and base64 inflates by a third.
 */
export interface NoteAsset extends SyncFields {
  note_id: string;
  name: string;
  mime: string;
  /** The decoded size, so totals never need a decode. */
  bytes: number;
  /** Base64 without the `data:` prefix. */
  data: string;
}

export interface StoreIndex {
  name: string;
  multiEntry?: boolean;
}

export interface StoreDef {
  indexes: StoreIndex[];
  /** Reconciled per field rather than whole-row last-write-wins. */
  fieldMerge?: boolean;
  /** Single-row table: read/write it with repo's getSingleton/putSingleton. */
  singleton?: boolean;
}

/**
 * A named Docker Compose project.
 *
 * `model` holds the whole project — services, networks, volumes, secrets and
 * configs — as plain JSON-native structures. **The model is the source of
 * truth and the YAML is a projection of it**, never the other way round: a
 * stored YAML string would drift from the editor the first time either side
 * changed, and re-parsing text on every keystroke is how a builder loses your
 * comments and your key order.
 *
 * Nothing read from a stored row is trusted: the generic data suite writes an
 * ARRAY into every json column and a backup can be hand-edited, so
 * `normalizeProject` in src/lib/compose/model.ts re-shapes `model` on every
 * read.
 *
 * **A compose file can contain secrets.** Environment variables, database
 * passwords and inline config content all live in this row, and this store
 * rides the plain-JSON backup like every other. The page says so where
 * someone can act on it rather than burying it here.
 */
export interface ComposeProject extends SyncFields {
  name: string;
  /** The project model. Shape enforced on read, never on trust. */
  model: unknown;
}

export const STORES: Record<string, StoreDef> = {
  // singleton: one logical row under repo.SINGLETON_ID, so every device
  // converges on the same row if sync ever lands. fieldMerge: two devices
  // changing DIFFERENT preference fields both keep their edit (folded
  // per-field on backup merge-import — see export.ts).
  preferences: { indexes: [], singleton: true, fieldMerge: true },
  timers: { indexes: [] },
  stopwatch: { indexes: [], singleton: true },
  // series_id: a series has to be able to find the occurrences that were
  // pulled out of it — to render them, and to take them with it when it goes.
  events: { indexes: [{ name: 'start' }, { name: 'series_id' }] },
  // fieldMerge: status changed on one device and description on another must
  // both survive a future sync/merge.
  todos: { indexes: [{ name: 'status' }, { name: 'due_date' }], fieldMerge: true },
  todo_comments: { indexes: [{ name: 'todo_id' }] },
  svg_documents: { indexes: [] },
  sprites: { indexes: [] },
  napkin_templates: { indexes: [] },
  // template_id: a template has to be able to find the calculations run
  // against it — to list them, and to take them with it when it goes.
  napkin_calculations: { indexes: [{ name: 'template_id' }] },
  sql_playgrounds: { indexes: [] },
  config_schemas: { indexes: [] },
  compose_projects: { indexes: [] },
  // parent_id: the tree is read by parent; tags: a multiEntry index so a tag
  // lookup does not scan every note. fieldMerge: a title edited on one device
  // and a body on another must both survive a future merge.
  notes: { indexes: [{ name: 'parent_id' }, { name: 'tags', multiEntry: true }], fieldMerge: true },
  // note_id: a note has to find its images — to show them, and to take them
  // with it when it goes.
  note_assets: { indexes: [{ name: 'note_id' }] },
  web_playgrounds: { indexes: [] },
};

export type StoreName = keyof typeof STORES;

/** Stores whose rows carry per-field timestamps (see SyncFields.field_updated_at). */
export const FIELD_MERGED_STORES: string[] = Object.entries(STORES)
  .filter(([, def]) => def.fieldMerge)
  .map(([name]) => name);
