<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import QrScanner from 'qr-scanner';
  import Card from '../Card.svelte';
  import Explainer from '../Explainer.svelte';
  import { EC_LEVELS, QR_SIZES, qrColorWarning, qrPngDataUrl, qrSvg, type EcLevel } from '../../lib/gen/qr';
  import { copyPng, copyText, dataUrlToBlob, downloadDataUrl, downloadText } from '../../lib/exportFile';

  /* ------------------------------------------------------------ create --- */
  // Stateless tool — nothing here ever touches IndexedDB.
  let text = $state('https://example.com/');
  let size = $state(256);
  let ecLevel = $state<EcLevel>('M');
  let darkColor = $state('#000000');
  let lightColor = $state('#ffffff');

  let svg = $state('');
  let createError = $state<string | null>(null);

  let colorWarning = $derived(qrColorWarning(darkColor, lightColor));

  $effect(() => {
    const t = text;
    const s = size;
    const e = ecLevel;
    const dark = darkColor;
    const light = lightColor;
    if (t.trim().length === 0) {
      svg = '';
      createError = 'Enter text or a URL to encode.';
      return;
    }
    let stale = false;
    qrSvg(t, { size: s, ecLevel: e, dark, light })
      .then((v) => {
        if (stale) return;
        svg = v;
        createError = null;
      })
      .catch((err: unknown) => {
        if (stale) return;
        svg = '';
        createError = err instanceof Error ? err.message : String(err);
      });
    return () => {
      stale = true;
    };
  });

  let feedback = $state<string | null>(null);
  let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
  function flash(message: string) {
    feedback = message;
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => (feedback = null), 2000);
  }

  function downloadSvg() {
    downloadText(svg, 'qr-code.svg', 'image/svg+xml');
    flash('SVG downloaded');
  }

  async function downloadPng() {
    downloadDataUrl(
      await qrPngDataUrl(text, { size, ecLevel, dark: darkColor, light: lightColor }),
      'qr-code.png'
    );
    flash('PNG downloaded');
  }

  async function copySvgText() {
    flash((await copyText(svg)) ? 'SVG copied as text' : 'Copy failed');
  }

  async function copyPngImage() {
    // Clipboard images are always PNG (the shared pipeline's convention).
    const dataUrl = await qrPngDataUrl(text, { size, ecLevel, dark: darkColor, light: lightColor });
    flash((await copyPng(dataUrlToBlob(dataUrl))) ? 'PNG copied' : 'Copy failed — try downloading instead');
  }

  /* -------------------------------------------------------------- read --- */
  let hasCamera = $state(false);
  let scanning = $state(false);
  let decoded = $state<string | null>(null);
  let readError = $state<string | null>(null);
  let videoEl: HTMLVideoElement | undefined = $state();
  let scanner: QrScanner | null = null;
  let uploadEl: HTMLInputElement | undefined = $state();

  onMount(() => {
    // Feature detection only — no permission prompt until the user asks.
    QrScanner.hasCamera().then((v) => (hasCamera = v)).catch(() => (hasCamera = false));
  });

  async function onUpload() {
    const file = uploadEl?.files?.[0];
    if (!file) return;
    try {
      const result = await QrScanner.scanImage(file, { returnDetailedScanResult: true });
      decoded = result.data;
      readError = null;
    } catch {
      decoded = null;
      readError = 'No QR code found in that image.';
    } finally {
      if (uploadEl) uploadEl.value = ''; // same file can be re-picked
    }
  }

  async function startCamera() {
    if (!videoEl || scanning) return;
    scanning = true;
    readError = null;
    try {
      // Permission is requested here, from the click — never on page load.
      scanner = new QrScanner(
        videoEl,
        (result) => {
          decoded = result.data;
          readError = null;
          stopCamera();
        },
        { returnDetailedScanResult: true, highlightScanRegion: true }
      );
      await scanner.start();
    } catch {
      stopCamera();
      readError = 'Camera unavailable or permission denied — upload an image instead.';
    }
  }

  function stopCamera() {
    scanner?.stop();
    scanner?.destroy();
    scanner = null;
    scanning = false;
  }

  onDestroy(stopCamera);

  // Clickable only for http(s) — and NEVER auto-opened.
  let decodedLink = $derived(
    decoded !== null && /^https?:\/\//i.test(decoded.trim()) ? decoded.trim() : null
  );
</script>

<div class="page-header">
  <h1>QR code</h1>
</div>

