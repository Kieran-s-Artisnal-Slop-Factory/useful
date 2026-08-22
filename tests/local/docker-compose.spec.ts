/**
 * Docker Compose (0.3.0 phases 12 and 13).
 *
 * The one tool in this release that owns a store, so the assertions are the
 * data ones: building writes nothing, saving writes exactly one row in
 * `compose_projects` and touches nothing else, and a reload gets the same
 * project back.
 *
 * The YAML assertions parse the text rather than matching it — indentation is
 * not the contract, the document is.
 */
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { test, expect } from './helpers/app';
import { assertIsolatedDelta } from './helpers/oracle';
import { zipEntries } from '../../src/lib/zip';

type P = import('@playwright/test').Page;

async function downloadBytes(page: P, trigger: () => Promise<void>) {
  const downloadPromise = page.waitForEvent('download');
  await trigger();
  const download = await downloadPromise;
  return { name: download.suggestedFilename(), bytes: readFileSync(await download.path()) };
}

/** The emitted document, parsed. */
async function doc(page: P): Promise<Record<string, any>> {
  return parse(await page.getByTestId('dc-yaml').innerText());
}

/** Open a collapsed card by clicking its summary. */
const openCard = (page: P, testid: string, title: string) =>
  page.getByTestId(testid).getByText(title, { exact: true }).click();

test.describe('docker compose — building', () => {
  test('opens with a project that already emits a valid file, writing nothing', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/docker-compose/');

    const document = await doc(page);
    expect(document.services.web.image).toBe('nginx:1.27-alpine');
    expect(document.services.web.ports).toEqual(['8080:80']);
    await expect(page.getByTestId('dc-findings-clear')).toBeVisible();
    await expect(page.getByTestId('dc-error-count')).toHaveText('No errors');

    // Opening and editing is not saving.
    await page.getByTestId('dc-image-0').fill('caddy:2.9-alpine');
    await expect.poll(async () => (await doc(page)).services.web.image).toBe('caddy:2.9-alpine');
    expect(await app.dumpAll()).toEqual(before);
  });

  test('builds a two-service project through the UI', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/docker-compose/');

    await page.getByTestId('dc-name').fill('shop');
    await page.getByTestId('dc-add-service').click();
    await page.getByTestId('dc-sname-1').fill('db');
    await page.getByTestId('dc-image-1').fill('postgres:17-alpine');
    await page.getByTestId('dc-restart-1').selectOption('always');

    await expect
      .poll(async () => Object.keys((await doc(page)).services))
      .toEqual(['web', 'db']);
    const document = await doc(page);
    expect(document.name).toBe('shop');
    expect(document.services.db).toEqual({ image: 'postgres:17-alpine', restart: 'always' });
  });

  test('disables the ports editor under host networking and says why', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/docker-compose/');
    await page.getByTestId('dc-netmode-0').selectOption('host');

    // The control goes away rather than letting someone write a file that lies.
    await expect(page.getByTestId('dc-ports-disabled-0')).toContainText('does nothing at all');
    await expect(page.getByTestId('dc-add-port-0')).toHaveCount(0);
    await expect(page.getByTestId('dc-findings')).toContainText('do nothing at all');
    expect((await doc(page)).services.web.network_mode).toBe('host');
  });

  test('flags a duplicate host port as an error', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/docker-compose/');
    await page.getByTestId('dc-add-service').click();
    await page.getByTestId('dc-sname-1').fill('api');
    await page.getByTestId('dc-image-1').fill('node:22-alpine');
    await page.getByTestId('dc-add-port-1').click();
    await page.getByTestId('dc-port-published-1-0').fill('8080');
    await page.getByTestId('dc-port-target-1-0').fill('3000');

    await expect(page.getByTestId('dc-findings')).toContainText('Host port 8080/tcp is published by both');
    await expect(page.getByTestId('dc-error-count')).toContainText('1 error');
    await expect(page.getByTestId('dc-badge-api')).toBeVisible();
  });

  test('flags a volume that is mounted but never declared', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/docker-compose/');
    await page.getByTestId('dc-add-mount-0').click();
    await page.getByTestId('dc-mount-source-0-0').fill('pgdata');
    await page.getByTestId('dc-mount-target-0-0').fill('/data');
    await expect(page.getByTestId('dc-findings')).toContainText('never declared');

    // Declaring it clears the error.
    await openCard(page, 'dc-resources-card', 'Networks, volumes, secrets and configs');
    await page.getByTestId('dc-add-volume').click();
    await page.getByTestId('dc-volume-name-0').fill('pgdata');
    await expect(page.getByTestId('dc-error-count')).toHaveText('No errors');
  });

  test('emits the document keys in spec order', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/docker-compose/');
    await openCard(page, 'dc-resources-card', 'Networks, volumes, secrets and configs');
    await page.getByTestId('dc-add-network').click();
    await page.getByTestId('dc-add-volume').click();

    const text = await page.getByTestId('dc-yaml').innerText();
    // The property that makes a re-emit a no-op diff in version control.
    expect(text.indexOf('name:')).toBeLessThan(text.indexOf('services:'));
    expect(text.indexOf('services:')).toBeLessThan(text.indexOf('networks:'));
    expect(text.indexOf('networks:')).toBeLessThan(text.indexOf('volumes:'));
  });
});

