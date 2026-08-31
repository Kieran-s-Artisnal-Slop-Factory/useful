/**
 * Phase 6 — the logo generator.
 *
 * The builders are unit-tested (src/lib/gen/logo.test.ts); what this file
 * covers is the page's contract: every tab renders a real SVG, the exports
 * carry the right filenames, an engine nobody asked for is never downloaded,
 * and the page writes NOTHING to the database until the one button that
 * deliberately does — "Open in SVG editor".
 */
import { test, expect } from './helpers/app';
import { assertInvariants } from './helpers/oracle';

type P = import('@playwright/test').Page;

/** The preview `<img>` src, which is a percent-encoded data URI of the SVG. */
const PREFIX = 'data:image/svg+xml;utf8,';

async function previewSvg(page: P): Promise<string> {
  const src = await page.getByAltText('Logo preview').getAttribute('src');
  expect(src, 'no preview rendered').toBeTruthy();
  expect(src!.startsWith(PREFIX), `unexpected preview src: ${src!.slice(0, 40)}`).toBe(true);
  return decodeURIComponent(src!.slice(PREFIX.length));
}

/** Record every request the page makes while `work` runs. */
async function watch(page: P, work: () => Promise<void>): Promise<string[]> {
  const urls: string[] = [];
  const listener = (r: import('@playwright/test').Request) => urls.push(r.url());
  page.on('request', listener);
  try {
    await work();
    await page.waitForTimeout(500);
  } finally {
    page.off('request', listener);
  }
  return urls;
}

