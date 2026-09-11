<script lang="ts">
  import { onDestroy } from 'svelte';
  import Card from '../Card.svelte';
  import Explainer from '../Explainer.svelte';
  import {
    DEFAULT_BLINDS,
    DEFAULT_CIRCLE,
    DEFAULT_ELLIPSE,
    DEFAULT_WAVE,
    PRESETS,
    clipPathCss,
    presetPoints,
    type BlindsOptions,
    type Point,
    type Shape,
    type ShapeType,
    type WaveOptions,
  } from '../../lib/gen/clipPath';
  import { copyText } from '../../lib/exportFile';
  import { imageFromDrop, imageFromFiles } from '../../lib/img/ingest';
  import ColorField from '../ColorField.svelte';

  /**
   * Stateless tool (0.6.0 Phase 5, decision 5): every mode keeps its own
   * local runes, the pure module turns the active one into CSS, and nothing
   * is read from or written to the database. Module defaults are copied
   * before they meet `$state`, so the constants are never mutated.
   */
  const MODES: { id: ShapeType; label: string }[] = [
    { id: 'polygon', label: 'Polygon' },
    { id: 'circle', label: 'Circle' },
    { id: 'ellipse', label: 'Ellipse' },
    { id: 'blinds', label: 'Blinds' },
    { id: 'wave', label: 'Wave' },
  ];

  let mode = $state<ShapeType>('polygon');
  let presetId = $state('hexagon');
  // One array for the handles: dragging writes points[i] in place.
  let points = $state<Point[]>(presetPoints('hexagon'));
  let circle = $state({ ...DEFAULT_CIRCLE });
  let ellipse = $state({ ...DEFAULT_ELLIPSE });
  let blinds = $state<BlindsOptions>({ ...DEFAULT_BLINDS });
  let wave = $state<WaveOptions>({ ...DEFAULT_WAVE });
  let selected = $state<number | null>(null);

  let shape = $derived.by((): Shape => {
    switch (mode) {
      case 'polygon':
        return { type: 'polygon', points };
      case 'circle':
        return { type: 'circle', ...circle };
      case 'ellipse':
        return { type: 'ellipse', ...ellipse };
      case 'blinds':
        return { type: 'blinds', ...blinds };
      case 'wave':
        return { type: 'wave', ...wave };
    }
  });
  let result = $derived(clipPathCss(shape));

  function applyPreset(id: string) {
    presetId = id;
    points = presetPoints(id);
    selected = null;
    mode = 'polygon';
  }

  // ---- copy ---------------------------------------------------------------
  let copied = $state(false);
  let copiedAlt = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  async function copy() {
    copied = await copyText(result.css);
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (copied = false), 1500);
  }
  let altTimer: ReturnType<typeof setTimeout> | undefined;
  async function copyAlt() {
    if (!result.alternate) return;
    copiedAlt = await copyText(result.alternate.css);
    clearTimeout(altTimer);
    altTimer = setTimeout(() => (copiedAlt = false), 1500);
  }

  // ---- preview stage -------------------------------------------------------
  /**
   * The stage is width-bound with a chosen aspect ratio (feedback round 1: a
   * box that fills the column stretches every shape). Handles and the overlay
   * position themselves in percent of the stage box, so any ratio maps 1:1.
   */
  const RATIOS: { id: string; w: number; h: number }[] = [
    { id: '1/1', w: 1, h: 1 },
    { id: '4/3', w: 4, h: 3 },
    { id: '3/2', w: 3, h: 2 },
    { id: '16/9', w: 16, h: 9 },
    { id: '9/16', w: 9, h: 16 },
    { id: '3/4', w: 3, h: 4 },
    { id: '2/3', w: 2, h: 3 },
    { id: '21/9', w: 21, h: 9 },
  ];
  /** The tallest the stage may grow; the width follows so the ratio holds. */
  const STAGE_MAX_HEIGHT_REM = 26;
  let aspect = $state('4/3');
  let stageStyle = $derived.by(() => {
    const r = RATIOS.find((x) => x.id === aspect) ?? RATIOS[1];
    // `min(…)` keeps the box width-bound: a max-height alone would cap the
    // height and leave the width (and so the ratio) wrong. The 1rem is the
    // stage's own side margins, which `100%` does not include.
    return `aspect-ratio: ${r.w} / ${r.h}; width: min(calc(100% - 1rem), ${(STAGE_MAX_HEIGHT_REM * r.w) / r.h}rem);`;
  });

  // ---- preview fill --------------------------------------------------------
  type Fill = 'solid' | 'gradient' | 'image';
  const FILLS: { id: Fill; label: string }[] = [
    { id: 'solid', label: 'Solid' },
    { id: 'gradient', label: 'Gradient' },
    { id: 'image', label: 'Image' },
  ];
  let fill = $state<Fill>('solid');
  let fillColor = $state('#e8a13a');
  let gradientFrom = $state('#1e3a5f');
  let gradientTo = $state('#e8a13a');
  let gradientAngle = $state(135);

  let stage = $state<HTMLDivElement | null>(null);
  let imageUrl = $state<string | null>(null);
  let imageError = $state<string | null>(null);
  let dragging = $state(false);

  async function acceptFiles(promise: ReturnType<typeof imageFromFiles>) {
    const res = await promise;
    if (res.ok) {
      imageUrl = res.image.canvas.toDataURL('image/png');
      imageError = null;
      fill = 'image';
    } else {
      imageError = res.message;
    }
  }
  async function onPick(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    await acceptFiles(imageFromFiles(input.files));
    input.value = '';
  }
  async function onDrop(event: DragEvent) {
    event.preventDefault();
    dragging = false;
    await acceptFiles(imageFromDrop(event));
  }
  function clearImage() {
    imageUrl = null;
    imageError = null;
  }

  /**
   * One inline style for the sample. An unparseable colour mid-typing makes
   * the browser drop that declaration, so the `.sample` fallback shows until
   * the text resolves again — nothing else needs to validate it.
   */
  let previewStyle = $derived.by(() => {
    const clip = `clip-path: ${result.value};`;
    if (fill === 'image' && imageUrl) {
      return `${clip} background-image: url("${imageUrl}"); background-size: cover; background-position: center;`;
    }
    if (fill === 'gradient') {
      return `${clip} background-image: linear-gradient(${gradientAngle}deg, ${gradientFrom}, ${gradientTo});`;
    }
    return `${clip} background-color: ${fillColor};`;
  });

  // ---- handles ------------------------------------------------------------
  const clamp = (n: number) => Math.min(100, Math.max(0, n));
  const round = (n: number) => Math.round(n * 10) / 10;

  /** Pointer position as percent of the stage box. */
  function toPercent(event: PointerEvent | MouseEvent): Point {
    const box = stage!.getBoundingClientRect();
    return [
      round(clamp(((event.clientX - box.left) / box.width) * 100)),
      round(clamp(((event.clientY - box.top) / box.height) * 100)),
    ];
  }

  let dragIndex: number | null = null;
  /**
   * The drag listens on `window` for the move and the release rather than on
   * the handle: a 14 px button half outside the stage loses the pointer the
   * moment it is dragged past its own edge, and pointer capture alone did not
   * hold it in every engine.
   */
  function onHandleDown(event: PointerEvent, i: number) {
    if (event.button !== 0) return;
    event.preventDefault();
    selected = i;
    dragIndex = i;
    window.addEventListener('pointermove', onHandleMove);
    window.addEventListener('pointerup', onHandleUp, { once: true });
    window.addEventListener('pointercancel', onHandleUp, { once: true });
  }
  function onHandleMove(event: PointerEvent) {
    if (dragIndex === null) return;
    points[dragIndex] = toPercent(event);
  }
  function onHandleUp() {
    window.removeEventListener('pointermove', onHandleMove);
    window.removeEventListener('pointerup', onHandleUp);
    window.removeEventListener('pointercancel', onHandleUp);
    dragIndex = null;
  }
  onDestroy(onHandleUp);
  function nudge(event: KeyboardEvent, i: number) {
    const step = event.shiftKey ? 5 : 1;
    const [x, y] = points[i];
    switch (event.key) {
      case 'ArrowLeft': points[i] = [clamp(x - step), y]; break;
      case 'ArrowRight': points[i] = [clamp(x + step), y]; break;
      case 'ArrowUp': points[i] = [x, clamp(y - step)]; break;
      case 'ArrowDown': points[i] = [x, clamp(y + step)]; break;
      case 'Delete':
      case 'Backspace': removePoint(i); break;
      default: return;
    }
    event.preventDefault();
  }

  function removePoint(i: number) {
    if (points.length <= 3) return;
    points.splice(i, 1);
    selected = null;
  }
  function onHandleContext(event: MouseEvent, i: number) {
    event.preventDefault();
    removePoint(i);
  }

  /** Double-click on edge i (from point i to i + 1) inserts a point there. */
  function addPointOnEdge(event: MouseEvent, i: number) {
    event.preventDefault();
    points.splice(i + 1, 0, toPercent(event));
    selected = i + 1;
  }
  /** Double-click anywhere else on the stage appends a point at the click. */
  function addPointAtEnd(event: MouseEvent) {
    if (mode !== 'polygon') return;
    points.push(toPercent(event));
    selected = points.length - 1;
  }

  const edges = $derived(points.map((p, i) => [p, points[(i + 1) % points.length]] as [Point, Point]));
