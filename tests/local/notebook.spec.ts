/**
 * Phase 10 — the notebook.
 *
 * The footnote model, the wiki-link tokenizer, the markdown factory and the
 * exporters are unit-tested. What matters here is the page's contract: a new
 * note is one row and autosave is one patch; reload restores it and writes
 * nothing; `[[Title]]` links resolve, create, and show up as backlinks;
 * footnote definitions survive a WYSIWYG → source → WYSIWYG round trip;
 * renaming keeps old links working and offers the rewrite; the HTML export
 * is self-contained; the print stylesheet hides the app; and none of the
 * heavy engines reach another route.
 */
import { readFileSync } from 'node:fs';
import { test, expect } from './helpers/app';
import { assertIsolatedDelta, assertInvariants } from './helpers/oracle';

type P = import('@playwright/test').Page;

/** Type into the Crepe canvas. It is a ProseMirror contenteditable. */
async function typeInCanvas(page: P, text: string) {
  const canvas = page.locator('[data-testid="notebook-canvas"] [contenteditable="true"]').first();
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  await canvas.click();
  await page.keyboard.type(text);
  // Milkdown debounces markdownUpdated (~200 ms) and autosave waits 400 ms more.
  await page.waitForTimeout(900);
}

/** Append to the source-mode CodeMirror buffer. */
async function appendInSource(page: P, text: string) {
  const content = page.locator('[data-testid="notebook-source"] .cm-content');
  await expect(content).toBeVisible({ timeout: 30_000 });
  await content.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(text);
  await page.waitForTimeout(900);
}

async function newNote(page: P) {
  await page.getByTestId('notebook-new').click();
  await expect(page.getByTestId('notebook-title')).toBeVisible({ timeout: 30_000 });
}

