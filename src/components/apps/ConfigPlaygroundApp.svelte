<script lang="ts">
  /**
   * Configuration playground — understand, validate and generate JSON/YAML.
   *
   * Two modes behind one switch. **Parse** takes a real document: it is
   * linted as you type, its 1.1-era YAML traps are called out, and its schema
   * is extracted into a Field/Type table. **Create** builds the same table by
   * hand and generates sample documents from it. The schema in hand survives
   * the switch — that is the point: a hand-built schema can be checked against
   * a real document without retyping either.
   *
   * Extraction is live only while the fields are the extractor's own work.
   * The moment a schema arrives from anywhere else — opened from the library,
   * or carried through the switch into Create and back — typing in the editor
   * stops rewriting it, and the table instead reports how well the document
   * fits the schema in hand. **Extract from document** always resumes the
   * live behaviour, and says so.
   */
  import { onDestroy, onMount } from 'svelte';
  import { stringify as yamlStringify } from 'yaml';
  import Card from '../Card.svelte';
  import CodeBlock from '../CodeBlock.svelte';
  import ConfigEditor from '../ConfigEditor.svelte';
  import Explainer from '../Explainer.svelte';
  import { copyText, downloadText } from '../../lib/exportFile';
  import {
    all,
    getSingleton,
    patch,
    put,
    putSingleton,
    softDelete,
    withSyncFields,
  } from '../../lib/db/repo';
  import type { ConfigField, ConfigSchema, Preferences } from '../../lib/db/types';
  import {
    blankField,
    childListOf,
    cloneFields,
    flattenFields,
    ITEM_KIND_OPTIONS,
    KIND_OPTIONS,
    normalizeSchemaRow,
    typeLabel,
    type FlatFieldRow,
  } from '../../lib/config/model';
  import { inferDocument } from '../../lib/config/infer';
  import { validateDocument } from '../../lib/config/validate';
  import { generateDocuments } from '../../lib/config/generate';
  import {
    parseConfigText,
    prettifyConfigText,
    sniffFormat,
    type ConfigFormat,
  } from '../../lib/config/parse';
  import { EXTENSIONS, LANGUAGE_LABELS, type Language } from '../../lib/codegen/functions';
  import { generateConfigFunction, type ConfigFlavor } from '../../lib/codegen/config';
  import { generateConfigWebComponent } from '../../lib/codegen/configWebcomponent';

  type Target = Language | 'webcomponent';
  type Mode = 'parse' | 'create';

  const TARGETS: { id: Target; label: string }[] = [
    { id: 'python', label: LANGUAGE_LABELS.python },
    { id: 'javascript', label: LANGUAGE_LABELS.javascript },
    { id: 'go', label: LANGUAGE_LABELS.go },
    { id: 'rust', label: LANGUAGE_LABELS.rust },
    { id: 'webcomponent', label: 'Web component' },
  ];

  // ---- the schema in hand --------------------------------------------------
  let schemas = $state<ConfigSchema[]>([]);
  let currentId = $state<string | null>(null);
  let name = $state('');
  let fields = $state<ConfigField[]>([]);
  /** True while the table is the extractor's own work (see the header). */
  let liveExtract = $state(true);
  /** Why the last extraction produced nothing, when it did. */
  let extractNote = $state<string | null>(null);
  /** Branch paths whose children the table is hiding. */
  let collapsed = $state<ReadonlySet<string>>(new Set());

  // ---- the document --------------------------------------------------------
  let mode = $state<Mode>('parse');
  let source = $state('');
  let formatOverride = $state<'auto' | ConfigFormat>('auto');
  let createFormat = $state<ConfigFormat>('json');
  let prettifyError = $state<string | null>(null);

  // ---- examples + code -----------------------------------------------------
  let amount = $state<number | null>(3);
  let examples = $state('');
  let examplesError = $state<string | null>(null);
  let flavor = $state<ConfigFlavor>('parser');
  let target = $state<Target>('python');
  let generated = $state('');
  let generateError = $state<string | null>(null);

  // ---- chrome --------------------------------------------------------------
  let sidebarOpen = $state(true);
  let search = $state('');
  let feedback = $state<string | null>(null);
  let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
  let editor: ConfigEditor | undefined = $state();
  let destroyed = false;

  const sniffed = $derived(sniffFormat(source));
  const parseFormat = $derived<ConfigFormat>(formatOverride === 'auto' ? sniffed : formatOverride);
  /** The format a save or a generated file describes right now. */
  const activeFormat = $derived<ConfigFormat>(mode === 'parse' ? parseFormat : createFormat);
  const parsed = $derived(parseConfigText(source, parseFormat));
  const parseErrors = $derived(parsed.issues.filter((i) => i.severity === 'error'));
  const parseWarnings = $derived(parsed.issues.filter((i) => i.severity === 'warning'));
  /** The document held against the schema in hand — the "check" half. */
  const checkIssues = $derived(
    mode === 'parse' && parsed.ok && fields.length > 0 && source.trim() !== ''
      ? validateDocument(parsed.value, fields)
      : []
  );
  const flatRows = $derived(flattenFields(fields, collapsed));
  const filtered = $derived(
    search.trim()
      ? schemas.filter((s: ConfigSchema) =>
          s.name.toLowerCase().includes(search.trim().toLowerCase())
        )
      : schemas
  );
  const fileStem = $derived((name.trim() || 'schema').replace(/[^a-z0-9._-]+/gi, '-'));
  const generatedLanguage = $derived(target === 'webcomponent' ? 'javascript' : target);
  const generatedFilename = $derived(
    target === 'webcomponent' ? `${fileStem}.js` : `${fileStem}.${EXTENSIONS[target as Language]}`
  );

  /**
   * Live extraction: while the table is the extractor's own work, a valid
   * document rewrites it and a broken one leaves the last good schema up —
   * half-typed JSON should not blank the table on every keystroke.
   */
  $effect(() => {
    if (mode !== 'parse' || !liveExtract) return;
    if (source.trim() === '') {
      extractNote = null;
      return;
    }
    if (!parsed.ok) return;
    const result = inferDocument(parsed.value);
    if ('error' in result) {
      extractNote = result.error;
      return;
    }
    extractNote = null;
    fields = result.fields;
  });

  /**
   * Generated output describes ONE schema. The moment the schema (or the
   * flavor it would be generated for) moves on, what is on screen is a
   * statement about something that no longer exists — so it goes.
   */
  const fingerprint = $derived(
    JSON.stringify({ f: fields, n: name, fmt: activeFormat, flavor })
  );
  $effect(() => {
    void fingerprint;
    generated = '';
    generateError = null;
    examples = '';
    examplesError = null;
  });

  function flash(text: string) {
    feedback = text;
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => (feedback = null), 2500);
  }

  /** `Ln 4, Col 12` for an offset — the gutter speaks lines, so the list should. */
  function lineCol(offset: number): string {
    const upTo = source.slice(0, Math.max(0, Math.min(offset, source.length)));
    const line = upTo.split('\n').length;
    const col = upTo.length - upTo.lastIndexOf('\n');
    return `Ln ${line}, Col ${col}`;
  }

  // ---- the document --------------------------------------------------------

  function onSourceChange(doc: string) {
    source = doc;
    prettifyError = null;
  }

  function prettify() {
    prettifyError = null;
    const pretty = prettifyConfigText(source, parseFormat);
    if (!pretty.ok) {
      prettifyError = pretty.message;
      return;
    }
    source = pretty.text;
    editor?.setText(pretty.text);
  }

  // ---- the schema table ----------------------------------------------------

  function markHandEdited() {
    liveExtract = false;
  }

  function extractFromDocument() {
    if (!parsed.ok) return;
    const result = inferDocument(parsed.value);
    if ('error' in result) {
      extractNote = result.error;
      return;
    }
    extractNote = null;
    fields = result.fields;
    liveExtract = true;
    flash('Schema extracted — the table follows the document again.');
  }

  function toggleCollapse(path: string) {
    const next = new Set(collapsed);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    collapsed = next;
  }

  function addFieldTo(list: ConfigField[]) {
    markHandEdited();
    list.push(blankField());
  }

  function removeField(row: FlatFieldRow) {
    markHandEdited();
    row.siblings.splice(row.index, 1);
  }

  /** Switching kind rebuilds the type node; an object keeps its children. */
  function setKind(row: FlatFieldRow, kind: string) {
    markHandEdited();
    const previous = row.field.type;
    if (kind === 'object') {
      row.field.type = { kind: 'object', fields: previous.kind === 'object' ? previous.fields ?? [] : [] };
    } else if (kind === 'array') {
      row.field.type = { kind: 'array', item: previous.kind === 'array' ? previous.item ?? { kind: 'string' } : { kind: 'string' } };
    } else {
      row.field.type = { kind: kind as ConfigField['type']['kind'] };
    }
  }

  function setItemKind(row: FlatFieldRow, kind: string) {
    markHandEdited();
    if (row.field.type.kind !== 'array') return;
    const previous = row.field.type.item;
    row.field.type.item =
      kind === 'object'
        ? { kind: 'object', fields: previous?.kind === 'object' ? previous.fields ?? [] : [] }
        : { kind: kind as ConfigField['type']['kind'] };
  }

  /** The Type select's options: the fixed set, plus the row's own inferred
   * kind when it is one the dropdown does not offer (enum, union). */
  function kindOptionsFor(row: FlatFieldRow): string[] {
    const kind = row.field.type.kind;
    return KIND_OPTIONS.includes(kind) ? [...KIND_OPTIONS] : [kind, ...KIND_OPTIONS];
  }

  // ---- persistence ---------------------------------------------------------

  async function refresh() {
    schemas = (await all<ConfigSchema>('config_schemas')).sort((a: ConfigSchema, b: ConfigSchema) =>
      a.name.localeCompare(b.name)
    );
  }

  async function openSchema(row: ConfigSchema, opts: { remember?: boolean } = {}) {
    // A stored row is untrusted: backups are hand-editable and the generic
    // data suite writes an array into every json column.
    const doc = normalizeSchemaRow(row);
    currentId = row.id;
    name = doc.name;
    createFormat = doc.format;
    fields = cloneFields(doc.fields);
    source = doc.source;
    formatOverride = 'auto';
    liveExtract = false;
    collapsed = new Set();
    extractNote = null;
    prettifyError = null;
    editor?.setText(doc.source);
    if (opts.remember !== false) {
      await putSingleton<Partial<Preferences>>('preferences', { config_last_schema_id: row.id });
    }
  }

  function newSchema() {
    currentId = null;
    name = '';
    fields = [];
    source = '';
    createFormat = 'json';
    formatOverride = 'auto';
    liveExtract = true;
    collapsed = new Set();
    extractNote = null;
    prettifyError = null;
    editor?.setText('');
  }

  async function saveSchema() {
    const body = {
      name: name.trim() || 'Untitled',
      format: activeFormat,
      fields: cloneFields(fields),
      source,
    };
    if (currentId) {
      await patch<ConfigSchema>('config_schemas', currentId, body);
    } else {
      const row = await put<ConfigSchema>('config_schemas', withSyncFields(body));
      currentId = row.id;
      await putSingleton<Partial<Preferences>>('preferences', { config_last_schema_id: row.id });
    }
    await refresh();
    flash('Schema saved.');
  }

  async function deleteSchema(row: ConfigSchema) {
    if (!confirm(`Delete “${row.name}”?`)) return;
    await softDelete('config_schemas', row.id);
    await refresh();
    if (currentId === row.id) newSchema();
    flash('Schema deleted.');
  }

  async function switchMode() {
    const next: Mode = mode === 'parse' ? 'create' : 'parse';
    if (next === 'create') {
      // The schema crosses the switch with the format it was read in — and
      // from here on it is hand work, so extraction stops rewriting it.
      createFormat = activeFormat;
      liveExtract = false;
    }
    mode = next;
    await putSingleton<Partial<Preferences>>('preferences', { config_last_mode: next });
  }

  // ---- examples ------------------------------------------------------------

  function renderDocuments(docs: Record<string, unknown>[]): string {
    if (createFormat === 'yaml') {
      return docs.map((d) => yamlStringify(d)).join('---\n');
    }
    return docs.length === 1
      ? JSON.stringify(docs[0], null, 2)
      : JSON.stringify(docs, null, 2);
  }

  function generateExamples() {
    examples = '';
    examplesError = null;
    if (fields.length === 0) {
      examplesError = 'Add at least one field first.';
      return;
    }
    const count = Math.max(1, Math.min(100, Math.floor(amount ?? 1)));
    amount = count;
    // A fresh seed per press: the button means "show me different ones".
    const seed = (Math.random() * 0xffffffff) >>> 0;
    examples = renderDocuments(generateDocuments(fields, count, seed));
  }

  async function copyExamples() {
    flash((await copyText(examples)) ? 'Copied the examples.' : 'Clipboard blocked — download instead.');
  }

  function downloadExamples() {
    const ext = createFormat === 'yaml' ? 'yaml' : 'json';
    const mime = createFormat === 'yaml' ? 'text/yaml' : 'application/json';
    downloadText(examples, `${fileStem}-examples.${ext}`, mime);
  }

  // ---- code generation -----------------------------------------------------

  function generate() {
    generated = '';
    generateError = null;
    if (fields.length === 0) {
      generateError = 'Add or extract at least one field first.';
      return;
    }
    const template = { name: name.trim() || 'config', format: activeFormat, fields: cloneFields(fields) };
    try {
      generated =
        target === 'webcomponent'
          ? generateConfigWebComponent(template, flavor)
          : generateConfigFunction(template, target as Language, flavor);
    } catch (err) {
      // A named refusal, not a silently wrong file.
      generateError = err instanceof Error ? err.message : 'That schema could not be turned into code.';
    }
  }

  async function copyGenerated() {
    flash((await copyText(generated)) ? 'Copied the code.' : 'Clipboard blocked — download instead.');
  }

  function downloadGenerated() {
    downloadText(generated, generatedFilename, 'text/plain');
  }

  // ---- lifecycle -----------------------------------------------------------

  onMount(async () => {
    // Reading the remembered schema and mode writes nothing — page loads must not.
    await refresh();
    const prefs = await getSingleton<Preferences>('preferences');
    if (destroyed) return;
    if (prefs?.config_last_mode === 'create') mode = 'create';
    const remembered = schemas.find((s: ConfigSchema) => s.id === prefs?.config_last_schema_id);
    if (remembered) await openSchema(remembered, { remember: false });
  });

  onDestroy(() => {
    destroyed = true;
    clearTimeout(feedbackTimer);
  });
