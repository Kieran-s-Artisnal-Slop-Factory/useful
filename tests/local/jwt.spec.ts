/**
 * JWT (0.3.0 phase 7).
 *
 * Stateless like the other crypto pages: no token, secret or key is written
 * anywhere, and every case asserts the database is byte-identical afterwards.
 *
 * The distinction under test throughout is the one the page exists to keep:
 * decoding is not verifying. A tampered token still decodes; it just stops
 * verifying.
 */
import { test, expect } from './helpers/app';

const EXAMPLE_SECRET = 'your-256-bit-secret';

/** A token with alg: none and an interesting claim — the classic forgery. */
const NONE_TOKEN =
  'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiIxIiwiYWRtaW4iOnRydWV9.';

test.describe('jwt', () => {
  test('decodes a token without a key, and says that is all it did', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/jwt/');

    await page.getByTestId('jwt-example').click();

    await expect(page.getByTestId('jwt-alg')).toHaveText('HS256');
    await expect(page.getByTestId('jwt-header')).toContainText('"typ": "JWT"');
    await expect(page.getByTestId('jwt-payload')).toContainText('"name": "John Doe"');
    await expect(page.getByTestId('jwt-not-verified')).toContainText('base64url, not encryption');

    await expect(page.getByTestId('jwt-claim-sub')).toContainText('1234567890');
    await expect(page.getByTestId('jwt-claim-iat')).toContainText('2018-01-18');
    await expect(page.getByTestId('jwt-validity')).toContainText('does not expire');

    expect(await app.dumpAll()).toEqual(before);
  });

  test('verifies with the right secret and refuses the wrong one', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/jwt/');

    await page.getByTestId('jwt-example').click();
    await page.getByTestId('jwt-verify').click();
    await expect(page.getByTestId('jwt-verify-result')).toContainText('Signature verified');

    await page.getByTestId('jwt-secret').fill('not-the-secret');
    await page.getByTestId('jwt-verify').click();
    await expect(page.getByTestId('jwt-verify-result')).toContainText('does not match');

    expect(await app.dumpAll()).toEqual(before);
  });

  test('a tampered payload still decodes, and stops verifying', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/jwt/');

    await page.getByTestId('jwt-example').click();
    const token = await page.getByTestId('jwt-token').inputValue();
    const [header, , signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: '1234567890', name: 'Mallory' }))
      .toString('base64url');
    await page.getByTestId('jwt-token').fill(`${header}.${forged}.${signature}`);

    // It reads perfectly well — that is the point.
    await expect(page.getByTestId('jwt-payload')).toContainText('Mallory');
    await page.getByTestId('jwt-secret').fill(EXAMPLE_SECRET);
    await page.getByTestId('jwt-verify').click();
    await expect(page.getByTestId('jwt-verify-result')).toContainText('does not match');
  });

  test('alg: none is called out and never verifies', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/jwt/');

    await page.getByTestId('jwt-token').fill(NONE_TOKEN);
    await expect(page.getByTestId('jwt-alg')).toHaveText('none');
    await expect(page.getByTestId('jwt-none-warning')).toContainText('unsigned token');

    await page.getByTestId('jwt-secret').fill('anything');
    await page.getByTestId('jwt-verify').click();
    await expect(page.getByTestId('jwt-verify-result')).toContainText('alg: none');
  });

  test('signs a token that this page can then read back and verify', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/jwt/');

    await page.getByTestId('jwt-sign-card').getByText('Sign a new token').click();
    await page.getByTestId('jwt-sign-alg').selectOption('HS384');
    await page.getByTestId('jwt-sign-payload').fill('{"sub":"alice","role":"admin"}');
    await page.getByTestId('jwt-sign-secret').fill('a-secret-nobody-else-has');
    await page.getByTestId('jwt-sign').click();

    const token = await page.getByTestId('jwt-signed').inputValue();
    expect(token.split('.')).toHaveLength(3);

    await page.getByTestId('jwt-token').fill(token);
    await expect(page.getByTestId('jwt-alg')).toHaveText('HS384');
    await expect(page.getByTestId('jwt-payload')).toContainText('"role": "admin"');
    await page.getByTestId('jwt-secret').fill('a-secret-nobody-else-has');
    await page.getByTestId('jwt-verify').click();
    await expect(page.getByTestId('jwt-verify-result')).toContainText('Signature verified');

    expect(await app.dumpAll()).toEqual(before);
  });

  test('a malformed token says what is wrong with it', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/jwt/');

    await page.getByTestId('jwt-token').fill('not.a.jwt');
    await expect(page.getByTestId('jwt-error')).toContainText('not base64url-encoded JSON');

    await page.getByTestId('jwt-token').fill('one.two');
    await expect(page.getByTestId('jwt-error')).toContainText('three dot-separated parts');

    await page.getByTestId('jwt-token').fill('a.b.c.d.e');
    await expect(page.getByTestId('jwt-error')).toContainText('JWE');
  });
});
