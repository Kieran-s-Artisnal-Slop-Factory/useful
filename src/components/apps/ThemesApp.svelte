<script lang="ts">
  import { onMount } from 'svelte';
  import Card from '../Card.svelte';
  import ColorField from '../ColorField.svelte';
  import Explainer from '../Explainer.svelte';
  import ThemePreview from '../ThemePreview.svelte';
  import { allFormats, parseCssColor } from '../../lib/gen/color';
  import { harmonies } from '../../lib/gen/harmony';
  import { buildTheme, THEME_ROLES } from '../../lib/gen/theme';
  import { copyText } from '../../lib/exportFile';

  // Stateless tool — pure view state, zero IndexedDB traffic.
  let input = $state('#803900');
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

  // Primary defaults to the color explored above; every other slot (light AND
  // dark, per role) derives until the user overrides it.
  let themeColors = $state<{ light: string; dark: string }[]>([
    { light: '#803900', dark: '' },
    { light: '', dark: '' },
    { light: '', dark: '' },
    { light: '', dark: '' },
    { light: '', dark: '' },
  ]);
  let paddingPx = $state(12);
  let radiusPx = $state(8);
  let scheme = $state<'auto' | 'light' | 'dark'>('auto');

  let theme = $derived(
    buildTheme({
      colors: themeColors.map((c) => ({
        light: c.light.trim().length > 0 ? c.light : null,
        dark: c.dark.trim().length > 0 ? c.dark : null,
      })),
      paddingPx,
      radiusPx,
    })
  );

  function useAsPrimary() {
    if (formats) themeColors[0]!.light = formats.hex.slice(0, 7);
  }

  /**
   * Seed the builder from the query string — how the colour extractor hands a
   * palette over (`?primary=803900&accent=…`). Reading a URL writes nothing
   * and touches no storage; an unparseable or absent value is simply ignored,
   * so a mangled link degrades to the normal defaults rather than an error.
   */
  onMount(() => {
    const params = new URLSearchParams(window.location.search);
    let seeded = false;
    THEME_ROLES.forEach((role, i) => {
      const raw = params.get(role);
      if (!raw) return;
      const candidate = /^[0-9a-f]{3,8}$/i.test(raw) ? `#${raw}` : raw;
      if (!parseCssColor(candidate)) return;
      themeColors[i]!.light = candidate;
      seeded = true;
    });
    // The explorer above should show what you arrived with, not the default.
    if (seeded && themeColors[0]!.light) input = themeColors[0]!.light;
  });
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
            placeholder="#ff7300 · rgb(30 58 95) · oklch(0.35 0.07 250) · rebeccapurple"
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
          <Card title={role}>
            <div class="stack role-body" data-testid={'th-role-' + role}>
            <p class="muted hint">{ROLE_HINTS[role]}</p>
            <div class="slot">
              <label class="slot-label" for={'th-color-' + role}>light</label>
              <ColorField
                id={'th-color-' + role}
                testid={'th-color-' + role}
                bind:value={themeColors[i]!.light}
                placeholder="auto"
                ariaLabel={role + ' light color'}
                fallback={theme.swatches[i]!.light}
              />
              {#if theme.swatches[i]!.derivedLight}
                <span class="eyebrow" data-testid={'th-derived-' + role}>auto</span>
              {/if}
            </div>
            <div class="slot">
              <label class="slot-label" for={'th-dark-' + role}>dark</label>
              <ColorField
                id={'th-dark-' + role}
                testid={'th-dark-' + role}
                bind:value={themeColors[i]!.dark}
                placeholder="auto"
                ariaLabel={role + ' dark color'}
                fallback={theme.swatches[i]!.dark}
              />
              {#if theme.swatches[i]!.derivedDark}
                <span class="eyebrow" data-testid={'th-derived-dark-' + role}>auto</span>
              {/if}
            </div>
            </div>
          </Card>
        {/each}
      </div>

      {#if theme.warnings.length > 0}
        <div class="warnings" role="status">
          {#each theme.warnings as w (w.scheme + w.role)}
            <p class="warn" data-testid="th-warning" data-role={w.role} data-scheme={w.scheme}>
              ⚠ {w.role} is hard to see on the {w.scheme} background ({w.ratio}:1 —
              aim for at least 3:1).
            </p>
          {/each}
        </div>
      {/if}

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

      <ThemePreview vars={theme.vars} {scheme} testid="th-preview" />

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
  /* One card per role, so the five roles read as separate objects. */
  .roles {
    display: grid;
    gap: var(--space-3);
    grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr));
  }

  .role-body {
    gap: var(--space-2);
  }

  .hint {
    font-size: var(--font-size-sm);
  }

  .slot {
    display: grid;
    grid-template-columns: 2.6rem 1fr auto;
    gap: var(--space-2);
    align-items: center;
  }

  .slot-label {
    margin-bottom: 0;
    font-size: var(--font-size-eyebrow);
  }

  .warnings {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
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

</style>
