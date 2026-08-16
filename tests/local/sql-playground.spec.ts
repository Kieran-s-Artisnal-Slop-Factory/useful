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
    await expect(page.getByTestId('sql-results')).toContainText('true');

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
