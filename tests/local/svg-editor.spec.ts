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
    await page.getByTestId('svg-canvas').scrollIntoViewIfNeeded();
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

  test('color edits commit: saved, undoable, and escaped in the document', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/svg-editor/');
    await createDoc(app, 'Colors');
    await page.getByTestId('svg-add-rect').click();
    await expect.poll(async () => (await app.dump('svg_documents')).length).toBe(1);
    const id = ((await app.dump('svg_documents'))[0] as { id: string }).id;
    await expect(page.getByTestId('svg-save-state')).toHaveText('Saved');

    // Typing a fill color (ColorField text) and tabbing away is a commit.
    await page.getByTestId('svg-fill').fill('#123456');
    await page.getByTestId('svg-fill').press('Tab');
    await expect
      .poll(async () => ((await app.get('svg_documents', id)) as { layers: { fill: string }[] }).layers[0]!.fill)
      .toBe('#123456');
    // …and it is one undo step.
    await page.getByTestId('svg-undo').click();
    await expect(page.getByTestId('svg-fill')).toHaveValue('#f59e0b');

    // A stray quote in a color cannot break the document: the exported SVG
    // still parses and the value is escaped.
    await page.getByTestId('svg-fill').fill('#ff0000"');
    await page.getByTestId('svg-fill').press('Tab');
    const svg = await downloadBytes(page, () => page.getByTestId('svg-export-download').click());
    const markup = svg.bytes.toString('utf8');
    expect(markup).toContain('fill="#ff0000&quot;"');
    expect(markup).toContain('<rect');
    expect(markup.trim().endsWith('</svg>')).toBe(true);
  });

  test('clearing a numeric field reverts to the last committed value (never persists null)', async ({
    app,
  }) => {
    const { page } = app;
    await app.goto('/tools/svg-editor/');
    await createDoc(app, 'Nulls');
    await page.getByTestId('svg-add-rect').click();
    await expect.poll(async () => (await app.dump('svg_documents')).length).toBe(1);
    const id = ((await app.dump('svg_documents'))[0] as { id: string }).id;
    await page.getByTestId('svg-w').fill('90');
    await page.getByTestId('svg-w').press('Tab');
    // The autosave is debounced — poll (optional-chained: the add-layer save
    // may not have landed on the first read).
    await expect
      .poll(async () => ((await app.get('svg_documents', id)) as { layers: { width: number }[] }).layers[0]?.width)
      .toBe(90);

    await page.getByTestId('svg-w').fill('');
    await page.getByTestId('svg-w').press('Tab');
    await expect(page.getByTestId('svg-w')).toHaveValue('90');
    await expect(page.getByTestId('svg-save-state')).toHaveText('Saved');
    const row = (await app.get('svg_documents', id)) as { layers: { width: number }[] };
    expect(row.layers[0]!.width).toBe(90);
  });

  test('polygon edges can be curved per vertex; the control handle drags', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/svg-editor/');
    await createDoc(app, 'Curvy');
    await page.getByTestId('svg-add-polygon').click();
    await expect.poll(async () => (await app.dump('svg_documents')).length).toBe(1);
    const id = ((await app.dump('svg_documents'))[0] as { id: string }).id;

    // Select vertex 0 by clicking its handle, then curve the edge it starts.
    await page.getByTestId('svg-vertex-0').click();
    await page.getByTestId('svg-curve-edge').click();
    await expect(page.getByTestId('svg-curve-edge')).toHaveText('Straighten edge');
    await expect(page.getByTestId('svg-vctrl-0')).toBeVisible();

    // The exported document is now a closed path with a Q segment.
    const svg = await downloadBytes(page, () => page.getByTestId('svg-export-download').click());
    const markup = svg.bytes.toString('utf8');
    expect(markup).toMatch(/<path d="M[^"]* Q [^"]* Z"/);
    expect(markup).not.toContain('<polygon');

    // Drag the control handle: the persisted vertex control moves with it.
    // (Wait for the debounced save of the curve toggle to land first.)
    type Row = { layers: { points: { c?: { x: number; y: number } }[] }[] };
    await expect
      .poll(async () => ((await app.get('svg_documents', id)) as Row).layers[0]?.points[0]?.c?.x)
      .toEqual(expect.any(Number));
    const before = ((await app.get('svg_documents', id)) as Row).layers[0]!.points[0]!.c!;
    // The download click above scrolled the page; bring the canvas back on
    // screen before measuring the handle, or the mouse lands off-viewport.
    await page.getByTestId('svg-canvas').scrollIntoViewIfNeeded();
    const h = (await page.getByTestId('svg-vctrl-0').boundingBox())!;
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + h.width / 2 + 60, h.y + h.height / 2 - 40, { steps: 5 });
    await page.mouse.up();
    await expect
      .poll(async () => {
        const row = (await app.get('svg_documents', id)) as Row;
        return row.layers[0]?.points[0]?.c?.x ?? -Infinity;
      })
      .toBeGreaterThan(before.x + 10);

    // Straightening removes the control (and the key — straight documents
    // stay byte-identical to pre-curve ones).
    await page.getByTestId('svg-curve-edge').click();
    await expect(page.getByTestId('svg-vctrl-0')).toHaveCount(0);
    await expect
      .poll(async () => {
        const row = (await app.get('svg_documents', id)) as { layers: { points: Record<string, unknown>[] }[] };
        const p0 = row.layers[0]?.points[0];
        return p0 ? 'c' in p0 : null;
      })
      .toBe(false);
  });

  test('subtracting one layer from another bakes a pasted-SVG layer with the cut', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/svg-editor/');
    await createDoc(app, 'Boolean');
    await page.getByTestId('svg-add-rect').click();
    await page.getByTestId('svg-add-line').click();
    await expect(page.getByTestId('svg-layer')).toHaveCount(2);
    // Select the rect (list is top-first) and subtract the line from it.
    await page.getByTestId('svg-layer-select').nth(1).click();
    await page.getByTestId('svg-subtract').selectOption({ label: 'line' });
    await expect(page.getByTestId('svg-layer')).toHaveCount(1);
    await expect(page.getByTestId('svg-layer')).toContainText('pasted SVG');

    // Pixel proof from the exported PNG: orange above and below the cut,
    // background where the line went through — two rectangles.
    await page.getByTestId('svg-export-format').selectOption('png');
    await page.getByTestId('svg-export-width').fill('256');
    const png = await downloadBytes(page, () => page.getByTestId('svg-export-download').click());
    expect(isPng(png.bytes)).toBe(true);
    const probe = await page.evaluate(async (b64) => {
      const im = new Image();
      im.src = 'data:image/png;base64,' + b64;
      await im.decode();
      const c = document.createElement('canvas');
      c.width = im.width;
      c.height = im.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(im, 0, 0);
      const px = (x: number, y: number) => [...ctx.getImageData(x, y, 1, 1).data];
      return { above: px(128, 100), cut: px(128, 128), below: px(128, 156) };
    }, png.bytes.toString('base64'));
    expect(probe.above.slice(0, 3)).toEqual([245, 158, 11]);
    expect(probe.below.slice(0, 3)).toEqual([245, 158, 11]);
    expect(probe.cut.slice(0, 3)).toEqual([255, 255, 255]);

    // One undo restores both originals.
    await page.getByTestId('svg-undo').click();
    await expect(page.getByTestId('svg-layer')).toHaveCount(2);
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
