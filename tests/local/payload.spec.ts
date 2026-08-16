/**
 * Phase 9 — payload discipline.
 *
 * The app carries some genuinely heavy optional freight: a segmentation model,
 * two database engines, a 1.4MB city dataset. The rule is that none of it may
 * ride along with a page that does not use it, and none of it may end up in the
 * install precache. These tests watch the actual network to prove it, because
 * a lazy import is one careless refactor away from becoming eager.
 */
import { test, expect } from './helpers/app';

type P = import('@playwright/test').Page;

/** Substrings that identify each heavy bundle in a request URL. */
const HEAVY = [
  // Anchored on real filenames: a bare /ort/ also matches "export.js".
  { label: 'ONNX runtime', match: /ort-wasm|onnxruntime|ort\.wasm/i },
  { label: 'segmentation model', match: /u2netp|\/models\//i },
  { label: 'SQLite engine', match: /sqlite/i },
  { label: 'Postgres engine', match: /pglite/i },
  { label: 'city dataset', match: /cities/i },
  { label: 'CodeMirror', match: /codemirror|lezer/i },
];

/** Record every request URL the page makes while `work` runs. */
async function watch(page: P, work: () => Promise<void>): Promise<string[]> {
  const urls: string[] = [];
  const listener = (request: import('@playwright/test').Request) => urls.push(request.url());
  page.on('request', listener);
  try {
    await work();
    // Give any stray lazy import a moment to show up.
    await page.waitForTimeout(500);
  } finally {
    page.off('request', listener);
  }
  return urls;
}

test.describe('payload discipline', () => {
  test.slow();

  test('the home page pulls none of the heavy bundles', async ({ app }) => {
    const { page } = app;
    const urls = await watch(page, () => app.goto('/'));
    for (const bundle of HEAVY) {
      expect(urls.filter((u) => bundle.match.test(u)), `${bundle.label} loaded on the home page`).toEqual(
        []
      );
    }
  });

  test('a light tool page pulls none of them either', async ({ app }) => {
    const { page } = app;
    await app.goto('/');
    const urls = await watch(page, async () => {
      await page.goto('/tools/photography/');
      await expect(page.getByTestId('ph-focal')).toBeVisible();
    });
    for (const bundle of HEAVY) {
      expect(urls.filter((u) => bundle.match.test(u)), `${bundle.label} loaded by Photography`).toEqual(
        []
      );
    }
  });

  test('opening the background remover does not download the model on its own', async ({ app }) => {
    const { page } = app;
    await app.goto('/');
    const urls = await watch(page, async () => {
      await page.goto('/tools/background-remover/');
      await expect(page.getByTestId('bg-state')).toContainText('Not downloaded');
    });
    // The page is allowed to load its own code; the 15MB is not code.
    expect(urls.filter((u) => /u2netp|\.wasm/i.test(u)), 'model or wasm fetched on page load').toEqual(
      []
    );
  });

  test('the SQL playground loads one engine, not both', async ({ app }) => {
    const { page } = app;
    await app.goto('/');
    const urls = await watch(page, async () => {
      await page.goto('/tools/sql-playground/');
      await expect(page.getByTestId('sql-run')).toHaveText('Run', { timeout: 120_000 });
    });
    expect(urls.some((u) => /sqlite/i.test(u)), 'the default engine should load').toBe(true);
    expect(urls.filter((u) => /pglite/i.test(u)), 'Postgres loaded without being picked').toEqual([]);
  });

  test('the install precache holds the shell only — no model, no engines', async ({ app }) => {
    const { page } = app;
    await app.goto('/');
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, {
      timeout: 30_000,
    });

    const cached = await page.evaluate(async () => {
      const names = await caches.keys();
      const shell = names.find((n) => n.startsWith('useful-cache-'));
      if (!shell) return null;
      const keys = await (await caches.open(shell)).keys();
      return keys.map((r) => new URL(r.url).pathname);
    });
    expect(cached, 'no app cache found').not.toBeNull();
    expect(
      cached!.filter((p) => p.startsWith('/models/') || p.startsWith('/ort/')),
      'ML assets are in the install precache'
    ).toEqual([]);
  });
});