<div class="stack">
  <Card title="Create">
    <div class="stack">
      <div>
        <label for="qr-text">Text or URL</label>
        <input
          id="qr-text"
          data-testid="qr-text"
          type="text"
          autocomplete="off"
          spellcheck="false"
          bind:value={text}
        />
      </div>
      <div class="row">
        <div>
          <label for="qr-size">Size (px)</label>
          <select id="qr-size" data-testid="qr-size" bind:value={size}>
            {#each QR_SIZES as s (s)}
              <option value={s}>{s} × {s}</option>
            {/each}
          </select>
        </div>
        <div>
          <label for="qr-ec">Error correction</label>
          <select id="qr-ec" data-testid="qr-ec" bind:value={ecLevel}>
            {#each EC_LEVELS as level (level.id)}
              <option value={level.id}>{level.label}</option>
            {/each}
          </select>
        </div>
        <div>
          <label for="qr-dark">Code color</label>
          <input id="qr-dark" data-testid="qr-dark" type="color" bind:value={darkColor} />
        </div>
        <div>
          <label for="qr-light">Background</label>
          <input id="qr-light" data-testid="qr-light" type="color" bind:value={lightColor} />
        </div>
      </div>

      {#if colorWarning}
        <p class="warn" data-testid="qr-color-warning">⚠ {colorWarning}</p>
      {/if}

      {#if createError}
        <p class="error" data-testid="qr-create-error" role="alert">{createError}</p>
      {:else if svg}
        <div class="qr-preview" data-testid="qr-preview" style={`background: ${lightColor}`}>{@html svg}</div>
        <div class="row">
          <button class="btn btn-primary" data-testid="qr-download-png" onclick={downloadPng}>Download PNG</button>
          <button class="btn" data-testid="qr-download-svg" onclick={downloadSvg}>Download SVG</button>
          <button class="btn" data-testid="qr-copy-png" onclick={copyPngImage}>Copy PNG</button>
          <button class="btn" data-testid="qr-copy-svg" onclick={copySvgText}>Copy SVG text</button>
        </div>
        <p class="muted small" aria-live="polite" data-testid="qr-feedback">{feedback ?? ''}</p>
      {/if}
    </div>
  </Card>

  <Card title="Read">
    <div class="stack">
      <div class="row">
        <div>
          <label for="qr-upload">Upload an image</label>
          <input
            id="qr-upload"
            data-testid="qr-upload"
            type="file"
            accept="image/*"
            bind:this={uploadEl}
            onchange={onUpload}
          />
        </div>
        {#if hasCamera}
          {#if !scanning}
            <button class="btn" data-testid="qr-camera" onclick={startCamera}>Scan with camera</button>
          {:else}
            <button class="btn" data-testid="qr-camera-stop" onclick={stopCamera}>Stop camera</button>
          {/if}
        {:else}
          <p class="muted small" data-testid="qr-no-camera">
            No camera detected — upload an image instead.
          </p>
        {/if}
      </div>

      <!-- Live camera preview with no audio track, so no captions to offer. -->
      <!-- svelte-ignore a11y_media_has_caption -->
      <video class="camera" class:active={scanning} bind:this={videoEl} data-testid="qr-video"></video>

      {#if readError}
        <p class="error" data-testid="qr-read-error" role="alert">{readError}</p>
      {/if}
      {#if decoded !== null}
        <div class="decoded">
          <span class="eyebrow">Decoded</span>
          <p class="mono" data-testid="qr-result">{decoded}</p>
          {#if decodedLink}
            <a
              data-testid="qr-result-link"
              href={decodedLink}
              target="_blank"
              rel="noopener noreferrer"
            >Open link ↗</a>
          {/if}
        </div>
      {/if}
    </div>
  </Card>

  <Explainer summary="Error correction, offline reading" testid="explainer-qr">
    <p>
      Higher error-correction levels add redundancy, so a scuffed or partially
      covered code still scans — at the cost of a denser grid. M is the everyday
      default; use H for codes that get printed small or laminated.
    </p>
    <p>
      Reading happens entirely on this device (native barcode detector where the
      browser has one, a bundled decoder elsewhere) — images never leave your
      machine, and decoded links are shown but never opened automatically.
    </p>
  </Explainer>
</div>

<style>
  .qr-preview {
    width: min(16rem, 100%);
    border: 1.5px solid var(--border-strong-color);
    padding: var(--space-2);
  }

  .qr-preview :global(svg) {
    display: block;
    width: 100%;
    height: auto;
  }

  .row > div {
    min-width: 11rem;
  }

  .camera {
    display: none;
    width: min(24rem, 100%);
    border: 1.5px solid var(--border-strong-color);
    background: #000;
  }

  .camera.active {
    display: block;
  }

  .decoded .mono {
    font-family: var(--font-mono, ui-monospace, monospace);
    overflow-wrap: anywhere;
    font-weight: 600;
  }

  .error {
    color: var(--color-danger);
    font-size: var(--font-size-sm);
  }

  .small {
    font-size: var(--font-size-sm);
  }
</style>
