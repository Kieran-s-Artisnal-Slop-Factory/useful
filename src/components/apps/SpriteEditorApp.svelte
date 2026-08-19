<script lang="ts">
  /**
   * A pixel-sprite editor, as a document tool.
   *
   * Ported from retoken's SpriteEditor: a square character grid, a legend
   * mapping each character to a CSS colour, a text mode where every pixel is a
   * one-character input, and a preview mode that renders the grid as crisp SVG
   * with the animation presets. What this adds is everything around it —
   * named documents in IndexedDB, autosave with the SVG editor's flush
   * contract, undo/redo, and exports through this app's own pipeline.
   *
   * A sprite is text all the way down (an array of strings plus a
   * character → colour map), so a document rides backups byte-identically.
   */
  import { onDestroy, onMount } from 'svelte';
  import Card from '../Card.svelte';
  import Explainer from '../Explainer.svelte';
  import PixelSprite from '../PixelSprite.svelte';
  import {
    all,
    get,
    getSingleton,
    patch,
    put,
    putSingleton,
    softDelete,
    withSyncFields,
  } from '../../lib/db/repo';
  import type { Preferences, Sprite as SpriteRow } from '../../lib/db/types';
  import {
    blankSprite,
    isSafeColor,
    resizeSprite,
    type ColorMap,
    type Sprite,
    type SpriteExample,
  } from '../../lib/sprite/types';
  import { SPRITE_ANIMATIONS, type SpriteAnimation } from '../../lib/sprite/animations';
  import { normalizeSprite, parseJson, toJson, toSvgString, toText } from '../../lib/sprite/export';
  import { canRedo, canUndo, createHistory, push, redo, undo, type History } from '../../lib/svg/history';
  import { copyPng, copyText, downloadBlob, downloadText } from '../../lib/exportFile';
  import { decodeToCanvas, encodeCanvas } from '../../lib/img/convert';

  const MIN_SIZE = 4;
  const MAX_SIZE = 48;
  const TRANSPARENT = '.';
  const SAVE_DEBOUNCE_MS = 400;

  /** A starter legend that shows characters can be anything. */
  const STARTER_COLORS: ColorMap = {
    k: '#1d1d24',
    W: '#ffffff',
    R: '#e5533c',
    G: '#43a047',
    B: '#4f9dde',
    Y: '#f5c518',
  };

  /** What a document holds — exactly what is persisted, so a snapshot IS a row. */
  interface Content {
    name: string;
    size: number;
    rows: string[];
    colors: ColorMap;
  }

  let loading = $state(true);
  let docs = $state<SpriteRow[]>([]);
  let newName = $state('');
  let current = $state<SpriteRow | null>(null);
  let content = $state<Content | null>(null);
  let history = $state<History<Content>>(createHistory({ name: '', size: 16, rows: [], colors: {} }));
  let saveState = $state<'saved' | 'saving' | 'error' | null>(null);
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  let activeChar = $state('k');
  let mode = $state<'text' | 'preview'>('text');
  let animation = $state<SpriteAnimation>('idle');
  let tintCells = $state(true);
  let message = $state('');
  let newColor = $state('#ff8800');
  let newChar = $state('a');
  let importText = $state('');
  let examples = $state<SpriteExample[]>([]);
  let selectedExample = $state('');
  let variantIndex = $state(0);
  let exportPx = $state(512);
  let gridEl: HTMLDivElement | undefined = $state();
  /** Set synchronously at teardown: with ClientRouter the window outlives the page. */
  let destroyed = false;
  let painting = false;

  const sprite = $derived<Sprite>(
    content ? { size: content.size, rows: content.rows } : blankSprite(MIN_SIZE)
  );
  const legend = $derived(content ? Object.entries(content.colors) : []);
  const currentExample = $derived(examples.find((e) => e.id === selectedExample));

  const clampSize = (n: number): number =>
    Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(n) || MIN_SIZE));

  function defaultContent(name: string): Content {
    return { name, size: 16, rows: blankSprite(16, TRANSPARENT).rows, colors: { ...STARTER_COLORS } };
  }

  /** A row from the database, healed into something the editor can hold. */
  function contentOf(row: SpriteRow): Content {
    const { sprite: s, colors } = normalizeSprite(row.size, row.rows, row.colors);
    return { name: row.name, size: s.size, rows: s.rows, colors };
  }

  onMount(() => {
    window.addEventListener('keydown', onKeydown);
    window.addEventListener('pagehide', flushSave);
    document.addEventListener('visibilitychange', onVisibility);
    void (async () => {
      await refreshDocs();
      // Resume the last-open document — reads only, no writes on load.
      const prefs = await getSingleton<Preferences>('preferences');
      if (destroyed) return;
      if (typeof prefs?.sprite_last_doc_id === 'string' && !current) {
        const row = await get<SpriteRow>('sprites', prefs.sprite_last_doc_id);
        if (destroyed) return;
        if (row) openDoc(row, { remember: false });
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

  function onKeydown(e: KeyboardEvent) {
    if (!content || !(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) {
      e.preventDefault();
      applyHistory(undo(history));
    } else if ((key === 'z' && e.shiftKey) || key === 'y') {
      e.preventDefault();
      applyHistory(redo(history));
    }
  }

  async function refreshDocs() {
    const rows = await all<SpriteRow>('sprites');
    if (destroyed) return;
    docs = rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  // ---- document lifecycle ---------------------------------------------------

  async function createDoc(e: Event) {
    e.preventDefault();
    const name = newName.trim() || 'Untitled';
    const row = await put<SpriteRow>('sprites', withSyncFields(defaultContent(name)));
    newName = '';
    await refreshDocs();
    openDoc(row);
  }

  function openDoc(row: SpriteRow, opts: { remember?: boolean } = {}) {
    flushSave();
    current = row;
    content = contentOf(row);
    history = createHistory(content);
    saveState = 'saved';
    message = '';
    activeChar = Object.keys(content.colors)[0] ?? TRANSPARENT;
    if (opts.remember !== false) {
      void putSingleton<Partial<Preferences>>('preferences', { sprite_last_doc_id: row.id });
    }
  }

  async function closeDoc() {
    flushSave();
    current = null;
    content = null;
    saveState = null;
    await refreshDocs();
  }

  async function deleteDoc(row: SpriteRow) {
    if (!confirm(`Delete "${row.name}"?`)) return;
    if (current?.id === row.id) {
      clearTimeout(saveTimer);
      saveTimer = undefined;
      current = null;
      content = null;
      saveState = null;
    }
    await softDelete('sprites', row.id);
    await refreshDocs();
  }

  // ---- history + persistence ------------------------------------------------

  /** Record the current content as one undo step and schedule a save. */
  function commit() {
    if (!content) return;
    // Heal before recording: a grid must be square and a name non-empty, so
    // history and the database only ever hold well-formed documents.
    const size = clampSize(content.size);
    const squared = resizeSprite({ size, rows: content.rows }, size, TRANSPARENT);
    const clean: Content = {
      name: content.name.trim() || 'Untitled',
      size,
      rows: squared.rows,
      colors: { ...content.colors },
    };
    content.size = clean.size;
    content.rows = clean.rows;
    const next = push(history, clean);
    if (next === history) return; // the gesture changed nothing
    history = next;
    scheduleSave();
  }

  function applyHistory(h: History<Content>) {
    if (h === history || !content) return;
    history = h;
    content = JSON.parse(JSON.stringify(h.present)) as Content;
    scheduleSave();
  }

  function scheduleSave() {
    saveState = 'saving';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void doSave(), SAVE_DEBOUNCE_MS);
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
    // The last COMMITTED snapshot, never the live bound values.
    const c = history.present;
    const row = await patch<SpriteRow>('sprites', id, {
      name: c.name,
      size: c.size,
      rows: c.rows,
      colors: c.colors,
    });
    // The document may have been closed or swapped while the write was in
    // flight — only touch state if it is still the open one.
    if (destroyed || current?.id !== id) return;
    if (row) {
      current = row;
      saveState = 'saved';
    } else {
      saveState = 'error';
    }
  }

  // ---- grid editing ---------------------------------------------------------

  function setSize(next: number) {
    if (!content) return;
    const n = clampSize(next);
    content.rows = resizeSprite({ size: content.size, rows: content.rows }, n, TRANSPARENT).rows;
    content.size = n;
    commit();
  }

  function setCell(x: number, y: number, char: string) {
    if (!content) return;
    const size = content.size;
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const c = char === '' ? TRANSPARENT : char.slice(-1);
    // Pad first, so x lands at column x even on a short row.
    const row = (content.rows[y] ?? '').padEnd(size, TRANSPARENT);
    if (row[x] === c) return;
    const nextRow = row.slice(0, x) + c + row.slice(x + 1);
    content.rows = content.rows.map((r, i) => (i === y ? nextRow : r));
  }

  function cellChar(x: number, y: number): string {
    const ch = content?.rows[y]?.[x] ?? TRANSPARENT;
    // Transparent cells read as empty so the grid isn't a field of dots.
    return ch === TRANSPARENT || ch === ' ' ? '' : ch;
  }

  function cellTint(x: number, y: number): string {
    if (!tintCells || !content) return 'transparent';
    const ch = content.rows[y]?.[x] ?? TRANSPARENT;
    const color = content.colors[ch];
    // Only interpolate a colour that has been vetted — this goes into an
    // inline style the browser re-parses as CSS.
    return color && isSafeColor(color)
      ? `color-mix(in srgb, ${color} 30%, transparent)`
      : 'transparent';
  }

  function clearGrid() {
    if (!content || !confirm('Clear the whole grid?')) return;
    content.rows = blankSprite(content.size, TRANSPARENT).rows;
    commit();
  }

  // ---- painting (drag to draw with the active character) --------------------

  function paintFrom(target: EventTarget | null) {
    const el = target as HTMLElement | null;
    const cell = el?.closest<HTMLElement>('[data-x]');
    if (!cell) return;
    setCell(Number(cell.dataset.x), Number(cell.dataset.y), activeChar);
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    painting = true;
    paintFrom(e.target);
  }

  function onPointerOver(e: PointerEvent) {
    if (painting) paintFrom(e.target);
  }

  /** One stroke is ONE undo step, however many cells it crossed. */
  function stopPainting() {
    if (!painting) return;
    painting = false;
    commit();
  }

  /** Arrow keys walk between cells, so a grid can be filled without a mouse. */
  function onGridKeydown(e: KeyboardEvent) {
    const dirs: Record<string, [number, number]> = {
      ArrowRight: [1, 0],
      ArrowLeft: [-1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const dir = dirs[e.key];
    if (!dir) return;
    const el = e.target as HTMLElement;
    if (el.dataset.x === undefined) return;
    e.preventDefault();
    const nx = Number(el.dataset.x) + dir[0];
    const ny = Number(el.dataset.y) + dir[1];
    const next = gridEl?.querySelector<HTMLInputElement>(`input[data-x='${nx}'][data-y='${ny}']`);
    next?.focus();
    next?.select();
  }

  // ---- legend ---------------------------------------------------------------

  function firstUnusedChar(): string {
    const pool = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ+*#@%&';
    for (const c of pool) if (!content || !(c in content.colors)) return c;
    return '';
  }

  function setColor(char: string, value: string) {
    if (!content) return;
    const v = value.trim();
    // Keep hostile or malformed values out of the legend entirely — the tint
    // and the SVG/PNG exports all read from here.
    if (!isSafeColor(v)) {
      message = `"${v.slice(0, 24)}" isn't a valid colour (try #rrggbb, rgb(), or a keyword).`;
      return;
    }
    content.colors = { ...content.colors, [char]: v };
    if (message.startsWith('"')) message = '';
    commit();
  }

  function removeMapping(char: string) {
    if (!content) return;
    const next = { ...content.colors };
    delete next[char];
    content.colors = next;
    if (activeChar === char) activeChar = TRANSPARENT;
    commit();
  }

  function addMapping() {
    if (!content) return;
    const c = newChar.trim().slice(0, 1);
    if (!c) {
      message = 'Pick a character for the new mapping.';
      return;
    }
    if (c === TRANSPARENT || c === ' ') {
      message = `"${c}" is reserved for transparent.`;
      return;
    }
    if (c in content.colors) {
      message = `"${c}" is already mapped.`;
      return;
    }
    if (!isSafeColor(newColor)) {
      message = 'Pick a valid colour first.';
      return;
    }
    content.colors = { ...content.colors, [c]: newColor };
    activeChar = c;
    newChar = firstUnusedChar();
    message = '';
    commit();
  }

  // ---- examples -------------------------------------------------------------

  /** 31 KB of pet sprites: only loaded when somebody opens the picker. */
  async function loadExamples() {
    if (examples.length > 0) return;
    const mod = await import('../../lib/sprite/pets');
    if (destroyed) return;
    examples = mod.PET_EXAMPLES;
  }

  function applyExample(id: string) {
    if (!content) return;
    const ex = examples.find((e) => e.id === id);
    if (!ex) return;
    const variant = ex.variants[Math.min(variantIndex, ex.variants.length - 1)] ?? ex.variants[0]!;
    const grid = resizeSprite(variant.grid, variant.grid.size, TRANSPARENT);
    content.colors = { ...ex.colors };
    content.size = grid.size;
    content.rows = grid.rows;
    activeChar = Object.keys(ex.colors)[1] ?? Object.keys(ex.colors)[0] ?? TRANSPARENT;
    message = `Loaded ${ex.label}${ex.variants.length > 1 ? ` (${variant.name})` : ''}.`;
    commit();
  }

  function onPickExample(id: string) {
    selectedExample = id;
    variantIndex = 0;
    if (id) applyExample(id);
  }

  function onPickVariant(index: number) {
    variantIndex = index;
    if (selectedExample) applyExample(selectedExample);
  }

  // ---- export / import ------------------------------------------------------

  const fileStem = $derived((content?.name || 'sprite').replace(/[^a-z0-9._-]+/gi, '-'));

  function flash(text: string) {
    message = text;
  }

  async function copyAs(kind: 'txt' | 'json') {
    if (!content) return;
    const text = kind === 'txt' ? toText(sprite) : toJson(sprite, content.colors);
    flash((await copyText(text)) ? `Copied ${kind.toUpperCase()}.` : 'Clipboard blocked — use Download.');
  }

  function downloadAs(kind: 'txt' | 'json') {
    if (!content) return;
    if (kind === 'txt') downloadText(toText(sprite), `${fileStem}.txt`, 'text/plain');
    else downloadText(toJson(sprite, content.colors), `${fileStem}.json`, 'application/json');
    flash(`Downloaded ${kind.toUpperCase()}.`);
  }

  function downloadSvg() {
    if (!content) return;
    downloadText(toSvgString(sprite, content.colors, exportPx), `${fileStem}.svg`, 'image/svg+xml');
    flash('Downloaded SVG.');
  }

  /**
   * Rasterize through the shared decoder at the TARGET size: drawing the SVG
   * straight to its final pixel size keeps the art hard-edged without having to
   * fight image smoothing afterwards.
   */
  async function rasterize(): Promise<HTMLCanvasElement> {
    if (!content) throw new Error('No sprite open.');
    const svg = toSvgString(sprite, content.colors, exportPx);
    const file = new File([svg], `${fileStem}.svg`, { type: 'image/svg+xml' });
    return (await decodeToCanvas(file, exportPx)).canvas;
  }

  async function downloadPng() {
    try {
      const blob = await encodeCanvas(await rasterize(), 'png', 100);
      downloadBlob(blob, `${fileStem}.png`);
      flash('Downloaded PNG.');
    } catch (err) {
      flash(`PNG failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function copyAsPng() {
    try {
      const blob = await encodeCanvas(await rasterize(), 'png', 100);
      flash((await copyPng(blob)) ? 'Copied PNG.' : 'Clipboard blocked — use Download.');
    } catch (err) {
      flash(`PNG failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function applyImport() {
    if (!content) return;
    try {
      const { sprite: s, colors } = parseJson(importText);
      const size = clampSize(s.size || s.rows.length);
      content.size = size;
      content.rows = resizeSprite(s, size, TRANSPARENT).rows;
      if (Object.keys(colors).length) content.colors = colors;
      importText = '';
      message = 'Sprite imported.';
      commit();
    } catch (err) {
      message = err instanceof Error ? err.message : 'Could not import that.';
    }
  }
</script>

<svelte:window onpointerup={stopPainting} />

<div class="page-header">
  <h1>Sprite editor</h1>
  {#if current}
    <span class="muted small" data-testid="sprite-save-state">
      {saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Save failed' : 'Saved'}
    </span>
    <button class="btn btn-sm" data-testid="sprite-close" onclick={closeDoc}>All sprites</button>
  {/if}
</div>

{#if loading}
  <p class="muted">Loading…</p>
{:else if !current || !content}
  <div class="stack">
    <Card title="New sprite">
      <form class="row" onsubmit={createDoc}>
        <input
          data-testid="sprite-new-name"
          placeholder="Name"
          aria-label="New sprite name"
          bind:value={newName}
        />
        <button class="btn btn-primary" data-testid="sprite-create" type="submit">Create</button>
      </form>
    </Card>

    <Card title="Sprites">
      {#if docs.length === 0}
        <p class="muted">No sprites yet.</p>
      {:else}
        <ul class="docs">
          {#each docs as doc (doc.id)}
            <li data-testid="sprite-doc">
              <button class="doc-name" data-testid="sprite-doc-open" onclick={() => openDoc(doc)}>
                {doc.name}
                <span class="muted small">{doc.size}×{doc.size}</span>
              </button>
              <button
                class="btn btn-sm btn-danger"
                data-testid="sprite-doc-delete"
                onclick={() => deleteDoc(doc)}>Delete</button
              >
            </li>
          {/each}
        </ul>
      {/if}
    </Card>
  </div>
{:else}
  <div class="stack">
    <Card title="Sprite">
      <div class="stack">
        <div class="row wrap">
          <div>
            <label for="sprite-name">Name</label>
            <input id="sprite-name" data-testid="sprite-name" bind:value={content.name} onchange={commit} />
          </div>
          <div>
            <label for="sprite-size">Size</label>
            <input
              id="sprite-size"
              data-testid="sprite-size"
              class="num"
              type="number"
              min={MIN_SIZE}
              max={MAX_SIZE}
              value={content.size}
              onchange={(e) => setSize(Number(e.currentTarget.value))}
            />
          </div>
          <div class="row" role="group" aria-label="Mode">
            <button
              class="btn btn-sm"
              class:btn-primary={mode === 'text'}
              data-testid="sprite-mode-text"
              aria-pressed={mode === 'text'}
              onclick={() => (mode = 'text')}>Grid</button
            >
            <button
              class="btn btn-sm"
              class:btn-primary={mode === 'preview'}
              data-testid="sprite-mode-preview"
              aria-pressed={mode === 'preview'}
              onclick={() => (mode = 'preview')}>Preview</button
            >
          </div>
          <span class="spacer"></span>
          <button
            class="btn btn-sm"
            data-testid="sprite-undo"
            disabled={!canUndo(history)}
            onclick={() => applyHistory(undo(history))}>↶ Undo</button
          >
          <button
            class="btn btn-sm"
            data-testid="sprite-redo"
            disabled={!canRedo(history)}
            onclick={() => applyHistory(redo(history))}>↷ Redo</button
          >
          <button class="btn btn-sm btn-danger" data-testid="sprite-clear" onclick={clearGrid}>Clear</button>
        </div>

        {#if mode === 'text'}
          <div class="row wrap">
            <span class="muted small">Painting with</span>
            <span class="brush mono" data-testid="sprite-brush">{activeChar === TRANSPARENT ? '(erase)' : activeChar}</span>
            <label class="check">
              <input type="checkbox" bind:checked={tintCells} />
              Tint cells
            </label>
          </div>
          <!-- Painting is a pointer gesture over the cells; each cell is also a
               real input, so the grid is fully usable from the keyboard. -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="grid"
            bind:this={gridEl}
            data-testid="sprite-grid"
            style={`--cols: ${content.size}`}
            onpointerdown={onPointerDown}
            onpointerover={onPointerOver}
            onkeydown={onGridKeydown}
          >
            {#each Array.from({ length: content.size }) as _, y (y)}
              {#each Array.from({ length: content.size }) as _, x (x)}
                <input
                  class="cell mono"
                  data-x={x}
                  data-y={y}
                  data-testid="sprite-cell"
                  aria-label={`Pixel ${x}, ${y}`}
                  maxlength="1"
                  value={cellChar(x, y)}
                  style={`background:${cellTint(x, y)}`}
                  oninput={(e) => setCell(x, y, e.currentTarget.value)}
                  onchange={commit}
                />
              {/each}
            {/each}
          </div>
        {:else}
          <div class="preview-stage">
            <PixelSprite grid={sprite} colors={content.colors} size={288} {animation} title={content.name} />
          </div>
          <div class="row">
            <label for="sprite-anim">Animation</label>
            <select id="sprite-anim" data-testid="sprite-anim" bind:value={animation}>
              {#each SPRITE_ANIMATIONS as anim (anim.id)}
                <option value={anim.id}>{anim.label}</option>
              {/each}
            </select>
          </div>
        {/if}

        {#if message}
          <p class="muted small" data-testid="sprite-message" aria-live="polite">{message}</p>
        {/if}
      </div>
    </Card>

    <Card title="Legend">
      <div class="stack">
        <p class="muted small">
          Each character in the grid paints one colour. <code>.</code> and a space are always
          transparent.
        </p>
        <ul class="legend">
          {#each legend as [char, color] (char)}
            <li>
              <button
                class="btn btn-sm"
                class:btn-primary={activeChar === char}
                data-testid="sprite-pick-char"
                data-char={char}
                aria-pressed={activeChar === char}
                onclick={() => (activeChar = char)}
              >
                <span class="mono">{char}</span>
              </button>
              <span class="swatch" style={`background:${isSafeColor(color) ? color : 'transparent'}`}></span>
              <input
                class="mono"
                data-testid="sprite-color"
                data-char={char}
                aria-label={`Colour for ${char}`}
                value={color}
                onchange={(e) => setColor(char, e.currentTarget.value)}
              />
              <button
                class="btn btn-sm btn-danger"
                data-testid="sprite-remove-char"
                data-char={char}
                onclick={() => removeMapping(char)}>Remove</button
              >
            </li>
          {/each}
        </ul>
        <div class="row wrap">
          <label class="inline" for="sprite-new-char">Add</label>
          <input
            id="sprite-new-char"
            class="char mono"
            data-testid="sprite-new-char"
            maxlength="1"
            bind:value={newChar}
          />
          <input
            class="mono"
            data-testid="sprite-new-color"
            aria-label="New colour"
            bind:value={newColor}
          />
          <button class="btn btn-sm" data-testid="sprite-add-char" onclick={addMapping}>Add mapping</button>
          <span class="spacer"></span>
          <button
            class="btn btn-sm"
            data-testid="sprite-erase"
            class:btn-primary={activeChar === TRANSPARENT}
            onclick={() => (activeChar = TRANSPARENT)}>Erase</button
          >
        </div>
      </div>
    </Card>

    <Card title="Examples">
      <div class="stack">
        <p class="muted small">
          Fourteen creatures at four growth stages each, to take apart. Loading one replaces the
          open sprite (undo brings it back).
        </p>
        <div class="row wrap">
          <label class="inline" for="sprite-example">Example</label>
          <select
            id="sprite-example"
            data-testid="sprite-example"
            value={selectedExample}
            onfocus={loadExamples}
            onchange={(e) => onPickExample(e.currentTarget.value)}
          >
            <option value="">Pick one…</option>
            {#each examples as ex (ex.id)}
              <option value={ex.id}>{ex.label}</option>
            {/each}
          </select>
          {#if examples.length === 0}
            <button class="btn btn-sm" data-testid="sprite-load-examples" onclick={loadExamples}>
              Load examples
            </button>
          {/if}
          {#if currentExample && currentExample.variants.length > 1}
            <div class="row" role="group" aria-label="Stage">
              {#each currentExample.variants as variant, i (variant.name)}
                <button
                  class="btn btn-sm"
                  class:btn-primary={variantIndex === i}
                  data-testid="sprite-variant"
                  aria-pressed={variantIndex === i}
                  onclick={() => onPickVariant(i)}>{variant.name}</button
                >
              {/each}
            </div>
          {/if}
        </div>
      </div>
    </Card>

    <Card title="Export & import">
      <div class="stack">
        <div class="row wrap">
          <label class="inline" for="sprite-export-px">Image size</label>
          <input
            id="sprite-export-px"
            class="num"
            data-testid="sprite-export-px"
            type="number"
            min="16"
            max="4096"
            bind:value={exportPx}
          />
          <span class="muted small">px</span>
        </div>
        <div class="row wrap">
          <button class="btn btn-sm" data-testid="sprite-download-txt" onclick={() => downloadAs('txt')}>Download TXT</button>
          <button class="btn btn-sm" data-testid="sprite-download-json" onclick={() => downloadAs('json')}>Download JSON</button>
          <button class="btn btn-sm" data-testid="sprite-download-svg" onclick={downloadSvg}>Download SVG</button>
          <button class="btn btn-sm" data-testid="sprite-download-png" onclick={downloadPng}>Download PNG</button>
        </div>
        <div class="row wrap">
          <button class="btn btn-sm" data-testid="sprite-copy-txt" onclick={() => copyAs('txt')}>Copy TXT</button>
          <button class="btn btn-sm" data-testid="sprite-copy-json" onclick={() => copyAs('json')}>Copy JSON</button>
          <button class="btn btn-sm" data-testid="sprite-copy-png" onclick={copyAsPng}>Copy PNG</button>
        </div>
        <div class="stack tight">
          <label for="sprite-import">Import a sprite JSON</label>
          <textarea
            id="sprite-import"
            data-testid="sprite-import"
            rows="4"
            placeholder={'{ "format": "useful-sprite", … }'}
            bind:value={importText}
          ></textarea>
          <div class="row">
            <button class="btn btn-sm" data-testid="sprite-apply-import" onclick={applyImport}>Import</button>
          </div>
        </div>
      </div>
    </Card>

    <Explainer summary="How a sprite is stored">
      <p>
        A sprite is text: an array of strings, one per row, plus a legend saying which colour each
        character paints. That is the whole file. It means a sprite reads as a diff, survives a
        backup unchanged, and can be pasted between this editor and any other tool that speaks the
        same shape.
      </p>
      <p>
        Legend colours are checked against a strict allowlist — hex, <code>rgb()</code>,
        <code>hsl()</code> or a plain keyword. That check is what makes the exported SVG safe to
        open: without it, a hand-edited legend could carry markup into the file.
      </p>
    </Explainer>
  </div>
{/if}

<style>
  .page-header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .spacer {
    flex: 1 1 auto;
  }

  .num {
    width: 5rem;
  }

  .char {
    width: 3rem;
    text-align: center;
  }

  .mono {
    font-family: var(--font-mono);
  }

  .docs,
  .legend {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .docs li,
  .legend li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .doc-name {
    flex: 1 1 auto;
    text-align: left;
    background: none;
    border: none;
    color: var(--text-color);
    cursor: pointer;
    padding: var(--space-1) 0;
    display: flex;
    gap: var(--space-2);
    align-items: baseline;
  }

  .doc-name:hover {
    color: var(--color-primary-strong);
  }

  .swatch {
    width: 1.4rem;
    height: 1.4rem;
    border: 1.5px solid var(--border-strong-color);
    flex: none;
  }

  .brush {
    border: 1.5px solid var(--border-strong-color);
    padding: 0 var(--space-2);
    background: var(--surface-raised-color);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(var(--cols), 1fr);
    max-width: 34rem;
    border: 1.5px solid var(--border-strong-color);
    background: var(--surface-raised-color);
    touch-action: none;
  }

  .cell {
    aspect-ratio: 1;
    min-width: 0;
    padding: 0;
    text-align: center;
    border: 1px solid var(--border-color);
    font-size: var(--font-size-sm);
    background: transparent;
  }

  .preview-stage {
    display: flex;
    justify-content: center;
    padding: var(--space-5) var(--space-3);
    border: 1.5px solid var(--border-strong-color);
    background: var(--surface-raised-color);
    /* The 'jump' animation lifts the sprite — leave it room. */
    overflow: hidden;
  }

  .check,
  .inline {
    white-space: nowrap;
  }
</style>
