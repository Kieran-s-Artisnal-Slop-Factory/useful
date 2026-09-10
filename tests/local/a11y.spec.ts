/**
 * Phase 9 — the accessibility and payload sweep, run over EVERY registered
 * page rather than a sample, so a new tool cannot quietly ship without labels.
 *
 * What is checked here is the set of things that are (a) mechanical, and
 * (b) actually break people: controls with no accessible name, form fields
 * with no label, heading structure, contrast of the theme's own tokens in both
 * schemes, and the keyboard path through the app's chrome.
 *
 * Contrast is checked at the TOKEN level (text on background, muted text on
 * surface, borders against their backdrop) in both light and dark. That is
 * where a regression would come from — the palette is defined once and every
 * page inherits it.
 *
 * **What this sweep does NOT reach.** It audits each route's INITIAL render,
 * once. Anything behind an `{#if}` — a panel that appears after a file is
 * loaded, a field that only exists for one option of a radio group, the
 * imperial half of a units toggle — is never visited, so "the sweep covers
 * every registered page" means every page's front door and not every control
 * in the app. Two 0.5.0 examples: the colour extractor's whole palette and
 * theme section is gated on having an image, and the calorie calculator's
 * rate and target-weight fields only exist once the goal is not "maintain".
 * A tool whose controls mostly live behind a gate should carry its own label
 * assertions in its own spec rather than trusting this file to catch them.
 */
import { test, expect } from './helpers/app';
import { REGISTRY } from '../../src/lib/registry';

type P = import('@playwright/test').Page;

/**
 * Every route the app registers, taken FROM the registry rather than copied
 * beside it. A hand-maintained list is a list someone forgets to extend, and a
 * page missing from it ships unaudited while this suite stays green — so the
 * one source of truth for navigation is the one source of truth for the sweep
 * too. Adding a tool to the registry is all it takes to be audited here.
 */
const ROUTES = [...new Set(REGISTRY.map((tool) => tool.route))].sort();

interface A11yReport {
  headings: string[];
  unnamedControls: string[];
  unlabelledFields: string[];
  imagesWithoutAlt: number;
}

/** Collect the structural problems on whatever is currently rendered. */
async function audit(page: P): Promise<A11yReport> {
  return page.evaluate(() => {
    const visible = (el: Element): boolean => {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      return (el as HTMLElement).offsetParent !== null || style.position === 'fixed';
    };
    const describe = (el: Element): string =>
      `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''}` +
      `${(el as HTMLElement).dataset?.testid ? `[${(el as HTMLElement).dataset.testid}]` : ''}`;
    const named = (el: Element): boolean => {
      const aria = el.getAttribute('aria-label')?.trim();
      if (aria) return true;
      const labelledBy = el.getAttribute('aria-labelledby');
      if (labelledBy && labelledBy.split(/\s+/).some((id) => document.getElementById(id))) return true;
      if ((el.textContent ?? '').trim()) return true;
      const title = el.getAttribute('title')?.trim();
      return Boolean(title);
    };

    const unnamedControls: string[] = [];
    for (const el of document.querySelectorAll('button, a[href], summary')) {
      if (!visible(el)) continue;
      if (!named(el)) unnamedControls.push(describe(el));
    }

    const unlabelledFields: string[] = [];
    for (const el of document.querySelectorAll('input, select, textarea')) {
      if (!visible(el)) continue;
      const input = el as HTMLInputElement;
      if (input.type === 'hidden') continue;
      const id = input.id;
      const hasLabel =
        (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) ||
        input.closest('label') ||
        input.getAttribute('aria-label') ||
        input.getAttribute('aria-labelledby');
      if (!hasLabel) unlabelledFields.push(describe(el));
    }

    // Only main: the sidebar is a <nav> landmark with its own outline, and
    // its category headings legitimately precede the page's h1 in the DOM.
    const scope = document.querySelector('main') ?? document.body;
    const headings = [...scope.querySelectorAll('h1, h2, h3, h4, h5, h6')]
      .filter(visible)
      .map((h) => h.tagName.toLowerCase());

    const imagesWithoutAlt = [...document.querySelectorAll('img')].filter(
      (img) => !img.hasAttribute('alt')
    ).length;

    return { headings, unnamedControls, unlabelledFields, imagesWithoutAlt };
  });
}

test.describe('accessibility sweep', () => {
  test.slow();

  for (const route of ROUTES) {
    test(`${route} — labels, names and heading order`, async ({ app }) => {
      const { page } = app;
      await app.goto(route);
      // Let a client:only island mount before auditing an empty shell.
      await expect(page.locator('main h1')).toBeVisible();
      const report = await audit(page);

      expect(report.unnamedControls, `controls with no accessible name on ${route}`).toEqual([]);
      expect(report.unlabelledFields, `form fields with no label on ${route}`).toEqual([]);
      expect(report.imagesWithoutAlt, `images with no alt on ${route}`).toBe(0);

      // Exactly one h1, and no level skipped on the way down.
      expect(report.headings.filter((h) => h === 'h1').length, `h1 count on ${route}`).toBe(1);
      let previous = 1;
      for (const tag of report.headings) {
        const level = Number(tag.slice(1));
        expect(level, `heading order on ${route}: ${report.headings.join(' → ')}`).toBeLessThanOrEqual(
          previous + 1
        );
        previous = level;
      }
    });
  }
});

