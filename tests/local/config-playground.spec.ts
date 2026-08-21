/**
 * Phase 9 — configuration playground.
 *
 * Inference, validation, parsing and the emitters are unit-tested. What
 * matters here is the page's contract: pasting a document extracts a schema
 * and writes nothing, saving writes exactly one row, reload restores, the
 * YAML fidelity traps are called out, prettify keeps comments, a hand-built
 * schema survives the mode switch and checks a real document — and the
 * generated web components are LOADED IN A PAGE and behave.
 */
import { test, expect } from './helpers/app';
import { assertIsolatedDelta, assertInvariants } from './helpers/oracle';

type P = import('@playwright/test').Page;

/** Replace the CodeMirror buffer's content. CM6 is contenteditable, not a
 * textarea, so this goes through click + select-all + fill. */
async function setDocument(page: P, text: string) {
  const content = page.locator('.cm-content');
  await expect(content).toBeVisible({ timeout: 30_000 });
  await content.click();
  await page.keyboard.press('ControlOrMeta+a');
  await content.fill(text);
  // The parse, the extraction and the lint all follow the keystroke.
  await page.waitForTimeout(300);
}

const SAMPLE = JSON.stringify({
  name: 'Ada',
  age: 36,
  email: 'ada@example.com',
  tags: ['a', 'b'],
  address: { city: 'Toronto' },
});