test.describe('docker compose — the library', () => {
  test('saving writes exactly one row and nothing else', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/docker-compose/');
    const before = await app.dumpAll();

    await page.getByTestId('dc-name').fill('saved-stack');
    await page.getByTestId('dc-save').click();
    await expect(page.getByTestId('dc-feedback')).toContainText('Project saved');

    const after = await app.dumpAll();
    const rows = after.compose_projects ?? [];
    expect(rows).toHaveLength(1);
    const row = rows[0] as { id: string; name: string };
    expect(row.name).toBe('saved-stack');
    // The collateral-damage check: exactly that row, nothing else in any store.
    assertIsolatedDelta(before, after, [{ store: 'compose_projects', id: row.id }]);
  });

  test('a saved project comes back after a reload', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/docker-compose/');
    await page.getByTestId('dc-name').fill('persisted');
    await page.getByTestId('dc-image-0').fill('redis:7.4-alpine');
    await page.getByTestId('dc-save').click();
    await expect(page.getByTestId('dc-library')).toContainText('persisted');

    await app.goto('/tools/docker-compose/');
    const before = await app.dumpAll();
    await page.getByTestId('dc-open-persisted').click();

    await expect(page.getByTestId('dc-name')).toHaveValue('persisted');
    expect((await doc(page)).services.web.image).toBe('redis:7.4-alpine');
    // Opening a project reads; it must not write.
    expect(await app.dumpAll()).toEqual(before);
  });

  test('editing a saved project updates its row instead of adding one', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/docker-compose/');
    await page.getByTestId('dc-name').fill('one');
    await page.getByTestId('dc-save').click();
    await expect(page.getByTestId('dc-library')).toContainText('one');

    await page.getByTestId('dc-image-0').fill('httpd:2.4');
    await page.getByTestId('dc-save').click();

    const rows = (await app.dumpAll()).compose_projects ?? [];
    expect(rows.filter((r) => !(r as { deleted_at: string | null }).deleted_at)).toHaveLength(1);
  });

  test('delete tombstones the row rather than dropping it', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/docker-compose/');
    await page.getByTestId('dc-name').fill('doomed');
    await page.getByTestId('dc-save').click();
    await expect(page.getByTestId('dc-library')).toContainText('doomed');

    await page.getByTestId('dc-delete-doomed').click();
    // The whole library block goes when the last project does, so the precise
    // assertion is that this project's row is gone — not that a list which no
    // longer exists lacks the text.
    await expect(page.getByTestId('dc-open-doomed')).toHaveCount(0);

    const rows = (await app.dumpAll()).compose_projects ?? [];
    expect(rows).toHaveLength(1);
    expect((rows[0] as { deleted_at: string | null }).deleted_at).not.toBeNull();
  });

  test('exports and re-imports a project as JSON', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/docker-compose/');
    await page.getByTestId('dc-name').fill('portable');

    const file = await downloadBytes(page, () => page.getByTestId('dc-export-json').click());
    expect(file.name).toBe('portable.json');

    await page.getByTestId('dc-new').click();
    await expect(page.getByTestId('dc-name')).toHaveValue('my-project');

    await page.getByTestId('dc-import-json').setInputFiles({
      name: 'portable.json',
      mimeType: 'application/json',
      buffer: file.bytes,
    });
    await expect(page.getByTestId('dc-name')).toHaveValue('portable');
    expect(await app.dumpAll()).toEqual(before);
  });
});

