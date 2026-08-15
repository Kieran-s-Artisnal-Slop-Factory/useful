/**
 * Phase 5 (Images) — converter, resizer, compressor. All session-only: the
 * pixels never touch IndexedDB; the ONE sanctioned write is remembering the
 * JPG quality default. Raster fixtures are generated in-page (canvas encodes
 * PNG/JPG/WebP natively); TIFFs come from tools/build-image-fixtures.mjs;
 * AVIF has no in-browser encoder, but it rides the same native-decode branch
 * WebP exercises. Downloads are verified by their actual magic bytes.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './helpers/app';
import { assertIsolatedDelta } from './helpers/oracle';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

const SVG_2_TO_1 =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 1"><rect width="2" height="1" fill="#1e3a5f"/></svg>';

/** A canvas-encoded image as an upload payload. `noise` makes JPEGs chunky. */
async function makeImage(
  page: import('@playwright/test').Page,
  mime: 'image/png' | 'image/jpeg' | 'image/webp',
  width: number,
  height: number,
  noise = false
): Promise<Buffer> {
  const dataUrl = await page.evaluate(
    ([m, w, h, noisy]) => {
      const canvas = document.createElement('canvas');
      canvas.width = w as number;
      canvas.height = h as number;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#c02020';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (noisy) {
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < img.data.length; i += 4) {
          img.data[i] = (i * 2654435761) % 255; // deterministic noise
          img.data[i + 1] = (i * 40503) % 255;
          img.data[i + 2] = (i * 9973) % 255;
        }
        ctx.putImageData(img, 0, 0);
      }
      return canvas.toDataURL(m as string, 0.95);
    },
    [mime, width, height, noise] as const
  );
  return Buffer.from(dataUrl.split(',')[1]!, 'base64');
}

const isPng = (buf: Buffer): boolean => buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
const isJpeg = (buf: Buffer): boolean => buf[0] === 0xff && buf[1] === 0xd8;

async function downloadBytes(
  page: import('@playwright/test').Page,
  trigger: () => Promise<void>
): Promise<{ name: string; bytes: Buffer }> {
  const downloadPromise = page.waitForEvent('download');
  await trigger();
  const download = await downloadPromise;
  const path = await download.path();
  return { name: download.suggestedFilename(), bytes: readFileSync(path) };
}

