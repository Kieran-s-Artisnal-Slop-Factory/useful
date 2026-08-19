<script lang="ts">
  /**
   * Two ways to make a square logo: seeded **generators** (DiceBear avatars or
   * Jdenticon identicons) and a **badge** (a Lucide icon or an emoji on a
   * coloured tile).
   *
   * Stateless, like the rest of Generators: the output is deterministic from a
   * few hundred bytes of settings, so nothing is written to the database. Each
   * engine is `import()`ed when its tab is first used, so a page nobody scrolls
   * costs nothing.
   *
   * Previews render through `svgDataUri` in an `<img>`, which never executes
   * script — the same rule the SVG editor follows.
   */
  import { onDestroy } from 'svelte';
  import Card from '../Card.svelte';
  import ColorField from '../ColorField.svelte';
  import Explainer from '../Explainer.svelte';
  import { copyPng, copyText, downloadBlob, downloadText } from '../../lib/exportFile';
  import { decodeToCanvas, encodeCanvas } from '../../lib/img/convert';
  import { href } from '../../lib/paths';
  import { put, putSingleton, withSyncFields } from '../../lib/db/repo';
  import type { Preferences, SvgDocument } from '../../lib/db/types';
  import { svgDataUri } from '../../lib/svg/build';
  import { newLayer } from '../../lib/svg/model';
  import {
    buildLogo,
    defaultLogo,
    LICENSE_NOTES,
    loadDicebear,
    loadLucide,
    LOGO_SIZE,
    styleLabel,
    STYLE_LICENSES,
    type LogoConfig,
  } from '../../lib/gen/logo';

  const TABS: { id: LogoConfig['mode']; label: string }[] = [
    { id: 'generator', label: 'Generators' },
    { id: 'badge', label: 'Badge' },
  ];
  const HUES = [0, 30, 60, 120, 180, 210, 270, 300];

  let config = $state<LogoConfig>(defaultLogo());
  /** The fallback seed, so an empty field still makes something. */
  let name = $state('useful');
  let svg = $state('');
  let error = $state<string | null>(null);
  let busy = $state(false);
  let feedback = $state<string | null>(null);
  let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
  let exportPx = $state(512);

  /** Style keys, once the DiceBear chunk has arrived. */
  let styles = $state<string[]>([]);
  /** Icon names, once the Lucide chunk has arrived. */
  let icons = $state<string[]>([]);
  let iconFilter = $state('');
  let destroyed = false;

  const filteredIcons = $derived(
    iconFilter.trim()
      ? icons.filter((n) => n.toLowerCase().includes(iconFilter.trim().toLowerCase())).slice(0, 120)
      : icons.slice(0, 120)
  );
  const license = $derived(STYLE_LICENSES[config.dicebear.style] ?? 'mit');
  const fileStem = $derived((name.trim() || 'logo').replace(/[^a-z0-9._-]+/gi, '-'));

  onDestroy(() => {
    destroyed = true;
    clearTimeout(feedbackTimer);
  });

  function flash(text: string) {
    feedback = text;
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => (feedback = null), 2000);
  }

  /** Rebuild the preview from whatever the config currently says. */
  async function regenerate() {
    busy = true;
    error = null;
    try {
      const next = await buildLogo(config, name.trim() || 'useful');
      if (destroyed) return;
      svg = next;
    } catch (err) {
      if (destroyed) return;
      svg = '';
      error = err instanceof Error ? err.message : 'Could not build that logo.';
    } finally {
      if (!destroyed) busy = false;
    }
  }

  /** Pull in the style list the first time the Generators tab is used. */
  async function ensureStyles() {
    if (styles.length > 0) return;
    try {
      const api = await loadDicebear();
      if (destroyed) return;
      styles = Object.keys(api.styles).sort();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Could not load the avatar styles.';
    }
  }

  /** Pull in the icon list the first time the Badge tab needs it. */
  async function ensureIcons() {
    if (icons.length > 0) return;
    try {
      const api = await loadLucide();
      if (destroyed) return;
      icons = api.names;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Could not load the icon set.';
    }
  }

  async function setMode(mode: LogoConfig['mode']) {
    config.mode = mode;
    if (mode === 'generator' && config.engine === 'dicebear') await ensureStyles();
    if (mode === 'badge' && config.badge.kind === 'icon') await ensureIcons();
    await regenerate();
  }

  async function setEngine(engine: LogoConfig['engine']) {
    config.engine = engine;
    if (engine === 'dicebear') await ensureStyles();
    await regenerate();
  }

  async function setBadgeKind(kind: 'icon' | 'emoji') {
    config.badge.kind = kind;
    if (kind === 'icon') await ensureIcons();
    await regenerate();
  }

  function toggleHue(hue: number) {
    const hues = config.jdenticon.hues;
    config.jdenticon.hues = hues.includes(hue) ? hues.filter((h) => h !== hue) : [...hues, hue];
    void regenerate();
  }

  // ---- output ---------------------------------------------------------------

  async function rasterize(): Promise<HTMLCanvasElement> {
    const file = new File([svg], `${fileStem}.svg`, { type: 'image/svg+xml' });
    return (await decodeToCanvas(file, exportPx)).canvas;
  }

  function downloadSvg() {
    downloadText(svg, `${fileStem}.svg`, 'image/svg+xml');
    flash('Downloaded SVG.');
  }

  async function copyMarkup() {
    flash((await copyText(svg)) ? 'Copied SVG markup.' : 'Clipboard blocked — use Download.');
  }

  async function downloadPng() {
    try {
      downloadBlob(await encodeCanvas(await rasterize(), 'png', 100), `${fileStem}.png`);
      flash('Downloaded PNG.');
    } catch (err) {
      error = err instanceof Error ? err.message : 'Could not make a PNG.';
    }
  }

  async function copyAsPng() {
    try {
      const blob = await encodeCanvas(await rasterize(), 'png', 100);
      flash((await copyPng(blob)) ? 'Copied PNG.' : 'Clipboard blocked — use Download.');
    } catch (err) {
      error = err instanceof Error ? err.message : 'Could not make a PNG.';
    }
  }

  /**
   * Hand the logo to the SVG editor as a document, so it can be taken apart.
   * This is what stands in for retoken's own (much weaker) SVG builder tab.
   */
  async function openInSvgEditor() {
    if (!svg) return;
    // Build the layer through the SVG editor's own factory, so the row is
    // exactly what that tool would have written itself.
    const layer = newLayer('svg', LOGO_SIZE, LOGO_SIZE);
    layer.x = 0;
    layer.y = 0;
    layer.width = LOGO_SIZE;
    layer.height = LOGO_SIZE;
    layer.fill = 'none';
    layer.stroke = 'none';
    layer.svg = svg;

    const doc = await put<SvgDocument>(
      'svg_documents',
      withSyncFields({
        name: fileStem,
        width: LOGO_SIZE,
        height: LOGO_SIZE,
        background: null,
        layers: [layer],
      })
    );
    // The editor resumes whatever `svg_last_doc_id` names, so pointing it at
    // the new document is all the handoff needs — no extra route or parameter.
    await putSingleton<Partial<Preferences>>('preferences', { svg_last_doc_id: doc.id });
    window.location.href = href('/tools/svg-editor/');
  }

  // First paint: the default tab is Generators, so warm its list and draw.
  void (async () => {
    await ensureStyles();
    await regenerate();
  })();
