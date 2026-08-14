<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import Card from '../Card.svelte';
  import { getSingleton, putSingleton } from '../../lib/db/repo';
  import type { Preferences } from '../../lib/db/types';
  import { copyPng, downloadBlob } from '../../lib/exportFile';
  import {
    decodeToCanvas,
    DecodeError,
    encodeCanvas,
    formatBytes,
    outputFilename,
    percentDimensions,
    scaleCanvas,
    type DecodedImage,
    type TargetFormat,
  } from '../../lib/img/convert';

  // Session-only (no IndexedDB) apart from remembering the JPG quality.
  let file = $state<File | null>(null);
  let decoded = $state<DecodedImage | null>(null);
  let decodeErr = $state<string | null>(null);

  let mode = $state<'dimensions' | 'percent'>('dimensions');
  let width = $state(0);
  let height = $state(0);
  let lock = $state(true);
  let percent = $state(50);
  let target = $state<TargetFormat>('png');
  let quality = $state(85);

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
    try {
      decoded = await decodeToCanvas(f);
      width = decoded.width;
      height = decoded.height;
      target = /\.jpe?g$/i.test(f.name) ? 'jpg' : 'png';
    } catch (err) {
      decoded = null;
      decodeErr = err instanceof DecodeError ? err.message : 'Decoding failed.';
    }
  }

  function setWidth(v: number) {
    width = Math.max(1, Math.round(v));
    if (lock && decoded) height = Math.max(1, Math.round((width * decoded.height) / decoded.width));
  }

  function setHeight(v: number) {
    height = Math.max(1, Math.round(v));
    if (lock && decoded) width = Math.max(1, Math.round((height * decoded.width) / decoded.height));
  }

  let outSize = $derived.by(() => {
    if (!decoded) return null;
    if (mode === 'percent') return percentDimensions(decoded.width, decoded.height, percent);
    return { width: Math.max(1, width), height: Math.max(1, height) };
  });

  $effect(() => {
    const src = decoded;
    const dims = outSize;
    const t = target;
    const q = quality;
    if (!src || !dims) {
      setResult(null);
      return;
    }
    let stale = false;
    const scaled = scaleCanvas(src.canvas, dims.width, dims.height);
    void encodeCanvas(scaled, t, q).then((blob) => {
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
    if (!decoded || !outSize) return;
    const png = await encodeCanvas(scaleCanvas(decoded.canvas, outSize.width, outSize.height), 'png', 100);
    flash((await copyPng(png)) ? 'Copied as PNG' : 'Copy failed — try downloading instead');
  }
</script>

<div class="page-header">
  <h1>Image resizer</h1>
</div>

<div class="stack">
  <Card title="Input">
    <div class="stack">
      <div>
        <label for="ir-file">PNG, JPG, WebP or AVIF</label>
        <input
          id="ir-file"
          data-testid="ir-file"
          type="file"
          accept=".png,.jpg,.jpeg,.webp,.avif,image/png,image/jpeg,image/webp,image/avif"
          onchange={onPick}
        />
      </div>
      {#if decodeErr}
        <p class="error" data-testid="ir-error" role="alert">{decodeErr}</p>
      {:else if file && decoded}
        <p class="muted small" data-testid="ir-input-info">
          {file.name} · {formatBytes(file.size)} · {decoded.width} × {decoded.height}px
        </p>
      {/if}
    </div>
  </Card>

  {#if decoded && file}
    <Card title="Resize">
      <div class="stack">
        <div class="row">
          <label class="check">
            <input type="radio" name="ir-mode" value="dimensions" data-testid="ir-mode-dimensions" bind:group={mode} />
            Dimensions
          </label>
          <label class="check">
            <input type="radio" name="ir-mode" value="percent" data-testid="ir-mode-percent" bind:group={mode} />
            Percentage
          </label>
        </div>

        {#if mode === 'dimensions'}
          <div class="row">
            <div>
              <label for="ir-width">Width (px)</label>
              <input id="ir-width" data-testid="ir-width" class="num" type="number" min="1" value={width}
                oninput={(e) => setWidth(Number(e.currentTarget.value))} />
            </div>
            <div>
              <label for="ir-height">Height (px)</label>
              <input id="ir-height" data-testid="ir-height" class="num" type="number" min="1" value={height}
                oninput={(e) => setHeight(Number(e.currentTarget.value))} />
            </div>
            <label class="check lock">
              <input type="checkbox" data-testid="ir-lock" bind:checked={lock} />
              Lock aspect ratio
            </label>
          </div>
        {:else}
          <div class="row">
            <label class="inline" for="ir-percent">Scale to</label>
            <input id="ir-percent" data-testid="ir-percent" class="num" type="number" min="1" max="1000" bind:value={percent} />
            <span class="muted">%</span>
          </div>
        {/if}

        <div class="row">
          <div>
            <label for="ir-target">Format</label>
            <select id="ir-target" data-testid="ir-target" bind:value={target}>
              <option value="png">PNG</option>
              <option value="jpg">JPG</option>
            </select>
          </div>
          {#if target === 'jpg'}
            <div>
              <label for="ir-quality">JPG quality ({quality})</label>
              <input id="ir-quality" data-testid="ir-quality" class="num" type="number" min="1" max="100"
                bind:value={quality} onchange={rememberQuality} />
            </div>
          {/if}
        </div>

        {#if result}
          <p class="muted small" data-testid="ir-output-info">
            {result.width} × {result.height}px · {formatBytes(result.blob.size)}
          </p>
          <div class="row">
            <button class="btn btn-primary" data-testid="ir-download" onclick={download}>Download</button>
            <button class="btn" data-testid="ir-copy" onclick={copyAsPng}>Copy (always PNG)</button>
          </div>
          <p class="muted small" aria-live="polite" data-testid="ir-feedback">{feedback ?? ''}</p>
        {/if}
      </div>
    </Card>
  {/if}
</div>

<style>
  .num {
    width: 6.5rem;
  }

  .inline {
    display: inline;
    margin-bottom: 0;
  }

  .check {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--text-color);
    font-size: var(--font-size-base);
    text-transform: none;
    letter-spacing: normal;
    margin-bottom: 0;
  }

  .lock {
    align-self: end;
    margin-bottom: var(--space-2);
  }

  .small {
    font-size: var(--font-size-sm);
  }

  .error {
    color: var(--color-danger);
    font-size: var(--font-size-sm);
  }
</style>
