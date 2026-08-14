<script lang="ts">
  import Card from '../Card.svelte';
  import { DEFAULT_GRADIENT, gradientCss, gradientDeclaration, type GradientDef } from '../../lib/gen/gradient';
  import { parseCssColor } from '../../lib/gen/color';
  import { copyText } from '../../lib/exportFile';

  // Stateless tool — deep-clone the default so $state never mutates the
  // module-level constant.
  let def = $state<GradientDef>({
    ...DEFAULT_GRADIENT,
    stops: DEFAULT_GRADIENT.stops.map((s) => ({ ...s })),
  });

  let css = $derived(gradientCss(def));
  let declaration = $derived(gradientDeclaration(def));

  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  async function copy() {
    copied = await copyText(declaration);
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (copied = false), 1500);
  }

  function addStop() {
    def.stops.push({ color: '#ffffff', position: null });
  }

  function removeStop(i: number) {
    if (def.stops.length > 2) def.stops.splice(i, 1);
  }

  const validColor = (c: string): boolean => parseCssColor(c) !== null;
</script>

<div class="page-header">
  <h1>Gradients</h1>
</div>

<div class="stack">
  <Card title="Gradient">
    <div class="stack">
      <div class="controls">
        <div>
          <label for="gr-kind">Type</label>
          <select id="gr-kind" data-testid="gr-kind" bind:value={def.kind}>
            <option value="linear">Linear</option>
            <option value="radial">Radial</option>
            <option value="conic">Conic</option>
          </select>
        </div>
        {#if def.kind !== 'radial'}
          <div>
            <label for="gr-angle">{def.kind === 'linear' ? 'Angle (deg)' : 'From angle (deg)'}</label>
            <input id="gr-angle" data-testid="gr-angle" type="number" step="1" bind:value={def.angle} />
          </div>
        {:else}
          <div>
            <label for="gr-shape">Shape</label>
            <select id="gr-shape" data-testid="gr-shape" bind:value={def.shape}>
              <option value="ellipse">Ellipse</option>
              <option value="circle">Circle</option>
            </select>
          </div>
        {/if}
        <label class="check">
          <input type="checkbox" data-testid="gr-repeating" bind:checked={def.repeating} />
          Repeating
        </label>
      </div>

      <fieldset class="stops">
        <legend class="eyebrow">Stops</legend>
        {#each def.stops as stop, i (i)}
          <div class="stop">
            <input
              type="text"
              class="mono"
              data-testid={'gr-stop-color-' + i}
              aria-label={'Stop ' + (i + 1) + ' color'}
              aria-invalid={!validColor(stop.color)}
              bind:value={stop.color}
            />
            <input
              type="number"
              class="pos"
              data-testid={'gr-stop-pos-' + i}
              aria-label={'Stop ' + (i + 1) + ' position %'}
              placeholder="auto"
              min="0"
              max="100"
              value={stop.position ?? ''}
              oninput={(e) => {
                const v = e.currentTarget.value;
                stop.position = v === '' ? null : Number(v);
              }}
            />
            <button
              class="btn btn-sm"
              data-testid={'gr-stop-remove-' + i}
              onclick={() => removeStop(i)}
              disabled={def.stops.length <= 2}
              aria-label={'Remove stop ' + (i + 1)}
            >✕</button>
          </div>
        {/each}
        <button class="btn btn-sm" data-testid="gr-add-stop" onclick={addStop}>+ Add stop</button>
      </fieldset>
    </div>
  </Card>

  <Card title="Preview & CSS">
    <div class="stack">
      <div class="preview" data-testid="gr-preview" style={`background: ${css}`}></div>
      <pre class="mono css" data-testid="gr-css">{declaration}</pre>
      <div class="row">
        <button class="btn btn-primary" data-testid="gr-copy" onclick={copy}>
          {copied ? 'Copied' : 'Copy CSS'}
        </button>
      </div>
    </div>
  </Card>
</div>

<style>
  .controls {
    display: flex;
    gap: var(--space-3);
    align-items: flex-end;
    flex-wrap: wrap;
  }

  .controls > div {
    min-width: 9rem;
  }

  .check {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--text-color);
    font-size: var(--font-size-base);
    text-transform: none;
    letter-spacing: normal;
    margin-bottom: var(--space-2);
  }

  .stops {
    border: 1px dashed var(--border-color);
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    align-items: flex-start;
  }

  .stop {
    display: flex;
    gap: var(--space-2);
    width: 100%;
  }

  .stop input[aria-invalid='true'] {
    border-color: var(--color-danger);
  }

  .pos {
    width: 6rem;
    flex: none;
  }

  .stop .btn {
    flex: none;
  }

  .preview {
    height: 10rem;
    border: 1.5px solid var(--border-strong-color);
  }

  .css {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .mono {
    font-family: var(--font-mono, ui-monospace, monospace);
  }
</style>
