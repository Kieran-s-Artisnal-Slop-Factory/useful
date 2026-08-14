<script lang="ts">
  import Card from '../Card.svelte';
  import { DEFAULT_GLASS, GLASS_PRESETS, glassCss, glassInlineStyle, type GlassDef } from '../../lib/gen/glass';
  import { copyText } from '../../lib/exportFile';

  // Stateless tool — clone the default before handing it to $state.
  let def = $state<GlassDef>({ ...DEFAULT_GLASS });

  function applyPreset(preset: GlassDef) {
    def = { ...preset };
  }

  let css = $derived(glassCss(def));
  let inline = $derived(glassInlineStyle(def));

  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  async function copy() {
    copied = await copyText(css);
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (copied = false), 1500);
  }
</script>

<div class="page-header">
  <h1>Glassmorphism</h1>
</div>

<div class="stack">
  <Card title="Panel">
    <div class="stack">
    <fieldset class="presets">
      <legend class="eyebrow">Presets</legend>
      {#each GLASS_PRESETS as preset (preset.id)}
        <button
          class="btn btn-sm"
          data-testid={'gl-preset-' + preset.id}
          onclick={() => applyPreset(preset.def)}
        >
          {preset.label}
        </button>
      {/each}
    </fieldset>
    <div class="grid">
      <div>
        <label for="gl-blur">Backdrop blur (px)</label>
        <input id="gl-blur" data-testid="gl-blur" type="number" min="0" max="60" step="1" bind:value={def.blur} />
      </div>
      <div>
        <label for="gl-tint">Tint (any CSS color)</label>
        <input id="gl-tint" data-testid="gl-tint" type="text" class="mono" bind:value={def.tint} />
      </div>
      <div>
        <label for="gl-tint-opacity">Tint opacity (%)</label>
        <input
          id="gl-tint-opacity"
          data-testid="gl-tint-opacity"
          type="number"
          min="0"
          max="100"
          step="5"
          value={Math.round(def.tintOpacity * 100)}
          oninput={(e) => (def.tintOpacity = Number(e.currentTarget.value) / 100)}
        />
      </div>
      <div>
        <label for="gl-saturation">Backdrop saturation (%)</label>
        <input id="gl-saturation" data-testid="gl-saturation" type="number" min="0" max="300" step="10" bind:value={def.saturation} />
      </div>
      <div>
        <label for="gl-border-opacity">Border opacity (%)</label>
        <input
          id="gl-border-opacity"
          data-testid="gl-border-opacity"
          type="number"
          min="0"
          max="100"
          step="5"
          value={Math.round(def.borderOpacity * 100)}
          oninput={(e) => (def.borderOpacity = Number(e.currentTarget.value) / 100)}
        />
      </div>
      <div>
        <label for="gl-radius">Corner radius (px)</label>
        <input id="gl-radius" data-testid="gl-radius" type="number" min="0" max="48" step="1" bind:value={def.radius} />
      </div>
      <label class="check">
        <input type="checkbox" data-testid="gl-shadow" bind:checked={def.shadow} />
        Drop shadow
      </label>
    </div>
    </div>
  </Card>

  <Card title="Preview & CSS">
    <div class="stack">
      <div class="stage" aria-hidden="true">
        <div class="panel" data-testid="gl-preview" style={inline}>
          <span>frosted</span>
        </div>
      </div>
      <pre class="mono css" data-testid="gl-css">{css}</pre>
      <div class="row">
        <button class="btn btn-primary" data-testid="gl-copy" onclick={copy}>
          {copied ? 'Copied' : 'Copy CSS'}
        </button>
        <span class="muted small">
          backdrop-filter needs the panel to sit over other content to show.
        </span>
      </div>
    </div>
  </Card>
</div>

<style>
  .grid {
    display: grid;
    gap: var(--space-3);
    grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
    align-items: end;
  }

  .presets {
    border: 1px dashed var(--border-color);
    padding: var(--space-3);
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
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

  /* A busy backdrop so blur/saturation have something to chew on. */
  .stage {
    height: 12rem;
    display: grid;
    place-items: center;
    background:
      radial-gradient(circle at 20% 30%, #e8a13a 0 18%, transparent 40%),
      radial-gradient(circle at 75% 65%, #2f6fb0 0 22%, transparent 46%),
      repeating-linear-gradient(45deg, #1e3a5f 0 14px, #274a78 14px 28px);
    border: 1.5px solid var(--border-strong-color);
  }

  .panel {
    width: 60%;
    height: 7rem;
    display: grid;
    place-items: center;
    color: #fff;
    font-weight: 700;
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
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
