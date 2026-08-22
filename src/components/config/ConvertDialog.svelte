<script lang="ts">
  /**
   * "Give me this document in another format."
   *
   * The dialog is a converter, not a second editor: it reads the document the
   * page already has, writes it out as the format asked for, and hands the
   * result over as a copy or a file. Nothing it does touches the document in
   * the editor — a conversion you did not want should cost a keystroke to
   * dismiss, not an undo.
   *
   * It converts as the controls move rather than behind a Convert button.
   * The work is one parse and one serialize of a document already in memory,
   * and a preview that goes stale the moment a dropdown changes is worse than
   * one that keeps up; the run is guarded by a token so a slow TOML import
   * cannot land after a newer request.
   */
  import CodeBlock from '../CodeBlock.svelte';
  import { copyText, downloadText } from '../../lib/exportFile';
  import {
    CONVERT_FORMATS,
    FORMAT_EXTENSION,
    FORMAT_GRAMMAR,
    FORMAT_LABELS,
    convertDocument,
    type ConvertFormat,
  } from '../../lib/config/convert';

  let {
    source,
    from: initialFrom,
    onClose,
  }: {
    /** The document as it stands in the editor. */
    source: string;
    /** What the page already believes the document is. */
    from: ConvertFormat;
    onClose: () => void;
  } = $props();

  let from = $state<ConvertFormat>(initialFrom);
  let to = $state<ConvertFormat>(initialFrom === 'json' ? 'yaml' : 'json');
  let output = $state('');
  let warnings = $state<string[]>([]);
  let error = $state<string | null>(null);
  let busy = $state(false);
  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  /** The id of the newest run; an older one that finishes late is dropped. */
  let run = 0;

  const stem = 'converted';
  const filename = $derived(`${stem}.${FORMAT_EXTENSION[to]}`);

  async function convert() {
    const token = ++run;
    busy = true;
    const result = await convertDocument(source, from, to);
    if (token !== run) return;
    busy = false;
    if (result.ok) {
      output = result.text;
      warnings = result.warnings;
      error = null;
    } else {
      output = '';
      warnings = [];
      error = result.message;
    }
  }

  // Re-runs whenever either end of the conversion moves. `source` is fixed for
  // the life of the dialog, so this is the whole trigger set.
  $effect(() => {
    void from;
    void to;
    void convert();
  });

  async function copy() {
    copied = await copyText(output);
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (copied = false), 1500);
  }

  function download() {
    // text/plain for TOML and CSV would be a lie on a machine that knows the
    // types; the ones with registered media types get them.
    const mime =
      to === 'json' ? 'application/json' : to === 'csv' ? 'text/csv' : 'text/plain';
    downloadText(output, filename, mime);
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onClose()} />

<div
  class="backdrop"
  role="presentation"
  onclick={(e) => e.target === e.currentTarget && onClose()}
>
  <div
    class="modal"
    role="dialog"
    aria-modal="true"
    aria-labelledby="config-convert-title"
    data-testid="config-convert-dialog"
  >
    <div class="head">
      <h3 id="config-convert-title">Convert document</h3>
      <button type="button" class="close" aria-label="Close" onclick={onClose}>×</button>
    </div>

    <div class="row wrap">
      <label class="inline" for="config-convert-from">From</label>
      <select id="config-convert-from" data-testid="config-convert-from" bind:value={from}>
        {#each CONVERT_FORMATS as format (format)}
          <option value={format}>{FORMAT_LABELS[format]}</option>
        {/each}
      </select>

      <span class="arrow" aria-hidden="true">→</span>

      <label class="inline" for="config-convert-to">To</label>
      <select id="config-convert-to" data-testid="config-convert-to" bind:value={to}>
        {#each CONVERT_FORMATS as format (format)}
          <option value={format}>{FORMAT_LABELS[format]}</option>
        {/each}
      </select>

      <span class="spacer"></span>

      <button
        class="btn btn-sm"
        data-testid="config-convert-copy"
        disabled={output === ''}
        onclick={copy}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
      <button
        class="btn btn-sm"
        data-testid="config-convert-download"
        disabled={output === ''}
        onclick={download}
      >
        Download {filename}
      </button>
    </div>

    <div class="result">
      {#if error}
        <p class="form-error" data-testid="config-convert-error" role="alert">{error}</p>
      {:else if busy && output === ''}
        <p class="muted small" data-testid="config-convert-busy">Converting…</p>
      {:else}
        <CodeBlock
          code={output}
          language={FORMAT_GRAMMAR[to]}
          testid="config-convert-output"
          maxHeight="28rem"
        />
      {/if}
    </div>

    {#if warnings.length > 0}
      <ul class="warnings" data-testid="config-convert-warnings">
        {#each warnings as warning (warning)}
          <li class="muted small">{warning}</li>
        {/each}
      </ul>
    {/if}

    <p class="muted small">
      The document in the editor is left exactly as it is; this only hands you a copy in the
      other spelling.
    </p>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: var(--scrim-color);
    display: grid;
    place-items: center;
    z-index: 70;
    padding: var(--space-4);
  }

  .modal {
    background: var(--surface-raised-color);
    border: 1px solid var(--border-strong-color);
    outline: 1px dashed var(--border-color);
    outline-offset: 4px;
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-2);
    padding: var(--space-4);
    width: min(56rem, 100%);
    max-height: min(90vh, 100%);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
  }

  h3 {
    font-size: var(--font-size-sm);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
  }

  .close {
    border: none;
    background: none;
    color: var(--text-muted-color);
    font-size: var(--font-size-lg);
    line-height: 1;
    cursor: pointer;
    padding: 0 var(--space-1);
  }

  .close:hover {
    color: var(--color-danger);
  }

  .arrow {
    color: var(--text-muted-color);
  }

  .spacer {
    flex: 1 1 auto;
  }

  .inline {
    white-space: nowrap;
  }

  /* The preview is the tall part: it takes what the dialog has left rather
     than pushing the buttons off the bottom. */
  .result {
    min-height: 0;
    overflow: auto;
  }

  .warnings {
    margin: 0;
    padding-left: var(--space-5);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
</style>