test.describe('docker compose — templates and snippets', () => {
  test('loads a stack, and it is not saved until asked', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/docker-compose/');
    await openCard(page, 'dc-templates-card', 'Start from a template');

    await page.getByTestId('dc-stack-wordpress').click();
    await expect(page.getByTestId('dc-name')).toHaveValue('wordpress');
    await expect(page.getByTestId('dc-service-wordpress')).toBeVisible();
    await expect(page.getByTestId('dc-service-db')).toBeVisible();
    await expect(page.getByTestId('dc-error-count')).toHaveText('No errors');

    const document = await doc(page);
    expect(document.services.wordpress.depends_on.db.condition).toBe('service_healthy');
    expect(document.volumes).toHaveProperty('wp_content');

    expect(await app.dumpAll()).toEqual(before);
  });

  test('injects a snippet into the open project rather than replacing it', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/docker-compose/');
    await openCard(page, 'dc-templates-card', 'Start from a template');

    await page.getByTestId('dc-snippet-postgres').click();
    await expect(page.getByTestId('dc-feedback')).toContainText('Added "db"');
    await expect(page.getByTestId('dc-service-web')).toBeVisible();
    await expect(page.getByTestId('dc-service-db')).toBeVisible();
    // The volume the snippet mounts is declared with it, or the file would
    // fail validation the moment it landed.
    await expect(page.getByTestId('dc-feedback')).toContainText('pg_data');
    await expect(page.getByTestId('dc-error-count')).toHaveText('No errors');

    // A second one is renamed, not silently merged over the first.
    await page.getByTestId('dc-snippet-postgres').click();
    await expect(page.getByTestId('dc-service-db-2')).toBeVisible();
  });

  test('moves a host port that is already taken, and says so', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/docker-compose/');
    await openCard(page, 'dc-templates-card', 'Start from a template');

    // The starter publishes 8080 and the Go snippet wants it.
    await page.getByTestId('dc-snippet-go-stdlib').click();
    await expect(page.getByTestId('dc-feedback')).toContainText('moved host port 8080 to 8081');
    await expect(page.getByTestId('dc-error-count')).toHaveText('No errors');
  });

  test('downloads a template as a runnable archive', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/docker-compose/');
    await openCard(page, 'dc-templates-card', 'Start from a template');

    const archive = await downloadBytes(page, () => page.getByTestId('dc-zip-flask').click());
    expect(archive.name).toBe('flask-compose.zip');

    const entries = zipEntries(new Uint8Array(archive.bytes));
    const names = entries.map((e) => e.name);
    expect(names[0]).toBe('compose.yaml');
    expect(names).toContain('README.md');
    expect(names).toContain('app/app.py');
    expect(names).toContain('app/requirements.txt');

    const decode = (name: string) => new TextDecoder().decode(entries.find((e) => e.name === name)!.data);
    expect(parse(decode('compose.yaml')).services.web.image).toBe('python:3.13-slim');
    expect(decode('README.md')).toContain('**Tags move.**');
    expect(decode('app/app.py')).toContain('Flask');

    expect(await app.dumpAll()).toEqual(before);
  });
});

test.describe('docker compose — importing an existing file', () => {
  test('reads what it can and LISTS what it cannot', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/docker-compose/');
    await openCard(page, 'dc-import-card', 'Import an existing compose file');

    await page.getByTestId('dc-import-text').fill(
      [
        'version: "3.8"',
        'services:',
        '  web:',
        '    image: nginx:1.27',
        '    ports: ["8080:80"]',
        '    build: ./web',
        '    labels:',
        '      team: platform',
      ].join('\n')
    );
    await page.getByTestId('dc-import-run').click();

    const report = page.getByTestId('dc-import-report');
    await expect(report).toContainText('1 service read');
    await expect(report).toContainText('2 keys could not be represented');
    await expect(report).toContainText('services.web.build');
    await expect(report).toContainText('services.web.labels');
    await expect(report).toContainText('obsolete');

    // Nothing is replaced until it is accepted.
    await expect(page.getByTestId('dc-name')).toHaveValue('my-project');
    await page.getByTestId('dc-import-accept').click();
    await expect(page.getByTestId('dc-service-web')).toBeVisible();
    expect((await doc(page)).services.web.ports).toEqual(['8080:80']);

    expect(await app.dumpAll()).toEqual(before);
  });

  test('refuses something that is not a compose file, with a reason', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/docker-compose/');
    await openCard(page, 'dc-import-card', 'Import an existing compose file');

    await page.getByTestId('dc-import-text').fill('- just\n- a list');
    await page.getByTestId('dc-import-run').click();
    await expect(page.getByTestId('dc-import-error')).toContainText('mapping of top-level keys');

    await page.getByTestId('dc-import-text').fill('key: [unclosed');
    await page.getByTestId('dc-import-run').click();
    await expect(page.getByTestId('dc-import-error')).toContainText('not valid YAML');
  });

  test('says the store rides the backup, where someone can act on it', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/docker-compose/');
    await expect(page.getByTestId('dc-secrets-note')).toContainText('can contain secrets');
    await expect(page.getByTestId('dc-secrets-note')).toContainText('backup');
  });
});