</script>

<div class="page-header">
  <h1>Logo generator</h1>
</div>

<div class="stack">
  <Card title="Logo">
    <div class="stack">
      <div class="row" role="group" aria-label="Mode">
        {#each TABS as tab (tab.id)}
          <button
            class="btn btn-sm"
            class:btn-primary={config.mode === tab.id}
            data-testid={'logo-tab-' + tab.id}
            aria-pressed={config.mode === tab.id}
            onclick={() => setMode(tab.id)}
          >
            {tab.label}
          </button>
        {/each}
        <span class="spacer"></span>
        <div>
          <label class="inline" for="logo-name">Name / seed</label>
          <input
            id="logo-name"
            data-testid="logo-name"
            bind:value={name}
            onchange={regenerate}
            placeholder="useful"
          />
        </div>
      </div>

      <div class="preview-row">
        <div class="preview checkerboard" style={config.mode === 'badge'?"padding: .15rem;":""}>
          {#if svg}
            <!-- An <img> never runs script, whatever the markup contains. -->
            <img src={svgDataUri(svg)} alt="Logo preview" width={LOGO_SIZE} height={LOGO_SIZE} />
          {:else}
            <p class="muted small">{busy ? 'Building…' : 'Nothing yet.'}</p>
          {/if}
        </div>
        <div class="stack tight">
          {#if error}
            <p class="form-error" data-testid="logo-error">{error}</p>
          {/if}
          <div class="row wrap">
            <button class="btn btn-sm" data-testid="logo-regenerate" onclick={regenerate} disabled={busy}>
              Regenerate
            </button>
          </div>
          <div class="row wrap">
            <label class="inline" for="logo-export-px">PNG size</label>
            <input
              id="logo-export-px"
              class="num"
              data-testid="logo-export-px"
              type="number"
              min="16"
              max="4096"
              bind:value={exportPx}
            />
            <span class="muted small">px</span>
          </div>
          <div class="row wrap">
            <button class="btn btn-sm" data-testid="logo-download-svg" onclick={downloadSvg} disabled={!svg}>
              Download SVG
            </button>
            <button class="btn btn-sm" data-testid="logo-download-png" onclick={downloadPng} disabled={!svg}>
              Download PNG
            </button>
          </div>
          <div class="row wrap">
            <button class="btn btn-sm" data-testid="logo-copy-svg" onclick={copyMarkup} disabled={!svg}>
              Copy markup
            </button>
            <button class="btn btn-sm" data-testid="logo-copy-png" onclick={copyAsPng} disabled={!svg}>
              Copy PNG
            </button>
          </div>
          <div class="row wrap">
            <button
              class="btn btn-sm"
              data-testid="logo-to-svg-editor"
              onclick={openInSvgEditor}
              disabled={!svg}
            >
              Open in SVG editor
            </button>
          </div>
          {#if feedback}
            <p class="muted small" data-testid="logo-feedback" aria-live="polite">{feedback}</p>
          {/if}
        </div>
      </div>
    </div>
  </Card>

  {#if config.mode === 'generator'}
    <Card title="Generator">
      <div class="stack">
        <div class="row" role="group" aria-label="Engine">
          <button
            class="btn btn-sm"
            class:btn-primary={config.engine === 'dicebear'}
            data-testid="logo-engine-dicebear"
            aria-pressed={config.engine === 'dicebear'}
            onclick={() => setEngine('dicebear')}>DiceBear avatars</button
          >
          <button
            class="btn btn-sm"
            class:btn-primary={config.engine === 'jdenticon'}
            data-testid="logo-engine-jdenticon"
            aria-pressed={config.engine === 'jdenticon'}
            onclick={() => setEngine('jdenticon')}>Jdenticon identicons</button
          >
        </div>

        {#if config.engine === 'dicebear'}
          <div class="row wrap">
            <div>
              <label class="inline" for="logo-seed">Seed</label>
              <input
                id="logo-seed"
                data-testid="logo-seed"
                bind:value={config.dicebear.seed}
                onchange={regenerate}
                placeholder={name || 'useful'}
              />
            </div>
            <p class="muted small self-end">The same seed always makes the same picture.</p>
          </div>
          <p class="muted small" data-testid="logo-license">{LICENSE_NOTES[license]}</p>
          {#if styles.length === 0}
            <p class="muted small">Loading styles…</p>
          {:else}
            <ul class="styles" data-testid="logo-styles">
              {#each styles as style (style)}
                <li>
                  <button
                    class="style"
                    class:picked={config.dicebear.style === style}
                    data-testid="logo-style"
                    data-style={style}
                    aria-pressed={config.dicebear.style === style}
                    onclick={() => {
                      config.dicebear.style = style;
                      void regenerate();
                    }}
                  >
                    <span class="style-name">{styleLabel(style)}</span>
                    {#if STYLE_LICENSES[style] !== 'mit'}
                      <span class="muted tag" title={LICENSE_NOTES[STYLE_LICENSES[style]!]}>©</span>
                    {/if}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        {:else}
          <div class="row wrap">
            <div>
              <label class="inline" for="logo-jd-value">Value</label>
              <input
                id="logo-jd-value"
                data-testid="logo-jd-value"
                bind:value={config.jdenticon.value}
                onchange={regenerate}
                placeholder={name || 'useful'}
              />
            </div>
            <div>
              <label class="inline" for="logo-jd-padding">Padding</label>
              <input
                id="logo-jd-padding"
                data-testid="logo-jd-padding"
                type="range"
                min="0"
                max="0.45"
                step="0.01"
                bind:value={config.jdenticon.padding}
                onchange={regenerate}
              />
            </div>
          </div>
          <fieldset class="hues">
            <legend class="eyebrow">Allowed hues</legend>
            {#each HUES as hue (hue)}
              <label class="check">
                <input
                  type="checkbox"
                  data-testid="logo-hue"
                  data-hue={hue}
                  checked={config.jdenticon.hues.includes(hue)}
                  onchange={() => toggleHue(hue)}
                />
                <span class="hue-dot" style={`background: hsl(${hue} 70% 50%)`}></span>
                {hue}°
              </label>
            {/each}
            <span class="muted small">None ticked means any hue.</span>
          </fieldset>
          <div class="row wrap">
            <div>
              <label class="inline" for="logo-jd-sat">Colour saturation</label>
              <input
                id="logo-jd-sat"
                data-testid="logo-jd-sat"
                type="range"
                min="0"
                max="1"
                step="0.05"
                bind:value={config.jdenticon.colorSaturation}
                onchange={regenerate}
              />
            </div>
            <label class="check">
              <input
                type="checkbox"
                data-testid="logo-jd-transparent"
                bind:checked={config.jdenticon.transparentBack}
                onchange={regenerate}
              />
              Transparent background
            </label>
            {#if !config.jdenticon.transparentBack}
              <ColorField
                testid="logo-jd-back"
                bind:value={config.jdenticon.backColor}
                ariaLabel="Background colour"
                oncommit={regenerate}
              />
            {/if}
          </div>
        {/if}
      </div>
    </Card>
  {:else}
    <Card title="Badge">
      <div class="stack">
        <div class="row wrap">
          <div class="row" role="group" aria-label="Badge contents">
            <button
              class="btn btn-sm"
              class:btn-primary={config.badge.kind === 'icon'}
              data-testid="logo-badge-icon"
              aria-pressed={config.badge.kind === 'icon'}
              onclick={() => setBadgeKind('icon')}>Icon</button
            >
            <button
              class="btn btn-sm"
              class:btn-primary={config.badge.kind === 'emoji'}
              data-testid="logo-badge-emoji"
              aria-pressed={config.badge.kind === 'emoji'}
              onclick={() => setBadgeKind('emoji')}>Emoji</button
            >
          </div>
          <div>
            <label class="inline" for="logo-badge-radius">Corner radius</label>
            <input
              id="logo-badge-radius"
              data-testid="logo-badge-radius"
              type="range"
              min="0"
              max="128"
              bind:value={config.badge.radius}
              onchange={regenerate}
            />
          </div>
        </div>

        <div class="row wrap">
          <div class="field">
            <span class="label-text" id="logo-bg-label">Tile colour</span>
            <ColorField
              testid="logo-badge-bg"
              bind:value={config.badge.background}
              ariaLabel="Tile colour"
              oncommit={regenerate}
            />
          </div>
          {#if config.badge.kind === 'icon'}
            <div class="field">
              <span class="label-text">Icon colour</span>
              <ColorField
                testid="logo-badge-fg"
                bind:value={config.badge.color}
                ariaLabel="Icon colour"
                oncommit={regenerate}
              />
            </div>
          {/if}
        </div>

        {#if config.badge.kind === 'emoji'}
          <div class="row wrap">
            <label class="inline" for="logo-emoji">Emoji</label>
            <input
              id="logo-emoji"
              class="emoji"
              data-testid="logo-emoji"
              bind:value={config.badge.emoji}
              onchange={regenerate}
            />
            <span class="muted small">Any character your system can draw.</span>
          </div>
        {:else}
          <div class="row wrap">
            <label class="inline" for="logo-icon-filter">Find an icon</label>
            <input
              id="logo-icon-filter"
              data-testid="logo-icon-filter"
              bind:value={iconFilter}
              placeholder="rocket"
            />
            <span class="muted small" data-testid="logo-icon-count">
              {icons.length ? `${icons.length} icons` : 'Loading icons…'}
            </span>
          </div>
          {#if icons.length > 0}
            <ul class="icons" data-testid="logo-icons">
              {#each filteredIcons as icon (icon)}
                <li>
                  <button
                    class="icon-pick"
                    class:picked={config.badge.icon === icon}
                    data-testid="logo-icon"
                    data-icon={icon}
                    aria-pressed={config.badge.icon === icon}
                    onclick={() => {
                      config.badge.icon = icon;
                      void regenerate();
                    }}
                  >
                    {icon}
                  </button>
                </li>
              {/each}
            </ul>
            {#if filteredIcons.length === 0}
              <p class="muted small">No icon matches that.</p>
            {/if}
          {/if}
        {/if}
      </div>
    </Card>
  {/if}

  <Explainer summary="Licences, and what you owe">
    <p>
      The generator code is MIT, but the <strong>drawings are not all</strong>. Of DiceBear's 31
      styles, 14 are MIT (use them anywhere), 13 have CC BY 4.0 artwork (credit the artist wherever
      the logo appears), and 4 — avataaars and bottts, in both variants — carry their own
      "free for personal and commercial use" terms, which are not an open-source licence. The style
      list marks every one that asks for something with ©, and the note under the seed says what
      the picked style expects.
    </p>
    <p>
      Jdenticon (MIT) and Lucide (ISC) ask for nothing. Lucide deliberately contains
      <strong>no brand logos</strong> — company marks are trademarks, and it will not ship them.
    </p>
  </Explainer>

  <Explainer summary="How these are made">
    <p>
      <strong>Avatars</strong> and <strong>identicons</strong> are seeded: the same text always
      produces the same picture, and a different text produces an unrelated one. That makes them
      useful as a stand-in avatar for a name or an email — and useless as anything secret, since
      anyone with the same seed gets the same result.
    </p>
    <p>
      A <strong>badge</strong> is composed here rather than generated: a rounded tile, plus either a
      Lucide icon scaled onto it or an emoji drawn by your own system. Emoji look different on every
      platform, so a badge built from one will not match everywhere — the SVG stores the character,
      not a picture of it. Export as PNG if you need it to look the same for everybody.
    </p>
    <p>
      Nothing here is stored. The settings live in the page until you leave, so download or copy
      what you make.
    </p>
  </Explainer>
</div>

<style>
  .spacer {
    flex: 1 1 auto;
  }

  .num {
    width: 5rem;
  }

  .emoji {
    width: 5rem;
    text-align: center;
    font-size: var(--font-size-lg);
  }

  .inline,
  .check {
    white-space: nowrap;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .label-text {
    font-size: var(--font-size-eyebrow);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted-color);
  }

  .preview-row {
    display: flex;
    gap: var(--space-4);
    flex-wrap: wrap;
    align-items: flex-start;
  }

  .preview {
    width: 256px;
    height: 256px;
    border: 1.5px solid var(--border-strong-color);
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
  }

  .preview img {
    max-width: 100%;
    height: auto;
  }

  .styles,
  .icons {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    max-height: 16rem;
    overflow-y: auto;
    border: 1px dashed var(--border-color);
    padding: var(--space-2);
  }

  .style,
  .icon-pick {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    border: 1.5px solid var(--border-strong-color);
    background: var(--surface-color);
    color: var(--text-color);
    cursor: pointer;
    padding: 0 var(--space-2);
    font-size: var(--font-size-sm);
  }

  .style.picked,
  .icon-pick.picked {
    background: var(--color-primary);
    color: var(--color-on-primary);
    border-color: var(--color-primary-strong);
  }

  .tag {
    font-size: var(--font-size-eyebrow);
  }

  .hues {
    border: 1px dashed var(--border-color);
    padding: var(--space-2);
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    align-items: center;
  }

  .hues legend {
    padding: 0 var(--space-1);
  }

  .hue-dot {
    width: 0.8rem;
    height: 0.8rem;
    border: 1px solid var(--border-strong-color);
    display: inline-block;
  }
</style>
