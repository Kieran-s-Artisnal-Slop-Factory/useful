/**
 * Phase 9 — payload discipline.
 *
 * The app carries some genuinely heavy optional freight: a segmentation model,
 * two database engines, a 1.4MB city dataset. The rule is that none of it may
 * ride along with a page that does not use it, and none of it may end up in the
 * install precache. These tests watch the actual network to prove it, because
 * a lazy import is one careless refactor away from becoming eager.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './helpers/app';

type P = import('@playwright/test').Page;

const HERE = dirname(fileURLToPath(import.meta.url));
const ASTRO_DIR = join(HERE, '../../dist/_astro');

/**
 * A pattern matching the built chunks that actually contain `marker`.
 *
 * Needed because a bundled chunk is named after its entry file, not its
 * package: CodeMirror lands in `dist.<hash>.js`, because the package's own
 * entry is `dist/index.js`. A guard written as `/codemirror/` therefore
 * matched nothing at all and had been silently passing — found during 0.4.0's
 * Phase 7 payload pass, when the HTTP playground was seen pulling 348 KB of
 * editor that no test complained about.
 *
 * Matching a bare `/dist\./` instead would be worse: several packages emit
 * that name, so the guard would fire on unrelated chunks. Reading the build
 * is the only precise answer, and it costs one directory scan.
 */
function chunksContaining(marker: string): RegExp {
  const names = readdirSync(ASTRO_DIR)
    .filter((name) => name.endsWith('.js'))
    .filter((name) => readFileSync(join(ASTRO_DIR, name), 'utf8').includes(marker));
  if (names.length === 0) throw new Error(`no built chunk contains ${marker}`);
  return new RegExp(names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'));
}

/** Resolved once: the scan reads every chunk in the build. */
const CODEMIRROR_CHUNKS = chunksContaining('@codemirror');

/** How many FIGlet fonts the app ships — read from the catalogue the build
 * script writes, so this stays true when the list changes. */
const FONT_COUNT: number = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../src/lib/ascii/fonts.json'), 'utf8')
).length;

