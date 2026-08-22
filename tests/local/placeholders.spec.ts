/**
 * Placeholders (0.3.0 phase 11).
 *
 * Stateless — nothing on the page is written anywhere, and every case asserts
 * the database is byte-identical afterwards.
 *
 * The image cases assert the preview's INTRINSIC size (`naturalWidth`), not
 * the box it is laid out in: an SVG that draws at the wrong size still fits
 * a CSS box perfectly, so the layout tells you nothing.
 */
import { readFileSync } from 'node:fs';
import { test, expect } from './helpers/app';
import { zipEntries } from '../../src/lib/zip';

type P = import('@playwright/test').Page;

async function downloadBytes(page: P, trigger: () => Promise<void>) {
  const downloadPromise = page.waitForEvent('download');
  await trigger();
  const download = await downloadPromise;
  return { name: download.suggestedFilename(), bytes: readFileSync(await download.path()) };
}

/** The preview's own dimensions, once the browser has decoded it. */
async function previewSize(page: P): Promise<{ width: number; height: number }> {
  const preview = page.getByTestId('ph-preview');
  await expect(preview).toBeVisible();
  return preview.evaluate(async (node) => {
    const img = node as HTMLImageElement;
    if (!img.complete) await img.decode().catch(() => undefined);
    return { width: img.naturalWidth, height: img.naturalHeight };
  });
}

const toImageMode = async (page: P) => page.getByTestId('ph-mode').selectOption('image');

test.describe('placeholders — filler text', () => {
  test('generates text, counts it, and writes nothing', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/placeholders/');

    await expect(page.getByTestId('ph-text')).toContainText('Lorem ipsum dolor sit amet');
    await expect(page.getByTestId('ph-text-counts')).toContainText('3 paragraphs');

    await page.getByTestId('ph-count').fill('1');
    await expect(page.getByTestId('ph-text-counts')).toContainText('1 paragraphs');

    expect(await app.dumpAll()).toEqual(before);
  });

  test('is the same text for the same seed and different for another', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/placeholders/');
    const first = await page.getByTestId('ph-text').innerText();

    await page.getByTestId('ph-text-seed').fill('other');
    await expect(page.getByTestId('ph-text')).not.toHaveText(first);

    await page.getByTestId('ph-text-seed').fill('useful');
    await expect(page.getByTestId('ph-text')).toHaveText(first);
  });

  test('drops the traditional opening, wraps in <p>, and counts words', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/placeholders/');

    await page.getByTestId('ph-lorem-start').uncheck();
    await expect(page.getByTestId('ph-text')).not.toContainText('Lorem ipsum dolor sit amet');

    await page.getByTestId('ph-html').check();
    await expect(page.getByTestId('ph-text')).toContainText('<p>');

    await page.getByTestId('ph-unit').selectOption('words');
    await page.getByTestId('ph-count').fill('20');
    const words = (await page.getByTestId('ph-text').innerText()).replace(/<\/?p>/g, '').trim();
    expect(words.split(/\s+/)).toHaveLength(20);
  });

  test('writes office speak from its own words', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/placeholders/');
    await page.getByTestId('ph-corpus').selectOption('office');
    const text = await page.getByTestId('ph-text').innerText();
    expect(text).not.toContain('consectetur');
    expect(text).toMatch(/roadmap|deliverables|synergies|bandwidth|touchpoints|paradigm|ecosystem/);
  });
});

