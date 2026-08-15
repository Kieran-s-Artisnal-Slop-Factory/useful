/**
 * Phase 7 (Raster image editor) — session-only BY DESIGN: binary image data
 * cannot round-trip the JSON data layer, so the editor never touches
 * IndexedDB. Every test here therefore pins the strongest invariant this app
 * has: an entire import → edit → export session leaves the database
 * byte-identical. EXIF behavior is verified by re-parsing the actual
 * exported bytes with exifr (the same parser the app uses).
 */
import { readFileSync } from 'node:fs';
import exifr from 'exifr';
import piexif from 'piexifjs';
import { test, expect } from './helpers/app';

async function makeImage(
  page: import('@playwright/test').Page,
  mime: 'image/png' | 'image/jpeg',
  width: number,
  height: number
): Promise<Buffer> {
  const dataUrl = await page.evaluate(
    ([m, w, h]) => {
      const canvas = document.createElement('canvas');
      canvas.width = w as number;
      canvas.height = h as number;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#2266aa';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#eebb33';
      ctx.fillRect(2, 2, (w as number) / 2, (h as number) / 2);
      return canvas.toDataURL(m as string, 0.95);
    },
    [mime, width, height] as const
  );
  return Buffer.from(dataUrl.split(',')[1]!, 'base64');
}

/** A JPEG fixture that actually CARRIES metadata, built with piexifjs. */
function withExif(jpeg: Buffer, artist: string): Buffer {
  const exifBytes = piexif.dump({ '0th': { [piexif.ImageIFD.Artist]: artist } });
  return Buffer.from(piexif.insert(exifBytes, jpeg.toString('binary')), 'binary');
}

const isPng = (buf: Buffer): boolean =>
  buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
const isJpeg = (buf: Buffer): boolean => buf[0] === 0xff && buf[1] === 0xd8;
const pngSize = (buf: Buffer): { w: number; h: number } => ({
  w: buf.readUInt32BE(16),
  h: buf.readUInt32BE(20),
});

async function downloadBytes(
  page: import('@playwright/test').Page,
  trigger: () => Promise<void>
): Promise<{ name: string; bytes: Buffer }> {
  const downloadPromise = page.waitForEvent('download');
  await trigger();
  const download = await downloadPromise;
  return { name: download.suggestedFilename(), bytes: readFileSync(await download.path()) };
}

async function importImage(
  app: { page: import('@playwright/test').Page },
  name: string,
  mimeType: string,
  buffer: Buffer
) {
  await app.page.getByTestId('ie-file').setInputFiles({ name, mimeType, buffer });
  await expect(app.page.getByTestId('ie-canvas')).toBeVisible();
}

