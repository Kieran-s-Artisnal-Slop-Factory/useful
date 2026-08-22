/**
 * Phase 4 — the secrets generator.
 *
 * The maths lives in Vitest (src/lib/gen/secrets.test.ts); what matters here is
 * the promise the page makes: every card produces something of the documented
 * shape, regenerating replaces it, copying works — and NOTHING is ever written
 * to the database or put in the URL, because the whole point is that these
 * values exist only in the tab.
 */
import { test, expect } from './helpers/app';
import { assertIsolatedDelta } from './helpers/oracle';

type P = import('@playwright/test').Page;

const value = (page: P, id: string) => page.getByTestId('sec-value-' + id);

/**
 * Open a collapsed category. Every group but Passwords starts closed, and a
 * control inside a closed <details> keeps a layout box while being unclickable
 * — so a test that forgets this fails on an actionability timeout rather than
 * on anything to do with what it was checking.
 */
async function openGroup(page: P, slug: string) {
  const group = page.getByTestId('sec-group-' + slug);
  if (await group.evaluate((el) => (el as HTMLDetailsElement).open)) return;
  await group.locator('summary').click();
  await expect(group).toHaveAttribute('open', '');
}

test.describe('secrets', () => {
  test('every card fills itself on load, and nothing is written', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/secrets/');

    // One card per generator; all of them non-empty without any interaction.
    const values = page.locator('[data-testid^="sec-value-"]');
    await expect(values).toHaveCount(27);
    await expect(value(page, 'strong')).not.toBeEmpty();
    // The passphrase's word list arrives separately, so it fills a beat later.
    await expect(value(page, 'memorable')).toContainText('-');

    expect(await app.dumpAll()).toEqual(before);
    expect(page.url()).not.toContain('?');
    expect(page.url()).not.toContain('#');
  });

  test('categories are disclosures: the first open, the rest a contents list', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/secrets/');
    const before = await app.dumpAll();

    // Passwords is open; the other four are closed but still named, so the top
    // of the page reads as a list of what is here.
    await expect(page.getByTestId('sec-group-passwords')).toHaveAttribute('open', '');
    for (const slug of ['keys-secrets', 'framework', 'identifiers', 'network-2fa']) {
      await expect(page.getByTestId('sec-group-' + slug)).not.toHaveAttribute('open', '');
      await expect(page.getByTestId('sec-group-' + slug).locator('summary')).toBeVisible();
    }
    // A closed group still generated its values — opening one shows a secret,
    // not an empty box.
    await expect(value(page, 'totp')).toHaveText(/^[A-Z2-7]{32}$/);
    await expect(page.getByTestId('sec-copy-totp')).toBeHidden();

    // Opening is a click on the summary, and closes nothing else: these are
    // independent disclosures, not a one-at-a-time accordion.
    await openGroup(page, 'network-2fa');
    await expect(page.getByTestId('sec-copy-totp')).toBeVisible();
    await expect(page.getByTestId('sec-group-passwords')).toHaveAttribute('open', '');

    // Enter on the focused summary toggles it — the keyboard path a <details>
    // brings with it.
    const summary = page.getByTestId('sec-group-framework').locator('summary');
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('sec-group-framework')).toHaveAttribute('open', '');

    // None of it is remembered, because none of it is written.
    expect(await app.dumpAll()).toEqual(before);
    await page.reload();
    await expect(page.getByTestId('sec-group-framework')).not.toHaveAttribute('open', '', {
      timeout: 30_000,
    });
  });

  test('each generator produces its documented shape', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/secrets/');

    await expect(value(page, 'strong')).toHaveText(/^.{16}$/);
    await expect(value(page, 'alphanumeric')).toHaveText(/^[A-Za-z0-9]{24}$/);
    await expect(value(page, 'pin')).toHaveText(/^\d{6}$/);
    await expect(value(page, 'api-key')).toHaveText(/^sk_live_[A-Za-z0-9]{32}$/);
    // A JWT secret is bytes, not a password: 32 bytes is 44 base64 characters.
    await expect(value(page, 'jwt-secret')).toHaveText(/^[A-Za-z0-9+/]{43}=$/);
    await expect(value(page, 'aes-key')).toHaveText(/^[0-9a-f]{64}$/);
    await expect(value(page, 'django')).toHaveText(/^.{50}$/);
    await expect(value(page, 'laravel')).toHaveText(/^base64:.{44}$/);
    await expect(value(page, 'flask')).toHaveText(/^[0-9a-f]{48}$/);
    await expect(value(page, 'uuid-v4')).toHaveText(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    await expect(value(page, 'uuid-v7')).toHaveText(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    await expect(value(page, 'object-id')).toHaveText(/^[0-9a-f]{24}$/);
    await expect(value(page, 'totp')).toHaveText(/^[A-Z2-7]{32}$/);
    await expect(value(page, 'wifi')).toHaveText(/^.{20}$/);
    await expect(value(page, 'recovery')).toHaveText(/^([A-Z0-9]{4}-){5}[A-Z0-9]{4}$/);
  });

  test('regenerating replaces the value in place; regenerate-all moves every card', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/secrets/');
    const before = await app.dumpAll();

    const first = await value(page, 'strong').textContent();
    await page.getByTestId('sec-regen-strong').click();
    await expect(value(page, 'strong')).not.toHaveText(first!);
    await expect(value(page, 'strong')).toHaveText(/^.{16}$/);

    const snapshot = await Promise.all(
      ['fort-knox', 'wifi', 'totp', 'uuid-v4'].map((id) => value(page, id).textContent())
    );
    await page.getByTestId('sec-regen-all').click();
    for (const [i, id] of ['fort-knox', 'wifi', 'totp', 'uuid-v4'].entries()) {
      await expect(value(page, id)).not.toHaveText(snapshot[i]!);
    }

    expect(await app.dumpAll()).toEqual(before);
  });

  test('the length option changes both the value and the entropy it claims', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/secrets/');

    await expect(page.getByTestId('sec-bits-strong')).toHaveText(/103 bits/);
    await page.getByTestId('sec-opt-strong').fill('32');
    await page.getByTestId('sec-opt-strong').blur();
    await expect(value(page, 'strong')).toHaveText(/^.{32}$/);
    await expect(page.getByTestId('sec-bits-strong')).toHaveText(/206 bits/);

    // Out-of-range input is clamped rather than obeyed.
    await page.getByTestId('sec-opt-strong').fill('999');
    await page.getByTestId('sec-opt-strong').blur();
    await expect(page.getByTestId('sec-opt-strong')).toHaveValue('64');
    await expect(value(page, 'strong')).toHaveText(/^.{64}$/);

    // A JWT secret's size follows the algorithm, per RFC 7518.
    await openGroup(page, 'keys-secrets');
    await page.getByTestId('sec-opt-jwt-secret').selectOption('HS512');
    await expect(value(page, 'jwt-secret')).toHaveText(/^.{88}$/);
    await expect(page.getByTestId('sec-bits-jwt-secret')).toHaveText(/512 bits/);
  });

  test('identifiers are labelled as identifiers, not as secrets', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/secrets/');
    // Quoting "122 bits" beside a UUID invites someone to use one as a token.
    for (const id of ['uuid-v4', 'uuid-v7', 'object-id']) {
      await expect(page.getByTestId('sec-bits-' + id)).toHaveText(/identifier/);
      await expect(page.getByTestId('sec-bits-' + id)).not.toHaveText(/bits of entropy/);
    }
  });

  test('copying puts the value on the clipboard', async ({ app }) => {
    const { page } = app;
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await app.goto('/tools/secrets/');
    const before = await app.dumpAll();

    await openGroup(page, 'network-2fa');
    const shown = await value(page, 'wifi').textContent();
    await page.getByTestId('sec-copy-wifi').click();
    await expect(page.getByTestId('sec-copy-wifi')).toHaveText('Copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(shown);

    expect(await app.dumpAll()).toEqual(before);
  });

  test('the page says plainly that nothing is kept, and explains WEP', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/secrets/');
    await expect(page.getByText(/Nothing here is\s+stored/)).toBeVisible();
    // WEP is absent on purpose, and the page says why rather than staying quiet
    // — inside a disclosure, like every other explanation in the app.
    await page.getByText('Wi-Fi, and why there is no WEP here').click();
    await expect(page.getByText('WEP is not offered.')).toBeVisible();
    const body = (await page.locator('main').textContent()) ?? '';
    expect(body).not.toMatch(/WEP key/i);
  });
});