test.describe('notebook', () => {
  test.slow();

  test('loading writes nothing; a new note is one row and autosave is one patch', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/notebook/');
    await expect(page.getByTestId('notebook-empty')).toBeVisible({ timeout: 30_000 });
    expect(await app.dumpAll()).toEqual(before);

    await newNote(page);
    let rows = await app.dump('notes');
    expect(rows).toHaveLength(1);
    const id = String(rows[0]!.id);
    // One note row plus the "which one was open" preference.
    assertIsolatedDelta(before, await app.dumpAll(), [
      { store: 'notes', id },
      { store: 'preferences', id: 'singleton' },
    ]);

    const afterCreate = await app.dumpAll();
    await page.getByTestId('notebook-title').fill('Ideas');
    await typeInCanvas(page, 'First line of the note.');
    await expect(page.getByTestId('notebook-save-state')).toHaveText('Saved');
    rows = await app.dump('notes');
    expect(rows[0]!.title).toBe('Ideas');
    expect(String(rows[0]!.body_md)).toContain('First line of the note.');
    assertIsolatedDelta(afterCreate, await app.dumpAll(), [{ store: 'notes', id }]);

    // Reload restores it without writing a thing.
    const saved = await app.dumpAll();
    await page.reload();
    await expect(page.getByTestId('notebook-title')).toHaveValue('Ideas', { timeout: 30_000 });
    await expect(page.locator('[data-testid="notebook-canvas"]')).toContainText('First line of the note.');
    expect(await app.dumpAll()).toEqual(saved);
    assertInvariants(await app.dumpAll(), 'after creating and editing a note');
  });

  test('[[links]] resolve, create, and come back as backlinks', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/notebook/');
    await newNote(page);
    await page.getByTestId('notebook-title').fill('Hub');
    await typeInCanvas(page, 'See [[Spoke]] for details.');

    // Not a note yet: the outgoing-links card says so.
    await expect(page.getByTestId('notebook-outlink')).toContainText('not yet a note');
    await page.getByTestId('notebook-mode-preview').click();
    const link = page.locator('[data-testid="notebook-preview"] a.wiki-link');
    await expect(link).toHaveClass(/missing/);
    await expect(link).toHaveAttribute('href', /\/tools\/notebook\/\?note=Spoke/);

    // Clicking the unresolved link creates the note and opens it, in-app.
    await link.click();
    await expect(page.getByTestId('notebook-title')).toHaveValue('Spoke', { timeout: 30_000 });
    expect(page.url()).toContain('/tools/notebook/');
    await expect(page.getByTestId('notebook-backlink')).toHaveAttribute('data-title', 'Hub');
    expect(await app.dump('notes')).toHaveLength(2);

    // Back in Hub the link is now resolved.
    await page.getByTestId('notebook-backlink').click();
    await expect(page.getByTestId('notebook-title')).toHaveValue('Hub');
    await page.getByTestId('notebook-mode-preview').click();
    await expect(page.locator('[data-testid="notebook-preview"] a.wiki-link')).not.toHaveClass(/missing/);
  });

  test('footnote definitions survive WYSIWYG → source → WYSIWYG', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/notebook/');
    await newNote(page);
    await typeInCanvas(page, 'A claim[^1].');
    await expect(page.getByTestId('notebook-footnote-issues')).toContainText('no definition');

    // Write the definition in source mode…
    await page.getByTestId('notebook-mode-source').click();
    await appendInSource(page, '\n\n[^1]: The claim, explained.');
    await expect(page.getByTestId('notebook-footnote-issues')).toHaveCount(0);

    // …go through the WYSIWYG canvas, which has no node for definitions…
    await page.getByTestId('notebook-mode-wysiwyg').click();
    await page.waitForTimeout(900);
    const canvas = page.locator('[data-testid="notebook-canvas"]');
    await expect(canvas).not.toContainText('[^1]: The claim');

    // …and come back: the definition was restored, not lost.
    await page.getByTestId('notebook-mode-source').click();
    await expect(page.locator('[data-testid="notebook-source"] .cm-content')).toContainText(
      '[^1]: The claim, explained.'
    );
    await expect
      .poll(async () => String((await app.dump('notes'))[0]!.body_md))
      .toContain('[^1]: The claim, explained.');
  });

  test('renaming keeps old links working and offers the rewrite', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/notebook/');
    await newNote(page);
    await page.getByTestId('notebook-title').fill('Target');
    await typeInCanvas(page, 'I am the target.');
    await newNote(page);
    await page.getByTestId('notebook-title').fill('Linker');
    await typeInCanvas(page, 'Go to [[Target]].');

    // Rename the target; its old title becomes an alias.
    await page.locator('[data-testid="notebook-note"][data-title="Target"]').click();
    await expect(page.getByTestId('notebook-title')).toHaveValue('Target');
    await page.getByTestId('notebook-title').fill('Destination');
    await expect(page.getByTestId('notebook-save-state')).toHaveText('Saved', { timeout: 10_000 });
    await expect(page.getByTestId('notebook-aliases')).toContainText('Target');
    // The old [[Target]] still resolves (a backlink), and a rewrite is offered.
    await expect(page.getByTestId('notebook-backlink')).toHaveAttribute('data-title', 'Linker');
    await expect(page.getByTestId('notebook-rename-offer')).toContainText('1 note');
    await page.getByTestId('notebook-rewrite-links').click();
    await expect(page.getByTestId('notebook-feedback')).toContainText('Updated 1 linking note');
    const linker = (await app.dump('notes')).find((n) => n.title === 'Linker')!;
    expect(String(linker.body_md)).toContain('[[Destination]]');
    expect(String(linker.body_md)).not.toContain('[[Target]]');
  });

  test('notes nest, and deleting a parent moves its children up', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/notebook/');
    await newNote(page);
    await page.getByTestId('notebook-title').fill('Parent');
    await expect(page.getByTestId('notebook-save-state')).toHaveText('Saved', { timeout: 10_000 });
    const parent = (await app.dump('notes'))[0]!;
    await page.getByTestId(`notebook-new-child-${String(parent.id)}`).click();
    await expect(page.getByTestId('notebook-title')).toHaveValue('Untitled', { timeout: 30_000 });
    await expect(page.getByTestId('notebook-breadcrumb')).toContainText('Parent');
    const child = (await app.dump('notes')).find((n) => n.id !== parent.id)!;
    expect(child.parent_id).toBe(parent.id);

    page.on('dialog', (dialog) => dialog.accept());
    await page.locator('[data-testid="notebook-note"][data-title="Parent"]').click();
    await page.getByTestId('notebook-delete').click();
    await expect(page.getByTestId('notebook-feedback')).toContainText('Note deleted');
    const rows = await app.dump('notes');
    const deleted = rows.find((n) => n.id === parent.id)!;
    const survivor = rows.find((n) => n.id === child.id)!;
    expect(deleted.deleted_at).not.toBeNull();
    // Reparented to the root, not deleted with its parent.
    expect(survivor.deleted_at).toBeNull();
    expect(survivor.parent_id).toBeNull();
    assertInvariants(await app.dumpAll(), 'after deleting a parent note');
  });

  test('a deep link to a missing note offers to create it rather than writing on load', async ({
    app,
  }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/notebook/?note=Nowhere');
    await expect(page.getByTestId('notebook-missing-link')).toContainText('Nowhere', { timeout: 30_000 });
    expect(await app.dumpAll()).toEqual(before);
    await page.getByTestId('notebook-create-missing').click();
    await expect(page.getByTestId('notebook-title')).toHaveValue('Nowhere', { timeout: 30_000 });
    expect(await app.dump('notes')).toHaveLength(1);
  });

  test('the HTML export is one self-contained file', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/notebook/');
    await newNote(page);
    await page.getByTestId('notebook-title').fill('Exported');
    await typeInCanvas(page, 'Some *prose* with a [[Link]] and code `x`.');

    const download = page.waitForEvent('download');
    await page.getByTestId('notebook-export-html').click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('Exported.html');
    const html = readFileSync(await file.path(), 'utf8');
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<title>Exported</title>');
    expect(html).toContain('<style>');
    expect(html).toContain('prose');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<link');
    // The wiki link points at this app — the one URL a reader wrote, not a
    // fetched resource; nothing else leaves the file.
    expect(html.match(/https?:\/\//g) ?? []).toEqual([]);
    await expect(page.getByTestId('notebook-export-note')).toHaveCount(0);

    const md = page.waitForEvent('download');
    await page.getByTestId('notebook-export-md').click();
    const mdFile = await md;
    expect(mdFile.suggestedFilename()).toBe('Exported.md');
    expect(readFileSync(await mdFile.path(), 'utf8')).toContain('[[Link]]');
  });

  test('the print stylesheet hides the app around the note', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/notebook/');
    await newNote(page);
    await page.getByTestId('notebook-title').fill('Printed');
    await typeInCanvas(page, 'Print me.');

    // Headless Chromium has no print dialog; the call must still be harmless.
    await page.evaluate(() => {
      (window as unknown as { print: () => void }).print = () => {};
    });
    await page.emulateMedia({ media: 'print' });
    const hidden = await page.evaluate(() => ({
      topbar: getComputedStyle(document.querySelector('.topbar')!).display,
      sidebar: getComputedStyle(document.querySelector('#app-sidebar')!).display,
      app: getComputedStyle(document.querySelector('[data-print="hide"]')!).display,
    }));
    expect(hidden).toEqual({ topbar: 'none', sidebar: 'none', app: 'none' });
    // Under print media the button itself is hidden — that is the point — so
    // switch back before pressing it.
    await page.emulateMedia({ media: 'screen' });

    await page.getByTestId('notebook-print').click();
    // The filename can only be seeded through the document title.
    await expect.poll(() => page.title()).toBe('Printed');
  });

  test('the editor stays off every other route', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/notebook/');
    await newNote(page);
    await expect(page.locator('[data-testid="notebook-canvas"]')).toBeVisible({ timeout: 30_000 });

    const after: string[] = [];
    page.on('request', (r) => after.push(r.url()));
    await page.goto('/tools/secrets/');
    await expect(page.getByTestId('sec-value-strong')).not.toBeEmpty();
    await page.waitForTimeout(400);
    expect(after.filter((u) => /milkdown|prosemirror|crepe|mermaid|katex/i.test(u))).toEqual([]);
  });
});
