/**
 * Phase 7 (Raster image editor) — session-only BY DESIGN: binary image data
 * cannot round-trip the JSON data layer, so the editor never touches
 * IndexedDB. Every test here therefore pins the strongest invariant this app
 * has: an entire import → edit → export session leaves the database
 * byte-identical. EXIF behavior is verified by re-parsing the actual
 * exported bytes with exifr (the same parser the app uses); compositing is
 * verified by decoding exported PNGs and probing pixels.
 *
 * Layer semantics under test (docs/dev/plans/TODO cleanup): the first image
 * sets the canvas; blank canvases; per-layer effects (a crop/eraser nested
 * under an image touches only that image, at top level everything below);
 * opacity + blend modes; drag/nest in the layer tree; zoom; canvas resize;
 * export name + format.
 */
import { readFileSync } from 'node:fs';
import exifr from 'exifr';
import piexif from 'piexifjs';
import { test, expect } from './helpers/app';

type P = import('@playwright/test').Page;

async function makeImage(page: P, mime: 'image/png' | 'image/jpeg', width: number, height: number, color = '#2266aa'): Promise<Buffer> {
  const dataUrl = await page.evaluate(
    ([m, w, h, c]) => {
      const canvas = document.createElement('canvas');
      canvas.width = w as number;
      canvas.height = h as number;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = c as string;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return canvas.toDataURL(m as string, 0.95);
    },
    [mime, width, height, color] as const
  );
  return Buffer.from(dataUrl.split(',')[1]!, 'base64');
}

/**
 * A JPEG fixture that actually CARRIES metadata, built with piexifjs — an
 * Artist tag AND a GPS position, so the "GPS never survives" assertions have
 * something real to catch (an export that copied the source EXIF through
 * would fail them).
 */
function withExif(jpeg: Buffer, artist: string): Buffer {
  const exifBytes = piexif.dump({
    '0th': { [piexif.ImageIFD.Artist]: artist },
    GPS: {
      [piexif.GPSIFD.GPSLatitudeRef]: 'N',
      [piexif.GPSIFD.GPSLatitude]: [[51, 1], [3, 1], [0, 1]],
      [piexif.GPSIFD.GPSLongitudeRef]: 'W',
      [piexif.GPSIFD.GPSLongitude]: [[114, 1], [4, 1], [0, 1]],
    },
  });
  return Buffer.from(piexif.insert(exifBytes, jpeg.toString('binary')), 'binary');
}

const isPng = (buf: Buffer): boolean => buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
const isJpeg = (buf: Buffer): boolean => buf[0] === 0xff && buf[1] === 0xd8;
const pngSize = (buf: Buffer): { w: number; h: number } => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });

async function downloadBytes(page: P, trigger: () => Promise<void>): Promise<{ name: string; bytes: Buffer }> {
  const downloadPromise = page.waitForEvent('download');
  await trigger();
  const download = await downloadPromise;
  return { name: download.suggestedFilename(), bytes: readFileSync(await download.path()) };
}

/** Decode an exported PNG in-page and sample pixels at the given points. */
async function probePixels(page: P, png: Buffer, points: [number, number][]): Promise<number[][]> {
  return page.evaluate(
    async ([b64, pts]) => {
      const im = new Image();
      im.src = 'data:image/png;base64,' + (b64 as string);
      await im.decode();
      const c = document.createElement('canvas');
      c.width = im.width;
      c.height = im.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(im, 0, 0);
      return (pts as [number, number][]).map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data]);
    },
    [png.toString('base64'), points] as const
  );
}

async function importImage(app: { page: P }, name: string, mimeType: string, buffer: Buffer) {
  await app.page.getByTestId('ie-file').setInputFiles({ name, mimeType, buffer });
  await expect(app.page.getByTestId('ie-canvas')).toBeVisible();
}

/** Real pointer drag across the canvas in fractions of its box. */
async function dragOnCanvas(page: P, from: [number, number], to: [number, number]) {
  // Earlier clicks (download, tool buttons) may have scrolled the canvas out
  // of the viewport — mouse events at off-screen coordinates hit nothing.
  await page.getByTestId('ie-canvas').scrollIntoViewIfNeeded();
  const box = (await page.getByTestId('ie-canvas').boundingBox())!;
  const at = (fx: number, fy: number): [number, number] => [box.x + box.width * fx, box.y + box.height * fy];
  await page.mouse.move(...at(...from));
  await page.mouse.down();
  await page.mouse.move(...at((from[0] + to[0]) / 2, (from[1] + to[1]) / 2), { steps: 3 });
  await page.mouse.move(...at(...to), { steps: 3 });
  await page.mouse.up();
}