test.describe('image converter', () => {
  test('PNG → JPG with the constrained matrix, zero DB writes', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/image-converter/');
    const before = await app.dumpAll();

    await page.getByTestId('ic-file').setInputFiles({
      name: 'sample.png',
      mimeType: 'image/png',
      buffer: await makeImage(page, 'image/png', 40, 30),
    });
    await expect(page.getByTestId('ic-input-info')).toContainText('40 × 30px');
    // PNG input may only become JPG.
    await expect(page.getByTestId('ic-target').locator('option')).toHaveCount(1);
    await expect(page.getByTestId('ic-target')).toHaveValue('jpg');
    await expect(page.getByTestId('ic-output-info')).toContainText('sample.jpg');

    const { name, bytes } = await downloadBytes(page, () => page.getByTestId('ic-download').click());
    expect(name).toBe('sample.jpg');
    expect(isJpeg(bytes)).toBe(true);

    expect(await app.dumpAll()).toEqual(before);
  });

  test('JPG → PNG', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/image-converter/');
    await page.getByTestId('ic-file').setInputFiles({
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
      buffer: await makeImage(page, 'image/jpeg', 32, 24),
    });
    await expect(page.getByTestId('ic-target')).toHaveValue('png');
    const { name, bytes } = await downloadBytes(page, () => page.getByTestId('ic-download').click());
    expect(name).toBe('photo.png');
    expect(isPng(bytes)).toBe(true);
  });

  test('WebP (the native-decode path AVIF shares) → PNG or JPG', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/image-converter/');
    await page.getByTestId('ic-file').setInputFiles({
      name: 'anim.webp',
      mimeType: 'image/webp',
      buffer: await makeImage(page, 'image/webp', 25, 15),
    });
    await expect(page.getByTestId('ic-input-info')).toContainText('25 × 15px');
    await expect(page.getByTestId('ic-target').locator('option')).toHaveCount(2);
    const { bytes } = await downloadBytes(page, () => page.getByTestId('ic-download').click());
    expect(isPng(bytes)).toBe(true);
  });

  test('a real AVIF decodes, and the preview keeps the image aspect ratio', async ({ app }) => {
    // Regression: the preview <img> was a stretched flex child — a portrait
    // photo rendered squashed to the preview box's own ratio.
    const { page } = app;
    await app.goto('/tools/image-converter/');
    await page.getByTestId('ic-file').setInputFiles(join(FIXTURES, 'photo-1780071611689-55d7b5ace40a.avif'));
    await expect(page.getByTestId('ic-input-info')).toContainText('px');
    const preview = page.locator('img.preview');
    await expect(preview).toBeVisible();
    const ratios = await preview.evaluate((el) => {
      const img = el as HTMLImageElement;
      const r = img.getBoundingClientRect();
      return { natural: img.naturalWidth / img.naturalHeight, rendered: r.width / r.height };
    });
    expect(ratios.natural).toBeGreaterThan(0);
    expect(Math.abs(ratios.rendered - ratios.natural)).toBeLessThan(0.05);
    const { name, bytes } = await downloadBytes(page, () => page.getByTestId('ic-download').click());
    expect(name).toBe('photo-1780071611689-55d7b5ace40a.png');
    expect(isPng(bytes)).toBe(true);
  });

  test('a tall image previews at its own aspect ratio (not the box ratio)', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/image-converter/');
    await page.getByTestId('ic-file').setInputFiles({
      name: 'tall.png',
      mimeType: 'image/png',
      buffer: await makeImage(page, 'image/png', 100, 300),
    });
    await expect(page.getByTestId('ic-input-info')).toContainText('100 × 300px');
    const rendered = await page.locator('img.preview').evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.width / r.height;
    });
    expect(rendered).toBeGreaterThan(0.3);
    expect(rendered).toBeLessThan(0.37);
  });

  test('SVG rasterizes at the chosen width, keeping its aspect', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/image-converter/');
    await page.getByTestId('ic-file').setInputFiles({
      name: 'diagram.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(SVG_2_TO_1),
    });
    await page.getByTestId('ic-svg-width').fill('300');
    await page.getByTestId('ic-svg-width').blur();
    await expect(page.getByTestId('ic-input-info')).toContainText('300 × 150px');
    const { name, bytes } = await downloadBytes(page, () => page.getByTestId('ic-download').click());
    expect(name).toBe('diagram.png');
    expect(isPng(bytes)).toBe(true);
  });

  test('TIFF decodes through the bundled decoder; broken TIFFs fail gracefully', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/image-converter/');
    await page.getByTestId('ic-file').setInputFiles(join(FIXTURES, 'sample.tiff'));
    await expect(page.getByTestId('ic-input-info')).toContainText('20 × 10px');
    const { bytes } = await downloadBytes(page, () => page.getByTestId('ic-download').click());
    expect(isPng(bytes)).toBe(true);

    await page.getByTestId('ic-file').setInputFiles(join(FIXTURES, 'broken.tiff'));
    await expect(page.getByTestId('ic-error')).toContainText("couldn't be decoded");
    await expect(page.getByTestId('ic-output-info')).toHaveCount(0);
  });

  test('changing the JPG quality remembers it in preferences only, restored on reload', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/image-converter/');
    await page.getByTestId('ic-file').setInputFiles({
      name: 'sample.png',
      mimeType: 'image/png',
      buffer: await makeImage(page, 'image/png', 10, 10),
    });
    const before = await app.dumpAll();

    await page.getByTestId('ic-quality').fill('60');
    await page.getByTestId('ic-quality').blur();
    await expect
      .poll(async () => (await app.get('preferences', 'singleton'))?.convert_jpg_quality)
      .toBe(60);
    assertIsolatedDelta(before, await app.dumpAll(), [{ store: 'preferences', id: 'singleton' }]);

    const after = await app.dumpAll();
    await app.goto('/tools/image-converter/');
    await page.getByTestId('ic-file').setInputFiles({
      name: 'x.png',
      mimeType: 'image/png',
      buffer: await makeImage(page, 'image/png', 10, 10),
    });
    await expect(page.getByTestId('ic-quality')).toHaveValue('60');
    expect(await app.dumpAll()).toEqual(after); // the reload itself wrote nothing
  });
});

test.describe('image resizer', () => {
  test('dimension resize with aspect lock, verified by the output bytes', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/image-resizer/');
    const before = await app.dumpAll();

    await page.getByTestId('ir-file').setInputFiles({
      name: 'photo.png',
      mimeType: 'image/png',
      buffer: await makeImage(page, 'image/png', 40, 30),
    });
    await expect(page.getByTestId('ir-input-info')).toContainText('40 × 30px');

    await page.getByTestId('ir-width').fill('20');
    await expect(page.getByTestId('ir-height')).toHaveValue('15'); // lock derives it
    await expect(page.getByTestId('ir-output-info')).toContainText('20 × 15px');

    // Unlocked, the edges move independently.
    await page.getByTestId('ir-lock').uncheck();
    await page.getByTestId('ir-height').fill('99');
    await expect(page.getByTestId('ir-width')).toHaveValue('20');
    await expect(page.getByTestId('ir-output-info')).toContainText('20 × 99px');

    const { name, bytes } = await downloadBytes(page, () => page.getByTestId('ir-download').click());
    expect(name).toBe('photo.png');
    expect(isPng(bytes)).toBe(true);

    expect(await app.dumpAll()).toEqual(before);
  });

  test('percentage mode scales both edges', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/image-resizer/');
    await page.getByTestId('ir-file').setInputFiles({
      name: 'photo.png',
      mimeType: 'image/png',
      buffer: await makeImage(page, 'image/png', 40, 30),
    });
    await page.getByTestId('ir-mode-percent').check();
    await page.getByTestId('ir-percent').fill('50');
    await expect(page.getByTestId('ir-output-info')).toContainText('20 × 15px');
  });
});

