/**
 * Phase 8 — napkin math.
 *
 * The model, the validators and the four code emitters are unit-tested. What
 * matters here is the page's contract: typing a formula creates the right
 * fields, saving writes exactly one row, reload restores, export/import round
 * trips, and — the case that justifies the whole code generator — the
 * generated web component is LOADED IN A PAGE and computes the same answer
 * the app showed.
 *
 * Plus the payload rules: MathLive never reaches another route, and the
 * keypress sounds are never fetched at all.
 */
import { readFileSync } from 'node:fs';
import { test, expect } from './helpers/app';
import { assertIsolatedDelta, assertInvariants } from './helpers/oracle';

type P = import('@playwright/test').Page;

/**
 * Wait until the mathfield can actually be driven.
 *
 * `MathField.insert()` returns SILENTLY when the component is not `ready`, so
 * an insert button clicked too early does nothing at all and no amount of
 * retrying the assertion afterwards recovers. `napkin-no-fields` is not the
 * signal — that is about the field LIST and is on screen immediately. The
 * component's own "Loading the formula editor…" line going away is, because it
 * is rendered from the same `ready` flag `insert()` checks.
 */
async function mathFieldReady(page: P) {
  await expect(page.getByTestId('napkin-formula-loading')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId('napkin-formula')).toBeVisible({ timeout: 30_000 });
}

/** The LaTeX the mathfield currently holds — proof that an insert landed. */
function formulaValue(page: P): Promise<string> {
  return page
    .locator('[data-testid="napkin-formula"]')
    .evaluate((el) => (el as HTMLElement & { value: string }).value);
}

/** Type into the mathfield through its own API, which owns its keystrokes. */
async function typeFormula(page: P, text: string) {
  const field = page.locator('[data-testid="napkin-formula"]');
  await mathFieldReady(page);
  // Focus through the element's own API and then WAIT: focus on a custom
  // element is not instant, and without the pause the first keystrokes land
  // nowhere — which shows up as a formula missing its first letter.
  await field.evaluate((element) => (element as HTMLElement).focus());
  await page.waitForTimeout(300);
  for (const ch of text) {
    await page.keyboard.type(ch);
    await page.waitForTimeout(50);
  }
  await page.waitForTimeout(500);
}

