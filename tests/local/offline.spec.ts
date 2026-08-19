/**
 * Offline readiness — the post-install offer and what it actually buys.
 *
 * The interesting assertion is the last one: after the download, the browser
 * goes offline and lands on a page this profile has NEVER opened. That is the
 * whole promise of the feature, and nothing weaker proves it.
 */
import { test, expect } from './helpers/app';
import { assertIsolatedDelta } from './helpers/oracle';

type P = import('@playwright/test').Page;

/** Only the light bundles: the model and Postgres are tens of megabytes. */
async function pickLightBundles(page: P) {
  await page.getByTestId('offline-pick-bg-model').uncheck();
  await page.getByTestId('offline-pick-pglite').uncheck();
}

test.describe('offline readiness', () => {
  test.slow();

  test('Settings downloads the chosen bundles and records when', async ({ app }) => {
    const { page } = app;
    await app.goto('/settings/');
    const before = await app.dumpAll();
    await expect(page.getByTestId('offline-summary')).toContainText('without a network');

    await pickLightBundles(page);
    await page.getByTestId('offline-start').click();

    await expect(page.getByTestId('offline-state-app')).toHaveText('Done', { timeout: 120_000 });
    await expect(page.getByTestId('offline-state-sqlite')).toHaveText('Done', { timeout: 120_000 });
    // Unpicked bundles are not touched at all.
    await expect(page.getByTestId('offline-state-pglite')).toHaveCount(0);

    await expect(page.getByTestId('offline-finished')).toContainText('Last downloaded');
    // One preference row, one write.
    assertIsolatedDelta(before, await app.dumpAll(), [{ store: 'preferences', id: 'singleton' }]);
    const prefs = (await app.dump('preferences'))[0] as Record<string, unknown>;
    expect(prefs.offline_ready_at).toBeTruthy();
  });

  test('the install offer appears once and remembers the answer', async ({ app }) => {
    const { page } = app;
    await app.goto('/');
    const before = await app.dumpAll();
    await expect(page.getByTestId('offline-dialog')).toHaveCount(0);

    // The browser fires this when the app is installed.
    await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
    await expect(page.getByTestId('offline-dialog')).toBeVisible();
    await expect(page.getByTestId('offline-dialog')).toContainText('Make it work offline?');

    await page.getByTestId('offline-dismiss').click();
    await expect(page.getByTestId('offline-dialog')).toHaveCount(0);
    // Answering (either way) is remembered, on the preferences singleton only.
    await expect
      .poll(async () => ((await app.dump('preferences'))[0] as Record<string, unknown>)?.offline_prompt_seen)
      .toBe(true);
    assertIsolatedDelta(before, await app.dumpAll(), [{ store: 'preferences', id: 'singleton' }]);

    // Asked once: a second install event (or a reload) stays quiet.
    await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
    await page.waitForTimeout(300);
    await expect(page.getByTestId('offline-dialog')).toHaveCount(0);
    await page.reload();
    await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
    await page.waitForTimeout(300);
    await expect(page.getByTestId('offline-dialog')).toHaveCount(0);
  });

  test('dismissing the install offer with Escape still counts as an answer', async ({ app }) => {
    // The offer used to record an answer ONLY from the "Not now" button, so
    // pressing Escape closed the dialog and left no trace — and the app asked
    // again on the next launch. Every exit from the dialog is an answer.
    const { page } = app;
    await app.goto('/');
    const before = await app.dumpAll();

    await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
    await expect(page.getByTestId('offline-dialog')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('offline-dialog')).toHaveCount(0);

    await expect
      .poll(async () => ((await app.dump('preferences'))[0] as Record<string, unknown>)?.offline_prompt_seen)
      .toBe(true);
    assertIsolatedDelta(before, await app.dumpAll(), [{ store: 'preferences', id: 'singleton' }]);

    // And it stays answered across a reload.
    await page.reload();
    await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
    await page.waitForTimeout(300);
    await expect(page.getByTestId('offline-dialog')).toHaveCount(0);
  });

  test('after the download, a never-visited page still loads with the network off', async ({ app }) => {
    const { page } = app;
    await app.goto('/settings/');
    // The service worker has to be in charge before it can serve anything.
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, {
      timeout: 30_000,
    });

    await pickLightBundles(page);
    await page.getByTestId('offline-start').click();
    await expect(page.getByTestId('offline-state-app')).toHaveText('Done', { timeout: 120_000 });

    await page.context().setOffline(true);
    // A tool this profile has never opened — served entirely from the cache.
    await page.goto('/tools/photography/');
    await expect(page.getByRole('heading', { name: 'Photography' })).toBeVisible();
    await expect(page.getByTestId('ph-focal')).toBeVisible();
    await page.context().setOffline(false);
  });
});