/** Substrings that identify each heavy bundle in a request URL. */
const HEAVY = [
  // Anchored on real filenames: a bare /ort/ also matches "export.js".
  { label: 'ONNX runtime', match: /ort-wasm|onnxruntime|ort\.wasm/i },
  { label: 'segmentation model', match: /u2netp|\/models\//i },
  { label: 'SQLite engine', match: /sqlite/i },
  { label: 'Postgres engine', match: /pglite/i },
  { label: 'city dataset', match: /cities/i },
  // Resolved from the build: the chunk is named `dist.<hash>.js`, so the
  // obvious `/codemirror/` matched nothing. See `chunksContaining`.
  { label: 'CodeMirror', match: CODEMIRROR_CHUNKS },
  { label: 'YAML parser', match: /yaml/i },
  // The config playground's convert dialog is the only thing that reads TOML,
  // and it imports the parser inside the conversion — so not even that page
  // pays for it until someone asks for TOML.
  { label: 'TOML parser', match: /smol-toml|\btoml\b/i },
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
  // The notebook: a WYSIWYG editor, a diagram engine and a maths renderer —
  // added to the guard before the first line of notebook code, as planned.
  { label: 'Milkdown / ProseMirror', match: /milkdown|prosemirror|crepe/i },
  { label: 'mermaid', match: /mermaid/i },
  { label: 'KaTeX', match: /katex/i },
  { label: 'Excalidraw', match: /excalidraw/i },
  // bcrypt is small (~25 KB) but it lives in a worker on one page, and the
  // point of the worker is that it never runs on the main thread — a stray
  // import would be a frozen tab, not just a slow page.
  { label: 'bcryptjs', match: /bcrypt/i },
  // The TypeScript stripper, wanted only when the web playground is switched
  // to TS — never by a JavaScript session, and never by any other page.
  { label: 'sucrase', match: /sucrase/i },
  // The FIGfont renderer, ~50 KB, wanted by exactly one page. Anchored on the
  // chunk filename rather than the word: `/figlet/standard.flf` is a font
  // file the service worker precaches, and it is not this.
  { label: 'figlet', match: /figlet[^/]*\.js/i },
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

  test('bcrypt reaches the encryption page only when it is asked to hash', async ({ app }) => {
    const { page } = app;
    const idle = await watch(page, async () => {
      await app.goto('/tools/encryption/');
      await expect(page.getByTestId('enc-nothing-stored')).toBeVisible();
    });
    expect(idle.filter((url) => /bcrypt/i.test(url)), 'bcrypt should not load with the page').toEqual(
      []
    );

    const used = await watch(page, async () => {
      await page.getByTestId('enc-bcrypt-card').getByText('Password hashing (bcrypt)').click();
      await page.getByTestId('enc-bcrypt-password').fill('x');
      await page.getByTestId('enc-bcrypt-cost').fill('4');
      await page.getByTestId('enc-bcrypt-hash').click();
      await expect(page.getByTestId('enc-bcrypt-hash-value')).toBeVisible({ timeout: 90_000 });
    });
    expect(used.some((url) => /bcrypt/i.test(url)), 'bcrypt should arrive on demand').toBe(true);
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
      // app.goto, not page.goto: the island has to have hydrated before
      // `bg-state` exists at all, and the whole point here is to watch the
      // requests the load makes.
      await app.goto('/tools/background-remover/');
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


  test('the image export stays behind its button', async ({ app }) => {
    const { page } = app;
    await app.goto('/');
    // A marker only the SVG builder carries — the baseline probe it inserts
    // to measure where the browser put each text run. Resolved from the real
    // build, because guessing a chunk name is how the CodeMirror guard sat
    // inert for several releases. A MathLive class name is NOT usable here:
    // those live in the editor bundle too, which this page loads on purpose.
    const EXPORT_CHUNKS = chunksContaining('width:0;height:0;vertical-align:baseline');

    const onLoad = await watch(page, async () => {
      await page.goto('/tools/napkin-math/');
      await expect(page.getByTestId('napkin-no-fields')).toBeVisible({ timeout: 30_000 });
    });
    expect(
      onLoad.filter((url) => EXPORT_CHUNKS.test(url)),
      'the image export loaded on a page that never opened it'
    ).toEqual([]);

    // And it DOES arrive once the dialog is opened — a guard that can never
    // fire is not a guard.
    await expect(page.getByTestId('napkin-formula-loading')).toHaveCount(0, { timeout: 30_000 });
    await page.locator('[data-testid="napkin-formula"]').evaluate((element) => {
      (element as HTMLElement & { value: string }).value = '\\mathrm{aa}+\\mathrm{bb}';
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.getByTestId('napkin-export-image')).toBeEnabled({ timeout: 30_000 });
    const onOpen = await watch(page, async () => {
      await page.getByTestId('napkin-export-image').click();
      await expect(page.getByTestId('napkin-image-preview')).toBeVisible({ timeout: 30_000 });
    });
    expect(
      onOpen.some((url) => EXPORT_CHUNKS.test(url)),
      'the image export never loaded even when opened'
    ).toBe(true);
  });

  test('ascii art brings figlet as its own chunk, and its fonts one row at a time', async ({ app }) => {
    const { page } = app;
    await app.goto('/');
    const urls = await watch(page, async () => {
      await page.goto('/tools/ascii-art/');
      await expect(page.getByTestId('aa-output')).toContainText('_');
    });
    // It DOES arrive here — this is the page that needs it — but as one
    // separately-loaded chunk rather than something baked into the island.
    const chunks = urls.filter((u) => /figlet[^/]*\.js/i.test(u));
    expect(chunks.length, 'figlet should arrive as exactly one lazy chunk').toBe(1);

    // And the fonts are fetched by the picker as its rows scroll
    // into view. A list nobody has looked at must not cost 178 KB.
    const fonts = urls.filter((u) => /\.flf(\?|$)/i.test(u));
    expect(fonts.length, 'the chosen font should load').toBeGreaterThanOrEqual(1);
    expect(fonts.length, 'the whole catalogue was fetched to draw a list').toBeLessThan(FONT_COUNT);
  });

  test('placeholders pulls the icon set only when the icon generator is picked', async ({ app }) => {
    const { page } = app;
    await app.goto('/');
    const idle = await watch(page, async () => {
      await page.goto('/tools/placeholders/');
      await expect(page.getByTestId('ph-text')).toContainText('Lorem ipsum');
      await page.getByTestId('ph-mode').selectOption('image');
      await page.getByTestId('ph-gen-flow').click();
      await expect(page.getByTestId('ph-preview')).toBeVisible();
    });
    // Seven of the eight generators draw with arithmetic; 2 MB of icon set is
    // not something the other seven should pay for.
    expect(idle.filter((url) => /lucide/i.test(url)), 'Lucide loaded before the icon generator').toEqual([]);

    const used = await watch(page, async () => {
      await page.getByTestId('ph-gen-icon').click();
      await expect(page.getByTestId('ph-icons').locator('button')).not.toHaveCount(0, { timeout: 60_000 });
    });
    expect(used.some((url) => /lucide/i.test(url)), 'Lucide should arrive on demand').toBe(true);
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

  /**
   * The HTTP playground's default state is a GET with no body, so neither the
   * editor nor the highlighter is wanted yet — and between them they are
   * ~390 KB. Both were eager until 0.4.0's Phase 7 payload pass.
   */
  test('the HTTP playground brings neither CodeMirror nor Prism until asked', async ({ app }) => {
    const { page } = app;
    await app.goto('/');
    const idle = await watch(page, async () => {
      await page.goto('/tools/http-playground/');
      await expect(page.getByTestId('hp-idle')).toBeVisible();
    });
    expect(
      idle.filter((url) => CODEMIRROR_CHUNKS.test(url)),
      'CodeMirror rode along with a page whose default body is None'
    ).toEqual([]);
    expect(idle.filter((url) => /prism/i.test(url)), 'Prism loaded before any response').toEqual([]);

    // The editor arrives when a JSON body is chosen, and the body stays
    // editable in the meantime.
    const editing = await watch(page, async () => {
      await page.getByTestId('hp-method').selectOption('POST');
      await page.getByTestId('hp-body-kind').selectOption('json');
      await expect(page.getByTestId('hp-json').locator('.cm-content')).toBeVisible();
    });
    expect(editing.some((url) => CODEMIRROR_CHUNKS.test(url)), 'the editor should arrive').toBe(
      true
    );

    // Prism arrives with the first response that wants colouring.
    const responding = await watch(page, async () => {
      await page.getByTestId('hp-method').selectOption('GET');
      await page.getByTestId('hp-url').fill('http://127.0.0.1:4330/__echo/css');
      await page.getByTestId('hp-send').click();
      await expect(page.getByTestId('hp-body').locator('span.token')).not.toHaveCount(0);
    });
    expect(responding.some((url) => /prism/i.test(url)), 'Prism should arrive on demand').toBe(true);
  });

  /**
   * Checklist item 8 for the one tool that is *allowed* to call out: it must
   * do so only when Send is pressed. Everything else on the page — crafting,
   * variables, secrets, saving — is local.
   */
  test('the HTTP playground reaches the network only when Send is pressed', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/http-playground/');

    const target = 'http://127.0.0.1:4330/__echo/json';
    const crafting = await watch(page, async () => {
      await page.getByTestId('hp-url').fill(target);
      await page.getByTestId('hp-header-add').click();
      await page.getByTestId('hp-header-name-1').fill('X-Test');
      await page.getByTestId('hp-header-value-1').fill('1');
      await page.getByTestId('hp-env-card').evaluate((el) => ((el as HTMLDetailsElement).open = true));
      await page.getByTestId('hp-var-new-name').fill('base_url');
      await page.getByTestId('hp-var-new-value').fill('https://example.test');
      await page.getByTestId('hp-var-add').click();
      await expect(page.getByTestId('hp-var-value-base_url')).toHaveValue('https://example.test');
    });
    // Typing a URL is not visiting it. Nothing may go to the target until asked.
    expect(
      crafting.filter((url) => url.includes('/__echo/')),
      'the playground called out before Send was pressed'
    ).toEqual([]);

    const sending = await watch(page, async () => {
      await page.getByTestId('hp-send').click();
      await expect(page.getByTestId('hp-status')).toContainText('200');
    });
    expect(sending.filter((url) => url.includes('/__echo/json')).length).toBe(1);
  });

  test('the install precache holds the shell only — no model, no engines', async ({ app }) => {
    const { page } = app;
    await app.goto('/');
    /**
     * Waiting for the worker to CONTROL this page, not merely to be ready.
     *
     * `clients.claim()` only reaches clients that already exist when it runs,
     * and on a fresh profile the first navigation regularly starts before the
     * worker has activated — so that document stays uncontrolled however long
     * you wait, and a bare `waitForFunction` here times out under load. That
     * is ordinary service-worker behaviour rather than a fault: the NEXT
     * navigation is controlled. One reload is what a real second page view
     * does, and it is the only deterministic way through. Copied from
     * `serviceWorkerInCharge` in offline.spec.ts, which learned this first.
     */
    await page.evaluate(() => navigator.serviceWorker.ready);
    if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) {
      await page.reload();
      await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, {
        timeout: 30_000,
      });
    }

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
