/**
 * Phase 6 (SVG editor) — named documents in `svg_documents` (DB v5), layer
 * editing through the real canvas UI, undo/redo, and export. The oracle pins
 * the write behavior: creating/editing touches exactly the document row (plus
 * the preferences singleton remembering the last-open document), reloading
 * restores the document byte-identically without writing, and exports write
 * nothing at all.
 */
import { readFileSync } from 'node:fs';
import { test, expect } from './helpers/app';
import { assertIsolatedDelta, assertSameDb } from './helpers/oracle';

async function downloadBytes(
  page: import('@playwright/test').Page,
  trigger: () => Promise<void>
): Promise<{ name: string; bytes: Buffer }> {
  const downloadPromise = page.waitForEvent('download');
  await trigger();
  const download = await downloadPromise;
  return { name: download.suggestedFilename(), bytes: readFileSync(await download.path()) };
}

const isPng = (buf: Buffer): boolean =>
  buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
const pngSize = (buf: Buffer): { w: number; h: number } => ({
  w: buf.readUInt32BE(16),
  h: buf.readUInt32BE(20),
});

/** Create a document through the UI and wait for the editor to open. */
async function createDoc(app: { page: import('@playwright/test').Page }, name: string) {
  await app.page.getByTestId('svg-new-name').fill(name);
  await app.page.getByTestId('svg-create').click();
  await expect(app.page.getByTestId('svg-canvas')).toBeVisible();
}

