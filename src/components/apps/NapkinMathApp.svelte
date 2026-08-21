<script lang="ts">
  /**
   * Napkin math — self-documenting back-of-the-envelope calculations.
   *
   * Type a formula; its free variables become typed input fields; run named
   * calculations against it; keep a library of templates; generate code from
   * any of it.
   *
   * Two things shape the whole component:
   *
   * **Variables come from the engine, not from a tree walk.** `expr.unknowns`
   * already excludes bound indices and constants, so `\sum_{i=1}^{n} i` asks
   * for `n` and not `i`, and `\pi r^2` asks for `r` and not π. Walking the
   * tree gets both wrong and asks the user to supply a value for pi.
   *
   * **A result is only shown when it is a real, finite number.** The engine
   * reports `sqrt(-4)` with a real part of 0, so reading that alone would
   * display a very convincing zero for the square root of a negative.
   */
  import { onDestroy, onMount } from 'svelte';
  import Card from '../Card.svelte';
  import Explainer from '../Explainer.svelte';
  import MathField from '../MathField.svelte';
  import CodeBlock from '../CodeBlock.svelte';
  import CodeInput from '../CodeInput.svelte';
  import { copyText, downloadText } from '../../lib/exportFile';
  import {
    all,
    byIndex,
    getSingleton,
    patch,
    put,
    putSingleton,
    softDelete,
    softDeleteMany,
    withSyncFields,
  } from '../../lib/db/repo';
  import type { NapkinCalculation, NapkinField, NapkinTemplate, Preferences } from '../../lib/db/types';
  import { boxJson, evaluateFormula, parseFormula } from '../../lib/napkin/engine';
  import {
    checkValues,
    describeConstraint,
    normalizeField,
    orphanedFields,
    reconcileFields,
  } from '../../lib/napkin/model';
  import {
    calculationsToJson,
    ImportError,
    parseCalculations,
    parseTemplates,
    templatesToJson,
    templateToJson,
  } from '../../lib/napkin/transfer';
  import { EXTENSIONS, generateFunction, LANGUAGE_LABELS, UnsupportedOperator, type Language } from '../../lib/codegen/functions';
  import { generateWebComponent } from '../../lib/codegen/webcomponent';
  import { renderFormula } from '../../lib/codegen/formulaMarkup';

  type Target = Language | 'webcomponent';

  /**
   * Skeletons for the operations nobody can type from memory.
   *
   * Each one already parses and already has bounds, so the field list appears
   * immediately and the reader edits a working formula rather than fighting a
   * half-finished one. The index is `x` rather than `i`, because a bare `i` is
   * the imaginary unit to the engine.
   */
  const INSERTS: { id: string; label: string; title: string; latex: string }[] = [
    {
      id: 'sum',
      label: '\u2211 Sum',
      title: 'Sum over a range',
      latex: String.raw`\sum_{x=1}^{n}\left(x\right)`,
    },
    {
      id: 'product',
      label: '\u220F Product',
      title: 'Product over a range',
      latex: String.raw`\prod_{x=1}^{n}\left(x\right)`,
    },
    {
      id: 'integral',
      label: '\u222B Integral',
      title: 'Definite integral',
      latex: String.raw`\int_{0}^{1}\left(x^2\right)dx`,
    },
    {
      id: 'fraction',
      label: '\u00F7 Fraction',
      title: 'Fraction',
      latex: String.raw`\frac{a}{b}`,
    },
    {
      id: 'root',
      label: '\u221A Root',
      title: 'Square root',
      latex: String.raw`\sqrt{x}`,
    },
  ];

  const TARGETS: { id: Target; label: string }[] = [
    { id: 'python', label: LANGUAGE_LABELS.python },
    { id: 'javascript', label: LANGUAGE_LABELS.javascript },
    { id: 'go', label: LANGUAGE_LABELS.go },
    { id: 'rust', label: LANGUAGE_LABELS.rust },
    { id: 'webcomponent', label: 'Web component' },
  ];

  // ---- the open template ---------------------------------------------------
  let templates = $state<NapkinTemplate[]>([]);
  let currentId = $state<string | null>(null);
  let name = $state('');
  let description = $state('');
  let formulaLatex = $state('');
  let formulaJson = $state<unknown>(null);
  let fields = $state<NapkinField[]>([]);
  let formulaError = $state<string | null>(null);
  let dropped = $state<string[]>([]);

  // ---- calculations --------------------------------------------------------
  let calculations = $state<NapkinCalculation[]>([]);
  let inputs = $state<Record<string, number | string | null>>({});
  let calcName = $state('');
  let editingCalcId = $state<string | null>(null);
  let result = $state<number | null>(null);
  let resultNote = $state<string | null>(null);
  /** Why the last Save could not happen, shown beside the button. */
  let calcError = $state<string | null>(null);

  // ---- chrome --------------------------------------------------------------
  let sidebarOpen = $state(true);
  let search = $state('');
  let feedback = $state<string | null>(null);
  let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
  let importText = $state('');
  let importError = $state<string | null>(null);
  let target = $state<Target>('python');
  let generated = $state('');
  let generateError = $state<string | null>(null);
  /** What the last generate did that is worth saying out loud. */
  let generatedNote = $state<string | null>(null);
  let fileInput: HTMLInputElement | undefined = $state();
  let formulaField: ReturnType<typeof MathField> | undefined = $state();
  let destroyed = false;
  /** Bumped per formula parse; a stale parse must not overwrite a newer one. */
  let parseToken = 0;
  /** Bumped per evaluation, same reason. */
  let evalToken = 0;

  const filtered = $derived(
    search.trim()
      ? templates.filter((t: NapkinTemplate) =>
          `${t.name} ${t.description}`.toLowerCase().includes(search.trim().toLowerCase())
        )
      : templates
  );
  const problems = $derived(checkValues(fields, readInputs()));
  /**
   * The problems worth showing right now.
   *
   * An empty required field is not a mistake, it is a field nobody has reached
   * yet — complaining about it the moment the formula appears is noise, and it
   * crowds out the field's own description. The result readout already says
   * "fill in every input", which is the honest version of the same news.
   */
  const shownProblems = $derived.by(() => {
    const raw = inputs;
    const out: Record<string, string> = {};
    for (const [key, problem] of Object.entries(problems)) {
      const value = raw[key];
      const touched = value !== undefined && value !== null && String(value).trim() !== '';
      if (touched) out[key] = problem;
    }
    return out;
  });
  /**
   * A formula is all a template needs.
   *
   * Requiring a name too is what made "Save calculation" silently refuse: the
   * button was live, the template had never been written, and the only clue
   * was a transient line at the far end of a long page.
   */
  const canSaveTemplate = $derived(formulaLatex.trim().length > 0 && !!formulaJson);
  const liveJson = $derived(
    templateToJson({ name, description, formulaLatex, formulaJson, fields })
  );
  const fileStem = $derived((name.trim() || 'template').replace(/[^a-z0-9._-]+/gi, '-'));

  function flash(text: string) {
    feedback = text;
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => (feedback = null), 2500);
  }

  /**
   * Every field's typed value as a number, or null where it is unusable.
   *
   * The bound value is a NUMBER, not a string: `bind:value` on
   * `<input type="number">` coerces, and hands back `null` for an empty or
   * unparseable box. Treating it as a string here is how this went wrong the
   * first time.
   */
  function readInputs(): Record<string, number | null> {
    const out: Record<string, number | null> = {};
    for (const field of fields) {
      const raw = inputs[field.name];
      const parsed = typeof raw === 'number' ? raw : raw === undefined || raw === null || String(raw).trim() === '' ? NaN : Number(raw);
      out[field.name] = Number.isFinite(parsed) ? parsed : null;
    }
    return out;
  }

  // ---- the formula ---------------------------------------------------------

  /**
   * Everything the Code card is showing, forgotten.
   *
   * Called whenever the formula changes or a different template is opened. A
   * generated file, and especially a refusal like "this formula uses Sum",
   * describes ONE formula — leaving either on screen after the formula moved
   * on is a statement about something that no longer exists.
   */
  function resetGenerator() {
    generated = '';
    generateError = null;
    generatedNote = null;
  }

  /** Reparse the formula and rebuild the field list around it. */
  async function onFormulaChange(latex: string) {
    formulaLatex = latex;
    // Before the await, so a slow parse cannot leave a stale error up.
    resetGenerator();
    const mine = ++parseToken;
    const parsed = await parseFormula(latex);
    if (destroyed || mine !== parseToken) return;
    formulaError = parsed.error;
    formulaJson = parsed.json;
    dropped = orphanedFields(parsed.variables, fields).map((f) => f.label);
    fields = reconcileFields(parsed.variables, fields);
    // A field that no longer exists should not keep a stale typed value.
    const known = new Set(fields.map((f) => f.name));
    inputs = Object.fromEntries(Object.entries(inputs).filter(([key]) => known.has(key)));
    await recompute();
  }

  /** Evaluate at the current inputs, or say why there is no answer. */
  async function recompute() {
    const mine = ++evalToken;
    if (!formulaJson || fields.length === 0) {
      result = null;
      resultNote = formulaJson ? null : 'Write a formula to get started.';
      return;
    }
    const values = readInputs();
    if (Object.keys(checkValues(fields, values)).length > 0) {
      result = null;
      resultNote = null;
      return;
    }
    try {
      const expr = await boxJson(formulaJson);
      const evaluated = await evaluateFormula(expr, values);
      if (destroyed || mine !== evalToken) return;
      result = evaluated.value;
      resultNote = evaluated.error;
    } catch (err) {
      if (destroyed || mine !== evalToken) return;
      result = null;
      resultNote = err instanceof Error ? err.message : 'That did not evaluate.';
    }
  }

  // ---- persistence ---------------------------------------------------------

  async function refresh() {
    templates = (await all<NapkinTemplate>('napkin_templates')).sort(
      (a: NapkinTemplate, b: NapkinTemplate) => a.name.localeCompare(b.name)
    );
  }

  async function openTemplate(row: NapkinTemplate) {
    currentId = row.id;
    name = row.name;
    description = row.description;
    formulaLatex = row.formula_latex;
    formulaJson = row.formula_json;
    // A template saved before a property existed comes back without it.
    fields = row.fields.map(normalizeField);
    inputs = {};
    calcName = '';
    editingCalcId = null;
    resetGenerator();
    formulaError = null;
    dropped = [];
    calculations = await byIndex<NapkinCalculation>('napkin_calculations', 'template_id', row.id);
    await putSingleton<Partial<Preferences>>('preferences', { napkin_last_template_id: row.id });
    await recompute();
  }

  function newTemplate() {
    currentId = null;
    name = '';
    description = '';
    formulaLatex = '';
    formulaJson = null;
    fields = [];
    inputs = {};
    calculations = [];
    calcName = '';
    editingCalcId = null;
    calcError = null;
    resetGenerator();
    formulaError = null;
    dropped = [];
    result = null;
    resultNote = 'Write a formula to get started.';
  }

  async function saveTemplate() {
    if (!canSaveTemplate) return;
    const body = {
      // A template saved from the calculation card may never have been named.
      name: name.trim() || 'Untitled',
      description,
      formula_latex: formulaLatex,
      formula_json: formulaJson,
      fields: fields.map((f) => ({ ...f })),
    };
    if (currentId) {
      await patch<NapkinTemplate>('napkin_templates', currentId, body);
    } else {
      const row = await put<NapkinTemplate>('napkin_templates', withSyncFields(body));
      currentId = row.id;
      await putSingleton<Partial<Preferences>>('preferences', { napkin_last_template_id: row.id });
    }
    await refresh();
    flash('Template saved.');
  }

  async function deleteTemplate(row: NapkinTemplate) {
    if (!confirm(`Delete “${row.name}” and every calculation saved against it?`)) return;
    const owned = (
      await byIndex<NapkinCalculation>('napkin_calculations', 'template_id', row.id)
    ).map((c: NapkinCalculation) => c.id);
    // Children first: a calculation whose template is gone is unreachable.
    if (owned.length > 0) await softDeleteMany('napkin_calculations', owned);
    await softDelete('napkin_templates', row.id);
    await refresh();
    if (currentId === row.id) newTemplate();
    flash('Template deleted.');
  }

  async function saveCalculation() {
    // Saving a calculation means you want to keep this formula, so save the
    // template first rather than refusing and making the reader guess.
    if (!currentId) {
      if (!canSaveTemplate) {
        calcError = 'Write a formula first.';
        return;
      }
      await saveTemplate();
      if (!currentId) return;
    }
    calcError = null;
    const values: Record<string, number> = {};
    for (const [key, value] of Object.entries(readInputs())) {
      if (value !== null) values[key] = value;
    }
    const body = { template_id: currentId, name: calcName.trim() || 'Untitled', values, result };
    if (editingCalcId) {
      await patch<NapkinCalculation>('napkin_calculations', editingCalcId, body);
    } else {
      await put<NapkinCalculation>('napkin_calculations', withSyncFields(body));
    }
    calculations = await byIndex<NapkinCalculation>(
      'napkin_calculations',
      'template_id',
      currentId
    );
    editingCalcId = null;
    calcName = '';
    flash('Calculation saved.');
  }

  async function recallCalculation(row: NapkinCalculation) {
    editingCalcId = row.id;
    calcName = row.name;
    inputs = { ...row.values };
    await recompute();
  }

  async function deleteCalculation(row: NapkinCalculation) {
    await softDelete('napkin_calculations', row.id);
    calculations = calculations.filter((c: NapkinCalculation) => c.id !== row.id);
    if (editingCalcId === row.id) {
      editingCalcId = null;
      calcName = '';
    }
  }

  // ---- transfer ------------------------------------------------------------

  async function copyJson() {
    flash((await copyText(liveJson)) ? 'Copied the template JSON.' : 'Clipboard blocked — download instead.');
  }

  function downloadTemplate() {
    downloadText(liveJson, `${fileStem}.json`, 'application/json');
  }

  function downloadAllTemplates() {
    const docs = templates.map((t: NapkinTemplate) => ({
      name: t.name,
      description: t.description,
      formulaLatex: t.formula_latex,
      formulaJson: t.formula_json,
      fields: t.fields,
    }));
    downloadText(templatesToJson(docs), 'napkin-templates.json', 'application/json');
  }

  function downloadCalculations() {
    downloadText(
      calculationsToJson(
        name,
        calculations.map((c: NapkinCalculation) => ({
          name: c.name,
          values: c.values,
          result: c.result,
        }))
      ),
      `${fileStem}-calculations.json`,
      'application/json'
    );
  }

  /** Import whichever of the two documents the text turns out to be. */
  async function runImport(text: string) {
    importError = null;
    const trimmed = text.trim();
    if (!trimmed) {
      importError = 'Paste some JSON first.';
      return;
    }
    try {
      // Calculations first: they are the narrower shape, and trying a template
      // parse on them gives a less useful message.
      if (trimmed.includes('useful-napkin-calculations')) {
        if (!currentId) {
          importError = 'Open a template before importing calculations for it.';
          return;
        }
        const docs = parseCalculations(trimmed, fields);
        for (const doc of docs) {
          await put<NapkinCalculation>(
            'napkin_calculations',
            withSyncFields({
              template_id: currentId,
              name: doc.name,
              values: doc.values,
              result: doc.result,
            })
          );
        }
        calculations = await byIndex<NapkinCalculation>(
          'napkin_calculations',
          'template_id',
          currentId
        );
        flash(`Imported ${docs.length} calculation${docs.length === 1 ? '' : 's'}.`);
        importText = '';
        return;
      }

      const docs = parseTemplates(trimmed);
      let last: NapkinTemplate | null = null;
      for (const doc of docs) {
        // The formula is reparsed rather than trusted, so a file whose
        // MathJSON disagrees with its LaTeX cannot mislead the generator.
        const parsed = await parseFormula(doc.formulaLatex);
        last = await put<NapkinTemplate>(
          'napkin_templates',
          withSyncFields({
            name: doc.name,
            description: doc.description,
            formula_latex: doc.formulaLatex,
            formula_json: parsed.json,
            fields: reconcileFields(parsed.variables, doc.fields),
          })
        );
      }
      await refresh();
      if (last) await openTemplate(last);
      flash(`Imported ${docs.length} template${docs.length === 1 ? '' : 's'}.`);
      importText = '';
    } catch (err) {
      importError =
        err instanceof ImportError ? err.message : err instanceof Error ? err.message : 'That did not import.';
    }
  }

  async function onImportFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    await runImport(await file.text());
  }

  // ---- code generation -----------------------------------------------------

  async function generate() {
    resetGenerator();
    if (!formulaJson) {
      generateError = 'Write a formula first.';
      return;
    }
    const template = {
      name: name.trim() || 'calculation',
      description,
      formulaLatex,
      formulaJson,
      fields,
    };
    try {
      if (target === 'webcomponent') {
        // The typeset formula, with the layout rules and the few KaTeX faces
        // it needs inlined, so the component looks like this page does.
        const rendered = await renderFormula(formulaLatex);
        generated = generateWebComponent(template, rendered ?? undefined);
        generatedNote = rendered
          ? `Includes the typeset formula — ${Math.round(rendered.fontBytes / 1024)} KB of fonts inlined.`
          : 'The formula is shown as text: it could not be typeset.';
      } else {
        generated = generateFunction(template, target);
      }
    } catch (err) {
      // A named refusal, not a silently wrong function.
      generateError =
        err instanceof UnsupportedOperator
          ? err.message
          : err instanceof Error
            ? err.message
            : 'That formula could not be turned into code.';
    }
  }

  /** The Prism grammar for whatever the Code card is currently showing. */
  const generatedLanguage = $derived(target === 'webcomponent' ? 'javascript' : target);

  const generatedFilename = $derived(
    target === 'webcomponent' ? `${fileStem}.js` : `${fileStem}.${EXTENSIONS[target as Language]}`
  );

  async function copyGenerated() {
    flash((await copyText(generated)) ? 'Copied the code.' : 'Clipboard blocked — download instead.');
  }

  function downloadGenerated() {
    downloadText(generated, generatedFilename, 'text/plain');
  }

  // ---- lifecycle -----------------------------------------------------------

  onMount(async () => {
    // Reading the remembered template writes nothing — page loads must not.
    await refresh();
    const prefs = await getSingleton<Preferences>('preferences');
    const remembered = templates.find(
      (t: NapkinTemplate) => t.id === prefs?.napkin_last_template_id
    );
    if (remembered) await openTemplate(remembered);
    else newTemplate();
  });

  onDestroy(() => {
    destroyed = true;
    clearTimeout(feedbackTimer);
  });
