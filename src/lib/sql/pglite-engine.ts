/**
 * The Postgres engine, on PGlite. Everything the worker does, minus the
 * worker plumbing — kept separate so it can be driven directly (PGlite runs
 * in Node too, which is how pglite-engine.test.ts checks the dump round-trip).
 *
 * In-memory only (`memory://`), matching the SQLite engine: persisting to
 * IndexedDB or OPFS would make the component's storage story host-specific,
 * and the playground's snapshot already covers "pick up where I left off".
 *
 * The interesting part is `dump()`. PGlite has no `pg_dump`, so this is one —
 * built out of the catalogs, using the introspection functions Postgres
 * provides for exactly this (`format_type`, `pg_get_expr`,
 * `pg_get_constraintdef`, `pg_indexes.indexdef`, `pg_views.definition`).
 */
import { PGlite } from '@electric-sql/pglite';
import type { ExecResult, Row, TableData, TableMeta } from './types';
import { quotePgId, quotePgValue, splitPgStatements } from './pg-sql';

/**
 * A WHERE fragment excluding Postgres' own schemas, for whichever column
 * holds the schema name in the query being built.
 */
const userSchemas = (column = 'nspname') =>
  `${column} NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
   AND ${column} NOT LIKE 'pg\\_temp%' AND ${column} NOT LIKE 'pg\\_toast\\_temp%'`;

/** A relation as the catalogs describe it. */
interface Relation {
  oid: number;
  schema: string;
  name: string;
  /** Display name: bare in `public`, schema-qualified anywhere else. */
  display: string;
}

export class PgliteEngine {
  #db: PGlite | null = null;