</script>

<div class="page-header">
  <h1>Clip path</h1>
</div>

<div class="stack">
  <Card title="Shape">
    <div class="stack">
      <div class="modes" role="group" aria-label="Shape kind">
        {#each MODES as m (m.id)}
          <button
            class="btn btn-sm"
            class:btn-primary={mode === m.id}
            aria-pressed={mode === m.id}
            data-testid={'cp-mode-' + m.id}
            onclick={() => (mode = m.id)}
          >
            {m.label}
          </button>
        {/each}
      </div>

      {#if mode === 'polygon'}
        <fieldset class="presets">
          <legend class="eyebrow">Presets</legend>
          <div class="preset-grid">
            {#each PRESETS as preset (preset.id)}
              <button
                class="preset"
                class:active={presetId === preset.id}
                data-testid={'cp-preset-' + preset.id}
                aria-pressed={presetId === preset.id}
                title={preset.label}
                onclick={() => applyPreset(preset.id)}
              >
                <svg viewBox="0 0 100 100" aria-hidden="true">
                  <polygon points={preset.points.map(([x, y]) => `${x},${y}`).join(' ')} />
                </svg>
                <span>{preset.label}</span>
              </button>
            {/each}
          </div>
        </fieldset>
        <p class="muted small">
          Drag a handle to move a point. Double-click an edge to add a point there, double-click
          empty space to append one. Right-click a handle (or Delete with it focused) to remove it —
          arrow keys nudge a focused handle by 1 %, Shift for 5 %.
        </p>
        <div class="row">
          <span class="muted small" data-testid="cp-point-count">{points.length} points</span>
          {#if selected !== null}
            <button
              class="btn btn-sm"
              data-testid="cp-remove-point"
              disabled={points.length <= 3}
              onclick={() => removePoint(selected!)}
            >
              × Remove point {selected + 1}
            </button>
          {/if}
          <button class="btn btn-sm" data-testid="cp-reset" onclick={() => applyPreset(presetId)}>
            Reset to preset
          </button>
        </div>
      {:else if mode === 'circle'}
        <div class="grid">
          <div>
            <label for="cp-radius">Radius: {circle.radius}%</label>
            <input id="cp-radius" data-testid="cp-radius" type="range" min="0" max="100" step="1" bind:value={circle.radius} />
          </div>
          <div>
            <label for="cp-circle-cx">Centre X: {circle.cx}%</label>
            <input id="cp-circle-cx" data-testid="cp-circle-cx" type="range" min="0" max="100" step="1" bind:value={circle.cx} />
          </div>
          <div>
            <label for="cp-circle-cy">Centre Y: {circle.cy}%</label>
            <input id="cp-circle-cy" data-testid="cp-circle-cy" type="range" min="0" max="100" step="1" bind:value={circle.cy} />
          </div>
        </div>
        <p class="muted small">
          A percent radius is measured against the box's diagonal (√(w² + h²) / √2), so 50 %
          is not "half the width" on a wide box.
        </p>
      {:else if mode === 'ellipse'}
        <div class="grid">
          <div>
            <label for="cp-rx">Horizontal radius: {ellipse.rx}%</label>
            <input id="cp-rx" data-testid="cp-rx" type="range" min="0" max="100" step="1" bind:value={ellipse.rx} />
          </div>
          <div>
            <label for="cp-ry">Vertical radius: {ellipse.ry}%</label>
            <input id="cp-ry" data-testid="cp-ry" type="range" min="0" max="100" step="1" bind:value={ellipse.ry} />
          </div>
          <div>
            <label for="cp-ellipse-cx">Centre X: {ellipse.cx}%</label>
            <input id="cp-ellipse-cx" data-testid="cp-ellipse-cx" type="range" min="0" max="100" step="1" bind:value={ellipse.cx} />
          </div>
          <div>
            <label for="cp-ellipse-cy">Centre Y: {ellipse.cy}%</label>
            <input id="cp-ellipse-cy" data-testid="cp-ellipse-cy" type="range" min="0" max="100" step="1" bind:value={ellipse.cy} />
          </div>
        </div>
      {:else if mode === 'blinds'}
        <div class="grid">
          <div>
            <label for="cp-blinds-count">Strips: {blinds.count}</label>
            <input id="cp-blinds-count" data-testid="cp-blinds-count" type="range" min="1" max="24" step="1" bind:value={blinds.count} />
          </div>
          <div>
            <label for="cp-blinds-gap">Gap: {blinds.gap}%</label>
            <input id="cp-blinds-gap" data-testid="cp-blinds-gap" type="range" min="0" max="40" step="0.5" bind:value={blinds.gap} />
          </div>
          <div>
            <label for="cp-blinds-direction">Direction</label>
            <select id="cp-blinds-direction" data-testid="cp-blinds-direction" bind:value={blinds.direction}>
              <option value="horizontal">Horizontal bars</option>
              <option value="vertical">Vertical bars</option>
            </select>
          </div>
        </div>
      {:else}
        <div class="grid">
          <div>
            <label for="cp-waves">Waves: {wave.waves}</label>
            <input id="cp-waves" data-testid="cp-waves" type="range" min="1" max="12" step="1" bind:value={wave.waves} />
          </div>
          <div>
            <label for="cp-amplitude">Amplitude: {wave.amplitude}%</label>
            <input id="cp-amplitude" data-testid="cp-amplitude" type="range" min="0" max="50" step="1" bind:value={wave.amplitude} />
          </div>
          <div>
            <label for="cp-phase">Phase: {wave.phase}°</label>
            <input id="cp-phase" data-testid="cp-phase" type="range" min="0" max="360" step="5" bind:value={wave.phase} />
          </div>
          <div>
            <label for="cp-wave-kind">Waveform</label>
            <select id="cp-wave-kind" data-testid="cp-wave-kind" bind:value={wave.kind}>
              <option value="sine">Sine</option>
              <option value="triangle">Triangle</option>
              <option value="square">Square</option>
              <option value="sawtooth">Sawtooth</option>
            </select>
          </div>
          <div>
            <label for="cp-wave-edge">Edge</label>
            <select id="cp-wave-edge" data-testid="cp-wave-edge" bind:value={wave.edge}>
              <option value="top">Top</option>
              <option value="bottom">Bottom</option>
            </select>
          </div>
        </div>
      {/if}
    </div>
  </Card>

  <Card title="Preview & CSS">
    <div class="stack">
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="stage-wrap"
        class:over={dragging}
        ondragover={(e) => {
          e.preventDefault();
          dragging = true;
        }}
        ondragleave={() => (dragging = false)}
        ondrop={onDrop}
      >
        <div class="stage" data-testid="cp-stage" style={stageStyle} bind:this={stage} ondblclick={addPointAtEnd}>
          <div class="sample" data-testid="cp-preview" style={previewStyle}></div>
          <svg class="overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {#if mode !== 'circle'}
              <path class="outline" d={result.previewPath} />
            {/if}
            {#if mode === 'polygon'}
              {#each edges as [a, b], i (i)}
                <line
                  class="edge"
                  x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]}
                  ondblclick={(e) => { e.stopPropagation(); addPointOnEdge(e, i); }}
                />
              {/each}
            {/if}
          </svg>
          {#if mode === 'polygon'}
            {#each points as [x, y], i (i)}
              <button
                class="handle"
                class:selected={selected === i}
                data-testid={'cp-handle-' + i}
                aria-label={`Point ${i + 1}: ${x}% ${y}%`}
                title={`Point ${i + 1}: ${x}% ${y}%`}
                style={`left: ${x}%; top: ${y}%;`}
                onpointerdown={(e) => onHandleDown(e, i)}
                oncontextmenu={(e) => onHandleContext(e, i)}
                onkeydown={(e) => nudge(e, i)}
                ondblclick={(e) => e.stopPropagation()}
              ></button>
            {/each}
          {/if}
        </div>
      </div>

      <div class="grid">
        <div>
          <label for="cp-aspect">Aspect ratio</label>
          <select id="cp-aspect" data-testid="cp-aspect" bind:value={aspect}>
            {#each RATIOS as r (r.id)}
              <option value={r.id}>{r.id}</option>
            {/each}
          </select>
        </div>
        <div>
          <span class="label-text" id="cp-fill-label">Fill</span>
          <div class="modes" role="group" aria-labelledby="cp-fill-label">
            {#each FILLS as f (f.id)}
              <button
                class="btn btn-sm"
                class:btn-primary={fill === f.id}
                aria-pressed={fill === f.id}
                data-testid={'cp-fill-' + f.id}
                onclick={() => (fill = f.id)}
              >
                {f.label}
              </button>
            {/each}
          </div>
        </div>
      </div>

      {#if fill === 'solid'}
        <div class="grid">
          <div>
            <label for="cp-fill-color">Colour</label>
            <ColorField id="cp-fill-color" testid="cp-fill-color" bind:value={fillColor} fallback="#e8a13a" ariaLabel="Fill colour" />
          </div>
        </div>
      {:else if fill === 'gradient'}
        <div class="grid">
          <div>
            <label for="cp-gradient-from">From</label>
            <ColorField id="cp-gradient-from" testid="cp-gradient-from" bind:value={gradientFrom} fallback="#1e3a5f" ariaLabel="Gradient start colour" />
          </div>
          <div>
            <label for="cp-gradient-to">To</label>
            <ColorField id="cp-gradient-to" testid="cp-gradient-to" bind:value={gradientTo} fallback="#e8a13a" ariaLabel="Gradient end colour" />
          </div>
          <div>
            <label for="cp-gradient-angle">Angle: {gradientAngle}°</label>
            <input id="cp-gradient-angle" data-testid="cp-gradient-angle" type="range" min="0" max="360" step="1" bind:value={gradientAngle} />
          </div>
        </div>
      {:else}
        <div class="row">
          <label class="file-label" for="cp-image">
            Preview image — choose one, or drop it on the preview
            <input id="cp-image" data-testid="cp-image" type="file" accept="image/*" onchange={onPick} />
          </label>
          {#if imageUrl}
            <button class="btn btn-sm" data-testid="cp-image-clear" onclick={clearImage}>Remove image</button>
          {/if}
        </div>
        {#if imageError}
          <p class="error" role="alert" data-testid="cp-image-error">{imageError}</p>
        {/if}
      {/if}

      <pre class="mono css" data-testid="cp-css">{result.css}</pre>
      <div class="row">
        <button class="btn btn-primary" data-testid="cp-copy" onclick={copy}>
          {copied ? 'Copied' : 'Copy CSS'}
        </button>
        <span class="muted small">Percent units — the same line fits an element of any size.</span>
      </div>

      {#if result.alternate}
        <div class="stack alt">
          <span class="eyebrow">{result.alternate.label}</span>
          <pre class="mono css" data-testid="cp-path-css">{result.alternate.css}</pre>
          <div class="row">
            <button class="btn btn-sm" data-testid="cp-copy-path" onclick={copyAlt}>
              {copiedAlt ? 'Copied' : 'Copy path()'}
            </button>
            <span class="muted small">{result.alternate.note}</span>
          </div>
        </div>
      {/if}

      <Explainer summary="Why blinds and waves are polygons" testid="cp-explainer">
        <p>
          CSS <code>path()</code> takes pixel coordinates and has no viewBox, so a
          <code>path()</code> clip only fits one element size. A <code>polygon()</code> in
          percent fits any size — and it can hold several separate rectangles: the outline
          walks along the box edge between strips and the closing edge walks back over the same
          line. Those two runs enclose no area, so the gaps stay outside under either fill rule.
          Waves are the same polygon sampled along the wavy edge (16 points per wave, exact
          corners for square and sawtooth); the <code>path()</code> spelling is offered for a
          fixed 100 × 100 px box only.
        </p>
      </Explainer>
    </div>
  </Card>
</div>

<style>
  .modes {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .grid {
    display: grid;
    gap: var(--space-3);
    grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
    align-items: end;
  }

  .presets {
    border: 1px dashed var(--border-color);
    padding: var(--space-3);
  }

  .preset-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(5.5rem, 1fr));
    gap: var(--space-2);
  }

  .preset {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-2);
    background: var(--surface-color);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    color: var(--text-muted-color);
    font: inherit;
    font-size: var(--font-size-sm);
    cursor: pointer;
  }

  .preset:hover,
  .preset.active {
    border-color: var(--color-primary);
    color: var(--text-color);
  }

  .preset svg {
    width: 2.5rem;
    height: 2.5rem;
  }

  .preset polygon {
    fill: var(--color-primary);
    opacity: 0.85;
  }

  .preset.active polygon {
    opacity: 1;
  }

  .stage-wrap {
    border: 1.5px solid var(--border-strong-color);
    padding: var(--space-3);
    background:
      repeating-linear-gradient(45deg, transparent 0 10px, color-mix(in srgb, var(--border-color) 40%, transparent) 10px 20px);
  }

  .stage-wrap.over {
    outline: 2px dashed var(--color-primary);
  }

  .stage {
    position: relative;
    /* Ratio and width come inline from the Aspect ratio select. */
    box-sizing: border-box;
    /* A little room so handles on the box edge stay reachable; auto centres. */
    margin: 0.5rem auto;
  }

  .sample {
    position: absolute;
    inset: 0;
    /* Fallback while a typed colour does not parse yet. */
    background-color: #e8a13a;
  }

  .label-text {
    display: block;
    margin-bottom: var(--space-1);
  }

  .overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
  }

  .outline {
    fill: none;
    stroke: var(--color-stamp, #fff);
    stroke-width: 1.5px;
    stroke-dasharray: 4 3;
    vector-effect: non-scaling-stroke;
  }

  .edge {
    stroke: transparent;
    stroke-width: 14px;
    vector-effect: non-scaling-stroke;
    pointer-events: stroke;
    cursor: copy;
  }

  .handle {
    position: absolute;
    width: 14px;
    height: 14px;
    margin: -7px 0 0 -7px;
    padding: 0;
    border-radius: 50%;
    border: 2px solid #fff;
    background: var(--color-primary);
    box-shadow: 0 0 0 1px rgb(0 0 0 / 0.4);
    cursor: grab;
    touch-action: none;
  }

  .handle:active {
    cursor: grabbing;
  }

  .handle.selected {
    background: var(--color-stamp, #e8a13a);
  }

  .file-label {
    text-transform: none;
    letter-spacing: normal;
    margin: 0;
  }

  .file-label input {
    margin-top: var(--space-1);
  }

  .alt {
    border-top: 1px dashed var(--border-color);
    padding-top: var(--space-3);
  }

  .error {
    color: var(--color-danger, #b3261e);
  }

  .css {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .mono {
    font-family: var(--font-mono, ui-monospace, monospace);
  }

  .small {
    font-size: var(--font-size-sm);
  }
</style>
