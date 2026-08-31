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

/**
 * Wait until the service worker is not just active but actually CONTROLLING
 * this page.
 *
 * `clients.claim()` only reaches clients that exist when it runs, and on a
 * fresh profile the first navigation routinely starts before the worker has
 * activated — so that document stays uncontrolled however long you wait. That
 * is ordinary service-worker behaviour, not a fault: the next navigation is
 * controlled. Reloading once is what a real second page view does, and it is
 * the only way to get a controlled page deterministically.
 */
async function serviceWorkerInCharge(page: P) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  if (await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) return;
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, {
    timeout: 30_000,
  });
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
    await serviceWorkerInCharge(page);

    await pickLightBundles(page);
    await page.getByTestId('offline-start').click();
    await expect(page.getByTestId('offline-state-app')).toHaveText('Done', { timeout: 120_000 });
    // EVERY picked bundle, not just the app one. Going offline while another
    // is still fetching kills its requests, and the page then logs a resource
    // error that has nothing to do with what this test is about.
    await expect(page.getByTestId('offline-state-sqlite')).toHaveText('Done', { timeout: 120_000 });
    await expect(page.getByTestId('offline-state-math-fonts')).toHaveText('Done', {
      timeout: 120_000,
    });

    await page.context().setOffline(true);
    // A tool this profile has never opened — served entirely from the cache.
    await page.goto('/tools/photography/');
    await expect(page.getByRole('heading', { name: 'Photography' })).toBeVisible();
    await expect(page.getByTestId('ph-focal')).toBeVisible();
    await page.context().setOffline(false);
  });

  /**
   * 0.4.0's offline walk (Phase 7, item 2), for the two tools the release
   * added. The HTTP playground is the interesting one: it is the only tool in
   * the app that *needs* the network to do its job, so "works offline" means
   * something different for it — everything except Send has to work, and Send
   * has to fail in a way that says what happened.
   *
   * Both pages are opened for the first time with the network already off.
   */
  test('the 0.4.0 tools work offline, and the one that cannot says so', async ({ app }) => {
    const { page } = app;
    // Sending with no network is the point of the last third of this test,
    // and the browser logs the failed load however it was provoked.
    app.expectConsoleError(/Failed to (load resource|fetch)|net::ERR_INTERNET_DISCONNECTED/i);
    await app.goto('/settings/');
    await serviceWorkerInCharge(page);

    await pickLightBundles(page);
    await page.getByTestId('offline-start').click();
    await expect(page.getByTestId('offline-state-app')).toHaveText('Done', { timeout: 120_000 });
    await expect(page.getByTestId('offline-state-sqlite')).toHaveText('Done', { timeout: 120_000 });
    await expect(page.getByTestId('offline-state-math-fonts')).toHaveText('Done', {
      timeout: 120_000,
    });

    await page.context().setOffline(true);

    // --- the web playground: the editor and its sandboxed preview -----------
    // CodeMirror and the preview frame both come from cache here.
    await page.goto('/tools/web-playground/');
    await expect(page.getByTestId('wp-pane-html').locator('.cm-content')).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.frameLocator('iframe[title="Web playground preview"]').locator('body')
    ).toBeVisible({ timeout: 30_000 });

    // --- the HTTP playground ------------------------------------------------
    await page.goto('/tools/http-playground/');
    await expect(page.getByTestId('hp-idle')).toBeVisible();

    // Crafting works: headers, variables, secrets are all local.
    await page.getByTestId('hp-url').fill('https://example.test/{{thing}}');
    await expect(page.getByTestId('hp-add-missing-vars')).toBeVisible();
    await page.getByTestId('hp-add-missing-vars').click();
    await page.getByTestId('hp-env-card').evaluate((el) => ((el as HTMLDetailsElement).open = true));
    await expect(page.getByTestId('hp-var-value-thing')).toBeVisible();

    // The JSON editor is a lazy 350 KB chunk since Phase 7 — it must have been
    // precached, or making it lazy would have broken the tool offline.
    await page.getByTestId('hp-method').selectOption('POST');
    await page.getByTestId('hp-body-kind').selectOption('json');
    await expect(page.getByTestId('hp-json').locator('.cm-content')).toBeVisible({
      timeout: 30_000,
    });

    // And Send fails POLITELY: the classifier knows the browser is offline and
    // says so, rather than blaming CORS or the address.
    await page.getByTestId('hp-var-value-thing').fill('x');
    await page.getByTestId('hp-var-value-thing').blur();
    await page.getByTestId('hp-method').selectOption('GET');
    // Re-assert the emulation. Playwright's offline mode is applied to the
    // page session, and a cross-document navigation — there have been two —
    // brings `navigator.onLine` back to true even though the network stays
    // dead. Without this the classifier is fed the truth about the network
    // and a lie about the browser, and correctly reports the cross-origin
    // guess instead of the offline fact.
    // Toggled, not just re-set: Playwright treats setOffline(true) as a no-op
    // when it already believes it is offline, so the CDP command that actually
    // pushes `navigator.onLine` down to the new document is never re-sent.
    await page.context().setOffline(false);
    await page.context().setOffline(true);
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);

    await expect(page.getByTestId('hp-send')).toBeEnabled();
    await page.getByTestId('hp-send').click();

    const failure = page.getByTestId('hp-failure');
    await expect(failure).toHaveAttribute('data-kind', 'offline');
    await expect(failure).toContainText('offline');
    // Stated as a fact, because it is one — not hedged like a CORS guess.
    await expect(page.getByTestId('hp-failure-guess')).toHaveCount(0);
    // And it says the rest of the tool still works, which is the useful half.
    await expect(failure).toContainText('works offline');

    await page.context().setOffline(false);
  });
});
