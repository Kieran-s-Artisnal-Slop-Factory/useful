/**
 * Playgrounds — the SQL playground (ported from retoken).
 *
 * The engines are REAL: SQLite (sqlite-wasm) and Postgres (PGlite) both boot
 * in a Web Worker from the production build, so these tests cover the actual
 * worker protocol, not a stub. What is audited on top of "does SQL work" is
 * this app's own contract: opening the page writes nothing, and the workspace
 * (editor buffer + snapshot) is ONE row per engine in `sql_playgrounds`,
 * changed in isolation.
 */
import { readFileSync } from 'node:fs';
import { test, expect } from './helpers/app';
import { assertIsolatedDelta, assertInvariants } from './helpers/oracle';

type P = import('@playwright/test').Page;

/** Replace the editor buffer (CodeMirror is contenteditable, not a textarea). */
async function typeSql(page: P, sql: string) {
  const content = page.locator('.cm-content');
  await content.click();
  await page.keyboard.press('ControlOrMeta+a');
  await content.fill(sql);
}

async function runSql(page: P, sql: string) {
  await typeSql(page, sql);
  await page.getByTestId('sql-run').click();
}

/** Wait for an engine to finish booting (the Run button stops saying so). */
async function ready(page: P) {
  await expect(page.getByTestId('sql-run')).toBeEnabled({ timeout: 120_000 });
  await expect(page.getByTestId('sql-run')).toHaveText('Run', { timeout: 120_000 });
}

