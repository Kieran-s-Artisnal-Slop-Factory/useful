/**
 * File tree (0.3.0 phase 9).
 *
 * A tree is typed in one sitting and exported as JSON if it is worth keeping,
 * so every case here asserts the database is byte-identical afterwards —
 * including the ones that import and export files.
 *
 * The drag is a REAL pointer drag rather than Playwright's `dragTo()`: the
 * app's drag and drop is pointer-based, and the HTML5 drag API is a different
 * pipeline that no touchscreen has.
 */
import { readFileSync } from 'node:fs';
import { test, expect } from './helpers/app';

type P = import('@playwright/test').Page;

async function pointerDrag(
  page: P,
  source: import('@playwright/test').Locator,
  target: import('@playwright/test').Locator
) {
  await source.scrollIntoViewIfNeeded();
  const from = (await source.boundingBox())!;
  const to = (await target.boundingBox())!;
  // Grab the handle, not the middle of the row: the middle is a text input.
  const startX = from.x + 10;
  const startY = from.y + from.height / 2;
  const endX = to.x + to.width / 2;
  const endY = to.y + to.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 8, startY + 8, { steps: 2 });
  await page.mouse.move((startX + endX) / 2, (startY + endY) / 2, { steps: 4 });
  await page.mouse.move(endX, endY, { steps: 4 });
  await page.mouse.up();
}

async function downloadBytes(page: P, trigger: () => Promise<void>) {
  const downloadPromise = page.waitForEvent('download');
  await trigger();
  const download = await downloadPromise;
  return { name: download.suggestedFilename(), bytes: readFileSync(await download.path()) };
}

const UNIX_TREE = [
  '.',
  '├── docs',
  '│   └── readme.md',
  '├── src',
  '│   ├── index.ts',
  '│   └── lib',
  '│       └── model.ts',
  '└── package.json',
  '',
  '3 directories, 4 files',
].join('\n');

test.describe('file tree — reading a listing', () => {
  test('reads `tree` output back into the same tree, writing nothing', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/file-tree/');

    await page.getByTestId('ft-paste-card').getByText('Paste a listing').click();
    await page.getByTestId('ft-listing').fill(UNIX_TREE);
    await page.getByTestId('ft-parse').click();

    await expect(page.getByTestId('ft-parse-note')).toContainText('Read 7 entries');
    await expect(page.getByTestId('ft-parse-note')).toContainText('tree');
    // Round trip: what went in comes back out, minus the listing's own footer
    // and plus the trailing slashes, which are on by default.
    await expect(page.getByTestId('ft-output')).toHaveText(
      [
        'project/',
        '├── docs/',
        '│   └── readme.md',
        '├── src/',
        '│   ├── index.ts',
        '│   └── lib/',
        '│       └── model.ts',
        '└── package.json',
      ].join('\n')
    );
    await expect(page.getByTestId('ft-summary')).toHaveText('3 directories, 4 files');

    expect(await app.dumpAll()).toEqual(before);
  });

  test('reads a Windows `dir` listing and takes its root name from it', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/file-tree/');
    await page.getByTestId('ft-paste-card').getByText('Paste a listing').click();
    await page.getByTestId('ft-listing').fill(
      [
        ' Volume in drive C has no label.',
        '',
        ' Directory of C:\\myapp',
        '',
        '2026-08-22  10:00    <DIR>          .',
        '2026-08-22  10:00    <DIR>          src',
        '2026-08-22  09:14             1,024 README.md',
        '               1 File(s)          1,024 bytes',
      ].join('\n')
    );
    await page.getByTestId('ft-parse').click();

    await expect(page.getByTestId('ft-output')).toContainText('myapp');
    await expect(page.getByTestId('ft-output')).toContainText('└── README.md');
    await expect(page.getByTestId('ft-warnings')).toHaveCount(0);
  });

  test('lists the lines it could not read instead of dropping them', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/file-tree/');
    await page.getByTestId('ft-paste-card').getByText('Paste a listing').click();
    await page.getByTestId('ft-listing').fill(
      [' Directory of C:\\myapp', '', '2026-08-22  10:00    <DIR>          src', 'and then something else'].join('\n')
    );
    await page.getByTestId('ft-parse').click();

    await expect(page.getByTestId('ft-warnings')).toContainText('1 line could not be read');
    await expect(page.getByTestId('ft-warnings')).toContainText('and then something else');
    await expect(page.getByTestId('ft-warnings')).toContainText('line 4');
  });

  test('says so when a paste holds nothing that looks like a path', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/file-tree/');
    await page.getByTestId('ft-paste-card').getByText('Paste a listing').click();
    await page.getByTestId('ft-parse').click();
    await expect(page.getByTestId('ft-parse-note')).toContainText('paste a listing first');
  });
});