test.describe('image compressor', () => {
  test('JPG recompression shrinks the file; before/after sizes shown', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/image-compressor/');
    const before = await app.dumpAll();

    const original = await makeImage(page, 'image/jpeg', 128, 96, true);
    await page.getByTestId('cp-file').setInputFiles({
      name: 'big.jpg',
      mimeType: 'image/jpeg',
      buffer: original,
    });
    await expect(page.getByTestId('cp-input-info')).toContainText('128 × 96px');

    await page.getByTestId('cp-quality').fill('20');
    await page.getByTestId('cp-quality').blur();
    // Quality edits remember the shared default — allow exactly that delta.
    await expect(page.getByTestId('cp-after')).toBeVisible();

    const { name, bytes } = await downloadBytes(page, () => page.getByTestId('cp-download').click());
    expect(name).toBe('big.jpg');
    expect(isJpeg(bytes)).toBe(true);
    expect(bytes.length).toBeLessThan(original.length);

    assertIsolatedDelta(before, await app.dumpAll(), [{ store: 'preferences', id: 'singleton' }]);
  });

  test('the dimension cap bounds the longest edge', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/image-compressor/');
    await page.getByTestId('cp-file').setInputFiles({
      name: 'wide.png',
      mimeType: 'image/png',
      buffer: await makeImage(page, 'image/png', 120, 40),
    });
    await page.getByTestId('cp-max-edge').fill('60');
    await expect(page.getByTestId('cp-after')).toContainText('60 × 20px');
    const { name, bytes } = await downloadBytes(page, () => page.getByTestId('cp-download').click());
    expect(name).toBe('wide.png');
    expect(isPng(bytes)).toBe(true);
  });

  test('target percent: JPG hits the budget by lowering quality, output under target', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/image-compressor/');
    const before = await app.dumpAll();
    const original = await makeImage(page, 'image/jpeg', 200, 150, true);
    await page.getByTestId('cp-file').setInputFiles({ name: 'noise.jpg', mimeType: 'image/jpeg', buffer: original });
    await expect(page.getByTestId('cp-input-info')).toContainText('200 × 150px');

    await page.getByTestId('cp-target-mode').selectOption('percent');
    await expect(page.getByTestId('cp-target-note')).toContainText('may not be reachable');
    await page.getByTestId('cp-target-percent').fill('40');
    await expect(page.getByTestId('cp-target-outcome')).toContainText('Target reached');
    await expect(page.getByTestId('cp-target-outcome')).toContainText('quality');

    const { bytes } = await downloadBytes(page, () => page.getByTestId('cp-download').click());
    expect(isJpeg(bytes)).toBe(true);
    expect(bytes.length).toBeLessThanOrEqual(Math.floor(original.length * 0.4));
    // Search + export are session-only: no writes at all (no quality edit).
    expect(await app.dumpAll()).toEqual(before);
  });

  test('target size: PNG can only shrink dimensions; impossible targets are reported', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/image-compressor/');
    await page.getByTestId('cp-file').setInputFiles({
      name: 'flat.png',
      mimeType: 'image/png',
      buffer: await makeImage(page, 'image/png', 200, 200),
    });
    await page.getByTestId('cp-target-mode').selectOption('size');
    await expect(page.getByTestId('cp-target-note')).toContainText('PNG is lossless');
    // 1 KB is below what any allowed PNG encode of this image produces… or
    // is reached by shrinking — either way the outcome is stated honestly and
    // the output dimensions are smaller than the input.
    await page.getByTestId('cp-target-kb').fill('1');
    await expect(page.getByTestId('cp-target-outcome')).toBeVisible();
    const outcome = await page.getByTestId('cp-target-outcome').textContent();
    expect(outcome).toMatch(/Target reached|Target NOT reachable/);
    expect(outcome).toContain('scaled to');
    const after = await page.getByTestId('cp-after').textContent();
    expect(after).not.toContain('200 × 200px');
    const { bytes } = await downloadBytes(page, () => page.getByTestId('cp-download').click());
    expect(isPng(bytes)).toBe(true);
  });
});