test.describe('config playground', () => {
  test.slow();

  test('pasting a document extracts a schema, and nothing is written', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/config-playground/');
    await expect(page.getByTestId('config-no-fields')).toBeVisible({ timeout: 30_000 });

    await setDocument(page, SAMPLE);
    await expect(page.getByTestId('config-valid-badge')).toContainText('Valid JSON');

    // The Field/Type table, formats and nesting included.
    await expect(page.getByTestId('config-type-label-name')).toHaveText('string');
    await expect(page.getByTestId('config-type-label-age')).toHaveText('integer');
    await expect(page.getByTestId('config-type-label-email')).toHaveText('email');
    await expect(page.getByTestId('config-type-label-tags')).toHaveText('Array[string]');
    await expect(page.getByTestId('config-type-label-address')).toHaveText('object');
    await expect(page.getByTestId('config-type-label-address.city')).toHaveText('string');

    // Looking at it writes nothing at all.
    expect(await app.dumpAll()).toEqual(before);
  });

  test('saving a schema writes exactly one row, and a reload restores it', async ({ app }) => {
    const { page } = app;
    const before = await app.dumpAll();
    await app.goto('/tools/config-playground/');
    await expect(page.getByTestId('config-no-fields')).toBeVisible({ timeout: 30_000 });

    await setDocument(page, SAMPLE);
    await page.getByTestId('config-name').fill('Person');
    await page.getByTestId('config-save-schema').click();
    await expect(page.getByTestId('config-feedback')).toContainText('Schema saved');

    const rows = await app.dump('config_schemas');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('Person');
    expect(rows[0]!.format).toBe('json');
    expect((rows[0]!.fields as { key: string }[]).map((f) => f.key)).toEqual([
      'name',
      'age',
      'email',
      'tags',
      'address',
    ]);
    // One schema row plus the "which one was open" preference.
    assertIsolatedDelta(before, await app.dumpAll(), [
      { store: 'config_schemas', id: String(rows[0]!.id) },
      { store: 'preferences', id: 'singleton' },
    ]);

    // Reload restores the schema — and restoring writes nothing.
    const saved = await app.dumpAll();
    await page.reload();
    await expect(page.getByTestId('config-name')).toHaveValue('Person', { timeout: 30_000 });
    await expect(page.getByTestId('config-type-label-age')).toHaveText('integer');
    expect(await app.dumpAll()).toEqual(saved);
    assertInvariants(await app.dumpAll(), 'after saving a schema');
  });

  test('invalid JSON is flagged in place and the last good schema stays', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/config-playground/');
    await expect(page.getByTestId('config-no-fields')).toBeVisible({ timeout: 30_000 });

    await setDocument(page, SAMPLE);
    await expect(page.getByTestId('config-type-label-age')).toHaveText('integer');

    await setDocument(page, SAMPLE + '{{{');
    await expect(page.getByTestId('config-invalid-badge')).toBeVisible();
    await expect(page.getByTestId('config-parse-errors')).toBeVisible();
    // Half-broken input does not blank the table on a keystroke.
    await expect(page.getByTestId('config-type-label-age')).toHaveText('integer');
  });

  test('the YAML 1.1 traps are called out, and quoting cures them', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/config-playground/');
    await expect(page.getByTestId('config-no-fields')).toBeVisible({ timeout: 30_000 });

    await setDocument(page, 'country: NO\nstart: 12:30\nmode: 0755\n');
    // No leading brace, so the sniffer reads it as YAML.
    await expect(page.getByTestId('config-valid-badge')).toContainText('Valid YAML');
    const warnings = page.getByTestId('config-parse-warnings');
    await expect(warnings).toContainText('boolean');
    await expect(warnings).toContainText('750');
    await expect(warnings).toContainText('octal');

    await setDocument(page, 'country: "NO"\nstart: "12:30"\nmode: "0755"\n');
    await expect(page.getByTestId('config-parse-warnings')).toHaveCount(0);
  });

  test('prettify keeps YAML comments', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/config-playground/');
    await expect(page.getByTestId('config-no-fields')).toBeVisible({ timeout: 30_000 });

    await setDocument(page, '# do not lose me\nname:   x\nports: [80,443]\n');
    await page.getByTestId('config-prettify').click();
    const text = await page.locator('.cm-content').innerText();
    // The comment survives the round trip — js-yaml would have eaten it,
    // which is why the other parser was chosen.
    expect(text).toContain('# do not lose me');
    expect(text).toContain('name: x');
  });

  test('a hand-built schema survives the switch and checks a real document', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/config-playground/');
    await expect(page.getByTestId('config-no-fields')).toBeVisible({ timeout: 30_000 });
    const before = await app.dumpAll();

    // Build a two-field schema by hand in Create mode.
    await page.getByTestId('config-switch-mode').click();
    await expect(page.getByTestId('config-mode')).toContainText('Create');
    await page.getByTestId('config-add-field').click();
    await page.getByTestId('config-key-').first().fill('host');
    await page.getByTestId('config-add-field').click();
    const rows = page.getByTestId('config-field-row');
    await expect(rows).toHaveCount(2);
    await rows.nth(1).getByRole('textbox').fill('port');
    await page.getByTestId('config-type-port').selectOption('integer');

    // Switching modes remembers the mode, and nothing else.
    await page.getByTestId('config-switch-mode').click();
    await expect(page.getByTestId('config-mode')).toContainText('Parse');
    assertIsolatedDelta(before, await app.dumpAll(), [{ store: 'preferences', id: 'singleton' }]);

    // The schema in hand survived the switch and now checks the document.
    await expect(page.getByTestId('config-schema-held')).toBeVisible();
    await setDocument(page, '{"host": "example.com", "port": 8080}');
    await expect(page.getByTestId('config-check-ok')).toBeVisible();

    await setDocument(page, '{"host": "example.com", "port": "eighty"}');
    await expect(page.getByTestId('config-check-issues')).toContainText('port');
  });

  test('examples generate to the schema, and download', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/config-playground/');
    await expect(page.getByTestId('config-no-fields')).toBeVisible({ timeout: 30_000 });

    await setDocument(page, SAMPLE);
    await expect(page.getByTestId('config-type-label-age')).toHaveText('integer');
    await page.getByTestId('config-name').fill('Person');
    await page.getByTestId('config-switch-mode').click();

    await page.getByTestId('config-amount').fill('3');
    await page.getByTestId('config-generate-examples').click();
    const text = await page.getByTestId('config-examples').innerText();
    const docs = JSON.parse(text) as Record<string, unknown>[];
    expect(docs).toHaveLength(3);
    for (const doc of docs) {
      expect(typeof doc.name).toBe('string');
      expect(Number.isInteger(doc.age)).toBe(true);
      expect(String(doc.email)).toMatch(/@/);
    }

    const download = page.waitForEvent('download');
    await page.getByTestId('config-download-examples').click();
    expect((await download).suggestedFilename()).toBe('Person-examples.json');
  });

  test('with no fields there is nothing to generate, and the page says so', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/config-playground/');
    await expect(page.getByTestId('config-no-fields')).toBeVisible({ timeout: 30_000 });

    await page.getByTestId('config-generate').click();
    await expect(page.getByTestId('config-generate-error')).toContainText('at least one field');
    await expect(page.getByTestId('config-code')).toHaveCount(0);
  });

  test('every language emits a parser that names the fields', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/config-playground/');
    await expect(page.getByTestId('config-no-fields')).toBeVisible({ timeout: 30_000 });
    await setDocument(page, SAMPLE);
    await page.getByTestId('config-name').fill('Person');

    for (const [language, marker] of [
      ['python', 'def '],
      ['javascript', 'export function'],
      ['go', 'func '],
      ['rust', 'pub fn'],
    ] as const) {
      await page.getByTestId('config-language').selectOption(language);
      await page.getByTestId('config-generate').click();
      await expect(page.getByTestId('config-generate-error'), language).toHaveCount(0);
      const code = page.getByTestId('config-code');
      await expect(code, language).toContainText(marker);
      await expect(code, language).toContainText('email');
    }
  });

  test('the generated parser web component validates in a real page', async ({ app }) => {
    const { page, errors } = app;
    await app.goto('/tools/config-playground/');
    await expect(page.getByTestId('config-no-fields')).toBeVisible({ timeout: 30_000 });
    await setDocument(page, SAMPLE);
    await page.getByTestId('config-name').fill('Person');

    await page.getByTestId('config-language').selectOption('webcomponent');
    await page.getByTestId('config-flavor-parser').click();
    await page.getByTestId('config-generate').click();
    const source = await page.getByTestId('config-code').innerText();
    const tag = source.match(/customElements\.define\(["']([a-z0-9-]+)["']/)?.[1];
    expect(tag).toBeTruthy();

    // Load it in a REAL page. A generated file that does not run is the one
    // failure a golden-string test cannot catch.
    const outcome = await page.evaluate(
      async ({ code, tagName, valid, invalid }) => {
        const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
        await import(/* @vite-ignore */ url);
        URL.revokeObjectURL(url);
        const element = document.createElement(tagName);
        document.body.append(element);
        const textarea = element.shadowRoot!.querySelector('textarea')!;
        const feed = async (text: string) => {
          textarea.value = text;
          textarea.dispatchEvent(new Event('input'));
          await new Promise((r) => setTimeout(r, 100));
          return element.shadowRoot!.textContent ?? '';
        };
        const goodText = await feed(valid);
        const badText = await feed(invalid);
        element.remove();
        return { goodText, badText };
      },
      {
        code: source,
        tagName: tag!,
        valid: SAMPLE,
        invalid: JSON.stringify({ name: 'Ada', age: 'old' }),
      }
    );
    // The valid document is accepted and its fields surfaced; the invalid one
    // names the field that broke.
    expect(outcome.goodText).toContain('ada@example.com');
    expect(outcome.badText).toContain('age');
    expect(errors).toEqual([]);
  });

  test('the generated generator web component produces documents in a real page', async ({
    app,
  }) => {
    const { page, errors } = app;
    await app.goto('/tools/config-playground/');
    await expect(page.getByTestId('config-no-fields')).toBeVisible({ timeout: 30_000 });
    await setDocument(page, SAMPLE);
    await page.getByTestId('config-name').fill('Person');

    await page.getByTestId('config-language').selectOption('webcomponent');
    await page.getByTestId('config-flavor-generator').click();
    await page.getByTestId('config-generate').click();
    const source = await page.getByTestId('config-code').innerText();
    const tag = source.match(/customElements\.define\(["']([a-z0-9-]+)["']/)?.[1];
    expect(tag).toBeTruthy();

    const output = await page.evaluate(
      async ({ code, tagName }) => {
        const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
        await import(/* @vite-ignore */ url);
        URL.revokeObjectURL(url);
        const element = document.createElement(tagName);
        document.body.append(element);
        const button = element.shadowRoot!.querySelector('button')!;
        button.click();
        await new Promise((r) => setTimeout(r, 100));
        const text = element.shadowRoot!.querySelector('pre')?.textContent ?? '';
        element.remove();
        return text;
      },
      { code: source, tagName: tag! }
    );
    // Real documents in the schema's shape, straight from a plain button.
    const docs = JSON.parse(output) as Record<string, unknown>[];
    expect(docs.length).toBeGreaterThan(0);
    expect(typeof docs[0]!.name).toBe('string');
    expect(Number.isInteger(docs[0]!.age)).toBe(true);
    expect(errors).toEqual([]);
  });

  test('deleting a schema is a tombstone, and the library empties', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/config-playground/');
    await expect(page.getByTestId('config-no-fields')).toBeVisible({ timeout: 30_000 });

    await setDocument(page, SAMPLE);
    await page.getByTestId('config-name').fill('Person');
    await page.getByTestId('config-save-schema').click();
    await expect(page.getByTestId('config-schema-row')).toHaveCount(1);

    page.on('dialog', (dialog) => dialog.accept());
    await page.getByTestId('config-delete-schema').click();
    await expect(page.getByTestId('config-no-schemas')).toBeVisible();
    // Soft-deleted, not erased: the tombstone stays for sync and merges.
    const raw = await app.dump('config_schemas');
    expect(raw).toHaveLength(1);
    expect(raw[0]!.deleted_at).not.toBeNull();
    assertInvariants(await app.dumpAll(), 'after deleting a schema');
  });
});
