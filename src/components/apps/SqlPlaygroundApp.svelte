<script lang="ts">
  /**
   * SQL playground — a real database engine in the browser tab.
   *
   * Ported from retoken's `SqlPlayground.svelte`, with three deliberate
   * changes for this app:
   *  - persistence goes through the data layer (`sql_playgrounds`, one row per
   *    engine) instead of localStorage, so a workspace rides backup
   *    export/import and the oracle audits every write;
   *  - the engine choice is remembered in `preferences`.
   *
   * Both grids are retoken's `DataTable`. They run in opposite modes, and the
   * reason is where the rows already are. The **results** grid filters, sorts,
   * pages and exports client-side, because `exec` has already returned every
   * row. The **browser** runs manual: its filter tree compiles to a `WHERE`
   * clause, sorting compiles to `ORDER BY`, and paging is a keyset seek when
   * the table has a single-column key — so a million-row table pages without
   * ever sending a million rows. None of that state is persisted.
   *
   * The engines (SQLite via sqlite-wasm, Postgres via PGlite) run in Web
   * Workers behind one message protocol, so nothing here knows which is which
   * — everything engine-specific arrives as data on the adapter. Both are
   * lazy: picking an engine is what downloads it.
   */
  import { onDestroy, onMount } from 'svelte';
  import Card from '../Card.svelte';
  import Explainer from '../Explainer.svelte';
  import SqlEditor from '../SqlEditor.svelte';
  import DataTable from '../DataTable.svelte';
  import { engines as allEngines } from '../../lib/sql/engines';
  import type {
    DatabaseSession,
    ResultColumn,
    RuntimeAdapter,
    Row,
    TableData,
  } from '../../lib/sql/types';
  import { inferSchema } from '../../lib/sql/infer-schema';
  import { tableSchemaFrom } from '../../lib/sql/table-schema';
  import { columnMap, normalizeSchema, type DataRow, type TableQuery } from '../../lib/table/types';
  import { emptyGroup, type FilterGroup } from '../../lib/table/filter';
  import {
    andClauses,
    quoteIdent,
    toKeysetOrderBy,
    toKeysetWhere,
    toSqlOrderBy,
    toSqlSearch,
    toSqlWhere,
  } from '../../lib/table/to-sql';
  import { indexedDbPlayground } from '../../lib/sql/store';
  import { getSingleton, putSingleton } from '../../lib/db/repo';
  import type { Preferences } from '../../lib/db/types';
  import { downloadBlob, downloadText, copyText } from '../../lib/exportFile';
  import { formatBytes } from '../../lib/img/convert';

  const ONE_MB = 1024 * 1024;
  /** Rows a page of the table browser holds. Not persisted, not configurable. */
  const BROWSE_PAGE = 25;

  const store = indexedDbPlayground();
  const choices = allEngines;

  let activeId = $state(choices[0]!.id);
  let active = $derived(choices.find((e) => e.id === activeId) ?? choices[0]!);
  let binary = $derived(active.binaryFormat);
  let accept = $derived(['.sql', 'application/sql', ...(binary?.accept ?? [])].join(','));

  // `session` is NOT $state: it is a class with private fields, and wrapping
  // one in a reactive proxy breaks it. Capabilities are mirrored into plain
  // booleans the template can react to.
  let session: DatabaseSession | null = null;
  let editor: SqlEditor | undefined = $state();
  let fileInput: HTMLInputElement | undefined = $state();

  let booting = $state(true);
  let bootError = $state<string | null>(null);
  let sqlError = $state<string | null>(null);
  let resultRows = $state<Row[]>([]);
  let ranEmpty = $state(false);
  let restoredBanner = $state(false);

  let tables = $state<string[]>([]);
  let activeTable = $state<string | null>(null);
  let tableView = $state<TableData | null>(null);
  /** Columns the engine described for the last result set — headers even at 0 rows. */
  let resultColumns = $state<ResultColumn[]>([]);

  // ---- the table browser's query state. All component-local: filters, sort
  // and page are deliberately NOT persisted, so loading a page and looking
  // around still writes nothing at all.
  let browseFilter = $state<FilterGroup>(emptyGroup('and'));
  let browseRows = $state<DataRow[]>([]);
  let browseTotal = $state<number | undefined>(undefined);
  let browseHasMore = $state(false);
  let browseBusy = $state(false);
  let browseNotes = $state<string[]>([]);
  let browseError = $state<string | null>(null);
  /** Real, unfiltered row count for the footer note — never on the paging path. */
  let tableRows = $state(0);
  /**
   * Plain, not `$state`: a race guard, not something the template reads. Every
   * fetch takes a ticket and drops its result if a later one has been issued.
   */
  let browseToken = 0;

  let saveMsg = $state<string | null>(null);
  let saveError = $state<string | null>(null);
  /** Set when a snapshot is over 1MB and awaiting explicit confirmation. */
  let pendingLarge = $state<{ sql: string; bytes: number } | null>(null);
  let includeData = $state(true);
  let canExportBinary = $state(false);
  let canQuery = $state(false);
  let canDescribe = $state(false);
  let canTableMeta = $state(false);

  /** Set on unmount so a session that boots afterwards is destroyed, not leaked. */
  let destroyed = false;
  /** Bumped per boot; a boot with a stale token lost a race and must clean up. */
  let bootToken = 0;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  const dialect = $derived<'postgres' | 'sqlite'>(active.id === 'pglite' ? 'postgres' : 'sqlite');
  const resultSchema = $derived(inferSchema(resultRows as DataRow[], resultColumns));

  const browseSchema = $derived(tableSchemaFrom(tableView?.columns ?? []));
  const browseColumns = $derived(normalizeSchema(browseSchema));
  const browseLookup = $derived(columnMap(browseColumns));
  /**
   * Cursor paging needs a total order to avoid skipping or repeating rows, so
   * it is only offered when one column alone identifies a row. Everything else
   * pages by OFFSET.
   */
  const keyColumn = $derived(tableView?.keys.length === 1 ? tableView.keys[0]! : null);
  const useCursor = $derived(!!keyColumn && canQuery);
  /**
   * Remount the grid only when the SHAPE changes. Keying on the whole view
   * would wipe the reader's filter after every Run, and a keyset anchor is a
   * value in a `>` comparison rather than a row identity, so it stays valid
   * even if the row it came from is gone.
   */
  const browseKey = $derived(
    `${activeTable}:${(tableView?.columns ?? []).map((c) => c.name).join(',')}`
  );

  /** PGlite reports `schema.table`; both halves need quoting separately. */
  function quoteTable(name: string): string {
    const dot = name.indexOf('.');
    return dot === -1
      ? quoteIdent(name)
      : `${quoteIdent(name.slice(0, dot))}.${quoteIdent(name.slice(dot + 1))}`;
  }

  /**
   * Fetch one page of the active table, compiling the grid's own query state
   * into SQL. This is the manual-mode contract: the grid asks, nothing more.
   */
  async function fetchPage(request: TableQuery) {
    if (!session?.query || !activeTable) return;
    const mine = ++browseToken;
    const target = quoteTable(activeTable);
    browseBusy = true;
    browseError = null;
    try {
      const conditions = toSqlWhere(request.filter as FilterGroup, browseLookup, {
        dialect,
        // Both workers register a regexp() implementation, so the `matches`
        // operator is available on either engine.
        regex: true,
      });
      const search = toSqlSearch(request.search, browseColumns, {
        dialect,
        startIndex: conditions.params.length,
      });
      const where = andClauses(conditions.where, search.where);
      const whereSql = where ? ` WHERE ${where}` : '';
      const params = [...conditions.params, ...search.params];

      // A seek is only ever asked for in cursor mode.
      const seeking = !!keyColumn && !!request.step;

      if (!seeking) {
        const counted = await session.query(
          `SELECT count(*) AS n FROM ${target}${whereSql}`,
          params
        );
        if (mine !== browseToken) return;
        browseTotal = Number(counted[0]?.['n'] ?? 0);
      } else {
        // Cursor mode has no total ON PURPOSE: counting every match is exactly
        // the full scan the mode exists to avoid, and nothing displays it.
        browseTotal = undefined;
      }

      const limit = request.pageSize > 0 ? request.pageSize : BROWSE_PAGE;
      const offset = (Math.max(1, request.page) - 1) * limit;
      // One row past the page is how `hasMore` is known without a count.
      const probe = limit + 1;

      let sql: string;
      let args: unknown[];
      if (seeking) {
        const keysetOrder = toKeysetOrderBy(request.sort, keyColumn!, browseLookup, { dialect });
        const seek = toKeysetWhere(request.cursor ?? null, request.sort, keyColumn!, browseLookup, {
          dialect,
          startIndex: params.length,
        });
        browseNotes = [...conditions.unsupported, ...seek.unsupported];
        if (seek.seekable) {
          const seekWhere = andClauses(where, seek.where);
          sql =
            `SELECT * FROM ${target}${seekWhere ? ` WHERE ${seekWhere}` : ''}` +
            ` ORDER BY ${keysetOrder} LIMIT ${probe}`;
          args = [...params, ...seek.params];
        } else {
          // The cursor cannot seek past this value — a NULL in the sort column
          // has no "after the nulls" comparison under NULLS LAST. Serve the
          // page by OFFSET instead, under the SAME order as the keyset pages,
          // so its boundaries line up with the pages either side of it rather
          // than silently re-serving page one.
          sql =
            `SELECT * FROM ${target}${whereSql} ORDER BY ${keysetOrder}` +
            ` LIMIT ${probe} OFFSET ${offset}`;
          args = params;
        }
      } else {
        const orderBy = toSqlOrderBy(request.sort, browseLookup, { dialect });
        browseNotes = conditions.unsupported;
        sql =
          `SELECT * FROM ${target}${whereSql}${orderBy ? ` ORDER BY ${orderBy}` : ''}` +
          ` LIMIT ${probe} OFFSET ${offset}`;
        args = params;
      }

      const fetched = await session.query(sql, args);
      if (mine !== browseToken) return;
      browseRows = fetched.slice(0, limit) as DataRow[];
      browseHasMore = fetched.length > limit;
    } catch (err) {
      if (mine !== browseToken) return;
      browseError = message(err);
      browseRows = [];
      browseHasMore = false;
    } finally {
      if (mine === browseToken) browseBusy = false;
    }
  }

  /**
   * The footer note's row count: unfiltered, and off the paging path entirely.
   * One count per table selection, never one per page.
   */
  async function countTable(name: string) {
    if (!session?.query) {
      tableRows = tableView?.rows.length ?? 0;
      return;
    }
    try {
      const counted = await session.query(`SELECT count(*) AS n FROM ${quoteTable(name)}`, []);
      tableRows = Number(counted[0]?.['n'] ?? 0);
    } catch {
      // A table the catalogue lists but cannot be counted (a view over a
      // missing relation) should not blank the browser.
      tableRows = tableView?.rows.length ?? 0;
    }
  }

  /** Point the browser at a table: reset its query state and fetch page one. */
  async function openTable(name: string) {
    if (!session) return;
    activeTable = name;
    tableView = canTableMeta
      ? { ...(await session.tableMeta!(name)), rows: [] }
      : await session.tableData(name);
    const fresh = emptyGroup('and');
    browseFilter = fresh;
    browseRows = [];
    browseHasMore = false;
    browseNotes = [];
    browseError = null;
    browseTotal = undefined;
    await countTable(name);
    if (canQuery) {
      // Pass `fresh` rather than reading `browseFilter` back — the grid has not
      // mounted yet, so nothing else would supply the first page.
      await fetchPage({
        search: '',
        filter: fresh,
        sort: null,
        page: 1,
        pageSize: BROWSE_PAGE,
        step: keyColumn ? 'first' : undefined,
        cursor: null,
      });
    } else {
      browseRows = (tableView?.rows ?? []) as DataRow[];
    }
  }

  function scheduleSave(doc: string) {
    clearTimeout(saveTimer);
    const id = active.id;
    saveTimer = setTimeout(() => void store.saveBuffer(id, doc), 600);
  }

  async function refreshViewer(preferred?: string | null) {
    if (!session) return;
    tables = await session.listTables();
    const next = preferred && tables.includes(preferred) ? preferred : (tables[0] ?? null);
    if (next) {
      await openTable(next);
    } else {
      activeTable = null;
      tableView = null;
      browseRows = [];
      tableRows = 0;
    }
  }

  /** Tear down whatever is running and start `engine` from its saved state. */
  async function boot(engine: RuntimeAdapter) {
    const token = ++bootToken;
    clearTimeout(saveTimer);
    session?.destroy();
    session = null;

    booting = true;
    bootError = null;
    sqlError = null;
    saveMsg = null;
    saveError = null;
    pendingLarge = null;
    resultRows = [];
    resultColumns = [];
    ranEmpty = false;
    restoredBanner = false;
    tables = [];
    activeTable = null;
    tableView = null;
    browseFilter = emptyGroup('and');
    browseRows = [];
    browseTotal = undefined;
    browseHasMore = false;
    browseNotes = [];
    browseError = null;
    browseBusy = false;
    tableRows = 0;
    browseToken++;
    canExportBinary = false;
    canQuery = false;
    canDescribe = false;
    canTableMeta = false;

    try {
      const created = await engine.createSession();
      // Unmounted, or overtaken by a later switch — don't leak the worker.
      if (destroyed || token !== bootToken) {
        created.destroy();
        return;
      }
      session = created;
      canExportBinary = !!created.serialize;
      canQuery = !!created.query;
      canDescribe = !!created.execDescribed;
      canTableMeta = !!created.tableMeta;
      await created.reset();

      const saved = await store.load(engine.id);
      if (token !== bootToken) return;
      editor?.setText(saved?.buffer ?? '');
      if (saved?.snapshot) {
        try {
          await created.exec(saved.snapshot);
          restoredBanner = true;
        } catch (err) {
          bootError = `Couldn't restore your saved snapshot: ${message(err)}`;
        }
      }
      await refreshViewer();
    } catch (err) {
      if (token === bootToken) bootError = message(err);
    } finally {
      if (token === bootToken) booting = false;
    }
  }

  const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

  /** Switch engines, flushing the current buffer to its own row first. */
  async function pickEngine(id: string) {
    if (id === activeId || booting) return;
    clearTimeout(saveTimer);
    await store.saveBuffer(active.id, editor?.getText() ?? '');
    activeId = id;
    void putSingleton<Partial<Preferences>>('preferences', { sql_last_engine: id });
    await boot(active);
  }

  async function run() {
    if (!session || !editor) return;
    const doc = editor.getText();
    sqlError = null;
    saveMsg = null;
    restoredBanner = false;
    try {
      if (!doc.trim()) {
        resultRows = [];
        resultColumns = [];
      } else if (canDescribe) {
        const described = await session.execDescribed!(doc);
        resultRows = described.rows;
        resultColumns = described.columns;
      } else {
        resultRows = await session.exec(doc);
        resultColumns = [];
      }
      // A described-but-empty SELECT still has columns, so it renders as an
      // empty GRID. Only a statement with no result set at all gets the
      // "that ran without returning any rows" line.
      ranEmpty = resultRows.length === 0 && resultColumns.length === 0;
      await refreshViewer(activeTable);
    } catch (err) {
      sqlError = message(err);
      ranEmpty = false;
    } finally {
      clearTimeout(saveTimer);
      await store.saveBuffer(active.id, doc);
    }
  }

  async function clearDb() {
    if (!session) return;
    if (
      tables.length > 0 &&
      !confirm('Wipe the database? This clears every table (your saved snapshot is untouched).')
    ) {
      return;
    }
    sqlError = null;
    saveMsg = null;
    resultRows = [];
    resultColumns = [];
    ranEmpty = false;
    restoredBanner = false;
    await session.reset();
    await refreshViewer();
  }

  async function exportAs(dest: 'clipboard' | 'sql' | 'db' | 'json') {
    if (!session) return;
    saveError = null;
    saveMsg = null;
    const scope = includeData ? 'schema + data' : 'schema only';
    try {
      if (dest === 'clipboard') {
        const sql = await session.dump(includeData);
        saveMsg = (await copyText(sql))
          ? `Copied SQL to clipboard (${scope})`
          : 'Copy failed — try downloading instead';
      } else if (dest === 'sql') {
        const sql = await session.dump(includeData);
        downloadText(sql, 'playground.sql', 'application/sql');
        saveMsg = `Downloaded playground.sql (${scope})`;
      } else if (dest === 'db') {
        if (!session.serialize || !binary) throw new Error('This engine cannot export a binary file');
        const bytes = await session.serialize(includeData);
        const filename = `playground${binary.extension}`;
        downloadBlob(new Blob([bytes as BlobPart], { type: binary.mimeType }), filename);
        saveMsg = `Downloaded ${filename} (${scope})`;
      } else {
        if (!session.exportJson) throw new Error('This engine cannot export JSON');
        downloadText(await session.exportJson(includeData), 'playground.json', 'application/json');
        saveMsg = `Downloaded playground.json (${scope})`;
      }
    } catch (err) {
      saveError = message(err);
    }
  }

  function onExportPick(event: Event) {
    const select = event.currentTarget as HTMLSelectElement;
    const dest = select.value as 'clipboard' | 'sql' | 'db' | 'json' | '';
    select.value = '';
    if (dest) void exportAs(dest);
  }

  async function onImportFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow re-picking the same file
    if (!file || !session) return;
    saveError = null;
    saveMsg = null;
    if (
      tables.length > 0 &&
      !confirm('Importing replaces the current database. Your saved snapshot is untouched. Continue?')
    ) {
      return;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      // The engine's own header tells a binary image from a .sql script, so
      // the extension can be wrong without anything breaking.
      if (binary?.looksBinary(bytes)) {
        if (!session.importDb) throw new Error('This engine cannot import a binary database file');
        await session.importDb(bytes);
      } else {
        // A .sql file. Back the database up first so a syntax error part-way
        // through doesn't leave it wiped.
        const backup = await session.dump(true);
        await session.reset();
        try {
          await session.exec(new TextDecoder().decode(bytes));
        } catch (err) {
          await session.reset();
          await session.exec(backup);
          throw err;
        }
      }
      sqlError = null;
      resultRows = [];
      ranEmpty = false;
      restoredBanner = false;
      await refreshViewer();
      saveMsg = `Imported ${file.name}`;
    } catch (err) {
      saveError = message(err);
    }
  }

  async function save() {
    if (!session) return;
    saveError = null;
    saveMsg = null;
    try {
      const sql = await session.dump(true);
      const bytes = new Blob([sql]).size;
      if (bytes > ONE_MB) {
        pendingLarge = { sql, bytes };
        return;
      }
      await store.saveSnapshot(active.id, sql);
      saveMsg = `Snapshot saved · ${formatBytes(bytes)}`;
    } catch (err) {
      saveError = message(err);
    }
  }

  async function saveAnyway() {
    if (!pendingLarge) return;
    const { sql, bytes } = pendingLarge;
    pendingLarge = null;
    try {
      await store.saveSnapshot(active.id, sql);
      saveMsg = `Large snapshot saved · ${formatBytes(bytes)}`;
    } catch (err) {
      saveError = message(err);
    }
  }

  async function forgetSnapshot() {
    saveError = null;
    try {
      await store.saveSnapshot(active.id, null);
      saveMsg = 'Saved snapshot cleared';
    } catch (err) {
      saveError = message(err);
    }
  }

  const showTable = (name: string) => void openTable(name);

  onMount(async () => {
    // Reading the remembered engine writes nothing — page loads must not.
    const prefs = await getSingleton<Preferences>('preferences');
    const remembered = choices.find((e) => e.id === prefs?.sql_last_engine);
    if (remembered) activeId = remembered.id;
    void boot(active);
  });

  onDestroy(() => {
    destroyed = true;
    clearTimeout(saveTimer);
    session?.destroy();
  });

