<script lang="ts">
  import Card from '../Card.svelte';
  import Explainer from '../Explainer.svelte';
  import { allFormats, parseCssColor } from '../../lib/gen/color';
  import { harmonies } from '../../lib/gen/harmony';
  import { buildTheme, THEME_ROLES } from '../../lib/gen/theme';
  import { copyText } from '../../lib/exportFile';

  // Stateless tool — pure view state, zero IndexedDB traffic.
  let input = $state('#1e3a5f');
  let copied = $state<string | null>(null);

  let parsed = $derived(parseCssColor(input));
  let formats = $derived(parsed ? allFormats(parsed) : null);
  let wheel = $derived(parsed ? harmonies(parsed) : null);

  // The native picker only speaks #rrggbb — feed it the clipped opaque hex.
  let pickerValue = $derived(formats ? formats.hex.slice(0, 7) : '#000000');

  const ROWS = ['hex', 'rgb', 'hsl', 'hwb', 'lab', 'lch', 'oklab', 'oklch'] as const;

  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  async function copy(key: string, value: string) {
    copied = (await copyText(value)) ? key : null;
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (copied = null), 1500);
  }

  /* ------------------------------------------------------ theme builder --- */
  const ROLE_HINTS: Record<string, string> = {
    primary: 'buttons, links, focus',
    secondary: 'supporting actions',
    accent: 'highlights, badges',
    neutral: 'muted text, chrome',
    base: 'page background',
  };

  // Primary defaults to the color explored above; the rest derive until set.
  let themeColors = $state<string[]>(['#1e3a5f', '', '', '', '']);
  let paddingPx = $state(12);
  let radiusPx = $state(8);
  let scheme = $state<'auto' | 'light' | 'dark'>('auto');

  let theme = $derived(
    buildTheme({
      colors: themeColors.map((c) => (c.trim().length > 0 ? c : null)),
      paddingPx,
      radiusPx,
    })
  );

  let previewStyle = $derived(
    theme.vars.map(([name, value]) => `${name}: ${value}`).join('; ') +
      (scheme === 'auto' ? '' : `; color-scheme: ${scheme}`)
  );

  function useAsPrimary() {
    if (formats) themeColors[0] = formats.hex.slice(0, 7);
  }
</script>

