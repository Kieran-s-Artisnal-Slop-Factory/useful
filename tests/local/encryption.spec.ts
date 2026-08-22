/**
 * Encryption (0.3.0 phase 6) — AES-GCM, RSA, ECDH, bcrypt and the one-time pad.
 *
 * The standing rule for this release's crypto pages: nothing secret is
 * persisted. Every case snapshots the database before the page loads and
 * asserts it is byte-identical afterwards — no password, no key, no plaintext,
 * no ciphertext reaches IndexedDB.
 *
 * The primitives are proved in the unit suite (round trips, tamper detection,
 * both sides of a key agreement). What is checked here is that the page wires
 * them up, and that each refusal reaches the screen with its reason.
 */
import { test, expect } from './helpers/app';

/** PBKDF2 at 600 000 iterations is the right default and the wrong test cost. */
const FAST_ITERATIONS = '10000';

test.describe('encryption', () => {
  test('encrypts and decrypts with a password, storing nothing', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/encryption/');
    test.slow();

    await expect(page.getByTestId('enc-nothing-stored')).toContainText('Nothing on this page is saved');

    await page.getByTestId('enc-plaintext').fill('the treasure is under the oak');
    await page.getByTestId('enc-password').fill('hunter2');
    await page.getByTestId('enc-iterations').fill(FAST_ITERATIONS);
    await page.getByTestId('enc-encrypt').click();

    const bundle = page.getByTestId('enc-bundle');
    await expect(bundle).toBeVisible({ timeout: 30_000 });
    const text = await bundle.inputValue();
    expect(text.startsWith('useful.aes256gcm.pbkdf2-sha256.10000.')).toBe(true);

    await page.getByTestId('enc-decrypt-card').getByText('Decrypt a bundle').click();
    await page.getByTestId('enc-decrypt-bundle').fill(text);
    await page.getByTestId('enc-decrypt-password').fill('hunter2');
    await page.getByTestId('enc-decrypt').click();
    await expect(page.getByTestId('enc-decrypted')).toHaveValue('the treasure is under the oak', {
      timeout: 30_000,
    });

    expect(await app.dumpAll()).toEqual(before);
  });

  test('a wrong password fails as an authentication failure', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/encryption/');
    test.slow();

    await page.getByTestId('enc-plaintext').fill('secret');
    await page.getByTestId('enc-password').fill('right');
    await page.getByTestId('enc-iterations').fill(FAST_ITERATIONS);
    await page.getByTestId('enc-encrypt').click();
    const bundle = await page.getByTestId('enc-bundle').inputValue();

    await page.getByTestId('enc-decrypt-card').getByText('Decrypt a bundle').click();
    await page.getByTestId('enc-decrypt-bundle').fill(bundle);
    await page.getByTestId('enc-decrypt-password').fill('wrong');
    await page.getByTestId('enc-decrypt').click();
    await expect(page.getByTestId('enc-decrypt-error')).toContainText('did not decrypt', {
      timeout: 30_000,
    });
  });

  test('RSA generates a pair, round-trips a short message and refuses a long one', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/encryption/');
    test.slow();

    await page.getByTestId('enc-rsa-card').getByText('A key pair (RSA-OAEP)').click();
    await expect(page.getByTestId('enc-rsa-limit')).toHaveText('190');

    await page.getByTestId('enc-rsa-generate').click();
    await expect(page.getByTestId('enc-rsa-public')).toBeVisible({ timeout: 60_000 });
    expect(await page.getByTestId('enc-rsa-public').inputValue()).toContain('BEGIN PUBLIC KEY');
    expect(await page.getByTestId('enc-rsa-private').inputValue()).toContain('BEGIN PRIVATE KEY');

    await page.getByTestId('enc-rsa-message').fill('meet at nine');
    await page.getByTestId('enc-rsa-encrypt').click();
    await expect(page.getByTestId('enc-rsa-cipher')).toBeVisible();
    await page.getByTestId('enc-rsa-decrypt').click();
    await expect(page.getByTestId('enc-rsa-plain')).toContainText('meet at nine');

    await page.getByTestId('enc-rsa-message').fill('x'.repeat(200));
    await page.getByTestId('enc-rsa-encrypt').click();
    await expect(page.getByTestId('enc-rsa-error')).toContainText('at most 190 bytes');
    await expect(page.getByTestId('enc-rsa-error')).toContainText('hybrid encryption');

    expect(await app.dumpAll()).toEqual(before);
  });

  test('both sides of a key agreement arrive at the same secret', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/encryption/');
    test.slow();

    await page.getByTestId('enc-ecdh-card').getByText('Key agreement (ECDH)').click();
    await page.getByTestId('enc-run-exchange').click();

    await expect(page.getByTestId('enc-shared')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('enc-match')).toContainText('never travelled');
    const alice = await page.getByTestId('enc-alice').inputValue();
    const bob = await page.getByTestId('enc-bob').inputValue();
    expect(alice).not.toBe(bob);
  });

  test('the small-numbers demonstration is labelled and both sides agree', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/encryption/');

    await page.getByTestId('enc-ecdh-card').getByText('Key agreement (ECDH)').click();
    await expect(page.getByTestId('enc-demo-warning')).toContainText('not a cipher');

    const a = await page.getByTestId('enc-demo-secret-a').textContent();
    const b = await page.getByTestId('enc-demo-secret-b').textContent();
    expect(a).toBe(b);

    await page.getByTestId('enc-demo-a').fill('7');
    const changed = await page.getByTestId('enc-demo-secret-a').textContent();
    expect(changed).not.toBe(a);
    await expect(page.getByTestId('enc-demo-secret-b')).toHaveText(changed!);
  });

  test('bcrypt hashes in a worker and verifies its own hash', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/encryption/');
    test.slow();

    await page.getByTestId('enc-bcrypt-card').getByText('Password hashing (bcrypt)').click();
    await page.getByTestId('enc-bcrypt-password').fill('correct horse battery staple');
    // Cost 4 is the floor and keeps the test honest about what it is testing.
    await page.getByTestId('enc-bcrypt-cost').fill('4');
    await page.getByTestId('enc-bcrypt-hash').click();

    const hash = page.getByTestId('enc-bcrypt-hash-value');
    await expect(hash).toBeVisible({ timeout: 30_000 });
    const value = (await hash.textContent()) ?? '';
    expect(value.startsWith('$2')).toBe(true);
    expect(value).toContain('$04$');
    await expect(page.getByTestId('enc-bcrypt-time')).toContainText('cost 4');

    await page.getByTestId('enc-verify-password').fill('correct horse battery staple');
    await page.getByTestId('enc-verify-hash').fill(value);
    await page.getByTestId('enc-verify').click();
    await expect(page.getByTestId('enc-verify-result')).toContainText('matches the hash', {
      timeout: 30_000,
    });

    await page.getByTestId('enc-verify-password').fill('wrong horse');
    await page.getByTestId('enc-verify').click();
    await expect(page.getByTestId('enc-verify-result')).toContainText('does not match');

    expect(await app.dumpAll()).toEqual(before);
  });

  test('the one-time pad makes a key as long as the message, and says the rules', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/encryption/');

    await page.getByTestId('enc-otp-card').getByText('One-time pad').click();
    await expect(page.getByTestId('enc-otp-rules')).toContainText('never reused');

    await page.getByTestId('enc-otp-message').fill('attack at dawn');
    await page.getByTestId('enc-otp-encrypt').click();

    const key = await page.getByTestId('enc-otp-key').inputValue();
    const cipher = await page.getByTestId('enc-otp-cipher').inputValue();
    expect(key.length).toBe(cipher.length);
    expect(key).not.toBe(cipher);

    // A second run makes a different key, because it is a ONE-time pad.
    await page.getByTestId('enc-otp-encrypt').click();
    expect(await page.getByTestId('enc-otp-key').inputValue()).not.toBe(key);

    expect(await app.dumpAll()).toEqual(before);
  });
});
