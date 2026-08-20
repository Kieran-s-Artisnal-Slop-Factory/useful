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
import { test, expect } from './helpers/app';
import { assertIsolatedDelta, assertInvariants } from './helpers/oracle';

type P = import('@playwright/test').Page;

/** Type into the mathfield through its own API, which owns its keystrokes. */
async function typeFormula(page: P, text: string) {
  const field = page.locator('[data-testid="napkin-formula"]');
  await expect(field).toBeVisible({ timeout: 30_000 });
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

  test('an operator the generator cannot write is refused by name', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/napkin-math/');
    await expect(page.getByTestId('napkin-no-fields')).toBeVisible({ timeout: 30_000 });
    // A definite integral is a perfectly good formula and has no code form.
    await typeFormula(page, '\\int_0^1 x');
    await page.getByTestId('napkin-generate').click();
    const error = page.getByTestId('napkin-generate-error');
    await expect(error).toBeVisible();
    // Named, not a silently wrong function.
    await expect(error).toContainText(/Integrate|cannot|formula/i);
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
