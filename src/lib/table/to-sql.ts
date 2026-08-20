/**
 * Walk a DataTable filter tree into a parameterized SQL `WHERE` clause.
 *
 * This is what makes the table's filter model usable against a database
 * rather than an array: the same tree that filters rows in the browser
 * becomes a clause the engine runs, so a million-row table pages without ever
 * shipping a million rows.
 *
 * **Values are never interpolated.** Every comparison value becomes a bound
 * parameter — `$1`/`$2` for Postgres, `?` for SQLite — so a filter value can't
 * change the shape of the query. Identifiers are quoted, and only column keys
 * that exist in the schema are emitted at all, so a key can't smuggle SQL in
 * either.
 *
 * ── Matching the client-side engine ────────────────────────────────────────
 * The aim is that filtering in SQL gives the same answers as `filterRows`:
 *
 *  - Text comparisons are case-insensitive, because the client's are.
 *  - `is not` and `does not contain` also match NULL, because client-side a
 *    missing value reads as `''` and so is "not" whatever you typed. Plain SQL
 *    `<>` would drop those rows.
 *  - Incomplete conditions are skipped rather than emitted, exactly as they
 *    are skipped client-side — so a half-built filter doesn't empty the table.
 *  - `is between` accepts its bounds in either order.
 *
 * Anything the connection genuinely can't do is reported in `unsupported`
 * rather than silently dropped or silently wrong — see the `regex` option,
 * which is a property of the connection rather than of the dialect.
 */
import type { Column } from './types';
import { toNumber, toText, toTime } from './format';
import { isActive, operatorDef, splitList, type Condition, type FilterNode } from './filter';

export type SqlDialect = 'postgres' | 'sqlite';

export interface SqlWhere {
  /** The clause without a leading `WHERE`; empty when nothing is filtering. */
  where: string;
  params: unknown[];
  /** Conditions this dialect can't express, described for the UI. */
  unsupported: string[];
}

export interface SqlOptions {
  dialect?: SqlDialect;
  /** Start numbering placeholders here — for stitching clauses together. */
  startIndex?: number;
  /**
   * Whether the connection can evaluate a regular expression.
   *
   * Postgres always can (`~*`). SQLite parses `X REGEXP Y` but ships no
   * implementation, so it fails at run time unless the host registers a
   * `regexp()` function — which the SQLite worker here does. It's a property
   * of the *connection*, not the dialect, so it has to be passed in: a
   * vanilla SQLite would error on the same SQL.
   */
  regex?: boolean;
}

/** Regex support, unless the caller says otherwise. */
const supportsRegex = (options: SqlOptions): boolean =>
  options.regex ?? (options.dialect ?? 'postgres') === 'postgres';

/** Double-quote an identifier, doubling embedded quotes. Both engines agree. */
export const quoteIdent = (name: string): string => '"' + name.replaceAll('"', '""') + '"';

/** `%`, `_` and the escape character itself have to be neutralised in LIKE. */
export const escapeLike = (value: string): string =>
  value.replace(/[\\%_]/g, (char) => `\\${char}`);

/** A running parameter list that knows how to render its own placeholders. */
class Params {
  readonly values: unknown[] = [];
  constructor(
    private readonly dialect: SqlDialect,
    private readonly offset: number
  ) {}
  /** Bind a value and return the placeholder that refers to it. */
  add(value: unknown): string {
    this.values.push(value);
    return this.dialect === 'postgres' ? `$${this.offset + this.values.length}` : '?';
  }
}

/** Coerce a filter value into something the column's SQL type will accept. */
function bindable(column: Column, value: unknown, dialect: SqlDialect): unknown {
  if (column.kind === 'number') {
    const n = toNumber(value);
    return Number.isNaN(n) ? null : n;
  }
  if (column.kind === 'bool') {
    // SQLite has no boolean type; it stores 0/1.
    return dialect === 'postgres' ? Boolean(value) : value ? 1 : 0;
  }
  // Temporal values go as their text, which both engines compare or cast.
  return toText(value);
}