test.describe('SQL playground', () => {
  test.slow(); // wasm engines boot from disk, but they are not instant

  test('opening the page writes nothing; running SQL fills the browser', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/sql-playground/');
    await ready(page);
    // A blank workspace is not a row: the page has to be free to open.
    expect(await app.dumpAll()).toEqual(before);
    await expect(page.getByTestId('sql-no-tables')).toBeVisible();

    await runSql(
      page,
      "create table notes (id integer primary key, body text);\n" +
        "insert into notes (body) values ('hello'), ('world');\n" +
        'select * from notes order by id;'
    );

    await expect(page.getByTestId('sql-result-count')).toHaveText('2 rows');
    await expect(page.getByTestId('sql-results')).toContainText('hello');
    await expect(page.getByTestId('sql-results')).toContainText('world');
    // The table browser picked the new table up.
    await expect(page.getByTestId('sql-table')).toHaveCount(1);
    await expect(page.getByTestId('sql-table')).toHaveText('notes');
    await expect(page.getByTestId('sql-table-note')).toContainText('2 rows in notes');

    // Running saves the buffer: exactly one row, in sql_playgrounds, id = engine.
    await expect.poll(async () => (await app.dump('sql_playgrounds')).length).toBe(1);
    const row = (await app.dump('sql_playgrounds'))[0] as Record<string, unknown>;
    expect(row.id).toBe('sqlite');
    expect(row.engine).toBe('sqlite');
    expect(String(row.buffer)).toContain('create table notes');
    expect(row.snapshot).toBeNull();
    assertIsolatedDelta(before, await app.dumpAll(), [{ store: 'sql_playgrounds', id: 'sqlite' }]);
    assertInvariants(await app.dumpAll(), 'after running SQL');
  });

  test('a saved snapshot rebuilds the database on the next visit', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/sql-playground/');
    await ready(page);
    await runSql(page, "create table cats (name text);\ninsert into cats values ('mog');");
    await expect(page.getByTestId('sql-table')).toHaveText('cats');

    await page.getByTestId('sql-save').click();
    await expect(page.getByTestId('sql-message')).toContainText('Snapshot saved');
    const saved = (await app.dump('sql_playgrounds'))[0] as Record<string, unknown>;
    expect(String(saved.snapshot)).toContain('cats');
    expect(saved.snapshot_at).toBeTruthy();

    // The live database is in the worker's memory — only the snapshot survives.
    await page.reload();
    await ready(page);
    await expect(page.getByTestId('sql-restored')).toBeVisible();
    await expect(page.getByTestId('sql-table')).toHaveText('cats');
    await expect(page.getByTestId('sql-table-rows')).toContainText('mog');
    // The buffer came back too.
    await expect(page.locator('.cm-content')).toContainText('create table cats');

    // Clearing the snapshot leaves the row but empties the field.
    await page.getByTestId('sql-forget').click();
    await expect(page.getByTestId('sql-message')).toContainText('Saved snapshot cleared');
    await expect
      .poll(async () => (await app.dump('sql_playgrounds'))[0]!.snapshot)
      .toBeNull();
  });

  test('wiping the database clears the tables but not the saved snapshot', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/sql-playground/');
    await ready(page);
    await runSql(page, 'create table t (a int);');
    await expect(page.getByTestId('sql-table')).toHaveText('t');
    await page.getByTestId('sql-save').click();
    await expect(page.getByTestId('sql-message')).toContainText('Snapshot saved');

    page.once('dialog', (d) => void d.accept());
    await page.getByTestId('sql-clear').click();
    await expect(page.getByTestId('sql-no-tables')).toBeVisible();
    const row = (await app.dump('sql_playgrounds'))[0] as Record<string, unknown>;
    expect(String(row.snapshot).toLowerCase()).toContain('create table');
  });

  test('exports the database as a .sql file', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/sql-playground/');
    await ready(page);
    await runSql(page, "create table t (a int);\ninsert into t values (7);");
    await expect(page.getByTestId('sql-table')).toHaveText('t');

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('sql-export').selectOption('sql');
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('playground.sql');
    const text = readFileSync(await download.path(), 'utf8');
    expect(text).toContain('CREATE TABLE');
    expect(text).toContain('7');
  });

  test('Postgres is a second engine with its own workspace', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/sql-playground/');
    await ready(page);
    await runSql(page, "create table only_in_sqlite (a int);");
    await expect(page.getByTestId('sql-table')).toHaveText('only_in_sqlite');

    await page.getByTestId('sql-engine-pglite').click();
    await ready(page);
    await expect(page.getByTestId('sql-engine-note')).toContainText('PGlite');
    // A fresh, separate database — the SQLite table is not here.
    await expect(page.getByTestId('sql-no-tables')).toBeVisible();

    // Postgres-only SQL proves it really is Postgres, not SQLite relabelled.
    await runSql(page, "select generate_series(1, 3) as n, version() like 'PostgreSQL%' as is_pg;");
    await expect(page.getByTestId('sql-result-count')).toHaveText('3 rows');
    // The grid types its columns, so a Postgres boolean renders as a Yes pill
    // rather than the raw `true` the old markup printed.
    await expect(page.getByTestId('sql-results')).toContainText('Yes');

    // Two workspaces, one per engine, plus the remembered engine preference.
    await expect.poll(async () => (await app.dump('sql_playgrounds')).length).toBe(2);
    const ids = (await app.dump('sql_playgrounds')).map((r) => r.id).sort();
    expect(ids).toEqual(['pglite', 'sqlite']);
    assertIsolatedDelta(before, await app.dumpAll(), [
      { store: 'sql_playgrounds', id: 'sqlite' },
      { store: 'sql_playgrounds', id: 'pglite' },
      { store: 'preferences', id: 'singleton' },
    ]);

    // The choice is remembered for next time.
    await page.reload();
    await ready(page);
    await expect(page.getByTestId('sql-engine-pglite')).toHaveAttribute('aria-pressed', 'true');
  });

  test('a syntax error is reported without losing the database', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/sql-playground/');
    await ready(page);
    await runSql(page, 'create table keep_me (a int);');
    await expect(page.getByTestId('sql-table')).toHaveText('keep_me');

    await runSql(page, 'selct * from keep_me;');
    await expect(page.getByTestId('sql-error')).toBeVisible();
    await expect(page.getByTestId('sql-table')).toHaveText('keep_me');
  });
});

