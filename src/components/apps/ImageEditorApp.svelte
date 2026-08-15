<script lang="ts">
  import { onMount } from 'svelte';
  import Card from '../Card.svelte';
  import ColorField from '../ColorField.svelte';
  import Explainer from '../Explainer.svelte';
  import { copyPng, downloadBlob } from '../../lib/exportFile';
  import {
    DecodeError,
    decodeToCanvas,
    encodeCanvas,
    formatBytes,
    outputFilename,
    type TargetFormat,
  } from '../../lib/img/convert';
  import type { RasterLayer, RasterPoint, Rect, StrokeLayer, TextLayer } from '../../lib/raster/model';
  import { layerLabel } from '../../lib/raster/model';
  import {
    arrowLongEnough,
    clampRect,
    normalizeRect,
    rotateLayerCW,
    rotateRectCW,
    rotatedSize,
    shiftLayer,
  } from '../../lib/raster/transform';
  import { renderComposite } from '../../lib/raster/render';
  import {
    hasEditedFields,
    encodeJpegWithExif,
    summarizeExif,
    toDateInputValue,
    type ExifEditFields,
  } from '../../lib/raster/exif';

  // SESSION-ONLY workspace (plan §3.2): binary image data can't round-trip
  // the JSON data layer, so this tool NEVER touches IndexedDB — no repo
  // imports, no writes, nothing persisted. Leaving the page discards the
  // session; the data-integrity suite pins that at zero writes.

  type Tool = 'move' | 'crop' | 'brush' | 'eraser' | 'arrow' | 'text' | 'darken' | 'lighten' | 'blur';

  const TOOLS: { id: Tool; label: string }[] = [
    { id: 'move', label: 'Move' },
    { id: 'crop', label: 'Crop' },
    { id: 'brush', label: 'Brush' },
    { id: 'eraser', label: 'Eraser' },
    { id: 'arrow', label: 'Arrow' },
    { id: 'text', label: 'Text' },
    { id: 'darken', label: 'Darken' },
    { id: 'lighten', label: 'Lighten' },
    { id: 'blur', label: 'Blur' },
  ];

  // ---- session ----
  let file = $state<File | null>(null);
  let original = $state<HTMLCanvasElement | null>(null);
  let decodeErr = $state<string | null>(null);
  let quarter = $state(0);
  let crop = $state<Rect | null>(null);
  let layers = $state<RasterLayer[]>([]);
  let selectedId = $state<string | null>(null);

  // ---- tools ----
  let tool = $state<Tool>('brush');
  let toolColor = $state('#e11d48');
  let toolSize = $state(6);
  let textSize = $state(32);
  let textDraft = $state('Text');
  let adjustAmount = $state(50);
  let pendingCrop = $state<Rect | null>(null);
  let marquee = $state<{ a: RasterPoint; b: RasterPoint } | null>(null);

  // ---- metadata ----
  let exifRows = $state<{ tag: string; value: string }[]>([]);
  let metaMode = $state<'strip' | 'edit'>('strip');
  let exifFields = $state<ExifEditFields>({ artist: '', copyright: '', description: '', date: '' });

  // ---- export ----
  let exportFormat = $state<TargetFormat>('png');
  let quality = $state(85);
  let feedback = $state<string | null>(null);
  let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
  let busy = $state(false);

  let displayEl = $state<HTMLCanvasElement>();

  const docW = $derived(crop ? crop.w : original ? rotatedSize(original.width, original.height, quarter).w : 0);
  const docH = $derived(crop ? crop.h : original ? rotatedSize(original.width, original.height, quarter).h : 0);
  const selected = $derived(layers.find((l) => l.id === selectedId) ?? null);

  // Re-render the visible canvas whenever anything about the session changes.
  $effect(() => {
    const el = displayEl;
    const src = original;
    if (!el || !src) return;
    const comp = renderComposite(src, quarter, crop, layers);
    el.width = comp.width;
    el.height = comp.height;
    const ctx = el.getContext('2d')!;
    ctx.clearRect(0, 0, el.width, el.height);
    ctx.drawImage(comp, 0, 0);
    const rect = marquee ? normalizeRect(marquee.a, marquee.b) : pendingCrop;
    if (rect) {
      if (tool === 'crop' || pendingCrop) {
        // Dim everything outside the candidate crop.
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.fillRect(0, 0, el.width, rect.y);
        ctx.fillRect(0, rect.y, rect.x, rect.h);
        ctx.fillRect(rect.x + rect.w, rect.y, el.width - rect.x - rect.w, rect.h);
        ctx.fillRect(0, rect.y + rect.h, el.width, el.height - rect.y - rect.h);
      }
      const px = Math.max(1, el.width / (el.getBoundingClientRect().width || el.width));
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.lineWidth = 3 * px;
      ctx.setLineDash([6 * px, 4 * px]);
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5 * px;
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
      ctx.setLineDash([]);
    }
  });

  onMount(() => () => clearTimeout(feedbackTimer));

  // ---- import ---------------------------------------------------------------

  async function onPick(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0] ?? null;
    input.value = '';
    if (!f) return;
    busy = true;
    decodeErr = null;
    try {
      const decoded = await decodeToCanvas(f);
      file = f;
      original = decoded.canvas;
      quarter = 0;
      crop = null;
      layers = [];
      selectedId = null;
      pendingCrop = null;
      marquee = null;
      await readExif(f);
    } catch (err) {
      decodeErr = err instanceof DecodeError ? err.message : 'Decoding failed.';
    } finally {
      busy = false;
    }
  }

  async function readExif(f: File) {
    exifRows = [];
    exifFields = { artist: '', copyright: '', description: '', date: '' };
    try {
      const exifr = (await import('exifr')).default;
      const parsed = (await exifr.parse(f).catch(() => null)) as Record<string, unknown> | null;
      exifRows = summarizeExif(parsed);
      exifFields = {
        artist: typeof parsed?.Artist === 'string' ? parsed.Artist : '',
        copyright: typeof parsed?.Copyright === 'string' ? parsed.Copyright : '',
        description: typeof parsed?.ImageDescription === 'string' ? parsed.ImageDescription : '',
        date: toDateInputValue(parsed?.DateTimeOriginal ?? parsed?.CreateDate ?? parsed?.ModifyDate),
      };
    } catch {
      // Non-EXIF sources (PNG, SVG…) simply show an empty viewer.
    }
  }

  function clearSession() {
    if (layers.length > 0 && !confirm('Discard the current edits?')) return;
    file = null;
    original = null;
    layers = [];
    crop = null;
    quarter = 0;
    selectedId = null;
    pendingCrop = null;
    exifRows = [];
    decodeErr = null;
  }

  // ---- rotate / crop --------------------------------------------------------

  function rotateView(cwTurns: 1 | 3) {
    if (!original) return;
    pendingCrop = null;
    marquee = null;
    for (let k = 0; k < cwTurns; k++) {
      const rotSpace = rotatedSize(original.width, original.height, quarter);
      const dims = crop ? { w: crop.w, h: crop.h } : rotSpace;
      layers = layers.map((l) => rotateLayerCW(l, dims.w, dims.h));
      if (crop) crop = rotateRectCW(crop, rotSpace.w, rotSpace.h);
      quarter = (quarter + 1) % 4;
    }
  }

  function applyCrop() {
    if (!pendingCrop || !original) return;
    const r = clampRect(pendingCrop, docW, docH);
    crop = crop ? { x: crop.x + r.x, y: crop.y + r.y, w: r.w, h: r.h } : r;
    layers = layers.map((l) => shiftLayer(l, -r.x, -r.y));
    pendingCrop = null;
  }

  /** Undo crop + rotation without losing annotations. */
  function resetView() {
    if (!original) return;
    pendingCrop = null;
    marquee = null;
    if (crop) {
      const c = crop;
      layers = layers.map((l) => shiftLayer(l, c.x, c.y));
      crop = null;
    }
    let { w, h } = rotatedSize(original.width, original.height, quarter);
    const back = (4 - quarter) % 4;
    for (let k = 0; k < back; k++) {
      layers = layers.map((l) => rotateLayerCW(l, w, h));
      [w, h] = [h, w];
    }
    quarter = 0;
  }

  // ---- canvas pointer interactions ------------------------------------------

  let drawing: { mode: 'stroke' | 'arrow' | 'marquee' | 'move'; layerId?: string; last?: RasterPoint } | null = null;

  function toDoc(e: PointerEvent): RasterPoint {
    const el = displayEl!;
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(((e.clientX - r.left) / r.width) * el.width),
      y: Math.round(((e.clientY - r.top) / r.height) * el.height),
    };
  }

  /** Hit test for the move tool: text (estimated box) and arrows (near line). */
  function hitTest(p: RasterPoint): RasterLayer | null {
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i]!;
      if (l.kind === 'text') {
        const hw = Math.max(20, (l.text.length * l.size * 0.6) / 2);
        const hh = l.size / 2 + 6;
        if (Math.abs(p.x - l.x) <= hw && Math.abs(p.y - l.y) <= hh) return l;
      } else if (l.kind === 'arrow') {
        const { from, to } = l;
        const len2 = (to.x - from.x) ** 2 + (to.y - from.y) ** 2;
        const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - from.x) * (to.x - from.x) + (p.y - from.y) * (to.y - from.y)) / len2));
        const cx = from.x + t * (to.x - from.x);
        const cy = from.y + t * (to.y - from.y);
        if (Math.hypot(p.x - cx, p.y - cy) <= Math.max(10, l.size)) return l;
      }
    }
    return null;
  }

  function onPointerDown(e: PointerEvent) {
    if (!original || !displayEl) return;
    const p = toDoc(e);
    // Capture keeps fast drags delivering moves once the pointer leaves the
    // canvas; a pointer that can't be captured (stale touch id) still draws.
    try {
      displayEl.setPointerCapture(e.pointerId);
    } catch {
      /* uncapturable pointer — drag still works while over the canvas */
    }
    if (tool === 'brush' || tool === 'eraser') {
      const stroke: StrokeLayer = {
        id: crypto.randomUUID(),
        kind: 'stroke',
        mode: tool === 'eraser' ? 'erase' : 'paint',
        color: toolColor,
        size: toolSize,
        points: [p],
      };
      layers.push(stroke);
      drawing = { mode: 'stroke', layerId: stroke.id, last: p };
    } else if (tool === 'arrow') {
      const arrow: RasterLayer = {
        id: crypto.randomUUID(),
        kind: 'arrow',
        from: p,
        to: p,
        color: toolColor,
        size: toolSize,
      };
      layers.push(arrow);
      drawing = { mode: 'arrow', layerId: arrow.id };
    } else if (tool === 'text') {
      const text: TextLayer = {
        id: crypto.randomUUID(),
        kind: 'text',
        text: textDraft.trim() || 'Text',
        x: p.x,
        y: p.y,
        size: textSize,
        color: toolColor,
        bold: true,
      };
      layers.push(text);
      selectedId = text.id;
    } else if (tool === 'crop' || tool === 'darken' || tool === 'lighten' || tool === 'blur') {
      pendingCrop = null;
      marquee = { a: p, b: p };
      drawing = { mode: 'marquee' };
    } else if (tool === 'move') {
      const hit = hitTest(p);
      selectedId = hit?.id ?? null;
      if (hit) drawing = { mode: 'move', layerId: hit.id, last: p };
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (!drawing) return;
    const p = toDoc(e);
    if (drawing.mode === 'stroke') {
      const stroke = layers.find((l) => l.id === drawing!.layerId) as StrokeLayer | undefined;
      if (!stroke) return;
      const last = drawing.last!;
      if (Math.hypot(p.x - last.x, p.y - last.y) >= 2) {
        stroke.points.push(p);
        drawing.last = p;
      }
    } else if (drawing.mode === 'arrow') {
      const arrow = layers.find((l) => l.id === drawing!.layerId);
      if (arrow?.kind === 'arrow') arrow.to = p;
    } else if (drawing.mode === 'marquee') {
      if (marquee) marquee.b = p;
    } else if (drawing.mode === 'move') {
      const layer = layers.find((l) => l.id === drawing!.layerId);
      if (!layer) return;
      const dx = p.x - drawing.last!.x;
      const dy = p.y - drawing.last!.y;
      drawing.last = p;
      const i = layers.indexOf(layer);
      layers[i] = shiftLayer(layer, dx, dy);
    }
  }

  function onPointerUp() {
    if (!drawing) return;
    if (drawing.mode === 'arrow') {
      const arrow = layers.find((l) => l.id === drawing!.layerId);
      if (arrow?.kind === 'arrow' && !arrowLongEnough(arrow)) {
        layers.splice(layers.indexOf(arrow), 1);
      }
    } else if (drawing.mode === 'marquee' && marquee) {
      const rect = clampRect(normalizeRect(marquee.a, marquee.b), docW, docH);
      marquee = null;
      if (rect.w >= 4 && rect.h >= 4) {
        if (tool === 'crop') {
          pendingCrop = rect;
        } else if (tool === 'darken' || tool === 'lighten' || tool === 'blur') {
          layers.push({
            id: crypto.randomUUID(),
            kind: 'adjust',
            mode: tool,
            rect,
            amount: adjustAmount,
          });
        }
      }
    }
    drawing = null;
  }

  function removeLayer(id: string) {
    const i = layers.findIndex((l) => l.id === id);
    if (i >= 0) layers.splice(i, 1);
    if (selectedId === id) selectedId = null;
  }

  function clearLayers() {
    if (layers.length > 0 && !confirm('Remove all annotation layers?')) return;
    layers = [];
    selectedId = null;
  }

  // ---- export ---------------------------------------------------------------

  function flash(msg: string) {
    feedback = msg;
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => (feedback = null), 2000);
  }

  const embedActive = $derived(
    exportFormat === 'jpg' && metaMode === 'edit' && hasEditedFields(exifFields)
  );

  async function doExport() {
    if (!original || !file) return;
    busy = true;
    try {
      const composite = renderComposite(original, quarter, crop, layers);
      const blob = embedActive
        ? await encodeJpegWithExif(composite, quality, exifFields)
        : await encodeCanvas(composite, exportFormat, quality);
      downloadBlob(blob, outputFilename(file.name, exportFormat));
      flash(`Downloaded (${formatBytes(blob.size)})`);
    } catch {
      flash('Export failed');
    } finally {
      busy = false;
    }
  }

  async function copyAsPng() {
    if (!original) return;
    try {
      const composite = renderComposite(original, quarter, crop, layers);
      // Clipboard images are ALWAYS PNG (async clipboard API limitation).
      const png = await encodeCanvas(composite, 'png', 100);
      flash((await copyPng(png)) ? 'Copied as PNG' : 'Copy failed — try downloading instead');
    } catch {
      flash('Copy failed');
    }
  }
