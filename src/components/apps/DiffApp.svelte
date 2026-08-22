<script lang="ts">
  /**
   * Diff — two texts, and exactly where they differ.
   *
   * Stateless: nothing here reaches the database, and the page writes nothing
   * at any point. The comparison itself lives in src/lib/diff/, so everything
   * on this page is display.
   */
  import Card from '../Card.svelte';
  import CodeBlock from '../CodeBlock.svelte';
  import Explainer from '../Explainer.svelte';
  import { copyText, downloadText } from '../../lib/exportFile';
  import {
    type Granularity,
    type WhitespaceMode,
    detectLineEnding,
    differsOnlyByLineEnding,
    diffInline,
    diffLines,
    unifiedDiff,
  } from '../../lib/diff/text';

  /** Beyond this many characters, character-granularity is refused rather than
   * attempted: every grapheme becomes a token, and the honest answer is to say
   * so instead of hanging the tab. */
  const CHARACTER_LIMIT = 40_000;
  /** Rows drawn at once. A diff nobody can scroll is not more useful for being
   * complete, and the patch below carries the whole thing anyway. */
  const ROW_LIMIT = 2000;

  let left = $state('');
  let right = $state('');
  // The diff runs on the debounced copies: a paste of a few hundred kilobytes
  // should not re-diff on every keystroke that follows it.
  let leftValue = $state('');
  let rightValue = $state('');
  let granularity = $state<Granularity>('line');
  let layout = $state<'split' | 'inline'>('split');
  let ignoreCase = $state(false);
  let whitespace = $state<WhitespaceMode>('none');
  let context = $state(3);
  let notice = $state('');
  let copied = $state(false);
  let fileError = $state('');

  $effect(() => {
    const value = left;
    const handle = setTimeout(() => (leftValue = value), 120);
    return () => clearTimeout(handle);
  });

  $effect(() => {
    const value = right;
    const handle = setTimeout(() => (rightValue = value), 120);
    return () => clearTimeout(handle);
  });

  const options = $derived({ ignoreCase, whitespace });
  const empty = $derived(leftValue === '' && rightValue === '');
  const identical = $derived(leftValue === rightValue && !empty);

  const tooBigForCharacters = $derived(
    granularity === 'character' && leftValue.length + rightValue.length > CHARACTER_LIMIT
  );

  const lineDiff = $derived(
    granularity === 'line' && !empty ? diffLines(leftValue, rightValue, options) : null
  );
  const inlineDiff = $derived(
    granularity !== 'line' && !empty && !tooBigForCharacters
      ? diffInline(leftValue, rightValue, { ...options, granularity })
      : null
  );
  const stats = $derived(lineDiff?.stats ?? inlineDiff?.stats ?? null);
  const truncated = $derived(Boolean(lineDiff?.truncated || inlineDiff?.truncated));

  const rows = $derived(lineDiff ? lineDiff.rows.slice(0, ROW_LIMIT) : []);
  const hiddenRows = $derived(lineDiff ? Math.max(0, lineDiff.rows.length - ROW_LIMIT) : 0);

  const endingsOnly = $derived(!empty && differsOnlyByLineEnding(leftValue, rightValue));
  const endings = $derived({
    left: detectLineEnding(leftValue),
    right: detectLineEnding(rightValue),
  });

  const patch = $derived(empty ? '' : unifiedDiff(leftValue, rightValue, { ...options, context }));

  const percent = $derived(stats ? Math.round(stats.similarity * 1000) / 10 : 0);

  function flash(message: string): void {
    notice = message;
    setTimeout(() => (notice = ''), 2500);
  }

  function swap(): void {
    const held = left;
    left = right;
    right = held;
  }

  function clear(): void {
    left = '';
    right = '';
    fileError = '';
  }

  async function copyPatch(): Promise<void> {
    if (patch === '') return;
    copied = await copyText(patch);
    if (copied) setTimeout(() => (copied = false), 1500);
    else flash('Clipboard blocked — use Download.');
  }

  function downloadPatch(): void {
    if (patch === '') return;
    downloadText(patch, 'changes.diff', 'text/x-diff');
  }

  /** Text files only, and a binary file is refused by name rather than shown
   * as a wall of replacement characters. */
  async function readFile(file: File, side: 'left' | 'right'): Promise<void> {
    fileError = '';
    const text = await file.text();
    if (text.includes('\u0000')) {
      fileError = `${file.name} looks like a binary file — this tool compares text.`;
      return;
    }
    if (side === 'left') left = text;
    else right = text;
  }

  function onFileInput(event: Event, side: 'left' | 'right'): void {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void readFile(file, side);
    input.value = '';
  }

  function onDrop(event: DragEvent, side: 'left' | 'right'): void {
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    event.preventDefault();
    void readFile(file, side);
  }