test.describe('svg editor documents', () => {
  test('create → edit → reload: one row, resumed byte-identical, reload writes nothing', async ({
    app,
  }) => {
    const { page } = app;
    await app.goto('/tools/svg-editor/');
    const before = await app.dumpAll();

    await createDoc(app, 'My icon');
    await page.getByTestId('svg-add-rect').click();
    await page.getByTestId('svg-add-line').click();

    // Exactly one document row appears; the only other write is the
    // preferences singleton remembering the last-open document.
    await expect.poll(async () => (await app.dump('svg_documents')).length).toBe(1);
    const row = (await app.dump('svg_documents'))[0] as { id: string; layers: unknown[] };
    await expect
      .poll(async () => ((await app.get('svg_documents', row.id)) as { layers: unknown[] }).layers.length)
      .toBe(2);
    assertIsolatedDelta(before, await app.dumpAll(), [
      { store: 'svg_documents', id: row.id },
      { store: 'preferences', id: 'singleton' },
    ]);

    // Let the debounced save settle, then snapshot and reload.
    await expect(page.getByTestId('svg-save-state')).toHaveText('Saved');
    const snapshot = await app.dumpAll();
    await app.goto('/tools/svg-editor/');
    // The last-open document resumes automatically…
    await expect(page.getByTestId('svg-canvas')).toBeVisible();
    await expect(page.getByTestId('svg-name')).toHaveValue('My icon');
    await expect(page.getByTestId('svg-layer')).toHaveCount(2);
    // …and resuming is read-only: the database is byte-identical.
    assertSameDb(snapshot, await app.dumpAll(), 'reload after editing');
  });

  test('canvas drag moves a layer and persists only that document', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/svg-editor/');
    await createDoc(app, 'Drag me');
    await page.getByTestId('svg-add-rect').click();
    await expect.poll(async () => (await app.dump('svg_documents')).length).toBe(1);
    const id = ((await app.dump('svg_documents'))[0] as { id: string }).id;
    await expect(page.getByTestId('svg-save-state')).toHaveText('Saved');
    const before = await app.dumpAll();

    // Real pointer drag: grab the rect at the canvas center (128,128 of 256)
    // and drop it at (192, 96).
    const box = (await page.getByTestId('svg-overlay').boundingBox())!;
    const at = (cx: number, cy: number): [number, number] => [
      box.x + (cx / 256) * box.width,
      box.y + (cy / 256) * box.height,
    ];
    await page.mouse.move(...at(128, 128));
    await page.mouse.down();
    await page.mouse.move(...at(160, 112), { steps: 4 });
    await page.mouse.move(...at(192, 96), { steps: 4 });
    await page.mouse.up();

    await expect.poll(async () => Number(await page.getByTestId('svg-x').inputValue())).toBeGreaterThan(180);
    await expect
      .poll(async () => {
        const row = (await app.get('svg_documents', id)) as {
          layers: { x: number; y: number }[];
        };
        return row.layers[0]!.x;
      })
      .toBeGreaterThan(180);
    const layer = ((await app.get('svg_documents', id)) as { layers: { y: number }[] }).layers[0]!;
    expect(layer.y).toBeLessThan(112);
    assertIsolatedDelta(before, await app.dumpAll(), [{ store: 'svg_documents', id }]);
  });

  test('undo/redo walk the layer stack and save the reverted state', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/svg-editor/');
    await createDoc(app, 'History');
    await page.getByTestId('svg-add-rect').click();
    await page.getByTestId('svg-add-circle').click();
    await expect(page.getByTestId('svg-layer')).toHaveCount(2);
    const id = ((await app.dump('svg_documents'))[0] as { id: string }).id;

    await page.getByTestId('svg-undo').click();
    await expect(page.getByTestId('svg-layer')).toHaveCount(1);
    await expect
      .poll(async () => ((await app.get('svg_documents', id)) as { layers: unknown[] }).layers.length)
      .toBe(1);

    await page.getByTestId('svg-redo').click();
    await expect(page.getByTestId('svg-layer')).toHaveCount(2);
    await expect
      .poll(async () => ((await app.get('svg_documents', id)) as { layers: unknown[] }).layers.length)
      .toBe(2);

    // Fully unwound, undo disables (initial state = empty document).
    await page.getByTestId('svg-undo').click();
    await page.getByTestId('svg-undo').click();
    await expect(page.getByTestId('svg-undo')).toBeDisabled();
    await expect(page.getByTestId('svg-redo')).toBeEnabled();
  });

  test('export SVG and PNG at a chosen size — zero writes', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/svg-editor/');
    await createDoc(app, 'Export me');
    await page.getByTestId('svg-add-star').click();
    await expect(page.getByTestId('svg-save-state')).toHaveText('Saved');
    const before = await app.dumpAll();

    // SVG: a standalone namespaced document with the drawn star.
    const svg = await downloadBytes(page, () => page.getByTestId('svg-export-download').click());
    expect(svg.name).toBe('Export me.svg');
    const markup = svg.bytes.toString('utf8');
    expect(markup).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(markup).toContain('viewBox="0 0 256 256"');
    expect(markup).toContain('<polygon');

    // PNG at an exact chosen size.
    await page.getByTestId('svg-export-format').selectOption('png');
    await page.getByTestId('svg-export-width').fill('64');
    const png = await downloadBytes(page, () => page.getByTestId('svg-export-download').click());
    expect(png.name).toBe('Export me.png');
    expect(isPng(png.bytes)).toBe(true);
    expect(pngSize(png.bytes)).toEqual({ w: 64, h: 64 });

    // Exports never touch the database.
    expect(await app.dumpAll()).toEqual(before);
  });

  test('deleting a document tombstones it (no hard delete)', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/svg-editor/');
    await createDoc(app, 'Doomed');
    await expect.poll(async () => (await app.dump('svg_documents')).length).toBe(1);
    await page.getByTestId('svg-close').click();

    page.on('dialog', (d) => void d.accept());
    await page.getByTestId('svg-doc-delete').click();
    await expect(page.getByTestId('svg-doc')).toHaveCount(0);
    await expect
      .poll(async () => {
        const rows = (await app.call('rawDump', 'svg_documents')) as { deleted_at: string | null }[];
        return rows.length === 1 && rows[0]!.deleted_at !== null;
      })
      .toBe(true);
  });
});
