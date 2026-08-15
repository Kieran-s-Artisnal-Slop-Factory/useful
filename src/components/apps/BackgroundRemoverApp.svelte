<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import Card from '../Card.svelte';
  import Explainer from '../Explainer.svelte';
  import { copyPng, downloadBlob } from '../../lib/exportFile';
  import { href } from '../../lib/paths';
  import {
    decodeToCanvas,
    DecodeError,
    encodeCanvas,
    formatBytes,
    outputFilename,
    type DecodedImage,
    type TargetFormat,
  } from '../../lib/img/convert';
  import { applyMaskToCanvas, computeMask, maskToCanvas, parseHexColor } from '../../lib/bg/canvas';
  import { refineMask } from '../../lib/bg/pipeline';
  import {
    assetsReady,
    BG_TOTAL_BYTES,
    clearAssets,
    type DownloadProgress,
  } from '../../lib/bg/runtime';

  // Session-only and write-free: the pixels never touch IndexedDB, and this
  // tool has no preferences of its own — the whole page performs zero writes.
  let file = $state<File | null>(null);
  let decoded = $state<DecodedImage | null>(null);
  let decodeErr = $state<string | null>(null);

  /** The model's raw 0..1 mask at full image resolution (kept, so the cleanup
   * sliders re-tune the cut-out without another inference pass). */
  let mask = $state<Float32Array | null>(null);
  let running = $state(false);
  let runError = $state<string | null>(null);
  let elapsedMs = $state<number | null>(null);

  let assets = $state<'checking' | 'missing' | 'ready'>('checking');
  let progress = $state<DownloadProgress | null>(null);

  let cutoff = $state(0);
  let feather = $state(0);
  let bgMode = $state<'transparent' | 'color'>('transparent');
  let bgColor = $state('#ffffff');
  let showMask = $state(false);

  let format = $state<TargetFormat>('png');
  let quality = $state(90);

  let previewCanvas = $state<HTMLCanvasElement | null>(null);
  let feedback = $state<string | null>(null);
  let feedbackTimer: ReturnType<typeof setTimeout> | undefined;

  onMount(async () => {
    assets = (await assetsReady()) ? 'ready' : 'missing';
  });

  onDestroy(() => clearTimeout(feedbackTimer));

  function flash(msg: string) {
    feedback = msg;
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => (feedback = null), 2500);
  }

  async function onPick(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0] ?? null;
    input.value = '';
    if (!f) return;
    file = f;
    mask = null;
    runError = null;
    elapsedMs = null;
    decodeErr = null;
    format = /\.png$/i.test(f.name) ? 'png' : 'jpg';
    try {
      decoded = await decodeToCanvas(f);
    } catch (err) {
      decoded = null;
      decodeErr = err instanceof DecodeError ? err.message : 'Decoding failed.';
    }
  }

  /** Download (or verify) the model + runtime without running anything. */
  async function download() {
    running = true;
    runError = null;
    try {
      const { loadAssets } = await import('../../lib/bg/runtime');
      await loadAssets((p) => (progress = p));
      // Also pull ORT's own (small) JS chunk while we are demonstrably online:
      // the service worker caches it on the way past, so "downloaded for
      // offline use" covers every piece a later run needs, not just the big
      // two. Nothing is instantiated here — that waits for a real run.
      await import('onnxruntime-web/wasm');
      assets = (await assetsReady()) ? 'ready' : 'missing';
      flash('Model ready — this tool now works offline');
    } catch (err) {
      runError = err instanceof Error ? err.message : 'Download failed.';
    } finally {
      progress = null;
      running = false;
    }
  }

  async function removeDownload() {
    await clearAssets();
    assets = 'missing';
    flash('Downloaded model removed');
  }

  async function run() {
    if (!decoded || running) return;
    running = true;
    runError = null;
    const started = performance.now();
    try {
      mask = await computeMask(decoded.canvas, (p) => (progress = p));
      elapsedMs = Math.round(performance.now() - started);
      assets = (await assetsReady()) ? 'ready' : 'missing';
    } catch (err) {
      mask = null;
      runError =
        err instanceof Error
          ? `Background removal failed: ${err.message}`
          : 'Background removal failed.';
    } finally {
      progress = null;
      running = false;
    }
  }

  let background = $derived(bgMode === 'color' ? parseHexColor(bgColor) : null);

  /** The finished cut-out. Rebuilt whenever the mask or a knob changes —
   * cheap enough to be live, and never encoded until an export is asked for. */
  let output = $derived.by(() => {
    const src = decoded;
    const m = mask;
    if (!src || !m) return null;
    if (showMask) {
      return maskToCanvas(
        refineMask(m, src.width, src.height, { cutoff, feather }),
        src.width,
        src.height,
        'grey'
      );
    }
    return applyMaskToCanvas(src.canvas, m, { cutoff, feather }, background);
  });

  /** How much of the picture the mask keeps — the honest one-number summary. */
  let kept = $derived.by(() => {
    const src = decoded;
    const m = mask;
    if (!src || !m) return null;
    const refined = refineMask(m, src.width, src.height, { cutoff, feather });
    let sum = 0;
    for (let i = 0; i < refined.length; i++) sum += refined[i]!;
    return Math.round((sum / refined.length) * 100);
  });

  // Paint the preview straight onto a canvas; encoding a blob on every slider
  // nudge would burn seconds on a large photo for no benefit.
  $effect(() => {
    const target = previewCanvas;
    const src = output ?? decoded?.canvas ?? null;
    if (!target || !src) return;
    target.width = src.width;
    target.height = src.height;
    const ctx = target.getContext('2d')!;
    ctx.clearRect(0, 0, target.width, target.height);
    ctx.drawImage(src, 0, 0);
  });

  async function exportBlob(): Promise<Blob | null> {
    if (!output) return null;
    return await encodeCanvas(output, format, quality);
  }

  async function downloadOutput() {
    const blob = await exportBlob();
    if (!blob || !file) return;
    downloadBlob(blob, outputFilename(file.name, format).replace(/\.(png|jpg)$/i, '-no-bg.$1'));
    flash(`Downloaded (${formatBytes(blob.size)})`);
  }

  async function copyOutput() {
    if (!output) return;
    const png = await encodeCanvas(output, 'png', 100);
    flash((await copyPng(png)) ? 'Copied as PNG' : 'Copy failed — try downloading instead');
  }

  let sizeLabel = $derived(formatBytes(BG_TOTAL_BYTES));
