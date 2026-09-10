<script lang="ts">
  import { onMount } from 'svelte';
  import Card from '../Card.svelte';
  import Explainer from '../Explainer.svelte';
  import ThemePreview from '../ThemePreview.svelte';
  import { imageFromDrop, imageFromFiles, imageFromPaste, type IngestedImage } from '../../lib/img/ingest';
  import {
    MAX_COLORS,
    MIN_COLORS,
    clampCount,
    kmeans,
    samplePixels,
    suggestRoles,
    toPalette,
    toThemeInput,
    type Lab,
  } from '../../lib/img/palette';
  import { buildTheme, THEME_ROLES } from '../../lib/gen/theme';
  import { formatBytes } from '../../lib/img/convert';
  import { copyText, downloadText } from '../../lib/exportFile';
  import { href } from '../../lib/paths';

  /**
   * Stateless tool — pure view state, zero IndexedDB traffic. An image comes
   * in, a palette comes out, and everything leaves by clipboard or download.
   */
  let image = $state<IngestedImage | null>(null);
  let previewUrl = $state<string | null>(null);
  let error = $state<string | null>(null);
  let busy = $state(false);
  let count = $state(6);
  let copied = $state<string | null>(null);
  let dragging = $state(false);

  /** Role overrides, indexed like THEME_ROLES. '' means "let it derive". */
  let roleOverrides = $state<string[]>(['', '', '', '', '']);
  let roleTouched = $state(false);
  let paddingPx = $state(12);
  let radiusPx = $state(8);
  let scheme = $state<'auto' | 'light' | 'dark'>('auto');

  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  async function copy(key: string, value: string) {
    copied = (await copyText(value)) ? key : null;
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (copied = null), 1500);
  }

  /** A small data URL for showing the image back — never the full canvas,
   * which for a 50 MP photo would be tens of megabytes of base64. */
  function makePreview(canvas: HTMLCanvasElement): string {
    const maxSide = 480;
    const scale = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
    const w = Math.max(1, Math.round(canvas.width * scale));
    const h = Math.max(1, Math.round(canvas.height * scale));
    const small = document.createElement('canvas');
    small.width = w;
    small.height = h;
    small.getContext('2d')!.drawImage(canvas, 0, 0, w, h);
    return small.toDataURL('image/png');
  }

  async function accept(result: Awaited<ReturnType<typeof imageFromFiles>>) {
    busy = false;
    if (!result.ok) {
      error = result.message;
      return;
    }
    error = null;
    image = result.image;
    previewUrl = makePreview(result.image.canvas);
    // A new image gets a fresh suggestion; an explicit override is forgotten
    // with the image it was chosen for.
    roleOverrides = ['', '', '', '', ''];
    roleTouched = false;
  }

  async function onPick(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    busy = true;
    await accept(await imageFromFiles(input.files));
    // Let the same file be chosen twice in a row.
    input.value = '';
  }

  async function onDrop(event: DragEvent) {
    event.preventDefault();
    dragging = false;
    busy = true;
    await accept(await imageFromDrop(event));
  }

  onMount(() => {
    const onPaste = (event: ClipboardEvent) => {
      // Only claim the paste when it actually carries a file, so pasting text
      // into a field on this page still behaves normally.
      const items = Array.from(event.clipboardData?.items ?? []);
      if (!items.some((item) => item.kind === 'file')) return;
      event.preventDefault();
      busy = true;
      void imageFromPaste(event).then(accept);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  /* --------------------------------------------------------- the palette -- */

  // Split deliberately: resampling is the expensive half and does not depend
  // on the count, so nudging the number re-runs only the clustering.
  let points = $derived<Lab[]>(image ? samplePixels(image.canvas) : []);
  let palette = $derived(toPalette(kmeans(points, clampCount(count))));

  let suggested = $derived(suggestRoles(palette));
  let roles = $derived(
    THEME_ROLES.map((_, i) => (roleTouched ? roleOverrides[i] || null : suggested[i] ?? null))
  );
  let theme = $derived(buildTheme(toThemeInput(roles, paddingPx, radiusPx)));

  function setRole(index: number, value: string) {
    if (!roleTouched) {
      // First edit adopts the current suggestion, so changing one role does
      // not silently blank the other four.
      roleOverrides = suggested.map((hex) => hex ?? '');
      roleTouched = true;
    }
    roleOverrides[index] = value;
  }

  function resetRoles() {
    roleOverrides = ['', '', '', '', ''];
    roleTouched = false;
  }

  let listText = $derived(palette.map((entry) => entry.hex).join('\n'));
  let cssVarsText = $derived(
    ':root {\n' +
      palette.map((entry, i) => `  --color-${i + 1}: ${entry.hex};`).join('\n') +
      '\n}'
  );

  /** Carries the chosen colours into the Themes tool, which reads them from
   * the query string and seeds its own builder — harmonies and spacing live
   * over there rather than being grown a second time here. */
  let themesLink = $derived.by(() => {
    const params = new URLSearchParams();
    THEME_ROLES.forEach((role, i) => {
      const hex = roles[i];
      if (hex) params.set(role, hex.replace('#', ''));
    });
    const query = params.toString();
    return href('/tools/colors/') + (query ? `?${query}` : '');
  });

  const pct = (share: number): string => `${(share * 100).toFixed(1)}%`;
</script>

<div class="page-header">
  <h1>Color extractor</h1>
</div>

<div class="stack">
  <Card title="Image">
    <div class="stack">
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="drop"
        class:over={dragging}
        ondragover={(e) => {
          e.preventDefault();
          dragging = true;
        }}
        ondragleave={() => (dragging = false)}
        ondrop={onDrop}
        data-testid="cx-drop"
      >
        <label for="cx-file">Choose an image — or drop one here, or paste one anywhere on this page</label>
        <input
          id="cx-file"
          data-testid="cx-file"
          type="file"
          accept=".svg,.avif,.webp,.tif,.tiff,.png,.jpg,.jpeg,image/svg+xml,image/avif,image/webp,image/tiff,image/png,image/jpeg"
          onchange={onPick}
        />
      </div>

      {#if error}
        <p class="error" data-testid="cx-error" role="alert">{error}</p>
      {:else if busy}
        <p class="muted" aria-live="polite">Reading…</p>
      {/if}

      {#if image && previewUrl}
        <div class="shot">
          <img src={previewUrl} alt="The image the palette was taken from" data-testid="cx-preview-img" />
          <p class="muted small" data-testid="cx-image-info">
            {image.name} — {image.width} × {image.height}{image.bytes > 0 ? ` — ${formatBytes(image.bytes)}` : ''}
          </p>
        </div>
      {/if}
    </div>
  </Card>

  {#if image}
    <Card title="Palette">
      {#snippet actions()}
        <div class="row-actions">
          <label class="inline" for="cx-count">Colors</label>
          <input
            id="cx-count"
            data-testid="cx-count"
            class="num"
            type="number"
            min={MIN_COLORS}
            max={MAX_COLORS}
            step="1"
            bind:value={count}
          />
        </div>
      {/snippet}
      <div class="stack">
        {#if palette.length === 0}
          <p class="muted" data-testid="cx-empty">
            Nothing to read — every pixel in this image is transparent.
          </p>
        {:else}
          <div class="strip" data-testid="cx-strip">
            {#each palette as entry, i (entry.hex + i)}
              <button
                class="swatch"
                data-testid="cx-swatch"
                data-hex={entry.hex}
                style={`background: ${entry.hex}; color: ${entry.onColor}; flex-grow: ${Math.max(entry.share, 0.02)}`}
                title={`Copy ${entry.hex}`}
                aria-label={`Copy ${entry.hex}, ${pct(entry.share)} of the image`}
                onclick={() => copy(entry.hex, entry.hex)}
              >
                <span class="swatch-hex">{copied === entry.hex ? 'copied' : entry.hex}</span>
                <span class="swatch-share">{pct(entry.share)}</span>
              </button>
            {/each}
          </div>

          {#if palette.length < clampCount(count)}
            <p class="muted small" data-testid="cx-short">
              This image only has {palette.length} distinct colors to give, so that is what
              you get — the count is a request, not a promise.
            </p>
          {/if}

          <div class="table-wrap">
            <table class="data-table" data-testid="cx-table">
              <thead>
                <tr>
                  <th><span class="visually-hidden">Swatch</span></th>
                  <th>Share</th>
                  <th>hex</th>
                  <th>rgb</th>
                  <th>hsl</th>
                  <th>oklch</th>
                </tr>
              </thead>
              <tbody>
                {#each palette as entry, i (entry.hex + i)}
                  <tr>
                    <td><span class="chip" style={`background: ${entry.hex}`} aria-hidden="true"></span></td>
                    <td class="mono">{pct(entry.share)}</td>
                    {#each [['hex', entry.hex], ['rgb', entry.rgb], ['hsl', entry.hsl], ['oklch', entry.oklch]] as [key, value] (key)}
                      <td>
                        <button
                          class="btn btn-sm value"
                          data-testid={'cx-copy-' + key + '-' + i}
                          title={`Copy ${value}`}
                          onclick={() => copy(key + i, value)}
                        >
                          <span class="mono">{copied === key + i ? 'Copied' : value}</span>
                        </button>
                      </td>
                    {/each}
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>

          <div class="row">
            <button class="btn btn-sm" data-testid="cx-copy-list" onclick={() => copy('list', listText)}>
              {copied === 'list' ? 'Copied' : 'Copy all as a list'}
            </button>
            <button class="btn btn-sm" data-testid="cx-copy-vars" onclick={() => copy('vars', cssVarsText)}>
              {copied === 'vars' ? 'Copied' : 'Copy as CSS variables'}
            </button>
          </div>
        {/if}
      </div>
    </Card>

    {#if palette.length > 0}
      <Card title="Use as a theme">
        {#snippet actions()}
          <button class="btn btn-sm" data-testid="cx-roles-reset" onclick={resetRoles} disabled={!roleTouched}>
            Reset to suggestion
          </button>
        {/snippet}
        <div class="stack">
          <p class="muted small">
            The same five roles and the same output as
            <a href={href('/tools/colors/')}>Generators › Themes</a> — these are just
            pre-filled from the image. Anything left on <em>auto</em> is derived from
            the primary, so one colour is enough for a whole theme.
          </p>

          <div class="roles">
            {#each THEME_ROLES as role, i (role)}
              <div class="role">
                <label for={'cx-role-' + role}>{role}</label>
                <div class="role-pick">
                  <span class="chip" style={`background: ${theme.swatches[i]!.light}`} aria-hidden="true"></span>
                  <select
                    id={'cx-role-' + role}
                    data-testid={'cx-role-' + role}
                    value={roleTouched ? roleOverrides[i] : (suggested[i] ?? '')}
                    onchange={(e) => setRole(i, e.currentTarget.value)}
                  >
                    <option value="">auto (derived)</option>
                    {#each palette as entry, i (entry.hex + i)}
                      <option value={entry.hex}>{entry.hex}</option>
                    {/each}
                  </select>
                </div>
              </div>
            {/each}
          </div>

          {#if theme.warnings.length > 0}
            <div class="warnings" role="status">
              {#each theme.warnings as w (w.scheme + w.role)}
                <p class="warn" data-testid="cx-warning" data-role={w.role} data-scheme={w.scheme}>
                  ⚠ {w.role} is hard to see on the {w.scheme} background ({w.ratio}:1 —
                  aim for at least 3:1).
                </p>
              {/each}
            </div>
          {/if}

          <div class="row">
            <div>
              <label for="cx-padding">Padding (px)</label>
              <input id="cx-padding" data-testid="cx-padding" class="num" type="number" min="0" max="48" bind:value={paddingPx} />
            </div>
            <div>
              <label for="cx-radius">Border radius (px)</label>
              <input id="cx-radius" data-testid="cx-radius" class="num" type="number" min="0" max="48" bind:value={radiusPx} />
            </div>
            <fieldset class="scheme">
              <legend class="eyebrow">Preview scheme</legend>
              {#each ['auto', 'light', 'dark'] as s (s)}
                <label class="check">
                  <input type="radio" name="cx-scheme" value={s} data-testid={'cx-scheme-' + s} bind:group={scheme} />
                  {s}
                </label>
              {/each}
            </fieldset>
          </div>

          <ThemePreview vars={theme.vars} {scheme} testid="cx-preview" />

          <pre class="mono css" data-testid="cx-css">{theme.css}</pre>

          <div class="row">
            <button class="btn btn-primary" data-testid="cx-copy-theme" onclick={() => copy('theme', theme.css)}>
              {copied === 'theme' ? 'Copied' : 'Copy CSS'}
            </button>
            <button
              class="btn btn-sm"
              data-testid="cx-download-theme"
              onclick={() => downloadText(theme.css, 'theme.css', 'text/css')}
            >
              Download theme.css
            </button>
            <a class="btn btn-sm" data-testid="cx-open-themes" href={themesLink}>Open in Themes</a>
          </div>
        </div>
      </Card>
    {/if}
  {/if}

  <Explainer summary="How the colors are chosen" testid="explainer-color-extractor">
    <p>
      The image is scaled down to 192 pixels on its long edge — a palette is about
      what colours are THERE, not how many pixels each covers, and reading 37 000
      of them answers that as well as reading forty million would. Fully
      transparent pixels are skipped rather than counted as black.
    </p>
    <p>
      Those pixels are then clustered with k-means in <strong>OKLab</strong>, a
      colour space built so that equal distances look like equal differences. That
      choice is the whole trick: cluster in OKLab and a gradient sky collapses into
      one blue while a small saturated logo mark survives as its own entry. Cluster
      in RGB, or split by axis the way the classic median-cut algorithm does, and
      you get three barely-different blues instead.
    </p>
    <p>
      The seed is fixed, so the same image and the same count always give the same
      palette — nudge the number up and back down and you land exactly where you
      started. Ask for more colours than the image contains and you get what it has:
      empty clusters are dropped rather than padded out with black.
    </p>
  </Explainer>
</div>

<style>
  .drop {
    border: 2px dashed var(--border-strong-color);
    border-radius: var(--radius-sm);
    padding: var(--space-4);
    transition: background-color 120ms ease;
  }

  .drop.over {
    background: var(--color-primary-soft);
    border-color: var(--color-primary);
  }

  .shot img {
    max-width: 100%;
    max-height: 20rem;
    border: 1.5px solid var(--border-strong-color);
    display: block;
  }

  .shot p {
    margin-top: var(--space-2);
  }

  .row-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .inline {
    margin-bottom: 0;
  }

  .num {
    width: 5rem;
  }

  /* One bar, split in proportion to how much of the image each colour covers. */
  .strip {
    display: flex;
    min-height: 5.5rem;
    border: 1.5px solid var(--border-strong-color);
    overflow: hidden;
  }

  .swatch {
    flex: 1 1 0;
    min-width: 3.5rem;
    border: none;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    gap: 2px;
    padding: var(--space-2);
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: var(--font-size-eyebrow);
  }

  .swatch + .swatch {
    border-left: 1px solid color-mix(in srgb, #000 20%, transparent);
  }

  .swatch-share {
    opacity: 0.75;
  }

  .chip {
    display: inline-block;
    width: 2rem;
    height: 1.4rem;
    border: 1.5px solid var(--border-strong-color);
    vertical-align: middle;
  }

  .value {
    font-size: var(--font-size-sm);
    white-space: nowrap;
  }

  .mono {
    font-family: var(--font-mono, ui-monospace, monospace);
  }

  .roles {
    display: grid;
    gap: var(--space-3);
    grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
  }

  .role label {
    text-transform: capitalize;
  }

  .role-pick {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }

  .role-pick select {
    flex: 1 1 auto;
    min-width: 0;
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

  .warnings {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .warn {
    color: var(--color-warning);
    font-size: var(--font-size-sm);
  }

  .error {
    color: var(--color-danger);
    font-size: var(--font-size-sm);
  }

  .small {
    font-size: var(--font-size-sm);
  }

  .css {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
</style>
