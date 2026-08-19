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
  /** Last engine picked in the SQL playground ('sqlite' / 'pglite'). */
  sql_last_engine?: string;
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
  sql_playgrounds: { indexes: [] },
};

export type StoreName = keyof typeof STORES;

/** Stores whose rows carry per-field timestamps (see SyncFields.field_updated_at). */
export const FIELD_MERGED_STORES: string[] = Object.entries(STORES)
  .filter(([, def]) => def.fieldMerge)
  .map(([name]) => name);
