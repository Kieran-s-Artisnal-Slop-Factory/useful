/**
 * Phase 4 (Generators) — colors, gradients, glassmorphism, regex snippets,
 * QR create/read. All stateless: every page must compute with ZERO DB
 * writes. Copy flows run against the real async clipboard (permissions
 * granted on the context); the QR reader is fed by the creator's own PNG
 * download — a true round trip through the export pipeline.
 */
import { test, expect } from './helpers/app';

async function readClipboard(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}

test.describe('colors', () => {
  test('converts between every CSS spelling with zero DB writes', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/colors/');
    const before = await app.dumpAll();

    await page.getByTestId('col-input').fill('rebeccapurple');
    await expect(page.getByTestId('col-out-hex')).toHaveText('#663399');
    await expect(page.getByTestId('col-out-rgb')).toHaveText('rgb(102 51 153)');
    await expect(page.getByTestId('col-named')).toContainText('rebeccapurple');
    await expect(page.getByTestId('col-out-oklch')).toContainText('oklch(');

    // The picker feeds back into the text input as hex.
    await page.getByTestId('col-picker').fill('#ff0000');
    await expect(page.getByTestId('col-out-hsl')).toHaveText('hsl(0 100% 50%)');
    await expect(page.getByTestId('col-named')).toContainText('red');

    // Out-of-sRGB colors are flagged, not mangled silently.
    await page.getByTestId('col-input').fill('oklch(0.7 0.35 150)');
    await expect(page.getByTestId('col-gamut')).toBeVisible();

    // Junk shows the error state instead of stale conversions.
    await page.getByTestId('col-input').fill('not-a-color');
    await expect(page.getByTestId('col-invalid')).toBeVisible();
    await expect(page.getByTestId('col-out-hex')).toHaveCount(0);

    expect(await app.dumpAll()).toEqual(before);
  });

  test('per-format copy buttons put the spelling on the clipboard', async ({ app }) => {
    const { page } = app;
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await app.goto('/tools/colors/');
    const before = await app.dumpAll();

    await page.getByTestId('col-input').fill('#1e3a5f');
    await page.getByTestId('col-copy-oklch').click();
    await expect(page.getByTestId('col-copy-oklch')).toHaveText('Copied');
    expect(await readClipboard(page)).toMatch(/^oklch\(/);

    expect(await app.dumpAll()).toEqual(before);
  });
});