/** Text comparisons are case-insensitive on both sides of the boundary. */
const foldText = (sql: string, kind: Column['kind']): string =>
  kind === 'text' || kind === 'enum' || kind === 'json' ? `lower(${sql})` : sql;

/**
 * Postgres types that no text function will accept.
 *
 * `lower()`, `trim()`, `ILIKE` and `~*` all take `text`. Handed a `uuid`, an
 * enum or `json`/`jsonb`, Postgres raises at run time rather than coercing —
 * and since `id` resolves to `uuid`, every table with a non-integer primary
 * key hits this on the first filter anyone builds. SQLite has no such types
 * and applies its own conversions, so the cast is Postgres-only.
 *
 * `toSqlSearch` has always cast for the same reason; this brings the operator
 * path in line with it.
 */
const NEEDS_CAST: ReadonlySet<string> = new Set(['uuid', 'enum', 'json']);

/**
 * The identifier, cast to text where a text operator would otherwise fail.
 *
 * Only ever applied to the IDENTIFIER. Casting the bound placeholder as well
 * (`$1::text`) is redundant and confuses Postgres' parameter type inference.
 */
const castText = (sql: string, column: Column, dialect: SqlDialect): string =>
  dialect === 'postgres' && NEEDS_CAST.has(column.type) ? `${sql}::text` : sql;

/** SQL for one condition, or null when it contributes nothing. */
function conditionSql(
  condition: Condition,
  column: Column,
  params: Params,
  dialect: SqlDialect,
  regex: boolean,
  unsupported: string[]
): string | null {
  const id = quoteIdent(column.key);
  // `text` is the identifier a text function may touch; `id` stays bare
  // wherever a native comparison is wanted (ordering, IS NULL, index seeks).
  const text = castText(id, column, dialect);
  const textual = column.kind === 'text' || column.kind === 'enum' || column.kind === 'json';
  const bind = (value: unknown) => params.add(bindable(column, value, dialect));

  /** `col LIKE '%x%'`, case-insensitively, with the wildcards escaped. */
  const like = (pattern: string, negate: boolean): string => {
    const operator = dialect === 'postgres' ? 'ILIKE' : 'LIKE';
    const placeholder = params.add(pattern);
    const clause = `${text} ${negate ? `NOT ${operator}` : operator} ${placeholder} ESCAPE '\\'`;
    // A NULL never matches LIKE, so "does not contain" would drop NULL rows —
    // but client-side a missing value does not contain anything, so it passes.
    return negate ? `(${clause} OR ${id} IS NULL)` : clause;
  };

  const needle = escapeLike(toText(condition.value));

  switch (condition.op) {
    case 'eq':
      return `${foldText(text, column.kind)} = ${foldText(bind(condition.value), column.kind)}`;
    case 'ne':
      // Also match NULL, to agree with the client (see the module comment).
      return `(${foldText(text, column.kind)} <> ${foldText(bind(condition.value), column.kind)} OR ${id} IS NULL)`;
    case 'gt':
      return `${id} > ${bind(condition.value)}`;
    case 'gte':
      return `${id} >= ${bind(condition.value)}`;
    case 'lt':
      return `${id} < ${bind(condition.value)}`;
    case 'lte':
      return `${id} <= ${bind(condition.value)}`;
    case 'between': {
      // The client accepts the bounds either way round; BETWEEN does not.
      const [low, high] = orderBounds(column, condition.value, condition.value2);
      return `${id} BETWEEN ${bind(low)} AND ${bind(high)}`;
    }
    case 'contains':
      return like(`%${needle}%`, false);
    case 'notContains':
      return like(`%${needle}%`, true);
    case 'startsWith':
      return like(`${needle}%`, false);
    case 'endsWith':
      return like(`%${needle}`, false);
    case 'matches': {
      if (!regex) {
        // Emitting this would error at run time, not merely match nothing.
        unsupported.push(`${column.label} matches regex (no REGEXP on this connection)`);
        return null;
      }
      return dialect === 'postgres'
        ? `${text} ~* ${params.add(toText(condition.value))}`
        : // The operator SQLite resolves to the registered regexp() function.
          `${id} REGEXP ${params.add(toText(condition.value))}`;
    }
    case 'isTrue':
      return dialect === 'postgres' ? `${id} IS TRUE` : `${id} = 1`;
    case 'isFalse':
      return dialect === 'postgres' ? `${id} IS FALSE` : `${id} = 0`;
    case 'anyOf':
    case 'noneOf': {
      const list = splitList(condition.value);
      if (list.length === 0) return null;
      const placeholders = list
        .map((entry) => foldText(bind(entry), column.kind))
        .join(', ');
      const target = foldText(text, column.kind);
      return condition.op === 'anyOf'
        ? `${target} IN (${placeholders})`
        : `(${target} NOT IN (${placeholders}) OR ${id} IS NULL)`;
    }
    case 'isEmpty':
      return textual ? `(${id} IS NULL OR trim(${text}) = '')` : `${id} IS NULL`;
    case 'isNotEmpty':
      return textual ? `(${id} IS NOT NULL AND trim(${text}) <> '')` : `${id} IS NOT NULL`;
    default:
      return null;
  }
}

