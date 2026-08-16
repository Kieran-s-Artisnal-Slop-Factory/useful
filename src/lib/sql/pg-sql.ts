/**
 * Pure Postgres SQL helpers used by the PGlite worker: identifier and literal
 * quoting for the dump, and a statement splitter for `validate`.
 *
 * These live outside the worker so they can be unit-tested (pg-sql.test.ts) —
 * they're where the subtle bugs are. Nothing here touches PGlite.
 */

/** Double-quote an identifier, doubling any embedded quote. */
export const quotePgId = (name: string): string => '"' + name.replaceAll('"', '""') + '"';

/** Single-quote a string literal, doubling any embedded quote. */
export const quotePgString = (value: string): string => "'" + value.replaceAll("'", "''") + "'";

/**
 * A SQL literal for a value PGlite handed back. PGlite parses Postgres types
 * into JS values (Date for timestamps, Uint8Array for bytea, objects for
 * json/jsonb, string for numeric), so the mapping back is by JS type.
 *
 * Casts are explicit where the bare literal would be ambiguous — a timestamp
 * or bytea literal has to be told what it is, or Postgres reads it as text.
 */
export function quotePgValue(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'number') {
    // NaN/Infinity are valid float8 values but only as quoted literals.
    return Number.isFinite(v) ? String(v) : `'${String(v)}'::float8`;
  }
  if (v instanceof Date) {
    return Number.isNaN(v.getTime())
      ? 'NULL'
      : `${quotePgString(v.toISOString())}::timestamptz`;
  }
  if (v instanceof Uint8Array) {
    // bytea hex input. standard_conforming_strings is on by default, so the
    // backslash is a literal backslash — exactly what the hex format wants.
    return `'\\x${Array.from(v, (b) => b.toString(16).padStart(2, '0')).join('')}'::bytea`;
  }
  if (Array.isArray(v) || (typeof v === 'object' && v !== null)) {
    // json / jsonb columns arrive as parsed JS values; send them back as JSON.
    return `${quotePgString(JSON.stringify(v))}::jsonb`;
  }
  return quotePgString(String(v));
}

/**
 * Split a SQL batch into individual statements on top-level semicolons.
 *
 * Semicolons inside single-quoted strings, double-quoted identifiers,
 * dollar-quoted bodies (`$$…$$`, `$tag$…$tag$` — how function bodies are
 * written), line comments and block comments are not separators. Postgres
 * block comments nest, so the depth is counted.
 *
 * Blank fragments (trailing separator, whitespace, comments only) are dropped:
 * the result is the statements worth compiling.
 */
export function splitPgStatements(sql: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let i = 0;
  const n = sql.length;

  /** Content, ignoring whitespace and comments — is this fragment real SQL? */
  const push = (end: number) => {
    const fragment = sql.slice(start, end);
    if (stripComments(fragment).trim()) statements.push(fragment.trim());
    start = end + 1;
  };

  while (i < n) {
    const ch = sql[i]!;

    if (ch === "'") {
      i++;
      while (i < n) {
        if (sql[i] === "'") {
          // '' is an escaped quote, not the end of the string.
          if (sql[i + 1] === "'") i += 2;
          else break;
        } else if (sql[i] === '\\') {
          // Only meaningful in E'' strings, but skipping the pair is harmless
          // in a standard string: a lone backslash escapes nothing there.
          i += 2;
        } else i++;
      }
      i++;
      continue;
    }

    if (ch === '"') {
      i++;
      while (i < n) {
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') i += 2;
          else break;
        } else i++;
      }
      i++;
      continue;
    }

    if (ch === '$') {
      const tag = dollarTagAt(sql, i);
      if (tag) {
        const end = sql.indexOf(tag, i + tag.length);
        // Unterminated dollar quote: the rest of the input is one body.
        i = end === -1 ? n : end + tag.length;
        continue;
      }
    }

    if (ch === '-' && sql[i + 1] === '-') {
      const nl = sql.indexOf('\n', i);
      i = nl === -1 ? n : nl + 1;
      continue;
    }

    if (ch === '/' && sql[i + 1] === '*') {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') {
          depth++;
          i += 2;
        } else if (sql[i] === '*' && sql[i + 1] === '/') {
          depth--;
          i += 2;
        } else i++;
      }
      continue;
    }

    if (ch === ';') {
      push(i);
      i++;
      continue;
    }

    i++;
  }

  push(n);
  return statements;
}

/**
 * The dollar-quote tag opening at `index` (`$$` or `$tag$`), or null if the
 * `$` is something else — a positional parameter (`$1`) or an operator.
 */
function dollarTagAt(sql: string, index: number): string | null {
  if (sql[index] !== '$') return null;
  let i = index + 1;
  while (i < sql.length && /[A-Za-z0-9_]/.test(sql[i]!)) i++;
  if (sql[i] !== '$') return null;
  const tag = sql.slice(index, i + 1);
  // $1$ would be a tag by shape, but a tag can't start with a digit — that's
  // a positional parameter followed by something else.
  if (/^\$\d/.test(tag)) return null;
  return tag;
}

/** Blank out comments so a fragment can be tested for real content. */
function stripComments(sql: string): string {
  let out = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    if (sql[i] === '-' && sql[i + 1] === '-') {
      const nl = sql.indexOf('\n', i);
      i = nl === -1 ? n : nl + 1;
    } else if (sql[i] === '/' && sql[i + 1] === '*') {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') {
          depth++;
          i += 2;
        } else if (sql[i] === '*' && sql[i + 1] === '/') {
          depth--;
          i += 2;
        } else i++;
      }
    } else {
      out += sql[i];
      i++;
    }
  }
  return out;
}