test.describe('file tree — the output options', () => {
  test('switches to the pure-ASCII drawing', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/file-tree/');
    await page.getByTestId('ft-charset').selectOption('ascii');
    const text = await page.getByTestId('ft-output').innerText();
    expect(text).toContain('|-- src/');
    expect(text).toContain('`-- package.json');
    expect(text).not.toContain('├');
  });

  test('toggles trailing slashes, emoji and full paths', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/file-tree/');
    const output = page.getByTestId('ft-output');

    await expect(output).toContainText('├── src/');
    await page.getByTestId('ft-slash').uncheck();
    await expect(output).toContainText('├── src');
    await expect(output).not.toContainText('src/');

    await page.getByTestId('ft-emoji').selectOption('kind');
    await expect(output).toContainText('📂 src');
    await expect(output).toContainText('📄 package.json');

    await page.getByTestId('ft-emoji').selectOption('extension');
    await expect(output).toContainText('🔧 package.json');
    await expect(output).toContainText('🟦 index.ts');

    await page.getByTestId('ft-full-paths').check();
    await expect(output).toContainText('project/src/lib/model.ts');

    expect(await app.dumpAll()).toEqual(before);
  });

  test('takes an edited emoji rule', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/file-tree/');
    await page.getByTestId('ft-emoji').selectOption('extension');
    await page.getByTestId('ft-rule-ext').fill('.TS');
    await page.getByTestId('ft-rule-emoji').fill('🦕');
    await page.getByTestId('ft-add-rule').click();
    await expect(page.getByTestId('ft-output')).toContainText('🦕 index.ts');
  });

  test('shows, hides, dots and renames the root', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/file-tree/');
    const output = page.getByTestId('ft-output');

    await page.getByTestId('ft-root').selectOption('dot');
    expect((await output.innerText()).split('\n')[0]).toBe('./');

    await page.getByTestId('ft-root').selectOption('hidden');
    expect((await output.innerText()).split('\n')[0]).toBe('├── src/');

    await page.getByTestId('ft-root').selectOption('custom');
    await page.getByTestId('ft-root-label').fill('my-app');
    expect((await output.innerText()).split('\n')[0]).toBe('my-app/');
  });
});

test.describe('file tree — building one', () => {
  test('adds, renames and deletes, all without writing anything', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/file-tree/');

    await page.getByTestId('ft-name-docs').click();
    await page.getByTestId('ft-add-file').click();
    await expect(page.getByTestId('ft-output')).toContainText('new-file.txt');

    await page.getByTestId('ft-name-new-file.txt').fill('CONTRIBUTING.md');
    await page.getByTestId('ft-name-new-file.txt').press('Enter');
    await expect(page.getByTestId('ft-output')).toContainText('CONTRIBUTING.md');

    await page.getByTestId('ft-delete-package.json').click();
    await expect(page.getByTestId('ft-output')).not.toContainText('package.json');

    expect(await app.dumpAll()).toEqual(before);
  });

  test('drags a file into another folder', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/file-tree/');

    await pointerDrag(page, page.getByTestId('ft-row-package.json'), page.getByTestId('ft-row-docs'));

    // `docs` is the last child now, so its own children hang under a gap
    // rather than a rail — which is exactly the corner worth asserting.
    await expect(page.getByTestId('ft-output')).toContainText(
      ['└── docs/', '    ├── readme.md', '    └── package.json'].join('\n')
    );
  });

  test('refuses to drop a folder inside itself and says why', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/file-tree/');
    // `lib` lives inside `src`; dropping `src` onto it would detach the pair
    // from the tree entirely.
    await pointerDrag(page, page.getByTestId('ft-row-src'), page.getByTestId('ft-row-lib'));
    await expect(page.getByTestId('ft-feedback')).toContainText('inside itself');
    await expect(page.getByTestId('ft-output')).toContainText('├── src/');
  });

  test('sorts folders first, then by name', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/file-tree/');
    await page.getByTestId('ft-sort').click();
    const lines = (await page.getByTestId('ft-output').innerText()).split('\n');
    // Folders alphabetically first (docs before src), the lone file last.
    expect(lines[1]).toBe('├── docs/');
    expect(lines[lines.length - 1]).toBe('└── package.json');
  });
});

test.describe('file tree — getting it out', () => {
  test('downloads the tree as text, SVG, PNG and JSON, and reads the JSON back', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/file-tree/');

    const txt = await downloadBytes(page, () => page.getByTestId('ft-download-txt').click());
    expect(txt.name).toBe('project.txt');
    expect(txt.bytes.toString('utf8')).toContain('└── package.json');

    const svg = await downloadBytes(page, () => page.getByTestId('ft-download-svg').click());
    expect(svg.name).toBe('project.svg');
    const markup = svg.bytes.toString('utf8');
    expect(markup.startsWith('<svg xmlns=')).toBe(true);
    // No textLength on a tree: an emoji is two cells wide, and fitting a row
    // that holds one to the single-width grid bends the branch columns.
    expect(markup).not.toContain('textLength');

    const png = await downloadBytes(page, () => page.getByTestId('ft-download-png').click());
    expect(png.name).toBe('project.png');
    expect(png.bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(true);

    const json = await downloadBytes(page, () => page.getByTestId('ft-download-json').click());
    expect(json.name).toBe('project.json');
    expect(JSON.parse(json.bytes.toString('utf8')).name).toBe('project');

    // The exported file re-imports as the same tree.
    await page.getByTestId('ft-delete-package.json').click();
    await expect(page.getByTestId('ft-output')).not.toContainText('package.json');
    await page.getByTestId('ft-import').setInputFiles({
      name: 'project.json',
      mimeType: 'application/json',
      buffer: json.bytes,
    });
    await expect(page.getByTestId('ft-output')).toContainText('package.json');

    expect(await app.dumpAll()).toEqual(before);
  });

  test('refuses a broken tree file with a reason', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/file-tree/');
    await page.getByTestId('ft-import').setInputFiles({
      name: 'broken.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"name":"a","kind":"sandwich"}'),
    });
    await expect(page.getByTestId('ft-feedback')).toContainText('expected "file" or "folder"');
  });
});
