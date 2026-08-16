/**
 * The database-runtime contract. Everything engine-specific lives behind
 * these interfaces, so the exercise evaluator and the playground are written
 * once against `DatabaseSession` and a second engine is purely additive:
 * implement the interface, hand its adapter to the components.
 *
 * Two engines ship: SQLite (`adapter.ts`, sqlite-wasm) and Postgres
 * (`pglite-adapter.ts`, PGlite). Both run in a Web Worker behind the same
 * message protocol and the same promise-per-message client, so the components
 * cannot tell them apart — the differences are declared here as data
 * (`binaryFormat`, `editorLanguage`, `blurb`) rather than branched on in the UI.
 *
 * Ported from retoken (see its src/lib/sql/) with the exercise-checking half
 * removed — this app has a playground, not graded exercises.
 */
import type { LanguageSupport } from '@codemirror/language';

/** One result row, as the engine returns it. */
export type Row = Record<string, unknown>;

export interface TableData {
  name: string;
  columns: { name: string; type: string }[];
  rows: Row[];
  /**
   * Primary-key columns, in key order — empty when the table has none.
   *
   * The viewer uses a single-column key as the tiebreaker for cursor paging,
   * which needs a total order to avoid skipping or repeating rows across
   * pages. Without one it falls back to `OFFSET`.
   */
  keys: string[];
}

/**
 * How an engine's binary snapshot looks on disk. The playground uses this to
 * name the download, filter the file picker, and tell a binary image apart
 * from a plain `.sql` file on import — none of which it could hard-code once
 * more than one engine exists.
 */
export interface BinaryFormat {
  /** Extension including the dot — `.sqlite`, `.tar.gz`. */
  extension: string;
  mimeType: string;
  /** Menu label, e.g. "SQLite file (.sqlite)". */
  label: string;
  /** Extra `accept` entries for the import picker. */
  accept: string[];
  /** True if these bytes are one of this engine's binary images. */
  looksBinary(bytes: Uint8Array): boolean;
}

export interface RuntimeAdapter {
  /** Stable id (also the per-engine persistence key). */
  id: string;
  /** Human label for tabs etc. ("SQLite"). */
  label: string;
  kind: 'database';
  /** SQL dialect name for prose and docs ("SQLite", "PostgreSQL 17"). */
  dialect: string;
  /** One line of intro copy — what this engine is, in the playground header. */
  blurb: string;
  /** CodeMirror language for the editor (lazy — language packages are heavy). */
  editorLanguage(): Promise<LanguageSupport>;
  /** Boot an engine session, usually wrapping a Web Worker. */
  createSession(): Promise<DatabaseSession>;
  /**
   * The engine's binary snapshot format. Omitted when it has none — the
   * playground then hides the binary export option and only accepts `.sql`.
   */
  binaryFormat?: BinaryFormat;
}

/**
 * A live database engine. `reset`/`exec`/`validate`/`listTables`/`tableData`/
 * `dump` are required; `serialize`/`exportJson`/`importDb` are optional, so an
 * engine that can't produce (or ingest) a given form just makes the components
 * hide that control.
 */
export interface DatabaseSession {
  /** Discard everything and start a fresh in-memory database. */
  reset(): Promise<void>;
  /** Execute one or more statements; resolves with any result rows. */
  exec(sql: string): Promise<Row[]>;
  /** Prepare-check the statements without executing; throws engine errors. */
  validate(sql: string): Promise<void>;
  /**
   * One parameterized statement. Optional per engine, but both shipped ones
   * have it — this is what lets the viewer page a real table, sending a
   * `WHERE` clause and its bound values instead of pulling every row.
   */
  query?(sql: string, params?: unknown[]): Promise<Row[]>;
  listTables(): Promise<string[]>;
  tableData(name: string): Promise<TableData>;
  /** SQL-text snapshot of the current database (schema, optionally data). */
  dump(includeData: boolean): Promise<string>;
  /** Binary database file image, for download — optional per engine. */
  serialize?(includeData: boolean): Promise<Uint8Array>;
  /** Per-table JSON export — optional per engine. */
  exportJson?(includeData: boolean): Promise<string>;
  /** Replace the database from a binary file image — optional per engine. */
  importDb?(bytes: Uint8Array): Promise<void>;
  destroy(): void;
}

