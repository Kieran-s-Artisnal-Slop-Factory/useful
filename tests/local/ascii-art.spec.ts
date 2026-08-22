/**
 * ASCII art (0.3.0 phase 8).
 *
 * Stateless: an image is decoded in the tab, converted and forgotten, and the
 * chosen font is deliberately NOT remembered — so every case here asserts the
 * database is byte-identical afterwards.
 *
 * The image fixture is drawn in-page as an exact left-to-right gradient, which
 * makes both halves of the conversion checkable rather than eyeballable: the
 * output rectangle has known dimensions, and the characters have to run from
 * light to dark across it.
 */
import { readFileSync } from 'node:fs';
import { test, expect } from './helpers/app';

type P = import('@playwright/test').Page;

/** A `width` × `height` PNG that runs black on the left to white on the right. */
async function gradientPng(page: P, width: number, height: number): Promise<Buffer> {
  const dataUrl = await page.evaluate(
    ([w, h]) => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      const gradient = ctx.createLinearGradient(0, 0, w, 0);
      gradient.addColorStop(0, '#000000');
      gradient.addColorStop(1, '#ffffff');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
      return canvas.toDataURL('image/png');
    },
    [width, height] as const
  );
  return Buffer.from(dataUrl.split(',')[1]!, 'base64');
}

async function downloadBytes(page: P, trigger: () => Promise<void>) {
  const downloadPromise = page.waitForEvent('download');
  await trigger();
  const download = await downloadPromise;
  return { name: download.suggestedFilename(), bytes: readFileSync(await download.path()) };
}

/** The output block as plain lines. */
async function outputLines(page: P): Promise<string[]> {
  const text = (await page.getByTestId('aa-output').innerText()) ?? '';
  return text.split('\n');
}

test.describe('ascii art — text', () => {
  test('renders a banner, and changing the font changes it', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/ascii-art/');

    await expect(page.getByTestId('aa-output')).toContainText('_');
    const standard = await page.getByTestId('aa-output').innerText();
    await expect(page.getByTestId('aa-size')).toContainText('characters');

    await page.getByTestId('aa-font-pagga').click();
    await expect(page.getByTestId('aa-output')).not.toHaveText(standard);
    // Pagga is the block font — its glyphs are drawn from ░ and █.
    await expect(page.getByTestId('aa-output')).toContainText('░');

    // One of the fonts that ships on the package basis rather than its own
    // terms, so the second route is exercised end to end and not just in the
    // build script's unit tests.
    await page.getByTestId('aa-font-ansi-shadow').click();
    await expect(page.getByTestId('aa-output')).toContainText('█');

    expect(await app.dumpAll()).toEqual(before);
  });

  test('draws each picker row only once it is scrolled to, in your own words', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/ascii-art/');
    await page.getByTestId('aa-text').fill('zzz');

    // A font nobody has scrolled to has not been fetched: its row is a
    // placeholder, not a banner. 178 KB of .flf for a list nobody looked at
    // is exactly the eager cost this app refuses everywhere else.
    const fire = page.getByTestId('aa-font-fire-font-k').locator('pre');
    await expect(fire).toHaveText('…');

    await fire.scrollIntoViewIfNeeded();
    await expect(fire).not.toHaveText('…', { timeout: 15_000 });

    const standard = page.getByTestId('aa-font-standard').locator('pre');
    await standard.scrollIntoViewIfNeeded();
    // "zzz" in Standard is unmistakable, and it is the typed word rather than
    // a fixed sample — the point of drawing the previews at all.
    await expect(standard).toContainText('/___/___/___', { timeout: 15_000 });
  });

  test('spacing and alignment change the shape of the block', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/ascii-art/');
    await page.getByTestId('aa-text').fill('ill');

    await page.getByTestId('aa-layout').selectOption('full');
    const full = await outputLines(page);

    await page.getByTestId('aa-layout').selectOption('universal smushing');
    await expect
      .poll(async () => (await outputLines(page))[0]?.length ?? 0)
      .toBeLessThan(full[0]!.length);

    // Every line stays the same length whatever the alignment — the block is
    // a rectangle, which is what the SVG grid and a comment box both need.
    for (const alignment of ['right', 'center', 'left']) {
      await page.getByTestId('aa-align').selectOption(alignment);
      const lines = (await outputLines(page)).filter((l) => l !== '');
      const widths = new Set(lines.map((l) => l.length));
      expect(widths.size, `${alignment} produced ragged lines`).toBeLessThanOrEqual(1);
    }
  });

  test('downloads the banner as text, writing nothing', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/ascii-art/');
    await page.getByTestId('aa-text').fill('hi');
    await expect(page.getByTestId('aa-output')).toContainText('_');

    const txt = await downloadBytes(page, () => page.getByTestId('aa-download-txt').click());
    expect(txt.name).toBe('hi.txt');
    expect(txt.bytes.toString('utf8')).toContain('_');

    expect(await app.dumpAll()).toEqual(before);
  });
});

