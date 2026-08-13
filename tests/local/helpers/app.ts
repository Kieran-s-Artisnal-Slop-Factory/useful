import { test as base, expect, type Page } from '@playwright/test';
import { STORE_NAMES, TABLES } from './schema';

const HOOK = '__useful';

/** The app under test, with a raw view of its database. */
export interface App {
  page: Page;
  errors: string[];
  goto(path?: string): Promise<void>;
  call<T>(method: string, ...args: unknown[]): Promise<T>;
  dumpAll(): Promise<Record<string, Record<string, unknown>[]>>;
  dump(store: string): Promise<Record<string, unknown>[]>;
  get(store: string, id: string): Promise<Record<string, unknown> | undefined>;
}

export const test = base.extend<{ app: App }>({
  app: async ({ browser }, use) => {
    const context = await browser.newContext();
    // Set BEFORE the first navigation: the app reads the flag once at startup.
    await context.addInitScript((key) => localStorage.setItem(key, '1'), 'useful-test-mode');
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push('console: ' + m.text());
    });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

    const app: App = {
      page,
      errors,
      async goto(path = '/') {
        await page.goto(path);
        await page.waitForFunction((hook) => Boolean((window as never)[hook]), HOOK, {
          timeout: 15_000,
        });
      },
      call<T>(method: string, ...args: unknown[]): Promise<T> {
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
