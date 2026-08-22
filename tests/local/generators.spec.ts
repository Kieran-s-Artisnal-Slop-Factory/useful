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

    await page.getByTestId('col-input').fill('#803900');
    await page.getByTestId('col-copy-oklch').click();
    await expect(page.getByTestId('col-copy-oklch')).toHaveText('Copied');
    expect(await readClipboard(page)).toMatch(/^oklch\(/);

    expect(await app.dumpAll()).toEqual(before);
  });
});

test.describe('themes', () => {
  test('harmonies rotate the wheel and chips copy hex values', async ({ app }) => {
    const { page } = app;
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await app.goto('/tools/colors/');
    const before = await app.dumpAll();

    await page.getByTestId('col-input').fill('#ff0000');
    const comp = page.getByTestId('harmony-complementary-chip');
    await expect(comp).toHaveCount(2);
    await expect(comp.nth(0)).toContainText('#ff0000');
    await expect(comp.nth(1)).toContainText('#00ffff');
    await expect(page.getByTestId('harmony-tetradic-chip')).toHaveCount(4);
    await expect(page.getByTestId('harmony-analogous-chip').nth(2)).toContainText('#ff8000');

    await comp.nth(1).click();
    expect(await readClipboard(page)).toBe('#00ffff');

    expect(await app.dumpAll()).toEqual(before);
  });

  test('theme builder: swatch → light-dark() CSS with derived roles and live preview', async ({ app }) => {
    const { page } = app;
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await app.goto('/tools/colors/');
    const before = await app.dumpAll();

    // One color is enough — the rest derive (and say so).
    await expect(page.getByTestId('th-css')).toContainText('--primary: light-dark(#803900,');
    await expect(page.getByTestId('th-css')).toContainText('color-scheme: light dark;');
    await expect(page.getByTestId('th-derived-secondary')).toBeVisible();

    // Pin the secondary — the derived badge goes away and the value lands.
    await page.getByTestId('th-color-secondary').fill('rebeccapurple');
    await expect(page.getByTestId('th-derived-secondary')).toHaveCount(0);
    await expect(page.getByTestId('th-css')).toContainText('--secondary: light-dark(#663399,');

    // The color explored above feeds the builder on demand.
    await page.getByTestId('col-input').fill('#ff0000');
    await page.getByTestId('th-use-color').click();
    await expect(page.getByTestId('th-color-primary')).toHaveValue('#ff0000');
    await expect(page.getByTestId('th-css')).toContainText('--primary: light-dark(#ff0000,');

    // Knobs land in the variables; the preview runs on the same string.
    await page.getByTestId('th-padding').fill('20');
    await expect(page.getByTestId('th-css')).toContainText('--padding: 20px;');
    await expect(page.getByTestId('th-preview')).toHaveAttribute('style', /--padding: 20px/);

    // Forcing the scheme flips light-dark() in the preview window.
    await page.getByTestId('th-scheme-dark').check();
    await expect(page.getByTestId('th-preview')).toHaveAttribute('style', /color-scheme: dark/);

    await page.getByTestId('th-copy').click();
    expect(await readClipboard(page)).toMatch(/^:root \{/);

    expect(await app.dumpAll()).toEqual(before);
  });

  test('dark slots are overridable per role, and pickers write into the text', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/colors/');
    const before = await app.dumpAll();

    // The dark half of every light-dark() pair is editable independently.
    await expect(page.getByTestId('th-derived-dark-primary')).toBeVisible();
    await page.getByTestId('th-dark-primary').fill('#a5c8ff');
    await expect(page.getByTestId('th-derived-dark-primary')).toHaveCount(0);
    await expect(page.getByTestId('th-css')).toContainText('--primary: light-dark(#803900, #a5c8ff);');

    // Every role slot has a synced native picker beside the text input.
    await page.getByTestId('th-color-secondary-pick').fill('#e8a13a');
    await expect(page.getByTestId('th-color-secondary')).toHaveValue('#e8a13a');
    await expect(page.getByTestId('th-css')).toContainText('--secondary: light-dark(#e8a13a,');

    expect(await app.dumpAll()).toEqual(before);
  });

  test('contrast warnings fire per scheme against the theme background', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/colors/');

    // The default derivation is clean.
    await expect(page.getByTestId('th-warning')).toHaveCount(0);

    // A near-white primary sinks into the near-white light surface.
    await page.getByTestId('th-color-primary').fill('#f3f5f7');
    await expect(
      page.locator('[data-testid="th-warning"][data-role="primary"][data-scheme="light"]')
    ).toBeVisible();

    // Fixing the light slot but breaking the dark one moves the warning.
    await page.getByTestId('th-color-primary').fill('#1e3a5f');
    await page.getByTestId('th-dark-primary').fill('#20242c');
    await expect(
      page.locator('[data-testid="th-warning"][data-role="primary"][data-scheme="dark"]')
    ).toBeVisible();
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

    // Each stop also has a synced native picker.
    await page.getByTestId('gr-stop-color-0-pick').fill('#ff0000');
    await expect(page.getByTestId('gr-stop-color-0')).toHaveValue('#ff0000');
    await expect(page.getByTestId('gr-css')).toContainText('#ff0000 0%');

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
    // The tint's synced picker resolves the named color.
    await expect(page.getByTestId('gl-tint-pick')).toHaveValue('#663399');
    await expect(page.getByTestId('gl-css')).toContainText('blur(24px)');
    await expect(page.getByTestId('gl-css')).toContainText('rgb(102 51 153');
    await expect(page.getByTestId('gl-preview')).toHaveAttribute('style', /blur\(24px\)/);

    await page.getByTestId('gl-shadow').uncheck();
    await expect(page.getByTestId('gl-css')).not.toContainText('box-shadow');

    // Opacity is dialed in percent and lands as a 0–1 alpha.
    await page.getByTestId('gl-tint-opacity').fill('40');
    await expect(page.getByTestId('gl-css')).toContainText('rgb(102 51 153 / 0.4)');

    await page.getByTestId('gl-copy').click();
    await expect(page.getByTestId('gl-copy')).toHaveText('Copied');
    expect(await readClipboard(page)).toContain('backdrop-filter: blur(24px)');

    expect(await app.dumpAll()).toEqual(before);
  });

  test('presets apply complete looks in one click', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/glassmorphism/');
    const before = await app.dumpAll();

    await page.getByTestId('gl-preset-ios-clear').click();
    await expect(page.getByTestId('gl-css')).toContainText('blur(24px) saturate(190%)');
    await expect(page.getByTestId('gl-css')).not.toContainText('box-shadow');
    await expect(page.getByTestId('gl-tint-opacity')).toHaveValue('8');
    await expect(page.getByTestId('gl-radius')).toHaveValue('18');

    await page.getByTestId('gl-preset-dark-frost').click();
    await expect(page.getByTestId('gl-css')).toContainText('rgb(16 20 28 / 0.45)');

    await page.getByTestId('gl-preset-tint-amber').click();
    await expect(page.getByTestId('gl-css')).toContainText('rgb(232 161 58');

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

  test('live tester highlights matches and lists groups', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/regex/');
    const before = await app.dumpAll();

    // Default pattern over the default sample: two full dates, "99-9" ignored.
    await expect(page.getByTestId('rx-match-count')).toContainText('2 matches');
    await expect(page.getByTestId('rx-mark')).toHaveCount(2);
    await expect(page.getByTestId('rx-mark').first()).toHaveText('2024-01-15');

    const firstRow = page.getByTestId('rx-match-row').first();
    await expect(firstRow).toContainText('year: 2024');
    await expect(firstRow).toContainText('month: 01');

    // Groups are color-coded: three colored spans inside the first match,
    // and the table chip for group 1 wears the SAME color.
    const firstMark = page.getByTestId('rx-mark').first();
    await expect(firstMark.locator('.grp')).toHaveCount(3);
    const spanColor = await firstMark
      .locator('.grp')
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    const chipColor = await firstRow
      .locator('.group')
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(spanColor).toBe(chipColor);
    // Different groups, different colors.
    const secondSpanColor = await firstMark
      .locator('.grp')
      .nth(1)
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(secondSpanColor).not.toBe(spanColor);

    // Editing the sample re-runs live.
    await page.getByTestId('rx-test-text').fill('nothing to see');
    await expect(page.getByTestId('rx-match-count')).toContainText('No matches');
    await expect(page.getByTestId('rx-mark')).toHaveCount(0);

    // A broken pattern degrades the tester, not the page.
    await page.getByTestId('rx-pattern').fill('a(');
    await expect(page.getByTestId('rx-highlighted')).toHaveCount(0);

    expect(await app.dumpAll()).toEqual(before);
  });

  test('symbol reference filters by token and meaning', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/regex/');

    // Unfiltered: the full table is on the page.
    expect(await page.getByTestId('rx-ref-row').count()).toBeGreaterThan(25);

    await page.getByTestId('rx-ref-filter').fill('lookahead');
    await expect(page.getByTestId('rx-ref-row')).toHaveCount(2);
    await expect(page.getByTestId('rx-ref-row').first()).toContainText('(?=');

    await page.getByTestId('rx-ref-filter').fill('boundary');
    await expect(page.getByTestId('rx-ref-row').first()).toContainText('\\b');

    await page.getByTestId('rx-ref-filter').fill('zzznothing');
    await expect(page.getByTestId('rx-ref-row')).toHaveCount(0);
    await expect(page.getByText('Nothing matches that filter.')).toBeVisible();
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

  test('custom colors reach the code; inverted pairs warn', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/qr/');
    const before = await app.dumpAll();

    await page.getByTestId('qr-dark').fill('#1e3a5f');
    await page.getByTestId('qr-light').fill('#fff8dc');
    // The SVG regenerates asynchronously — poll until the colors land.
    await expect.poll(() => page.getByTestId('qr-preview').innerHTML()).toContain('#1e3a5f');
    expect(await page.getByTestId('qr-preview').innerHTML()).toContain('#fff8dc');
    await expect(page.getByTestId('qr-color-warning')).toHaveCount(0);

    // White-on-black is inverted — scanners hate it, the tool says so.
    await page.getByTestId('qr-dark').fill('#ffffff');
    await page.getByTestId('qr-light').fill('#000000');
    await expect(page.getByTestId('qr-color-warning')).toContainText('Inverted');

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
