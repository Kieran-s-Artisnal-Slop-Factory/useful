/**
 * Phase 8 (Background remover) — the tool is stateless: no store of its own,
 * and the whole session must leave the database byte-identical, so every test
 * here wraps its work in a zero-write window.
 *
 * The model is REAL, not stubbed: the suite runs against a production build
 * served locally, so the vendored u2netp graph and ONNX Runtime's wasm come
 * off disk in a few hundred milliseconds. That means these tests cover the
 * actual pre/post-processing chain end to end — a fixture with a bright disc
 * on a flat field is exactly the "salient object" the model is trained to
 * find, so its centre must survive and its corners must not.
 *
 * The offline case is exercised by aborting every network request for the
 * model assets after they have been cached: if a run still works, it can only
 * have come from Cache Storage.
 */
import { readFileSync } from 'node:fs';
import { test, expect } from './helpers/app';

type P = import('@playwright/test').Page;

/** A subject the segmenter can actually find: a dark disc on a pale field. */
async function subjectImage(page: P, width = 200, height = 150): Promise<Buffer> {
  const dataUrl = await page.evaluate(
    ([w, h]) => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#9dc0e8';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#7a2418';
      ctx.beginPath();
      ctx.ellipse(w / 2, h * 0.6, w * 0.22, h * 0.33, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3b1f14';
      ctx.beginPath();
      ctx.ellipse(w / 2, h * 0.28, w * 0.11, h * 0.15, 0, 0, Math.PI * 2);
      ctx.fill();
      return canvas.toDataURL('image/png');
    },
    [width, height] as const
  );
  return Buffer.from(dataUrl.split(',')[1]!, 'base64');
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

/** Decode an exported image in-page and read pixels at the given points. */
async function probePixels(page: P, bytes: Buffer, mime: string, points: [number, number][]): Promise<number[][]> {
  return page.evaluate(
    async ([b64, type, pts]) => {
      const im = new Image();
      im.src = `data:${type as string};base64,${b64 as string}`;
      await im.decode();
      const c = document.createElement('canvas');
      c.width = im.width;
      c.height = im.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(im, 0, 0);
      return (pts as [number, number][]).map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data]);
    },
    [bytes.toString('base64'), mime, points] as const
  );
}

/** Read the on-screen preview's alpha at a point (canvas pixels). */
function previewAlpha(page: P, x: number, y: number): Promise<number> {
  return page.evaluate(
    ([px, py]) => {
      const c = document.querySelector('[data-testid="bg-preview"]') as HTMLCanvasElement;
      return c.getContext('2d')!.getImageData(px, py, 1, 1).data[3]!;
    },
    [x, y] as const
  );
}

async function runModel(page: P) {
  await page.getByTestId('bg-run').click();
  // Download (local) + wasm start-up + one inference pass.
  await expect(page.getByTestId('bg-result-info')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('bg-run')).toBeEnabled();
}

