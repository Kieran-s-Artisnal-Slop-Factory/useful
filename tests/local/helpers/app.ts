import { test as base, expect, type Page } from '@playwright/test';
import { STORE_NAMES, TABLES } from './schema';

const HOOK = '__useful';

/**
 * Errors the PLATFORM raises, which say nothing about this app.
 *
 * Chromium aborts a view transition whose DOM update callback runs past its
 * deadline and reports the abort as an uncaught error. `<ClientRouter />`
 * starts a transition on every client-side navigation, so on a loaded machine
 * a link click trips it — the navigation still completes and the page is
 * correct, and there is nothing the app could do differently. Left in, it made
 * whichever spec happened to click a link at the wrong moment fail with "the
 * app logged errors". Everything not listed here still fails the test.
 */
const PLATFORM_NOISE: RegExp[] = [/Transition was aborted because of timeout in DOM update/i];

const isPlatformNoise = (message: string): boolean =>
  PLATFORM_NOISE.some((pattern) => pattern.test(message));

/**
 * Did this come from inside a sandboxed preview frame?
 *
 * The web playground (and, from Phase 3, the HTTP playground) runs foreign
 * code in an `srcdoc` iframe on purpose. Code failing in there is the tool's
 * SUBJECT MATTER — the console strip exists to show it — not this app
 * misbehaving, and a spec that deliberately throws in the preview must not
 * fail on it. A srcdoc document has no URL of its own, so both its errors and
 * its console lines are stamped `about:srcdoc`, which nothing in the app is.
 */
const isFromPreviewFrame = (where: string | undefined): boolean =>
  Boolean(where?.includes('about:srcdoc'));

/** The app under test, with a raw view of its database. */
export interface App {
  page: Page;
  errors: string[];
  goto(path?: string): Promise<void>;
  /** Wait until this document can be driven and its hook answers. */
  ready(): Promise<void>;
  call<T>(method: string, ...args: unknown[]): Promise<T>;
  dumpAll(): Promise<Record<string, Record<string, unknown>[]>>;
  dump(store: string): Promise<Record<string, unknown>[]>;
  get(store: string, id: string): Promise<Record<string, unknown> | undefined>;
}

export const test = base.extend<{ app: App }>({
  app: async ({ browser }, use) => {
    const context = await browser.newContext();
    // Set BEFORE the first navigation: the app reads the flag once at startup.
    // The try/catch is load-bearing: an init script runs in EVERY frame, and
    // the web playground's preview is sandboxed without `allow-same-origin`,
    // where merely touching localStorage throws. Only the top document reads
    // the flag, so failing quietly in a frame is exactly right.
    await context.addInitScript((key) => {
      try {
        localStorage.setItem(key, '1');
      } catch {
        /* a sandboxed frame has no storage — not our business */
      }
    }, 'useful-test-mode');
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      if (isPlatformNoise(m.text()) || isFromPreviewFrame(m.location().url)) return;
      errors.push('console: ' + m.text());
    });
    page.on('pageerror', (e) => {
      if (isPlatformNoise(e.message) || isFromPreviewFrame(e.stack)) return;
      errors.push('pageerror: ' + e.message);
    });

    const hookReady = () =>
      page.waitForFunction((hook) => Boolean((window as never)[hook]), HOOK, {
        timeout: 15_000,
      });

    const app: App = {
      page,
      errors,
      async goto(path = '/') {
        await page.goto(path);
        await app.ready();
      },
      async ready() {
        await hookReady();
        // The hook is its own lazy chunk and regularly lands BEFORE the islands
        // hydrate. That matters because Astro server-renders `client:load`
        // islands: the sidebar, the brand and the palette button are in the
        // HTML from the first paint and look perfectly ready while nothing is
        // listening yet, so a `Control+k` or a bare `.count()` on the next line
        // is a coin flip decided by machine load. `astro-island` removes its
        // `ssr` attribute the instant hydration finishes, so none being left is
        // the exact signal that the page can be driven.
        await page.waitForFunction(
          () => document.querySelectorAll('astro-island[ssr]').length === 0,
          undefined,
          { timeout: 15_000 }
        );
      },
      async call<T>(method: string, ...args: unknown[]): Promise<T> {
        // A spec that navigated by CLICKING is on a new document, and the hook
        // is a lazy chunk that may not have landed on it yet — which is how
        // `app.dump()` straight after a navigation used to fail on undefined.
        // Waiting here covers every caller and is free when it is already there.
        await hookReady();
        return page.evaluate(
          ({ hook, method: m, args: a }) =>
            (window as unknown as Record<string, Record<string, (...x: unknown[]) => unknown>>)[
              hook
            ]![m]!(...a) as unknown,
          { hook: HOOK, method, args }
        ) as Promise<T>;
      },
      dumpAll: () => app.call('rawDumpAll'),
      dump: (store) => app.call('rawDump', store),
      get: (store, id) => app.call('rawGet', store, id),
    };
    await app.goto();
    await use(app);
    expect(errors, 'the app logged errors').toEqual([]);
    await context.close();
  },
});

export { expect, STORE_NAMES, TABLES };