test.describe('ascii art — pictures', () => {
  test('converts an image to a rectangle of the requested size', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/ascii-art/');
    await page.getByTestId('aa-mode').selectOption('picture');

    const png = await gradientPng(page, 200, 100);
    await page.getByTestId('aa-file').setInputFiles({ name: 'gradient.png', mimeType: 'image/png', buffer: png });
    await expect(page.getByTestId('aa-input-info')).toContainText('200 × 100px');

    // 80 columns of a 2:1 image, on cells twice as tall as they are wide:
    // 80 × (100/200) × 0.5 = 20 rows.
    await expect(page.getByTestId('aa-size')).toContainText('80 × 20 characters');
    const lines = (await outputLines(page)).filter((l) => l !== '');
    expect(lines).toHaveLength(20);

    // Dark on the left, light on the right — and the reverse when inverted.
    const first = lines[0]!;
    expect(first.trimEnd().startsWith('@')).toBe(true);
    expect(first.endsWith(' ')).toBe(true);

    await page.getByTestId('aa-invert').check();
    await expect
      .poll(async () => (await outputLines(page))[0]?.startsWith(' '))
      .toBe(true);

    await page.getByTestId('aa-columns').fill('40');
    await expect(page.getByTestId('aa-size')).toContainText('40 × 10 characters');

    expect(await app.dumpAll()).toEqual(before);
  });

  test('colour mode paints each character, and the SVG download carries it', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/ascii-art/');
    await page.getByTestId('aa-mode').selectOption('picture');

    const png = await gradientPng(page, 200, 100);
    await page.getByTestId('aa-file').setInputFiles({ name: 'gradient.png', mimeType: 'image/png', buffer: png });
    await expect(page.getByTestId('aa-size')).toContainText('80 × 20');

    await page.getByTestId('aa-colour').selectOption({ label: 'Per-character colour (HTML / SVG)' });
    await expect(page.getByTestId('aa-output').locator('span').first()).toBeVisible();

    const svg = await downloadBytes(page, () => page.getByTestId('aa-download-svg').click());
    expect(svg.name).toBe('gradient.svg');
    const markup = svg.bytes.toString('utf8');
    expect(markup.startsWith('<svg xmlns=')).toBe(true);
    expect(markup).toContain('<tspan');
    expect(markup).toMatch(/fill="#[0-9a-f]{6}"/);

    expect(await app.dumpAll()).toEqual(before);
  });

  test('rasterizes the art to a PNG through the shared converter', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/ascii-art/');
    await page.getByTestId('aa-mode').selectOption('picture');
    const png = await gradientPng(page, 200, 100);
    await page.getByTestId('aa-file').setInputFiles({ name: 'gradient.png', mimeType: 'image/png', buffer: png });
    await expect(page.getByTestId('aa-size')).toContainText('80 × 20');

    const out = await downloadBytes(page, () => page.getByTestId('aa-download-png').click());
    expect(out.name).toBe('gradient.png');
    expect(out.bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(true);
  });

  test('says so when an image cannot be decoded', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/ascii-art/');
    await page.getByTestId('aa-mode').selectOption('picture');
    await page.getByTestId('aa-file').setInputFiles({
      name: 'broken.png',
      mimeType: 'image/png',
      buffer: Buffer.from('not an image at all'),
    });
    await expect(page.getByTestId('aa-error')).toBeVisible();
  });
});