</script>

<div class="page-header">
  <h1>Image editor</h1>
  {#if original}
    <button class="btn" data-testid="ie-new" onclick={clearSession}>New image</button>
  {/if}
</div>

<div class="stack">
  {#if !original}
    <Card title="Import">
      <div class="stack">
        <div>
          <label for="ie-file">PNG, JPG, WebP, AVIF, TIFF or SVG</label>
          <input
            id="ie-file"
            data-testid="ie-file"
            type="file"
            accept=".svg,.avif,.webp,.tif,.tiff,.png,.jpg,.jpeg,image/svg+xml,image/avif,image/webp,image/tiff,image/png,image/jpeg"
            onchange={onPick}
          />
        </div>
        {#if decodeErr}
          <p class="error" data-testid="ie-error" role="alert">{decodeErr}</p>
        {:else if busy}
          <p class="muted" aria-live="polite">Decoding…</p>
        {/if}
        <p class="muted small">
          Session-only: edits live in this tab and are discarded when you leave —
          export what you want to keep. Nothing is uploaded or stored.
        </p>
      </div>
    </Card>
  {:else}
    <div class="editor-grid">
      <div class="stack">
        <Card title="Canvas">
          <div class="stack">
            <div class="canvas-scroll checkerboard">
              <canvas
                bind:this={displayEl}
                data-testid="ie-canvas"
                class="display"
                class:crosshair={tool !== 'move'}
                onpointerdown={onPointerDown}
                onpointermove={onPointerMove}
                onpointerup={onPointerUp}
                onpointercancel={onPointerUp}
                aria-label="Image editing canvas"
              ></canvas>
            </div>
            <p class="muted small" data-testid="ie-info">
              {file?.name} · {docW} × {docH}px
              {#if quarter !== 0}&nbsp;· rotated {quarter * 90}°{/if}
              {#if crop}&nbsp;· cropped{/if}
            </p>
            <div class="row wrap">
              <button class="btn btn-sm" data-testid="ie-rotate-ccw" onclick={() => rotateView(3)}>⟲ Rotate left</button>
              <button class="btn btn-sm" data-testid="ie-rotate-cw" onclick={() => rotateView(1)}>⟳ Rotate right</button>
              <button class="btn btn-sm" data-testid="ie-reset-view" disabled={quarter === 0 && !crop} onclick={resetView}>
                Reset crop &amp; rotation
              </button>
              {#if pendingCrop}
                <button class="btn btn-sm btn-primary" data-testid="ie-apply-crop" onclick={applyCrop}>Apply crop</button>
                <button class="btn btn-sm" data-testid="ie-cancel-crop" onclick={() => (pendingCrop = null)}>Cancel</button>
              {/if}
            </div>
          </div>
        </Card>

        <Card title="Export">
          <div class="stack">
            <div class="row wrap">
              <div>
                <label for="ie-format">Format</label>
                <select id="ie-format" data-testid="ie-format" bind:value={exportFormat}>
                  <option value="png">PNG</option>
                  <option value="jpg">JPG</option>
                </select>
              </div>
              {#if exportFormat === 'jpg'}
                <div>
                  <label for="ie-quality">JPG quality ({quality})</label>
                  <input id="ie-quality" data-testid="ie-quality" class="num" type="number" min="1" max="100" bind:value={quality} />
                </div>
              {/if}
            </div>
            <div class="row">
              <button class="btn btn-primary" data-testid="ie-download" disabled={busy} onclick={doExport}>Download</button>
              <button class="btn" data-testid="ie-copy" onclick={copyAsPng}>Copy (always PNG)</button>
            </div>
            <p class="muted small" aria-live="polite" data-testid="ie-feedback">{feedback ?? ''}</p>
            <p class="muted small" data-testid="ie-meta-note">
              {#if embedActive}
                This JPG will carry ONLY the edited fields below — never GPS or the
                original metadata.
              {:else}
                Exports are re-encoded, which strips all original metadata (PNG
                always exports clean). Choose “Embed edited fields” below to write
                the edited tags into a JPG export.
              {/if}
            </p>
          </div>
        </Card>
      </div>

      <div class="stack">
        <Card title="Tools">
          <div class="stack">
            <div class="row wrap" role="group" aria-label="Editing tools">
              {#each TOOLS as t (t.id)}
                <button
                  class="btn btn-sm"
                  class:tool-active={tool === t.id}
                  data-testid={`ie-tool-${t.id}`}
                  aria-pressed={tool === t.id}
                  onclick={() => {
                    tool = t.id;
                    if (t.id !== 'crop') pendingCrop = null;
                  }}
                >
                  {t.label}
                </button>
              {/each}
            </div>

            {#if tool === 'brush' || tool === 'arrow' || tool === 'text'}
              <div class="row wrap">
                <ColorField testid="ie-color" bind:value={toolColor} ariaLabel="Tool color" fallback="#e11d48" />
                {#if tool === 'text'}
                  <div>
                    <label for="ie-text-size">Font size</label>
                    <input id="ie-text-size" data-testid="ie-text-size" class="num" type="number" min="8" max="400" bind:value={textSize} />
                  </div>
                {:else}
                  <div>
                    <label for="ie-size">Size</label>
                    <input id="ie-size" data-testid="ie-size" class="num" type="number" min="1" max="200" bind:value={toolSize} />
                  </div>
                {/if}
              </div>
            {:else if tool === 'eraser'}
              <div class="row">
                <div>
                  <label for="ie-size-e">Size</label>
                  <input id="ie-size-e" data-testid="ie-size" class="num" type="number" min="1" max="200" bind:value={toolSize} />
                </div>
                <p class="muted small self-end">Erased areas become transparent (white in JPG exports).</p>
              </div>
            {:else if tool === 'darken' || tool === 'lighten' || tool === 'blur'}
              <div class="grow">
                <label for="ie-amount">Strength ({adjustAmount})</label>
                <input id="ie-amount" data-testid="ie-amount" type="range" min="1" max="100" bind:value={adjustAmount} />
                <p class="muted small">Drag a rectangle on the image to apply.</p>
              </div>
            {:else if tool === 'crop'}
              <p class="muted small">Drag a rectangle, then “Apply crop”. Reset undoes it any time.</p>
            {:else if tool === 'move'}
              <p class="muted small">Click text or an arrow to select it; drag to move.</p>
            {/if}

            {#if tool === 'text'}
              <div>
                <label for="ie-text">Text to place</label>
                <input id="ie-text" data-testid="ie-text" maxlength="120" bind:value={textDraft} />
              </div>
            {/if}

            {#if selected}
              <div class="selected-box" data-testid="ie-selected">
                <p class="muted small">Selected: {layerLabel(selected)}</p>
                {#if selected.kind === 'text'}
                  <div class="row wrap">
                    <div class="grow">
                      <label for="ie-sel-text">Text</label>
                      <input id="ie-sel-text" data-testid="ie-sel-text" maxlength="120" bind:value={selected.text} />
                    </div>
                    <div>
                      <label for="ie-sel-size">Size</label>
                      <input id="ie-sel-size" data-testid="ie-sel-size" class="num" type="number" min="8" max="400" bind:value={selected.size} />
                    </div>
                    <ColorField testid="ie-sel-color" bind:value={selected.color} ariaLabel="Text color" fallback="#e11d48" />
                    <label class="check">
                      <input type="checkbox" bind:checked={selected.bold} />
                      Bold
                    </label>
                  </div>
                {:else if selected.kind === 'arrow'}
                  <div class="row wrap">
                    <ColorField testid="ie-sel-color" bind:value={selected.color} ariaLabel="Arrow color" fallback="#e11d48" />
                    <div>
                      <label for="ie-sel-asize">Size</label>
                      <input id="ie-sel-asize" data-testid="ie-sel-size" class="num" type="number" min="1" max="200" bind:value={selected.size} />
                    </div>
                  </div>
                {/if}
                <button class="btn btn-sm btn-danger" data-testid="ie-sel-delete" onclick={() => removeLayer(selected.id)}>
                  Delete layer
                </button>
              </div>
            {/if}
          </div>
        </Card>

        <Card title="Layers">
          <div class="stack">
            {#if layers.length === 0}
              <p class="muted small">No annotation layers yet — draw, drop an arrow, place text, or select a region.</p>
            {:else}
              <ul class="layers">
                {#each [...layers].reverse() as layer (layer.id)}
                  <li class:active={layer.id === selectedId} data-testid="ie-layer">
                    <button
                      class="layer-name"
                      data-testid="ie-layer-select"
                      onclick={() => (selectedId = layer.id)}
                    >
                      <span
                        class="dot"
                        style={`background:${layer.kind === 'stroke' || layer.kind === 'arrow' || layer.kind === 'text' ? layer.color : 'transparent'}`}
                      ></span>
                      {layerLabel(layer)}
                    </button>
                    <button class="mini" title="Delete layer" aria-label="Delete layer" data-testid="ie-layer-delete" onclick={() => removeLayer(layer.id)}>✕</button>
                  </li>
                {/each}
              </ul>
              <button class="btn btn-sm" data-testid="ie-clear-layers" onclick={clearLayers}>Remove all</button>
            {/if}
          </div>
        </Card>

        <Card title="Metadata (EXIF)">
          <div class="stack">
            {#if exifRows.length === 0}
              <p class="muted small" data-testid="ie-exif-empty">No readable metadata in this image.</p>
            {:else}
              <details data-testid="ie-exif-details">
                <summary>{exifRows.length} metadata fields</summary>
                <div class="table-wrap">
                  <table class="data-table">
                    <tbody>
                      {#each exifRows as row (row.tag)}
                        <tr data-testid="ie-exif-row">
                          <th scope="row">{row.tag}</th>
                          <td>{row.value}</td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              </details>
            {/if}

            <div role="radiogroup" aria-label="Export metadata" class="stack tight">
              <label class="check">
                <input type="radio" name="ie-meta" value="strip" data-testid="ie-meta-strip" bind:group={metaMode} />
                Strip all metadata (default)
              </label>
              <label class="check">
                <input type="radio" name="ie-meta" value="edit" data-testid="ie-meta-edit" bind:group={metaMode} />
                Embed edited fields (JPG exports only)
              </label>
            </div>

            {#if metaMode === 'edit'}
              <div class="stack tight">
                <div>
                  <label for="ie-exif-artist">Artist</label>
                  <input id="ie-exif-artist" data-testid="ie-exif-artist" bind:value={exifFields.artist} />
                </div>
                <div>
                  <label for="ie-exif-copyright">Copyright</label>
                  <input id="ie-exif-copyright" data-testid="ie-exif-copyright" bind:value={exifFields.copyright} />
                </div>
                <div>
                  <label for="ie-exif-description">Description</label>
                  <input id="ie-exif-description" data-testid="ie-exif-description" bind:value={exifFields.description} />
                </div>
                <div>
                  <label for="ie-exif-date">Date taken</label>
                  <input id="ie-exif-date" data-testid="ie-exif-date" type="datetime-local" bind:value={exifFields.date} />
                </div>
                <p class="muted small">
                  GPS and every other original tag are never carried over — only the
                  four fields above, and only into JPG exports.
                </p>
              </div>
            {/if}
          </div>
        </Card>
      </div>
    </div>
  {/if}

  <Explainer summary="What happens to my image and its metadata?" testid="explainer-image-editor">
    <p>
      Everything runs on this device — the image is never uploaded, and this
      editor never stores it: the session lives only in this tab. Re-encoding on
      export strips all original metadata by default; the EXIF panel can embed
      the four common tags (artist, copyright, description, date) into JPG
      exports, and GPS data can never pass through. PNG exports always carry no
      metadata.
    </p>
  </Explainer>
</div>

<style>
  .editor-grid {
    display: grid;
    grid-template-columns: minmax(0, 3fr) minmax(16rem, 2fr);
    gap: var(--space-4);
    align-items: start;
  }

  @media (max-width: 56rem) {
    .editor-grid {
      grid-template-columns: 1fr;
    }
  }

  .canvas-scroll {
    border: 1.5px solid var(--border-strong-color);
    overflow: auto;
    max-height: 70vh;
    line-height: 0;
  }

  .checkerboard {
    /* Checkerboard so erased transparency is visible. */
    background:
      repeating-conic-gradient(var(--border-color) 0% 25%, transparent 0% 50%)
      0 0 / 16px 16px;
  }

  .display {
    max-width: 100%;
    height: auto;
    touch-action: none;
    user-select: none;
    cursor: default;
  }

  .display.crosshair {
    cursor: crosshair;
  }

  .tool-active {
    border-color: var(--color-primary);
    color: var(--color-primary);
  }

  .selected-box {
    border-top: 1px solid var(--border-color);
    padding-top: var(--space-2);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    align-items: flex-start;
  }

  .layers {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 12rem;
    overflow-y: auto;
  }

  .layers li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    border: 1px solid var(--border-color);
    padding: 2px var(--space-2);
  }

  .layers li.active {
    border-color: var(--color-primary);
  }

  .layer-name {
    background: none;
    border: none;
    color: var(--text-color);
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) 0;
    flex: 1;
    text-align: left;
  }

  .dot {
    width: 0.85rem;
    height: 0.85rem;
    border-radius: var(--radius-full);
    border: 1px solid var(--border-color);
    flex: none;
  }

  .mini {
    background: none;
    border: 1px solid var(--border-color);
    color: var(--text-muted-color);
    cursor: pointer;
    padding: 0 var(--space-1);
    font-size: var(--font-size-sm);
  }

  .mini:hover {
    border-color: var(--border-strong-color);
    color: var(--text-color);
  }

  .num {
    width: 5.5rem;
  }

  .grow {
    flex: 1;
    min-width: 8rem;
  }

  input[type='range'] {
    width: 100%;
  }

  .wrap {
    flex-wrap: wrap;
    align-items: flex-end;
  }

  .small {
    font-size: var(--font-size-sm);
  }

  .self-end {
    align-self: flex-end;
    margin: 0;
  }

  .error {
    color: var(--color-danger);
    font-size: var(--font-size-sm);
  }

  .tight {
    gap: var(--space-2);
  }

  .check {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    text-transform: none;
  }
</style>
