<script lang="ts">
  /**
   * Base64 — text and images, in both directions.
   *
   * Stateless: nothing here reaches the database. All of the encoding lives in
   * src/lib/encode/, so this page is the four combinations of (text | image) ×
   * (encode | decode), and the honesty about what base64 costs.
   */
  import Card from '../Card.svelte';
  import Explainer from '../Explainer.svelte';
  import { copyText, downloadBlob, downloadText } from '../../lib/exportFile';
  import {
    Base64Error,
    buildDataUrl,
    decodeBytes,
    decodedLength,
    decodeText,
    encodeBytes,
    encodedLength,
    encodeText,
    looksLikeDataUrl,
    parseDataUrl,
    validate,
  } from '../../lib/encode/base64';
  import { isDisplayableImage, sniff } from '../../lib/encode/sniff';

  /** Past this, a data URL starts causing problems wherever it is pasted. */
  const LARGE_BYTES = 1024 * 1024;

  let mode = $state<'text' | 'image'>('text');
  let direction = $state<'encode' | 'decode'>('encode');

  // Text mode
  let input = $state('');
  let urlSafe = $state(false);
  let padded = $state(true);
  let wrap = $state(false);

  // Image mode — encode
  let fileName = $state('');
  let fileBytes = $state<Uint8Array | null>(null);
  let fileError = $state('');

  // Image mode — decode
  let pasted = $state('');

  let copied = $state('');
  let notice = $state('');

  function flash(message: string): void {
    notice = message;
    setTimeout(() => (notice = ''), 2500);
  }

  async function copy(what: string, value: string): Promise<void> {
    if (value === '') return;
    if (await copyText(value)) {
      copied = what;
      setTimeout(() => (copied = ''), 1500);
    } else {
      flash('Clipboard blocked — use Download.');
    }
  }

  /* ---------------------------------------------------------------- text --- */

  const textResult = $derived.by(() => {
    if (input === '') return { output: '', error: null as string | null, offset: null as number | null };
    try {
      if (direction === 'encode') {
        return {
          output: encodeText(input, { url: urlSafe, pad: padded, wrap: wrap ? 76 : 0 }),
          error: null,
          offset: null,
        };
      }
      return { output: decodeText(input), error: null, offset: null };
    } catch (error) {
      if (error instanceof Base64Error) return { output: '', error: error.message, offset: error.offset };
      return { output: '', error: 'That could not be decoded.', offset: null };
    }
  });

  const textSizes = $derived.by(() => {
    if (input === '') return null;
    if (direction === 'encode') {
      const before = new TextEncoder().encode(input).length;
      const after = textResult.output.length;
      return { before, after, grew: before > 0 ? after / before : 0 };
    }
    const before = input.length;
    const after = decodedLength(input);
    return { before, after, grew: after > 0 ? before / after : 0 };
  });

  /* --------------------------------------------------------------- image --- */

  const fileKind = $derived(fileBytes ? sniff(fileBytes) : null);
  const encodedImage = $derived(fileBytes ? encodeBytes(fileBytes) : '');
  const imageDataUrl = $derived(
    fileBytes && fileKind ? buildDataUrl(fileKind.mime, fileBytes) : ''
  );

  async function readFile(file: File): Promise<void> {
    fileError = '';
    const buffer = new Uint8Array(await file.arrayBuffer());
    const kind = sniff(buffer);
    if (!kind) {
      fileError = `Nothing recognisable in ${file.name} — it can still be encoded, but its type is unknown.`;
    }
    fileName = file.name;
    fileBytes = buffer;
  }

  function onFileInput(event: Event): void {
    const element = event.currentTarget as HTMLInputElement;
    const file = element.files?.[0];
    if (file) void readFile(file);
    element.value = '';
  }

  function onDrop(event: DragEvent): void {
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    event.preventDefault();
    void readFile(file);
  }

  const decoded = $derived.by(() => {
    const value = pasted.trim();
    if (value === '') return null;
    try {
      if (looksLikeDataUrl(value)) {
        const parsed = parseDataUrl(value);
        if (!parsed) return { error: 'That looks like a data URL but could not be read.', bytes: null, kind: null };
        const kind = sniff(parsed.bytes);
        return { error: null, bytes: parsed.bytes, kind: kind ?? { mime: parsed.mime, extension: 'bin', label: parsed.mime } };
      }
      const check = validate(value);
      if (!check.ok) return { error: `${check.message} (at character ${(check.offset ?? 0) + 1})`, bytes: null, kind: null };
      const buffer = decodeBytes(value);
      const kind = sniff(buffer);
      return {
        error: null,
        bytes: buffer,
        kind: kind ?? { mime: 'application/octet-stream', extension: 'bin', label: 'Unknown data' },
      };
    } catch (error) {
      const message = error instanceof Base64Error ? error.message : 'That could not be decoded.';
      return { error: message, bytes: null, kind: null };
    }
  });

  const decodedUrl = $derived(
    decoded?.bytes && decoded.kind ? buildDataUrl(decoded.kind.mime, decoded.bytes) : ''
  );

  function downloadDecoded(): void {
    if (!decoded?.bytes || !decoded.kind) return;
    downloadBlob(new Blob([decoded.bytes as BlobPart], { type: decoded.kind.mime }), `decoded.${decoded.kind.extension}`);
  }

  const bytesLabel = (count: number): string =>
    count < 1024
      ? `${count} B`
      : count < 1024 * 1024
        ? `${(count / 1024).toFixed(1)} KB`
        : `${(count / (1024 * 1024)).toFixed(2)} MB`;
