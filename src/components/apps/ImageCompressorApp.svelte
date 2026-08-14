<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import Card from '../Card.svelte';
  import { getSingleton, putSingleton } from '../../lib/db/repo';
  import type { Preferences } from '../../lib/db/types';
  import { copyPng, downloadBlob } from '../../lib/exportFile';
  import {
    capDimensions,
    decodeToCanvas,
    DecodeError,
    encodeCanvas,
    formatBytes,
    outputFilename,
    scaleCanvas,
    type DecodedImage,
    type TargetFormat,
  } from '../../lib/img/convert';

  // Session-only (no IndexedDB) apart from remembering the JPG quality.
  let file = $state<File | null>(null);
  let decoded = $state<DecodedImage | null>(null);
  let decodeErr = $state<string | null>(null);

  let format = $state<TargetFormat>('jpg'); // follows the input
  let quality = $state(75);
  /** Optional dimension cap — a number input binds number | null (blank). */
  let maxEdge = $state<number | null>(null);

  let result = $state<{ blob: Blob; url: string; width: number; height: number } | null>(null);
  let feedback = $state<string | null>(null);
  let feedbackTimer: ReturnType<typeof setTimeout> | undefined;

  onMount(async () => {
    const prefs = await getSingleton<Preferences>('preferences');
    if (typeof prefs?.convert_jpg_quality === 'number') quality = prefs.convert_jpg_quality;
  });

  async function onPick(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0] ?? null;
    input.value = '';
    if (!f) return;
    file = f;
    decodeErr = null;
    format = /\.png$/i.test(f.name) ? 'png' : 'jpg';
    try {
      decoded = await decodeToCanvas(f);
    } catch (err) {
      decoded = null;
      decodeErr = err instanceof DecodeError ? err.message : 'Decoding failed.';
    }
  }

  let cap = $derived(
    typeof maxEdge === 'number' && Number.isFinite(maxEdge) && maxEdge > 0
      ? Math.round(maxEdge)
      : null
  );

  $effect(() => {
    const src = decoded;
    const q = quality;
    const f = format;
    const edge = cap;
    if (!src) {
      setResult(null);
      return;
    }
    let stale = false;
    const dims = capDimensions(src.width, src.height, edge);
    const scaled = scaleCanvas(src.canvas, dims.width, dims.height);
    void encodeCanvas(scaled, f, q).then((blob) => {
      if (stale) return;
      setResult({ blob, url: URL.createObjectURL(blob), width: dims.width, height: dims.height });
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

  let savings = $derived.by(() => {
    if (!file || !result) return null;
    const delta = 1 - result.blob.size / file.size;
    return Math.round(delta * 100);
  });

  function flash(msg: string) {
    feedback = msg;
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => (feedback = null), 2000);
  }

  function download() {
    if (!result || !file) return;
    downloadBlob(result.blob, outputFilename(file.name, format));
    flash('Downloaded');
  }

  async function copyAsPng() {
    if (!decoded) return;
    const dims = capDimensions(decoded.width, decoded.height, cap);
    const png = await encodeCanvas(scaleCanvas(decoded.canvas, dims.width, dims.height), 'png', 100);
    flash((await copyPng(png)) ? 'Copied as PNG' : 'Copy failed — try downloading instead');
  }
</script>

<div class="page-header">
  <h1>Image compressor</h1>
</div>

<div class="stack">
  <Card title="Input">
    <div class="stack">
      <div>
        <label for="cp-file">PNG or JPG</label>
        <input
          id="cp-file"
          data-testid="cp-file"
          type="file"
          accept=".png,.jpg,.jpeg,image/png,image/jpeg"
          onchange={onPick}
        />
      </div>
      {#if decodeErr}
        <p class="error" data-testid="cp-error" role="alert">{decodeErr}</p>
      {:else if file && decoded}
        <p class="muted small" data-testid="cp-input-info">
          {file.name} · {formatBytes(file.size)} · {decoded.width} × {decoded.height}px
        </p>
      {/if}
    </div>
  </Card>

  {#if decoded && file}
    <Card title="Compress">
      <div class="stack">
        <div class="row">
          {#if format === 'jpg'}
            <div>
              <label for="cp-quality">JPG quality ({quality})</label>
              <input id="cp-quality" data-testid="cp-quality" class="num" type="number" min="1" max="100"
                bind:value={quality} onchange={rememberQuality} />
            </div>
          {/if}
          <div>
            <label for="cp-max-edge">Cap longest edge (px, optional)</label>
            <input id="cp-max-edge" data-testid="cp-max-edge" class="num" type="number" min="16"
              placeholder="off" bind:value={maxEdge} />
          </div>
        </div>

        {#if result}
          <div class="sizes" data-testid="cp-sizes">
            <div class="line">
              <span class="eyebrow">Before</span>
              <p>{formatBytes(file.size)} · {decoded.width} × {decoded.height}px</p>
            </div>
            <div class="line">
              <span class="eyebrow">After</span>
              <p data-testid="cp-after">
                {formatBytes(result.blob.size)} · {result.width} × {result.height}px
                {#if savings !== null}
                  <span class:good={savings > 0} class:bad={savings < 0} data-testid="cp-savings">
                    ({savings > 0 ? '−' : '+'}{Math.abs(savings)}%)
                  </span>
                {/if}
              </p>
            </div>
          </div>
          <div class="row">
            <button class="btn btn-primary" data-testid="cp-download" onclick={download}>Download</button>
            <button class="btn" data-testid="cp-copy" onclick={copyAsPng}>Copy (always PNG)</button>
          </div>
          <p class="muted small" aria-live="polite" data-testid="cp-feedback">{feedback ?? ''}</p>
        {/if}
      </div>
    </Card>
  {/if}
</div>

<style>
  .num {
    width: 8rem;
  }

  .small {
    font-size: var(--font-size-sm);
  }

  .error {
    color: var(--color-danger);
    font-size: var(--font-size-sm);
  }

  .sizes {
    display: flex;
    gap: var(--space-5);
    flex-wrap: wrap;
  }

  .line p {
    font-weight: 600;
  }

  .good {
    color: var(--color-success);
  }

  .bad {
    color: var(--color-warning);
  }
</style>
