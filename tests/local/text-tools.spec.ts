/**
 * Version 0.3.0 text tools — Diff (phase 1), Similarity (phase 2) and Text
 * analysis (phase 3).
 *
 * All three are stateless, so the standing assertion on every one of them is
 * that using the page writes NOTHING: `dumpAll()` before, `dumpAll()` after,
 * byte-identical. What is checked beyond that is the arithmetic the page
 * claims — the counts, the alignment, the patch — because the unit tests own
 * the algorithms and these own the wiring between them and the screen.
 */
import { test, expect } from './helpers/app';

const LEFT = 'one\ntwo\nthree\nfour\nfive\n';
const RIGHT = 'one\n2\nthree\nfour\nfive\nsix\n';

const clipboard = (page: import('@playwright/test').Page) =>
  page.evaluate(() => navigator.clipboard.readText());

test.describe('diff', () => {
  test('lines up two texts, and comparing writes nothing', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/diff/');

    // Nothing typed yet: an empty state rather than an empty table.
    await expect(page.getByTestId('diff-empty')).toBeVisible();

    await page.getByTestId('diff-left').fill(LEFT);
    await page.getByTestId('diff-right').fill(RIGHT);

    await expect(page.getByTestId('diff-insertions')).toHaveText('+1');
    await expect(page.getByTestId('diff-deletions')).toHaveText('−0');
    await expect(page.getByTestId('diff-changed')).toHaveText('1 changed line');

    // Six rows: five paired lines plus the added one.
    const rows = page.getByTestId('diff-row');
    await expect(rows).toHaveCount(6);
    await expect(rows.nth(1)).toHaveAttribute('data-kind', 'replace');
    await expect(rows.nth(5)).toHaveAttribute('data-kind', 'insert');

    // The changed row shows the changed WORD, not just a changed line.
    await expect(rows.nth(1).locator('del')).toHaveText('two');
    await expect(rows.nth(1).locator('ins')).toHaveText('2');

    expect(await app.dumpAll()).toEqual(before);
  });

  test('the options change what counts as different, never what is shown', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/diff/');

    await page.getByTestId('diff-left').fill('  Hello World  \n');
    await page.getByTestId('diff-right').fill('hello world\n');
    await expect(page.getByTestId('diff-row').first()).toHaveAttribute('data-kind', 'replace');

    await page.getByTestId('diff-ignore-case').check();
    await page.getByTestId('diff-whitespace').selectOption('edges');
    const row = page.getByTestId('diff-row').first();
    await expect(row).toHaveAttribute('data-kind', 'equal');
    // The original spacing is still on screen — normalization is for comparing.
    await expect(row.locator('td').nth(1)).toHaveText('Hello World');

    expect(await app.dumpAll()).toEqual(before);
  });

  test('word and character modes diff prose as one stream', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/diff/');

    await page.getByTestId('diff-left').fill('the quick brown fox');
    await page.getByTestId('diff-right').fill('the quick red fox');

    await page.getByTestId('diff-granularity').selectOption('word');
    const flow = page.getByTestId('diff-flow');
    await expect(flow.locator('del')).toHaveText('brown');
    await expect(flow.locator('ins')).toHaveText('red');
    await expect(page.getByTestId('diff-insertions')).toHaveText('+1');

    await page.getByTestId('diff-granularity').selectOption('character');
    await expect(page.getByTestId('diff-flow')).toBeVisible();

    expect(await app.dumpAll()).toEqual(before);
  });

  test('two loaded files that differ only in line endings say so', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/diff/');

    // CRLF can only arrive from a file: an HTML textarea normalises its value
    // to LF, so no amount of typing can produce the difference this note is
    // about. Loading is how it happens in life, and how it is tested.
    await page.getByTestId('diff-left-file').setInputFiles({
      name: 'unix.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('a\nb\n'),
    });
    await page.getByTestId('diff-right-file').setInputFiles({
      name: 'windows.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('a\r\nb\r\n'),
    });

    await expect(page.getByTestId('diff-ending-note')).toContainText('only in their line endings');
    await expect(page.getByTestId('diff-ending-note')).toContainText('LF');
    await expect(page.getByTestId('diff-ending-note')).toContainText('CRLF');
  });

  test('a binary file is refused by name', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/diff/');
    await page.getByTestId('diff-left-file').setInputFiles({
      name: 'photo.png',
      mimeType: 'image/png',
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00]),
    });
    await expect(page.getByTestId('diff-file-error')).toContainText('photo.png');
    await expect(page.getByTestId('diff-left')).toHaveValue('');
  });

  test('the patch is a real unified diff, and copies', async ({ app }) => {
    const { page } = app;
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const before = await app.dumpAll();
    await app.goto('/tools/diff/');

    await page.getByTestId('diff-left').fill(LEFT);
    await page.getByTestId('diff-right').fill(RIGHT);

    const patch = page.getByTestId('diff-patch');
    await expect(patch).toContainText('@@ -1,5 +1,6 @@');
    await expect(patch).toContainText('-two');
    await expect(patch).toContainText('+2');

    // Fewer context lines means more hunks, and the header line counts move.
    await page.getByTestId('diff-context').fill('1');
    await expect(patch).toContainText('@@ -5 +5,2 @@');

    await page.getByTestId('diff-copy').click();
    await expect(page.getByTestId('diff-copy')).toHaveText('Copied');
    expect(await clipboard(page)).toContain('--- original');

    expect(await app.dumpAll()).toEqual(before);
  });

  test('swap and clear do what they say', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/diff/');
    await page.getByTestId('diff-left').fill('left side');
    await page.getByTestId('diff-right').fill('right side');

    await page.getByTestId('diff-swap').click();
    await expect(page.getByTestId('diff-left')).toHaveValue('right side');
    await expect(page.getByTestId('diff-right')).toHaveValue('left side');

    await page.getByTestId('diff-clear').click();
    await expect(page.getByTestId('diff-left')).toHaveValue('');
    await expect(page.getByTestId('diff-empty')).toBeVisible();
  });

  test('identical texts are called identical', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/diff/');
    await page.getByTestId('diff-left').fill(LEFT);
    await page.getByTestId('diff-right').fill(LEFT);
    await expect(page.getByTestId('diff-summary')).toContainText('identical');
  });
});
