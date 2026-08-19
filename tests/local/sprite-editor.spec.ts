/**
 * Phase 5 — the sprite editor.
 *
 * The pure parts (grid squaring, legend filtering, SVG escaping) are covered by
 * Vitest in src/lib/sprite/export.test.ts. What matters here is the document
 * behaviour: a sprite is one row, autosave touches only that row, a stroke is
 * one undo step, and what comes back after a reload is what was drawn.
 */
import { readFileSync } from 'node:fs';
import { test, expect } from './helpers/app';
import { assertInvariants, assertIsolatedDelta } from './helpers/oracle';

type P = import('@playwright/test').Page;

/** Create a sprite and open it. Returns its row id. */
async function createSprite(app: import('./helpers/app').App, name: string): Promise<string> {
  const { page } = app;
  await page.getByTestId('sprite-new-name').fill(name);
  await page.getByTestId('sprite-create').click();
  await expect(page.getByTestId('sprite-grid')).toBeVisible();
  await expect.poll(async () => (await app.dump('sprites')).length).toBe(1);
  return String((await app.dump('sprites'))[0]!.id);
}

/** Paint one cell by typing into it, the way a keyboard user would. */
async function paintCell(page: P, index: number, char: string) {
  const cell = page.getByTestId('sprite-cell').nth(index);
  await cell.fill(char);
  await cell.blur();
}