/** Put `between` bounds the right way round, comparing in the column's terms. */
function orderBounds(column: Column, a: unknown, b: unknown): [unknown, unknown] {
  if (column.kind === 'number') {
    const x = toNumber(a);
    const y = toNumber(b);
    if (!Number.isNaN(x) && !Number.isNaN(y) && x > y) return [b, a];
    return [a, b];
  }
  if (column.kind === 'temporal') {
    const x = toTime(a, column.type);
    const y = toTime(b, column.type);
    if (!Number.isNaN(x) && !Number.isNaN(y) && x > y) return [b, a];
    return [a, b];
  }
  return toText(a) > toText(b) ? [b, a] : [a, b];
}

/** SQL for a node, or null when the whole subtree contributes nothing. */
function nodeSql(
  node: FilterNode,
  columns: Map<string, Column>,
  params: Params,
  dialect: SqlDialect,
  regex: boolean,
  unsupported: string[]
): string | null {
  if (node.kind === 'condition') {
    const column = columns.get(node.column);
    // Skipping inactive conditions is what keeps a half-built filter from
    // emptying the table, exactly as it does client-side.
    if (!column || !isActive(node, columns)) return null;
    const definition = operatorDef(node.op);
    if (!definition) return null;
    // A tree built by hand — or deserialised from somewhere — can pair an
    // operator with a column kind the UI would never have offered, e.g. `gt`
    // on a json column. Emitting it produces SQL that errors rather than one
    // that merely matches nothing.
    if (!definition.kinds.includes(column.kind)) return null;
    return conditionSql(node, column, params, dialect, regex, unsupported);
  }

  const parts = node.children
    .map((child) => nodeSql(child, columns, params, dialect, regex, unsupported))
    .filter((part): part is string => part !== null);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0]!;
  // Always parenthesised: without it an OR group inside an AND would bind
  // wrongly and quietly return the wrong rows.
  return `(${parts.join(node.combinator === 'and' ? ' AND ' : ' OR ')})`;
}

/** Build the `WHERE` clause and its bound parameters. */
export function toSqlWhere(
  filter: FilterNode | null | undefined,
  columns: Map<string, Column>,
  options: SqlOptions = {}
): SqlWhere {
  const dialect = options.dialect ?? 'postgres';
  const params = new Params(dialect, options.startIndex ?? 0);
  const unsupported: string[] = [];
  const where = filter
    ? (nodeSql(filter, columns, params, dialect, supportsRegex(options), unsupported) ?? '')
    : '';
  return { where, params: params.values, unsupported };
}