</script>

<div class="page-header">
  <h1>Napkin math</h1>
</div>

<div class="layout" class:closed={!sidebarOpen}>
  <aside class="sidebar">
    <div class="row">
      <button
        class="btn btn-sm"
        data-testid="napkin-toggle-library"
        aria-expanded={sidebarOpen}
        onclick={() => (sidebarOpen = !sidebarOpen)}
      >
        {sidebarOpen ? '‹ Library' : '›'}
      </button>
      {#if sidebarOpen}
        <button class="btn btn-sm btn-primary" data-testid="napkin-new" onclick={newTemplate}>
          New
        </button>
      {/if}
    </div>
    {#if sidebarOpen}
      <input
        class="search"
        data-testid="napkin-search"
        type="search"
        placeholder="Search templates…"
        aria-label="Search templates"
        bind:value={search}
      />
      {#if filtered.length === 0}
        <p class="muted small" data-testid="napkin-no-templates">
          {templates.length === 0 ? 'No templates saved yet.' : 'Nothing matches that.'}
        </p>
      {:else}
        <ul class="library" data-testid="napkin-library">
          {#each filtered as row (row.id)}
            <li>
              <button
                class="library-item"
                class:on={row.id === currentId}
                data-testid="napkin-template"
                data-name={row.name}
                aria-pressed={row.id === currentId}
                onclick={() => openTemplate(row)}
              >
                <span class="library-name">{row.name}</span>
                {#if row.description}
                  <span class="muted small">{row.description}</span>
                {/if}
              </button>
              <button
                class="icon-btn"
                data-testid="napkin-delete-template"
                aria-label={`Delete ${row.name}`}
                onclick={() => deleteTemplate(row)}>×</button
              >
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </aside>

  <div class="stack main">
    <Card title="Template">
      {#snippet actions()}
        <button
          class="btn btn-sm btn-primary"
          data-testid="napkin-save-template"
          disabled={!canSaveTemplate}
          onclick={saveTemplate}>Save template</button
        >
      {/snippet}
      <div class="stack">
        <div class="row wrap">
          <label class="inline" for="napkin-name">Name</label>
          <input id="napkin-name" data-testid="napkin-name" bind:value={name} placeholder="Unit economics" />
        </div>
        <div class="field">
          <label class="inline" for="napkin-formula">Formula</label>
          <MathField
            bind:this={formulaField}
            bind:value={formulaLatex}
            testid="napkin-formula"
            ariaLabel="Formula"
            onchange={onFormulaChange}
          />
          <div class="row wrap inserts" role="group" aria-label="Insert an operation">
            {#each INSERTS as item (item.id)}
              <button
                class="btn btn-sm"
                data-testid={'napkin-insert-' + item.id}
                title={item.title}
                onclick={() => formulaField?.insert(item.latex)}
              >
                {item.label}
              </button>
            {/each}
          </div>
          {#if formulaError}
            <p class="form-error" data-testid="napkin-formula-error">{formulaError}</p>
          {/if}
          <p class="muted small">
            Type a name like <code>count</code> and it becomes one variable, not five letters
            multiplied together.
          </p>
        </div>
        <div class="field">
          <label class="inline" for="napkin-description">Description</label>
          <textarea
            id="napkin-description"
            data-testid="napkin-description"
            rows="2"
            bind:value={description}
            placeholder="What this works out, and when to reach for it."
          ></textarea>
        </div>
      </div>
    </Card>

    <Card title="Fields">
      {#if fields.length === 0}
        <p class="muted small" data-testid="napkin-no-fields">
          The formula's variables appear here as soon as it has any.
        </p>
      {:else}
        {#if dropped.length > 0}
          <p class="muted small" data-testid="napkin-dropped">
            Dropped {dropped.join(', ')} — the formula no longer uses {dropped.length === 1 ? 'it' : 'them'}.
          </p>
        {/if}
        <ul class="fields" data-testid="napkin-fields">
          {#each fields as field, i (field.name)}
            <li class="row wrap" data-testid="napkin-field" data-name={field.name}>
              <code class="field-name">{field.name}</code>
              <input
                class="label-input"
                data-testid={'napkin-field-label-' + field.name}
                bind:value={fields[i]!.label}
                placeholder="Label"
                aria-label={`Label for ${field.name}`}
              />
              <input
                class="description-input"
                data-testid={'napkin-field-description-' + field.name}
                bind:value={fields[i]!.description}
                placeholder="What it means"
                aria-label={`Description of ${field.name}`}
              />
              <label class="check">
                <input
                  type="checkbox"
                  data-testid={'napkin-field-type-' + field.name}
                  checked={field.type === 'integer'}
                  onchange={(e) =>
                    (fields[i]!.type = e.currentTarget.checked ? 'integer' : 'number')}
                />
                <span>No decimals</span>
              </label>
              <select
                data-testid={'napkin-field-sign-' + field.name}
                bind:value={fields[i]!.sign}
                aria-label={`Allowed signs for ${field.name}`}
              >
                <option value="any">Positive or negative</option>
                <option value="positive">Positive only</option>
              </select>
              <label class="check">
                <input
                  type="checkbox"
                  data-testid={'napkin-field-nozero-' + field.name}
                  bind:checked={fields[i]!.noZero}
                />
                <span>No zero</span>
              </label>
              <label class="check">
                <input
                  type="checkbox"
                  data-testid={'napkin-field-required-' + field.name}
                  bind:checked={fields[i]!.required}
                />
                <span>Required</span>
              </label>
              <span class="muted small">{describeConstraint(field)}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </Card>

    <Card title="Calculations">
      <div class="calc-row">
        <div class="stack tight calc-inputs">
          {#if fields.length === 0}
            <p class="muted small">Nothing to fill in yet.</p>
          {:else}
            {#each fields as field (field.name)}
              <div class="row wrap">
                <label class="inline calc-label" for={'napkin-input-' + field.name}>
                  {field.label}
                </label>
                <input
                  id={'napkin-input-' + field.name}
                  data-testid={'napkin-input-' + field.name}
                  type="number"
                  step={field.type === 'integer' ? '1' : 'any'}
                  bind:value={inputs[field.name]}
                  oninput={recompute}
                />
                {#if shownProblems[field.name]}
                  <span class="form-error small" data-testid={'napkin-problem-' + field.name}>
                    {shownProblems[field.name]}
                  </span>
                {:else if field.description}
                  <span class="muted small" data-testid={'napkin-hint-' + field.name}>
                    {field.description}
                  </span>
                {/if}
              </div>
            {/each}

            <div class="row wrap result-row">
              <span class="label-text">Result</span>
              <strong class="result" data-testid="napkin-result">
                {result === null ? '—' : result}
              </strong>
              {#if resultNote}
                <span class="muted small" data-testid="napkin-result-note">{resultNote}</span>
              {/if}
            </div>

            <div class="row wrap">
              <input
                data-testid="napkin-calc-name"
                bind:value={calcName}
                placeholder="Name this calculation"
                aria-label="Calculation name"
              />
              <button class="btn btn-sm" data-testid="napkin-save-calc" onclick={saveCalculation}>
                {editingCalcId ? 'Update' : 'Save'}
              </button>
              {#if calcError}
                <span class="form-error small" data-testid="napkin-calc-error">{calcError}</span>
              {/if}
              {#if editingCalcId}
                <button
                  class="btn btn-sm"
                  data-testid="napkin-cancel-calc"
                  onclick={() => {
                    editingCalcId = null;
                    calcName = '';
                  }}>New</button
                >
              {/if}
            </div>
          {/if}
        </div>

        <div class="stack tight history">
          <span class="label-text">Saved</span>
          {#if calculations.length === 0}
            <p class="muted small" data-testid="napkin-no-calcs">Nothing saved against this template.</p>
          {:else}
            <ul class="calc-list" data-testid="napkin-calcs">
              {#each calculations as row (row.id)}
                <li>
                  <button
                    class="calc-item"
                    class:on={row.id === editingCalcId}
                    data-testid="napkin-calc"
                    data-name={row.name}
                    onclick={() => recallCalculation(row)}
                  >
                    <span>{row.name}</span>
                    <span class="muted small">{row.result ?? '—'}</span>
                  </button>
                  <button
                    class="icon-btn"
                    data-testid="napkin-delete-calc"
                    aria-label={`Delete ${row.name}`}
                    onclick={() => deleteCalculation(row)}>×</button
                  >
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      </div>
    </Card>

    <Card title="Code">
      <div class="stack">
        <div class="row wrap">
          <label class="inline" for="napkin-language">Language</label>
          <select id="napkin-language" data-testid="napkin-language" bind:value={target}>
            {#each TARGETS as option (option.id)}
              <option value={option.id}>{option.label}</option>
            {/each}
          </select>
          <button class="btn btn-sm btn-primary" data-testid="napkin-generate" onclick={generate}>
            Generate
          </button>
          {#if generated}
            <button class="btn btn-sm" data-testid="napkin-copy-code" onclick={copyGenerated}>
              Copy text
            </button>
            <button class="btn btn-sm" data-testid="napkin-download-code" onclick={downloadGenerated}>
              Download
            </button>
          {/if}
        </div>
        {#if generateError}
          <p class="form-error" data-testid="napkin-generate-error">{generateError}</p>
        {/if}
        {#if generatedNote}
          <p class="muted small" data-testid="napkin-generate-note">{generatedNote}</p>
        {/if}
        {#if generated}
          <CodeBlock code={generated} language={generatedLanguage} testid="napkin-code" />
        {/if}
      </div>
    </Card>

    <Card title="Export &amp; import">
      <div class="stack">
        <div class="row wrap">
          <button class="btn btn-sm" data-testid="napkin-copy-json" onclick={copyJson}>Copy JSON</button>
          <button class="btn btn-sm" data-testid="napkin-download-template" onclick={downloadTemplate}>
            Download this template
          </button>
          <button
            class="btn btn-sm"
            data-testid="napkin-download-all"
            disabled={templates.length === 0}
            onclick={downloadAllTemplates}>Download all templates</button
          >
          <button
            class="btn btn-sm"
            data-testid="napkin-download-calcs"
            disabled={calculations.length === 0}
            onclick={downloadCalculations}>Download all calculations</button
          >
        </div>
        <!-- The live JSON carries the TEMPLATE only. Sharing a formula should
             not hand over the numbers somebody ran through it. -->
        <CodeBlock code={liveJson} language="json" testid="napkin-json" maxHeight="12rem" />

        <div class="row wrap">
          <button class="btn btn-sm" data-testid="napkin-import" onclick={() => runImport(importText)}>
            Import JSON
          </button>
          <button class="btn btn-sm" data-testid="napkin-import-file" onclick={() => fileInput?.click()}>
            Choose a file…
          </button>
          <input
            class="visually-hidden"
            bind:this={fileInput}
            type="file"
            accept="application/json,.json"
            aria-label="Import a JSON file"
            onchange={onImportFile}
          />
        </div>
        <CodeInput
          bind:value={importText}
          language="json"
          rows={4}
          testid="napkin-import-text"
          ariaLabel="JSON to import"
          placeholder="Paste a template or a calculations file here."
        />
        {#if importError}
          <p class="form-error" data-testid="napkin-import-error">{importError}</p>
        {/if}
      </div>
    </Card>

    {#if feedback}
      <p class="muted small" data-testid="napkin-feedback" aria-live="polite">{feedback}</p>
    {/if}

    <Explainer summary="How the fields appear">
      <p>
        The fields come from the formula's <strong>free variables</strong> — the names it needs a
        value for. Constants are not among them: <code>π r²</code> asks for <code>r</code> alone,
        and a sum's index is bound by the sum, so <code>Σ</code> from 1 to <code>n</code> asks for
        <code>n</code> and not <code>i</code>.
      </p>
      <p>
        Editing a formula keeps the settings of every variable that survived, so adding one term
        does not reset the others. A variable the formula stopped using has its field removed —
        it would be asked for and then ignored.
      </p>
    </Explainer>

    <Explainer summary="What the generated code does and does not do">
      <p>
        Each field's rules come across as <strong>guard clauses</strong>, so a generated function
        refuses what this page refuses rather than quietly computing from a value you would have
        been warned about.
      </p>
      <p>
        Where a language disagrees with the maths, the generated file carries a small helper rather
        than the language's own function. Rounding is the clearest case: this page rounds a half
        away from zero, Python's <code>round</code> rounds to even, and JavaScript's
        <code>Math.round</code> rounds upwards — so <code>-2.5</code> would come back as three
        different numbers. The same goes for the remainder of a negative number.
      </p>
      <p>
        An operator the generator has no rule for is <strong>refused by name</strong>. It will not
        guess.
      </p>
    </Explainer>
  </div>
</div>

<style>
  .layout {
    display: grid;
    grid-template-columns: 16rem 1fr;
    gap: var(--space-4);
    align-items: start;
  }

  .layout.closed {
    grid-template-columns: auto 1fr;
  }

  @media (max-width: 52rem) {
    .layout,
    .layout.closed {
      grid-template-columns: 1fr;
    }
  }

  .sidebar {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    position: sticky;
    top: var(--space-3);
  }

  .main {
    min-width: 0;
  }

  .search {
    width: 100%;
  }

  .library,
  .calc-list,
  .fields {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .library li,
  .calc-list li {
    display: flex;
    align-items: stretch;
    gap: var(--space-1);
  }

  .library-item,
  .calc-item {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--border-color);
    background: var(--surface-color);
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .calc-item {
    flex-direction: row;
    justify-content: space-between;
    align-items: baseline;
  }

  .library-item.on,
  .calc-item.on {
    border-color: var(--color-primary);
    background: var(--color-primary-soft);
  }

  .library-name {
    font-weight: 600;
  }

  .icon-btn {
    border: 1px solid transparent;
    background: none;
    color: var(--text-muted-color);
    cursor: pointer;
    padding: 0 var(--space-2);
    font-size: var(--font-size-lg);
    line-height: 1;
  }

  .icon-btn:hover {
    border-color: var(--color-danger);
    color: var(--color-danger);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .field-name {
    min-width: 6rem;
  }

  .label-input {
    width: 9rem;
  }

  .description-input {
    width: 14rem;
  }

  .inserts {
    gap: var(--space-1);
  }

  .fields li {
    padding: var(--space-1) 0;
    border-bottom: 1px solid var(--border-color);
  }

  .fields select,
  .fields input:not([type='checkbox']) {
    width: auto;
  }

  .calc-row {
    display: flex;
    gap: var(--space-4);
    flex-wrap: wrap;
    align-items: flex-start;
  }

  .calc-inputs {
    flex: 2 1 22rem;
    min-width: 0;
  }

  .history {
    flex: 1 1 14rem;
    min-width: 0;
  }

  .calc-label {
    min-width: 8rem;
  }

  .calc-inputs input[type='number'] {
    width: 10rem;
  }

  .result-row {
    align-items: baseline;
  }

  .result {
    font-size: var(--font-size-lg);
    font-variant-numeric: tabular-nums;
  }

  .label-text {
    font-size: var(--font-size-eyebrow);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted-color);
  }

  .check {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    white-space: nowrap;
    margin: 0;
  }

  .check input {
    width: auto;
    margin: 0;
  }

  .inline {
    white-space: nowrap;
  }

  .muted {
    color: var(--text-muted-color);
  }

  .small {
    font-size: var(--font-size-sm);
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
</style>
