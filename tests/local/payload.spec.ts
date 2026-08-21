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
  { label: 'YAML parser', match: /yaml/i },
  // 78 KB for one card on the secrets page — it must arrive on its own.
  { label: 'EFF word list', match: /wordlist/i },
  // The three logo engines: 2.0 MB, 826 KB and 328 KB of chunk between them.
  { label: 'DiceBear', match: /dicebear/i },
  { label: 'Lucide icons', match: /lucide/i },
  { label: 'Jdenticon', match: /jdenticon/i },
  // ~840 KB of editor plus a maths engine, for one page.
  { label: 'MathLive', match: /mathlive/i },
  { label: 'Compute Engine', match: /compute-engine/i },
  { label: 'KaTeX fonts', match: /\/math\/fonts\//i },
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

  test('the secrets page loads its word list separately, not in the page bundle', async ({ app }) => {
    const { page } = app;
    // The list is only wanted by the passphrase card; everything else on the
    // page is a few hundred bytes of maths.
    const urls = await watch(page, async () => {
      await app.goto('/tools/secrets/');
      await expect(page.getByTestId('sec-value-strong')).not.toBeEmpty();
    });
    const wordlist = urls.filter((u) => /wordlist/i.test(u));
    // It DOES arrive — as its own request, after the page is already usable.
    await expect(page.getByTestId('sec-value-memorable')).toContainText('-');
    expect(wordlist.length, 'the word list should be its own chunk').toBeLessThanOrEqual(1);
  });

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

  test('the logo generator loads only the engine its open tab needs', async ({ app }) => {
    const { page } = app;
    await app.goto('/');
    // Generators/DiceBear is the default view, so that engine is genuinely in
    // use the moment the page paints. The other two are not, and 1.1 MB of
    // chunk between them is exactly the kind of freight that must wait.
    const urls = await watch(page, async () => {
      await page.goto('/tools/logo-generator/');
      await expect(page.getByTestId('logo-styles')).toBeVisible();
    });
    expect(urls.filter((u) => /lucide/i.test(u)), 'Lucide loaded before the Badge tab').toEqual([]);
    expect(urls.filter((u) => /jdenticon/i.test(u)), 'Jdenticon loaded unasked').toEqual([]);
  });

  test('napkin math is the only page that pays for the maths editor', async ({ app }) => {
    const { page } = app;
    await app.goto('/');
    const urls = await watch(page, async () => {
      await page.goto('/tools/napkin-math/');
      await expect(page.getByTestId('napkin-no-fields')).toBeVisible({ timeout: 30_000 });
    });
    // It DOES arrive here — this is the page that needs it.
    expect(urls.some((u) => /mathlive/i.test(u)), 'the editor should load on its own page').toBe(
      true
    );
    // And the faces come from our own vendored copies, on demand: the
    // stylesheet's --ML__static-fonts flag stops MathLive fetching all twenty.
    const fonts = urls.filter((u) => /\.woff2/i.test(u));
    for (const url of fonts) expect(url).toContain('/math/fonts/');
    expect(fonts.length, 'every face was fetched eagerly').toBeLessThan(20);
    // The keypress sounds are 227 KB nobody asked for.
    expect(urls.filter((u) => /\.wav/i.test(u)), 'a keypress sound was fetched').toEqual([]);
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