test.describe('gradients', () => {
  test('builds and copies gradient CSS with zero DB writes', async ({ app }) => {
    const { page } = app;
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await app.goto('/tools/gradients/');
    const before = await app.dumpAll();

    await expect(page.getByTestId('gr-css')).toContainText('linear-gradient(135deg');
    await expect(page.getByTestId('gr-preview')).toHaveAttribute('style', /linear-gradient/);

    await page.getByTestId('gr-kind').selectOption('conic');
    await page.getByTestId('gr-angle').fill('90');
    await expect(page.getByTestId('gr-css')).toContainText('conic-gradient(from 90deg');

    // Stops: add one, position it, remove it again.
    await page.getByTestId('gr-add-stop').click();
    await page.getByTestId('gr-stop-color-2').fill('oklch(0.7 0.1 200)');
    await page.getByTestId('gr-stop-pos-2').fill('50');
    await expect(page.getByTestId('gr-css')).toContainText('oklch(0.7 0.1 200) 50%');
    await page.getByTestId('gr-stop-remove-2').click();
    await expect(page.getByTestId('gr-css')).not.toContainText('oklch');

    // Radial swaps the angle control for a shape control.
    await page.getByTestId('gr-kind').selectOption('radial');
    await page.getByTestId('gr-shape').selectOption('circle');
    await expect(page.getByTestId('gr-css')).toContainText('radial-gradient(circle');

    await page.getByTestId('gr-copy').click();
    await expect(page.getByTestId('gr-copy')).toHaveText('Copied');
    expect(await readClipboard(page)).toMatch(/^background: radial-gradient\(circle/);

    expect(await app.dumpAll()).toEqual(before);
  });
});

test.describe('glassmorphism', () => {
  test('controls drive the CSS block and the live panel identically', async ({ app }) => {
    const { page } = app;
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await app.goto('/tools/glassmorphism/');
    const before = await app.dumpAll();

    await expect(page.getByTestId('gl-css')).toContainText('backdrop-filter: blur(10px) saturate(140%);');

    await page.getByTestId('gl-blur').fill('24');
    await page.getByTestId('gl-tint').fill('rebeccapurple');
    await expect(page.getByTestId('gl-css')).toContainText('blur(24px)');
    await expect(page.getByTestId('gl-css')).toContainText('rgb(102 51 153');
    await expect(page.getByTestId('gl-preview')).toHaveAttribute('style', /blur\(24px\)/);

    await page.getByTestId('gl-shadow').uncheck();
    await expect(page.getByTestId('gl-css')).not.toContainText('box-shadow');

    await page.getByTestId('gl-copy').click();
    await expect(page.getByTestId('gl-copy')).toHaveText('Copied');
    expect(await readClipboard(page)).toContain('backdrop-filter: blur(24px)');

    expect(await app.dumpAll()).toEqual(before);
  });
});

test.describe('regex snippets', () => {
  test('generates per-language snippets with rewrites, flags and warnings', async ({ app }) => {
    const { page } = app;
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await app.goto('/tools/regex/');
    const before = await app.dumpAll();

    // Default pattern has named groups: Python gets the (?P<…>) rewrite,
    // Go keeps the original spelling.
    await expect(page.getByTestId('rx-snippet-python')).toContainText('(?P<year>');
    await expect(page.getByTestId('rx-snippet-go')).toContainText('(?<year>');
    await expect(page.getByTestId('rx-warn-go')).toHaveCount(0);

    await page.getByTestId('rx-flag-i').check();
    await expect(page.getByTestId('rx-snippet-go')).toContainText('(?i)');
    await expect(page.getByTestId('rx-snippet-python')).toContainText('re.IGNORECASE');

    // RE2-incompatible constructs warn on Go and Rust only.
    await page.getByTestId('rx-pattern').fill('(?<=a)(b)\\1');
    await expect(page.getByTestId('rx-warn-go')).toHaveCount(2);
    await expect(page.getByTestId('rx-warn-rust')).toHaveCount(2);
    await expect(page.getByTestId('rx-snippet-js')).toBeVisible();

    // A broken pattern shows the syntax error and suppresses the snippets.
    await page.getByTestId('rx-pattern').fill('a(');
    await expect(page.getByTestId('rx-error')).toBeVisible();
    await expect(page.getByTestId('rx-snippet-go')).toHaveCount(0);

    await page.getByTestId('rx-pattern').fill('\\d+');
    await page.getByTestId('rx-copy-go').click();
    await expect(page.getByTestId('rx-copy-go')).toHaveText('Copied');
    expect(await readClipboard(page)).toContain('regexp.MustCompile(`(?i)\\d+`)');

    expect(await app.dumpAll()).toEqual(before);
  });
});

test.describe('qr code', () => {
  test('creates a code, downloads the PNG, and the reader decodes it back (zero DB writes)', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/qr/');
    const before = await app.dumpAll();

    const payload = 'https://useful.test/round-trip';
    await page.getByTestId('qr-text').fill(payload);
    await expect(page.getByTestId('qr-preview').locator('svg')).toBeVisible();

    // Export through the shared pipeline, then feed the reader its own file.
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('qr-download-png').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('qr-code.png');
    const path = await download.path();

    await page.getByTestId('qr-upload').setInputFiles(path);
    await expect(page.getByTestId('qr-result')).toHaveText(payload);
    // The decoded URL is a clickable link — but nothing auto-opened.
    await expect(page.getByTestId('qr-result-link')).toHaveAttribute('href', payload);
    expect(page.context().pages().length).toBe(1);

    expect(await app.dumpAll()).toEqual(before);
  });

  test('SVG download and empty-input handling', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/qr/');

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('qr-download-svg').click();
    expect((await downloadPromise).suggestedFilename()).toBe('qr-code.svg');

    await page.getByTestId('qr-text').fill('');
    await expect(page.getByTestId('qr-create-error')).toBeVisible();
    await expect(page.getByTestId('qr-download-png')).toHaveCount(0);
  });

  test('camera path is feature-detected and degrades to upload gracefully', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/qr/');
    // Feature detection picks exactly ONE affordance: the scan button where a
    // camera exists (this dev machine has one), the explanatory note where it
    // doesn't (CI) — never both, never neither.
    await expect(page.getByTestId('qr-camera').or(page.getByTestId('qr-no-camera'))).toBeVisible();
    expect(
      (await page.getByTestId('qr-camera').count()) +
        (await page.getByTestId('qr-no-camera').count())
    ).toBe(1);
    // Detection must not have ASKED for the camera — permission stays unprompted.
    expect(
      await page.evaluate(() =>
        navigator.permissions.query({ name: 'camera' as PermissionName }).then((r) => r.state)
      )
    ).toBe('prompt');
    // A non-QR upload reports failure instead of hanging.
    await page.getByTestId('qr-upload').setInputFiles({
      name: 'not-a-qr.png',
      mimeType: 'image/png',
      // 1×1 transparent PNG.
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
        'base64'
      ),
    });
    await expect(page.getByTestId('qr-read-error')).toBeVisible();
  });
});

test('generator explainers toggle from the keyboard', async ({ app }) => {
  const { page } = app;
  const targets = [
    { path: '/tools/colors/', testid: 'explainer-color-formats', text: 'CSS Color 4' },
    { path: '/tools/regex/', testid: 'explainer-regex', text: 'RE2-family' },
    { path: '/tools/qr/', testid: 'explainer-qr', text: 'never opened automatically' },
  ];
  for (const t of targets) {
    await app.goto(t.path);
    const details = page.getByTestId(t.testid);
    await details.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(details).toHaveJSProperty('open', true);
    await expect(details.getByText(t.text)).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(details).toHaveJSProperty('open', false);
  }
});