/**
 * An `ORDER BY` fragment for a sort, or empty. NULLs are ordered last in both
 * directions, matching the client, where blanks always sink to the bottom.
 */
export function toSqlOrderBy(
  sort: { key: string; direction: 'asc' | 'desc' } | null | undefined,
  columns: Map<string, Column>,
  options: SqlOptions = {}
): string {
  if (!sort) return '';
  const column = columns.get(sort.key);
  if (!column || !column.sortable) return '';
  const direction = sort.direction === 'desc' ? 'DESC' : 'ASC';
  const id = quoteIdent(column.key);
  // SQLite has no NULLS LAST before 3.30; the CASE works everywhere.
  return (options.dialect ?? 'postgres') === 'postgres'
    ? `${id} ${direction} NULLS LAST`
    : `(${id} IS NULL), ${id} ${direction}`;
}

/**
 * ── Keyset (cursor) pagination ─────────────────────────────────────────────
 *
 * `LIMIT n OFFSET m` makes the engine walk and discard every one of those `m`
 * rows, so page 1,000 costs a thousand pages of work. Keyset paging asks
 * instead for "the rows after this one", which an index can seek to directly:
 * the cost of page 1,000 is the cost of page 1.
 *
 * The price is that you can only step forward and back, not jump to page 500 —
 * you need the previous page's last row to ask for the next one.
 *
 * It also needs a *total* order, or rows can be skipped or repeated across
 * pages. That's what `keyColumn` is for: a unique tiebreaker (a primary key)
 * appended to whatever the reader sorted by.
 */

/** The last row of the page you're leaving, as `{ columnKey: value }`. */
export type KeysetCursor = Record<string, unknown>;

/**
 * `ORDER BY` for keyset paging: the reader's sort, then the unique key as a
 * tiebreaker so the order is total. `back` reverses it, which is how the
 * previous page is fetched — take `limit` rows going backwards, then flip
 * them.
 */
export function toKeysetOrderBy(
  sort: { key: string; direction: 'asc' | 'desc' } | null | undefined,
  keyColumn: string,
  columns: Map<string, Column>,
  options: SqlOptions & { back?: boolean } = {}
): string {
  const key = columns.get(keyColumn);
  if (!key) return '';
  const flip = (direction: 'asc' | 'desc') =>
    options.back ? (direction === 'asc' ? 'desc' : 'asc') : direction;

  const parts: string[] = [];
  if (sort && sort.key !== keyColumn) {
    const sorted = toSqlOrderBy({ key: sort.key, direction: flip(sort.direction) }, columns, options);
    if (sorted) parts.push(sorted);
  }
  // The tiebreaker must run the same way as the sort it breaks ties for.
  // `toKeysetWhere` compares both with one operator, so ordering the key the
  // other way would make the seek disagree with the order — and rows sharing
  // a sort value would be skipped or repeated across pages.
  const keyDirection = flip(sort?.direction ?? 'asc');
  parts.push(`${quoteIdent(keyColumn)} ${keyDirection === 'desc' ? 'DESC' : 'ASC'}`);
  return parts.join(', ');
}

/** What `toKeysetWhere` returns: a clause, plus whether a seek was possible. */
export interface KeysetSeek extends SqlWhere {
  /**
   * False ONLY when a seek was required and could not be built.
   *
   * An empty `where` means three different things — page one, no key value in
   * the cursor, and a NULL in the sort column — and the first is fine while
   * the other two are not. Without this flag a caller runs a query identical
   * to page one while the pager believes it has advanced, so "next" serves the
   * same rows forever. When this is false the caller must fall back to
   * LIMIT/OFFSET for that page.
   */
  seekable: boolean;
}

