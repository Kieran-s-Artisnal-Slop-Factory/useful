<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import Card from '../Card.svelte';
  import ColorField from '../ColorField.svelte';
  import Explainer from '../Explainer.svelte';
  import { all, get, getSingleton, patch, put, putSingleton, softDelete, withSyncFields } from '../../lib/db/repo';
  import type { Preferences, SvgDocument } from '../../lib/db/types';
  import { buildSvg, looksLikeSvg, subtractLayers, svgDataUri } from '../../lib/svg/build';
  import {
    MAX_CANVAS,
    MIN_CANVAS,
    clampCanvas,
    defaultDocumentContent,
    newLayer,
    normalizeDocumentContent,
    regularPolygonPoints,
    type SvgDocumentContent,
    type SvgLayer,
    type SvgLayerKind,
    type SvgPoint,
  } from '../../lib/svg/model';
  import {
    canRedo,
    canUndo,
    createHistory,
    push,
    redo,
    undo,
    type History,
  } from '../../lib/svg/history';
  import { copyPng, copyText, downloadBlob, downloadText } from '../../lib/exportFile';
  import { decodeToCanvas, encodeCanvas, scaleCanvas, type TargetFormat } from '../../lib/img/convert';

  const KINDS: { kind: SvgLayerKind; label: string }[] = [
    { kind: 'rect', label: '▢ Rect' },
    { kind: 'circle', label: '◯ Ellipse' },
    { kind: 'triangle', label: '△ Triangle' },
    { kind: 'star', label: '☆ Star' },
    { kind: 'line', label: '╱ Line' },
    { kind: 'polygon', label: '⬠ Polygon' },
    { kind: 'text', label: 'A Text' },
    { kind: 'svg', label: '</> Paste SVG' },
  ];

  // ---- documents browser ----
  let docs = $state<SvgDocument[]>([]);
  let loading = $state(true);
  let newName = $state('');

  // ---- open document ----
  let current = $state<SvgDocument | null>(null);
  let content = $state<SvgDocumentContent | null>(null);
  let history = $state<History<SvgDocumentContent>>(createHistory(defaultDocumentContent('')));
  let selectedId = $state<string | null>(null);
  let selectedVertex = $state<number | null>(null);
  let saveState = $state<'saved' | 'saving' | 'error' | null>(null);
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  // ---- export ----
  let exportFormat = $state<'svg' | TargetFormat>('svg');
  let exportWidth = $state(256);
  let exportQuality = $state(85);
  let feedback = $state<string | null>(null);
  let feedbackTimer: ReturnType<typeof setTimeout> | undefined;

  const selected = $derived(content?.layers.find((l) => l.id === selectedId) ?? null);
  const built = $derived(content ? buildSvg(content) : '');
  const exportHeight = $derived(
    content ? Math.max(1, Math.round((exportWidth * content.height) / content.width)) : 0
  );
  /** Handle radius in canvas units, so handles stay grabbable at any zoom. */
  const handleR = $derived(content ? Math.max(3, Math.max(content.width, content.height) / 56) : 4);

  // Set synchronously at teardown so the async mount continuation below can't
  // resurrect state (or register listeners) into a destroyed island — with
  // ClientRouter the window outlives every page.
  let destroyed = false;

  onMount(() => {
    // Listeners go on BEFORE any await, so onDestroy always has something to
    // remove; a hard unload (F5, tab close, PWA window close) skips onDestroy,
    // so pagehide/visibilitychange flush the debounced save too.
    window.addEventListener('keydown', onKeydown);
    window.addEventListener('pagehide', flushSave);
    document.addEventListener('visibilitychange', onVisibility);
    void (async () => {
      await refreshDocs();
      // Resume the last-open document (reads only — no writes on load).
      const prefs = await getSingleton<Preferences>('preferences');
      if (destroyed) return;
      if (typeof prefs?.svg_last_doc_id === 'string' && !current) {
        const doc = await get<SvgDocument>('svg_documents', prefs.svg_last_doc_id);
        if (destroyed) return;
        if (doc) openDoc(doc, { remember: false });
      }
      loading = false;
    })();
  });

  onDestroy(() => {
    destroyed = true;
    window.removeEventListener('keydown', onKeydown);
    window.removeEventListener('pagehide', flushSave);
    document.removeEventListener('visibilitychange', onVisibility);
    flushSave();
  });

  function onVisibility() {
    if (document.visibilityState === 'hidden') flushSave();
  }

  async function refreshDocs() {
    const rows = await all<SvgDocument>('svg_documents');
    if (destroyed) return;
    docs = rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  // ---- document lifecycle ---------------------------------------------------

  async function createDoc(e: Event) {
    e.preventDefault();
    const name = newName.trim() || 'Untitled';
    const row = await put<SvgDocument>('svg_documents', withSyncFields(defaultDocumentContent(name)));
    newName = '';
    await refreshDocs();
    openDoc(row);
  }

  function openDoc(doc: SvgDocument, opts: { remember?: boolean } = {}) {
    flushSave();
    current = doc;
    content = normalizeDocumentContent(doc);
    history = createHistory(content);
    selectedId = null;
    selectedVertex = null;
    saveState = 'saved';
    exportWidth = content.width;
    if (opts.remember !== false) {
      void putSingleton<Partial<Preferences>>('preferences', { svg_last_doc_id: doc.id });
    }
  }

  async function closeDoc() {
    flushSave();
    current = null;
    content = null;
    selectedId = null;
    saveState = null;
    await refreshDocs();
  }

  async function deleteDoc(doc: SvgDocument) {
    if (!confirm(`Delete "${doc.name}"?`)) return;
    if (current?.id === doc.id) {
      clearTimeout(saveTimer);
      saveTimer = undefined;
      current = null;
      content = null;
      saveState = null;
    }
    await softDelete('svg_documents', doc.id);
    await refreshDocs();
  }

  // ---- history + persistence ------------------------------------------------

  /**
   * Record the current content as one undo step and schedule a save. The
   * content is sanitized first (an emptied number input binds `null`; a
   * canvas size typed mid-way may be out of range) — invalid values revert to
   * the last committed state, so history and the database only ever hold
   * well-formed documents.
   */
  function commit() {
    if (!content) return;
    const clean = normalizeDocumentContent(content, history.present);
    if (JSON.stringify(clean) !== JSON.stringify(content)) {
      // Write the healed values back so the bound inputs show them.
      content.width = clean.width;
      content.height = clean.height;
      content.layers.forEach((l, i) => Object.assign(l, clean.layers[i]));
    }
    const next = push(history, clean);
    if (next === history) return; // gesture changed nothing
    history = next;
    if (selectedVertex !== null && selected && selectedVertex >= selected.points.length) {
      selectedVertex = null;
    }
    scheduleSave();
  }

  function applyHistory(h: History<SvgDocumentContent>) {
    if (h === history || !content) return;
    history = h;
    content = JSON.parse(JSON.stringify(h.present)) as SvgDocumentContent;
    // Vertex indices are meaningless across snapshots (a point may not exist).
    selectedVertex = null;
    scheduleSave();
  }

  function scheduleSave() {
    saveState = 'saving';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void doSave(), 400);
  }

  function flushSave() {
    if (saveTimer === undefined) return;
    clearTimeout(saveTimer);
    saveTimer = undefined;
    void doSave();
  }

  async function doSave() {
    saveTimer = undefined;
    if (!current || !content) return;
    const id = current.id;
    // Persist the last COMMITTED snapshot, never the live bound values — a
    // field mid-edit (typed "2" on the way to "2048") must not be flushed.
    const c = history.present;
    const row = await patch<SvgDocument>('svg_documents', id, {
      name: c.name,
      width: c.width,
      height: c.height,
      background: c.background,
      layers: c.layers,
    });
    // The user may have closed this document or opened another while the
    // write was in flight — only touch state if it is still the open one.
    if (destroyed || current?.id !== id) return;
    if (!row) {
      saveState = 'error';
      return;
    }
    current = row;
    saveState = 'saved';
  }

  // ---- layer operations -----------------------------------------------------

  function addLayer(kind: SvgLayerKind) {
    if (!content) return;
    const layer = newLayer(kind, content.width, content.height);
    content.layers.push(layer);
    selectedId = layer.id;
    selectedVertex = null;
    commit();
  }

  function removeLayer(id: string) {
    if (!content) return;
    const i = content.layers.findIndex((l) => l.id === id);
    if (i < 0) return;
    content.layers.splice(i, 1);
    if (selectedId === id) selectedId = null;
    commit();
  }

  /** Move a layer up/down the stack (higher index = drawn on top). */
  function shiftLayer(id: string, delta: 1 | -1) {
    if (!content) return;
    const i = content.layers.findIndex((l) => l.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= content.layers.length) return;
    const [layer] = content.layers.splice(i, 1);
    content.layers.splice(j, 0, layer!);
    commit();
  }

  function layerLabel(layer: SvgLayer): string {
    if (layer.kind === 'text') return `“${layer.text}”`;
    if (layer.kind === 'svg') return 'pasted SVG';
    if (layer.kind === 'circle') return 'ellipse';
    return layer.kind;
  }

  function setCurve(mode: 'straight' | 'quadratic' | 'cubic') {
    if (!selected || selected.kind !== 'line') return;
    const span = Math.max(24, Math.abs((selected.points[1]?.x ?? 0) - (selected.points[0]?.x ?? 0)));
    if (mode === 'straight') {
      selected.c1 = null;
      selected.c2 = null;
    } else if (mode === 'quadratic') {
      selected.c1 = selected.c1 ?? { x: 0, y: -Math.round(span / 2) };
      selected.c2 = null;
    } else {
      selected.c1 = selected.c1 ?? { x: -Math.round(span / 4), y: -Math.round(span / 2) };
      selected.c2 = selected.c2 ?? { x: Math.round(span / 4), y: Math.round(span / 2) };
    }
    commit();
  }

  const curveMode = $derived(
    selected?.kind === 'line' ? (selected.c1 && selected.c2 ? 'cubic' : selected.c1 ? 'quadratic' : 'straight') : 'straight'
  );

  /** The selected vertex index, or the last vertex when none/stale is selected. */
  function vertexIndex(pts: { length: number }): number {
    return selectedVertex !== null && selectedVertex < pts.length ? selectedVertex : pts.length - 1;
  }

  function addVertex() {
    if (!selected || selected.kind !== 'polygon' || selected.points.length === 0) return;
    const pts = selected.points;
    const i = vertexIndex(pts);
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    pts.splice(i + 1, 0, { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) });
    selectedVertex = i + 1;
    commit();
  }

  function removeVertex() {
    if (!selected || selected.kind !== 'polygon' || selected.points.length <= 3) return;
    selected.points.splice(vertexIndex(selected.points), 1);
    selectedVertex = null;
    commit();
  }

  /** Toggle a bezier control on the edge leaving the selected vertex. */
  function toggleVertexCurve() {
    if (!selected || selected.kind !== 'polygon' || selected.points.length < 2) return;
    const i = vertexIndex(selected.points);
    const v = selected.points[i]!;
    if (v.c) {
      delete v.c;
    } else {
      // Start the control at the edge midpoint, pushed outward from the
      // center so the curve is visibly bowed rather than a straight edge.
      const n = selected.points[(i + 1) % selected.points.length]!;
      const mx = (v.x + n.x) / 2;
      const my = (v.y + n.y) / 2;
      const len = Math.hypot(mx, my) || 1;
      const push = Math.max(12, Math.min(selected.width, selected.height) * 0.25);
      v.c = { x: Math.round(mx + (mx / len) * push), y: Math.round(my + (my / len) * push) };
    }
    selectedVertex = i;
    commit();
  }

  const selectedVertexCurved = $derived(
    selected?.kind === 'polygon' && selectedVertex !== null ? !!selected.points[selectedVertex]?.c : false
  );

  /**
   * Boolean subtract: bake (selected − cutter) into a pasted-SVG layer that
   * replaces the selected layer; the cutter is consumed (one undo step).
   */
  function subtractWith(cutterId: string) {
    if (!content || !selected || !cutterId || cutterId === selected.id) return;
    const cutter = content.layers.find((l) => l.id === cutterId);
    if (!cutter) return;
    const baked = subtractLayers(selected, cutter);
    const bi = content.layers.findIndex((l) => l.id === selected!.id);
    content.layers.splice(bi, 1, baked);
    const ci = content.layers.findIndex((l) => l.id === cutterId);
    if (ci >= 0) content.layers.splice(ci, 1);
    selectedId = baked.id;
    selectedVertex = null;
    commit();
  }

  function resetPolygon(sides: number) {
    if (!selected || selected.kind !== 'polygon') return;
    selected.points = regularPolygonPoints(sides, selected.width, selected.height);
    selectedVertex = null;
    commit();
  }

  function toggleFill(on: boolean) {
    if (!selected) return;
    selected.fill = on ? '#f59e0b' : 'none';
    commit();
  }

  function toggleStroke(on: boolean) {
    if (!selected) return;
    selected.stroke = on ? '#f59e0b' : 'none';
    if (on && selected.stroke_width <= 0) selected.stroke_width = 4;
    commit();
  }

  // ---- canvas pointer interactions ------------------------------------------

  let overlayEl: SVGSVGElement | undefined = $state();

  type Drag =
    | { mode: 'move'; dx: number; dy: number }
    | { mode: 'resize'; cx: number; cy: number; rot: number; ox: number; oy: number }
    | { mode: 'vertex'; index: number }
    | { mode: 'vctrl'; index: number }
    | { mode: 'ctrl'; which: 'c1' | 'c2' }
    | { mode: 'line-end'; index: number };
  let drag: Drag | null = null;
  let dragged = false;

  const rad = (deg: number) => (deg * Math.PI) / 180;
  const round1 = (n: number) => Math.round(n * 10) / 10;

  function rotatePt(px: number, py: number, cx: number, cy: number, deg: number) {
    const a = rad(deg);
    const dx = px - cx;
    const dy = py - cy;
    return { x: cx + dx * Math.cos(a) - dy * Math.sin(a), y: cy + dx * Math.sin(a) + dy * Math.cos(a) };
  }

  /** Pointer event → canvas coordinates (viewBox units). */
  function toCanvas(e: PointerEvent): { x: number; y: number } {
    const r = overlayEl!.getBoundingClientRect();
    if (!content || r.width === 0 || r.height === 0) return { x: 0, y: 0 };
    return {
      x: ((e.clientX - r.left) / r.width) * content.width,
      y: ((e.clientY - r.top) / r.height) * content.height,
    };
  }

  /** Topmost layer whose (rotation-aware) box contains the point. */
  function hitTest(x: number, y: number): SvgLayer | null {
    if (!content) return null;
    for (let i = content.layers.length - 1; i >= 0; i--) {
      const l = content.layers[i]!;
      const p = rotatePt(x, y, l.x, l.y, -l.rotation);
      // Box in the layer's unrotated frame, relative to its center.
      let minX = -l.width / 2;
      let maxX = l.width / 2;
      let minY = -l.height / 2;
      let maxY = l.height / 2;
      if (l.kind === 'line' || l.kind === 'polygon') {
        // Points/controls are one-sided after vertex drags — use the true
        // bounding box, not a box mirrored around the center.
        const pts: SvgPoint[] = [...l.points, ...[l.c1, l.c2].filter((c): c is SvgPoint => c !== null)];
        for (const v of l.points) if (v.c) pts.push(v.c);
        if (pts.length > 0) {
          minX = Math.min(...pts.map((pt) => pt.x));
          maxX = Math.max(...pts.map((pt) => pt.x));
          minY = Math.min(...pts.map((pt) => pt.y));
          maxY = Math.max(...pts.map((pt) => pt.y));
        }
      }
      const pad = Math.max(handleR, l.stroke !== 'none' ? l.stroke_width / 2 : 0);
      const rx = p.x - l.x;
      const ry = p.y - l.y;
      if (rx >= minX - pad && rx <= maxX + pad && ry >= minY - pad && ry <= maxY + pad) return l;
    }
    return null;
  }

  function onPointerDown(e: PointerEvent) {
    if (!content || !overlayEl) return;
    const p = toCanvas(e);
    dragged = false;
    const handle = (e.target as Element).closest('[data-handle]')?.getAttribute('data-handle');
    if (handle && selected) {
      const [kind, arg] = handle.split(':');
      if (kind === 'resize') {
        // Anchor the opposite corner: its position (in the layer's unrotated
        // frame) stays fixed while the dragged corner follows the pointer.
        const sx = arg!.includes('w') ? 1 : -1;
        const sy = arg!.includes('n') ? 1 : -1;
        drag = {
          mode: 'resize',
          cx: selected.x,
          cy: selected.y,
          rot: selected.rotation,
          ox: selected.x + (sx * selected.width) / 2,
          oy: selected.y + (sy * selected.height) / 2,
        };
      } else if (kind === 'vctrl') {
        drag = { mode: 'vctrl', index: Number(arg) };
        selectedVertex = Number(arg);
      } else if (kind === 'vertex') {
        drag = { mode: 'vertex', index: Number(arg) };
        selectedVertex = Number(arg);
      } else if (kind === 'ctrl') {
        drag = { mode: 'ctrl', which: arg as 'c1' | 'c2' };
      } else if (kind === 'line-end') {
        drag = { mode: 'line-end', index: Number(arg) };
      }
    } else {
      const hit = hitTest(p.x, p.y);
      selectedId = hit?.id ?? null;
      selectedVertex = null;
      if (hit) drag = { mode: 'move', dx: p.x - hit.x, dy: p.y - hit.y };
    }
    if (drag) {
      try {
        overlayEl.setPointerCapture(e.pointerId);
      } catch {
        /* uncapturable pointer — drag still works while over the canvas */
      }
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (!drag || !selected || !content) return;
    dragged = true;
    const p = toCanvas(e);
    if (drag.mode === 'move') {
      selected.x = round1(Math.min(content.width, Math.max(0, p.x - drag.dx)));
      selected.y = round1(Math.min(content.height, Math.max(0, p.y - drag.dy)));
    } else if (drag.mode === 'resize') {
      const u = rotatePt(p.x, p.y, drag.cx, drag.cy, -drag.rot);
      const w = Math.max(4, Math.abs(u.x - drag.ox));
      const h = Math.max(4, Math.abs(u.y - drag.oy));
      const mid = { x: (u.x + drag.ox) / 2, y: (u.y + drag.oy) / 2 };
      const c = rotatePt(mid.x, mid.y, drag.cx, drag.cy, drag.rot);
      selected.width = round1(w);
      selected.height = round1(h);
      selected.x = round1(c.x);
      selected.y = round1(c.y);
    } else {
      // Vertex/control/endpoint edits store coordinates relative to the layer
      // center, in its unrotated frame.
      const u = rotatePt(p.x, p.y, selected.x, selected.y, -selected.rotation);
      const rel = { x: round1(u.x - selected.x), y: round1(u.y - selected.y) };
      if (drag.mode === 'vertex') {
        const prev = selected.points[drag.index];
        selected.points[drag.index] = prev?.c ? { ...rel, c: prev.c } : rel;
      } else if (drag.mode === 'vctrl') {
        const v = selected.points[drag.index];
        if (v) v.c = rel;
      }
      else if (drag.mode === 'ctrl') selected[drag.which] = rel;
      else if (drag.mode === 'line-end') selected.points[drag.index] = rel;
    }
  }

  function onPointerUp() {
    if (!drag) return;
    drag = null;
    if (dragged) commit();
  }

  // ---- keyboard -------------------------------------------------------------

  function onKeydown(e: KeyboardEvent) {
    if (!content) return;
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select, [contenteditable]')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      applyHistory(e.shiftKey ? redo(history) : undo(history));
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      applyHistory(redo(history));
      return;
    }
    if (!selected) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      removeLayer(selected.id);
    } else if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      if (e.key === 'ArrowLeft') selected.x -= step;
      if (e.key === 'ArrowRight') selected.x += step;
      if (e.key === 'ArrowUp') selected.y -= step;
      if (e.key === 'ArrowDown') selected.y += step;
      commit();
    } else if (e.key === 'Escape') {
      selectedId = null;
    }
  }

  // ---- export ---------------------------------------------------------------

  function exportName(ext: string): string {
    const stem = (content?.name ?? 'drawing').trim().replace(/[\\/:*?"<>|]/g, '_') || 'drawing';
    return `${stem}.${ext}`;
  }

  async function rasterize(): Promise<HTMLCanvasElement> {
    // An emptied number input binds null — fall back to the canvas width.
    if (!Number.isFinite(exportWidth) || exportWidth < 16) exportWidth = content?.width ?? 256;
    exportWidth = Math.min(8192, Math.round(exportWidth));
    const file = new File([built], 'drawing.svg', { type: 'image/svg+xml' });
    // Rasterize AT the target width (crisp), then pin the exact height.
    const decoded = await decodeToCanvas(file, exportWidth);
    return scaleCanvas(decoded.canvas, exportWidth, exportHeight);
  }

  function flash(msg: string) {
    feedback = msg;
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => (feedback = null), 2000);
  }

  async function doExport() {
    if (!content) return;
    try {
      if (exportFormat === 'svg') {
        downloadText(built, exportName('svg'), 'image/svg+xml');
      } else {
        const canvas = await rasterize();
        const blob = await encodeCanvas(canvas, exportFormat, exportQuality);
        downloadBlob(blob, exportName(exportFormat));
      }
      flash('Downloaded');
    } catch {
      flash('Export failed');
    }
  }

  async function doCopy() {
    if (!content) return;
    try {
      if (exportFormat === 'svg') {
        flash((await copyText(built)) ? 'SVG copied as text' : 'Copy failed');
      } else {
        // Clipboard images are ALWAYS PNG (async clipboard API limitation).
        const canvas = await rasterize();
        const png = await encodeCanvas(canvas, 'png', 100);
        flash((await copyPng(png)) ? 'Copied as PNG' : 'Copy failed — try downloading instead');
      }
    } catch {
      flash('Copy failed');
    }
  }

  function onCanvasSize() {
    if (!content) return;
    content.width = clampCanvas(content.width);
    content.height = clampCanvas(content.height);
    commit();
  }
</script>

<div class="page-header">
  <h1>SVG editor</h1>
  {#if current}
    <button class="btn" data-testid="svg-close" onclick={closeDoc}>All documents</button>
  {/if}
</div>

{#if loading}
  <p class="muted">Loading…</p>
{:else if !current || !content}
  <div class="stack">
    <Card title="Documents">
      <div class="stack">
        <form class="row" onsubmit={createDoc}>
          <input
            data-testid="svg-new-name"
            placeholder="New document name"
            aria-label="New document name"
            bind:value={newName}
          />
          <button class="btn btn-primary" data-testid="svg-create" type="submit">Create</button>
        </form>
        {#if docs.length === 0}
          <p class="muted">No documents yet — create one to start drawing.</p>
        {:else}
          <ul class="doc-list">
            {#each docs as doc (doc.id)}
              <li data-testid="svg-doc">
                <button class="doc-name" data-testid="svg-doc-open" onclick={() => openDoc(doc)}>
                  {doc.name}
                </button>
                <span class="muted small">{doc.width} × {doc.height}</span>
                <button class="btn btn-sm btn-danger" data-testid="svg-doc-delete" onclick={() => deleteDoc(doc)}>
                  Delete
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </Card>

    <Explainer summary="How documents are stored" testid="explainer-svg">
      <p>
        Documents live in this browser's local database as plain layer data (never as
        rendered markup), so they reopen fully editable, survive restarts, and ride
        along in Settings → Backup. Exported SVG/PNG/JPG files are generated on
        demand and never stored.
      </p>
    </Explainer>
  </div>
{:else}
  <div class="editor-grid">
    <div class="stack">
      <Card title="Canvas">
        <div class="stack">
          <div
            class="canvas-wrap checkerboard"
            data-testid="svg-canvas"
            style={`aspect-ratio: ${content.width} / ${content.height};`}
          >
            <img src={svgDataUri(built)} alt="" draggable="false" />
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <svg
              class="overlay"
              data-testid="svg-overlay"
              bind:this={overlayEl}
              viewBox={`0 0 ${content.width} ${content.height}`}
              preserveAspectRatio="none"
              onpointerdown={onPointerDown}
              onpointermove={onPointerMove}
              onpointerup={onPointerUp}
              onpointercancel={onPointerUp}
              role="application"
              aria-label="Drawing canvas. Click a layer to select it, drag to move; use the layer fields for keyboard editing."
            >
              {#if selected}
                <g transform={`rotate(${selected.rotation} ${selected.x} ${selected.y})`}>
                  {#if selected.kind === 'line' && selected.points.length === 2}
                    {#each [selected.c1, selected.c2] as c, ci (ci)}
                      {#if c}
                        <line
                          class="guide"
                          x1={selected.x + selected.points[ci === 0 ? 0 : 1]!.x}
                          y1={selected.y + selected.points[ci === 0 ? 0 : 1]!.y}
                          x2={selected.x + c.x}
                          y2={selected.y + c.y}
                        />
                        <circle
                          class="handle ctrl"
                          data-handle={`ctrl:c${ci + 1}`}
                          cx={selected.x + c.x}
                          cy={selected.y + c.y}
                          r={handleR}
                        />
                      {/if}
                    {/each}
                    {#each selected.points as pt, i (i)}
                      <circle
                        class="handle"
                        data-handle={`line-end:${i}`}
                        cx={selected.x + pt.x}
                        cy={selected.y + pt.y}
                        r={handleR}
                      />
                    {/each}
                  {:else if selected.kind === 'polygon'}
                    <rect
                      class="sel"
                      x={selected.x - selected.width / 2}
                      y={selected.y - selected.height / 2}
                      width={selected.width}
                      height={selected.height}
                    />
                    {#each selected.points as pt, i (i)}
                      {#if pt.c}
                        {@const nx = selected.points[(i + 1) % selected.points.length]!}
                        <line class="guide" x1={selected.x + pt.x} y1={selected.y + pt.y} x2={selected.x + pt.c.x} y2={selected.y + pt.c.y} />
                        <line class="guide" x1={selected.x + nx.x} y1={selected.y + nx.y} x2={selected.x + pt.c.x} y2={selected.y + pt.c.y} />
                        <circle
                          class="handle ctrl"
                          data-handle={`vctrl:${i}`}
                          data-testid={`svg-vctrl-${i}`}
                          cx={selected.x + pt.c.x}
                          cy={selected.y + pt.c.y}
                          r={handleR}
                        />
                      {/if}
                    {/each}
                    {#each selected.points as pt, i (i)}
                      <circle
                        class="handle"
                        class:active={selectedVertex === i}
                        data-handle={`vertex:${i}`}
                        data-testid={`svg-vertex-${i}`}
                        cx={selected.x + pt.x}
                        cy={selected.y + pt.y}
                        r={handleR}
                      />
                    {/each}
                  {:else}
                    <rect
                      class="sel"
                      x={selected.x - selected.width / 2}
                      y={selected.y - selected.height / 2}
                      width={selected.width}
                      height={selected.height}
                    />
                    {#each ['nw', 'ne', 'sw', 'se'] as corner (corner)}
                      <rect
                        class="handle"
                        data-handle={`resize:${corner}`}
                        x={selected.x + (corner.includes('w') ? -selected.width / 2 : selected.width / 2) - handleR}
                        y={selected.y + (corner.includes('n') ? -selected.height / 2 : selected.height / 2) - handleR}
                        width={handleR * 2}
                        height={handleR * 2}
                      />
                    {/each}
                  {/if}
                </g>
              {/if}
            </svg>
          </div>
          <p class="muted small">
            {selected
              ? 'Drag to move. Drag the corner handles to resize; point handles edit vertices and curve controls.'
              : 'Click a layer on the canvas (or in the list) to select it.'}
          </p>

          <div class="row wrap">
            <div>
              <label for="svg-name">Name</label>
              <input id="svg-name" data-testid="svg-name" bind:value={content.name} onchange={commit} />
            </div>
            <div>
              <label for="svg-canvas-w">Width</label>
              <input
                id="svg-canvas-w"
                data-testid="svg-canvas-w"
                class="num"
                type="number"
                min={MIN_CANVAS}
                max={MAX_CANVAS}
                bind:value={content.width}
                onchange={onCanvasSize}
              />
            </div>
            <div>
              <label for="svg-canvas-h">Height</label>
              <input
                id="svg-canvas-h"
                data-testid="svg-canvas-h"
                class="num"
                type="number"
                min={MIN_CANVAS}
                max={MAX_CANVAS}
                bind:value={content.height}
                onchange={onCanvasSize}
              />
            </div>
            <label class="check">
              <input
                type="checkbox"
                data-testid="svg-bg-transparent"
                checked={content.background === null}
                onchange={(e) => {
                  content!.background = e.currentTarget.checked ? null : '#ffffff';
                  commit();
                }}
              />
              Transparent
            </label>
            {#if content.background !== null}
              <div>
                <label for="svg-bg">Background</label>
                <ColorField
                  id="svg-bg"
                  testid="svg-bg"
                  bind:value={content.background}
                  ariaLabel="Canvas background color"
                  fallback="#ffffff"
                  oncommit={commit}
                />
              </div>
            {/if}
          </div>

          <div class="row">
            <button class="btn btn-sm" data-testid="svg-undo" disabled={!canUndo(history)} onclick={() => applyHistory(undo(history))}>
              Undo
            </button>
            <button class="btn btn-sm" data-testid="svg-redo" disabled={!canRedo(history)} onclick={() => applyHistory(redo(history))}>
              Redo
            </button>
            <span class="muted small" aria-live="polite" data-testid="svg-save-state">
              {saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Save failed — document was deleted' : saveState === 'saved' ? 'Saved' : ''}
            </span>
          </div>
        </div>
      </Card>

      <Card title="Export">
        <div class="stack">
          <div class="row wrap">
            <div>
              <label for="svg-export-format">Format</label>
              <select id="svg-export-format" data-testid="svg-export-format" bind:value={exportFormat}>
                <option value="svg">SVG</option>
                <option value="png">PNG</option>
                <option value="jpg">JPG</option>
              </select>
            </div>
            {#if exportFormat !== 'svg'}
              <div>
                <label for="svg-export-width">Width (px)</label>
                <input
                  id="svg-export-width"
                  data-testid="svg-export-width"
                  class="num"
                  type="number"
                  min="16"
                  max="8192"
                  bind:value={exportWidth}
                />
              </div>
              <p class="muted small self-end">→ {exportWidth} × {exportHeight}px</p>
            {/if}
            {#if exportFormat === 'jpg'}
              <div>
                <label for="svg-export-quality">JPG quality ({exportQuality})</label>
                <input
                  id="svg-export-quality"
                  data-testid="svg-export-quality"
                  class="num"
                  type="number"
                  min="1"
                  max="100"
                  bind:value={exportQuality}
                />
              </div>
            {/if}
          </div>
          <div class="row">
            <button class="btn btn-primary" data-testid="svg-export-download" onclick={doExport}>Download</button>
            <button class="btn" data-testid="svg-export-copy" onclick={doCopy}>
              {exportFormat === 'svg' ? 'Copy SVG text' : 'Copy (always PNG)'}
            </button>
          </div>
          <p class="muted small" aria-live="polite" data-testid="svg-feedback">{feedback ?? ''}</p>
          {#if exportFormat === 'jpg'}
            <p class="muted small">JPG has no transparency — transparent areas flatten onto white.</p>
          {/if}
        </div>
      </Card>
    </div>

    <div class="stack">
      <Card title="Layers">
        <div class="stack">
          <div class="row wrap">
            {#each KINDS as k (k.kind)}
              <button class="btn btn-sm" data-testid={`svg-add-${k.kind}`} onclick={() => addLayer(k.kind)}>
                {k.label}
              </button>
            {/each}
          </div>
          {#if content.layers.length === 0}
            <p class="muted">No layers yet — add a shape, line, polygon, text, or pasted SVG.</p>
          {:else}
            <ul class="layers">
              {#each [...content.layers].reverse() as layer (layer.id)}
                <li class:active={layer.id === selectedId} data-testid="svg-layer">
                  <button
                    class="layer-name"
                    data-testid="svg-layer-select"
                    aria-pressed={layer.id === selectedId}
                    onclick={() => {
                      selectedId = layer.id;
                      selectedVertex = null;
                    }}
                  >
                    {#if layer.kind === 'svg'}
                      <span class="dot glyph" class:warn={!looksLikeSvg(layer.svg)}>&lt;/&gt;</span>
                    {:else}
                      <span
                        class="dot"
                        style={`background:${layer.kind === 'line' ? layer.stroke : layer.fill}`}
                      ></span>
                    {/if}
                    {layerLabel(layer)}
                  </button>
                  <span class="row layer-actions">
                    <button class="mini" title="Bring forward" aria-label="Bring forward" data-testid="svg-layer-up" onclick={() => shiftLayer(layer.id, 1)}>▲</button>
                    <button class="mini" title="Send backward" aria-label="Send backward" data-testid="svg-layer-down" onclick={() => shiftLayer(layer.id, -1)}>▼</button>
                    <button class="mini" title="Delete layer" aria-label="Delete layer" data-testid="svg-layer-delete" onclick={() => removeLayer(layer.id)}>✕</button>
                  </span>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      </Card>

      {#if selected}
        <Card title="Layer">
          <div class="stack">
            <div class="row wrap">
              <div>
                <label for="svg-x">X</label>
                <input id="svg-x" data-testid="svg-x" class="num" type="number" bind:value={selected.x} onchange={commit} />
              </div>
              <div>
                <label for="svg-y">Y</label>
                <input id="svg-y" data-testid="svg-y" class="num" type="number" bind:value={selected.y} onchange={commit} />
              </div>
              <div>
                <label for="svg-w">{selected.kind === 'text' ? 'Box width' : 'Width'}</label>
                <input id="svg-w" data-testid="svg-w" class="num" type="number" min="1" bind:value={selected.width} onchange={commit} />
              </div>
              <div>
                <label for="svg-h">{selected.kind === 'text' ? 'Font size' : 'Height'}</label>
                <input id="svg-h" data-testid="svg-h" class="num" type="number" min="1" bind:value={selected.height} onchange={commit} />
              </div>
              <div class="grow">
                <label for="svg-rot">Rotation ({selected.rotation}°)</label>
                <input id="svg-rot" data-testid="svg-rot" type="range" min="-180" max="180" bind:value={selected.rotation} onchange={commit} />
              </div>
            </div>

            {#if selected.kind !== 'line' && selected.kind !== 'svg'}
              <div class="row wrap">
                <label class="check">
                  <input
                    type="checkbox"
                    data-testid="svg-fill-on"
                    checked={selected.fill !== 'none'}
                    onchange={(e) => toggleFill(e.currentTarget.checked)}
                  />
                  Fill
                </label>
                {#if selected.fill !== 'none'}
                  <ColorField testid="svg-fill" bind:value={selected.fill} ariaLabel="Fill color" fallback="#f59e0b" oncommit={commit} />
                {/if}
              </div>
            {/if}

            {#if selected.kind !== 'svg'}
              <div class="row wrap">
                <label class="check">
                  <input
                    type="checkbox"
                    data-testid="svg-stroke-on"
                    checked={selected.stroke !== 'none'}
                    onchange={(e) => toggleStroke(e.currentTarget.checked)}
                  />
                  Stroke
                </label>
                {#if selected.stroke !== 'none'}
                  <ColorField testid="svg-stroke" bind:value={selected.stroke} ariaLabel="Stroke color" fallback="#f59e0b" oncommit={commit} />
                  <div>
                    <label for="svg-stroke-width">Stroke width</label>
                    <input id="svg-stroke-width" data-testid="svg-stroke-width" class="num" type="number" min="0.5" max="200" step="0.5" bind:value={selected.stroke_width} onchange={commit} />
                  </div>
                {/if}
              </div>
            {/if}

            {#if selected.kind === 'rect'}
              <div class="grow">
                <label for="svg-radius">Corner radius ({selected.radius})</label>
                <input id="svg-radius" data-testid="svg-radius" type="range" min="0" max={Math.round(Math.min(selected.width, selected.height) / 2)} bind:value={selected.radius} onchange={commit} />
              </div>
            {/if}

            {#if selected.kind === 'text'}
              <div class="row wrap">
                <div class="grow">
                  <label for="svg-text">Text</label>
                  <input id="svg-text" data-testid="svg-text" maxlength="64" bind:value={selected.text} onchange={commit} />
                </div>
                <label class="check">
                  <input type="checkbox" data-testid="svg-bold" bind:checked={selected.bold} onchange={commit} />
                  Bold
                </label>
              </div>
            {/if}

            {#if selected.kind === 'line'}
              <div class="row wrap">
                <div>
                  <label for="svg-curve">Curve</label>
                  <select
                    id="svg-curve"
                    data-testid="svg-curve"
                    value={curveMode}
                    onchange={(e) => setCurve(e.currentTarget.value as 'straight' | 'quadratic' | 'cubic')}
                  >
                    <option value="straight">Straight</option>
                    <option value="quadratic">Curved (1 control)</option>
                    <option value="cubic">Curved (2 controls)</option>
                  </select>
                </div>
                <p class="muted small self-end">Drag the round handles on the canvas to shape the line.</p>
              </div>
            {/if}

            {#if selected.kind === 'polygon'}
              <div class="row wrap">
                <button class="btn btn-sm" data-testid="svg-add-point" onclick={addVertex}>Add point</button>
                <button class="btn btn-sm" data-testid="svg-remove-point" disabled={selected.points.length <= 3} onclick={removeVertex}>
                  Remove point
                </button>
                <button
                  class="btn btn-sm"
                  data-testid="svg-curve-edge"
                  aria-pressed={selectedVertexCurved}
                  title="Bend the edge from the selected point to the next one with a draggable bezier handle"
                  onclick={toggleVertexCurve}
                >
                  {selectedVertexCurved ? 'Straighten edge' : 'Curve edge'}
                </button>
                <div>
                  <label for="svg-sides">Reset as regular</label>
                  <select
                    id="svg-sides"
                    data-testid="svg-sides"
                    onchange={(e) => {
                      const n = Number(e.currentTarget.value);
                      if (n >= 3) resetPolygon(n);
                      e.currentTarget.value = '';
                    }}
                  >
                    <option value="">n-gon…</option>
                    {#each [3, 4, 5, 6, 7, 8, 10, 12] as n (n)}
                      <option value={n}>{n} sides</option>
                    {/each}
                  </select>
                </div>
              </div>
              <p class="muted small">
                {selected.points.length} points — drag them on the canvas to reshape.
                {selectedVertex === null
                  ? 'Click a point to select it; “Curve edge” bends the edge leaving it.'
                  : `Point ${selectedVertex + 1} selected${selectedVertexCurved ? ' — drag the orange handle to shape the curve.' : '.'}`}
              </p>
            {/if}

            {#if content.layers.length > 1}
              <div class="row wrap">
                <div>
                  <label for="svg-subtract">Subtract another layer from this one</label>
                  <select
                    id="svg-subtract"
                    data-testid="svg-subtract"
                    onchange={(e) => {
                      subtractWith(e.currentTarget.value);
                      e.currentTarget.value = '';
                    }}
                  >
                    <option value="">Choose the cutter…</option>
                    {#each content.layers.filter((l) => l.id !== selected!.id) as l (l.id)}
                      <option value={l.id}>{layerLabel(l)}</option>
                    {/each}
                  </select>
                </div>
                <p class="muted small self-end">
                  Cuts the cutter's silhouette out of this layer and bakes the result into a
                  pasted-SVG layer (both originals are consumed — undo restores them).
                </p>
              </div>
            {/if}

            {#if selected.kind === 'svg'}
              <div>
                <label for="svg-markup">SVG markup</label>
                <textarea
                  id="svg-markup"
                  data-testid="svg-markup"
                  rows="6"
                  spellcheck="false"
                  placeholder={'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">…</svg>'}
                  bind:value={selected.svg}
                  onchange={commit}
                ></textarea>
                {#if selected.svg.trim() && !looksLikeSvg(selected.svg)}
                  <p class="error" role="alert">
                    That doesn't look like SVG — it needs an <code>&lt;svg&gt;</code> root element.
                  </p>
                {:else}
                  <p class="muted small">
                    Scaled to fit the layer box, keeping its own colors — the Fill control doesn't apply.
                  </p>
                {/if}
              </div>
            {/if}
          </div>
        </Card>
      {/if}
    </div>
  </div>
{/if}

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

  .canvas-wrap {
    position: relative;
    width: 100%;
    max-height: 70vh;
    border: 1.5px solid var(--border-strong-color);
    touch-action: none;
    user-select: none;
  }

  .checkerboard {
    /* Checkerboard so transparency is visible. */
    background:
      repeating-conic-gradient(var(--border-color) 0% 25%, transparent 0% 50%)
      0 0 / 16px 16px;
  }

  .canvas-wrap img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  .overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    cursor: crosshair;
  }

  .overlay .sel {
    fill: none;
    stroke: var(--color-primary);
    stroke-width: 1.5;
    stroke-dasharray: 4 3;
    vector-effect: non-scaling-stroke;
    pointer-events: none;
  }

  .overlay .handle {
    fill: var(--surface-color);
    stroke: var(--color-primary);
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
    cursor: grab;
  }

  .overlay .handle.active,
  .overlay .handle:hover {
    fill: var(--color-primary);
  }

  .overlay .handle.ctrl {
    stroke: var(--color-warning);
  }

  .overlay .guide {
    stroke: var(--color-warning);
    stroke-width: 1;
    stroke-dasharray: 2 2;
    vector-effect: non-scaling-stroke;
    pointer-events: none;
  }

  .doc-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .doc-list li {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    border: 1px solid var(--border-color);
    padding: var(--space-1) var(--space-2);
  }

  .doc-name {
    background: none;
    border: none;
    color: var(--text-color);
    cursor: pointer;
    padding: var(--space-1) 0;
    flex: 1;
    text-align: left;
    font-size: var(--font-size-base);
  }

  .doc-name:hover {
    color: var(--color-primary);
  }

  .layers {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 14rem;
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

  .dot.glyph {
    width: auto;
    height: auto;
    padding: 0 2px;
    font-size: var(--font-size-sm);
    color: var(--text-muted-color);
    line-height: 1.1;
  }

  .dot.glyph.warn {
    color: var(--color-danger);
    border-color: currentColor;
  }

  .layer-actions {
    gap: 2px;
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

  textarea {
    width: 100%;
    font-family: var(--font-body);
    font-size: var(--font-size-sm);
    resize: vertical;
  }

  .check {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    text-transform: none;
  }
</style>