/**
 * The DataTable half of the playground (Phase 7).
 *
 * The browser runs in MANUAL mode: filters, sort and paging compile to SQL and
 * the engine answers them. That means these are not UI tests — a wrong clause
 * shows up as the wrong rows, so every case asserts on the data, not on the
 * controls.
 */
test.describe('SQL playground — grids', () => {
  test.slow();

  /** Build a 30-row table with an integer primary key, and browse it. */
  async function thirtyRows(page: P) {
    await runSql(
      page,
      // Single-quoted literals: this sqlite-wasm build has the double-quoted
      // string fallback off, so "row " would be read as an identifier.
      'create table nums (id integer primary key, label text);\n' +
        'insert into nums (id, label) ' +
        'with recursive c(v) as (select 1 union all select v + 1 from c where v < 30) ' +
        "select v, 'row ' || v from c;"
    );
    await expect(page.getByTestId('sql-table-note')).toHaveText('30 rows in nums');
  }

  test('the browser pages in the engine, filters push down, and nothing is written', async ({
    app,
  }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/sql-playground/');
    await ready(page);
    await thirtyRows(page);

    const grid = page.getByTestId('sql-table-rows');

    // A page, not the whole table: 25 rows plus the header.
    await expect(grid.locator('tbody tr')).toHaveCount(25);
    await expect(grid).toContainText('row 1');
    await expect(grid).not.toContainText('row 26');

    // A single-column primary key means cursor paging, so the range readout
    // says "page N" rather than "1-25 of 30" — counting every match is the
    // full scan the mode exists to avoid.
    await expect(page.getByTestId('sql-table-rows-range')).toContainText('page 1');

    await page.getByTestId('sql-table-rows-next').click();
    await expect(grid).toContainText('row 26');
    await expect(grid).not.toContainText('row 1');
    await expect(grid.locator('tbody tr')).toHaveCount(5);

    await page.getByTestId('sql-table-rows-prev').click();
    await expect(grid).toContainText('row 1');
    await expect(grid).not.toContainText('row 26');

    // Filtering narrows what the ENGINE returns, not what is displayed.
    await page.getByTestId('sql-table-rows-filters').click();
    await page.getByTestId('sql-table-rows-builder-add-condition').click();
    const condition = page.locator('[data-testid^="sql-table-rows-builder-"][data-testid$="-column"]');
    await condition.selectOption('id');
    const operator = page.locator(
      '[data-testid^="sql-table-rows-builder-"][data-testid$="-operator"]'
    );
    await operator.selectOption('gt');
    await page
      .locator('[data-testid^="sql-table-rows-builder-"][data-testid$="-value"]')
      .fill('27');
    await expect(grid.locator('tbody tr')).toHaveCount(3);
    await expect(grid).toContainText('row 28');
    await expect(grid).not.toContainText('row 27');

    // Filtering, sorting and paging are deliberately not persisted, so the
    // only delta is the editor buffer the Run already flushed.
    assertIsolatedDelta(before, await app.dumpAll(), [{ store: 'sql_playgrounds', id: 'sqlite' }]);
    assertInvariants(await app.dumpAll(), 'after browsing');
  });

  test('a NULL in the sort column falls back to OFFSET instead of re-serving page 1', async ({
    app,
  }) => {
    const { page } = app;
    await app.goto('/tools/sql-playground/');
    await ready(page);
    // 25 rows, only the first five named. Sorted ascending under NULLS LAST
    // that is five names followed by twenty NULLs, so the row that ENDS page
    // one has a NULL name — and a keyset cursor has no comparison meaning
    // "after the nulls" to seek with.
    //
    // This is the regression: the seek returned an empty WHERE clause, which
    // is byte-identical to the page-one query, while the pager had already
    // advanced. Next served page one forever.
    await runSql(
      page,
      'create table people (id integer primary key, name text);\n' +
        'insert into people (id, name) ' +
        'with recursive c(v) as (select 1 union all select v + 1 from c where v < 25) ' +
        "select v, case when v <= 5 then 'name ' || v else null end from c;"
    );
    const grid = page.getByTestId('sql-table-rows');
    await expect(page.getByTestId('sql-table-note')).toHaveText('25 rows in people');

    await page.getByTestId('sql-table-rows-page-size').selectOption('10');
    await page.getByTestId('sql-table-rows-sort-name').click();
    await expect(grid.locator('tbody tr')).toHaveCount(10);
    // Ascending with NULLS LAST: the five names lead, then the nulls begin.
    await expect(grid).toContainText('name 1');
    const firstPage = await grid.locator('tbody tr').allInnerTexts();

    await page.getByTestId('sql-table-rows-next').click();
    await expect(grid.locator('tbody tr')).toHaveCount(10);
    const secondPage = await grid.locator('tbody tr').allInnerTexts();
    // The whole point: page two is DIFFERENT rows, not page one again.
    expect(secondPage).not.toEqual(firstPage);
    await expect(grid).not.toContainText('name 1');

    // And the fallback says so rather than pretending it seeked.
    await expect(page.getByTestId('sql-browse-note')).toContainText('counted rows to skip');
  });

  test('a table with no primary key pages by numbered OFFSET', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/sql-playground/');
    await ready(page);
    await runSql(
      page,
      'create table keyless (a int);\n' +
        'insert into keyless (a) select value from (with recursive c(value) as (select 1 union all select value + 1 from c where value < 30) select value from c);'
    );
    // No key column means no total order, so cursor paging is off and the
    // pager can offer real page numbers against a count.
    await expect(page.getByTestId('sql-table-rows-range')).toContainText('of 30');
    await page.getByTestId('sql-table-rows-page-2').click();
    await expect(page.getByTestId('sql-table-rows')).toContainText('26');
  });

  test('the browser exports the visible rows as CSV with a BOM', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/sql-playground/');
    await ready(page);
    await runSql(
      page,
      "create table notes (id integer primary key, body text);\ninsert into notes (body) values ('first'),('second');"
    );
    const download = page.waitForEvent('download');
    await page.getByTestId('sql-table-rows-export').click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('notes.csv');
    const text = readFileSync(await file.path(), 'utf8');
    // The BOM is what makes Excel read the file as UTF-8 rather than as the
    // system codepage.
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain('id,body');
    expect(text).toContain('first');
  });

  test('the results grid filters and pages client-side over rows already in memory', async ({
    app,
  }) => {
    const { page } = app;
    await app.goto('/tools/sql-playground/');
    await ready(page);
    await runSql(
      page,
      'with recursive c(n) as (select 1 union all select n + 1 from c where n < 100) select n from c;'
    );
    // The header count is what the QUERY returned; the grid's own range
    // readout is which window is on screen. They mean different things.
    await expect(page.getByTestId('sql-result-count')).toHaveText('100 rows');
    await expect(page.getByTestId('sql-results-range')).toContainText('of 100');
    await expect(page.getByTestId('sql-results').locator('tbody tr')).toHaveCount(25);
    await page.getByTestId('sql-results-next').click();
    await expect(page.getByTestId('sql-results')).toContainText('26');

    // Searching is local — no engine round trip, and no write.
    await page.getByTestId('sql-results-search').fill('42');
    await expect(page.getByTestId('sql-results').locator('tbody tr')).toHaveCount(1);
  });

  test('a query that returns no rows still gets its headers', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/sql-playground/');
    await ready(page);
    await runSql(page, 'create table t (id integer primary key, name text);');
    // A described-but-empty SELECT is an empty GRID, not the "that ran
    // without returning any rows" line — the columns are known even though
    // no row matched.
    await runSql(page, 'select id, name from t where 1 = 0;');
    await expect(page.getByTestId('sql-results')).toBeVisible();
    await expect(page.getByTestId('sql-results')).toContainText('name');
    await expect(page.getByTestId('sql-results-empty')).toContainText('No rows matched.');
    await expect(page.getByTestId('sql-no-rows')).toBeHidden();

    // A statement with no result set at all still gets the plain-English line.
    await runSql(page, "insert into t (name) values ('x');");
    await expect(page.getByTestId('sql-no-rows')).toBeVisible();
  });
});
