/**
 * 0.6.0 Phase 5 — Generators › Clip path. Stateless: every scenario runs
 * inside a `dumpAll()` zero-write window. The preview's COMPUTED clip-path
 * is compared with the shown CSS, so the overlay, the preview and the copied
 * text are proven to be the same string; copy runs against the real async
 * clipboard.
 */
import { test, expect, type App } from './helpers/app';
import type { Page } from '@playwright/test';

async function readClipboard(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}

/** The preview element's computed `clip-path`. */
async function computedClip(page: Page): Promise<string> {
  return page.getByTestId('cp-preview').evaluate((el) => getComputedStyle(el).clipPath);
}

/** Set a range input the way a user's drag would (value + input event). */
async function setRange(page: Page, testid: string, value: number): Promise<void> {
  await page.getByTestId(testid).evaluate((el, v) => {
    const input = el as HTMLInputElement;
    input.value = String(v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

async function open(app: App): Promise<Record<string, Record<string, unknown>[]>> {
  await app.page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await app.goto('/tools/clip-path/');
  return app.dumpAll();
}

test.describe('clip path', () => {
  test('presets clip the preview, handles drag, copy writes the declaration — zero writes', async ({ app }) => {
    const { page } = app;
    const before = await open(app);

    // The default is a preset polygon; picking another swaps the points.
    await expect(page.getByTestId('cp-css')).toContainText('clip-path: polygon(');
    await page.getByTestId('cp-preset-star').click();
    await expect(page.getByTestId('cp-css')).toContainText('clip-path: polygon(50% 0%, 61% 35%, 98% 35%');
    await expect(page.getByTestId('cp-point-count')).toHaveText('10 points');
    await expect(page.getByTestId('cp-handle-9')).toBeVisible();

    // The preview element carries the very value the code block shows.
    const clip = await computedClip(page);
    expect(clip).not.toBe('none');
    expect(clip.startsWith('polygon(')).toBe(true);
    const shown = (await page.getByTestId('cp-css').textContent()) ?? '';
    expect(shown).toBe(`clip-path: ${clip};`);

    // Drag the first handle: the point moves and the CSS follows.
    const handle = page.getByTestId('cp-handle-0');
    // Below the fold after the preset grid: off-screen mouse events reach nothing.
    await handle.scrollIntoViewIfNeeded();
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 6 });
    await page.mouse.up();
    await expect(page.getByTestId('cp-css')).not.toContainText('polygon(50% 0%, 61% 35%');
    const moved = await computedClip(page);
    expect(moved).not.toBe(clip);
    expect((await page.getByTestId('cp-css').textContent()) ?? '').toBe(`clip-path: ${moved};`);

    // Right-click removes a point; the count and the handles agree.
    await page.getByTestId('cp-handle-9').click({ button: 'right' });
    await expect(page.getByTestId('cp-point-count')).toHaveText('9 points');
    await expect(page.getByTestId('cp-handle-9')).toHaveCount(0);

    // Reset restores the preset exactly.
    await page.getByTestId('cp-reset').click();
    await expect(page.getByTestId('cp-css')).toContainText('clip-path: polygon(50% 0%, 61% 35%, 98% 35%');

    await page.getByTestId('cp-copy').click();
    await expect(page.getByTestId('cp-copy')).toHaveText('Copied');
    expect(await readClipboard(page)).toMatch(/^clip-path: polygon\(50% 0%, 61% 35%/);

    expect(await app.dumpAll()).toEqual(before);
  });

  test('circle, ellipse, blinds and wave modes emit their own functions — zero writes', async ({ app }) => {
    const { page } = app;
    const before = await open(app);

    await page.getByTestId('cp-mode-circle').click();
    await setRange(page, 'cp-radius', 25);
    await expect(page.getByTestId('cp-css')).toHaveText('clip-path: circle(25% at 50% 50%);');
    expect(await computedClip(page)).toBe('circle(25% at 50% 50%)');

    await page.getByTestId('cp-mode-ellipse').click();
    await setRange(page, 'cp-rx', 30);
    await setRange(page, 'cp-ry', 45);
    await expect(page.getByTestId('cp-css')).toHaveText('clip-path: ellipse(30% 45% at 50% 50%);');
    expect(await computedClip(page)).toBe('ellipse(30% 45% at 50% 50%)');

    // Blinds are ONE polygon: four corners per strip.
    await page.getByTestId('cp-mode-blinds').click();
    await setRange(page, 'cp-blinds-count', 4);
    await setRange(page, 'cp-blinds-gap', 10);
    const blinds = (await page.getByTestId('cp-css').textContent()) ?? '';
    expect(blinds.startsWith('clip-path: polygon(0% 0%, 100% 0%, 100% 17.5%, 0% 17.5%, 0% 27.5%')).toBe(true);
    expect(blinds.split('%,').length).toBe(16);
    expect((await computedClip(page)).startsWith('polygon(')).toBe(true);
    await page.getByTestId('cp-blinds-direction').selectOption('vertical');
    await expect(page.getByTestId('cp-css')).toContainText('polygon(0% 0%, 0% 100%, 17.5% 100%, 17.5% 0%');

    // Waves: a percent polygon plus the path() alternate with its own copy.
    await page.getByTestId('cp-mode-wave').click();
    await setRange(page, 'cp-waves', 2);
    await setRange(page, 'cp-amplitude', 20);
    await page.getByTestId('cp-wave-kind').selectOption('square');
    await expect(page.getByTestId('cp-css')).toContainText('clip-path: polygon(0% 0%, ');
    // A square step is two points on one x: trough side, then crest side.
    await expect(page.getByTestId('cp-css')).toContainText('25% 0%, 25% 20%');
    await expect(page.getByTestId('cp-css')).toContainText('50% 20%, 50% 0%');
    await expect(page.getByTestId('cp-path-css')).toContainText('clip-path: path("M 0 0 L ');
    expect((await computedClip(page)).startsWith('polygon(')).toBe(true);
    await page.getByTestId('cp-copy-path').click();
    await expect(page.getByTestId('cp-copy-path')).toHaveText('Copied');
    expect(await readClipboard(page)).toMatch(/^clip-path: path\("M 0 0 L /);

    // The bottom edge flips the wave to hug y = 100.
    await page.getByTestId('cp-wave-edge').selectOption('bottom');
    await expect(page.getByTestId('cp-css')).toContainText('clip-path: polygon(0% 0%, 100% 0%, 100% ');

    expect(await app.dumpAll()).toEqual(before);
  });

  test('aspect ratio reshapes the stage, fill switches solid / gradient — zero writes', async ({ app }) => {
    const { page } = app;
    const before = await open(app);
    const stage = page.getByTestId('cp-stage');
    const preview = page.getByTestId('cp-preview');
    const ratio = async () => {
      const box = (await stage.boundingBox())!;
      return box.width / box.height;
    };

    // Default: a 4/3 box painted solid orange, no gradient, and the handles
    // sit on the box (a corner point of the hexagon lands on the stage edge).
    await expect(page.getByTestId('cp-aspect')).toHaveValue('4/3');
    expect(await ratio()).toBeCloseTo(4 / 3, 1);
    expect(await preview.evaluate((el) => getComputedStyle(el).backgroundImage)).toBe('none');
    expect(await preview.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(232, 161, 58)');
    await expect(page.getByTestId('cp-fill-solid')).toHaveAttribute('aria-pressed', 'true');

    // 16/9 changes the box, not the declaration — percent geometry is ratio-free.
    const css = (await page.getByTestId('cp-css').textContent()) ?? '';
    await page.getByTestId('cp-aspect').selectOption('16/9');
    await expect.poll(ratio).toBeGreaterThan(1.76);
    expect(await ratio()).toBeLessThan(1.8);
    expect((await page.getByTestId('cp-css').textContent()) ?? '').toBe(css);
    expect(await computedClip(page)).toBe(css.slice('clip-path: '.length, -1));
    // The overlay/handles map through the stage box: point 2 of the hexagon
    // (100% 25%) sits on the stage's right edge at every ratio.
    const stageBox = (await stage.boundingBox())!;
    const handle = (await page.getByTestId('cp-handle-1').boundingBox())!;
    expect(Math.abs(handle.x + handle.width / 2 - (stageBox.x + stageBox.width))).toBeLessThan(1.5);
    expect(Math.abs(handle.y + handle.height / 2 - (stageBox.y + stageBox.height * 0.25))).toBeLessThan(1.5);

    // A portrait ratio is width-bound too (the max height shrinks the width).
    await page.getByTestId('cp-aspect').selectOption('9/16');
    await expect.poll(ratio).toBeLessThan(0.58);

    // Solid colour is editable through the ColorField.
    await page.getByTestId('cp-fill-color').fill('#123456');
    await expect.poll(() => preview.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(18, 52, 86)');

    // Gradient: two colours and an angle drive the computed background-image.
    await page.getByTestId('cp-fill-gradient').click();
    await expect(page.getByTestId('cp-gradient-angle')).toHaveValue('135');
    const gradient135 = await preview.evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(gradient135).toContain('linear-gradient(135deg');
    expect(gradient135).toContain('rgb(232, 161, 58)');
    await setRange(page, 'cp-gradient-angle', 90);
    await expect(page.locator('label[for="cp-gradient-angle"]')).toHaveText('Angle: 90°');
    await expect.poll(() => preview.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('linear-gradient(90deg');
    await page.getByTestId('cp-gradient-to').fill('#ffffff');
    await expect.poll(() => preview.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('rgb(255, 255, 255)');

    // Image mode without an image falls back to the solid colour and shows the picker.
    await page.getByTestId('cp-fill-image').click();
    await expect(page.getByTestId('cp-image')).toBeVisible();
    expect(await preview.evaluate((el) => getComputedStyle(el).backgroundImage)).toBe('none');

    expect(await app.dumpAll()).toEqual(before);
  });
});