<div class="page-header">
  <h1>Themes</h1>
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

  {#if wheel}
    <Card title="Harmonies">
      <div class="stack">
        {#each wheel as harmony (harmony.id)}
          <div data-testid={'harmony-' + harmony.id}>
            <div class="harmony-head">
              <h3 class="eyebrow">{harmony.label}</h3>
              <span class="muted small">{harmony.description}</span>
            </div>
            <div class="chips">
              {#each harmony.colors as hex (hex)}
                <button
                  class="chip"
                  data-testid={'harmony-' + harmony.id + '-chip'}
                  style={`background: ${hex}`}
                  title={'Copy ' + hex}
                  aria-label={'Copy ' + hex}
                  onclick={() => copy(harmony.id + hex, hex)}
                >
                  <span class="chip-hex" class:copied={copied === harmony.id + hex}>
                    {copied === harmony.id + hex ? 'copied' : hex}
                  </span>
                </button>
              {/each}
            </div>
          </div>
        {/each}
        <Explainer summary="How harmonies are computed" testid="explainer-harmony">
          <p>
            Rotations on the classic HSL color wheel, keeping your color's saturation
            and lightness: complementary is the hue 180° across, analogous the
            neighbors ±30°, tetradic the rectangle at +60°/+180°/+240°. Monochromatic
            keeps the hue and steps lightness instead. Click any swatch to copy it —
            or feed it into the theme builder below.
          </p>
        </Explainer>
      </div>
    </Card>
  {/if}

  <Card title="Theme builder">
    {#snippet actions()}
      <button class="btn btn-sm" data-testid="th-use-color" onclick={useAsPrimary}>
        Use color above as primary
      </button>
    {/snippet}
    <div class="stack">
      <p class="muted small">
        Give it one to five colors — anything left blank is derived from the primary.
        Output is plain CSS variables with automatic light/dark via
        <code>light-dark()</code>.
      </p>

      <div class="roles">
        {#each THEME_ROLES as role, i (role)}
          <div class="role">
            <label for={'th-color-' + role}>
              {role}
              <span class="muted hint">· {ROLE_HINTS[role]}</span>
            </label>
            <div class="role-line">
              <input
                id={'th-color-' + role}
                data-testid={'th-color-' + role}
                type="text"
                class="mono"
                placeholder="auto"
                bind:value={themeColors[i]}
              />
              <span
                class="mini-chip"
                data-testid={'th-chip-' + role}
                style={`background: ${theme.swatches[i]!.light}`}
                title={'light: ' + theme.swatches[i]!.light}
              ></span>
              <span
                class="mini-chip"
                style={`background: ${theme.swatches[i]!.dark}`}
                title={'dark: ' + theme.swatches[i]!.dark}
              ></span>
              {#if theme.swatches[i]!.derived}
                <span class="eyebrow" data-testid={'th-derived-' + role}>auto</span>
              {/if}
            </div>
          </div>
        {/each}
      </div>

      <div class="row">
        <div>
          <label for="th-padding">Padding (px)</label>
          <input id="th-padding" data-testid="th-padding" class="num" type="number" min="0" max="48" bind:value={paddingPx} />
        </div>
        <div>
          <label for="th-radius">Border radius (px)</label>
          <input id="th-radius" data-testid="th-radius" class="num" type="number" min="0" max="48" bind:value={radiusPx} />
        </div>
        <fieldset class="scheme">
          <legend class="eyebrow">Preview scheme</legend>
          {#each ['auto', 'light', 'dark'] as s (s)}
            <label class="check">
              <input type="radio" name="th-scheme" value={s} data-testid={'th-scheme-' + s} bind:group={scheme} />
              {s}
            </label>
          {/each}
        </fieldset>
      </div>

      <div class="preview" data-testid="th-preview" style={previewStyle}>
        <div class="pv-card">
          <h4>Card</h4>
          <p>Plaintext on the surface. <a href="#th" onclick={(e) => e.preventDefault()}>An inline link</a> and
            <span class="pv-badge">accent badge</span>.</p>
          <button class="pv-btn">Primary action</button>
          <button class="pv-btn secondary">Secondary</button>
        </div>

        <details class="pv-accordion">
          <summary>Accordion — click to toggle</summary>
          <p>Collapsible content styled by the same variables.</p>
        </details>

        <table class="pv-table">
          <thead>
            <tr><th>Item</th><th>State</th></tr>
          </thead>
          <tbody>
            <tr><td>First row</td><td>ready</td></tr>
            <tr><td>Second row</td><td>waiting</td></tr>
          </tbody>
        </table>

        <div class="pv-form">
          <label>
            Text field
            <input type="text" placeholder="Type here" />
          </label>
          <label>
            Select
            <select><option>Option A</option><option>Option B</option></select>
          </label>
          <label class="pv-check">
            <input type="checkbox" checked />
            Checkbox
          </label>
        </div>
      </div>

      <pre class="mono css" data-testid="th-css">{theme.css}</pre>
      <div class="row">
        <button class="btn btn-primary" data-testid="th-copy" onclick={() => copy('theme', theme.css)}>
          {copied === 'theme' ? 'Copied' : 'Copy CSS'}
        </button>
      </div>
    </div>
  </Card>

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

  .small {
    font-size: var(--font-size-sm);
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }

  /* ------------------------------------------------------------ harmonies */
  .harmony-head {
    display: flex;
    gap: var(--space-2);
    align-items: baseline;
    flex-wrap: wrap;
    margin-bottom: var(--space-2);
  }

  .chips {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .chip {
    width: 6.5rem;
    height: 3.2rem;
    border: 1.5px solid var(--border-strong-color);
    border-radius: var(--radius-sm);
    cursor: pointer;
    display: grid;
    place-items: end start;
    padding: var(--space-1);
  }

  .chip-hex {
    font-size: var(--font-size-eyebrow);
    font-family: var(--font-mono, ui-monospace, monospace);
    background: color-mix(in srgb, #000 55%, transparent);
    color: #fff;
    padding: 0 var(--space-1);
    border-radius: 2px;
  }

  /* -------------------------------------------------------- theme builder */
  .roles {
    display: grid;
    gap: var(--space-3);
    grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
  }

  .hint {
    text-transform: none;
    letter-spacing: normal;
  }

  .role-line {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }

  .mini-chip {
    width: 1.6rem;
    height: 1.6rem;
    flex: none;
    border: 1px solid var(--border-strong-color);
    border-radius: var(--radius-sm);
  }

  .num {
    width: 6rem;
  }

  .scheme {
    border: 1px dashed var(--border-color);
    padding: var(--space-2) var(--space-3);
    display: flex;
    gap: var(--space-3);
  }

  .check {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--text-color);
    font-size: var(--font-size-base);
    text-transform: none;
    letter-spacing: normal;
    margin-bottom: 0;
  }

  .css {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  /* ------------------------------------------------- the preview "window".
     Everything below styles ONLY with the generated variables, so what you
     see is what the copied CSS produces. */
  .preview {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: calc(var(--padding) * 1.5);
    display: flex;
    flex-direction: column;
    gap: calc(var(--padding) * 1.25);
  }

  .pv-card {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: var(--padding);
  }

  .pv-card h4 {
    margin-bottom: calc(var(--padding) / 2);
  }

  .pv-card p {
    margin-bottom: var(--padding);
  }

  .preview a {
    color: var(--primary);
  }

  .pv-badge {
    background: var(--accent);
    color: var(--on-accent);
    border-radius: var(--radius);
    padding: 0 calc(var(--padding) / 2);
    font-size: var(--font-size-sm);
  }

  .pv-btn {
    background: var(--primary);
    color: var(--on-primary);
    border: 1px solid var(--primary);
    border-radius: var(--radius);
    padding: calc(var(--padding) / 2) var(--padding);
    cursor: pointer;
    font-weight: 600;
  }

  .pv-btn.secondary {
    background: var(--secondary);
    color: var(--on-secondary);
    border-color: var(--secondary);
  }

  .pv-accordion {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }

  .pv-accordion summary {
    cursor: pointer;
    padding: calc(var(--padding) / 1.5) var(--padding);
    font-weight: 600;
  }

  .pv-accordion p {
    padding: 0 var(--padding) var(--padding);
    color: var(--neutral);
  }

  .pv-table {
    width: 100%;
    border-collapse: collapse;
  }

  .pv-table th {
    text-align: left;
    background: var(--surface-2);
    color: var(--neutral);
    border-bottom: 1px solid var(--border);
    padding: calc(var(--padding) / 2) var(--padding);
  }

  .pv-table td {
    border-bottom: 1px solid var(--border);
    padding: calc(var(--padding) / 2) var(--padding);
  }

  .pv-form {
    display: flex;
    gap: var(--padding);
    flex-wrap: wrap;
    align-items: end;
  }

  .pv-form label {
    color: var(--neutral);
    font-size: var(--font-size-sm);
    text-transform: none;
    letter-spacing: normal;
    margin-bottom: 0;
  }

  .pv-form input[type='text'],
  .pv-form select {
    display: block;
    margin-top: 4px;
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: calc(var(--padding) / 2) calc(var(--padding) / 1.5);
    width: 11rem;
  }

  .pv-check {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }

  .pv-check input {
    accent-color: var(--primary);
  }
</style>
