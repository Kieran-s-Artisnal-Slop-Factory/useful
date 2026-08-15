<script lang="ts">
  import { onMount } from 'svelte';
  import Card from '../Card.svelte';
  import ColorField from '../ColorField.svelte';
  import Explainer from '../Explainer.svelte';
  import { copyPng, downloadBlob } from '../../lib/exportFile';
  import { href } from '../../lib/paths';
  import { draggable, dropzone, type DragData } from '../../lib/dragdrop';
  import { DecodeError, decodeToCanvas, encodeCanvas, formatBytes, type TargetFormat } from '../../lib/img/convert';
  import {
    BLEND_MODES,
    canHost,
    canNestUnder,
    clampCanvas,
    findLayer,
    flattenLayers,
    layerDefaults,
    layerLabel,
    locateLayer,
    moveLayer,
    removeLayer,
    type ArrowLayer,
    type CropLayer,
    type FillLayer,
    type GroupLayer,
    type ImageLayer,
    type MaskLayer,
    type RasterDocument,
    type RasterLayer,
    type RasterPoint,
    type Rect,
    type StrokeLayer,
    type TextLayer,
  } from '../../lib/raster/model';
  import {
    arrowLongEnough,
    clampRect,
    layerBounds,
    normalizeRect,
    rectContains,
    rotateImageLayerCW,
    scaleLayerTree,
    shiftLayer,
    shiftLayerTree,
  } from '../../lib/raster/transform';
  import { renderBase, renderDocument } from '../../lib/raster/render';
  import {
    canRedo,
    canUndo,
    cloneLayers,
    createHistory,
    push as pushHistory,
    redo as redoHistory,
    touchDeep,
    undo as undoHistory,
    type RasterHistory,
  } from '../../lib/raster/history';
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

  type Tool =
    | 'move'
    | 'crop'
    | 'brush'
    | 'eraser'
    | 'restore'
    | 'arrow'
    | 'text'
    | 'darken'
    | 'lighten'
    | 'blur';

  const TOOLS: { id: Tool; label: string }[] = [
    { id: 'move', label: 'Move' },
    { id: 'crop', label: 'Crop' },
    { id: 'brush', label: 'Brush' },
    { id: 'eraser', label: 'Eraser' },
    { id: 'restore', label: 'Restore' },
    { id: 'arrow', label: 'Arrow' },
    { id: 'text', label: 'Text' },
    { id: 'darken', label: 'Darken' },
    { id: 'lighten', label: 'Lighten' },
    { id: 'blur', label: 'Blur' },
  ];

  // ---- session ----
  let doc = $state<RasterDocument | null>(null);
  let layers = $state<RasterLayer[]>([]);
  let selectedId = $state<string | null>(null);
  let decodeErr = $state<string | null>(null);
  let busy = $state(false);
  /** The first imported file's name (export default + metadata source). */
  let sourceName = $state<string>('');

  /** Background removal (Phase 8) status for the selected image layer. */
  let bgBusy = $state(false);
  let bgStatus = $state<string | null>(null);

  // ---- start screen ----
  let blankW = $state(1024);
  let blankH = $state(768);
  let blankBg = $state<string>('#ffffff');
  let blankTransparent = $state(false);

  // ---- tools ----
  let tool = $state<Tool>('brush');
  let toolColor = $state('#e11d48');
  let toolSize = $state(6);
  let textSize = $state(32);
  let textDraft = $state('Text');
  let adjustAmount = $state(50);
  let pendingCrop = $state<Rect | null>(null);
  let marquee = $state<{ a: RasterPoint; b: RasterPoint } | null>(null);
  /** Numeric crop entry (keyboard path — the marquee is pointer-only). */
  let cropForm = $state({ x: 0, y: 0, w: 0, h: 0 });

  // ---- view ----
  let zoom = $state(1);
  let displayEl = $state<HTMLCanvasElement>();
  let scrollEl = $state<HTMLDivElement>();
  let cssWidth = $state(0);
  /** Canvas-resize form (applied on submit, not per keystroke). */
  let canvasForm = $state({ w: 0, h: 0 });

  // ---- undo / redo ----
  /**
   * One history entry per pause in the editing, not per mutation: the effect
   * below subscribes to the whole document (cheaply — touchDeep only reads)
   * and a short debounce collapses a brush stroke, a slider drag or a burst of
   * typing into a single step. Snapshots share the decoded bitmaps, so a step
   * costs geometry, not pixels.
   */
  let history = $state<RasterHistory>(createHistory({ doc: null, layers: [] }));
  let historyTimer: ReturnType<typeof setTimeout> | undefined;
  let lastStructure = '';
  const HISTORY_DEBOUNCE_MS = 400;

  /** Cheap shape-only key: which layers exist, and under whom. */
  function structureKey(): string {
    return (
      `${doc?.width ?? 0}x${doc?.height ?? 0}|` +
      flattenLayers(layers)
        .map((e) => e.layer.id + '>' + (e.parent?.id ?? ''))
        .join(',')
    );
  }

  $effect(() => {
    touchDeep(doc);
    touchDeep(layers);
    const key = structureKey();
    const structural = key !== lastStructure;
    lastStructure = key;
    clearTimeout(historyTimer);
    // Discrete actions (add, delete, reorder, resize the canvas) get their own
    // step immediately — waiting would fold two quick clicks into one undo.
    // DURING a canvas gesture the structure changes too (a stroke layer is
    // created on pointerdown), and there the debounce is the point: one stroke
    // is one step, not one for the empty layer plus one for its points.
    if (structural && !drawing) {
      history = pushHistory(history, { doc, layers });
      return;
    }
    historyTimer = setTimeout(() => {
      // Signature-equal states (including one an undo just restored) are
      // coalesced by push(), so this is safe to call unconditionally.
      history = pushHistory(history, { doc, layers });
    }, HISTORY_DEBOUNCE_MS);
  });

  function applyHistory(next: RasterHistory) {
    if (next === history) return;
    clearTimeout(historyTimer);
    history = next;
    doc = next.present.doc ? { ...next.present.doc } : null;
    layers = cloneLayers(next.present.layers);
    lastStructure = structureKey();
    // The selection may have been a layer that no longer exists.
    if (selectedId && !findLayer(layers, selectedId)) selectedId = null;
    pendingCrop = null;
    marquee = null;
    if (doc) canvasForm = { w: doc.width, h: doc.height };
  }

  const undo = () => applyHistory(undoHistory(history));
  const redo = () => applyHistory(redoHistory(history));

  // ---- layer drag/drop (tree) ----
  let dragLayerId = $state<string | null>(null);
  let dropHint = $state<string | null>(null);

  // ---- metadata ----
  let exifRows = $state<{ tag: string; value: string }[]>([]);
  let metaMode = $state<'strip' | 'edit'>('strip');
  let exifFields = $state<ExifEditFields>({ artist: '', copyright: '', description: '', date: '' });

  // ---- export ----
  let exportName = $state('image');
  let exportFormat = $state<TargetFormat>('png');
  let quality = $state(85);
  let feedback = $state<string | null>(null);
  let feedbackTimer: ReturnType<typeof setTimeout> | undefined;

  const selected = $derived(selectedId ? findLayer(layers, selectedId) : null);
  const selectedLoc = $derived(selectedId ? locateLayer(layers, selectedId) : null);
  const flat = $derived(flattenLayers(layers));
  const embedActive = $derived(exportFormat === 'jpg' && metaMode === 'edit' && hasEditedFields(exifFields));
  /** Where a new mark goes: under the selected top-level layer, as a
   * sibling of a selected child, or top level when nothing is selected. */
  const targetLabel = $derived.by(() => {
    if (!selected) return 'the whole canvas (top level)';
    if (selected.kind === 'group') return `inside the group “${layerLabel(selected)}”`;
    if (canHost(selected)) return `“${layerLabel(selected)}” only`;
    const parent = selectedLoc?.parent ?? null;
    if (parent) {
      return parent.kind === 'group'
        ? `inside the group “${layerLabel(parent)}”`
        : `“${layerLabel(parent)}” (beside the selected effect)`;
    }
    return 'the whole canvas (top level, above the selected effect)';
  });

  /** Scale handles (image layers, move tool): 8 points around the bounds. */
  type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
  const HANDLE_IDS: HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  function handlePoint(b: Rect, h: HandleId): RasterPoint {
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    switch (h) {
      case 'nw':
        return { x: b.x, y: b.y };
      case 'n':
        return { x: cx, y: b.y };
      case 'ne':
        return { x: b.x + b.w, y: b.y };
      case 'e':
        return { x: b.x + b.w, y: cy };
      case 'se':
        return { x: b.x + b.w, y: b.y + b.h };
      case 's':
        return { x: cx, y: b.y + b.h };
      case 'sw':
        return { x: b.x, y: b.y + b.h };
      case 'w':
        return { x: b.x, y: cy };
    }
  }
  const scalable = $derived(tool === 'move' && selected?.kind === 'image');

  $effect(() => {
    const el = displayEl;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      cssWidth = entries[0]?.contentRect.width ?? 0;
    });
    ro.observe(el);
    return () => ro.disconnect();
  });

  // Re-render the visible canvas whenever anything about the session changes.
  $effect(() => {
    const el = displayEl;
    const d = doc;
    if (!el || !d) return;
    const comp = renderDocument(d, layers);
    el.width = comp.width;
    el.height = comp.height;
    const ctx = el.getContext('2d')!;
    ctx.clearRect(0, 0, el.width, el.height);
    ctx.drawImage(comp, 0, 0);
    const rect = marquee ? normalizeRect(marquee.a, marquee.b) : pendingCrop;
    if (rect) {
      if (tool === 'crop' || pendingCrop) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.fillRect(0, 0, el.width, rect.y);
        ctx.fillRect(0, rect.y, rect.x, rect.h);
        ctx.fillRect(rect.x + rect.w, rect.y, el.width - rect.x - rect.w, rect.h);
        ctx.fillRect(0, rect.y + rect.h, el.width, el.height - rect.y - rect.h);
      }
      const px = Math.max(1, el.width / (cssWidth || el.width));
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.lineWidth = 3 * px;
      ctx.setLineDash([6 * px, 4 * px]);
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5 * px;
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
      ctx.setLineDash([]);
    }
    // Selection outline for the selected layer's bounds.
    if (selected) {
      const b = layerBounds(selected);
      if (b) {
        const px = Math.max(1, el.width / (cssWidth || el.width));
        ctx.save();
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = 2 * px;
        ctx.setLineDash([5 * px, 3 * px]);
        ctx.strokeRect(b.x, b.y, b.w, b.h);
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = px;
        ctx.strokeRect(b.x, b.y, b.w, b.h);
        if (scalable) {
          // Scale handles: filled squares at corners + edge midpoints.
          const hs = 5 * px;
          ctx.setLineDash([]);
          for (const id of HANDLE_IDS) {
            const hp = handlePoint(b, id);
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = 'rgba(0,0,0,0.85)';
            ctx.lineWidth = px;
            ctx.fillRect(hp.x - hs, hp.y - hs, hs * 2, hs * 2);
            ctx.strokeRect(hp.x - hs, hp.y - hs, hs * 2, hs * 2);
          }
        }
        ctx.restore();
      }
    }
  });

  onMount(() => {
    // Registered here (not on an element) so the shortcuts work wherever the
    // focus is, except inside a field where ctrl+z means "undo my typing".
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      // The event target is only an element when something is focused; when
      // nothing is, it is the body (or the window for a synthetic event).
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(feedbackTimer);
      clearTimeout(historyTimer);
    };
  });

  // ---- start / import ---------------------------------------------------------

  function startBlank(e: Event) {
    e.preventDefault();
    doc = { width: clampCanvas(blankW), height: clampCanvas(blankH), background: null };
    // The background is a real (fill) layer, so it can be recolored, hidden,
    // reordered, or deleted like anything else.
    layers = blankTransparent ? [] : [{ ...layerDefaults('Background'), kind: 'fill', color: blankBg || '#ffffff' }];
    selectedId = null;
    sourceName = '';
    exportName = 'image';
    canvasForm = { w: doc.width, h: doc.height };
    fitZoom();
  }

  async function onPick(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0] ?? null;
    input.value = '';
    if (!f) return;
    await addImageFile(f);
  }

  /** Decode a file into an image layer. The FIRST image sets the canvas. */
  async function addImageFile(f: File) {
    busy = true;
    decodeErr = null;
    try {
      const decoded = await decodeToCanvas(f);
      const first = !doc;
      if (first) {
        doc = { width: decoded.width, height: decoded.height, background: null };
        sourceName = f.name;
        exportName = f.name.replace(/\.[^.]+$/, '') || 'image';
        canvasForm = { w: doc.width, h: doc.height };
        await readExif(f);
      }
      const layer: ImageLayer = {
        ...layerDefaults(f.name),
        kind: 'image',
        source: decoded.canvas,
        fileName: f.name,
        x: 0,
        y: 0,
        width: decoded.width,
        height: decoded.height,
        quarter: 0,
      };
      // Into the selected group if there is one, else the root list.
      addLayer(layer);
      selectedId = layer.id;
      if (first) fitZoom();
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
    if (layers.length > 0 && !confirm('Discard the current session?')) return;
    doc = null;
    layers = [];
    selectedId = null;
    pendingCrop = null;
    marquee = null;
    exifRows = [];
    decodeErr = null;
    sourceName = '';
    zoom = 1;
  }

  // ---- canvas + view ------------------------------------------------------------

  function applyCanvasSize(e: Event) {
    e.preventDefault();
    if (!doc) return;
    doc.width = clampCanvas(canvasForm.w);
    doc.height = clampCanvas(canvasForm.h);
    canvasForm = { w: doc.width, h: doc.height };
    fitZoom();
  }

  function fitZoom() {
    if (!doc) return;
    const avail = (scrollEl?.clientWidth ?? 800) - 4;
    zoom = Math.max(0.05, Math.min(1, avail / doc.width));
    zoom = Math.round(zoom * 100) / 100;
  }

  function zoomBy(factor: number) {
    zoom = Math.max(0.05, Math.min(16, Math.round(zoom * factor * 100) / 100));
  }

  // ---- layer tree operations ----------------------------------------------------

  /** Insert a new layer where new marks go (see targetLabel). */
  function addLayer(layer: RasterLayer) {
    const loc = selectedLoc;
    if (!loc) {
      layers.push(layer);
      return;
    }
    const sel = loc.list[loc.index]!;
    if (canNestUnder(layer, sel)) {
      sel.children.push(layer);
    } else if (canNestUnder(layer, loc.parent)) {
      // Beside the selection (just above it) in the same list.
      loc.list.splice(loc.index + 1, 0, layer);
    } else {
      layers.push(layer);
    }
  }

  function addFillLayer() {
    const f: FillLayer = { ...layerDefaults('Color fill'), kind: 'fill', color: toolColor };
    addLayer(f);
    selectedId = f.id;
  }

  function addGroup() {
    const g: GroupLayer = { ...layerDefaults('Group'), kind: 'group' };
    addLayer(g);
    selectedId = g.id;
  }

  /** Wrap the selected layer in a new group at its position. */
  function wrapInGroup() {
    const loc = selectedLoc;
    if (!loc) return;
    const layer = loc.list[loc.index]!;
    const g: GroupLayer = { ...layerDefaults('Group'), kind: 'group', children: [] };
    loc.list.splice(loc.index, 1, g);
    g.children.push(layer);
    selectedId = g.id;
  }

  /**
   * Cut the background out of the SELECTED image layer (Phase 8). The result
   * is a mask layer nested under that image, so it clips only that image —
   * the whole point of doing it here rather than in the standalone tool — and
   * deleting it restores the background.
   *
   * The pipeline is imported lazily: the model runtime is a 15MB affair and
   * must not ride along for anyone who only ever draws an arrow.
   */
  async function removeBackgroundForSelected() {
    const loc = selectedLoc;
    const layer = loc?.list[loc.index];
    if (!layer || layer.kind !== 'image' || bgBusy) return;
    bgBusy = true;
    bgStatus = 'Loading the model…';
    try {
      const { computeMask, maskToCanvas } = await import('../../lib/bg/canvas');
      // Segment exactly what is drawn: the layer's bitmap, turned and scaled
      // into its own rect (its children — erasers, crops — are NOT applied;
      // they keep acting on top of the mask like any other effect).
      const w = Math.max(1, Math.round(layer.width));
      const h = Math.max(1, Math.round(layer.height));
      const flat = document.createElement('canvas');
      flat.width = w;
      flat.height = h;
      const bitmap = layer.quarter % 4 === 0 ? layer.source : renderBase(layer.source, layer.quarter, null);
      flat.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
      const mask = await computeMask(flat, (p) => {
        bgStatus = `Downloading the model… ${Math.round(p.ratio * 100)}%`;
      });
      const maskLayer: MaskLayer = {
        ...layerDefaults('Background removed'),
        kind: 'mask',
        source: maskToCanvas(mask, w, h, 'alpha'),
        rect: { x: layer.x, y: layer.y, w: layer.width, h: layer.height },
        quarter: 0,
        invert: false,
      };
      layer.children.push(maskLayer);
      selectedId = maskLayer.id;
      bgStatus = null;
    } catch (err) {
      bgStatus =
        err instanceof Error ? `Background removal failed: ${err.message}` : 'Background removal failed.';
    } finally {
      bgBusy = false;
    }
  }

  function deleteLayer(id: string) {
    removeLayer(layers, id);
    if (selectedId === id) selectedId = null;
  }

  function nudgeLayer(id: string, delta: 1 | -1) {
    const loc = locateLayer(layers, id);
    if (!loc) return;
    const j = loc.index + delta;
    if (j < 0 || j >= loc.list.length) return;
    const [l] = loc.list.splice(loc.index, 1);
    loc.list.splice(j, 0, l!);
  }

  /** Nest under the sibling directly below (keyboard path for "drop into"). */
  function nestLayer(id: string) {
    const loc = locateLayer(layers, id);
    if (!loc) return;
    const below = loc.list[loc.index - 1];
    if (!below || !canNestUnder(loc.list[loc.index]!, below)) return;
    moveLayer(layers, id, { parentId: below.id, index: below.children.length });
  }

  /** Move out of the parent, landing just above it in the parent's list. */
  function unnestLayer(id: string) {
    const loc = locateLayer(layers, id);
    if (!loc?.parent) return;
    const ploc = locateLayer(layers, loc.parent.id)!;
    moveLayer(layers, id, { parentId: ploc.parent?.id ?? null, index: ploc.index + 1 });
  }

  function canNestBelow(id: string): boolean {
    const loc = locateLayer(layers, id);
    if (!loc) return false;
    const below = loc.list[loc.index - 1];
    return !!below && canNestUnder(loc.list[loc.index]!, below);
  }

  function toggleVisible(layer: RasterLayer) {
    layer.visible = !layer.visible;
  }

  function rotateSelected() {
    const loc = selectedLoc;
    if (!loc || !selected || selected.kind !== 'image') return;
    loc.list[loc.index] = rotateImageLayerCW(selected);
  }

  function clearLayers() {
    if (layers.length > 0 && !confirm('Remove ALL layers?')) return;
    layers = [];
    selectedId = null;
  }

  // ---- drag/drop reordering in the tree -----------------------------------------
  //
  // Zones on a row: top third = drop ABOVE it, bottom third = drop BELOW it,
  // middle = drop INTO it (nest) when the row can host the dragged layer.
  // The strip at the end sends to the bottom of the root list.

  type DropZone = 'above' | 'below' | 'into';

  /**
   * Which third of the row the pointer is in. `event.currentTarget` is not
   * available here (the drop engine, not the DOM, routes these), so the row
   * element is looked up by id.
   */
  function zoneFor(event: PointerEvent, row: RasterLayer, draggedId: string): DropZone {
    const el = document.querySelector(`[data-layer-id="${row.id}"]`);
    const r = el?.getBoundingClientRect();
    const f = r && r.height > 0 ? (event.clientY - r.top) / r.height : 0.5;
    const dragged = findLayer(layers, draggedId);
    const canInto = !!dragged && dragged.id !== row.id && canNestUnder(dragged, row);
    if (canInto) return f < 0.3 ? 'above' : f > 0.7 ? 'below' : 'into';
    return f < 0.5 ? 'above' : 'below';
  }

  function onRowDragOver(event: PointerEvent, data: DragData, row: RasterLayer) {
    if (data.id === row.id) return;
    dragLayerId = data.id;
    dropHint = zoneFor(event, row, data.id) + ':' + row.id;
  }

  function onRowDrop(event: PointerEvent, data: DragData, row: RasterLayer) {
    const id = data.id;
    const zone = zoneFor(event, row, id);
    dragLayerId = null;
    dropHint = null;
    if (!id || id === row.id) return;
    if (zone === 'into') {
      moveLayer(layers, id, { parentId: row.id, index: row.children.length });
      return;
    }
    const target = locateLayer(layers, row.id);
    const dragged = locateLayer(layers, id);
    if (!target || !dragged) return;
    // Lists are rendered top-first, so "above" = a higher index.
    let index = zone === 'above' ? target.index + 1 : target.index;
    if (dragged.list === target.list && dragged.index < target.index) index -= 1;
    moveLayer(layers, id, { parentId: target.parent?.id ?? null, index });
  }

  function dropBottom(data: DragData) {
    dragLayerId = null;
    dropHint = null;
    moveLayer(layers, data.id, { parentId: null, index: 0 });
  }

  function onDragEnd() {
    dragLayerId = null;
    dropHint = null;
  }

  // ---- crop --------------------------------------------------------------------

  function applyCrop() {
    if (!pendingCrop || !doc) return;
    const r = clampRect(pendingCrop, doc.width, doc.height);
    const crop: CropLayer = { ...layerDefaults('crop'), kind: 'crop', rect: r };
    addLayer(crop);
    pendingCrop = null;
  }

  /** Keyboard path for crop: type a rect, then Apply. */
  function stageNumericCrop(e: Event) {
    e.preventDefault();
    if (!doc) return;
    const n = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
    const r = clampRect(
      { x: n(cropForm.x, 0), y: n(cropForm.y, 0), w: n(cropForm.w, doc.width), h: n(cropForm.h, doc.height) },
      doc.width,
      doc.height
    );
    marquee = null;
    pendingCrop = r;
    cropForm = { ...r };
  }

  // ---- canvas pointer interactions ---------------------------------------------

  /** The in-flight gesture. `pointerId` pins it to ONE pointer: on touch
   * screens a second finger must not hijack or interleave into the stroke. */
  let drawing: {
    pointerId: number;
    mode: 'stroke' | 'arrow' | 'marquee' | 'move' | 'scale';
    layerId?: string;
    last?: RasterPoint;
    /** scale: which handle is held, and the layer's rect when the drag began. */
    handle?: HandleId;
    start?: Rect;
  } | null = null;

  /** Which scale handle (if any) is under the pointer, in doc units. */
  function handleAt(p: RasterPoint): HandleId | null {
    if (!scalable || !selected || !displayEl) return null;
    const b = layerBounds(selected);
    if (!b) return null;
    const px = Math.max(1, displayEl.width / (cssWidth || displayEl.width));
    const tol = 8 * px;
    for (const id of HANDLE_IDS) {
      const hp = handlePoint(b, id);
      if (Math.abs(p.x - hp.x) <= tol && Math.abs(p.y - hp.y) <= tol) return id;
    }
    return null;
  }

  /** New rect for a scale drag: corners keep the aspect ratio, edges move one axis. */
  function scaledRect(start: Rect, handle: HandleId, p: RasterPoint): Rect {
    let { x, y, w, h } = start;
    const right = x + w;
    const bottom = y + h;
    const west = handle.includes('w');
    const east = handle.includes('e');
    const north = handle.includes('n');
    const south = handle.includes('s');
    if (west) {
      x = Math.min(p.x, right - 1);
      w = right - x;
    }
    if (east) w = Math.max(1, p.x - x);
    if (north) {
      y = Math.min(p.y, bottom - 1);
      h = bottom - y;
    }
    if (south) h = Math.max(1, p.y - y);
    if ((west || east) && (north || south) && start.w > 0 && start.h > 0) {
      // Corner: keep the aspect ratio, anchored on the opposite corner.
      const ratio = start.w / start.h;
      const sc = Math.max(0.01, Math.max(w / start.w, h / start.h));
      w = Math.max(1, start.w * sc);
      h = Math.max(1, w / ratio);
      if (west) x = right - w;
      if (north) y = bottom - h;
    }
    return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
  }

  function toDoc(e: PointerEvent): RasterPoint {
    const el = displayEl!;
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(((e.clientX - r.left) / r.width) * el.width),
      y: Math.round(((e.clientY - r.top) / r.height) * el.height),
    };
  }

  /** Topmost layer (children before parents) whose bounds contain the point. */
  function hitTest(p: RasterPoint): RasterLayer | null {
    for (const { layer } of flat) {
      if (!layer.visible) continue;
      const b = layerBounds(layer);
      if (b && rectContains(b, p)) return layer;
    }
    return null;
  }

  function onPointerDown(e: PointerEvent) {
    if (!doc || !displayEl) return;
    if (drawing) return;
    const p = toDoc(e);
    const pointerId = e.pointerId;
    try {
      displayEl.setPointerCapture(pointerId);
    } catch {
      /* uncapturable pointer — drag still works while over the canvas */
    }
    if (tool === 'brush' || tool === 'eraser' || tool === 'restore') {
      const stroke: StrokeLayer = {
        ...layerDefaults(tool),
        kind: 'stroke',
        mode: tool === 'eraser' ? 'erase' : tool === 'restore' ? 'restore' : 'paint',
        color: toolColor,
        size: toolSize,
        points: [p],
      };
      addLayer(stroke);
      drawing = { pointerId, mode: 'stroke', layerId: stroke.id, last: p };
    } else if (tool === 'arrow') {
      const arrow: ArrowLayer = { ...layerDefaults('arrow'), kind: 'arrow', from: p, to: p, color: toolColor, size: toolSize };
      addLayer(arrow);
      drawing = { pointerId, mode: 'arrow', layerId: arrow.id };
    } else if (tool === 'text') {
      const text: TextLayer = {
        ...layerDefaults('text'),
        kind: 'text',
        text: textDraft.trim() || 'Text',
        x: p.x,
        y: p.y,
        size: textSize,
        color: toolColor,
        bold: true,
      };
      addLayer(text);
      selectedId = text.id;
    } else if (tool === 'crop' || tool === 'darken' || tool === 'lighten' || tool === 'blur') {
      pendingCrop = null;
      marquee = { a: p, b: p };
      drawing = { pointerId, mode: 'marquee' };
    } else if (tool === 'move') {
      const handle = handleAt(p);
      if (handle && selected) {
        drawing = { pointerId, mode: 'scale', layerId: selected.id, handle, start: layerBounds(selected)!, last: p };
        return;
      }
      const hit = hitTest(p);
      selectedId = hit?.id ?? null;
      if (hit) drawing = { pointerId, mode: 'move', layerId: hit.id, last: p };
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (!drawing || e.pointerId !== drawing.pointerId) return;
    const p = toDoc(e);
    if (drawing.mode === 'stroke') {
      const stroke = findLayer(layers, drawing.layerId!) as StrokeLayer | null;
      if (!stroke) return;
      const last = drawing.last!;
      if (Math.hypot(p.x - last.x, p.y - last.y) >= 2) {
        stroke.points.push(p);
        drawing.last = p;
      }
    } else if (drawing.mode === 'arrow') {
      const arrow = findLayer(layers, drawing.layerId!);
      if (arrow?.kind === 'arrow') arrow.to = p;
    } else if (drawing.mode === 'marquee') {
      if (marquee) marquee.b = p;
    } else if (drawing.mode === 'move') {
      const loc = locateLayer(layers, drawing.layerId!);
      if (!loc) return;
      const dx = p.x - drawing.last!.x;
      const dy = p.y - drawing.last!.y;
      drawing.last = p;
      const layer = loc.list[loc.index]!;
      // A host carries its subtree (its marks/effects stick to it); an effect
      // or a mark under a host moves alone.
      loc.list[loc.index] = loc.parent && !canHost(layer) ? shiftLayer(layer, dx, dy) : shiftLayerTree(layer, dx, dy);
    } else if (drawing.mode === 'scale') {
      const loc = locateLayer(layers, drawing.layerId!);
      if (!loc || !drawing.start || !drawing.handle) return;
      const layer = loc.list[loc.index]!;
      const from = layerBounds(layer);
      if (!from) return;
      const to = scaledRect(drawing.start, drawing.handle, p);
      loc.list[loc.index] = scaleLayerTree(layer, from, to);
    }
  }

  function onPointerUp(e: PointerEvent) {
    if (!drawing || e.pointerId !== drawing.pointerId) return;
    if (drawing.mode === 'arrow') {
      const arrow = findLayer(layers, drawing.layerId!);
      if (arrow?.kind === 'arrow' && !arrowLongEnough(arrow)) removeLayer(layers, arrow.id);
    } else if (drawing.mode === 'marquee' && marquee && doc) {
      const rect = clampRect(normalizeRect(marquee.a, marquee.b), doc.width, doc.height);
      marquee = null;
      if (rect.w >= 4 && rect.h >= 4) {
        if (tool === 'crop') {
          pendingCrop = rect;
        } else if (tool === 'darken' || tool === 'lighten' || tool === 'blur') {
          addLayer({ ...layerDefaults(tool), kind: 'adjust', mode: tool, rect, amount: adjustAmount });
        }
      }
    }
    drawing = null;
  }

  // ---- export --------------------------------------------------------------------

  function flash(msg: string) {
    feedback = msg;
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => (feedback = null), 2000);
  }

  function exportFileName(): string {
    const stem = (exportName || 'image').trim().replace(/[\\/:*?"<>|]/g, '_') || 'image';
    return `${stem}.${exportFormat}`;
  }

  async function doExport() {
    if (!doc) return;
    busy = true;
    try {
      const composite = renderDocument(doc, layers);
      const blob = embedActive
        ? await encodeJpegWithExif(composite, quality, exifFields)
        : await encodeCanvas(composite, exportFormat, quality);
      downloadBlob(blob, exportFileName());
      flash(`Downloaded (${formatBytes(blob.size)})`);
    } catch {
      flash('Export failed');
    } finally {
      busy = false;
    }
  }

  async function copyAsPng() {
    if (!doc) return;
    try {
      const composite = renderDocument(doc, layers);
      const png = await encodeCanvas(composite, 'png', 100);
      flash((await copyPng(png)) ? 'Copied as PNG' : 'Copy failed — try downloading instead');
    } catch {
      flash('Copy failed');
    }
  }
</script>

<div class="page-header">
  <h1>Image editor</h1>
  {#if doc}
    <button class="btn" data-testid="ie-new" onclick={clearSession}>New session</button>
  {/if}
</div>

<div class="stack">
  {#if !doc}
    <div class="grid-2">
      <Card title="Start from an image">
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
          <p class="muted small">The first image becomes the base layer and sets the canvas size.</p>
        </div>
      </Card>
      <Card title="Start from a blank canvas">
        <form class="stack" onsubmit={startBlank}>
          <div class="row wrap">
            <div>
              <label for="ie-blank-w">Width (px)</label>
              <input id="ie-blank-w" data-testid="ie-blank-w" class="num" type="number" min="1" max="8192" bind:value={blankW} />
            </div>
            <div>
              <label for="ie-blank-h">Height (px)</label>
              <input id="ie-blank-h" data-testid="ie-blank-h" class="num" type="number" min="1" max="8192" bind:value={blankH} />
            </div>
          </div>
          <div class="row wrap">
            <label class="check">
              <input type="checkbox" data-testid="ie-blank-transparent" bind:checked={blankTransparent} />
              Transparent
            </label>
            {#if !blankTransparent}
              <ColorField testid="ie-blank-bg" bind:value={blankBg} ariaLabel="Canvas background color" fallback="#ffffff" />
            {/if}
          </div>
          <div>
            <button class="btn btn-primary" type="submit" data-testid="ie-blank-create">Create canvas</button>
          </div>
        </form>
      </Card>
    </div>
    <p class="muted small">
      Session-only: edits live in this tab and are discarded when you leave —
      export what you want to keep. Nothing is uploaded or stored.
    </p>
  {:else}
    <div class="editor-grid">
      <div class="stack">
        <Card title="Canvas">
          <div class="stack">
            <div class="row wrap toolbar">
              <span class="muted small" data-testid="ie-info">
                {doc.width} × {doc.height}px · {Math.round(zoom * 100)}%
              </span>
              <span class="row">
                <button
                  class="btn btn-sm"
                  data-testid="ie-undo"
                  aria-label="Undo"
                  title="Undo (ctrl+z)"
                  disabled={!canUndo(history)}
                  onclick={undo}
                >
                  ↶
                </button>
                <button
                  class="btn btn-sm"
                  data-testid="ie-redo"
                  aria-label="Redo"
                  title="Redo (ctrl+y)"
                  disabled={!canRedo(history)}
                  onclick={redo}
                >
                  ↷
                </button>
                <button class="btn btn-sm" data-testid="ie-zoom-out" aria-label="Zoom out" onclick={() => zoomBy(1 / 1.25)}>−</button>
                <button class="btn btn-sm" data-testid="ie-zoom-in" aria-label="Zoom in" onclick={() => zoomBy(1.25)}>+</button>
                <button class="btn btn-sm" data-testid="ie-zoom-fit" onclick={fitZoom}>Fit</button>
                <button class="btn btn-sm" data-testid="ie-zoom-100" onclick={() => (zoom = 1)}>100%</button>
              </span>
            </div>
            <div class="canvas-scroll checkerboard" bind:this={scrollEl}>
              <canvas
                bind:this={displayEl}
                data-testid="ie-canvas"
                class="display"
                class:crosshair={tool !== 'move'}
                style={`width: ${doc.width * zoom}px; height: ${doc.height * zoom}px;`}
                onpointerdown={onPointerDown}
                onpointermove={onPointerMove}
                onpointerup={onPointerUp}
                onpointercancel={onPointerUp}
                aria-label="Image editing canvas"
              ></canvas>
            </div>
            <div class="row wrap">
              <form class="row wrap" onsubmit={applyCanvasSize} aria-label="Canvas size">
                <div>
                  <label for="ie-canvas-w">Canvas width</label>
                  <input id="ie-canvas-w" data-testid="ie-canvas-w" class="num" type="number" min="1" max="8192" bind:value={canvasForm.w} />
                </div>
                <div>
                  <label for="ie-canvas-h">Canvas height</label>
                  <input id="ie-canvas-h" data-testid="ie-canvas-h" class="num" type="number" min="1" max="8192" bind:value={canvasForm.h} />
                </div>
                <button class="btn btn-sm" type="submit" data-testid="ie-canvas-resize">Resize canvas</button>
              </form>
              <label class="add-image btn btn-sm">
                Add image layer
                <input
                  data-testid="ie-add-image"
                  type="file"
                  accept=".svg,.avif,.webp,.tif,.tiff,.png,.jpg,.jpeg,image/svg+xml,image/avif,image/webp,image/tiff,image/png,image/jpeg"
                  onchange={onPick}
                />
              </label>
              {#if pendingCrop}
                <button class="btn btn-sm btn-primary" data-testid="ie-apply-crop" onclick={applyCrop}>Apply crop</button>
                <button class="btn btn-sm" data-testid="ie-cancel-crop" onclick={() => (pendingCrop = null)}>Cancel</button>
              {/if}
            </div>
            {#if decodeErr}
              <p class="error" data-testid="ie-error" role="alert">{decodeErr}</p>
            {/if}
          </div>
        </Card>

        <Card title="Export">
          <div class="stack">
            <div class="row wrap">
              <div class="grow">
                <label for="ie-export-name">File name</label>
                <input id="ie-export-name" data-testid="ie-export-name" bind:value={exportName} />
              </div>
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
              <button class="btn btn-primary" data-testid="ie-download" disabled={busy} onclick={doExport}>
                Download {exportFileName()}
              </button>
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
                    else cropForm = pendingCrop ? { ...pendingCrop } : { x: 0, y: 0, w: doc!.width, h: doc!.height };
                  }}
                >
                  {t.label}
                </button>
              {/each}
            </div>
            <p class="muted small" data-testid="ie-target">
              New marks apply to {targetLabel}.
              {#if selected}
                <button class="link" data-testid="ie-deselect" onclick={() => (selectedId = null)}>Deselect</button>
              {/if}
            </p>

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
                <p class="muted small self-end">Under a layer it erases just that layer; at top level it erases everything below.</p>
              </div>
            {:else if tool === 'restore'}
              <div class="row">
                <div>
                  <label for="ie-size-r">Size</label>
                  <input id="ie-size-r" data-testid="ie-size" class="num" type="number" min="1" max="200" bind:value={toolSize} />
                </div>
                <p class="muted small self-end">
                  Un-erase: paints back the original pixels wherever you brush, so it undoes part of an
                  eraser stroke or part of a removed background. It has to sit ABOVE the eraser or mask
                  it is reversing — a fresh stroke does, and you can drag it in the layer list.
                </p>
              </div>
            {:else if tool === 'darken' || tool === 'lighten' || tool === 'blur'}
              <div class="grow">
                <label for="ie-amount">Strength ({adjustAmount})</label>
                <input id="ie-amount" data-testid="ie-amount" type="range" min="1" max="100" bind:value={adjustAmount} />
                <p class="muted small">Drag a rectangle on the image to apply.</p>
              </div>
            {:else if tool === 'crop'}
              <p class="muted small">Drag a rectangle (or type one below), then “Apply crop”. A crop is a layer: under an image it crops just that image; at top level it crops everything below. Delete it to un-crop.</p>
              <form class="row wrap" onsubmit={stageNumericCrop} aria-label="Crop rectangle">
                <div>
                  <label for="ie-crop-x">X</label>
                  <input id="ie-crop-x" data-testid="ie-crop-x" class="num" type="number" min="0" max={doc.width} bind:value={cropForm.x} />
                </div>
                <div>
                  <label for="ie-crop-y">Y</label>
                  <input id="ie-crop-y" data-testid="ie-crop-y" class="num" type="number" min="0" max={doc.height} bind:value={cropForm.y} />
                </div>
                <div>
                  <label for="ie-crop-w">Width</label>
                  <input id="ie-crop-w" data-testid="ie-crop-w" class="num" type="number" min="1" max={doc.width} bind:value={cropForm.w} />
                </div>
                <div>
                  <label for="ie-crop-h">Height</label>
                  <input id="ie-crop-h" data-testid="ie-crop-h" class="num" type="number" min="1" max={doc.height} bind:value={cropForm.h} />
                </div>
                <button class="btn btn-sm" type="submit" data-testid="ie-crop-stage">Set</button>
              </form>
            {:else if tool === 'move'}
              <p class="muted small">Click a layer on the canvas to select it; drag to move (an image carries its sub-layers).</p>
            {/if}

            {#if tool === 'text'}
              <div>
                <label for="ie-text">Text to place</label>
                <input id="ie-text" data-testid="ie-text" maxlength="120" bind:value={textDraft} />
              </div>
            {/if}
          </div>
        </Card>

        <Card title="Layers">
          <div class="stack">
            <div class="row wrap">
              <button class="btn btn-sm" data-testid="ie-add-fill" onclick={addFillLayer}>+ Color fill</button>
              <button class="btn btn-sm" data-testid="ie-add-group" onclick={addGroup}>+ Group</button>
              {#if selected}
                <button class="btn btn-sm" data-testid="ie-wrap-group" onclick={wrapInGroup}>Wrap selected in group</button>
              {/if}
            </div>
            {#if layers.length === 0}
              <p class="muted small">No layers yet — add an image, a color fill, a group, draw, drop an arrow, place text, or select a region.</p>
            {:else}
              {#snippet layerRows(list: RasterLayer[], depth: number)}
                <!-- Top-first, children listed under (and indented from) their parent. -->
                {#each [...list].reverse() as layer (layer.id)}
                  <li
                    class="layer-row"
                    class:active={layer.id === selectedId}
                    class:drop-above={dropHint === 'above:' + layer.id}
                    class:drop-below={dropHint === 'below:' + layer.id}
                    class:drop-into={dropHint === 'into:' + layer.id}
                    class:hidden-layer={!layer.visible}
                    class:is-group={layer.kind === 'group'}
                    style={`margin-left: calc(${depth} * var(--space-5));`}
                    data-testid="ie-layer"
                    data-layer-id={layer.id}
                    data-depth={depth}
                    use:draggable={{
                      data: { kind: 'layer', id: layer.id },
                      label: layerLabel(layer),
                      handle: '.grip',
                      onStart: (d) => (dragLayerId = d.id),
                      onEnd: onDragEnd,
                    }}
                    use:dropzone={{
                      accepts: (d) => d.kind === 'layer',
                      onOver: (d, e) => onRowDragOver(e, d, layer),
                      onLeave: () => {
                        if (dropHint?.endsWith(':' + layer.id)) dropHint = null;
                      },
                      onDrop: (d, e) => onRowDrop(e, d, layer),
                    }}
                  >
                    <span class="grip" title="Drag to reorder">⠿</span>
                    <button
                      class="layer-name"
                      data-testid="ie-layer-select"
                      aria-pressed={layer.id === selectedId}
                      title={layerLabel(layer)}
                      onclick={() => (selectedId = layer.id)}
                    >
                      {#if layer.kind === 'group'}
                        <span class="kind-glyph" aria-hidden="true">▣</span>
                      {:else if layer.kind === 'fill'}
                        <span class="dot" style={`background:${layer.color}`}></span>
                      {:else}
                        <span class="dot" style={`background:${'color' in layer ? layer.color : 'transparent'}`}></span>
                      {/if}
                      <span class="name-text">{layerLabel(layer)}</span>
                      {#if layer.opacity < 100 || layer.blend !== 'normal'}
                        <span class="muted small meta">{layer.opacity}%{layer.blend !== 'normal' ? ' ' + layer.blend : ''}</span>
                      {/if}
                    </button>
                    <span class="row layer-actions">
                      <button class="mini" title={layer.visible ? 'Hide' : 'Show'} aria-label={layer.visible ? 'Hide layer' : 'Show layer'} aria-pressed={!layer.visible} data-testid="ie-layer-vis" onclick={() => toggleVisible(layer)}>{layer.visible ? '👁' : '—'}</button>
                      <button class="mini" title="Move up" aria-label="Move layer up" data-testid="ie-layer-up" onclick={() => nudgeLayer(layer.id, 1)}>▲</button>
                      <button class="mini" title="Move down" aria-label="Move layer down" data-testid="ie-layer-down" onclick={() => nudgeLayer(layer.id, -1)}>▼</button>
                      {#if canNestBelow(layer.id)}
                        <button class="mini" title="Nest under the layer below" aria-label="Nest under the layer below" data-testid="ie-layer-nest" onclick={() => nestLayer(layer.id)}>⤵</button>
                      {/if}
                      {#if depth > 0}
                        <button class="mini" title="Move out of the parent" aria-label="Move out of the parent" data-testid="ie-layer-unnest" onclick={() => unnestLayer(layer.id)}>⤴</button>
                      {/if}
                      <button class="mini" title="Delete layer" aria-label="Delete layer" data-testid="ie-layer-delete" onclick={() => deleteLayer(layer.id)}>✕</button>
                    </span>
                  </li>
                  {#if layer.children.length > 0}
                    {@render layerRows(layer.children, depth + 1)}
                  {:else if layer.kind === 'group'}
                    <li class="empty-group muted small" style={`margin-left: calc(${depth + 1} * var(--space-5));`}>
                      (empty group — drop layers onto it)
                    </li>
                  {/if}
                {/each}
              {/snippet}
              <ul class="layers" data-testid="ie-layers">
                {@render layerRows(layers, 0)}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <li
                  class="drop-bottom"
                  class:visible={dragLayerId !== null}
                  class:drop-target={dropHint === 'bottom'}
                  data-testid="ie-drop-bottom"
                  use:dropzone={{
                    accepts: (d) => d.kind === 'layer',
                    onOver: () => (dropHint = 'bottom'),
                    onLeave: () => {
                      if (dropHint === 'bottom') dropHint = null;
                    },
                    onDrop: dropBottom,
                  }}
                >
                  ↳ drop here to send to the bottom
                </li>
              </ul>
              <p class="muted small">
                Drag a row: drop on the top/bottom edge of another row to place it above/below, or on its
                middle to nest it inside (⤵/⤴ do the same from the keyboard). Effects (eraser, crop, blur…)
                under a layer apply only to it; at top level they apply to everything below. Groups hold
                any layers, images included.
              </p>
              <button class="btn btn-sm" data-testid="ie-clear-layers" onclick={clearLayers}>Remove all</button>
            {/if}
          </div>
        </Card>

        {#if selected}
          <Card title="Layer settings">
            <div class="stack" data-testid="ie-selected">
              <div class="row wrap">
                <div class="grow">
                  <label for="ie-sel-name">Name</label>
                  <input id="ie-sel-name" data-testid="ie-sel-name" bind:value={selected.name} />
                </div>
                <div class="grow">
                  <label for="ie-sel-opacity">Opacity ({selected.opacity}%)</label>
                  <input id="ie-sel-opacity" data-testid="ie-sel-opacity" type="range" min="0" max="100" bind:value={selected.opacity} />
                </div>
                <div>
                  <label for="ie-sel-blend">Blend mode</label>
                  <select id="ie-sel-blend" data-testid="ie-sel-blend" bind:value={selected.blend}>
                    {#each BLEND_MODES as m (m.id)}
                      <option value={m.id} title={m.hint}>{m.label}</option>
                    {/each}
                  </select>
                </div>
              </div>
              <p class="muted small">{BLEND_MODES.find((m) => m.id === selected!.blend)?.hint}</p>

              {#if selected.kind === 'image'}
                <div class="row wrap">
                  <div>
                    <label for="ie-sel-x">X</label>
                    <input id="ie-sel-x" data-testid="ie-sel-x" class="num" type="number" bind:value={selected.x} />
                  </div>
                  <div>
                    <label for="ie-sel-y">Y</label>
                    <input id="ie-sel-y" data-testid="ie-sel-y" class="num" type="number" bind:value={selected.y} />
                  </div>
                  <div>
                    <label for="ie-sel-w">Width</label>
                    <input id="ie-sel-w" data-testid="ie-sel-w" class="num" type="number" min="1" bind:value={selected.width} />
                  </div>
                  <div>
                    <label for="ie-sel-h">Height</label>
                    <input id="ie-sel-h" data-testid="ie-sel-h" class="num" type="number" min="1" bind:value={selected.height} />
                  </div>
                  <button class="btn btn-sm" data-testid="ie-rotate-cw" onclick={rotateSelected}>⟳ Rotate 90°</button>
                </div>
                <p class="muted small">
                  With the Move tool, drag the square handles on the canvas to scale: corners keep the aspect
                  ratio, edges stretch one axis. Sub-layers scale with the image.
                </p>
                <div class="row wrap">
                  <button
                    class="btn btn-sm"
                    data-testid="ie-remove-bg"
                    onclick={removeBackgroundForSelected}
                    disabled={bgBusy}
                  >
                    {bgBusy ? 'Removing background…' : 'Remove background'}
                  </button>
                  <span class="muted small self-end" aria-live="polite" data-testid="ie-bg-status">
                    {bgStatus ?? ''}
                  </span>
                </div>
                <p class="muted small">
                  Adds a mask under this image, so only this layer is cut out — delete the mask to bring
                  the background back. The first run downloads the model (~15.8 MB), the same one the
                  <a href={href('/tools/background-remover/')}>background remover</a> uses.
                </p>
              {:else if selected.kind === 'text'}
                <div class="row wrap">
                  <div>
                    <label for="ie-sel-x">X</label>
                    <input id="ie-sel-x" data-testid="ie-sel-x" class="num" type="number" bind:value={selected.x} />
                  </div>
                  <div>
                    <label for="ie-sel-y">Y</label>
                    <input id="ie-sel-y" data-testid="ie-sel-y" class="num" type="number" bind:value={selected.y} />
                  </div>
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
                  <div>
                    <label for="ie-sel-x1">From X</label>
                    <input id="ie-sel-x1" data-testid="ie-sel-x1" class="num" type="number" bind:value={selected.from.x} />
                  </div>
                  <div>
                    <label for="ie-sel-y1">From Y</label>
                    <input id="ie-sel-y1" data-testid="ie-sel-y1" class="num" type="number" bind:value={selected.from.y} />
                  </div>
                  <div>
                    <label for="ie-sel-x2">To X</label>
                    <input id="ie-sel-x2" data-testid="ie-sel-x2" class="num" type="number" bind:value={selected.to.x} />
                  </div>
                  <div>
                    <label for="ie-sel-y2">To Y</label>
                    <input id="ie-sel-y2" data-testid="ie-sel-y2" class="num" type="number" bind:value={selected.to.y} />
                  </div>
                  <ColorField testid="ie-sel-color" bind:value={selected.color} ariaLabel="Arrow color" fallback="#e11d48" />
                  <div>
                    <label for="ie-sel-asize">Size</label>
                    <input id="ie-sel-asize" data-testid="ie-sel-size" class="num" type="number" min="1" max="200" bind:value={selected.size} />
                  </div>
                </div>
              {:else if selected.kind === 'fill'}
                <div class="row wrap">
                  <ColorField testid="ie-sel-color" bind:value={selected.color} ariaLabel="Fill color" fallback="#ffffff" />
                  <p class="muted small self-end">
                    Covers the whole canvas. Nested under a layer it tints only that layer.
                  </p>
                </div>
              {:else if selected.kind === 'group'}
                <p class="muted small">
                  {selected.children.length} layer{selected.children.length === 1 ? '' : 's'} inside. New marks
                  go into this group while it is selected; drop rows onto it to move them in.
                </p>
              {:else if selected.kind === 'stroke'}
                <div class="row wrap">
                  {#if selected.mode === 'paint'}
                    <ColorField testid="ie-sel-color" bind:value={selected.color} ariaLabel="Stroke color" fallback="#e11d48" />
                  {/if}
                  <div>
                    <label for="ie-sel-ssize">Size</label>
                    <input id="ie-sel-ssize" data-testid="ie-sel-size" class="num" type="number" min="1" max="200" bind:value={selected.size} />
                  </div>
                </div>
              {:else if selected.kind === 'mask'}
                <label class="check">
                  <input type="checkbox" data-testid="ie-mask-invert" bind:checked={selected.invert} />
                  Keep the background instead of the subject
                </label>
                <p class="muted small">
                  A cut-out mask from the background remover. It clips whatever it sits under; delete it
                  to bring the background back.
                </p>
              {:else if selected.kind === 'adjust'}
                <div class="row wrap">
                  <div class="grow">
                    <label for="ie-sel-amount">Strength ({selected.amount})</label>
                    <input id="ie-sel-amount" data-testid="ie-sel-amount" type="range" min="1" max="100" bind:value={selected.amount} />
                  </div>
                </div>
              {/if}
              {#if selected.kind === 'adjust' || selected.kind === 'crop' || selected.kind === 'mask'}
                <div class="row wrap">
                  <div>
                    <label for="ie-sel-rx">X</label>
                    <input id="ie-sel-rx" data-testid="ie-sel-rx" class="num" type="number" bind:value={selected.rect.x} />
                  </div>
                  <div>
                    <label for="ie-sel-ry">Y</label>
                    <input id="ie-sel-ry" data-testid="ie-sel-ry" class="num" type="number" bind:value={selected.rect.y} />
                  </div>
                  <div>
                    <label for="ie-sel-rw">Width</label>
                    <input id="ie-sel-rw" data-testid="ie-sel-rw" class="num" type="number" min="1" bind:value={selected.rect.w} />
                  </div>
                  <div>
                    <label for="ie-sel-rh">Height</label>
                    <input id="ie-sel-rh" data-testid="ie-sel-rh" class="num" type="number" min="1" bind:value={selected.rect.h} />
                  </div>
                </div>
              {/if}
              <button class="btn btn-sm btn-danger" data-testid="ie-sel-delete" onclick={() => deleteLayer(selected!.id)}>
                Delete layer
              </button>
            </div>
          </Card>
        {/if}

        <Card title="Metadata (EXIF)">
          <div class="stack">
            {#if exifRows.length === 0}
              <p class="muted small" data-testid="ie-exif-empty">
                {sourceName ? 'No readable metadata in the base image.' : 'A blank canvas has no source metadata.'}
              </p>
            {:else}
              <details data-testid="ie-exif-details">
                <summary>{exifRows.length} metadata fields ({sourceName})</summary>
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
      Everything runs on this device — images are never uploaded, and this editor
      never stores them: the session lives only in this tab. Layers stack bottom to
      top; an effect layer (eraser, crop, darken/lighten/blur) nested under a layer
      changes only that layer, while the same effect at top level changes everything
      below it. Re-encoding on export strips all original metadata by default; the
      EXIF panel can embed the four common tags (artist, copyright, description,
      date) into JPG exports, and GPS data can never pass through. PNG exports always
      carry no metadata.
    </p>
  </Explainer>
</div>

<style>
  .editor-grid {
    display: grid;
    grid-template-columns: minmax(0, 3fr) minmax(18rem, 2fr);
    gap: var(--space-4);
    align-items: start;
  }

  @media (max-width: 56rem) {
    .editor-grid {
      grid-template-columns: 1fr;
    }
  }

  .toolbar {
    justify-content: space-between;
    align-items: center;
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
    display: block;
    touch-action: none;
    user-select: none;
    cursor: default;
    image-rendering: auto;
  }

  .display.crosshair {
    cursor: crosshair;
  }

  .tool-active {
    border-color: var(--color-primary);
    color: var(--color-primary);
  }

  .add-image {
    position: relative;
    overflow: hidden;
    cursor: pointer;
    text-transform: none;
    letter-spacing: normal;
  }

  .add-image input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }

  .link {
    background: none;
    border: none;
    padding: 0;
    color: var(--color-primary);
    cursor: pointer;
    text-decoration: underline;
    font-size: inherit;
  }

  .layers {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 22rem;
    overflow-y: auto;
    /* Long file names must never widen the panel — they truncate. */
    overflow-x: hidden;
  }

  .layer-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-1);
    border: 1px solid var(--border-color);
    padding: 2px var(--space-1) 2px var(--space-2);
    cursor: grab;
    min-width: 0;
  }

  .layer-row.is-group {
    border-style: dashed;
  }

  .layer-row.active {
    border-color: var(--color-primary);
  }

  .layer-row.hidden-layer .layer-name {
    opacity: 0.5;
  }

  /* Drop-zone feedback: a line above/below, or a highlighted row for "into". */
  .layer-row.drop-above {
    box-shadow: 0 -3px 0 var(--color-primary);
  }

  .layer-row.drop-below {
    box-shadow: 0 3px 0 var(--color-primary);
  }

  .layer-row.drop-into {
    border-color: var(--color-primary);
    background: var(--color-primary-soft);
  }

  .grip {
    /* The handle owns the touch gesture, so a finger can drag a layer while
       the rest of the list still scrolls. */
    touch-action: none;
    cursor: grab;
    color: var(--text-muted-color);
    flex: none;
    font-size: var(--font-size-sm);
    cursor: grab;
  }

  .empty-group {
    padding: 1px var(--space-2);
    border-left: 1px dashed var(--border-color);
  }

  .drop-bottom {
    display: none;
    padding: 1px var(--space-2);
    font-size: var(--font-size-sm);
    color: var(--text-muted-color);
    border: 1px dashed var(--border-color);
  }

  .drop-bottom.visible {
    display: block;
  }

  .drop-bottom.drop-target {
    border-color: var(--color-primary);
    color: var(--color-primary);
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
    flex: 1 1 auto;
    text-align: left;
    min-width: 0;
    overflow: hidden;
  }

  .name-text {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta {
    flex: none;
    white-space: nowrap;
  }

  .kind-glyph {
    flex: none;
    color: var(--text-muted-color);
  }

  .dot {
    width: 0.85rem;
    height: 0.85rem;
    border-radius: var(--radius-full);
    border: 1px solid var(--border-color);
    flex: none;
  }

  .layer-actions {
    gap: 2px;
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