  async #ensure(): Promise<PGlite> {
    this.#db ??= await PGlite.create('memory://');
    return this.#db;
  }

  /** OID → printable type name. Stable for the life of the database. */
  #typeCache = new Map<number, string>();

  /** Rows for a parameterized query. */
  async #rows<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
    const db = await this.#ensure();
    const result = await db.query<T>(sql, params);
    return result.rows;
  }

  /**
   * Discard every user object. Dropping the schemas is far cheaper than
   * booting a second PGlite — `initdb` is seconds, this is milliseconds.
   */
  async reset(): Promise<void> {
    const db = await this.#ensure();
    await db.exec(`DO $reset$
DECLARE target text;
BEGIN
  FOR target IN SELECT nspname FROM pg_catalog.pg_namespace WHERE ${userSchemas()}
  LOOP
    EXECUTE format('DROP SCHEMA %I CASCADE', target);
  END LOOP;
  EXECUTE 'CREATE SCHEMA public';
END
$reset$;`);
  }

  /** Run one or more statements, collecting any result rows produced. */
  async exec(sql: string): Promise<Row[]> {
    const db = await this.#ensure();
    const results = await db.exec(sql);
    return results.flatMap((result) => result.rows as Row[]);
  }

  /**
   * `exec`, plus the last result set's column names and types.
   *
   * PGlite reports each statement's `fields: { name, dataTypeID }[]`, which
   * are populated whether or not any row came back — so `select id, name from
   * t where false` still gets its two headers instead of rendering as a
   * broken query. The OID is turned into a printable type name through
   * `format_type`, cached because the same handful of OIDs recur on every
   * query in a session.
   */
  async execDescribed(sql: string): Promise<ExecResult> {
    const db = await this.#ensure();
    const results = await db.exec(sql);
    const rows = results.flatMap((result) => result.rows as Row[]);
    // A multi-statement buffer ends with the statement whose rows are shown,
    // so describe the last one that actually had a result set.
    const described = [...results].reverse().find((result) => (result.fields?.length ?? 0) > 0);
    const fields = described?.fields ?? [];
    const names = await this.#typeNames(fields.map((f) => f.dataTypeID));
    return {
      columns: fields.map((f) => ({ name: f.name, type: names.get(f.dataTypeID) ?? '' })),
      rows,
    };
  }

  /** Printable type names for a set of OIDs, memoised across the session. */
  async #typeNames(oids: number[]): Promise<Map<number, string>> {
    const wanted = [...new Set(oids)].filter((oid) => !this.#typeCache.has(oid));
    if (wanted.length > 0) {
      const found = await this.#rows<{ oid: number; name: string }>(
        `SELECT oid::int AS oid, pg_catalog.format_type(oid, -1) AS name
         FROM pg_catalog.pg_type WHERE oid = ANY($1)`,
        [wanted]
      );
      for (const row of found) this.#typeCache.set(Number(row.oid), String(row.name));
      // Cache the misses too, so an unknown OID is not re-queried every render.
      for (const oid of wanted) if (!this.#typeCache.has(oid)) this.#typeCache.set(oid, '');
    }
    return this.#typeCache;
  }

  /** One parameterized statement — values bound, never spliced into the SQL. */
  async query(sql: string, params: unknown[] = []): Promise<Row[]> {
    return this.#rows(sql, params);
  }

  /**
   * Compile every statement without executing it — the extended protocol's
   * Parse + Describe, which is what `describeQuery` does. That only takes one
   * statement at a time, hence the splitter.
   *
   * Same semantics as the SQLite engine's prepare loop, including its limit:
   * a statement that depends on an earlier one in the same batch (`CREATE
   * TABLE t; SELECT * FROM t;`) fails, because nothing has run yet.
   */
  async validate(sql: string): Promise<void> {
    const db = await this.#ensure();
    for (const statement of splitPgStatements(sql)) {
      await db.describeQuery(statement);
    }
  }

  /** User relations, oldest first (the order they were created). */
  async #relations(kinds: string[]): Promise<Relation[]> {
    return this.#rows<Relation & Row>(
      `SELECT c.oid::int AS oid, n.nspname AS schema, c.relname AS name,
              CASE WHEN n.nspname = 'public' THEN c.relname
                   ELSE n.nspname || '.' || c.relname END AS display
       FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind = ANY($1) AND ${userSchemas('n.nspname')}
       ORDER BY c.oid`,
      [kinds]
    );
  }

  /** Fully-qualified, quoted reference for a relation. */
  #ref(relation: Pick<Relation, 'schema' | 'name'>): string {
    return `${quotePgId(relation.schema)}.${quotePgId(relation.name)}`;
  }

  /** Table names for the viewer's tabs — tables and views, alphabetical. */
  async listTables(): Promise<string[]> {
    const relations = await this.#relations(['r', 'p', 'f', 'v', 'm']);
    return relations.map((r) => r.display).sort((a, b) => a.localeCompare(b));
  }

  /** Resolve a viewer display name back to its relation. */
  async #resolve(display: string): Promise<Relation> {
    const relations = await this.#relations(['r', 'p', 'f', 'v', 'm']);
    const match = relations.find((r) => r.display === display);
    if (!match) throw new Error(`No such table: ${display}`);
    return match;
  }

  /** Column metadata and key columns for one table — no rows. */
  async tableMeta(display: string): Promise<TableMeta> {
    const relation = await this.#resolve(display);
    const columns = await this.#rows<{ name: string; type: string }>(
      `SELECT a.attname AS name, pg_catalog.format_type(a.atttypid, a.atttypmod) AS type
       FROM pg_catalog.pg_attribute a
       WHERE a.attrelid = $1 AND a.attnum > 0 AND NOT a.attisdropped
       ORDER BY a.attnum`,
      [relation.oid]
    );
    // Primary-key columns in key order — `conkey` is the ordered attnum list,
    // so unnest WITH ORDINALITY preserves it.
    const keyed = await this.#rows<{ name: string }>(
      `SELECT a.attname AS name
       FROM pg_catalog.pg_constraint c
       CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
       JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
       WHERE c.conrelid = $1 AND c.contype = 'p'
       ORDER BY k.ord`,
      [relation.oid]
    );
    return { name: display, columns, keys: keyed.map((k) => k.name) };
  }

  /**
   * `tableMeta` plus a sample of rows.
   *
   * The browser pages through `query`, so this exists for a caller that has
   * no `tableMeta` — the rows would otherwise be fetched and discarded on
   * every table switch and after every run.
   */
  async tableData(display: string): Promise<TableData> {
    const meta = await this.tableMeta(display);
    const relation = await this.#resolve(display);
    const rows = await this.#rows(`SELECT * FROM ${this.#ref(relation)} LIMIT 50`);
    return { ...meta, rows };
  }

  /**
   * Serialize the whole database to re-runnable SQL — our own `pg_dump`.
   *
   * Order matters: schemas, then sequences, then tables (with their columns,
   * defaults, and non-foreign-key constraints inline), then sequence
   * ownership, the data, `setval` to restore each counter, the indexes that
   * don't back a constraint, foreign keys as `ALTER TABLE` (so table order
   * can't matter), and finally views.
   */
  async dump(includeData: boolean): Promise<string> {
    const lines: string[] = ['BEGIN;'];

    // ── Schemas ──────────────────────────────────────────────────────────
    const schemas = await this.#rows<{ name: string }>(
      `SELECT nspname AS name FROM pg_catalog.pg_namespace
       WHERE ${userSchemas()} AND nspname <> 'public' ORDER BY nspname`
    );
    for (const schema of schemas) lines.push(`CREATE SCHEMA IF NOT EXISTS ${quotePgId(schema.name)};`);

    // ── Sequences ────────────────────────────────────────────────────────
    // Identity-column sequences (deptype 'i') are created by the column
    // definition itself; dumping them separately would duplicate them.
    const sequences = await this.#rows<{
      schema: string;
      name: string;
      data_type: string;
      start_value: string;
      minimum_value: string;
      maximum_value: string;
      increment: string;
      cycle_option: boolean;
      last_value: string | null;
      owner_schema: string | null;
      owner_table: string | null;
      owner_column: string | null;
      internal: boolean;
    }>(
      `SELECT s.schemaname AS schema, s.sequencename AS name,
              format_type(s.data_type, NULL) AS data_type,
              s.start_value::text, s.min_value::text AS minimum_value,
              s.max_value::text AS maximum_value, s.increment_by::text AS increment,
              s.cycle AS cycle_option, s.last_value::text,
              on_.nspname AS owner_schema, oc.relname AS owner_table, oa.attname AS owner_column,
              COALESCE(d.deptype = 'i', false) AS internal
       FROM pg_catalog.pg_sequences s
       JOIN pg_catalog.pg_class c
         ON c.relname = s.sequencename
        AND c.relnamespace = (SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = s.schemaname)
       LEFT JOIN pg_catalog.pg_depend d
         ON d.classid = 'pg_class'::regclass AND d.objid = c.oid
        AND d.refclassid = 'pg_class'::regclass AND d.deptype IN ('a', 'i')
       LEFT JOIN pg_catalog.pg_class oc ON oc.oid = d.refobjid
       LEFT JOIN pg_catalog.pg_namespace on_ ON on_.oid = oc.relnamespace
       LEFT JOIN pg_catalog.pg_attribute oa ON oa.attrelid = d.refobjid AND oa.attnum = d.refobjsubid
       WHERE ${userSchemas('s.schemaname')}
       ORDER BY s.schemaname, s.sequencename`
    );
    const standalone = sequences.filter((s) => !s.internal);
    for (const seq of standalone) {
      lines.push(
        `CREATE SEQUENCE IF NOT EXISTS ${this.#ref({ schema: seq.schema, name: seq.name })}` +
          ` AS ${seq.data_type} INCREMENT BY ${seq.increment}` +
          ` MINVALUE ${seq.minimum_value} MAXVALUE ${seq.maximum_value}` +
          ` START WITH ${seq.start_value} ${seq.cycle_option ? 'CYCLE' : 'NO CYCLE'};`
      );
    }

    // ── Tables ───────────────────────────────────────────────────────────
    const tables = await this.#relations(['r', 'p']);
    const deferred: string[] = []; // foreign keys, added after the data

    for (const table of tables) {
      const columns = await this.#rows<{
        name: string;
        type: string;
        notnull: boolean;
        default_expr: string | null;
        identity: string;
        generated: string;
      }>(
        `SELECT a.attname AS name,
                pg_catalog.format_type(a.atttypid, a.atttypmod) AS type,
                a.attnotnull AS notnull,
                pg_catalog.pg_get_expr(ad.adbin, ad.adrelid) AS default_expr,
                a.attidentity AS identity,
                a.attgenerated AS generated
         FROM pg_catalog.pg_attribute a
         LEFT JOIN pg_catalog.pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
         WHERE a.attrelid = $1 AND a.attnum > 0 AND NOT a.attisdropped
         ORDER BY a.attnum`,
        [table.oid]
      );

      const parts = columns.map((col) => {
        let part = `  ${quotePgId(col.name)} ${col.type}`;
        if (col.identity === 'a' || col.identity === 'd') {
          part += ` GENERATED ${col.identity === 'a' ? 'ALWAYS' : 'BY DEFAULT'} AS IDENTITY`;
        } else if (col.generated === 's' && col.default_expr) {
          part += ` GENERATED ALWAYS AS (${col.default_expr}) STORED`;
        } else if (col.default_expr) {
          part += ` DEFAULT ${col.default_expr}`;
        }
        // A generated column is implicitly NOT NULL only if declared so; an
        // identity column always is, and repeating it is harmless.
        if (col.notnull && col.generated !== 's') part += ' NOT NULL';
        return part;
      });

      const constraints = await this.#rows<{ name: string; kind: string; definition: string }>(
        `SELECT conname AS name, contype::text AS kind,
                pg_catalog.pg_get_constraintdef(oid) AS definition
         FROM pg_catalog.pg_constraint
         WHERE conrelid = $1 AND contype IN ('p', 'u', 'c', 'f')
         ORDER BY contype DESC, conname`,
        [table.oid]
      );
      for (const constraint of constraints) {
        const clause = `CONSTRAINT ${quotePgId(constraint.name)} ${constraint.definition}`;
        // Foreign keys wait until every table exists and is populated.
        if (constraint.kind === 'f') {
          deferred.push(`ALTER TABLE ${this.#ref(table)} ADD ${clause};`);
        } else {
          parts.push(`  ${clause}`);
        }
      }

      lines.push(`CREATE TABLE ${this.#ref(table)} (\n${parts.join(',\n')}\n);`);
    }

    // Ownership has to follow both the sequence and the table it belongs to.
    for (const seq of standalone) {
      if (!seq.owner_table || !seq.owner_schema || !seq.owner_column) continue;
      lines.push(
        `ALTER SEQUENCE ${this.#ref({ schema: seq.schema, name: seq.name })} OWNED BY ` +
          `${this.#ref({ schema: seq.owner_schema, name: seq.owner_table })}.${quotePgId(seq.owner_column)};`
      );
    }

    // ── Data ─────────────────────────────────────────────────────────────
    if (includeData) {
      for (const table of tables) {
        // Generated columns can't be written to, so they're left out of the
        // column list (and recomputed on insert).
        const writable = await this.#rows<{ name: string }>(
          `SELECT a.attname AS name
           FROM pg_catalog.pg_attribute a
           WHERE a.attrelid = $1 AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
           ORDER BY a.attnum`,
          [table.oid]
        );
        if (writable.length === 0) continue;
        const names = writable.map((c) => c.name);
        const columnList = names.map(quotePgId).join(', ');
        const rows = await this.#rows(`SELECT ${columnList} FROM ${this.#ref(table)}`);
        for (const row of rows) {
          const values = names.map((name) => quotePgValue(row[name])).join(', ');
          // OVERRIDING SYSTEM VALUE so GENERATED ALWAYS AS IDENTITY columns
          // keep their original keys instead of being renumbered.
          lines.push(
            `INSERT INTO ${this.#ref(table)} (${columnList}) OVERRIDING SYSTEM VALUE VALUES (${values});`
          );
        }
      }

      // Restore every counter, identity sequences included, so the next
      // insert doesn't collide with a row that's already there.
      for (const seq of sequences) {
        if (seq.last_value === null) continue;
        const literal = quotePgValue(`${quotePgId(seq.schema)}.${quotePgId(seq.name)}`);
        lines.push(`SELECT pg_catalog.setval(${literal}, ${seq.last_value}, true);`);
      }
    }

    // ── Indexes ──────────────────────────────────────────────────────────
    // `indexdef` is the full CREATE INDEX statement. Indexes that exist only
    // to back a PRIMARY KEY / UNIQUE constraint are already covered above.
    const indexes = await this.#rows<{ definition: string }>(
      `SELECT i.indexdef AS definition
       FROM pg_catalog.pg_indexes i
       WHERE ${userSchemas('i.schemaname')}
         AND NOT EXISTS (
           SELECT 1 FROM pg_catalog.pg_constraint c
           JOIN pg_catalog.pg_class ic ON ic.oid = c.conindid
           JOIN pg_catalog.pg_namespace ins ON ins.oid = ic.relnamespace
           WHERE ic.relname = i.indexname AND ins.nspname = i.schemaname
         )
       ORDER BY i.schemaname, i.indexname`
    );
    for (const index of indexes) lines.push(`${index.definition};`);

    lines.push(...deferred);

    // ── Views ────────────────────────────────────────────────────────────
    // Ordered by oid so a view built on another view is created second.
    const views = await this.#rows<{
      schema: string;
      name: string;
      definition: string;
      materialized: boolean;
    }>(
      `SELECT v.schemaname AS schema, v.viewname AS name, v.definition, false AS materialized,
              c.oid AS ordinal
       FROM pg_catalog.pg_views v
       JOIN pg_catalog.pg_class c ON c.relname = v.viewname
        AND c.relnamespace = (SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = v.schemaname)
       WHERE ${userSchemas('v.schemaname')}
       UNION ALL
       SELECT m.schemaname, m.matviewname, m.definition, true, c.oid
       FROM pg_catalog.pg_matviews m
       JOIN pg_catalog.pg_class c ON c.relname = m.matviewname
        AND c.relnamespace = (SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = m.schemaname)
       WHERE ${userSchemas('m.schemaname')}
       ORDER BY ordinal`
    );
    for (const view of views) {
      const body = view.definition.trim().replace(/;$/, '');
      lines.push(
        view.materialized
          ? `CREATE MATERIALIZED VIEW ${this.#ref(view)} AS\n${body};`
          : `CREATE OR REPLACE VIEW ${this.#ref(view)} AS\n${body};`
      );
    }

    lines.push('COMMIT;');
    return lines.join('\n');
  }

  /**
   * A gzipped tarball of the Postgres data directory — PGlite's own snapshot
   * format, and the only exact binary image it has. Schema-only replays the
   * schema into a throwaway instance and dumps that.
   */
  async serialize(includeData: boolean): Promise<Uint8Array> {
    if (includeData) {
      const db = await this.#ensure();
      const blob = await db.dumpDataDir('gzip');
      return new Uint8Array(await blob.arrayBuffer());
    }
    const schema = await this.dump(false);
    const temp = await PGlite.create('memory://');
    try {
      await temp.exec(schema);
      const blob = await temp.dumpDataDir('gzip');
      return new Uint8Array(await blob.arrayBuffer());
    } finally {
      await temp.close();
    }
  }

  /**
   * Replace the database from a PGlite data-directory tarball. The current
   * instance is kept until the new one has booted and answered a query, so a
   * bad file leaves the session usable.
   */
  async importDb(bytes: Uint8Array): Promise<void> {
    let fresh: PGlite;
    try {
      // Copy into a standalone ArrayBuffer — a Uint8Array view that arrived
      // over postMessage may be a partial view of a larger buffer.
      const copy = new Uint8Array(bytes);
      fresh = await PGlite.create({ loadDataDir: new Blob([copy]) });
      await fresh.query('SELECT 1');
    } catch {
      throw new Error('That file is not a PGlite data directory (.tar.gz).');
    }
    const old = this.#db;
    this.#db = fresh;
    await old?.close();
  }

  /** Export every table as JSON. With data: `{ table: [rowObjects] }`. */
  async exportJson(includeData: boolean): Promise<string> {
    const tables = await this.#relations(['r', 'p']);
    const result: Record<string, unknown[]> = {};
    for (const table of tables) {
      result[table.display] = includeData
        ? await this.#rows(`SELECT * FROM ${this.#ref(table)}`)
        : await this.#rows(
            `SELECT a.attname AS name, pg_catalog.format_type(a.atttypid, a.atttypmod) AS type,
                    a.attnotnull AS "notnull",
                    COALESCE((SELECT true FROM pg_catalog.pg_constraint c
                              WHERE c.conrelid = a.attrelid AND c.contype = 'p'
                                AND a.attnum = ANY(c.conkey)), false) AS pk
             FROM pg_catalog.pg_attribute a
             WHERE a.attrelid = $1 AND a.attnum > 0 AND NOT a.attisdropped
             ORDER BY a.attnum`,
            [table.oid]
          );
    }
    const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
    return JSON.stringify(
      result,
      (_key, value) =>
        typeof value === 'bigint'
          ? // Keep exact: precise as a number within 2^53, else a string so
            // large bigints aren't silently rounded.
            value <= MAX_SAFE && value >= -MAX_SAFE
            ? Number(value)
            : value.toString()
          : value instanceof Uint8Array
            ? Array.from(value)
            : value,
      2
    );
  }

  async close(): Promise<void> {
    const db = this.#db;
    this.#db = null;
    await db?.close();
  }
}