test.describe('napkin math', () => {
  test.slow();

  test('a formula becomes typed fields, and nothing is written until Save', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/napkin-math/');
    await expect(page.getByTestId('napkin-no-fields')).toBeVisible({ timeout: 30_000 });

    // `count` is one variable, not five letters multiplied together — that is
    // what the inline-shortcut hook is for.
    await typeFormula(page, 'revenue/units');
    const fields = page.getByTestId('napkin-field');
    await expect(fields).toHaveCount(2);
    await expect(fields.first()).toHaveAttribute('data-name', 'revenue');

    // Looking at it writes nothing at all.
    expect(await app.dumpAll()).toEqual(before);

    await page.getByTestId('napkin-input-revenue').fill('10');
    await page.getByTestId('napkin-input-units').fill('4');
    await expect(page.getByTestId('napkin-result')).toHaveText('2.5');
    expect(await app.dumpAll()).toEqual(before);
  });

  test('saving a template writes exactly one row, and a reload restores it', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/napkin-math/');
    await expect(page.getByTestId('napkin-no-fields')).toBeVisible({ timeout: 30_000 });

    await page.getByTestId('napkin-name').fill('Margin');
    await typeFormula(page, 'revenue-cost');
    await page.getByTestId('napkin-save-template').click();
    await expect(page.getByTestId('napkin-feedback')).toContainText('Template saved');

    const rows = await app.dump('napkin_templates');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('Margin');
    expect((rows[0]!.fields as { name: string }[]).map((f) => f.name)).toEqual(['cost', 'revenue']);
    // One template row plus the "which one was open" preference.
    assertIsolatedDelta(before, await app.dumpAll(), [
      { store: 'napkin_templates', id: String(rows[0]!.id) },
      { store: 'preferences', id: 'singleton' },
    ]);

    await page.reload();
    await expect(page.getByTestId('napkin-name')).toHaveValue('Margin', { timeout: 30_000 });
    await expect(page.getByTestId('napkin-field')).toHaveCount(2);
  });

  test('saving a calculation saves the unsaved template with it', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/napkin-math/');
    await expect(page.getByTestId('napkin-no-fields')).toBeVisible({ timeout: 30_000 });
    // Deliberately NOT saving the template first. Refusing here was the bug:
    // the button was live, nothing was written, and the only clue was a
    // transient line at the far end of the page.
    await typeFormula(page, 'revenue-cost');
    await page.getByTestId('napkin-input-revenue').fill('10');
    await page.getByTestId('napkin-input-cost').fill('4');
    await expect(page.getByTestId('napkin-result')).toHaveText('6');
    await page.getByTestId('napkin-calc-name').fill('July');
    await page.getByTestId('napkin-save-calc').click();

    await expect.poll(async () => (await app.dump('napkin_calculations')).length).toBe(1);
    const templates = await app.dump('napkin_templates');
    expect(templates).toHaveLength(1);
    // Unnamed, so it is saved under a placeholder rather than refused.
    expect(templates[0]!.name).toBe('Untitled');
    assertInvariants(await app.dumpAll(), 'after saving a calculation with no template');
  });

  test('with no formula there is nothing to fill in and nothing to save', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/napkin-math/');
    await expect(page.getByTestId('napkin-no-fields')).toBeVisible({ timeout: 30_000 });
    // No inputs, so no Save button either — a live button that refuses is
    // exactly what this card used to get wrong.
    await expect(page.getByTestId('napkin-save-calc')).toHaveCount(0);
    expect(await app.dump('napkin_calculations')).toHaveLength(0);
  });

  test('a saved calculation is one row, recallable, and never inside the template file', async ({
    app,
  }) => {
    const { page } = app;
    await app.goto('/tools/napkin-math/');
    await expect(page.getByTestId('napkin-no-fields')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('napkin-name').fill('Margin');
    await typeFormula(page, 'revenue-cost');
    await page.getByTestId('napkin-save-template').click();
    await expect(page.getByTestId('napkin-feedback')).toContainText('Template saved');

    await page.getByTestId('napkin-input-revenue').fill('10');
    await page.getByTestId('napkin-input-cost').fill('4');
    await expect(page.getByTestId('napkin-result')).toHaveText('6');
    await page.getByTestId('napkin-calc-name').fill('July');
    await page.getByTestId('napkin-save-calc').click();

    const calcs = await app.dump('napkin_calculations');
    expect(calcs).toHaveLength(1);
    expect(calcs[0]!.name).toBe('July');
    expect(calcs[0]!.result).toBe(6);
    // The FK points at the template, which is what the oracle checks.
    expect(calcs[0]!.template_id).toBe((await app.dump('napkin_templates'))[0]!.id);
    assertInvariants(await app.dumpAll(), 'after saving a calculation');

    // Recall puts the numbers back.
    await page.getByTestId('napkin-input-revenue').fill('1');
    await page.getByTestId('napkin-calc').click();
    await expect(page.getByTestId('napkin-input-revenue')).toHaveValue('10');

    // The shareable template JSON carries the formula, never the numbers
    // somebody ran through it.
    const json = await page.getByTestId('napkin-json').innerText();
    expect(json).not.toContain('July');
    expect(json).not.toContain('calculations');
  });

  test('a template round-trips through export and import', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/napkin-math/');
    await expect(page.getByTestId('napkin-no-fields')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('napkin-name').fill('Margin');
    await page.getByTestId('napkin-description').fill('What is left over.');
    await typeFormula(page, 'revenue-cost');
    const exported = await page.getByTestId('napkin-json').innerText();

    await page.getByTestId('napkin-import-text').fill(exported);
    await page.getByTestId('napkin-import').click();
    await expect(page.getByTestId('napkin-feedback')).toContainText('Imported 1 template');
    await expect(page.getByTestId('napkin-name')).toHaveValue('Margin');
    await expect(page.getByTestId('napkin-field')).toHaveCount(2);
    await expect(page.getByTestId('napkin-template')).toHaveCount(1);
  });

  test('a bad import is refused with a reason and changes nothing', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/napkin-math/');
    await expect(page.getByTestId('napkin-no-fields')).toBeVisible({ timeout: 30_000 });
    const before = await app.dumpAll();

    await page.getByTestId('napkin-import-text').fill('not json at all');
    await page.getByTestId('napkin-import').click();
    await expect(page.getByTestId('napkin-import-error')).toContainText('not valid JSON');

    await page.getByTestId('napkin-import-text').fill('{"format":"something-else"}');
    await page.getByTestId('napkin-import').click();
    await expect(page.getByTestId('napkin-import-error')).toContainText('not a napkin-math template');

    expect(await app.dumpAll()).toEqual(before);
  });

  test('the generated web component computes what the app computed', async ({ app }) => {
    const { page, errors } = app;
    await app.goto('/tools/napkin-math/');
    await expect(page.getByTestId('napkin-no-fields')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('napkin-name').fill('Unit margin');
    await typeFormula(page, 'revenue/units');
    await page.getByTestId('napkin-input-revenue').fill('10');
    await page.getByTestId('napkin-input-units').fill('4');
    await expect(page.getByTestId('napkin-result')).toHaveText('2.5');

    await page.getByTestId('napkin-language').selectOption('webcomponent');
    await page.getByTestId('napkin-generate').click();
    const source = await page.getByTestId('napkin-code').innerText();
    expect(source).toContain('customElements.define("unit-margin"');

    // Load it in a REAL page. A generated file that does not run is the one
    // failure a golden-file test cannot catch.
    const answer = await page.evaluate(async (code) => {
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      await import(/* @vite-ignore */ url);
      URL.revokeObjectURL(url);
      const element = document.createElement('unit-margin');
      document.body.append(element);
      const inputs = [...element.shadowRoot!.querySelectorAll('input')];
      const set = (key: string, value: string) => {
        const input = inputs.find((i) => i.dataset['key'] === key)!;
        input.value = value;
        input.dispatchEvent(new Event('input'));
      };
      set('revenue', '10');
      set('units', '4');
      const text = element.shadowRoot!.querySelector('[part="result"]')!.textContent;
      element.remove();
      return text;
    }, source);
    expect(answer).toBe('2.5');
    expect(errors).toEqual([]);
  });

  test('the generated component carries a typeset formula and its fonts', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/napkin-math/');
    await expect(page.getByTestId('napkin-no-fields')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('napkin-name').fill('Total cost');
    await typeFormula(page, 'costPerMonth*12*years');

    await page.getByTestId('napkin-language').selectOption('webcomponent');
    await page.getByTestId('napkin-generate').click();
    await expect(page.getByTestId('napkin-code')).toContainText('customElements.define', {
      timeout: 30_000,
    });
    const source = await page.getByTestId('napkin-code').innerText();

    // Typeset markup, not the text fallback.
    expect(source).toContain('ML__latex');
    expect(source).not.toContain('$\\left(');
    // Only the faces this formula needs, embedded as data — a formula in plain
    // names wants one family, not all twenty.
    const faces = source.match(/@font-face/g) ?? [];
    expect(faces.length).toBeGreaterThan(0);
    expect(faces.length).toBeLessThan(4);
    expect(source).toContain('data:font/woff2;base64,');
    // MathLive's own @font-face block points at `url(fonts/…)`, which would
    // resolve against whatever page this lands on and 404 there.
    expect(source).not.toContain('url(fonts/');
    await expect(page.getByTestId('napkin-generate-note')).toContainText('fonts inlined');

    // Now prove it on a page that has never loaded MathLive: no ambient KaTeX
    // faces, no static stylesheet, nothing to lean on.
    const failed: string[] = [];
    page.on('requestfailed', (r) => failed.push(r.url()));
    await page.goto('/tools/photography/');
    await expect(page.getByTestId('ph-focal')).toBeVisible();

    const rendered = await page.evaluate(async (code) => {
      const hadKatex = [...document.fonts].some((f) => f.family.includes('KaTeX'));
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      await import(/* @vite-ignore */ url);
      URL.revokeObjectURL(url);
      const element = document.createElement('total-cost');
      document.body.append(element);
      await new Promise((r) => setTimeout(r, 900));
      const formula = element.shadowRoot!.querySelector('[part="formula"]') as HTMLElement;
      const families = [
        ...new Set(
          [...formula.querySelectorAll<HTMLElement>('span')].map((s) =>
            getComputedStyle(s).fontFamily.split(',')[0]!.trim()
          )
        ),
      ].filter((f) => f.startsWith('KaTeX_'));
      const out = {
        hadKatex,
        families,
        allLoaded: families.every((f) => document.fonts.check(`16px ${f}`)),
        // A typeset formula is many positioned spans, not one text node.
        spans: formula.querySelectorAll('span').length,
        error: (element.shadowRoot!.querySelector('[part="error"]') as HTMLElement).textContent,
      };
      element.remove();
      return out;
    }, source);

    expect(rendered.hadKatex, 'the host page already had KaTeX fonts').toBe(false);
    expect(rendered.families.length).toBeGreaterThan(0);
    expect(rendered.allLoaded, 'an embedded face did not load').toBe(true);
    expect(rendered.spans).toBeGreaterThan(5);
    // An untouched required input is not a mistake, so it says nothing.
    expect(rendered.error).toBe('');
    expect(failed, 'the component asked the network for something').toEqual([]);
  });

  test('a component built from a sum defines the helper it calls', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/napkin-math/');
    await expect(page.getByTestId('napkin-no-fields')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('napkin-name').fill('Rent per year');
    await mathFieldReady(page);
    await page.getByTestId('napkin-insert-sum').click();
    await expect.poll(() => formulaValue(page)).not.toBe('');

    await page.getByTestId('napkin-language').selectOption('webcomponent');
    await page.getByTestId('napkin-generate').click();
    await expect(page.getByTestId('napkin-code')).toContainText('customElements.define', {
      timeout: 30_000,
    });
    const source = await page.getByTestId('napkin-code').innerText();
    // The bug: the loop helper was emitted for the four languages and silently
    // dropped from the web component, so the file called `_sum` with no `_sum`
    // to call and threw ReferenceError on the first keystroke.
    expect(source).toContain('_sum(');
    expect(source).toContain('function _sum(');

    const ran = await page.evaluate(async (code) => {
      const failures: string[] = [];
      const onError = (e: ErrorEvent) => failures.push(e.message);
      window.addEventListener('error', onError);
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      await import(/* @vite-ignore */ url);
      URL.revokeObjectURL(url);
      const element = document.createElement('rent-per-year');
      document.body.append(element);
      await new Promise((r) => setTimeout(r, 400));
      const input = element.shadowRoot!.querySelector('input')!;
      input.value = '4';
      input.dispatchEvent(new Event('input'));
      await new Promise((r) => setTimeout(r, 300));
      const out = {
        result: element.shadowRoot!.querySelector('[part="result"]')!.textContent,
        error: element.shadowRoot!.querySelector('[part="error"]')!.textContent,
        failures,
      };
      element.remove();
      window.removeEventListener('error', onError);
      return out;
    }, source);

    // Sum of x for x = 1..4 is 10.
    expect(ran.failures).toEqual([]);
    expect(ran.result).toBe('10');
    expect(ran.error).toBe('');
  });

  test('the maths fonts can be left out and supplied once by the page', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/napkin-math/');
    await expect(page.getByTestId('napkin-no-fields')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('napkin-name').fill('Unit margin');
    await typeFormula(page, 'revenue/units');
    await page.getByTestId('napkin-language').selectOption('webcomponent');

    // On by default: one file that works anywhere.
    await expect(page.getByTestId('napkin-embed-fonts')).toBeChecked();
    await page.getByTestId('napkin-generate').click();
    await expect(page.getByTestId('napkin-code')).toContainText('customElements.define', {
      timeout: 30_000,
    });
    const withFonts = await page.getByTestId('napkin-code').innerText();
    expect(withFonts).toContain('data:font/woff2;base64,');
    await expect(page.getByTestId('napkin-download-fonts')).toHaveCount(0);

    // Off: much smaller, still laid out, and the page is told what it owes.
    await page.getByTestId('napkin-embed-fonts').uncheck();
    await page.getByTestId('napkin-generate').click();
    await expect(page.getByTestId('napkin-generate-note')).toContainText('fonts left out');
    const without = await page.getByTestId('napkin-code').innerText();
    expect(without).not.toContain('data:font/woff2');
    // The layout rules still travel — a missing face is a plainer formula.
    expect(without).toContain('ML__latex');
    expect(without.length).toBeLessThan(withFonts.length / 2);
    await expect(page.getByTestId('napkin-download-fonts')).toBeVisible();

    // And the shared stylesheet carries every face, not just this formula's.
    const download = page.waitForEvent('download');
    await page.getByTestId('napkin-download-fonts').click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('napkin-math-fonts.css');
    const css = readFileSync(await file.path(), 'utf8');
    expect((css.match(/@font-face/g) ?? []).length).toBe(20);
    expect(css).toContain('data:font/woff2;base64,');
  });

  test('the generated Python carries the guards the page enforces', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/napkin-math/');
    await expect(page.getByTestId('napkin-no-fields')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('napkin-name').fill('Unit margin');
    await typeFormula(page, 'revenue/units');
    // Make `units` a positive whole number that cannot be zero.
    await page.getByTestId('napkin-field-type-units').check();
    await page.getByTestId('napkin-field-sign-units').selectOption('positive');
    await page.getByTestId('napkin-field-nozero-units').check();

    await page.getByTestId('napkin-generate').click();
    const source = await page.getByTestId('napkin-code').innerText();
    expect(source).toContain('def unit_margin(');
    expect(source).toContain('units: int');
    expect(source).toContain('cannot be negative');
    expect(source).toContain('cannot be zero');
    expect(source).toContain('return revenue / units');

    // And the page refuses the same input rather than answering.
    await page.getByTestId('napkin-input-revenue').fill('10');
    await page.getByTestId('napkin-input-units').fill('0');
    await expect(page.getByTestId('napkin-problem-units')).toContainText('cannot be zero');
    await expect(page.getByTestId('napkin-result')).toHaveText('—');
  });

  test('the insert buttons start a formula that already parses', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/napkin-math/');
    await expect(page.getByTestId('napkin-no-fields')).toBeVisible({ timeout: 30_000 });

    // A skeleton with bounds already in it: the field list appears at once,
    // which is the whole point of not making someone type `\sum_{x=1}^{n}`.
    await mathFieldReady(page);
    await page.getByTestId('napkin-insert-sum').click();
    await expect(page.getByTestId('napkin-field')).toHaveCount(1);
    await expect(page.getByTestId('napkin-field').first()).toHaveAttribute('data-name', 'n');
    await expect(page.getByTestId('napkin-formula-error')).toHaveCount(0);

    for (const id of ['product', 'integral', 'fraction', 'root']) {
      await page.getByTestId('napkin-new').click();
      await mathFieldReady(page);
      await page.getByTestId(`napkin-insert-${id}`).click();
      // The insert landing is the step that used to be lost, so wait for its
      // evidence rather than for a duration.
      await expect.poll(() => formulaValue(page), { message: id }).not.toBe('');
      await expect(page.getByTestId('napkin-formula-error'), id).toHaveCount(0);
    }
  });

  test('sum, product and integral all reach code', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/napkin-math/');
    await expect(page.getByTestId('napkin-no-fields')).toBeVisible({ timeout: 30_000 });

    for (const [id, marker] of [
      ['sum', '_sum('],
      ['product', '_product('],
      ['integral', '_integrate('],
    ] as const) {
      await page.getByTestId('napkin-new').click();
      await mathFieldReady(page);
      await page.getByTestId(`napkin-insert-${id}`).click();
      await expect.poll(() => formulaValue(page), { message: id }).not.toBe('');
      await page.getByTestId('napkin-generate').click();
      // No refusal, and a real loop in the output.
      await expect(page.getByTestId('napkin-generate-error'), id).toHaveCount(0);
      await expect(page.getByTestId('napkin-code'), id).toContainText(marker);
    }
  });

  test('the Code card forgets everything when the formula moves on', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/napkin-math/');
    await expect(page.getByTestId('napkin-no-fields')).toBeVisible({ timeout: 30_000 });

    await mathFieldReady(page);
    await page.getByTestId('napkin-insert-sum').click();
    await expect.poll(() => formulaValue(page)).not.toBe('');
    await page.getByTestId('napkin-generate').click();
    await expect(page.getByTestId('napkin-code')).toContainText('_sum(');

    // Generated code describes ONE formula. Leaving it up after the formula
    // changed is a statement about something that no longer exists.
    await page.getByTestId('napkin-insert-fraction').click();
    await expect(page.getByTestId('napkin-code')).toHaveCount(0);
    await expect(page.getByTestId('napkin-generate-error')).toHaveCount(0);
    await expect(page.getByTestId('napkin-generate-note')).toHaveCount(0);

    // And a new template starts clean.
    await page.getByTestId('napkin-generate').click();
    await expect(page.getByTestId('napkin-code')).toBeVisible();
    await page.getByTestId('napkin-new').click();
    await expect(page.getByTestId('napkin-code')).toHaveCount(0);
    await expect(page.getByTestId('napkin-generate-error')).toHaveCount(0);
  });

  test('an operator the generator cannot write is refused by name', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/napkin-math/');
    await expect(page.getByTestId('napkin-no-fields')).toBeVisible({ timeout: 30_000 });
    // A factorial is a perfectly good formula with no rule in the emitter.
    // (Sums, products and integrals used to be here; they generate code now.)
    await typeFormula(page, 'n!');
    await page.getByTestId('napkin-generate').click();
    const error = page.getByTestId('napkin-generate-error');
    await expect(error).toBeVisible();
    // Named, not a silently wrong function.
    await expect(error).toContainText('Factorial');
    await expect(page.getByTestId('napkin-code')).toHaveCount(0);
  });

  test('a field description reaches the inputs and the generated code', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/napkin-math/');
    await expect(page.getByTestId('napkin-no-fields')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('napkin-name').fill('Unit margin');
    await typeFormula(page, 'revenue/units');
    await page
      .getByTestId('napkin-field-description-revenue')
      .fill('Money taken, before any costs');

    // Beside the input, where someone filling it in will see it.
    await expect(page.getByTestId('napkin-hint-revenue')).toHaveText('Money taken, before any costs');

    for (const language of ['python', 'go', 'rust', 'javascript']) {
      await page.getByTestId('napkin-language').selectOption(language);
      await page.getByTestId('napkin-generate').click();
      await expect(page.getByTestId('napkin-code')).toContainText('Money taken, before any costs');
    }
  });

  test('the code and the JSON are syntax-highlighted', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/napkin-math/');
    await expect(page.getByTestId('napkin-no-fields')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('napkin-name').fill('Unit margin');
    await typeFormula(page, 'revenue/units');

    // Prism emits <span class="token …">; the blueprint inks are global rules.
    await expect(page.locator('[data-testid="napkin-json"] .token').first()).toBeVisible();
    await page.getByTestId('napkin-generate').click();
    await expect(page.locator('[data-testid="napkin-code"] .token.keyword').first()).toBeVisible();

    // The import box highlights what is typed into it, and still round-trips.
    const json = await page.getByTestId('napkin-json').innerText();
    await page.getByTestId('napkin-import-text').fill(json);
    await expect(page.locator('.underlay .token').first()).toBeVisible();
    await page.getByTestId('napkin-import').click();
    await expect(page.getByTestId('napkin-feedback')).toContainText('Imported 1 template');
  });

  test('the formula reaches the generated code as readable maths', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/napkin-math/');
    await expect(page.getByTestId('napkin-no-fields')).toBeVisible({ timeout: 30_000 });
    await typeFormula(page, 'revenue/units');
    await page.getByTestId('napkin-generate').click();
    const code = await page.getByTestId('napkin-code').innerText();
    // Markdown maths, not the renderer's markup.
    expect(code).toContain('$');
    expect(code).not.toContain('\\mathrm{');
  });

  test('no sound is ever fetched, and MathLive stays off every other route', async ({ app }) => {
    const { page } = app;
    const urls: string[] = [];
    page.on('request', (r) => urls.push(r.url()));

    await app.goto('/tools/napkin-math/');
    await expect(page.getByTestId('napkin-no-fields')).toBeVisible({ timeout: 30_000 });
    await typeFormula(page, 'a+b');
    // Provoke the "plonk" path an invalid keystroke takes.
    for (let i = 0; i < 4; i++) await page.keyboard.press('Backspace');
    await page.waitForTimeout(400);
    expect(urls.filter((u) => /\.wav/i.test(u)), 'a keypress sound was fetched').toEqual([]);

    // Fonts come from our own vendored copies, and only the faces needed.
    const fonts = urls.filter((u) => /\.woff2/i.test(u));
    expect(fonts.length, 'no maths font loaded').toBeGreaterThan(0);
    for (const url of fonts) expect(url).toContain('/math/fonts/');
    expect(fonts.length, 'every face loaded eagerly').toBeLessThan(20);

    const after: string[] = [];
    page.on('request', (r) => after.push(r.url()));
    await page.goto('/tools/secrets/');
    await expect(page.getByTestId('sec-value-strong')).not.toBeEmpty();
    await page.waitForTimeout(400);
    expect(after.filter((u) => /mathlive|compute-engine/i.test(u))).toEqual([]);
  });
});