const layerRows = (page: P) => page.getByTestId('ie-layer');
const rowNamed = (page: P, text: string) => page.getByTestId('ie-layer').filter({ hasText: text });

test.describe('image editor', () => {
  test('first image sets the canvas; effects nest under it; export dims + ZERO writes all session', async ({ app }) => {
    const { page } = app;
    // Snapshot BEFORE navigating so loading the editor page itself is inside
    // the zero-write window.
    const before = await app.dumpAll();
    await app.goto('/tools/image-editor/');

    await importImage(app, 'sample.png', 'image/png', await makeImage(page, 'image/png', 40, 30));
    await expect(page.getByTestId('ie-info')).toContainText('40 × 30px');
    await expect(layerRows(page)).toHaveCount(1);
    // The imported image is selected, so new marks nest under it.
    await expect(page.getByTestId('ie-target')).toContainText('“sample.png” only');

    // Brush stroke → child of the image.
    await dragOnCanvas(page, [0.2, 0.2], [0.8, 0.6]);
    await expect(layerRows(page)).toHaveCount(2);
    await expect(rowNamed(page, 'brush')).toHaveAttribute('data-depth', '1');

    // Export carries the source name (stem) and the canvas dimensions.
    const first = await downloadBytes(page, () => page.getByTestId('ie-download').click());
    expect(first.name).toBe('sample.png');
    expect(isPng(first.bytes)).toBe(true);
    expect(pngSize(first.bytes)).toEqual({ w: 40, h: 30 });

    // Export name + format are user-set.
    await page.getByTestId('ie-export-name').fill('annotated');
    await page.getByTestId('ie-format').selectOption('jpg');
    const jpg = await downloadBytes(page, () => page.getByTestId('ie-download').click());
    expect(jpg.name).toBe('annotated.jpg');
    expect(isJpeg(jpg.bytes)).toBe(true);

    // THE invariant: the entire session wrote nothing.
    expect(await app.dumpAll()).toEqual(before);
  });

  test('blank canvas start, canvas resize, zoom', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/image-editor/');
    const before = await app.dumpAll();

    await page.getByTestId('ie-blank-w').fill('64');
    await page.getByTestId('ie-blank-h').fill('48');
    await page.getByTestId('ie-blank-create').click();
    await expect(page.getByTestId('ie-info')).toContainText('64 × 48px');
    await expect(page.getByTestId('ie-exif-empty')).toContainText('blank canvas');

    // Zoom changes the on-screen size, never the document.
    await page.getByTestId('ie-zoom-100').click();
    const w100 = (await page.getByTestId('ie-canvas').boundingBox())!.width;
    await page.getByTestId('ie-zoom-in').click();
    await expect.poll(async () => (await page.getByTestId('ie-canvas').boundingBox())!.width).toBeGreaterThan(w100 * 1.2);
    await expect(page.getByTestId('ie-info')).toContainText('64 × 48px');

    // Resize the canvas: exported dims follow.
    await page.getByTestId('ie-canvas-w').fill('100');
    await page.getByTestId('ie-canvas-h').fill('20');
    await page.getByTestId('ie-canvas-resize').click();
    await expect(page.getByTestId('ie-info')).toContainText('100 × 20px');
    const png = await downloadBytes(page, () => page.getByTestId('ie-download').click());
    expect(png.name).toBe('image.png');
    expect(pngSize(png.bytes)).toEqual({ w: 100, h: 20 });
    // Blank white background exported opaque white.
    const [px] = await probePixels(page, png.bytes, [[50, 10]]);
    expect(px).toEqual([255, 255, 255, 255]);

    expect(await app.dumpAll()).toEqual(before);
  });

  test('a crop under an image crops only that image; at top level it crops everything below', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/image-editor/');
    const before = await app.dumpAll();

    // Base 60×40 blue; a second red 60×40 image layer on top.
    await importImage(app, 'blue.png', 'image/png', await makeImage(page, 'image/png', 60, 40, '#0000ff'));
    await page.getByTestId('ie-add-image').setInputFiles({
      name: 'red.png',
      mimeType: 'image/png',
      buffer: await makeImage(page, 'image/png', 60, 40, '#ff0000'),
    });
    await expect(layerRows(page)).toHaveCount(2);

    // Select the RED image and crop it to its left half (numeric path).
    await rowNamed(page, 'red.png').getByTestId('ie-layer-select').click();
    await page.getByTestId('ie-tool-crop').click();
    await page.getByTestId('ie-crop-x').fill('0');
    await page.getByTestId('ie-crop-y').fill('0');
    await page.getByTestId('ie-crop-w').fill('30');
    await page.getByTestId('ie-crop-h').fill('40');
    await page.getByTestId('ie-crop-stage').click();
    await page.getByTestId('ie-apply-crop').click();
    await expect(rowNamed(page, 'crop')).toHaveAttribute('data-depth', '1');
    // Canvas is untouched (60×40); left shows red, right shows the blue below.
    await expect(page.getByTestId('ie-info')).toContainText('60 × 40px');
    let png = await downloadBytes(page, () => page.getByTestId('ie-download').click());
    expect(pngSize(png.bytes)).toEqual({ w: 60, h: 40 });
    let [left, right] = await probePixels(page, png.bytes, [
      [15, 20],
      [45, 20],
    ]);
    expect(left!.slice(0, 3)).toEqual([255, 0, 0]);
    expect(right!.slice(0, 3)).toEqual([0, 0, 255]);

    // Move the crop to top level (⤴): now it clips everything below → the
    // right half becomes transparent (checkerboard, alpha 0 in the PNG).
    await rowNamed(page, 'crop').getByTestId('ie-layer-unnest').click();
    await expect(rowNamed(page, 'crop')).toHaveAttribute('data-depth', '0');
    png = await downloadBytes(page, () => page.getByTestId('ie-download').click());
    [left, right] = await probePixels(page, png.bytes, [
      [15, 20],
      [45, 20],
    ]);
    expect(left!.slice(0, 3)).toEqual([255, 0, 0]);
    expect(right![3]).toBe(0);

    // Deleting the crop layer un-crops (non-destructive).
    await rowNamed(page, 'crop').getByTestId('ie-layer-delete').click();
    png = await downloadBytes(page, () => page.getByTestId('ie-download').click());
    [right] = await probePixels(page, png.bytes, [[45, 20]]);
    expect(right!.slice(0, 3)).toEqual([255, 0, 0]);

    expect(await app.dumpAll()).toEqual(before);
  });

  test('eraser scoping and drag-to-nest in the layer tree', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/image-editor/');
    const before = await app.dumpAll();
    await importImage(app, 'blue.png', 'image/png', await makeImage(page, 'image/png', 60, 40, '#0000ff'));
    await page.getByTestId('ie-add-image').setInputFiles({
      name: 'red.png',
      mimeType: 'image/png',
      buffer: await makeImage(page, 'image/png', 60, 40, '#ff0000'),
    });
    // Deselect → the eraser goes to TOP level and erases through both images.
    await page.getByTestId('ie-deselect').click();
    await expect(page.getByTestId('ie-target')).toContainText('top level');
    await page.getByTestId('ie-tool-eraser').click();
    await page.getByTestId('ie-size').fill('10');
    await dragOnCanvas(page, [0.1, 0.5], [0.9, 0.5]);
    await expect(rowNamed(page, 'eraser')).toHaveAttribute('data-depth', '0');
    let png = await downloadBytes(page, () => page.getByTestId('ie-download').click());
    let [onStroke] = await probePixels(page, png.bytes, [[30, 20]]);
    expect(onStroke![3]).toBe(0); // fully transparent: both images punched

    // Drag the eraser row onto the MIDDLE of red.png's row (the "into" zone)
    // → it now erases only the red layer, so the blue below shows through
    // the hole. Manual mouse steps so HTML5 drag events fire in Chromium.
    await rowNamed(page, 'eraser').scrollIntoViewIfNeeded();
    const src = (await rowNamed(page, 'eraser').boundingBox())!;
    await page.mouse.move(src.x + 12, src.y + src.height / 2);
    await page.mouse.down();
    await page.mouse.move(src.x + 16, src.y + src.height / 2 + 3);
    await page.mouse.move(src.x + 20, src.y + src.height / 2 + 6);
    const tb = (await rowNamed(page, 'red.png').boundingBox())!;
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect(rowNamed(page, 'eraser')).toHaveAttribute('data-depth', '1');
    png = await downloadBytes(page, () => page.getByTestId('ie-download').click());
    [onStroke] = await probePixels(page, png.bytes, [[30, 20]]);
    expect(onStroke!.slice(0, 3)).toEqual([0, 0, 255]);
    expect(onStroke![3]).toBe(255);

    expect(await app.dumpAll()).toEqual(before);
  });

  test('opacity and blend modes composite as expected', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/image-editor/');
    const before = await app.dumpAll();
    await importImage(app, 'grey.png', 'image/png', await makeImage(page, 'image/png', 40, 40, '#808080'));
    await page.getByTestId('ie-add-image').setInputFiles({
      name: 'white.png',
      mimeType: 'image/png',
      buffer: await makeImage(page, 'image/png', 40, 40, '#ffffff'),
    });
    // The white layer is selected (last added). 50% opacity over grey → ~192.
    await page.getByTestId('ie-sel-opacity').fill('50');
    let png = await downloadBytes(page, () => page.getByTestId('ie-download').click());
    let [px] = await probePixels(page, png.bytes, [[20, 20]]);
    expect(px![0]).toBeGreaterThan(180);
    expect(px![0]).toBeLessThan(205);

    // Multiply with white leaves the grey unchanged; back to 100% first.
    await page.getByTestId('ie-sel-opacity').fill('100');
    await page.getByTestId('ie-sel-blend').selectOption('multiply');
    await expect(rowNamed(page, 'white.png')).toContainText('multiply');
    png = await downloadBytes(page, () => page.getByTestId('ie-download').click());
    [px] = await probePixels(page, png.bytes, [[20, 20]]);
    expect(px![0]).toBeGreaterThan(120);
    expect(px![0]).toBeLessThan(136);

    // Every mode in the list is selectable and renders without errors.
    for (const mode of ['overlay', 'soft-light', 'hard-light', 'color', 'normal']) {
      await page.getByTestId('ie-sel-blend').selectOption(mode);
    }
    png = await downloadBytes(page, () => page.getByTestId('ie-download').click());
    [px] = await probePixels(page, png.bytes, [[20, 20]]);
    expect(px![0]).toBe(255); // normal again: white on top

    expect(await app.dumpAll()).toEqual(before);
  });

  test('blank canvas background is a fill layer; fill under an image tints only the image', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/image-editor/');
    const before = await app.dumpAll();
    await page.getByTestId('ie-blank-w').fill('60');
    await page.getByTestId('ie-blank-h').fill('40');
    await page.getByTestId('ie-blank-create').click();
    await expect(rowNamed(page, 'Background')).toHaveCount(1);
    // Add a blue image at the top-left half, then a color fill under it.
    await page.getByTestId('ie-add-image').setInputFiles({
      name: 'blue.png',
      mimeType: 'image/png',
      buffer: await makeImage(page, 'image/png', 30, 40, '#0000ff'),
    });
    await page.getByTestId('ie-color').fill('#ff0000');
    await page.getByTestId('ie-add-fill').click();
    await expect(rowNamed(page, 'Color fill')).toHaveAttribute('data-depth', '1');
    let png = await downloadBytes(page, () => page.getByTestId('ie-download').click());
    let [onImage, offImage] = await probePixels(page, png.bytes, [
      [15, 20],
      [45, 20],
    ]);
    expect(onImage!.slice(0, 3)).toEqual([255, 0, 0]); // tinted red
    expect(offImage!.slice(0, 3)).toEqual([255, 255, 255]); // background fill layer, untouched
    // Hiding the background layer makes the canvas transparent there.
    await rowNamed(page, 'Background').getByTestId('ie-layer-vis').click();
    png = await downloadBytes(page, () => page.getByTestId('ie-download').click());
    [offImage] = await probePixels(page, png.bytes, [[45, 20]]);
    expect(offImage![3]).toBe(0);
    expect(await app.dumpAll()).toEqual(before);
  });

  test('groups: images nest into groups by drag-and-drop; the group composites as one', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/image-editor/');
    const before = await app.dumpAll();
    await importImage(app, 'base.png', 'image/png', await makeImage(page, 'image/png', 60, 40, '#0000ff'));
    await page.getByTestId('ie-deselect').click();
    await page.getByTestId('ie-add-group').click();
    await expect(rowNamed(page, 'Group')).toHaveCount(1);

    // Drag the image row onto the MIDDLE of the group row → nested inside.
    await rowNamed(page, 'base.png').scrollIntoViewIfNeeded();
    const src = (await rowNamed(page, 'base.png').boundingBox())!;
    await page.mouse.move(src.x + 12, src.y + src.height / 2);
    await page.mouse.down();
    await page.mouse.move(src.x + 16, src.y + src.height / 2 + 3);
    const tb = (await rowNamed(page, 'Group').boundingBox())!;
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect(rowNamed(page, 'base.png')).toHaveAttribute('data-depth', '1');

    // Group opacity applies to the whole stack inside it.
    await rowNamed(page, 'Group').getByTestId('ie-layer-select').click();
    await page.getByTestId('ie-sel-opacity').fill('50');
    const png = await downloadBytes(page, () => page.getByTestId('ie-download').click());
    const [px] = await probePixels(page, png.bytes, [[30, 20]]);
    expect(px![2]).toBe(255);
    expect(px![3]).toBeGreaterThan(100);
    expect(px![3]).toBeLessThan(160); // ~50% alpha
    // ⤴ moves it back out; wrapping selects a new group around it.
    await rowNamed(page, 'base.png').getByTestId('ie-layer-unnest').click();
    await expect(rowNamed(page, 'base.png')).toHaveAttribute('data-depth', '0');
    await rowNamed(page, 'base.png').getByTestId('ie-layer-select').click();
    await page.getByTestId('ie-wrap-group').click();
    await expect(rowNamed(page, 'base.png')).toHaveAttribute('data-depth', '1');
    expect(await app.dumpAll()).toEqual(before);
  });

  test('scale handles resize an image layer (corners keep aspect, edges stretch one axis)', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/image-editor/');
    const before = await app.dumpAll();
    // Canvas 200x120 with a 80x60 image at the origin.
    await page.getByTestId('ie-blank-w').fill('200');
    await page.getByTestId('ie-blank-h').fill('120');
    await page.getByTestId('ie-blank-transparent').check();
    await page.getByTestId('ie-blank-create').click();
    await page.getByTestId('ie-add-image').setInputFiles({
      name: 'img.png',
      mimeType: 'image/png',
      buffer: await makeImage(page, 'image/png', 80, 60, '#0000ff'),
    });
    await page.getByTestId('ie-tool-move').click();
    await page.getByTestId('ie-zoom-100').click();
    await page.getByTestId('ie-canvas').scrollIntoViewIfNeeded();
    const box = (await page.getByTestId('ie-canvas').boundingBox())!;
    const at = (x: number, y: number): [number, number] => [box.x + (x / 200) * box.width, box.y + (y / 120) * box.height];

    // SE corner (80,60) → (160,130): aspect-locked doubling.
    await page.mouse.move(...at(80, 60));
    await page.mouse.down();
    await page.mouse.move(...at(120, 95), { steps: 4 });
    await page.mouse.move(...at(160, 120), { steps: 4 });
    await page.mouse.up();
    await expect(page.getByTestId('ie-sel-w')).toHaveValue('160');
    await expect(page.getByTestId('ie-sel-h')).toHaveValue('120');

    // E edge (160, 60) → x=100: width only.
    await page.mouse.move(...at(160, 60));
    await page.mouse.down();
    await page.mouse.move(...at(100, 61), { steps: 4 });
    await page.mouse.up();
    await expect(page.getByTestId('ie-sel-w')).toHaveValue('100');
    await expect(page.getByTestId('ie-sel-h')).toHaveValue('120');

    const png = await downloadBytes(page, () => page.getByTestId('ie-download').click());
    const [inside, outside] = await probePixels(page, png.bytes, [
      [90, 100],
      [150, 100],
    ]);
    expect(inside!.slice(0, 3)).toEqual([0, 0, 255]);
    expect(outside![3]).toBe(0);
    expect(await app.dumpAll()).toEqual(before);
  });

  test('exports strip metadata by default (JPG and PNG)', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/image-editor/');
    const before = await app.dumpAll();

    const jpegWithExif = withExif(await makeImage(page, 'image/jpeg', 32, 24), 'Original Author');
    // Prove the fixture really carries GPS, so the null assertions below bite.
    const source = (await exifr.parse(jpegWithExif)) as Record<string, unknown>;
    expect(source.Artist).toBe('Original Author');
    expect(typeof source.latitude).toBe('number');
    await importImage(app, 'photo.jpg', 'image/jpeg', jpegWithExif);

    await expect(page.getByTestId('ie-exif-details')).toBeVisible();
    await page.getByTestId('ie-exif-details').locator('summary').click();
    await expect(page.getByTestId('ie-exif-details')).toContainText('Original Author');

    await page.getByTestId('ie-format').selectOption('jpg');
    const { bytes } = await downloadBytes(page, () => page.getByTestId('ie-download').click());
    expect(isJpeg(bytes)).toBe(true);
    const parsed = (await exifr.parse(bytes).catch(() => null)) as Record<string, unknown> | null;
    expect(parsed?.Artist ?? null).toBeNull();
    expect(parsed?.latitude ?? null).toBeNull();

    expect(await app.dumpAll()).toEqual(before);
  });

  test('edited fields are embedded in JPG exports; GPS never survives', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/image-editor/');
    const before = await app.dumpAll();

    const jpeg = withExif(await makeImage(page, 'image/jpeg', 32, 24), 'Original Author');
    await importImage(app, 'photo.jpg', 'image/jpeg', jpeg);

    await page.getByTestId('ie-meta-edit').check();
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
    expect(parsed.latitude ?? null).toBeNull();
    expect(parsed.GPSLatitude ?? null).toBeNull();

    // A PNG export ignores the embed option entirely.
    await page.getByTestId('ie-format').selectOption('png');
    const png = await downloadBytes(page, () => page.getByTestId('ie-download').click());
    expect(isPng(png.bytes)).toBe(true);
    const pngParsed = (await exifr.parse(png.bytes).catch(() => null)) as Record<string, unknown> | null;
    expect(pngParsed?.Artist ?? null).toBeNull();

    expect(await app.dumpAll()).toEqual(before);
  });

  test('arrows, text, region adjustments, image rotation; deleting layers', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/image-editor/');
    const before = await app.dumpAll();
    await importImage(app, 'base.png', 'image/png', await makeImage(page, 'image/png', 60, 40));

    // Rotate the selected image layer: its bounds swap; the canvas does not.
    await page.getByTestId('ie-rotate-cw').click();
    await expect(page.getByTestId('ie-sel-w')).toHaveValue('40');
    await expect(page.getByTestId('ie-sel-h')).toHaveValue('60');
    await expect(page.getByTestId('ie-info')).toContainText('60 × 40px');

    await page.getByTestId('ie-deselect').click();
    await page.getByTestId('ie-tool-arrow').click();
    await dragOnCanvas(page, [0.1, 0.1], [0.8, 0.8]);
    await page.getByTestId('ie-tool-text').click();
    await page.getByTestId('ie-text').fill('Note!');
    await page.getByTestId('ie-canvas').scrollIntoViewIfNeeded();
    const box = (await page.getByTestId('ie-canvas').boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    // Placing text selects it; deselect so the blur goes to top level.
    await page.getByTestId('ie-deselect').click();
    await page.getByTestId('ie-tool-blur').click();
    await dragOnCanvas(page, [0.2, 0.2], [0.6, 0.6]);

    await expect(layerRows(page)).toHaveCount(4);
    await expect(layerRows(page).nth(0)).toContainText('blur');
    await expect(layerRows(page).nth(1)).toContainText('“Note!”');
    await expect(layerRows(page).nth(2)).toContainText('arrow');
    await expect(layerRows(page).nth(3)).toContainText('base.png');

    await layerRows(page).nth(0).getByTestId('ie-layer-delete').click();
    await expect(layerRows(page)).toHaveCount(3);
    // Keyboard path: text layer coordinates are editable fields.
    await rowNamed(page, 'Note!').getByTestId('ie-layer-select').click();
    await page.getByTestId('ie-sel-x').fill('10');
    await expect(page.getByTestId('ie-sel-x')).toHaveValue('10');

    expect(await app.dumpAll()).toEqual(before);
  });
});