test.describe('sprite editor', () => {
  test('a sprite is one row: create, paint, reload, and it comes back the same', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/sprite-editor/');
    const id = await createSprite(app, 'Diagonal');

    await paintCell(page, 0, 'k');
    await paintCell(page, 17, 'R');
    await expect(page.getByTestId('sprite-save-state')).toHaveText('Saved');

    const saved = (await app.dump('sprites'))[0] as Record<string, unknown>;
    expect(saved.name).toBe('Diagonal');
    expect(saved.size).toBe(16);
    expect((saved.rows as string[])[0]![0]).toBe('k');
    expect((saved.rows as string[])[1]![1]).toBe('R');
    // Every row is a full-width string: the grid is never ragged in storage.
    for (const row of saved.rows as string[]) expect(row).toHaveLength(16);

    // Reopened from the remembered id, byte-identical.
    await page.reload();
    await expect(page.getByTestId('sprite-grid')).toBeVisible();
    await expect(page.getByTestId('sprite-name')).toHaveValue('Diagonal');
    await expect(page.getByTestId('sprite-cell').nth(0)).toHaveValue('k');
    await expect(page.getByTestId('sprite-cell').nth(17)).toHaveValue('R');
    const after = (await app.dump('sprites'))[0] as Record<string, unknown>;
    expect(after).toEqual(saved);
    expect(String(after.id)).toBe(id);
  });

  test('autosave writes exactly one row, and opening writes only the remembered id', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/sprite-editor/');
    const id = await createSprite(app, 'Isolated');

    const before = await app.dumpAll();
    await paintCell(page, 5, 'W');
    await expect(page.getByTestId('sprite-save-state')).toHaveText('Saved');
    // The paint touches the sprite row and nothing else.
    assertIsolatedDelta(before, await app.dumpAll(), [{ store: 'sprites', id }]);

    // Closing and reopening remembers which one was open — a preferences write.
    const beforeOpen = await app.dumpAll();
    await page.getByTestId('sprite-close').click();
    await page.getByTestId('sprite-doc-open').click();
    await expect(page.getByTestId('sprite-grid')).toBeVisible();
    assertIsolatedDelta(beforeOpen, await app.dumpAll(), [
      { store: 'preferences', id: 'singleton' },
    ]);
  });

  test('loading, resuming and looking around write nothing at all', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/sprite-editor/');
    await createSprite(app, 'Quiet');

    // Everything below is reading and drawing — no edit, so no write, not even
    // the remembered-document preference (it was already written on create).
    const before = await app.dumpAll();
    await page.reload();
    // A reload resumes the last-open document rather than the list, the same
    // way the SVG editor does.
    await expect(page.getByTestId('sprite-grid')).toBeVisible();
    await page.getByTestId('sprite-mode-preview').click();
    await page.getByTestId('sprite-mode-text').click();
    await page.getByTestId('sprite-close').click();
    await expect(page.getByTestId('sprite-doc')).toHaveCount(1);
    await page.reload();
    await expect(page.getByTestId('sprite-grid')).toBeVisible();

    expect(await app.dumpAll()).toEqual(before);
  });

  test('one drag across the grid is one undo step', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/sprite-editor/');
    await createSprite(app, 'Stroke');

    // Drag across three cells in the top row with the mouse held down.
    const cells = page.getByTestId('sprite-cell');
    const boxes = await Promise.all([0, 1, 2].map(async (i) => (await cells.nth(i).boundingBox())!));
    await page.mouse.move(boxes[0]!.x + boxes[0]!.width / 2, boxes[0]!.y + boxes[0]!.height / 2);
    await page.mouse.down();
    for (const box of boxes.slice(1)) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 3 });
    }
    await page.mouse.up();

    await expect(cells.nth(0)).toHaveValue('k');
    await expect(cells.nth(1)).toHaveValue('k');
    await expect(cells.nth(2)).toHaveValue('k');

    // A single undo takes the WHOLE stroke back, not one pixel of it.
    await page.getByTestId('sprite-undo').click();
    await expect(cells.nth(0)).toHaveValue('');
    await expect(cells.nth(1)).toHaveValue('');
    await expect(cells.nth(2)).toHaveValue('');

    await page.getByTestId('sprite-redo').click();
    await expect(cells.nth(2)).toHaveValue('k');
  });

  test('the legend refuses a colour that could escape into the export', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/sprite-editor/');
    await createSprite(app, 'Legend');

    const field = page.getByTestId('sprite-color').first();
    const original = await field.inputValue();
    await field.fill('red;background-image:url(x)');
    await field.blur();
    await expect(page.getByTestId('sprite-message')).toContainText("isn't a valid colour");

    // The legend still holds the value it had — the bad one never lands.
    await expect.poll(async () => {
      const row = (await app.dump('sprites'))[0] as Record<string, unknown>;
      return Object.values(row.colors as Record<string, string>).join(' ');
    }).not.toContain('url(');
    await page.reload();
    await expect(page.getByTestId('sprite-color').first()).toHaveValue(original);
  });

  test('import replaces the grid and filters a hostile legend', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/sprite-editor/');
    await createSprite(app, 'Imported');

    const doc = JSON.stringify({
      format: 'useful-sprite',
      version: 1,
      size: 4,
      rows: ['ab..', '..ab', 'ab..', '..ab'],
      colors: { a: '#ff0000', b: 'blue', bad: 'green', z: 'url(http://x)' },
    });
    await page.getByTestId('sprite-import').fill(doc);
    await page.getByTestId('sprite-apply-import').click();
    await expect(page.getByTestId('sprite-message')).toContainText('imported');

    await expect(page.getByTestId('sprite-size')).toHaveValue('4');
    await expect(page.getByTestId('sprite-cell')).toHaveCount(16);
    await expect.poll(async () => {
      const row = (await app.dump('sprites'))[0] as Record<string, unknown>;
      return Object.keys(row.colors as Record<string, string>).sort().join('');
    }).toBe('ab');

    // A retoken file is accepted too, so sprites move between the projects.
    await page.getByTestId('sprite-import').fill(
      JSON.stringify({
        format: 'retoken-sprite',
        version: 1,
        size: 8,
        rows: Array.from({ length: 8 }, () => 'kkkkkkkk'),
        colors: { k: '#123456' },
      })
    );
    await page.getByTestId('sprite-apply-import').click();
    await expect(page.getByTestId('sprite-cell')).toHaveCount(64);

    // And anything else is refused with a message, not a broken document.
    await page.getByTestId('sprite-import').fill('{"nope": true}');
    await page.getByTestId('sprite-apply-import').click();
    await expect(page.getByTestId('sprite-message')).toContainText('Not a sprite file');
    await expect(page.getByTestId('sprite-cell')).toHaveCount(64);
  });

  test('exporting produces the right files and writes nothing', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/sprite-editor/');
    await createSprite(app, 'Exported');
    await paintCell(page, 0, 'k');
    await expect(page.getByTestId('sprite-save-state')).toHaveText('Saved');

    const before = await app.dumpAll();

    const svgDownload = page.waitForEvent('download');
    await page.getByTestId('sprite-download-svg').click();
    const svg = await svgDownload;
    expect(svg.suggestedFilename()).toBe('Exported.svg');
    const svgText = readFileSync(await svg.path(), 'utf8');
    expect(svgText).toContain('shape-rendering="crispEdges"');
    expect(svgText).toContain('viewBox="0 0 16 16"');
    expect(svgText.match(/<rect/g)).toHaveLength(1); // one painted pixel

    const jsonDownload = page.waitForEvent('download');
    await page.getByTestId('sprite-download-json').click();
    const json = await jsonDownload;
    expect(json.suggestedFilename()).toBe('Exported.json');
    const parsed = JSON.parse(readFileSync(await json.path(), 'utf8'));
    expect(parsed.format).toBe('useful-sprite');
    expect(parsed.rows).toHaveLength(16);

    const pngDownload = page.waitForEvent('download');
    await page.getByTestId('sprite-download-png').click();
    const png = await pngDownload;
    expect(png.suggestedFilename()).toBe('Exported.png');
    // A real PNG, at the requested size.
    const bytes = readFileSync(await png.path());
    expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(bytes.readUInt32BE(16)).toBe(512);

    expect(await app.dumpAll()).toEqual(before);
  });

  test('resizing squares the grid, and the size is clamped to what the editor supports', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/sprite-editor/');
    await createSprite(app, 'Resized');
    await paintCell(page, 0, 'k');

    await page.getByTestId('sprite-size').fill('8');
    await page.getByTestId('sprite-size').blur();
    await expect(page.getByTestId('sprite-cell')).toHaveCount(64);
    await expect(page.getByTestId('sprite-cell').nth(0)).toHaveValue('k'); // kept

    // Out of range is clamped rather than obeyed.
    await page.getByTestId('sprite-size').fill('999');
    await page.getByTestId('sprite-size').blur();
    await expect(page.getByTestId('sprite-size')).toHaveValue('48');
    await expect.poll(async () => {
      const row = (await app.dump('sprites'))[0] as Record<string, unknown>;
      return (row.rows as string[]).every((r) => r.length === 48) && (row.rows as string[]).length === 48;
    }).toBe(true);
  });

  test('deleting a sprite tombstones it and leaves the store consistent', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/sprite-editor/');
    const id = await createSprite(app, 'Doomed');
    await page.getByTestId('sprite-close').click();

    page.once('dialog', (d) => void d.accept());
    await page.getByTestId('sprite-doc-delete').click();
    await expect(page.getByTestId('sprite-doc')).toHaveCount(0);

    await expect.poll(async () => {
      const rows = (await app.dump('sprites')) as Record<string, unknown>[];
      return rows.find((r) => r.id === id)?.deleted_at !== null;
    }).toBe(true);
    // A tombstone keeps only bookkeeping — the artwork does not linger.
    const tomb = ((await app.dump('sprites')) as Record<string, unknown>[]).find((r) => r.id === id)!;
    expect(tomb.rows).toBeUndefined();
    expect(tomb.name).toBeUndefined();
    assertInvariants(await app.dumpAll(), 'after deleting a sprite');
  });
});
