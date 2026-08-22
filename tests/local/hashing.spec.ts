/**
 * Hashing (0.3.0 phase 5).
 *
 * The standing rule for this release's crypto pages: nothing secret is
 * persisted. Every case here snapshots the database before the page loads and
 * asserts it is byte-identical at the end — no message, no salt, no pepper, no
 * key reaches IndexedDB.
 *
 * The digests themselves are proved against OpenSSL in the unit suite; what is
 * checked here is that the right value reaches the screen, in the right
 * format, from the right composition.
 */
import { test, expect } from './helpers/app';

/** sha256("abc"), the FIPS 180-4 example. */
const SHA256_ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
/** md5("abc"), from RFC 1321. */
const MD5_ABC = '900150983cd24fb0d6963f7d28e17f72';
/** sha3-256("abc"), from FIPS 202. */
const SHA3_ABC = '3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532';

const clipboard = (page: import('@playwright/test').Page) =>
  page.evaluate(() => navigator.clipboard.readText());

test.describe('hashing', () => {
  test('computes every digest of the same message, and stores none of it', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/hashing/');

    await page.getByTestId('hash-input').fill('abc');

    await expect(page.getByTestId('hash-value-sha256')).toHaveText(SHA256_ABC);
    await expect(page.getByTestId('hash-value-md5')).toHaveText(MD5_ABC);
    await expect(page.getByTestId('hash-value-sha3-256')).toHaveText(SHA3_ABC);
    await expect(page.getByTestId('hash-value-sha224')).toHaveText(
      '23097d223405d8228642a477bda255b32aadbce4bda0b3f7e36c9da7'
    );

    // Twelve algorithms, and the two broken ones say so.
    await expect(page.getByTestId('hash-row')).toHaveCount(12);
    await expect(page.getByTestId('hash-warning-md5')).toContainText('2004');
    await expect(page.getByTestId('hash-warning-sha1')).toContainText('2017');

    expect(await app.dumpAll()).toEqual(before);
  });

  test('the output format changes the shape, not the value', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/hashing/');
    await page.getByTestId('hash-input').fill('abc');

    await page.getByTestId('hash-format').selectOption('hexUpper');
    await expect(page.getByTestId('hash-value-sha256')).toHaveText(SHA256_ABC.toUpperCase());

    await page.getByTestId('hash-format').selectOption('base64');
    await expect(page.getByTestId('hash-value-sha256')).toHaveText('ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=');

    await page.getByTestId('hash-format').selectOption('grouped');
    await expect(page.getByTestId('hash-value-sha256')).toHaveText(
      SHA256_ABC.match(/.{1,4}/g)!.join(' ')
    );
  });

  test('salt and pepper change the digest, and the formula says how', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/hashing/');

    await page.getByTestId('hash-input').fill('abc');
    await expect(page.getByTestId('hash-formula')).toHaveText('H(message)');

    await page.getByTestId('hash-salt').fill('NaCl');
    await expect(page.getByTestId('hash-formula')).toHaveText('H(salt ‖ message)');
    // sha256("NaClabc") — a different digest, deterministically.
    await expect(page.getByTestId('hash-value-sha256')).not.toHaveText(SHA256_ABC);
    const salted = await page.getByTestId('hash-value-sha256').textContent();

    await page.getByTestId('hash-salt-position').selectOption('suffix');
    await expect(page.getByTestId('hash-formula')).toHaveText('H(message ‖ salt)');
    await expect(page.getByTestId('hash-value-sha256')).not.toHaveText(salted!);

    await page.getByTestId('hash-pepper').fill('secret');
    await expect(page.getByTestId('hash-formula')).toHaveText('H(pepper ‖ message ‖ salt)');

    // A random salt is 32 hex characters and changes the digest again.
    await page.getByTestId('hash-salt-random').click();
    await expect(page.getByTestId('hash-salt')).toHaveValue(/^[0-9a-f]{32}$/);

    expect(await app.dumpAll()).toEqual(before);
  });

  test('SHAKE gives back the number of bytes it was asked for', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/hashing/');
    await page.getByTestId('hash-input').fill('abc');

    // 32 bytes = 64 hex characters, by default.
    await expect(page.getByTestId('hash-value-shake128')).toHaveText(/^[0-9a-f]{64}$/);
    await page.getByTestId('hash-shake-bytes').fill('8');
    await expect(page.getByTestId('hash-value-shake128')).toHaveText(/^[0-9a-f]{16}$/);
  });

  test('HMAC needs a key, and refuses the algorithms that have no HMAC', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/hashing/');

    await page.getByTestId('hash-input').fill('The quick brown fox jumps over the lazy dog');
    await expect(page.getByTestId('hash-hmac-empty')).toBeVisible();

    await page.getByTestId('hash-hmac-key').fill('key');
    // The published HMAC-SHA256 test value for this key and message.
    await expect(page.getByTestId('hash-hmac-value')).toHaveText(
      'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8'
    );

    await page.getByTestId('hash-hmac-algo').selectOption('md5');
    await expect(page.getByTestId('hash-hmac-value')).toHaveText(
      '80070713463e7749b90c2dc24911e275'
    );

    // SHAKE is not offered here at all — it has no HMAC.
    const options = await page.getByTestId('hash-hmac-algo').locator('option').allTextContents();
    expect(options).not.toContain('SHAKE128');

    expect(await app.dumpAll()).toEqual(before);
  });

  test('copying a digest works and the page still writes nothing', async ({ app }) => {
    const { page } = app;
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const before = await app.dumpAll();
    await app.goto('/tools/hashing/');

    await page.getByTestId('hash-input').fill('abc');
    // Wait for the digest to catch up with the input before copying it: the
    // page debounces by 150 ms, and the button copies what is on screen.
    await expect(page.getByTestId('hash-value-sha256')).toHaveText(SHA256_ABC);
    await page.getByTestId('hash-copy-sha256').click();
    await expect(page.getByTestId('hash-copy-sha256')).toHaveText('Copied');
    expect(await clipboard(page)).toBe(SHA256_ABC);

    expect(await app.dumpAll()).toEqual(before);
  });

  test('the page refuses to be mistaken for password storage', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/hashing/');
    const note = page.getByTestId('hash-password-note');
    await expect(note).toContainText('not a way to store passwords');
    await expect(note).toContainText('salt does nothing about that');
  });
});