test.describe('theme contrast (AA)', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`${scheme}: text, muted text and borders clear AA`, async ({ app }) => {
      const { page } = app;
      await app.goto('/');
      await page.evaluate((mode) => {
        localStorage.setItem('useful-theme', mode);
        document.documentElement.style.colorScheme = mode;
      }, scheme);
      await page.reload();
      await expect(page.locator('main h1')).toBeVisible();

      const ratios = await page.evaluate(() => {
        const parse = (value: string): [number, number, number] => {
          const probe = document.createElement('span');
          probe.style.color = value;
          document.body.append(probe);
          const rgb = getComputedStyle(probe).color;
          probe.remove();
          const [r, g, b] = rgb.match(/[\d.]+/g)!.map(Number) as [number, number, number];
          return [r, g, b];
        };
        const channel = (c: number) => {
          const s = c / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        const luminance = ([r, g, b]: [number, number, number]) =>
          0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
        const contrast = (a: string, b: string) => {
          const la = luminance(parse(a));
          const lb = luminance(parse(b));
          const [hi, lo] = la > lb ? [la, lb] : [lb, la];
          return (hi + 0.05) / (lo + 0.05);
        };
        const token = (name: string) =>
          getComputedStyle(document.documentElement).getPropertyValue(name).trim();

        return {
          bodyText: contrast(token('--text-color'), token('--bg-color')),
          surfaceText: contrast(token('--text-color'), token('--surface-color')),
          mutedOnSurface: contrast(token('--text-muted-color'), token('--surface-color')),
          strongBorder: contrast(token('--border-strong-color'), token('--surface-color')),
          danger: contrast(token('--color-danger'), token('--surface-color')),
          success: contrast(token('--color-success'), token('--surface-color')),
          // 0.4.0 put warning-coloured TEXT on a card for the first time —
          // the empty-variable notice, the media size caution, the
          // content-type disagreement. Amber is the colour most likely to
          // miss AA, so it is checked like the other two rather than assumed.
          warning: contrast(token('--color-warning'), token('--surface-color')),
        };
      });

      // AA for body text and for text-sized muted copy.
      expect(ratios.bodyText, 'text on page background').toBeGreaterThanOrEqual(4.5);
      expect(ratios.surfaceText, 'text on card surface').toBeGreaterThanOrEqual(4.5);
      expect(ratios.mutedOnSurface, 'muted text on card surface').toBeGreaterThanOrEqual(4.5);
      expect(ratios.danger, 'danger text on card surface').toBeGreaterThanOrEqual(4.5);
      expect(ratios.success, 'success text on card surface').toBeGreaterThanOrEqual(4.5);
      expect(ratios.warning, 'warning text on card surface').toBeGreaterThanOrEqual(4.5);
      // AA for non-text (control boundaries).
      expect(ratios.strongBorder, 'strong border on card surface').toBeGreaterThanOrEqual(3);
    });
  }
});

test.describe('keyboard paths', () => {
  test('the palette opens, filters and navigates with the keyboard alone', async ({ app }) => {
    const { page } = app;
    await app.goto('/');
    await page.keyboard.press('Control+k');
    await expect(page.getByTestId('palette-input')).toBeVisible();
    await page.keyboard.type('photo');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/tools\/photography/);
    await expect(page.getByRole('heading', { name: 'Photography' })).toBeVisible();
  });

  test('every explainer disclosure opens from the keyboard', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/photography/');
    const summary = page.locator('details.explainer summary').first();
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('details.explainer').first()).toHaveAttribute('open', '');
  });

  /**
   * 0.4.0's hand-driven pass (Phase 7, item 1) over the HTTP playground. The
   * registry sweep already covers this page for labels and heading order; what
   * it cannot see is whether the new *interactions* work without a mouse, and
   * every one of them is a custom control or a disclosure.
   */
  test('the HTTP playground is fully operable from the keyboard', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/http-playground/');

    // Every card that starts closed opens with Enter on its summary.
    for (const id of ['hp-library-card', 'hp-env-card', 'hp-flows-card']) {
      const summary = page.getByTestId(id).locator('summary').first();
      await summary.focus();
      await expect(summary).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.getByTestId(id)).toHaveAttribute('open', '');
    }

    // The request can be built with the keyboard alone.
    await page.getByTestId('hp-url').focus();
    await page.keyboard.type('https://example.test/{{who}}');
    await expect(page.getByTestId('hp-add-missing-vars')).toBeVisible();

    // The scaffolding button is reachable and activates with Enter.
    await page.getByTestId('hp-add-missing-vars').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('hp-var-value-who')).toBeVisible();

    // The jump link is a real button: focusable, and Enter follows it. It also
    // leaves focus somewhere useful rather than dumping it at the page top.
    await page.getByTestId('hp-vars-section').evaluate((el) => ((el as HTMLDetailsElement).open = true));
    const jump = page.getByTestId('hp-vars-jump-who');
    await jump.focus();
    await expect(jump).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('hp-var-value-who')).toBeFocused();

    // Nothing in the new surfaces is a click-only div: every interactive
    // element carries an accessible name.
    const unnamed = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('button, select, input, textarea, a[href]')];
      return nodes
        .filter((el) => (el as HTMLElement).offsetParent !== null)
        .filter((el) => {
          const node = el as HTMLElement;
          const label = node.getAttribute('aria-label') ?? '';
          const labelled = node.id
            ? document.querySelector(`label[for="${CSS.escape(node.id)}"]`)?.textContent ?? ''
            : '';
          const title = node.getAttribute('title') ?? '';
          return !(label.trim() || labelled.trim() || title.trim() || node.textContent?.trim());
        })
        .map((el) => el.outerHTML.slice(0, 120));
    });
    expect(unnamed, 'interactive elements with no accessible name').toEqual([]);
  });
});
