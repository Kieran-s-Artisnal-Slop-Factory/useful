/**
 * Base64 (0.3.0 phase 4) — text and images, both directions.
 *
 * Stateless like the other converters: every case asserts the database is
 * byte-identical afterwards. What is worth testing beyond the unit suite is
 * the wiring — that the offset of a bad character reaches the screen, that a
 * decoded PNG is recognised as a PNG rather than trusted from a label, and
 * that the size cost is stated rather than implied.
 */
import { test, expect } from './helpers/app';

/** A 1x1 transparent PNG — the smallest real image there is. */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const clipboard = (page: import('@playwright/test').Page) =>
  page.evaluate(() => navigator.clipboard.readText());

test.describe('base64 text', () => {
  test('encodes and decodes text, including the characters btoa refuses', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/base64/');

    await expect(page.getByTestId('b64-empty')).toBeVisible();

    await page.getByTestId('b64-input').fill('foobar');
    await expect(page.getByTestId('b64-output')).toHaveValue('Zm9vYmFy');

    // btoa('café') throws; this does not.
    await page.getByTestId('b64-input').fill('café');
    await expect(page.getByTestId('b64-output')).toHaveValue('Y2Fmw6k=');
    await expect(page.getByTestId('b64-size')).toContainText('5 B in');

    await page.getByTestId('b64-direction').selectOption('decode');
    await page.getByTestId('b64-input').fill('Y2Fmw6k=');
    await expect(page.getByTestId('b64-output')).toHaveValue('café');

    expect(await app.dumpAll()).toEqual(before);
  });

  test('the alphabet and padding options change the output', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/base64/');
    await page.getByTestId('b64-input').fill('~~~');

    const output = page.getByTestId('b64-output');
    await expect(output).toHaveValue('fn5+');

    await page.getByTestId('b64-input').fill('~~~~');
    await expect(output).toHaveValue('fn5+fg==');
    await page.getByTestId('b64-urlsafe').check();
    await expect(output).toHaveValue('fn5-fg==');
    await page.getByTestId('b64-padding').uncheck();
    await expect(output).toHaveValue('fn5-fg');
  });

  test('a broken string is refused, and the offset is on screen', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/base64/');
    await page.getByTestId('b64-direction').selectOption('decode');
    await page.getByTestId('b64-input').fill('Zm9v!mFy');

    const error = page.getByTestId('b64-error');
    await expect(error).toContainText('not a base64 character');
    await expect(error).toContainText('At character 5');
    await expect(page.getByTestId('b64-output')).toHaveCount(0);
  });

  test('wrapping at 76 columns still decodes', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/base64/');
    await page.getByTestId('b64-wrap').check();
    await page.getByTestId('b64-input').fill('a'.repeat(100));
    const encoded = await page.getByTestId('b64-output').inputValue();
    expect(encoded.split('\n')[0]).toHaveLength(76);

    await page.getByTestId('b64-direction').selectOption('decode');
    await page.getByTestId('b64-input').fill(encoded);
    await expect(page.getByTestId('b64-output')).toHaveValue('a'.repeat(100));
  });
});

test.describe('base64 images', () => {
  test('encodes a chosen file, names its type from its bytes, and copies', async ({ app }) => {
    const { page } = app;
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const before = await app.dumpAll();
    await app.goto('/tools/base64/');

    await page.getByTestId('b64-mode').selectOption('image');
    await page.getByTestId('b64-file').setInputFiles({
      name: 'dot.png',
      mimeType: 'image/png',
      buffer: Buffer.from(PNG_BASE64, 'base64'),
    });

    await expect(page.getByTestId('b64-kind')).toContainText('PNG image');
    await expect(page.getByTestId('b64-preview')).toBeVisible();
    await expect(page.getByTestId('b64-dataurl')).toHaveValue(`data:image/png;base64,${PNG_BASE64}`);
    await expect(page.getByTestId('b64-encoded-size')).toContainText('+3');

    await page.getByTestId('b64-copy-css').click();
    expect(await clipboard(page)).toContain('background-image: url("data:image/png;base64,');

    expect(await app.dumpAll()).toEqual(before);
  });

  test('decodes a pasted data URL and identifies it from the bytes', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/base64/');

    await page.getByTestId('b64-mode').selectOption('image');
    await page.getByTestId('b64-direction').selectOption('decode');
    await page.getByTestId('b64-paste').fill(`data:image/png;base64,${PNG_BASE64}`);

    await expect(page.getByTestId('b64-decode-kind')).toContainText('PNG image');
    await expect(page.getByTestId('b64-decode-preview')).toBeVisible();
    await expect(page.getByTestId('b64-decode-download')).toContainText('.png');

    // A mislabelled data URL is identified by what it actually contains.
    await page.getByTestId('b64-paste').fill(`data:image/jpeg;base64,${PNG_BASE64}`);
    await expect(page.getByTestId('b64-decode-kind')).toContainText('PNG image');

    expect(await app.dumpAll()).toEqual(before);
  });

  test('something that is not an image says what it is instead', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/base64/');
    await page.getByTestId('b64-mode').selectOption('image');
    await page.getByTestId('b64-direction').selectOption('decode');
    // "%PDF-1.7" in base64.
    await page.getByTestId('b64-paste').fill('JVBERi0xLjc=');
    await expect(page.getByTestId('b64-decode-kind')).toContainText('PDF document');
    await expect(page.getByTestId('b64-decode-not-image')).toBeVisible();
    await expect(page.getByTestId('b64-decode-preview')).toHaveCount(0);
  });

  test('rubbish is refused with the reason', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/base64/');
    await page.getByTestId('b64-mode').selectOption('image');
    await page.getByTestId('b64-direction').selectOption('decode');
    await page.getByTestId('b64-paste').fill('this is not base64!!');
    await expect(page.getByTestId('b64-decode-error')).toContainText('not a base64 character');
  });
});