</script>

<div class="page-header">
  <h1>Background remover</h1>
</div>

<div class="stack">
  <Card title="Model">
    <div class="stack">
      <p class="muted small" data-testid="bg-state">
        {#if assets === 'checking'}
          Checking for a downloaded model…
        {:else if assets === 'ready'}
          Ready — the model is cached, so this tool works offline.
        {:else}
          Not downloaded. The first run fetches {sizeLabel} (segmentation model + runtime).
        {/if}
      </p>
      <div class="row">
        {#if assets !== 'ready'}
          <button class="btn" data-testid="bg-download" onclick={download} disabled={running}>
            Download model ({sizeLabel}) for offline use
          </button>
        {:else}
          <button class="btn" data-testid="bg-remove-download" onclick={removeDownload} disabled={running}>
            Remove downloaded model
          </button>
        {/if}
      </div>
      {#if progress}
        <div class="progress" data-testid="bg-progress">
          <progress max="1" value={progress.ratio}></progress>
          <span class="small" aria-live="polite">
            {progress.label} · {formatBytes(progress.received)} / {formatBytes(progress.total)}
          </span>
        </div>
      {/if}
      <Explainer summary="Where does this run, and what gets downloaded?">
        <p>
          Everything happens in this browser tab — the picture is never uploaded anywhere. The
          download is two self-hosted files served by this app: the U²-Net (small) segmentation
          model, Apache-2.0 licensed, and ONNX Runtime Web's WebAssembly build, MIT licensed.
          They are kept out of the app's install cache so a normal install stays small, and
          stored in their own cache the first time you use this tool, which is why one online
          visit is enough to make it work offline afterwards.
        </p>
        <p>
          The model is a general "salient object" detector: it finds the subject a photo is
          about. Fine detail like flyaway hair, glass, and low-contrast edges is where it
          struggles — clean those up with the eraser and brush in the
          <a href={href('/tools/image-editor/')}>image editor</a>, which can also remove
          backgrounds per layer.
        </p>
      </Explainer>
    </div>
  </Card>

  <Card title="Image">
    <div class="stack">
      <div>
        <label for="bg-file">Picture</label>
        <input
          id="bg-file"
          data-testid="bg-file"
          type="file"
          accept=".png,.jpg,.jpeg,.webp,.avif,image/png,image/jpeg,image/webp,image/avif"
          onchange={onPick}
        />
      </div>
      {#if decodeErr}
        <p class="error" data-testid="bg-error" role="alert">{decodeErr}</p>
      {:else if file && decoded}
        <p class="muted small" data-testid="bg-input-info">
          {file.name} · {formatBytes(file.size)} · {decoded.width} × {decoded.height}px
        </p>
        <div class="row">
          <button class="btn btn-primary" data-testid="bg-run" onclick={run} disabled={running}>
            {running ? 'Working…' : mask ? 'Run again' : 'Remove background'}
          </button>
          {#if running && !progress}
            <span class="small" aria-live="polite" data-testid="bg-running">
              Running the model — a big picture can take a few seconds.
            </span>
          {/if}
        </div>
      {/if}
      {#if runError}
        <p class="error" data-testid="bg-run-error" role="alert">{runError}</p>
      {/if}
    </div>
  </Card>

  {#if decoded}
    <Card title="Result">
      <div class="stack">
        {#if mask}
          <div class="row">
            <div>
              <label for="bg-cutoff">Cut off faint edges ({cutoff}%)</label>
              <input
                id="bg-cutoff"
                data-testid="bg-cutoff"
                type="range"
                min="0"
                max="90"
                bind:value={cutoff}
              />
            </div>
            <div>
              <label for="bg-feather">Soften edge ({feather}px)</label>
              <input
                id="bg-feather"
                data-testid="bg-feather"
                type="range"
                min="0"
                max="8"
                bind:value={feather}
              />
            </div>
            <div>
              <label for="bg-mode">Background</label>
              <select id="bg-mode" data-testid="bg-mode" bind:value={bgMode}>
                <option value="transparent">Transparent</option>
                <option value="color">Solid colour</option>
              </select>
            </div>
            {#if bgMode === 'color'}
              <div>
                <label for="bg-color">Colour</label>
                <input id="bg-color" data-testid="bg-color" type="color" bind:value={bgColor} />
              </div>
            {/if}
          </div>
          <label class="check">
            <input type="checkbox" data-testid="bg-show-mask" bind:checked={showMask} />
            Show the mask instead of the cut-out
          </label>
          <p class="muted small" data-testid="bg-result-info">
            {decoded.width} × {decoded.height}px · {kept}% of the picture kept
            {#if elapsedMs !== null}· {(elapsedMs / 1000).toFixed(1)}s{/if}
          </p>
        {:else}
          <p class="muted small">Run the model to see the cut-out.</p>
        {/if}

        <div class="preview" class:checkered={!!mask && bgMode === 'transparent' && !showMask}>
          <canvas bind:this={previewCanvas} data-testid="bg-preview"></canvas>
        </div>

        {#if mask}
          <div class="row">
            <div>
              <label for="bg-format">Save as</label>
              <select id="bg-format" data-testid="bg-format" bind:value={format}>
                <option value="png">PNG (keeps transparency)</option>
                <option value="jpg">JPG (no transparency)</option>
              </select>
            </div>
            {#if format === 'jpg'}
              <div>
                <label for="bg-quality">JPG quality ({quality})</label>
                <input
                  id="bg-quality"
                  data-testid="bg-quality"
                  class="num"
                  type="number"
                  min="1"
                  max="100"
                  bind:value={quality}
                />
              </div>
            {/if}
          </div>
          {#if format === 'jpg' && bgMode === 'transparent'}
            <p class="muted small" data-testid="bg-jpg-note">
              JPG cannot store transparency — the removed background will come out white. Pick a
              solid colour above, or save as PNG.
            </p>
          {/if}
          <div class="row">
            <button class="btn btn-primary" data-testid="bg-save" onclick={downloadOutput}>
              Download
            </button>
            <button class="btn" data-testid="bg-copy" onclick={copyOutput}>Copy (always PNG)</button>
          </div>
        {/if}
        <p class="muted small" aria-live="polite" data-testid="bg-feedback">{feedback ?? ''}</p>
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

  .progress {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .progress progress {
    width: min(20rem, 100%);
  }

  .check {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--font-size-sm);
  }

  .preview {
    border: 1px solid var(--border-color);
    padding: var(--space-2);
    display: flex;
    justify-content: center;
  }

  /* The transparency checkerboard: without it a cut-out on the page
     background reads as "the background is still there, just pale". */
  .preview.checkered {
    background-image:
      linear-gradient(45deg, var(--border-color) 25%, transparent 25%),
      linear-gradient(-45deg, var(--border-color) 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, var(--border-color) 75%),
      linear-gradient(-45deg, transparent 75%, var(--border-color) 75%);
    background-size: 16px 16px;
    background-position: 0 0, 0 8px, 8px -8px, -8px 0;
  }

  .preview canvas {
    align-self: flex-start;
    max-width: 100%;
    height: auto;
    object-fit: contain;
  }
</style>