/**
 * The `WHERE` fragment selecting the rows after (or before) the cursor.
 *
 * Sorting by the key itself is one comparison. Sorting by anything else needs
 * the two-column form — `sort > ? OR (sort = ? AND key > ?)` — written out
 * rather than as a row value, because the engines differ on how row values
 * interact with NULLs.
 *
 * A NULL in the cursor's sort column is where this stops working: under
 * `NULLS LAST` there is no comparison that means "after the nulls", so the
 * caller is told (`unsupported`) and should fall back to OFFSET for that page.
 */
export function toKeysetWhere(
  cursor: KeysetCursor | null | undefined,
  sort: { key: string; direction: 'asc' | 'desc' } | null | undefined,
  keyColumn: string,
  columns: Map<string, Column>,
  options: SqlOptions & { back?: boolean } = {}
): KeysetSeek {
  const dialect = options.dialect ?? 'postgres';
  const params = new Params(dialect, options.startIndex ?? 0);
  const unsupported: string[] = [];
  /** No cursor at all: this is page one, which needs no seek and is not a failure. */
  const first = { where: '', params: [] as unknown[], unsupported, seekable: true };
  /** A seek was wanted and could not be built — the caller must use OFFSET. */
  const stuck = { where: '', params: [] as unknown[], unsupported, seekable: false };

  const key = columns.get(keyColumn);
  if (!cursor || !key) return first;
  if (!(keyColumn in cursor)) return stuck; // asked to seek, but from what?

  const ascending = (sort?.direction ?? 'asc') === 'asc';
  // Going back means "before the cursor" — the comparison flips.
  const forward = options.back ? !ascending : ascending;
  const op = forward ? '>' : '<';
  const keyId = quoteIdent(keyColumn);

  if (!sort || sort.key === keyColumn) {
    return {
      where: `${keyId} ${op} ${params.add(bindable(key, cursor[keyColumn], dialect))}`,
      params: params.values,
      unsupported,
      seekable: true,
    };
  }

  const sorted = columns.get(sort.key);
  if (!sorted) return stuck;
  const sortValue = cursor[sort.key];
  if (sortValue === null || sortValue === undefined) {
    unsupported.push(
      `${sorted.label} is empty on the last row, so cursor paging can't seek past it`
    );
    return stuck;
  }

  const sortId = quoteIdent(sort.key);
  const boundary = params.add(bindable(sorted, sortValue, dialect));
  const tie = params.add(bindable(sorted, sortValue, dialect));
  const keyParam = params.add(bindable(key, cursor[keyColumn], dialect));
  return {
    where: `(${sortId} ${op} ${boundary} OR (${sortId} = ${tie} AND ${keyId} ${op} ${keyParam}))`,
    params: params.values,
    unsupported,
    seekable: true,
  };
}

/** Free-text search across text-ish columns, as a clause. */
export function toSqlSearch(
  term: string,
  columns: Column[],
  options: SqlOptions = {}
): SqlWhere {
  const dialect = options.dialect ?? 'postgres';
  const params = new Params(dialect, options.startIndex ?? 0);
  const needle = term.trim();
  if (!needle) return { where: '', params: [], unsupported: [] };

  const operator = dialect === 'postgres' ? 'ILIKE' : 'LIKE';
  const pattern = `%${escapeLike(needle)}%`;
  const parts = columns
    .filter((column) => !column.hidden)
    .map((column) => {
      const id = quoteIdent(column.key);
      // Cast so a search term can match a number or a date column too.
      const target = dialect === 'postgres' ? `${id}::text` : `CAST(${id} AS TEXT)`;
      return `${target} ${operator} ${params.add(pattern)} ESCAPE '\\'`;
    });
  if (parts.length === 0) return { where: '', params: [], unsupported: [] };
  return { where: `(${parts.join(' OR ')})`, params: params.values, unsupported: [] };
}

/** Join clauses with AND, dropping the empty ones. */
export const andClauses = (...clauses: string[]): string =>
  clauses.filter((clause) => clause.trim() !== '').join(' AND ');