test.describe('placeholders — filler images', () => {
  test('draws every generator at the requested size', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/placeholders/');
    await toImageMode(page);

    for (const id of ['solid', 'heading', 'gradient', 'noise', 'flow', 'material', 'planes', 'scene']) {
      await page.getByTestId(`ph-gen-${id}`).click();
      await expect
        .poll(async () => (await previewSize(page)).width, { message: id })
        .toBe(1200);
      expect((await previewSize(page)).height, id).toBe(675);
    }

    expect(await app.dumpAll()).toEqual(before);
  });

  test('only shows a control where it does something', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/placeholders/');
    await toImageMode(page);

    // Plain colour has nothing to tune: no ink, no seed, no shape controls.
    await expect(page.getByTestId('ph-fg')).toHaveCount(0);
    await expect(page.getByTestId('ph-seed')).toHaveCount(0);

    // The geometry generators draw from their own palette, so an Ink picker
    // there would be a control that paints nothing.
    await page.getByTestId('ph-gen-material').click();
    await expect(page.getByTestId('ph-opacity')).toBeVisible();
    await expect(page.getByTestId('ph-seed')).toBeVisible();
    await expect(page.getByTestId('ph-fg')).toHaveCount(0);

    await page.getByTestId('ph-gen-flow').click();
    await expect(page.getByTestId('ph-density')).toBeVisible();
    await expect(page.getByTestId('ph-fg')).toBeVisible();
    await expect(page.getByTestId('ph-opacity')).toHaveCount(0);

    await page.getByTestId('ph-gen-icon').click();
    await expect(page.getByTestId('ph-icon-scale')).toBeVisible();
    await expect(page.getByTestId('ph-density')).toHaveCount(0);
  });

  test('tunes flow density, shape opacity and icon size', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/placeholders/');
    await toImageMode(page);

    // Each control has to change the drawing, not just its own value.
    const svg = () =>
      page.getByTestId('ph-preview').evaluate((n) => decodeURIComponent((n as HTMLImageElement).src));

    await page.getByTestId('ph-gen-flow').click();
    const sparse = await svg();
    await page.getByTestId('ph-density').fill('300');
    await expect.poll(async () => (await svg()).length).toBeGreaterThan(sparse.length);

    await page.getByTestId('ph-gen-planes').click();
    const solid = await svg();
    await page.getByTestId('ph-opacity').fill('0.2');
    await expect.poll(async () => await svg()).not.toBe(solid);

    await page.getByTestId('ph-gen-icon').click();
    await expect(page.getByTestId('ph-icons').locator('button')).not.toHaveCount(0, { timeout: 60_000 });
    const small = await svg();
    await page.getByTestId('ph-icon-scale').fill('0.9');
    await expect.poll(async () => await svg()).not.toBe(small);

    expect(await app.dumpAll()).toEqual(before);
  });

  test('follows the size and the aspect lock', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/placeholders/');
    await toImageMode(page);

    // 1200×675 is 16:9, and the lock is on, so a new width recomputes the
    // height and leaves the width exactly as typed.
    await page.getByTestId('ph-width').fill('800');
    await page.getByTestId('ph-width').press('Enter');
    await expect(page.getByTestId('ph-height')).toHaveValue('450');
    await expect.poll(async () => (await previewSize(page)).width).toBe(800);

    // Unlocked, a side moves on its own.
    await page.getByTestId('ph-lock').uncheck();
    await page.getByTestId('ph-height').fill('200');
    await page.getByTestId('ph-height').press('Enter');
    await expect(page.getByTestId('ph-width')).toHaveValue('800');
    await expect.poll(async () => (await previewSize(page)).height).toBe(200);

    // A ratio button reshapes from the width.
    await page.getByTestId('ph-ratio-1:1').click();
    await expect(page.getByTestId('ph-height')).toHaveValue('800');
  });

  test('loads the icon set only when the icon generator is chosen', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/placeholders/');
    await toImageMode(page);
    await page.getByTestId('ph-gen-icon').click();

    await expect(page.getByTestId('ph-icons').locator('button')).not.toHaveCount(0, { timeout: 60_000 });
    await page.getByTestId('ph-icon-search').fill('camera');
    await page.getByTestId('ph-icon-Camera').click();
    await expect(page.getByTestId('ph-icon-name')).toHaveText('Camera');
    expect((await previewSize(page)).width).toBe(1200);
  });

  test('picks a drawn scene', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/placeholders/');
    await toImageMode(page);
    await page.getByTestId('ph-gen-scene').click();

    // Fifteen of them, five per group.
    await expect(page.locator('[data-testid^="ph-scene-"]')).toHaveCount(15);
    await page.getByTestId('ph-scene-skyline').click();
    await page.getByTestId('ph-scene-rooftops').click();
    // The scene is drawn into the same frame, cropped rather than squashed.
    await page.getByTestId('ph-width').fill('400');
    await page.getByTestId('ph-width').press('Enter');
    await expect.poll(async () => (await previewSize(page)).width).toBe(400);
  });
});

test.describe('placeholders — getting them out', () => {
  test('downloads one SVG and one PNG of the right size', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/placeholders/');
    await toImageMode(page);
    await page.getByTestId('ph-width').fill('320');
    await page.getByTestId('ph-width').press('Enter');

    const svg = await downloadBytes(page, () => page.getByTestId('ph-download').click());
    expect(svg.name).toBe('solid-320x180.svg');
    expect(svg.bytes.toString('utf8')).toContain('width="320"');

    await page.getByTestId('ph-format').selectOption('png');
    const png = await downloadBytes(page, () => page.getByTestId('ph-download').click());
    expect(png.name).toBe('solid-320x180.png');
    expect(png.bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(true);

    expect(await app.dumpAll()).toEqual(before);
  });

  test('zips a batch of three, named and ordered', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/placeholders/');
    await toImageMode(page);
    await page.getByTestId('ph-gen-flow').click();
    await page.getByTestId('ph-batch').fill('3');

    const archive = await downloadBytes(page, () => page.getByTestId('ph-download-batch').click());
    expect(archive.name).toBe('flow-1200x675-x3.zip');

    const entries = zipEntries(new Uint8Array(archive.bytes));
    expect(entries.map((e) => e.name)).toEqual([
      'flow-1200x675-1.svg',
      'flow-1200x675-2.svg',
      'flow-1200x675-3.svg',
    ]);
    // Three different pictures, not the same one three times.
    const bodies = entries.map((e) => new TextDecoder().decode(e.data));
    expect(new Set(bodies).size).toBe(3);
    for (const body of bodies) expect(body).toContain('<svg xmlns=');

    expect(await app.dumpAll()).toEqual(before);
  });

  test('says the photo links leave the app', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/placeholders/');
    await toImageMode(page);
    await page.getByTestId('ph-links-card').getByText('Real photos, elsewhere').click();
    await expect(page.getByTestId('ph-links-card')).toContainText('external sites');
    await expect(page.getByTestId('ph-links-card').getByRole('link', { name: 'Unsplash' })).toHaveAttribute(
      'rel',
      /noreferrer/
    );
  });
});
