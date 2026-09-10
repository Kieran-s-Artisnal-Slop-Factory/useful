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

/**
 * Every form control on the page that has no accessible name.
 *
 * The registry sweep in a11y.spec.ts audits each route's INITIAL render only,
 * so controls behind an {#if} never reach it. Tools that gate most of their UI
 * carry this check themselves, against the revealed page.
 */
async function unnamedControls(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(() => {
    const bad: string[] = [];
    const controls = document.querySelectorAll('main input, main select, main textarea, main button');
    for (const el of Array.from(controls)) {
      const node = el as HTMLInputElement;
      const named =
        (node.labels && node.labels.length > 0) ||
        Boolean(node.getAttribute('aria-label')) ||
        Boolean(node.getAttribute('aria-labelledby')) ||
        Boolean(node.getAttribute('title')) ||
        (node.tagName === 'BUTTON' && (node.textContent ?? '').trim().length > 0);
      if (!named) bad.push(node.tagName.toLowerCase() + '[' + (node.getAttribute('data-testid') ?? 'no-testid') + ']');
    }
    return bad;
  });
}

test.describe('color extractor', () => {
  /**
   * Every image here is built from FLAT vertical bands at exactly the
   * sampler's own width (192 px on the long edge), so the downscale is a 1:1
   * copy with no interpolated boundary pixels. That makes both the recovered
   * hexes and the reported shares exact rather than approximate, which is
   * what lets these assertions be equalities.
   */
  async function makeBands(
    page: import('@playwright/test').Page,
    colors: string[],
    width = 192,
    height = 60
  ): Promise<Buffer> {
    const dataUrl = await page.evaluate(
      ([list, w, h]) => {
        const canvas = document.createElement('canvas');
        canvas.width = w as number;
        canvas.height = h as number;
        const ctx = canvas.getContext('2d')!;
        const band = (w as number) / (list as string[]).length;
        (list as string[]).forEach((hex, i) => {
          ctx.fillStyle = hex;
          ctx.fillRect(i * band, 0, band, h as number);
        });
        return canvas.toDataURL('image/png');
      },
      [colors, width, height] as const
    );
    return Buffer.from(dataUrl.split(',')[1]!, 'base64');
  }

  /** Three bands in a deliberate 3:2:1 area ratio (96 / 64 / 32 of 192 px). */
  async function makeThreeUneven(page: import('@playwright/test').Page): Promise<Buffer> {
    const dataUrl = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 192;
      canvas.height = 60;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#c0392b';
      ctx.fillRect(0, 0, 96, 60);
      ctx.fillStyle = '#2980b9';
      ctx.fillRect(96, 0, 64, 60);
      ctx.fillStyle = '#f1c40f';
      ctx.fillRect(160, 0, 32, 60);
      return canvas.toDataURL('image/png');
    });
    return Buffer.from(dataUrl.split(',')[1]!, 'base64');
  }

  test('recovers the colors and their shares, and writes nothing', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/color-extractor/');
    const before = await app.dumpAll();

    await page.getByTestId('cx-file').setInputFiles({
      name: 'three.png',
      mimeType: 'image/png',
      buffer: await makeThreeUneven(page),
    });

    await expect(page.getByTestId('cx-image-info')).toContainText('192 × 60');
    const swatches = page.getByTestId('cx-swatch');
    await expect(swatches).toHaveCount(3);

    // Sorted by how much of the image each covers, biggest first.
    await expect(swatches.nth(0)).toHaveAttribute('data-hex', '#c0392b');
    await expect(swatches.nth(1)).toHaveAttribute('data-hex', '#2980b9');
    await expect(swatches.nth(2)).toHaveAttribute('data-hex', '#f1c40f');
    await expect(swatches.nth(0)).toContainText('50.0%');
    await expect(swatches.nth(1)).toContainText('33.3%');
    await expect(swatches.nth(2)).toContainText('16.7%');

    // Six were asked for; the image only has three to give, and it says so
    // instead of padding the palette out with black.
    await expect(page.getByTestId('cx-count')).toHaveValue('6');
    await expect(page.getByTestId('cx-short')).toContainText('3 distinct colors');

    // Every spelling of the top color is offered, and copying is per-value.
    await expect(page.getByTestId('cx-copy-hex-0')).toContainText('#c0392b');
    await expect(page.getByTestId('cx-copy-rgb-0')).toContainText('rgb(192 57 43)');

    expect(await app.dumpAll()).toEqual(before);
  });

  test('the count drives the clustering, and the same count returns the same palette', async ({
    app,
  }) => {
    const { page } = app;
    await app.goto('/tools/color-extractor/');
    const before = await app.dumpAll();

    await page.getByTestId('cx-file').setInputFiles({
      name: 'six.png',
      mimeType: 'image/png',
      buffer: await makeBands(page, ['#e74c3c', '#8e44ad', '#2980b9', '#16a085', '#f39c12', '#2c3e50']),
    });
    const hexes = () =>
      page.getByTestId('cx-swatch').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.hex));

    // All six recovered exactly, in the order the fixed seed produces. Pinned
    // to literals rather than to the page's own earlier output, so six
    // identical blacks could not satisfy this.
    const SIX_AT_6 = ['#16a085', '#8e44ad', '#f39c12', '#e74c3c', '#2980b9', '#2c3e50'];
    await expect(page.getByTestId('cx-swatch')).toHaveCount(6);
    expect(await hexes()).toEqual(SIX_AT_6);

    // Fewer clusters MERGES rather than truncating: not one of these three is
    // among the six inputs — each is the mean of a pair. A regression that
    // simply kept the three most common originals would fail here.
    await page.getByTestId('cx-count').fill('3');
    await expect(page.getByTestId('cx-swatch')).toHaveCount(3);
    const merged = await hexes();
    expect(merged).toEqual(['#1e91a1', '#5e447d', '#ee7730']);
    for (const hex of merged) expect(SIX_AT_6).not.toContain(hex);
    await expect(page.getByTestId('cx-short')).toHaveCount(0);

    // The seed is fixed, so coming back to six lands exactly where it started.
    await page.getByTestId('cx-count').fill('6');
    await expect(page.getByTestId('cx-swatch')).toHaveCount(6);
    expect(await hexes()).toEqual(SIX_AT_6);

    expect(await app.dumpAll()).toEqual(before);
  });

  test('an image can be pasted, and a non-image is refused in words', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/color-extractor/');
    const before = await app.dumpAll();

    // A file that is not an image at all: named, not silently ignored.
    await page.getByTestId('cx-file').setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('this is not a picture'),
    });
    await expect(page.getByTestId('cx-error')).toContainText('notes.txt');
    await expect(page.getByTestId('cx-swatch')).toHaveCount(0);

    // A paste anywhere on the page is accepted, which no other tool here does.
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 192;
      canvas.height = 60;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#1abc9c';
      ctx.fillRect(0, 0, 96, 60);
      ctx.fillStyle = '#34495e';
      ctx.fillRect(96, 0, 96, 60);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
      const transfer = new DataTransfer();
      transfer.items.add(new File([blob!], 'pasted.png', { type: 'image/png' }));
      window.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true })
      );
    });

    const swatches = page.getByTestId('cx-swatch');
    await expect(swatches).toHaveCount(2);
    await expect(page.getByTestId('cx-error')).toHaveCount(0);
    // Both bands are half the image, so a share assertion alone would hold for
    // any two colours at all — the hexes are what prove the paste was read.
    await expect(swatches.nth(0)).toHaveAttribute('data-hex', '#34495e');
    await expect(swatches.nth(1)).toHaveAttribute('data-hex', '#1abc9c');
    await expect(swatches.nth(0)).toContainText('50.0%');
    await expect(swatches.nth(1)).toContainText('50.0%');

    expect(await app.dumpAll()).toEqual(before);
  });

  test('every control has an accessible name, including the ones behind the image gate', async ({
    app,
  }) => {
    const { page } = app;
    await app.goto('/tools/color-extractor/');
    // The registry-driven sweep in a11y.spec.ts only audits a route's initial
    // render, and almost everything on this page is gated on having an image
    // — so the gate has to be opened here or these controls are never checked.
    await page.getByTestId('cx-file').setInputFiles({
      name: 'three.png',
      mimeType: 'image/png',
      buffer: await makeThreeUneven(page),
    });
    await expect(page.getByTestId('cx-swatch')).toHaveCount(3);
    expect(await unnamedControls(page)).toEqual([]);
  });

  test('builds a theme in the Themes format and hands it over intact', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/color-extractor/');
    const before = await app.dumpAll();

    await page.getByTestId('cx-file').setInputFiles({
      name: 'three.png',
      mimeType: 'image/png',
      buffer: await makeThreeUneven(page),
    });
    await expect(page.getByTestId('cx-swatch')).toHaveCount(3);

    // The most common chromatic color leads; the most saturated accents.
    await expect(page.getByTestId('cx-role-primary')).toHaveValue('#c0392b');
    await expect(page.getByTestId('cx-role-accent')).toHaveValue('#f1c40f');
    // No near-grey in this image, so the surface roles derive rather than
    // putting a saturated color behind every page.
    await expect(page.getByTestId('cx-role-base')).toHaveValue('');

    // The output is the same shape the Themes tool emits, and the same
    // component previews it.
    const css = page.getByTestId('cx-css');
    await expect(css).toContainText('color-scheme: light dark');
    await expect(css).toContainText('--primary: light-dark(#c0392b');
    await expect(css).toContainText('--radius: 8px');
    // Not just that the shared component mounted — that the EXTRACTED theme
    // reached it. "Primary action" is its own hardcoded label and would be
    // there whatever variables it was handed.
    await expect(page.getByTestId('cx-preview')).toBeVisible();
    await expect(page.getByTestId('cx-preview')).toHaveAttribute(
      'style',
      /--primary: light-dark\(#c0392b/
    );
    // Pinned to the light side first: the vars are `light-dark()` pairs, so
    // leaving the preview on "auto" would make the computed colour depend on
    // whatever scheme the browser running the suite happens to prefer.
    await page.getByTestId('cx-scheme-light').check();
    const buttonColor = await page
      .getByTestId('cx-preview')
      .getByText('Primary action')
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(buttonColor).toBe('rgb(192, 57, 43)');

    // Overriding a role is honoured, and the reset returns to the suggestion.
    await page.getByTestId('cx-role-primary').selectOption('#2980b9');
    await expect(css).toContainText('--primary: light-dark(#2980b9');
    await page.getByTestId('cx-roles-reset').click();
    await expect(page.getByTestId('cx-role-primary')).toHaveValue('#c0392b');

    // The hand-off carries the chosen colors to Themes, which seeds from them.
    const link = await page.getByTestId('cx-open-themes').getAttribute('href');
    expect(link).toContain('primary=c0392b');
    expect(link).toContain('accent=f1c40f');

    const downloaded = await downloadBytes(page, () => page.getByTestId('cx-download-theme').click());
    expect(downloaded.name).toBe('theme.css');
    expect(downloaded.bytes.toString('utf8')).toContain('--primary: light-dark(#c0392b');

    expect(await app.dumpAll()).toEqual(before);

    await app.goto(link!);
    await expect(page.getByTestId('th-color-primary')).toHaveValue('#c0392b');
    await expect(page.getByTestId('th-color-accent')).toHaveValue('#f1c40f');
    await expect(page.getByTestId('th-preview')).toBeVisible();
    expect(await app.dumpAll()).toEqual(before);
  });
});