</script>

<div class="page-header">
  <h1>SQL playground</h1>
</div>

<div class="stack">
  <Card title="Engine">
    <div class="stack">
      <div class="row wrap">
        <div class="seg" role="group" aria-label="Database engine">
          {#each choices as engine (engine.id)}
            <button
              type="button"
              class="seg-btn"
              class:on={engine.id === activeId}
              aria-pressed={engine.id === activeId}
              data-testid={'sql-engine-' + engine.id}
              onclick={() => pickEngine(engine.id)}
              disabled={booting}
            >
              {engine.label}
            </button>
          {/each}
        </div>
        <p class="muted small self-end" data-testid="sql-engine-note">{active.blurb}</p>
      </div>
      <Explainer summary="Where does this run, and what is saved?">
        <p>
          The database runs inside this tab, in a Web Worker — nothing is uploaded, and there is no
          server to talk to. It lives in memory, so it is gone when you leave unless you press
          <strong>Save snapshot</strong>, which stores the SQL needed to rebuild it (in this
          browser, alongside the rest of your data, so it rides your backups too).
        </p>
        <p>
          Each engine is downloaded the first time you pick it — SQLite is about a megabyte,
          Postgres a good deal more — and cached for offline use afterwards. Your editor text is
          autosaved per engine.
        </p>
      </Explainer>
    </div>
  </Card>

  {#if bootError}
    <p class="banner error" role="alert" data-testid="sql-boot-error">{bootError}</p>
  {/if}
  {#if restoredBanner}
    <p class="banner good" data-testid="sql-restored">Restored your saved {active.label} snapshot.</p>
  {/if}
  {#if pendingLarge}
    <div class="banner warn" data-testid="sql-large-snapshot">
      <p>
        This snapshot is <strong>{formatBytes(pendingLarge.bytes)}</strong> — over 1 MB. Saving
        works, but it is stored in your browser and re-run on every load, which can be slow.
      </p>
      <div class="row">
        <button class="btn btn-sm btn-primary" data-testid="sql-save-anyway" onclick={saveAnyway}>
          Save anyway
        </button>
        <button class="btn btn-sm" onclick={() => (pendingLarge = null)}>Cancel</button>
      </div>
    </div>
  {/if}
  {#if saveMsg}
    <p class="banner good" aria-live="polite" data-testid="sql-message">{saveMsg}</p>
  {/if}
  {#if saveError}
    <p class="banner error" role="alert" data-testid="sql-save-error">{saveError}</p>
  {/if}

  <Card title="Editor">
    {#snippet actions()}
      <span class="muted small">Ctrl+Enter runs</span>
    {/snippet}
    <SqlEditor bind:this={editor} adapter={active} onDocChange={scheduleSave} onRun={run} />
    <div class="row toolbar">
      <button class="btn btn-primary" data-testid="sql-run" onclick={run} disabled={booting}>
        {booting ? `Starting ${active.label}…` : 'Run'}
      </button>
      <button class="btn" data-testid="sql-save" onclick={save} disabled={booting}>Save snapshot</button>
      <button class="btn" data-testid="sql-forget" onclick={forgetSnapshot} disabled={booting}>
        Clear saved snapshot
      </button>
      <button class="btn btn-danger push" data-testid="sql-clear" onclick={clearDb} disabled={booting}>
        Wipe database
      </button>
    </div>
    {#if sqlError}
      <p class="banner error sql-error" role="alert" data-testid="sql-error">{sqlError}</p>
    {/if}
  </Card>

  <Card title="Transfer">
    <div class="row wrap">
      <div class="seg" role="group" aria-label="Export contents">
        <button
          type="button"
          class="seg-btn"
          class:on={includeData}
          aria-pressed={includeData}
          onclick={() => (includeData = true)}
          disabled={booting}
        >
          Schema + data
        </button>
        <button
          type="button"
          class="seg-btn"
          class:on={!includeData}
          aria-pressed={!includeData}
          onclick={() => (includeData = false)}
          disabled={booting}
        >
          Schema only
        </button>
      </div>
      <button class="btn" data-testid="sql-import" onclick={() => fileInput?.click()} disabled={booting}>
        Import…
      </button>
      <input
        bind:this={fileInput}
        type="file"
        data-testid="sql-file"
        {accept}
        onchange={onImportFile}
        hidden
      />
      <div>
        <label class="visually-hidden" for="sql-export">Export database</label>
        <select id="sql-export" data-testid="sql-export" onchange={onExportPick} disabled={booting}>
          <option value="">Export…</option>
          <option value="clipboard">Copy SQL to clipboard</option>
          <option value="sql">SQL file (.sql)</option>
          {#if canExportBinary && binary}
            <option value="db">{binary.label}</option>
          {/if}
          <option value="json">JSON (.json)</option>
        </select>
      </div>
    </div>
  </Card>

  {#if resultRows.length > 0 || resultColumns.length > 0}
    <Card title="Results">
      {#snippet actions()}
        <span class="muted small" data-testid="sql-result-count">
          {resultRows.length} row{resultRows.length === 1 ? '' : 's'}
        </span>
      {/snippet}
      <!-- Client-side: `exec` already returned every row, so filtering,
           sorting, paging and CSV cost nothing at the protocol level. -->
      <DataTable
        testid="sql-results"
        schema={resultSchema}
        rows={resultRows as DataRow[]}
        pageSize={BROWSE_PAGE}
        pageSizes={[10, 25, 50, 100, 0]}
        exportFilename="query-results"
        empty="No rows matched."
        dense
      />
    </Card>
  {:else if ranEmpty && !sqlError}
    <p class="muted small" data-testid="sql-no-rows">
      That ran without returning any rows (statements like CREATE, INSERT and UPDATE don't).
    </p>
  {/if}

  <Card title="Database">
    {#if booting}
      <p class="muted small">Starting {active.label}…</p>
    {:else if tables.length === 0}
      <p class="muted small" data-testid="sql-no-tables">
        No tables yet. Create one in the editor — for example
        <code>create table notes (id integer primary key, body text);</code>
      </p>
    {:else}
      <div class="stack">
        <div class="row wrap" data-testid="sql-tables">
          {#each tables as name (name)}
            <button
              class="btn btn-sm"
              class:btn-primary={name === activeTable}
              data-testid="sql-table"
              aria-pressed={name === activeTable}
              onclick={() => showTable(name)}
            >
              {name}
            </button>
          {/each}
        </div>
        {#if tableView && activeTable}
          {#if browseError}
            <p class="banner error small" role="alert" data-testid="sql-browse-error">
              {browseError}
            </p>
          {/if}
          {#if browseNotes.length > 0}
            <p class="banner warn small" data-testid="sql-browse-note">
              This page counted rows to skip instead of seeking: {browseNotes.join('; ')}.
            </p>
          {/if}
          {#key browseKey}
            <DataTable
              testid="sql-table-rows"
              schema={browseSchema}
              rows={browseRows}
              bind:filter={browseFilter}
              manual={canQuery}
              pagination={useCursor ? 'cursor' : 'offset'}
              hasMore={browseHasMore}
              totalRows={useCursor ? undefined : browseTotal}
              busy={browseBusy}
              pageSize={BROWSE_PAGE}
              pageSizes={[10, 25, 50, 100]}
              exportFilename={activeTable}
              empty="This table is empty."
              dense
              onQueryChange={(request) => void fetchPage(request)}
            />
          {/key}
          <p class="muted small" data-testid="sql-table-note">
            {tableRows} row{tableRows === 1 ? '' : 's'} in {activeTable}
          </p>
        {/if}
      </div>
    {/if}
  </Card>
</div>

<style>
  .small {
    font-size: var(--font-size-sm);
  }

  .banner {
    border: 1px solid var(--border-strong-color);
    padding: var(--space-2) var(--space-3);
    font-size: var(--font-size-sm);
  }

  .banner.error {
    color: var(--color-danger);
  }

  .banner.good {
    color: var(--color-success);
  }

  .banner.warn {
    color: var(--color-warning);
  }

  .sql-error {
    font-family: var(--font-mono);
    margin-top: var(--space-3);
  }

  .toolbar {
    margin-top: var(--space-3);
    flex-wrap: wrap;
  }

  .toolbar .push {
    margin-left: auto;
  }

  .seg {
    display: inline-flex;
    border: 1px solid var(--border-strong-color);
  }

  .seg-btn {
    border: none;
    background: var(--surface-color);
    color: var(--text-muted-color);
    padding: var(--space-2) var(--space-3);
    font: inherit;
    font-size: var(--font-size-sm);
    font-weight: 600;
    cursor: pointer;
  }

  .seg-btn + .seg-btn {
    border-left: 1px solid var(--border-strong-color);
  }

  .seg-btn.on {
    background: var(--color-primary-soft);
    color: var(--color-primary-strong);
  }

  .seg-btn:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
</style>
