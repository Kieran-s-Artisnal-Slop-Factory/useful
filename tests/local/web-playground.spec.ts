/**
 * Phase 2 (Web playground) — HTML/CSS/JS(TS) with a live sandboxed preview.
 *
 * Two things are worth proving here beyond "does it work". First, the app's
 * own contract: a scratch session writes NOTHING until Save names it, and Save
 * is exactly one row. Second, the sandbox: the preview runs with no origin, so
 * it cannot reach this app's storage, and the console strip is fed by
 * `postMessage` from a frame that is identified by its source rather than by
 * an origin string (an opaque origin arrives as "null" and proves nothing).
 */
import { readFileSync } from 'node:fs';
import { test, expect } from './helpers/app';
import { assertIsolatedDelta } from './helpers/oracle';
import { zipEntries } from '../../src/lib/zip';

type P = import('@playwright/test').Page;

const PANE = { html: 'wp-pane-html', css: 'wp-pane-css', script: 'wp-pane-script' } as const;

/** Replace a tab's buffer. CodeMirror is contenteditable, not a textarea. */
async function typeInto(page: P, tab: keyof typeof PANE, text: string) {
  await page.getByTestId(`wp-tab-${tab}`).click();
  const content = page.getByTestId(PANE[tab]).locator('.cm-content');
  await content.click();
  await page.keyboard.press('ControlOrMeta+a');
  await content.fill(text);
}

/** The document currently handed to the preview frame. */
function previewDoc(page: P): Promise<string> {
  return page
    .locator('iframe[title="Web playground preview"]')
    .evaluate((el) => (el as HTMLIFrameElement).srcdoc);
}

const consoleLines = (page: P) => page.getByTestId('wp-console-line');