test.describe('image editor', () => {
  test('import → draw → rotate → crop → export: dimensions right, ZERO writes all session', async ({
    app,
  }) => {
    const { page } = app;
    await app.goto('/tools/image-editor/');
    const before = await app.dumpAll();

    await importImage(app, 'sample.png', 'image/png', await makeImage(page, 'image/png', 40, 30));
    await expect(page.getByTestId('ie-info')).toContainText('40 × 30px');

    // Draw a brush stroke with a real pointer drag (brush is the default tool).
    const box = (await page.getByTestId('ie-canvas').boundingBox())!;
    const at = (fx: number, fy: number): [number, number] => [
      box.x + box.width * fx,
      box.y + box.height * fy,
    ];
    await page.mouse.move(...at(0.2, 0.2));
    await page.mouse.down();
    await page.mouse.move(...at(0.5, 0.5), { steps: 4 });
    await page.mouse.move(...at(0.8, 0.6), { steps: 4 });
    await page.mouse.up();
    await expect(page.getByTestId('ie-layer')).toHaveCount(1);
    await expect(page.getByTestId('ie-layer')).toContainText('brush');

    // Export carries the source name and the document dimensions.
    const first = await downloadBytes(page, () => page.getByTestId('ie-download').click());
    expect(first.name).toBe('sample.png');
    expect(isPng(first.bytes)).toBe(true);
    expect(pngSize(first.bytes)).toEqual({ w: 40, h: 30 });

    // Rotate: dimensions swap, annotations ride along (still 1 layer).
    await page.getByTestId('ie-rotate-cw').click();
    await expect(page.getByTestId('ie-info')).toContainText('30 × 40px');
    await expect(page.getByTestId('ie-layer')).toHaveCount(1);
    const rotated = await downloadBytes(page, () => page.getByTestId('ie-download').click());
    expect(pngSize(rotated.bytes)).toEqual({ w: 30, h: 40 });

    // Crop to the top-left quadrant.
    await page.getByTestId('ie-tool-crop').click();
    const box2 = (await page.getByTestId('ie-canvas').boundingBox())!;
    await page.mouse.move(box2.x + 1, box2.y + 1);
    await page.mouse.down();
    await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2, { steps: 3 });
    await page.mouse.up();
    await page.getByTestId('ie-apply-crop').click();
    await expect(page.getByTestId('ie-info')).toContainText('cropped');
    const cropped = await downloadBytes(page, () => page.getByTestId('ie-download').click());
    const size = pngSize(cropped.bytes);
    expect(size.w).toBeLessThanOrEqual(16);
    expect(size.h).toBeLessThanOrEqual(21);

    // Reset undoes crop + rotation losslessly.
    await page.getByTestId('ie-reset-view').click();
    await expect(page.getByTestId('ie-info')).toContainText('40 × 30px');
    await expect(page.getByTestId('ie-layer')).toHaveCount(1);

    // THE invariant: the entire session wrote nothing.
    expect(await app.dumpAll()).toEqual(before);
  });

  test('exports strip metadata by default (JPG and PNG)', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/image-editor/');
    const before = await app.dumpAll();

    const jpegWithExif = withExif(await makeImage(page, 'image/jpeg', 32, 24), 'Original Author');
    await importImage(app, 'photo.jpg', 'image/jpeg', jpegWithExif);

    // The viewer surfaces the source's metadata…
    await expect(page.getByTestId('ie-exif-details')).toBeVisible();
    await page.getByTestId('ie-exif-details').locator('summary').click();
    await expect(page.getByTestId('ie-exif-details')).toContainText('Original Author');

    // …but a default (strip) JPG export carries none of it.
    await page.getByTestId('ie-format').selectOption('jpg');
    const { bytes } = await downloadBytes(page, () => page.getByTestId('ie-download').click());
    expect(isJpeg(bytes)).toBe(true);
    const parsed = (await exifr.parse(bytes).catch(() => null)) as Record<string, unknown> | null;
    expect(parsed?.Artist ?? null).toBeNull();

    expect(await app.dumpAll()).toEqual(before);
  });

  test('edited fields are embedded in JPG exports; GPS never survives', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/image-editor/');
    const before = await app.dumpAll();

    const jpeg = withExif(await makeImage(page, 'image/jpeg', 32, 24), 'Original Author');
    await importImage(app, 'photo.jpg', 'image/jpeg', jpeg);

    await page.getByTestId('ie-meta-edit').check();
    // The artist field is prefilled from the source EXIF.
    await expect(page.getByTestId('ie-exif-artist')).toHaveValue('Original Author');
    await page.getByTestId('ie-exif-artist').fill('Edited Author');
    await page.getByTestId('ie-exif-copyright').fill('© 2026 useful');
    await page.getByTestId('ie-exif-description').fill('Edited in the raster editor');
    await page.getByTestId('ie-exif-date').fill('2026-08-14T09:30');

    await page.getByTestId('ie-format').selectOption('jpg');
    const { bytes } = await downloadBytes(page, () => page.getByTestId('ie-download').click());
    expect(isJpeg(bytes)).toBe(true);

    const parsed = (await exifr.parse(bytes)) as Record<string, unknown>;
    expect(parsed.Artist).toBe('Edited Author');
    expect(parsed.Copyright).toBe('© 2026 useful');
    expect(parsed.ImageDescription).toBe('Edited in the raster editor');
    expect(parsed.DateTimeOriginal).toBeInstanceOf(Date);
    expect((parsed.DateTimeOriginal as Date).getFullYear()).toBe(2026);
    // GPS can never pass through — neither raw tags nor parsed coordinates.
    expect(parsed.latitude ?? null).toBeNull();
    expect(parsed.GPSLatitude ?? null).toBeNull();

    // A PNG export ignores the embed option entirely.
    await page.getByTestId('ie-format').selectOption('png');
    const png = await downloadBytes(page, () => page.getByTestId('ie-download').click());
    expect(isPng(png.bytes)).toBe(true);
    const pngParsed = (await exifr.parse(png.bytes).catch(() => null)) as Record<
      string,
      unknown
    > | null;
    expect(pngParsed?.Artist ?? null).toBeNull();

    expect(await app.dumpAll()).toEqual(before);
  });

  test('arrows, text, region adjustments and the eraser become layers; delete removes them', async ({
    app,
  }) => {
    const { page } = app;
    await app.goto('/tools/image-editor/');
    const before = await app.dumpAll();
    await importImage(app, 'base.png', 'image/png', await makeImage(page, 'image/png', 60, 40));

    const box = (await page.getByTestId('ie-canvas').boundingBox())!;
    const at = (fx: number, fy: number): [number, number] => [
      box.x + box.width * fx,
      box.y + box.height * fy,
    ];
    const drag = async (a: [number, number], b: [number, number]) => {
      await page.mouse.move(...a);
      await page.mouse.down();
      await page.mouse.move(...b, { steps: 3 });
      await page.mouse.up();
    };

    await page.getByTestId('ie-tool-arrow').click();
    await drag(at(0.1, 0.1), at(0.8, 0.8));
    await page.getByTestId('ie-tool-text').click();
    await page.getByTestId('ie-text').fill('Note!');
    await page.mouse.click(...at(0.5, 0.5));
    await page.getByTestId('ie-tool-blur').click();
    await drag(at(0.2, 0.2), at(0.6, 0.6));
    await page.getByTestId('ie-tool-eraser').click();
    await drag(at(0.3, 0.7), at(0.7, 0.7));

    await expect(page.getByTestId('ie-layer')).toHaveCount(4);
    await expect(page.getByTestId('ie-layer').nth(0)).toContainText('eraser');
    await expect(page.getByTestId('ie-layer').nth(1)).toContainText('blur');
    await expect(page.getByTestId('ie-layer').nth(2)).toContainText('“Note!”');
    await expect(page.getByTestId('ie-layer').nth(3)).toContainText('arrow');

    await page.getByTestId('ie-layer').nth(0).getByTestId('ie-layer-delete').click();
    await expect(page.getByTestId('ie-layer')).toHaveCount(3);

    expect(await app.dumpAll()).toEqual(before);
  });
});