test.describe('logo generator', () => {
  test.slow();

  test('the DiceBear tab draws an avatar on open, and writes nothing', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/logo-generator/');

    await expect(page.getByTestId('logo-styles')).toBeVisible();
    const svg = await previewSvg(page);
    expect(svg).toContain('<svg');

    // Same seed, same picture: rebuilding must not roll new randomness.
    await page.getByTestId('logo-regenerate').click();
    expect(await previewSvg(page)).toBe(svg);

    // A different seed must change it.
    await page.getByTestId('logo-name').fill('something-else');
    await page.getByTestId('logo-name').blur();
    await expect.poll(() => previewSvg(page)).not.toBe(svg);

    expect(await app.dumpAll()).toEqual(before);
    expect(page.url()).not.toContain('?');
  });

  test('picking a style swaps the artwork and shows that style’s licence', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/logo-generator/');
    await expect(page.getByTestId('logo-license')).toContainText('MIT');

    // `bottts` is one of the four styles under the bespoke notice — the point
    // of the licence line is that it changes with the style, not that it exists.
    await page.getByTestId('logo-style').filter({ hasText: 'Bottts' }).first().click();
    await expect(page.getByTestId('logo-license')).toContainText('personal and commercial');
    expect(await previewSvg(page)).toContain('<svg');
  });

  test('Jdenticon renders at the logo size and reacts to its own knobs', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/logo-generator/');
    await page.getByTestId('logo-engine-jdenticon').click();

    // Switching engines swaps the chunk in, so the preview lags the click.
    await expect.poll(() => previewSvg(page)).toContain(`width="256"`);
    const svg = await previewSvg(page);

    await page.getByTestId('logo-jd-value').fill('another-value');
    await page.getByTestId('logo-jd-value').blur();
    await expect.poll(() => previewSvg(page)).not.toBe(svg);
  });

  test('the badge tab draws an icon tile and then an emoji tile', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/logo-generator/');
    await page.getByTestId('logo-tab-badge').click();

    // The icon list arrives with the Lucide chunk, so it fills a beat later —
    // and the PREVIEW follows the list. Until it does, the avatar from the
    // previous tab is still on screen: a perfectly valid SVG that happens to
    // contain `<rect`, so sampling once passed the first assertion on the
    // wrong picture and failed the second on it.
    await expect(page.getByTestId('logo-icon-count')).toContainText('icons');
    await expect
      .poll(() => previewSvg(page), { message: 'the badge preview never replaced the avatar' })
      .toContain('stroke=');
    const icon = await previewSvg(page);
    expect(icon).toContain('<rect');

    await page.getByTestId('logo-icon-filter').fill('anchor');
    await page.getByTestId('logo-icon').filter({ hasText: /^Anchor$/ }).first().click();
    await expect.poll(() => previewSvg(page)).not.toBe(icon);

    await page.getByTestId('logo-badge-emoji').click();
    await page.getByTestId('logo-emoji').fill('🦊');
    await page.getByTestId('logo-emoji').blur();
    await expect.poll(() => previewSvg(page)).toContain('🦊');
  });

  test('downloads carry the right filename and type', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/logo-generator/');
    await page.getByTestId('logo-name').fill('My Logo!');
    await page.getByTestId('logo-name').blur();
    await expect.poll(() => previewSvg(page)).toContain('<svg');

    const svgDownload = page.waitForEvent('download');
    await page.getByTestId('logo-download-svg').click();
    // The name is a filename, so anything awkward becomes a dash.
    expect((await svgDownload).suggestedFilename()).toBe('My-Logo-.svg');

    await page.getByTestId('logo-export-px').fill('64');
    const pngDownload = page.waitForEvent('download');
    await page.getByTestId('logo-download-png').click();
    expect((await pngDownload).suggestedFilename()).toBe('My-Logo-.png');
  });

  test('an engine is not downloaded until something asks for it', async ({ app }) => {
    const { page } = app;
    await app.goto('/');

    // The page opens on Generators/DiceBear, so that engine is genuinely in
    // use and arrives with the page. The other two are not.
    const onOpen = await watch(page, async () => {
      await page.goto('/tools/logo-generator/');
      await expect(page.getByTestId('logo-styles')).toBeVisible();
    });
    expect(onOpen.filter((u) => /lucide/i.test(u)), 'Lucide loaded before the Badge tab').toEqual([]);
    expect(onOpen.filter((u) => /jdenticon/i.test(u)), 'Jdenticon loaded without being picked').toEqual(
      []
    );

    const onBadge = await watch(page, async () => {
      await page.getByTestId('logo-tab-badge').click();
      await expect(page.getByTestId('logo-icon-count')).toContainText('icons');
    });
    expect(onBadge.some((u) => /lucide/i.test(u)), 'the Badge tab should fetch Lucide').toBe(true);
  });

  test('no logo engine rides along with any other page', async ({ app }) => {
    const { page } = app;
    await app.goto('/');
    const urls = await watch(page, async () => {
      await page.goto('/tools/secrets/');
      await expect(page.getByTestId('sec-value-strong')).not.toBeEmpty();
    });
    for (const engine of [/lucide/i, /jdenticon/i, /dicebear/i]) {
      expect(urls.filter((u) => engine.test(u)), `${engine} loaded by the secrets page`).toEqual([]);
    }
  });

  test('"Open in SVG editor" hands over one pasted-SVG layer and resumes there', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/logo-generator/');
    await page.getByTestId('logo-name').fill('handoff');
    await page.getByTestId('logo-name').blur();
    const built = await previewSvg(page);

    await page.getByTestId('logo-to-svg-editor').click();
    await page.waitForURL(/svg-editor/);

    const docs = await app.dump('svg_documents');
    expect(docs).toHaveLength(1);
    const doc = docs[0] as {
      id: string;
      name: string;
      width: number;
      height: number;
      layers: Record<string, unknown>[];
    };
    expect(doc.name).toBe('handoff');
    expect([doc.width, doc.height]).toEqual([256, 256]);
    expect(doc.layers).toHaveLength(1);
    expect(doc.layers[0]!.kind).toBe('svg');
    expect(doc.layers[0]!.svg).toBe(built);

    // The editor has no ?doc= route: it resumes whatever the preference names.
    const prefs = (await app.dump('preferences'))[0] as { svg_last_doc_id?: string };
    expect(prefs.svg_last_doc_id).toBe(doc.id);
    await expect(page.getByTestId('svg-canvas')).toBeVisible();

    assertInvariants(await app.dumpAll(), 'logo handoff');
  });
});