</script>

<div class="page-header">
  <h1>Config playground</h1>
</div>

<div class="layout" class:closed={!sidebarOpen}>
  <aside class="sidebar">
    <div class="row">
      <button
        class="btn btn-sm"
        data-testid="config-toggle-library"
        aria-expanded={sidebarOpen}
        onclick={() => (sidebarOpen = !sidebarOpen)}
      >
        {sidebarOpen ? '‹ Library' : '›'}
      </button>
      {#if sidebarOpen}
        <button class="btn btn-sm btn-primary" data-testid="config-new" onclick={newSchema}>
          New
        </button>
      {/if}
    </div>
    {#if sidebarOpen}
      <input
        class="search"
        data-testid="config-search"
        type="search"
        placeholder="Search schemas…"
        aria-label="Search schemas"
        bind:value={search}
      />
      {#if filtered.length === 0}
        <p class="muted small" data-testid="config-no-schemas">
          {schemas.length === 0 ? 'No schemas saved yet.' : 'Nothing matches that.'}
        </p>
      {:else}
        <ul class="library" data-testid="config-library">
          {#each filtered as row (row.id)}
            <li>
              <button
                class="library-item"
                class:on={row.id === currentId}
                data-testid="config-schema-row"
                data-name={row.name}
                aria-pressed={row.id === currentId}
                onclick={() => openSchema(row)}
              >
                <span class="library-name">{row.name}</span>
                <span class="muted small">{row.format === 'yaml' ? 'YAML' : 'JSON'}</span>
              </button>
              <button
                class="icon-btn"
                data-testid="config-delete-schema"
                aria-label={`Delete ${row.name}`}
                onclick={() => deleteSchema(row)}>×</button
              >
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </aside>

  <div class="stack main">
    <div class="row wrap mode-row">
      <span class="label-text" data-testid="config-mode">
        Mode: {mode === 'parse' ? 'Parse' : 'Create'}
      </span>
      <button class="btn btn-sm" data-testid="config-switch-mode" onclick={switchMode}>
        {mode === 'parse' ? 'Switch to Create' : 'Switch to Parse'}
      </button>
      <span class="muted small">The schema in hand survives the switch.</span>
    </div>

    {#if mode === 'parse'}
      <Card title="Document">
        {#snippet actions()}
          <button
            class="btn btn-sm"
            data-testid="config-prettify"
            disabled={source.trim() === ''}
            onclick={prettify}>Prettify</button
          >
        {/snippet}
        <div class="stack">
          <div class="row wrap">
            <label class="inline" for="config-format-override">Format</label>
            <select
              id="config-format-override"
              data-testid="config-format-override"
              bind:value={formatOverride}
            >
              <option value="auto">Auto — {sniffed === 'json' ? 'JSON' : 'YAML'}</option>
              <option value="json">JSON</option>
              <option value="yaml">YAML</option>
            </select>
            {#if source.trim() === ''}
              <span class="muted small" data-testid="config-empty-note">
                Paste a JSON or YAML document to check it.
              </span>
            {:else if parseErrors.length === 0}
              <span class="badge good" data-testid="config-valid-badge">
                Valid {parseFormat === 'json' ? 'JSON' : 'YAML'}
              </span>
            {:else}
              <span class="badge bad" data-testid="config-invalid-badge">
                {parseErrors.length} error{parseErrors.length === 1 ? '' : 's'}
              </span>
            {/if}
          </div>
          <ConfigEditor
            bind:this={editor}
            initialDoc={source}
            format={parseFormat}
            lint={(text) => parseConfigText(text, parseFormat).issues}
            onDocChange={onSourceChange}
          />
          {#if prettifyError}
            <p class="form-error" data-testid="config-prettify-error">{prettifyError}</p>
          {/if}
          {#if parseErrors.length > 0}
            <ul class="issues" data-testid="config-parse-errors">
              {#each parseErrors.slice(0, 20) as issue, i (i)}
                <li class="form-error small">{lineCol(issue.from)} — {issue.message}</li>
              {/each}
            </ul>
          {/if}
          {#if parseWarnings.length > 0}
            <ul class="issues" data-testid="config-parse-warnings">
              {#each parseWarnings.slice(0, 20) as issue, i (i)}
                <li class="warn small">{lineCol(issue.from)} — {issue.message}</li>
              {/each}
            </ul>
          {/if}
        </div>
      </Card>
    {/if}

    <Card title="Schema">
      {#snippet actions()}
        {#if mode === 'parse'}
          <button
            class="btn btn-sm"
            data-testid="config-extract"
            disabled={!parsed.ok || source.trim() === ''}
            onclick={extractFromDocument}
            title="Replace the table with the schema of the current document"
          >
            Extract from document
          </button>
        {/if}
        <button class="btn btn-sm btn-primary" data-testid="config-save-schema" onclick={saveSchema}>
          Save schema
        </button>
      {/snippet}
      <div class="stack">
        <div class="row wrap">
          <label class="inline" for="config-name">Schema name</label>
          <input
            id="config-name"
            data-testid="config-name"
            bind:value={name}
            placeholder="deploy-settings"
          />
          {#if mode === 'create'}
            <label class="inline" for="config-create-format">Output format</label>
            <select
              id="config-create-format"
              data-testid="config-create-format"
              bind:value={createFormat}
            >
              <option value="json">JSON</option>
              <option value="yaml">YAML</option>
            </select>
          {/if}
        </div>

        {#if mode === 'parse'}
          {#if extractNote}
            <p class="form-error small" data-testid="config-extract-note">{extractNote}</p>
          {:else if !liveExtract && fields.length > 0}
            <p class="muted small" data-testid="config-schema-held">
              Showing the schema in hand — the document below is checked against it.
              <strong>Extract from document</strong> replaces it.
            </p>
          {/if}
        {/if}

        {#if fields.length === 0}
          <p class="muted small" data-testid="config-no-fields">
            {mode === 'parse'
              ? 'Paste a valid document and its fields appear here.'
              : 'No fields yet — add one below.'}
          </p>
        {:else}
          <table class="schema-table" data-testid="config-fields">
            <thead>
              <tr>
                <th scope="col">Field</th>
                <th scope="col">Type</th>
                <th scope="col">Required</th>
                <th scope="col">Nullable</th>
                {#if mode === 'create'}<th scope="col"><span class="visually-hidden">Actions</span></th>{/if}
              </tr>
            </thead>
            <tbody>
              {#each flatRows as row (row.path + ':' + row.index)}
                <tr data-testid="config-field-row" data-path={row.path}>
                  <td>
                    <span class="indent" style={`--depth:${row.depth}`}>
                      {#if row.children}
                        <button
                          class="collapse-btn"
                          data-testid={'config-collapse-' + row.path}
                          aria-expanded={!collapsed.has(row.path)}
                          aria-label={`${collapsed.has(row.path) ? 'Expand' : 'Collapse'} ${row.path}`}
                          onclick={() => toggleCollapse(row.path)}
                        >
                          {collapsed.has(row.path) ? '▸' : '▾'}
                        </button>
                      {/if}
                      {#if mode === 'create'}
                        <input
                          class="key-input"
                          data-testid={'config-key-' + row.path}
                          aria-label={`Field name (${row.path || 'new field'})`}
                          bind:value={row.field.key}
                          oninput={markHandEdited}
                          placeholder="key"
                        />
                      {:else}
                        <code>{row.field.key}</code>
                      {/if}
                    </span>
                  </td>
                  <td>
                    {#if mode === 'create'}
                      <select
                        data-testid={'config-type-' + row.path}
                        aria-label={`Type of ${row.path}`}
                        value={row.field.type.kind}
                        onchange={(e) => setKind(row, e.currentTarget.value)}
                      >
                        {#each kindOptionsFor(row) as kind (kind)}
                          <option value={kind}>{kind}</option>
                        {/each}
                      </select>
                      {#if row.field.type.kind === 'array'}
                        <select
                          data-testid={'config-item-type-' + row.path}
                          aria-label={`Element type of ${row.path}`}
                          value={row.field.type.item?.kind ?? 'any'}
                          onchange={(e) => setItemKind(row, e.currentTarget.value)}
                        >
                          {#each ITEM_KIND_OPTIONS as kind (kind)}
                            <option value={kind}>{kind}</option>
                          {/each}
                        </select>
                      {/if}
                    {:else}
                      <code data-testid={'config-type-label-' + row.path}>{typeLabel(row.field.type)}</code>
                    {/if}
                  </td>
                  <td>
                    {#if mode === 'create'}
                      <input
                        type="checkbox"
                        data-testid={'config-required-' + row.path}
                        aria-label={`${row.path} is required`}
                        checked={!row.field.optional}
                        onchange={(e) => {
                          markHandEdited();
                          row.field.optional = !e.currentTarget.checked;
                        }}
                      />
                    {:else}
                      <span class="muted small">{row.field.optional ? 'optional' : 'yes'}</span>
                    {/if}
                  </td>
                  <td>
                    {#if mode === 'create'}
                      <input
                        type="checkbox"
                        data-testid={'config-nullable-' + row.path}
                        aria-label={`${row.path} may be null`}
                        bind:checked={row.field.nullable}
                        onchange={markHandEdited}
                      />
                    {:else}
                      <span class="muted small">{row.field.nullable ? 'yes' : '—'}</span>
                    {/if}
                  </td>
                  {#if mode === 'create'}
                    <td class="row-actions">
                      {#if row.children}
                        <button
                          class="btn btn-sm"
                          data-testid={'config-add-child-' + row.path}
                          onclick={() => row.children && addFieldTo(row.children)}
                        >
                          + child
                        </button>
                      {/if}
                      <button
                        class="icon-btn"
                        data-testid={'config-remove-' + row.path}
                        aria-label={`Remove ${row.path}`}
                        onclick={() => removeField(row)}>×</button
                      >
                    </td>
                  {/if}
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}

        {#if mode === 'create'}
          <div class="row">
            <button class="btn btn-sm" data-testid="config-add-field" onclick={() => addFieldTo(fields)}>
              + field
            </button>
          </div>
        {/if}

        {#if mode === 'parse' && fields.length > 0 && source.trim() !== '' && parsed.ok}
          {#if checkIssues.length === 0}
            <p class="badge good" data-testid="config-check-ok">Document matches the schema.</p>
          {:else}
            <ul class="issues" data-testid="config-check-issues">
              {#each checkIssues.slice(0, 30) as issue, i (i)}
                <li class={issue.severity === 'error' ? 'form-error small' : 'warn small'}>
                  {issue.path || 'document'} — {issue.message}
                </li>
              {/each}
            </ul>
          {/if}
        {/if}
      </div>
    </Card>

    {#if mode === 'create'}
      <Card title="Examples">
        <div class="stack">
          <div class="row wrap">
            <label class="inline" for="config-amount">Amount</label>
            <input
              id="config-amount"
              data-testid="config-amount"
              type="number"
              min="1"
              max="100"
              step="1"
              bind:value={amount}
            />
            <button
              class="btn btn-sm btn-primary"
              data-testid="config-generate-examples"
              onclick={generateExamples}
            >
              Generate
            </button>
            {#if examples}
              <button class="btn btn-sm" data-testid="config-copy-examples" onclick={copyExamples}>
                Copy
              </button>
              <button class="btn btn-sm" data-testid="config-download-examples" onclick={downloadExamples}>
                Download
              </button>
            {/if}
          </div>
          {#if examplesError}
            <p class="form-error" data-testid="config-examples-error">{examplesError}</p>
          {/if}
          {#if examples}
            <CodeBlock code={examples} language={createFormat} testid="config-examples" />
          {/if}
        </div>
      </Card>
    {/if}

    <Card title="Code generator">
      <div class="stack">
        <div class="row wrap">
          <span class="label-text" id="config-flavor-label">Export a</span>
          <div class="row" role="group" aria-labelledby="config-flavor-label">
            <button
              class="btn btn-sm"
              class:btn-primary={flavor === 'parser'}
              data-testid="config-flavor-parser"
              aria-pressed={flavor === 'parser'}
              onclick={() => (flavor = 'parser')}>Parser</button
            >
            <button
              class="btn btn-sm"
              class:btn-primary={flavor === 'generator'}
              data-testid="config-flavor-generator"
              aria-pressed={flavor === 'generator'}
              onclick={() => (flavor = 'generator')}>Generator</button
            >
          </div>
          <label class="inline" for="config-language">Language</label>
          <select id="config-language" data-testid="config-language" bind:value={target}>
            {#each TARGETS as option (option.id)}
              <option value={option.id}>{option.label}</option>
            {/each}
          </select>
          <button class="btn btn-sm btn-primary" data-testid="config-generate" onclick={generate}>
            Generate
          </button>
          {#if generated}
            <button class="btn btn-sm" data-testid="config-copy-code" onclick={copyGenerated}>
              Copy text
            </button>
            <button class="btn btn-sm" data-testid="config-download-code" onclick={downloadGenerated}>
              Download
            </button>
          {/if}
        </div>
        <p class="muted small">
          A <strong>parser</strong> validates a document and surfaces each field. A
          <strong>generator</strong> produces sample documents in this schema.
        </p>
        {#if generateError}
          <p class="form-error" data-testid="config-generate-error">{generateError}</p>
        {/if}
        {#if generated}
          <CodeBlock code={generated} language={generatedLanguage} testid="config-code" />
        {/if}
      </div>
    </Card>

    {#if feedback}
      <p class="muted small" data-testid="config-feedback" aria-live="polite">{feedback}</p>
    {/if}

    <Explainer summary="Why YAML sometimes surprises you">
      <p>
        This page reads YAML 1.2, where a bare <code>NO</code> is the string it looks like. Under
        the older YAML 1.1 — which some tools still speak — it is the boolean <code>false</code>,
        which is how a country code once broke a whole pipeline. The same era read
        <code>12:30</code> as the number 750 (sexagesimal) and <code>0123</code> as octal 83. The
        page flags every value that would change meaning under a 1.1 parser; quoting the value is
        the cure in each case.
      </p>
      <p>
        Other flags worth trusting: integers past 2⁵³ lose precision the moment JavaScript — or a
        JSON step anywhere in your pipeline — touches them; <code>.nan</code> and
        <code>.inf</code> have no JSON spelling at all; anchors and aliases expand into copies when
        converted to JSON, so shared structure is lost; and non-string mapping keys become strings.
        Alias expansion is capped while parsing, so a pasted "billion laughs" document is refused
        rather than obeyed.
      </p>
      <p>
        <strong>Prettify keeps your comments.</strong> The YAML formatter round-trips the document
        through a parser that preserves them — a formatter that silently deleted every comment
        would be data loss dressed as tidying. JSON has no comments to keep.
      </p>
    </Explainer>

    <Explainer summary="What the generated code does and does not do">
      <p>
        A generated <strong>parser</strong> checks what this page checks: every field's presence,
        type, format and allowed values, with one problem reported per field rather than a stop at
        the first. A generated <strong>generator</strong> is seeded — the same seed reproduces the
        same documents, which is what you want in a test fixture.
      </p>
      <p>
        The files are dependency-free standard library, with two honest exceptions: the Rust
        parser leans on <code>serde_json</code> (Rust ships no JSON parser), and a schema in YAML
        asks you to decode the text yourself first — a dependency-free file cannot parse YAML, and
        pretending otherwise would be a parser that silently wasn't one. The web component says
        the same thing in its own header: it accepts JSON input only.
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

  .library {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .library li {
    display: flex;
    align-items: stretch;
    gap: var(--space-1);
  }

  .library-item {
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

  .library-item.on {
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

  .mode-row {
    align-items: center;
  }

  .label-text {
    font-size: var(--font-size-eyebrow);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted-color);
  }

  .badge {
    display: inline-block;
    padding: 0 var(--space-2);
    border: 1px solid var(--border-color);
    font-size: var(--font-size-sm);
  }

  .badge.good {
    border-color: var(--color-success);
    color: var(--color-success);
  }

  .badge.bad {
    border-color: var(--color-danger);
    color: var(--color-danger);
  }

  .issues {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .warn {
    color: var(--color-warning);
  }

  .schema-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--font-size-sm);
  }

  .schema-table th {
    text-align: left;
    font-size: var(--font-size-eyebrow);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted-color);
    padding: var(--space-1) var(--space-2) var(--space-1) 0;
  }

  .schema-table td {
    padding: var(--space-1) var(--space-2) var(--space-1) 0;
    border-top: 1px solid var(--border-color);
    vertical-align: middle;
  }

  .indent {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding-left: calc(var(--depth, 0) * var(--space-3));
  }

  .collapse-btn {
    border: none;
    background: none;
    cursor: pointer;
    color: var(--text-muted-color);
    padding: 0;
    font: inherit;
  }

  .key-input {
    width: 10rem;
  }

  .schema-table select,
  .schema-table input:not([type='checkbox']) {
    width: auto;
  }

  .row-actions {
    white-space: nowrap;
  }

  .muted {
    color: var(--text-muted-color);
  }

  .small {
    font-size: var(--font-size-sm);
  }

  .inline {
    white-space: nowrap;
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
</style>