test.describe('napkin math — the image export', () => {
  test.slow();

  /**
   * Set the formula directly rather than typing it.
   *
   * `typeFormula` above is the right tool when the EDITOR is the subject —
   * it caught real bugs in the inline-shortcut handling. Here the editor is
   * only the way in, and typing twelve characters at 50 ms each before every
   * case would spend most of the run in the wrong place. Setting `value` and
   * dispatching `input` is exactly what the component listens for.
   */
  async function setFormula(page: P, latex: string) {
    await mathFieldReady(page);
    await page.locator('[data-testid="napkin-formula"]').evaluate((element, value) => {
      (element as HTMLElement & { value: string }).value = value;
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }, latex);
  }

  /** The SVG the dialog is previewing, read back out of its blob URL. */
  async function previewSvg(page: P): Promise<string> {
    return page
      .locator('[data-testid="napkin-image-preview"]')
      .evaluate(async (element) => {
        const response = await fetch((element as HTMLImageElement).src);
        return response.text();
      });
  }

  /**
   * Every glyph in the picture, in drawing order, as one string.
   *
   * KaTeX kerns by splitting a word across several runs — `revenue` is drawn
   * as `re`, `v`, `enue` in three separate <text> elements — so searching the
   * SVG source for a whole word finds nothing even when the word is plainly
   * there. The captions and the title are single runs and can be matched in
   * the source; the maths cannot.
   */
  async function previewGlyphs(page: P): Promise<string> {
    const svg = await previewSvg(page);
    return (svg.match(/<text[^>]*>[^<]*<\/text>/g) ?? [])
      .map((element) => element.replace(/<[^>]*>/g, ''))
      .join('');
  }

  /** Width and height straight out of a PNG's IHDR chunk. */
  function pngSize(bytes: Buffer): { width: number; height: number } {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }

  async function openWithMargin(page: P) {
    await expect(page.getByTestId('napkin-no-fields')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('napkin-name').fill('Monthly margin');
    await setFormula(page, '\\mathrm{revenue}-\\mathrm{cost}');
    await expect(page.getByTestId('napkin-input-revenue')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('napkin-input-revenue').fill('12500');
    await page.getByTestId('napkin-input-cost').fill('4750');
    await expect(page.getByTestId('napkin-result')).toHaveText('7750');
    await page.getByTestId('napkin-export-image').click();
    await expect(page.getByTestId('napkin-image-preview')).toBeVisible({ timeout: 30_000 });
  }

  test('draws the three rows as a real picture, and writes nothing', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/napkin-math/');
    const before = await app.dumpAll();
    await openWithMargin(page);

    const svg = await previewSvg(page);

    // The picture is vector primitives, NOT embedded HTML. That is not a
    // stylistic preference: Chromium taints a canvas the moment an SVG
    // carrying a <foreignObject> is drawn on it, so the PNG below could not
    // exist if this assertion failed.
    expect(svg).not.toContain('<foreignObject');
    expect(svg.match(/<text /g)!.length).toBeGreaterThan(5);

    // Self-contained: an <img> rendering an SVG may not fetch anything, so a
    // font referenced by URL would silently come out as a fallback serif.
    expect(svg).toContain('@font-face');
    expect(svg).toContain('data:font/woff2;base64,');
    expect(svg).not.toMatch(/url\((?!data:)/);
    expect(svg).not.toContain('var(--');

    // The title, the labels, and the formula's own glyphs.
    expect(svg).toContain('Monthly margin');
    expect(svg).toContain('FORMULA');
    expect(svg).toContain('WITH YOUR VALUES');
    expect(svg).toContain('RESULT');

    // The preview element really rendered it — a broken SVG loads as nothing.
    const natural = await page
      .getByTestId('napkin-image-preview')
      .evaluate((el) => [(el as HTMLImageElement).naturalWidth, (el as HTMLImageElement).naturalHeight]);
    expect(natural[0]).toBeGreaterThan(80);
    expect(natural[1]).toBeGreaterThan(80);

    expect(await app.dumpAll()).toEqual(before);
  });

  test('the middle row carries the values, and the result is the answer', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/napkin-math/');
    await openWithMargin(page);
    const glyphs = await previewGlyphs(page);

    // The formula row keeps its names...
    expect(glyphs).toContain('revenue');
    expect(glyphs).toContain('cost');
    // ...and the row under it has the numbers, NOT the answer. This is the
    // whole feature: `expr.subs()` would have collapsed this to 7750.
    expect(glyphs).toContain('12500');
    expect(glyphs).toContain('4750');
    expect(glyphs).toContain('7750');
  });

  test('a fraction draws its bar, which nothing in the markup calls a border', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/napkin-math/');
    await expect(page.getByTestId('napkin-no-fields')).toBeVisible({ timeout: 30_000 });
    await setFormula(page, '\\frac{\\mathrm{revenue}}{\\mathrm{months}}');
    await expect(page.getByTestId('napkin-input-revenue')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('napkin-input-revenue').fill('1200');
    await page.getByTestId('napkin-input-months').fill('4');
    await expect(page.getByTestId('napkin-result')).toHaveText('300');
    await page.getByTestId('napkin-export-image').click();
    await expect(page.getByTestId('napkin-image-preview')).toBeVisible({ timeout: 30_000 });

    const svg = await previewSvg(page);
    // MathLive paints a fraction bar with `.ML__frac-line::after`, so an
    // element scan that only reads borders and backgrounds finds nothing and
    // the picture comes out as two numbers with no line between them.
    // One rect is the background; a fraction needs at least one more.
    expect(svg.match(/<rect /g)!.length).toBeGreaterThan(1);
  });

  test('rasterises to a PNG at the chosen scale, and downloads both formats', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/napkin-math/');
    const before = await app.dumpAll();
    await openWithMargin(page);

    const natural = await page
      .getByTestId('napkin-image-preview')
      .evaluate((el) => [(el as HTMLImageElement).naturalWidth, (el as HTMLImageElement).naturalHeight]);

    const svgDownload = page.waitForEvent('download');
    await page.getByTestId('napkin-download-image-svg').click();
    const svgFile = await svgDownload;
    expect(svgFile.suggestedFilename()).toBe('Monthly-margin.svg');
    const svgText = readFileSync(await svgFile.path(), 'utf8');
    expect(svgText).toContain('@font-face');
    expect(svgText).toContain('Monthly margin');

    await page.getByTestId('napkin-image-scale').selectOption('3');
    const pngDownload = page.waitForEvent('download');
    await page.getByTestId('napkin-download-image-png').click();
    const pngFile = await pngDownload;
    expect(pngFile.suggestedFilename()).toBe('Monthly-margin.png');
    const png = readFileSync(await pngFile.path());

    // Really a PNG, really three times the size, and really has ink on it.
    expect(png.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const size = pngSize(png);
    expect(size.width).toBe(natural[0]! * 3);
    expect(size.height).toBe(natural[1]! * 3);
    // A blank picture compresses to almost nothing; a typeset one does not.
    expect(png.byteLength).toBeGreaterThan(4000);

    expect(await app.dumpAll()).toEqual(before);
  });

  test('turning a row off takes it out of the picture', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/napkin-math/');
    await openWithMargin(page);

    const withAll = await previewSvg(page);
    await page.getByTestId('napkin-image-row-substituted').uncheck();
    await expect
      .poll(async () => (await previewSvg(page)).includes('WITH YOUR VALUES'), { timeout: 20_000 })
      .toBe(false);

    const fewer = await previewSvg(page);
    expect(fewer.length).toBeLessThan(withAll.length);
    expect(fewer).toContain('FORMULA');
    expect(fewer).toContain('RESULT');
    // The values row is gone; the other two are untouched.
    const glyphs = await previewGlyphs(page);
    expect(glyphs).toContain('revenue');
    expect(glyphs).toContain('7750');
    expect(glyphs).not.toContain('12500');

    // The title comes off too, and the picture gets shorter for it.
    await page.getByTestId('napkin-image-title').uncheck();
    await expect
      .poll(async () => (await previewSvg(page)).includes('Monthly margin'), { timeout: 20_000 })
      .toBe(false);
  });

  test('the dark theme changes the ink, not the layout', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/napkin-math/');
    await openWithMargin(page);

    const light = await previewSvg(page);
    expect(light).toContain('#ffffff');

    await page.getByTestId('napkin-image-theme').selectOption('dark');
    await expect
      .poll(async () => (await previewSvg(page)).includes('#111827'), { timeout: 20_000 })
      .toBe(true);

    const dark = await previewSvg(page);
    expect(dark).toContain('#f3f4f6');
    expect(dark).not.toContain('fill="#111111"');
    // Same rows, same glyphs — only the colours moved.
    expect(dark.match(/<text /g)!.length).toBe(light.match(/<text /g)!.length);
  });

  test('every control in the dialog has an accessible name', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/napkin-math/');
    await openWithMargin(page);
    // The dialog is behind a click, so the registry sweep never audits it.
    const unnamed = await page.evaluate(() => {
      const bad: string[] = [];
      const dialog = document.querySelector('[data-testid="napkin-image-dialog"]');
      if (!dialog) return ['dialog missing'];
      for (const el of Array.from(dialog.querySelectorAll('input, select, textarea, button'))) {
        const node = el as HTMLInputElement;
        const named =
          (node.labels && node.labels.length > 0) ||
          Boolean(node.getAttribute('aria-label')) ||
          Boolean(node.closest('label')) ||
          (node.tagName === 'BUTTON' && (node.textContent ?? '').trim().length > 0);
        if (!named) bad.push(node.tagName.toLowerCase() + '[' + (node.getAttribute('data-testid') ?? '?') + ']');
      }
      return bad;
    });
    expect(unnamed).toEqual([]);
  });
});