</script>

<div class="page-header">
  <h1>Base64</h1>
  <p class="muted">Text and images in and out of base64, without the traps.</p>
</div>

<div class="stack">
  <Card title="What to encode">
    <div class="controls">
      <div class="field">
        <label for="b64-mode">Working with</label>
        <select id="b64-mode" data-testid="b64-mode" bind:value={mode}>
          <option value="text">Text</option>
          <option value="image">An image or file</option>
        </select>
      </div>
      <div class="field">
        <label for="b64-direction">Direction</label>
        <select id="b64-direction" data-testid="b64-direction" bind:value={direction}>
          <option value="encode">Encode → base64</option>
          <option value="decode">Decode ← base64</option>
        </select>
      </div>
      {#if mode === 'text' || direction === 'encode'}
        <div class="field checkbox">
          <label for="b64-urlsafe">
            <input id="b64-urlsafe" type="checkbox" data-testid="b64-urlsafe" bind:checked={urlSafe} />
            URL-safe alphabet
          </label>
        </div>
        <div class="field checkbox">
          <label for="b64-padding">
            <input id="b64-padding" type="checkbox" data-testid="b64-padding" bind:checked={padded} />
            Pad with =
          </label>
        </div>
        <div class="field checkbox">
          <label for="b64-wrap">
            <input id="b64-wrap" type="checkbox" data-testid="b64-wrap" bind:checked={wrap} />
            Wrap at 76 columns
          </label>
        </div>
      {/if}
    </div>
  </Card>

  {#if mode === 'text'}
    <Card title={direction === 'encode' ? 'Text in' : 'Base64 in'}>
      <div class="field">
        <label for="b64-input">
          {direction === 'encode' ? 'Anything you can type' : 'Base64, either alphabet, padding optional'}
        </label>
        <textarea
          id="b64-input"
          data-testid="b64-input"
          rows="6"
          spellcheck="false"
          bind:value={input}
        ></textarea>
      </div>
    </Card>

    <Card title={direction === 'encode' ? 'Base64 out' : 'Text out'}>
      {#snippet actions()}
        <button
          class="btn btn-sm"
          data-testid="b64-copy"
          disabled={textResult.output === ''}
          onclick={() => copy('text', textResult.output)}
        >
          {copied === 'text' ? 'Copied' : 'Copy'}
        </button>
        <button
          class="btn btn-sm"
          data-testid="b64-download"
          disabled={textResult.output === ''}
          onclick={() =>
            downloadText(textResult.output, direction === 'encode' ? 'encoded.txt' : 'decoded.txt')}
        >
          Download
        </button>
      {/snippet}
      <div class="stack">
        {#if textResult.error}
          <p class="error" role="alert" data-testid="b64-error">
            {textResult.error}
            {#if textResult.offset !== null && textResult.offset < input.length}
              <br />
              <span class="muted">
                At character {textResult.offset + 1}: <code>{input.slice(Math.max(0, textResult.offset - 12), textResult.offset)}</code><mark
                  >{input.slice(textResult.offset, textResult.offset + 1)}</mark
                ><code>{input.slice(textResult.offset + 1, textResult.offset + 13)}</code>
              </span>
            {/if}
          </p>
        {:else if input === ''}
          <p class="muted" data-testid="b64-empty">Nothing in, nothing out.</p>
        {:else}
          <textarea
            data-testid="b64-output"
            rows="6"
            readonly
            aria-label={direction === 'encode' ? 'Base64 output' : 'Decoded text'}
            value={textResult.output}
          ></textarea>
          {#if textSizes}
            <p class="muted small" data-testid="b64-size">
              {#if direction === 'encode'}
                {bytesLabel(textSizes.before)} in → {bytesLabel(textSizes.after)} of base64
                ({Math.round((textSizes.grew - 1) * 100)}% larger)
              {:else}
                {bytesLabel(textSizes.before)} of base64 → {bytesLabel(textSizes.after)} of data
              {/if}
            </p>
          {/if}
        {/if}
      </div>
    </Card>
  {:else if direction === 'encode'}
    <Card title="File in">
      <div class="stack">
        <div
          class="dropzone"
          role="group"
          aria-label="Drop a file to encode"
          ondragover={(event) => event.preventDefault()}
          ondrop={onDrop}
        >
          <label class="file">
            <span class="btn">Choose a file…</span>
            <input type="file" data-testid="b64-file" onchange={onFileInput} />
          </label>
          <p class="muted small">…or drop one here.</p>
        </div>
        {#if fileError}
          <p class="note" role="status" data-testid="b64-file-note">{fileError}</p>
        {/if}
      </div>
    </Card>

    {#if fileBytes}
      <Card title={fileName}>
        <div class="stack">
          <div class="figures">
            <div>
              <span class="eyebrow">Type</span>
              <p data-testid="b64-kind">{fileKind?.label ?? 'Unknown'} <span class="muted">{fileKind?.mime ?? ''}</span></p>
            </div>
            <div>
              <span class="eyebrow">On disk</span>
              <p data-testid="b64-bytes">{bytesLabel(fileBytes.length)}</p>
            </div>
            <div>
              <span class="eyebrow">As base64</span>
              <p data-testid="b64-encoded-size">
                {bytesLabel(encodedLength(fileBytes.length))}
                <span class="muted">(+{Math.round((encodedLength(fileBytes.length) / fileBytes.length - 1) * 100)}%)</span>
              </p>
            </div>
          </div>

          {#if fileKind && isDisplayableImage(fileKind.mime)}
            <img class="preview" data-testid="b64-preview" src={imageDataUrl} alt={`Preview of ${fileName}`} />
          {/if}

          {#if fileBytes.length > LARGE_BYTES}
            <p class="note" role="status" data-testid="b64-large">
              This file is {bytesLabel(fileBytes.length)}, so the data URL below is about
              {bytesLabel(encodedLength(fileBytes.length))} of text. Pasted into a stylesheet it is
              downloaded in full before anything renders, it cannot be cached separately from the page,
              and some tools truncate a value that long.
            </p>
          {/if}

          <div class="field">
            <label for="b64-dataurl">Data URL</label>
            <textarea id="b64-dataurl" data-testid="b64-dataurl" rows="4" readonly value={imageDataUrl}></textarea>
          </div>
          <div class="row">
            <button class="btn btn-sm" data-testid="b64-copy-dataurl" onclick={() => copy('data', imageDataUrl)}>
              {copied === 'data' ? 'Copied' : 'Copy data URL'}
            </button>
            <button class="btn btn-sm" data-testid="b64-copy-raw" onclick={() => copy('raw', encodedImage)}>
              {copied === 'raw' ? 'Copied' : 'Copy base64 only'}
            </button>
            <button
              class="btn btn-sm"
              data-testid="b64-copy-css"
              onclick={() => copy('css', `background-image: url("${imageDataUrl}");`)}
            >
              {copied === 'css' ? 'Copied' : 'Copy as CSS'}
            </button>
            <button
              class="btn btn-sm"
              data-testid="b64-copy-img"
              onclick={() => copy('img', `<img src="${imageDataUrl}" alt="" />`)}
            >
              {copied === 'img' ? 'Copied' : 'Copy as <img>'}
            </button>
            <button
              class="btn btn-sm"
              data-testid="b64-download-text"
              onclick={() => downloadText(encodedImage, `${fileName || 'file'}.base64.txt`)}
            >
              Download the base64
            </button>
          </div>
        </div>
      </Card>
    {/if}
  {:else}
    <Card title="Base64 in">
      <div class="field">
        <label for="b64-paste">Raw base64 or a whole <code>data:</code> URL</label>
        <textarea id="b64-paste" data-testid="b64-paste" rows="6" spellcheck="false" bind:value={pasted}
        ></textarea>
      </div>
    </Card>

    <Card title="What that is">
      {#if !decoded}
        <p class="muted" data-testid="b64-decode-empty">Paste something to decode.</p>
      {:else if decoded.error}
        <p class="error" role="alert" data-testid="b64-decode-error">{decoded.error}</p>
      {:else}
        <div class="stack">
          <div class="figures">
            <div>
              <span class="eyebrow">Type</span>
              <p data-testid="b64-decode-kind">
                {decoded.kind?.label} <span class="muted">{decoded.kind?.mime}</span>
              </p>
            </div>
            <div>
              <span class="eyebrow">Size</span>
              <p data-testid="b64-decode-size">{bytesLabel(decoded.bytes?.length ?? 0)}</p>
            </div>
          </div>
          {#if decoded.kind && isDisplayableImage(decoded.kind.mime)}
            <img class="preview" data-testid="b64-decode-preview" src={decodedUrl} alt="The decoded image" />
          {:else}
            <p class="note" role="status" data-testid="b64-decode-not-image">
              That decoded cleanly, but it is {decoded.kind?.label ?? 'not something'} rather than an image
              a browser can draw. Download it and open it with whatever handles that format.
            </p>
          {/if}
          <div class="row">
            <button class="btn btn-sm" data-testid="b64-decode-download" onclick={downloadDecoded}>
              Download as .{decoded.kind?.extension}
            </button>
          </div>
        </div>
      {/if}
    </Card>
  {/if}

  {#if notice}
    <p class="muted small" role="status" data-testid="b64-notice">{notice}</p>
  {/if}

  <Explainer summary="What base64 is for, and what it costs" testid="explainer-base64">
    <p>
      Base64 turns arbitrary bytes into 64 printable characters so they can travel somewhere that only
      accepts text — a URL, an email body, a JSON field, a stylesheet. It is <strong>not</strong>
      encryption or compression: anyone can decode it, and it makes the data bigger.
    </p>
    <p>
      Exactly one third bigger, in fact: every 3 bytes become 4 characters, so a 900 KB photo becomes
      about 1.2 MB of text. That is why a data URL in a stylesheet is a real cost — it is downloaded
      before anything renders, and it cannot be cached separately from the page that carries it.
    </p>
    <p>
      The <strong>URL-safe alphabet</strong> (RFC 4648 §5) swaps <code>+</code> and <code>/</code> for
      <code>-</code> and <code>_</code>, because the first two mean something else in a URL. Padding
      (<code>=</code>) is usually dropped there too. This page decodes either alphabet with or without
      padding, and when a string is not base64 it says <em>where</em> it stopped being base64 rather
      than returning something that looks like data.
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
    word-break: break-all;
  }

  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
    align-items: flex-end;
  }

  .checkbox label {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .figures {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-5);
  }

  .small {
    font-size: var(--font-size-sm);
  }

  .error {
    color: var(--color-danger);
    font-size: var(--font-size-sm);
  }

  .note {
    border-left: 3px solid var(--color-stamp);
    padding: var(--space-2) var(--space-3);
    background: color-mix(in srgb, var(--color-stamp) 10%, transparent);
    font-size: var(--font-size-sm);
  }

  mark {
    background: var(--color-danger);
    color: var(--color-on-primary);
  }

  .dropzone {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-5);
    border: 1px dashed var(--border-strong-color);
  }

  .file {
    position: relative;
  }

  .file input[type='file'] {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
  }

  .preview {
    max-width: 100%;
    max-height: 18rem;
    border: 1px solid var(--border-color);
    background-color: var(--surface-raised-color);
  }
</style>