test.describe('background remover', () => {
  test.slow(); // model download + wasm start-up + inference

  test('states the model is not downloaded, then cuts the subject out — zero DB writes', async ({ app }) => {
    const { page } = app;
    // Snapshot BEFORE navigating, so loading the page is inside the window.
    const before = await app.dumpAll();
    await app.goto('/tools/background-remover/');

    await expect(page.getByTestId('bg-state')).toContainText('Not downloaded');
    await expect(page.getByTestId('bg-download')).toContainText('MB');
    // Nothing to run yet: the result card only appears once an image is in.
    await expect(page.getByTestId('bg-run')).toHaveCount(0);

    await page.getByTestId('bg-file').setInputFiles({
      name: 'subject.png',
      mimeType: 'image/png',
      buffer: await subjectImage(page),
    });
    await expect(page.getByTestId('bg-input-info')).toContainText('200 × 150px');

    await runModel(page);
    // Downloading during the run flips the model state to ready-for-offline.
    await expect(page.getByTestId('bg-state')).toContainText('Ready');
    await expect(page.getByTestId('bg-remove-download')).toBeVisible();

    // The cut-out keeps the subject and drops the corners.
    expect(await previewAlpha(page, 100, 90)).toBe(255);
    expect(await previewAlpha(page, 2, 2)).toBe(0);
    await expect(page.getByTestId('bg-result-info')).toContainText('200 × 150px');

    const png = await downloadBytes(page, () => page.getByTestId('bg-save').click());
    expect(png.name).toBe('subject-no-bg.png');
    expect(isPng(png.bytes)).toBe(true);
    expect(pngSize(png.bytes)).toEqual({ w: 200, h: 150 });
    const [centre, corner] = await probePixels(page, png.bytes, 'image/png', [
      [100, 90],
      [2, 2],
    ]);
    expect(centre![3]).toBe(255);
    expect(corner![3]).toBe(0);

    // THE invariant: nothing was written all session.
    expect(await app.dumpAll()).toEqual(before);
  });

  test('cleanup knobs and a solid background re-tune the same mask; JPG is flagged', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/background-remover/');
    await page.getByTestId('bg-file').setInputFiles({
      name: 'subject.png',
      mimeType: 'image/png',
      buffer: await subjectImage(page),
    });
    await runModel(page);

    const keptText = async () => (await page.getByTestId('bg-result-info').textContent()) ?? '';
    const keptPercent = async () => Number(/(\d+)% of the picture kept/.exec(await keptText())![1]);
    const baseline = await keptPercent();
    expect(baseline).toBeGreaterThan(5);
    expect(baseline).toBeLessThan(70);

    // A high cutoff can only ever keep less — and it does NOT re-run the model
    // (no progress, no busy state; the mask is reused).
    await page.getByTestId('bg-cutoff').fill('80');
    await expect.poll(keptPercent).toBeLessThanOrEqual(baseline);
    await expect(page.getByTestId('bg-progress')).toHaveCount(0);
    await page.getByTestId('bg-cutoff').fill('0');

    // Mask view: opaque greyscale everywhere, white on the subject.
    await page.getByTestId('bg-show-mask').check();
    expect(await previewAlpha(page, 2, 2)).toBe(255);
    await page.getByTestId('bg-show-mask').uncheck();

    // A solid background makes the export opaque, including the corners.
    await page.getByTestId('bg-mode').selectOption('color');
    await page.getByTestId('bg-color').fill('#00ff00');
    await expect.poll(() => previewAlpha(page, 2, 2)).toBe(255);

    // JPG with a transparent background warns instead of silently whitening.
    await page.getByTestId('bg-format').selectOption('jpg');
    await expect(page.getByTestId('bg-jpg-note')).toHaveCount(0); // a colour is set
    await page.getByTestId('bg-mode').selectOption('transparent');
    await expect(page.getByTestId('bg-jpg-note')).toContainText('cannot store transparency');

    await page.getByTestId('bg-mode').selectOption('color');
    const jpg = await downloadBytes(page, () => page.getByTestId('bg-save').click());
    expect(jpg.name).toBe('subject-no-bg.jpg');
    expect(isJpeg(jpg.bytes)).toBe(true);
    const [corner] = await probePixels(page, jpg.bytes, 'image/jpeg', [[2, 2]]);
    // JPEG is lossy, so the green is approximate — but it is green and opaque.
    expect(corner![1]).toBeGreaterThan(200);
    expect(corner![0]).toBeLessThan(80);
    expect(corner![3]).toBe(255);

    expect(await app.dumpAll()).toEqual(before);
  });

  test('once downloaded it runs with the network cut off, and can be removed again', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/background-remover/');

    // Prime the cache through the explicit download button (no image needed).
    await page.getByTestId('bg-download').click();
    await expect(page.getByTestId('bg-state')).toContainText('Ready', { timeout: 120_000 });

    // Cut the network entirely. A run can only succeed from Cache Storage —
    // which is precisely the offline promise this tool makes. (No reload:
    // the point under test is the model assets, not the app shell.)
    await page.context().setOffline(true);

    await page.getByTestId('bg-file').setInputFiles({
      name: 'subject.png',
      mimeType: 'image/png',
      buffer: await subjectImage(page),
    });
    await runModel(page);
    expect(await previewAlpha(page, 100, 90)).toBe(255);
    expect(await previewAlpha(page, 2, 2)).toBe(0);

    // Removing the download puts the tool back in its "not downloaded" state.
    await page.context().setOffline(false);
    await page.getByTestId('bg-remove-download').click();
    await expect(page.getByTestId('bg-state')).toContainText('Not downloaded');

    expect(await app.dumpAll()).toEqual(before);
  });
});
