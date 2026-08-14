<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import Card from '../Card.svelte';
  import Explainer from '../Explainer.svelte';
  import { getSingleton, putSingleton } from '../../lib/db/repo';
  import type { Preferences } from '../../lib/db/types';
  import { copyPng, downloadBlob } from '../../lib/exportFile';
  import {
    decodeToCanvas,
    DecodeError,
    detectKind,
    encodeCanvas,
    formatBytes,
    outputFilename,
    TARGETS,
    targetsFor,
    type DecodedImage,
    type TargetFormat,
  } from '../../lib/img/convert';

  // Session-only pipeline: the image never touches IndexedDB (binary data
  // can't round-trip the JSON data layer) — the only write this tool ever
  // makes is remembering the JPG quality default.
  let file = $state<File | null>(null);
  let decoded = $state<DecodedImage | null>(null);
  let decodeErr = $state<string | null>(null);
  let svgWidth = $state(1024);
  let target = $state<TargetFormat>('png');
  let quality = $state(85);
  let busy = $state(false);

  let result = $state<{ blob: Blob; url: string; width: number; height: number } | null>(null);
  let feedback = $state<string | null>(null);
  let feedbackTimer: ReturnType<typeof setTimeout> | undefined;

  onMount(async () => {
    const prefs = await getSingleton<Preferences>('preferences');
    if (typeof prefs?.convert_jpg_quality === 'number') quality = prefs.convert_jpg_quality;
  });

  let kind = $derived(file ? detectKind(file.name, file.type) : null);
  let targets = $derived(file ? targetsFor(file.name, file.type) : []);

  async function onPick(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0] ?? null;
    input.value = '';
    if (!f) return;
    file = f;
    decoded = null;
    decodeErr = null;
    const allowed = targetsFor(f.name, f.type);
    if (allowed.length > 0 && !allowed.includes(target)) target = allowed[0]!;
    await redecode();
  }

  async function redecode() {
    if (!file) return;
    busy = true;
    try {
      decoded = await decodeToCanvas(file, svgWidth);
      decodeErr = null;
    } catch (err) {
      decoded = null;
      decodeErr = err instanceof DecodeError ? err.message : 'Decoding failed.';
    } finally {
      busy = false;
    }
  }

  // Re-encode whenever the decoded image or the output knobs change.
  $effect(() => {
    const src = decoded;
    const t = target;
    const q = quality;
    if (!src) {
      setResult(null);
      return;
    }
    let stale = false;
    void encodeCanvas(src.canvas, t, q).then((blob) => {
      if (stale) return;
      setResult({ blob, url: URL.createObjectURL(blob), width: src.width, height: src.height });
    });
    return () => {
      stale = true;
    };
  });

  function setResult(next: { blob: Blob; url: string; width: number; height: number } | null) {
    if (result) URL.revokeObjectURL(result.url);
    result = next;
  }

  onDestroy(() => setResult(null));

  function rememberQuality() {
    void putSingleton<Partial<Preferences>>('preferences', { convert_jpg_quality: quality });
  }

  function flash(msg: string) {
    feedback = msg;
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => (feedback = null), 2000);
  }

  function download() {
    if (!result || !file) return;
    downloadBlob(result.blob, outputFilename(file.name, target));
    flash('Downloaded');
  }

  async function copyAsPng() {
    if (!decoded) return;
    // Clipboard images are ALWAYS PNG regardless of the chosen output.
    const png = await encodeCanvas(decoded.canvas, 'png', 100);
    flash((await copyPng(png)) ? 'Copied as PNG' : 'Copy failed — try downloading instead');
  }
</script>

<div class="page-header">
  <h1>Image converter</h1>
</div>

<div class="stack">
  <Card title="Input">
    <div class="stack">
      <div>
        <label for="ic-file">SVG, AVIF, WebP, TIFF, PNG or JPG</label>
        <input
          id="ic-file"
          data-testid="ic-file"
          type="file"
          accept=".svg,.avif,.webp,.tif,.tiff,.png,.jpg,.jpeg,image/svg+xml,image/avif,image/webp,image/tiff,image/png,image/jpeg"
          onchange={onPick}
        />
      </div>

      {#if file && kind === 'svg'}
        <div class="row">
          <label class="inline" for="ic-svg-width">Rasterize at width (px)</label>
          <input
            id="ic-svg-width"
            data-testid="ic-svg-width"
            class="num"
            type="number"
            min="16"
            max="8192"
            bind:value={svgWidth}
            onchange={redecode}
          />
        </div>
      {/if}

      {#if decodeErr}
        <p class="error" data-testid="ic-error" role="alert">{decodeErr}</p>
      {:else if busy}
        <p class="muted" aria-live="polite">Decoding…</p>
      {:else if file && decoded}
        <p class="muted small" data-testid="ic-input-info">
          {file.name} · {formatBytes(file.size)} · {decoded.width} × {decoded.height}px
        </p>
      {/if}
    </div>
  </Card>

  {#if decoded && file}
    <Card title="Output">
      <div class="stack">
        <div class="row">
          <div>
            <label for="ic-target">Format</label>
            <select id="ic-target" data-testid="ic-target" bind:value={target}>
              {#each TARGETS.filter((t) => targets.includes(t.id)) as t (t.id)}
                <option value={t.id}>{t.label}</option>
              {/each}
            </select>
          </div>
          {#if target === 'jpg'}
            <div>
              <label for="ic-quality">JPG quality ({quality})</label>
              <input
                id="ic-quality"
                data-testid="ic-quality"
                type="number"
                class="num"
                min="1"
                max="100"
                bind:value={quality}
                onchange={rememberQuality}
              />
            </div>
          {/if}
        </div>

        {#if result}
          <img class="preview" alt="Converted output preview" src={result.url} />
          <p class="muted small" data-testid="ic-output-info">
            {outputFilename(file.name, target)} · {formatBytes(result.blob.size)} ·
            {result.width} × {result.height}px
          </p>
          <div class="row">
            <button class="btn btn-primary" data-testid="ic-download" onclick={download}>Download</button>
            <button class="btn" data-testid="ic-copy" onclick={copyAsPng}>Copy (always PNG)</button>
          </div>
          <p class="muted small" aria-live="polite" data-testid="ic-feedback">{feedback ?? ''}</p>
        {/if}
      </div>
    </Card>
  {/if}

  <Explainer summary="Why no WebP or AVIF output?" testid="explainer-convert">
    <p>
      Browsers decode WebP and AVIF natively, but canvas ENCODING support for them
      is patchy — so this tool only writes the two formats every browser encodes
      reliably: PNG (lossless, transparency) and JPG (small, opaque — transparent
      areas are flattened onto white). Conversion happens entirely on this device;
      nothing is uploaded.
    </p>
    <p>
      TIFF decoding uses a small bundled decoder and politely refuses exotic
      compression variants. Clipboard copies are always PNG — the async clipboard
      API accepts nothing else.
    </p>
  </Explainer>
</div>

<style>
  .num {
    width: 6.5rem;
  }

  .inline {
    display: inline;
    margin-bottom: 0;
  }

  .small {
    font-size: var(--font-size-sm);
  }

  .error {
    color: var(--color-danger);
    font-size: var(--font-size-sm);
  }

  .preview {
    max-width: min(20rem, 100%);
    max-height: 14rem;
    width: auto;
    border: 1.5px solid var(--border-strong-color);
    /* Checkerboard so transparency is visible. */
    background:
      repeating-conic-gradient(var(--border-color) 0% 25%, transparent 0% 50%)
      0 0 / 16px 16px;
  }
</style>
