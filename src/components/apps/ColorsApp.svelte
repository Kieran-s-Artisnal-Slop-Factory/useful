<script lang="ts">
  import Card from '../Card.svelte';
  import Explainer from '../Explainer.svelte';
  import { allFormats, parseCssColor } from '../../lib/gen/color';
  import { copyText } from '../../lib/exportFile';

  // Stateless tool — pure view state, zero IndexedDB traffic.
  let input = $state('#1e3a5f');
  let copied = $state<string | null>(null);

  let parsed = $derived(parseCssColor(input));
  let formats = $derived(parsed ? allFormats(parsed) : null);

  // The native picker only speaks #rrggbb — feed it the clipped opaque hex.
  let pickerValue = $derived(formats ? formats.hex.slice(0, 7) : '#000000');

  const ROWS = ['hex', 'rgb', 'hsl', 'hwb', 'lab', 'lch', 'oklab', 'oklch'] as const;

  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  async function copy(key: string, value: string) {
    copied = (await copyText(value)) ? key : null;
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (copied = null), 1500);
  }
</script>

<div class="page-header">
  <h1>Colors</h1>
</div>

<div class="stack">
  <Card title="Color">
    <div class="stack">
      <div class="inputs">
        <div class="grow">
          <label for="col-input">Any CSS color</label>
          <input
            id="col-input"
            data-testid="col-input"
            type="text"
            autocomplete="off"
            spellcheck="false"
            placeholder="#1e3a5f · rgb(30 58 95) · oklch(0.35 0.07 250) · rebeccapurple"
            bind:value={input}
          />
        </div>
        <div>
          <label for="col-picker">Picker</label>
          <input
            id="col-picker"
            data-testid="col-picker"
            type="color"
            value={pickerValue}
            oninput={(e) => (input = e.currentTarget.value)}
          />
        </div>
      </div>

      {#if formats}
        <div class="swatch-row">
          <div class="swatch" style={`background: ${formats.rgb}`} aria-hidden="true"></div>
          <div>
            {#if formats.named}
              <p data-testid="col-named">Named color: <strong>{formats.named}</strong></p>
            {/if}
            {#if !formats.inGamut}
              <p class="warn" data-testid="col-gamut">
                Outside the sRGB gamut — values below are clipped to the nearest
                displayable color.
              </p>
            {/if}
          </div>
        </div>
      {:else}
        <p class="error" data-testid="col-invalid" role="alert">
          Not a recognizable CSS color.
        </p>
      {/if}
    </div>
  </Card>

  {#if formats}
    <Card title="Every spelling">
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Format</th>
              <th>Value</th>
              <th><span class="visually-hidden">Copy</span></th>
            </tr>
          </thead>
          <tbody>
            {#each ROWS as key (key)}
              <tr>
                <td class="fmt">{key}</td>
                <td class="mono" data-testid={'col-out-' + key}>{formats[key]}</td>
                <td class="act">
                  <button
                    class="btn btn-sm"
                    data-testid={'col-copy-' + key}
                    onclick={() => copy(key, formats![key])}
                  >
                    {copied === key ? 'Copied' : 'Copy'}
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </Card>
  {/if}

  <Explainer summary="Which format should I use?" testid="explainer-color-formats">
    <p>
      hex/rgb are the classic sRGB spellings. hsl and hwb are the same gamut with
      more human dials. lab/lch and oklab/oklch are perceptual spaces that can
      describe colors OUTSIDE sRGB — oklch is the modern pick for design systems
      because equal steps look equal, and hue stays put when you change lightness.
    </p>
    <p>
      Conversions here follow CSS Color 4 exactly (Lab/LCH on the D50 white point,
      OKLab from linear sRGB), so pasting any output into a stylesheet reproduces
      the same color.
    </p>
  </Explainer>
</div>

<style>
  .inputs {
    display: flex;
    gap: var(--space-3);
    align-items: flex-end;
    flex-wrap: wrap;
  }

  .grow {
    flex: 1 1 18rem;
  }

  input[type='color'] {
    width: 4rem;
    height: 2.7rem;
    padding: var(--space-1);
    cursor: pointer;
  }

  .swatch-row {
    display: flex;
    gap: var(--space-3);
    align-items: center;
  }

  .swatch {
    width: 4.5rem;
    height: 3rem;
    border: 1.5px solid var(--border-strong-color);
    flex: none;
  }

  .mono {
    font-family: var(--font-mono, ui-monospace, monospace);
    overflow-wrap: anywhere;
  }

  .fmt {
    text-transform: uppercase;
    font-size: var(--font-size-sm);
    letter-spacing: var(--tracking-wide);
    color: var(--text-muted-color);
  }

  .act {
    text-align: right;
  }

  .error {
    color: var(--color-danger);
    font-size: var(--font-size-sm);
  }

  .warn {
    color: var(--color-warning);
    font-size: var(--font-size-sm);
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
</style>