test.describe('web playground', () => {
  test.slow(); // three CodeMirror editors and a live iframe per case

  test('typing reaches the preview, and a scratch session writes NOTHING', async ({ app }) => {
    const { page } = app;
    // Snapshot BEFORE navigating, so loading the page is inside the window.
    const before = await app.dumpAll();
    await app.goto('/tools/web-playground/');

    // The starter document renders through the sandboxed frame.
    const preview = page.frameLocator('iframe[title="Web playground preview"]');
    await expect(preview.locator('h1')).toHaveText('Hello');

    await typeInto(page, 'html', '<h1>Rewritten</h1>');
    await expect(preview.locator('h1')).toHaveText('Rewritten');

    await typeInto(page, 'css', 'h1 { color: rgb(0, 128, 0) }');
    await expect(preview.locator('h1')).toHaveCSS('color', 'rgb(0, 128, 0)');

    // Every tab keeps its own buffer while the others are hidden.
    await page.getByTestId('wp-tab-html').click();
    await expect(page.getByTestId(PANE.html).locator('.cm-content')).toContainText('Rewritten');

    expect(await app.dumpAll(), 'a scratch session wrote to the database').toEqual(before);
  });

  test('console output, uncaught errors and rejections all reach the strip', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/web-playground/');
    await expect(page.getByTestId('wp-console-empty')).toBeVisible();
    const before = await app.dumpAll();

    await typeInto(page, 'script', "console.log('hello', { a: 1 });\nconsole.warn('careful');\n");
    await expect(consoleLines(page)).toHaveCount(2, { timeout: 15_000 });
    await expect(consoleLines(page).first()).toContainText('hello {"a":1}');
    await expect(consoleLines(page).nth(1)).toHaveAttribute('data-level', 'warn');

    // An uncaught error is reported, not swallowed.
    await typeInto(page, 'script', 'notAFunction();\n');
    await expect(consoleLines(page).first()).toContainText('notAFunction is not defined');
    await expect(consoleLines(page).first()).toHaveAttribute('data-level', 'error');

    // So is an unhandled rejection. Rejected with an Error rather than a bare
    // string on purpose: a string reason carries no stack, so the fixture
    // cannot tell it came from the preview frame and would count it against
    // the app. The shim's handling of a bare-string reason is covered where it
    // belongs, in document.test.ts, which runs the shim against stand-ins.
    await typeInto(page, 'script', "Promise.reject(new Error('nope'));\n");
    await expect(consoleLines(page).first()).toContainText('Unhandled rejection: Error: nope');

    // Clearing empties the strip without touching the preview.
    await page.getByTestId('wp-console-clear').click();
    await expect(page.getByTestId('wp-console-empty')).toBeVisible();

    expect(await app.dumpAll()).toEqual(before);
  });

  test('the preview has no origin, so it cannot reach this app', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/web-playground/');

    const frame = page.locator('iframe[title="Web playground preview"]');
    await expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
    // allow-same-origin alongside allow-scripts would let the framed document
    // remove its own sandbox. It must never appear.
    expect(await frame.getAttribute('sandbox')).not.toContain('allow-same-origin');

    // Prove it from the inside. An opaque origin reads "null", and that is the
    // same fact that stops the frame reaching this app's IndexedDB. Reading
    // `location.origin` does not throw, so the assertion is about the sandbox
    // rather than about the frame's error handling; the storage APIs are
    // unreachable as a consequence of it, not as a separate rule.
    await typeInto(page, 'script', "console.log('origin', String(location.origin));\n");
    await expect(consoleLines(page).first()).toContainText('origin null');
  });

  test('Save writes exactly one row; reload reopens it writing nothing', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/web-playground/');
    await expect(page.getByTestId('wp-library-empty')).toBeVisible();

    await typeInto(page, 'html', '<p>saved markup</p>');
    await typeInto(page, 'css', 'p { color: red }');
    await typeInto(page, 'script', "console.log('saved script');");

    const before = await app.dumpAll();
    await page.getByTestId('wp-name').fill('My session');
    await page.getByTestId('wp-save').click();
    await expect(page.getByTestId('wp-session')).toHaveCount(1);

    const rows = await app.dump('web_playgrounds');
    expect(rows).toHaveLength(1);
    const row = rows[0] as Record<string, string>;
    expect(row.name).toBe('My session');
    expect(row.html).toBe('<p>saved markup</p>');
    expect(row.css).toBe('p { color: red }');
    expect(row.script).toBe("console.log('saved script');");
    expect(row.lang).toBe('js');

    // The session row and the remembered id, and nothing else.
    const after = await app.dumpAll();
    assertIsolatedDelta(before, after, [
      { store: 'web_playgrounds', id: row.id! },
      { store: 'preferences', id: 'singleton' },
    ]);

    // Reload: the session comes back, and opening it writes nothing.
    const beforeReload = await app.dumpAll();
    await app.goto('/tools/web-playground/');
    await expect(page.getByTestId('wp-name')).toHaveValue('My session');
    await expect(page.getByTestId(PANE.html).locator('.cm-content')).toContainText('saved markup');
    await expect(page.frameLocator('iframe[title="Web playground preview"]').locator('p')).toHaveText(
      'saved markup'
    );
    expect(await app.dumpAll(), 'reopening a session wrote to the database').toEqual(beforeReload);

    // Editing and saving again updates the row rather than adding one.
    await typeInto(page, 'html', '<p>edited</p>');
    await page.getByTestId('wp-save').click();
    await expect.poll(async () => (await app.dump('web_playgrounds')).length).toBe(1);
    expect((await app.get('web_playgrounds', row.id!))!.html).toBe('<p>edited</p>');

    // Delete is a tombstone and the library empties.
    page.once('dialog', (d) => void d.accept());
    await page.getByTestId('wp-delete').click();
    await expect(page.getByTestId('wp-library-empty')).toBeVisible();
    const deleted = (await app.get('web_playgrounds', row.id!))!;
    expect(deleted.deleted_at).not.toBeNull();
  });

  test('exports the three buffers as a zip that reads back', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/web-playground/');
    const before = await app.dumpAll();

    await typeInto(page, 'html', '<h1>Zipped</h1>');
    await typeInto(page, 'css', 'h1 { font-size: 3rem }');
    await typeInto(page, 'script', "console.log('zip');");
    await page.getByTestId('wp-name').fill('Export me');

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('wp-export').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('export-me.zip');

    const entries = zipEntries(new Uint8Array(readFileSync(await download.path())));
    const decode = (name: string) =>
      new TextDecoder().decode(entries.find((e) => e.name === name)!.data);
    expect(entries.map((e) => e.name)).toEqual(['index.html', 'style.css', 'script.js']);
    expect(decode('style.css')).toBe('h1 { font-size: 3rem }');
    expect(decode('script.js')).toBe("console.log('zip');");
    const index = decode('index.html');
    expect(index).toContain('<h1>Zipped</h1>');
    expect(index).toContain('href="style.css"');
    expect(index).toContain('src="script.js"');

    // Exporting is not saving.
    expect(await app.dumpAll()).toEqual(before);
  });

  test('TypeScript is stripped, never checked, and sucrase arrives only when asked', async ({
    app,
  }) => {
    const { page } = app;
    await app.goto('/tools/web-playground/');

    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));

    // A JavaScript session never pays for the stripper.
    await typeInto(page, 'script', "console.log('plain js');");
    await expect(consoleLines(page).first()).toContainText('plain js');
    expect(requests.filter((u) => /sucrase/i.test(u)), 'sucrase loaded for a JS session').toEqual(
      []
    );
    await expect(page.getByTestId('wp-ts-note')).toHaveCount(0);

    await page.getByTestId('wp-lang').selectOption('ts');
    await expect(page.getByTestId('wp-tab-script')).toHaveText('script.ts');
    await expect(page.getByTestId('wp-ts-note')).toContainText('stripped, not checked');

    await typeInto(page, 'script', "const who: string = 'typed';\nconsole.log(who);\n");
    await expect(consoleLines(page).first()).toContainText('typed');
    await expect.poll(() => previewDoc(page)).not.toContain(': string');
    // And it really did arrive over the network on the switch. The chunk is
    // named in astro.config.mjs precisely so this can be asserted — Rollup
    // would otherwise call it `esm.<hash>.js` and both halves of this test
    // would pass without meaning anything.
    await expect
      .poll(() => requests.filter((u) => /sucrase/i.test(u)).length)
      .toBeGreaterThan(0);

    // A wrong type is NOT an error — the page says so, and this proves it.
    await typeInto(page, 'script', "const n: number = 'not a number';\nconsole.log(n);\n");
    await expect(consoleLines(page).first()).toContainText('not a number');
    await expect(page.getByTestId('wp-ts-error')).toHaveCount(0);

    // A syntax error is shown and the last good preview stays up.
    const lastGood = await previewDoc(page);
    await typeInto(page, 'script', 'const broken: = ;;;\n');
    await expect(page.getByTestId('wp-ts-error')).toBeVisible();
    expect(await previewDoc(page), 'the preview was blanked by a syntax error').toBe(lastGood);
  });

  test('the layout control shows the editor, the preview, or both', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/web-playground/');
    const before = await app.dumpAll();
    const previewFrame = page.locator('iframe[title="Web playground preview"]');

    // Split is the default: both panels, two columns.
    await expect(page.getByTestId('wp-layout-split')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId(PANE.html)).toBeVisible();
    await expect(previewFrame).toHaveCount(1);

    // Editor only — the preview is gone, and so is the console with it.
    await page.getByTestId('wp-layout-editor').click();
    await expect(page.getByTestId(PANE.html)).toBeVisible();
    await expect(previewFrame).toHaveCount(0);
    await expect(page.getByTestId('wp-console')).toHaveCount(0);

    // Preview only — the editor is collapsed, the console stays.
    await page.getByTestId('wp-layout-preview').click();
    await expect(page.getByTestId(PANE.html)).toHaveCount(0);
    await expect(previewFrame).toHaveCount(1);
    await expect(page.getByTestId('wp-console')).toBeVisible();

    // The buffers survive the round trip, and the preview is rebuilt from them.
    await page.getByTestId('wp-layout-split').click();
    await expect(page.getByTestId(PANE.html).locator('.cm-content')).toContainText('Hello');
    await expect(
      page.frameLocator('iframe[title="Web playground preview"]').locator('h1')
    ).toHaveText('Hello');

    // Changing layout is view state — it writes nothing.
    expect(await app.dumpAll()).toEqual(before);
  });

  test('popout runs the preview in its own window, still sandboxed', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/web-playground/');
    await typeInto(page, 'html', '<h1>Popped</h1>');

    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      page.getByTestId('wp-layout-popout').click(),
    ]);
    await popup.waitForLoadState();

    // The preview left this window and arrived in the other one.
    await expect(page.locator('iframe[title="Web playground preview"]')).toHaveCount(0);
    await expect(page.getByTestId('wp-preview-elsewhere')).toBeVisible();
    await expect(page.getByTestId('wp-popout-note')).toContainText('phones and tablets');
    const popped = popup.frameLocator('iframe[title="Web playground preview"]');
    await expect(popped.locator('h1')).toHaveText('Popped');

    // The popup window is same-origin with the app — which is exactly why the
    // code must NOT be its document. It is not: the frame inside it carries
    // the same sandbox, so the code still runs with no origin of its own.
    const frame = popup.locator('iframe[title="Web playground preview"]');
    await expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
    expect(await frame.getAttribute('sandbox')).not.toContain('allow-same-origin');

    // Editing here updates the window over there.
    await typeInto(page, 'html', '<h1>Edited while popped out</h1>');
    await expect(popped.locator('h1')).toHaveText('Edited while popped out');

    // And its console comes back to sit beside the code that wrote it.
    await typeInto(page, 'script', "console.log('from the popout');\n");
    await expect(consoleLines(page).first()).toContainText('from the popout');

    // Closing the window puts the preview back rather than leaving a dead mode.
    await popup.close();
    await expect(page.getByTestId('wp-layout-split')).toHaveAttribute('aria-pressed', 'true', {
      timeout: 15_000,
    });
    await expect(page.locator('iframe[title="Web playground preview"]')).toHaveCount(1);
    await expect(
      page.frameLocator('iframe[title="Web playground preview"]').locator('h1')
    ).toHaveText('Edited while popped out');
  });

  test('the preview window says so when it has no playground to listen to', async ({ app }) => {
    const { page } = app;
    // Opened directly rather than by the playground: there is no opener, so
    // there is nothing to show and the page says which page to go back to.
    await app.goto('/tools/web-playground/preview/');
    await expect(page.getByTestId('pw-orphaned')).toBeVisible();
    await expect(page.getByTestId('pw-orphaned')).toContainText('Popout');
  });

  test('New and Clear reset the scratch buffers without writing', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/web-playground/');
    const before = await app.dumpAll();

    await typeInto(page, 'html', '<h1>to be cleared</h1>');
    page.once('dialog', (d) => void d.accept());
    await page.getByTestId('wp-reset').click();
    await expect(page.getByTestId(PANE.html).locator('.cm-content')).toHaveText('');

    // New brings the starter back.
    await page.getByTestId('wp-new').click();
    await expect(page.getByTestId(PANE.html).locator('.cm-content')).toContainText('Hello');
    await expect(page.getByTestId('wp-scratch-note')).toContainText('scratch session');

    expect(await app.dumpAll()).toEqual(before);
  });
});