</script>

<div class="page-header">
  <h1>Diff</h1>
  <p class="muted">Compare two texts and see exactly where they differ.</p>
</div>

<div class="stack">
  <Card title="Texts">
    {#snippet actions()}
      <button class="btn btn-sm" data-testid="diff-swap" onclick={swap}>Swap</button>
      <button class="btn btn-sm" data-testid="diff-clear" onclick={clear}>Clear</button>
    {/snippet}
    <div class="stack">
      <div class="grid-2">
        <div class="field">
          <label for="diff-left">Original</label>
          <textarea
            id="diff-left"
            data-testid="diff-left"
            rows="10"
            spellcheck="false"
            placeholder="Paste the original text, or drop a text file here"
            bind:value={left}
            ondragover={(event) => event.preventDefault()}
            ondrop={(event) => onDrop(event, 'left')}
          ></textarea>
          <label class="file">
            <span class="btn btn-sm">Load a file…</span>
            <input
              type="file"
              accept="text/*,.txt,.md,.csv,.json,.yaml,.yml,.log"
              data-testid="diff-left-file"
              onchange={(event) => onFileInput(event, 'left')}
            />
          </label>
        </div>
        <div class="field">
          <label for="diff-right">Changed</label>
          <textarea
            id="diff-right"
            data-testid="diff-right"
            rows="10"
            spellcheck="false"
            placeholder="Paste the changed text, or drop a text file here"
            bind:value={right}
            ondragover={(event) => event.preventDefault()}
            ondrop={(event) => onDrop(event, 'right')}
          ></textarea>
          <label class="file">
            <span class="btn btn-sm">Load a file…</span>
            <input
              type="file"
              accept="text/*,.txt,.md,.csv,.json,.yaml,.yml,.log"
              data-testid="diff-right-file"
              onchange={(event) => onFileInput(event, 'right')}
            />
          </label>
        </div>
      </div>
      {#if fileError}
        <p class="error" role="alert" data-testid="diff-file-error">{fileError}</p>
      {/if}
    </div>
  </Card>

  <Card title="Differences">
    <div class="stack">
      <div class="controls">
        <div class="field">
          <label for="diff-granularity">Compare by</label>
          <select id="diff-granularity" data-testid="diff-granularity" bind:value={granularity}>
            <option value="line">Line</option>
            <option value="word">Word</option>
            <option value="character">Character</option>
          </select>
        </div>
        {#if granularity === 'line'}
          <div class="field">
            <label for="diff-layout">Layout</label>
            <select id="diff-layout" data-testid="diff-layout" bind:value={layout}>
              <option value="split">Side by side</option>
              <option value="inline">Inline</option>
            </select>
          </div>
        {/if}
        <div class="field">
          <label for="diff-whitespace">Whitespace</label>
          <select id="diff-whitespace" data-testid="diff-whitespace" bind:value={whitespace}>
            <option value="none">Counts as a difference</option>
            <option value="edges">Ignore at the ends of lines</option>
            <option value="all">Ignore everywhere</option>
          </select>
        </div>
        <div class="field checkbox">
          <label for="diff-ignore-case">
            <input id="diff-ignore-case" type="checkbox" data-testid="diff-ignore-case" bind:checked={ignoreCase} />
            Ignore case
          </label>
        </div>
      </div>

      {#if empty}
        <p class="muted" data-testid="diff-empty">Paste text into both boxes to see the differences.</p>
      {:else if tooBigForCharacters}
        <p class="error" role="alert" data-testid="diff-too-big">
          Character-by-character comparison is capped at {CHARACTER_LIMIT.toLocaleString()} characters
          across both texts — every character becomes a token, and this pair has
          {(leftValue.length + rightValue.length).toLocaleString()}. Compare by word or by line instead.
        </p>
      {:else}
        <p class="summary" data-testid="diff-summary">
          {#if identical}
            <strong>The two texts are identical.</strong>
          {:else}
            <span class="added" data-testid="diff-insertions">+{stats?.insertions ?? 0}</span>
            <span class="removed" data-testid="diff-deletions">−{stats?.deletions ?? 0}</span>
            {#if (stats?.changed ?? 0) > 0}
              <span data-testid="diff-changed">{stats?.changed} changed {stats?.changed === 1 ? 'line' : 'lines'}</span>
            {/if}
            <span class="muted">{stats?.unit}</span>
            <span data-testid="diff-similarity">{percent}% alike</span>
          {/if}
        </p>

        {#if endingsOnly}
          <p class="note" role="status" data-testid="diff-ending-note">
            These texts differ <strong>only in their line endings</strong> — the original uses
            {endings.left.toUpperCase()}, the changed text uses {endings.right.toUpperCase()}. Nothing
            you can see on the page is different.
          </p>
        {/if}

        {#if truncated}
          <p class="note" role="status" data-testid="diff-truncated">
            These texts differ too much to line up edit by edit, so the middle is reported as one
            wholesale replacement. This is the tool giving up honestly, not the shortest set of changes.
          </p>
        {/if}

        {#if lineDiff}
          <div class="table-wrap">
            <table class="diff" data-testid="diff-table" class:inline={layout === 'inline'}>
              <caption class="sr-only">
                Differences between the original and the changed text, line by line
              </caption>
              <thead>
                <tr>
                  <th scope="col" class="num">Original</th>
                  {#if layout === 'split'}
                    <th scope="col">Original text</th>
                    <th scope="col" class="num">Changed</th>
                    <th scope="col">Changed text</th>
                  {:else}
                    <th scope="col" class="num">Changed</th>
                    <th scope="col">Line</th>
                  {/if}
                </tr>
              </thead>
              <tbody>
                {#each rows as row, index (index)}
                  {#if layout === 'split'}
                    <tr data-testid="diff-row" data-kind={row.kind}>
                      <td class="num">{row.left?.number ?? ''}</td>
                      <td class={row.left ? (row.kind === 'equal' ? 'same' : 'removed-cell') : 'blank'}>
                        {#if row.left?.parts}
                          {#each row.left.parts as part, partIndex (partIndex)}
                            {#if part.type === 'delete'}<del>{part.text}</del>{:else}{part.text}{/if}
                          {/each}
                        {:else if row.left}{row.left.text}{/if}
                      </td>
                      <td class="num">{row.right?.number ?? ''}</td>
                      <td class={row.right ? (row.kind === 'equal' ? 'same' : 'added-cell') : 'blank'}>
                        {#if row.right?.parts}
                          {#each row.right.parts as part, partIndex (partIndex)}
                            {#if part.type === 'insert'}<ins>{part.text}</ins>{:else}{part.text}{/if}
                          {/each}
                        {:else if row.right}{row.right.text}{/if}
                      </td>
                    </tr>
                  {:else}
                    {#if row.kind === 'equal'}
                      <tr data-testid="diff-row" data-kind="equal">
                        <td class="num">{row.left?.number}</td>
                        <td class="num">{row.right?.number}</td>
                        <td class="same"><span class="marker" aria-hidden="true"> </span>{row.left?.text}</td>
                      </tr>
                    {:else}
                      {#if row.left}
                        <tr data-testid="diff-row" data-kind={row.kind === 'replace' ? 'replace-old' : 'delete'}>
                          <td class="num">{row.left.number}</td>
                          <td class="num"></td>
                          <td class="removed-cell"><span class="marker" aria-hidden="true">−</span><del
                              >{row.left.text}</del
                            ></td>
                        </tr>
                      {/if}
                      {#if row.right}
                        <tr data-testid="diff-row" data-kind={row.kind === 'replace' ? 'replace-new' : 'insert'}>
                          <td class="num"></td>
                          <td class="num">{row.right.number}</td>
                          <td class="added-cell"><span class="marker" aria-hidden="true">+</span><ins
                              >{row.right.text}</ins
                            ></td>
                        </tr>
                      {/if}
                    {/if}
                  {/if}
                {/each}
              </tbody>
            </table>
          </div>
          {#if hiddenRows > 0}
            <p class="muted small" data-testid="diff-row-limit">
              Showing the first {ROW_LIMIT.toLocaleString()} rows; {hiddenRows.toLocaleString()} more are in
              the patch below.
            </p>
          {/if}
        {:else if inlineDiff}
          <p class="flow" data-testid="diff-flow">
            {#each inlineDiff.parts as part, index (index)}
              {#if part.type === 'insert'}<ins>{part.text}</ins>{:else if part.type === 'delete'}<del
                  >{part.text}</del
                >{:else}<span>{part.text}</span>{/if}
            {/each}
          </p>
        {/if}
      {/if}
    </div>
  </Card>

  {#if patch !== ''}
    <Card title="Patch">
      {#snippet actions()}
        <label class="context">
          <span>Context</span>
          <input
            type="number"
            min="0"
            max="20"
            step="1"
            data-testid="diff-context"
            aria-label="Context lines around each change"
            bind:value={context}
          />
        </label>
        <button class="btn btn-sm" data-testid="diff-copy" onclick={copyPatch}>
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button class="btn btn-sm" data-testid="diff-download" onclick={downloadPatch}>Download</button>
      {/snippet}
      <div class="stack">
        <CodeBlock code={patch} language="diff" testid="diff-patch" />
        {#if notice}
          <p class="muted small" role="status" data-testid="diff-notice">{notice}</p>
        {/if}
      </div>
    </Card>
  {/if}

  <Explainer summary="How this comparison is made" testid="explainer-diff">
    <p>
      The edit script comes from Myers' algorithm (1986), the one <code>git diff</code> uses. Its cost
      is proportional to the size of the DIFFERENCE rather than the size of the texts, so one changed
      line in a thousand costs about a thousand steps.
    </p>
    <p>
      Line mode runs a second pass INSIDE each pair of changed lines, at word level, which is why a
      one-word edit shows as one changed word instead of a deleted line and an added line. Word and
      character modes treat the whole text as one stream, which suits prose.
    </p>
    <p>
      "Ignore case" and the whitespace options change what counts as EQUAL, never what is displayed:
      the comparison sees a normalized key and the page always shows your original characters. Two
      texts that differ only in line endings are called out by name, because that difference is
      invisible on screen and otherwise reads as every line being rewritten.
    </p>
  </Explainer>
</div>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  textarea {
    width: 100%;
    resize: vertical;
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
  }

  .file input[type='file'] {
    /* The native control is unstyleable; the label's button IS the control, and
       clicking the label activates the input for mouse and keyboard alike. */
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
  }

  .file {
    position: relative;
    align-self: flex-start;
  }

  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
    align-items: flex-end;
  }

  .controls .field {
    min-width: 10rem;
  }

  .checkbox label {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .summary {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    align-items: baseline;
    font-size: var(--font-size-sm);
  }

  .added {
    color: var(--color-success);
    font-weight: 700;
  }

  .removed {
    color: var(--color-danger);
    font-weight: 700;
  }

  .note {
    border-left: 3px solid var(--color-stamp);
    padding: var(--space-2) var(--space-3);
    background: color-mix(in srgb, var(--color-stamp) 10%, transparent);
    font-size: var(--font-size-sm);
  }

  .error {
    color: var(--color-danger);
    font-size: var(--font-size-sm);
  }

  .small {
    font-size: var(--font-size-sm);
  }

  table.diff {
    width: 100%;
    border-collapse: collapse;
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
    table-layout: fixed;
  }

  table.diff th {
    text-align: left;
    font-size: var(--font-size-eyebrow);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-muted-color);
    border-bottom: 1px solid var(--border-color);
    padding: var(--space-2);
  }

  table.diff td {
    padding: 0 var(--space-2);
    vertical-align: top;
    white-space: pre-wrap;
    word-break: break-word;
    border-bottom: 1px solid color-mix(in srgb, var(--border-color) 45%, transparent);
  }

  table.diff .num {
    width: 4rem;
    text-align: right;
    color: var(--text-muted-color);
    user-select: none;
  }

  .marker {
    display: inline-block;
    width: 1ch;
    margin-right: var(--space-1);
  }

  .added-cell {
    background: color-mix(in srgb, var(--color-success) 16%, transparent);
  }

  .removed-cell {
    background: color-mix(in srgb, var(--color-danger) 16%, transparent);
  }

  .blank {
    background: color-mix(in srgb, var(--border-color) 22%, transparent);
  }

  /* ins/del carry the meaning for anyone who cannot see the tint; the
     underline and strike-through are the browser's own defaults, kept. */
  ins {
    background: color-mix(in srgb, var(--color-success) 34%, transparent);
    text-decoration: underline;
  }

  del {
    background: color-mix(in srgb, var(--color-danger) 34%, transparent);
  }

  .flow {
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
    white-space: pre-wrap;
    word-break: break-word;
    border: 1px solid var(--border-color);
    padding: var(--space-3);
    background: var(--surface-raised-color);
  }

  .context {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--font-size-sm);
  }

  .context input {
    width: 4rem;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
