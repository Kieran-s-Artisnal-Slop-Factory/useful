<script lang="ts">
  import { onDestroy } from 'svelte';
  import Card from '../Card.svelte';
  import Explainer from '../Explainer.svelte';
  import { copyText, downloadBlob, downloadText } from '../../lib/exportFile';
  import { href } from '../../lib/paths';
  import {
    DEFAULT_FIGLET_FONT,
    FIGLET_FONTS,
    FIGLET_STYLES,
    LAYOUTS,
    loadFont,
    renderFiglet,
    type Alignment,
    type LayoutId,
  } from '../../lib/ascii/fonts';
  import {
    asciiFromPixels,
    asciiText,
    DEFAULT_CELL_ASPECT,
    MAX_COLUMNS,
    MIN_COLUMNS,
    RAMPS,
    type AsciiArt,
  } from '../../lib/ascii/image';
  import { asciiHtml, asciiSvg } from '../../lib/ascii/render';
  import { decodeToCanvas, DecodeError, encodeCanvas, formatBytes } from '../../lib/img/convert';

  /**
   * ASCII art — a picture as characters, or words as a banner.
   *
   * Stateless by design: an image is decoded in the tab, converted, and
   * forgotten. Nothing here writes to IndexedDB, including the chosen font —
   * the spec asserts the database is byte-identical across a whole session.
   *
   * The two modes share one output pipeline. A figlet banner is an
   * {@link AsciiArt} with no colours, so copy, .txt, .svg and .png all work
   * the same way for both, and there is one renderer to get the character
   * grid right in.
   */

  let mode = $state<'picture' | 'text'>('text');

  // ---- text mode -------------------------------------------------------
  let text = $state('useful');
  let fontId = $state(DEFAULT_FIGLET_FONT);
  let layout = $state<LayoutId>('default');
  let alignment = $state<Alignment>('left');
  let bannerLines = $state<string[]>([]);
  let bannerError = $state<string | null>(null);
  let previews = $state<Record<string, string[]>>({});
  let previewErrors = $state<Record<string, string>>({});

  // ---- picture mode ----------------------------------------------------
  let file = $state<File | null>(null);
  let source = $state<{ pixels: ImageData; width: number; height: number } | null>(null);
  let decodeError = $state<string | null>(null);
  let decoding = $state(false);
  let columns = $state(80);
  let ramp = $state(RAMPS[0]!.id);
  let invert = $state(false);
  let colour = $state(false);
  let background = $state('#ffffff');
  let foreground = $state('#000000');

  let feedback = $state<string | null>(null);
  let feedbackTimer: ReturnType<typeof setTimeout> | undefined;

  function flash(message: string) {
    feedback = message;
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => (feedback = null), 2500);
  }

  onDestroy(() => clearTimeout(feedbackTimer));

  // ---- the banner ------------------------------------------------------
  $effect(() => {
    const request = { text, font: fontId, layout, alignment };
    let stale = false;
    void renderFiglet(request)
      .then((lines) => {
        if (stale) return;
        bannerLines = lines;
        bannerError = null;
      })
      .catch((err: unknown) => {
        if (stale) return;
        bannerLines = [];
        bannerError = err instanceof Error ? err.message : 'That font could not be rendered.';
      });
    return () => {
      stale = true;
    };
  });

  /**
   * Render one row of the picker, the first time that row is scrolled into
   * view. Fourteen fonts is 178 KB of `.flf`, and a picker that fetches all
   * of it to draw a list nobody has looked at yet is exactly the kind of
   * eager cost this app refuses everywhere else.
   */
  function preview(node: HTMLElement, id: string) {
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      observer.disconnect();
      void loadFont(id)
        .then(() => renderFiglet({ text: previewWord(), font: id, layout: 'default', alignment: 'left' }))
        .then((lines) => {
          shown.add(id);
          previews = { ...previews, [id]: lines };
        })
        .catch(() => (previewErrors = { ...previewErrors, [id]: 'could not be loaded' }));
    });
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  }

  /** Which fonts the picker has drawn. A plain Set on purpose: the retype
   * effect below writes `previews`, so reading the same state to decide what
   * to retype would make the effect re-run itself forever. */
  const shown = new Set<string>();

  /** Previews show the typed text, cut to something that fits a row. */
  function previewWord(): string {
    const first = text.split('\n')[0]?.trim() ?? '';
    return (first === '' ? 'useful' : first).slice(0, 10);
  }

  // Retype the previews when the text changes — the picker's whole job is
  // showing YOUR word in each font, not a fixed sample.
  $effect(() => {
    const word = previewWord();
    if (shown.size === 0) return;
    void Promise.all(
      [...shown].map(
        async (id) =>
          [id, await renderFiglet({ text: word, font: id, layout: 'default', alignment: 'left' })] as const
      )
    ).then((pairs) => (previews = Object.fromEntries(pairs)));
  });

  // ---- the picture -----------------------------------------------------
  async function onPick(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const picked = input.files?.[0] ?? null;
    input.value = '';
    if (!picked) return;
    file = picked;
    source = null;
    decodeError = null;
    decoding = true;
    try {
      const decoded = await decodeToCanvas(picked, 1024);
      const context = decoded.canvas.getContext('2d');
      if (!context) throw new DecodeError('This browser would not give us a canvas to read.');
      source = {
        pixels: context.getImageData(0, 0, decoded.canvas.width, decoded.canvas.height),
        width: decoded.width,
        height: decoded.height,
      };
    } catch (err) {
      source = null;
      decodeError = err instanceof DecodeError ? err.message : 'Decoding failed.';
    } finally {
      decoding = false;
    }
  }

  let picture = $derived.by<AsciiArt | null>(() => {
    if (!source) return null;
    return asciiFromPixels(
      { data: source.pixels.data, width: source.pixels.width, height: source.pixels.height },
      { columns, ramp, invert, colour, background }
    );
  });

  // ---- what the output cards share -------------------------------------
  let art = $derived.by<AsciiArt | null>(() => {
    if (mode === 'picture') return picture;
    if (bannerLines.length === 0) return null;
    return {
      columns: bannerLines[0]?.length ?? 0,
      rows: bannerLines.length,
      lines: bannerLines,
      colours: null,
    };
  });

  let plain = $derived(art ? asciiText(art) : '');
  let html = $derived(
    art
      ? asciiHtml(art, {
          fontSize: 12,
          cellAspect: DEFAULT_CELL_ASPECT,
          background: mode === 'picture' ? background : null,
          foreground: mode === 'picture' ? foreground : 'currentColor',
        })
      : ''
  );
  let markup = $derived(
    art
      ? asciiSvg(art, {
          fontSize: 12,
          cellAspect: DEFAULT_CELL_ASPECT,
          background: mode === 'picture' ? background : '#ffffff',
          foreground: mode === 'picture' ? foreground : '#000000',
        })
      : ''
  );

  const baseName = () =>
    mode === 'picture'
      ? (file?.name.replace(/\.[^.]+$/, '') ?? 'ascii') || 'ascii'
      : `${previewWord().replace(/[^\w-]+/g, '-') || 'banner'}`;

  async function copyOut(what: 'text' | 'svg' | 'html') {
    const payload = what === 'text' ? plain : what === 'svg' ? markup : html;
    if (!payload) return;
    flash((await copyText(payload)) ? 'Copied' : 'Copy failed — select the text and copy it by hand');
  }

  function downloadTxt() {
    if (plain) downloadText(plain, `${baseName()}.txt`);
  }

  function downloadSvg() {
    if (markup) downloadText(markup, `${baseName()}.svg`, 'image/svg+xml');
  }

  /**
   * PNG goes through the SVG and the shared image converter rather than a
   * canvas of its own: `decodeToCanvas` already rasterizes SVG safely (an
   * `<img>` runs no script), and reusing it means the PNG is exactly what the
   * downloaded SVG draws.
   */
  async function downloadPng() {
    if (!markup) return;
    try {
      const svgFile = new File([markup], 'ascii.svg', { type: 'image/svg+xml' });
      const width = Math.max(320, Math.min(4096, (art?.columns ?? 80) * 12));
      const decoded = await decodeToCanvas(svgFile, width);
      downloadBlob(await encodeCanvas(decoded.canvas, 'png', 100), `${baseName()}.png`);
      flash('Downloaded PNG');
    } catch {
      flash('That picture could not be rasterized — the SVG download always works');
    }
  }
</script>

<div class="page-header">
  <h1>ASCII art</h1>
</div>

<div class="stack">
  <Card title="What are we drawing?">
    <div class="row">
      <div>
        <label for="aa-mode">Make art from</label>
        <select id="aa-mode" data-testid="aa-mode" bind:value={mode}>
          <option value="text">Text — a banner in a FIGlet font</option>
          <option value="picture">A picture — an image as characters</option>
        </select>
      </div>
    </div>
  </Card>

  {#if mode === 'text'}
    <Card title="Text">
      <div class="stack">
        <div>
          <label for="aa-text">Words (one banner per line)</label>
          <textarea id="aa-text" data-testid="aa-text" rows="2" bind:value={text}></textarea>
        </div>
        <div class="row">
          <div>
            <label for="aa-layout">Spacing</label>
            <select id="aa-layout" data-testid="aa-layout" bind:value={layout}>
              {#each LAYOUTS as option (option.id)}
                <option value={option.id}>{option.label}</option>
              {/each}
            </select>
          </div>
          <div>
            <label for="aa-align">Alignment</label>
            <select id="aa-align" data-testid="aa-align" bind:value={alignment}>
              <option value="left">Left</option>
              <option value="center">Centre</option>
              <option value="right">Right</option>
            </select>
          </div>
        </div>
        {#if bannerError}
          <p class="error" role="alert" data-testid="aa-banner-error">{bannerError}</p>
        {/if}
      </div>
    </Card>

    <Card title="Font" testid="aa-font-card">
      <div class="stack">
        <p class="muted small">
          Fourteen fonts ship with the app, each one drawn here in your own words.
          <a href={href('/figlet/PROVENANCE.txt')} target="_blank" rel="noreferrer">Where they came from</a>
          — a font whose file does not state a licence is refused by the build.
        </p>
        <div class="fonts" data-testid="aa-fonts">
          {#each FIGLET_STYLES as style (style)}
            <h3 class="group">{style}</h3>
            {#each FIGLET_FONTS.filter((f) => f.style === style) as font (font.id)}
              <label class="font" class:on={font.id === fontId} data-testid={`aa-font-${font.id}`}>
                <!-- The radio names itself, because the label also holds the
                     preview: without this its accessible name would be the
                     whole banner read out character by character. -->
                <input
                  type="radio"
                  name="aa-font"
                  value={font.id}
                  aria-label={`${font.name} — ${font.note}`}
                  bind:group={fontId}
                />
                <span class="font-head">
                  <span class="font-name">{font.name}</span>
                  <span class="muted small">{font.note}</span>
                </span>
                <pre class="sample" aria-hidden="true" use:preview={font.id}>{previews[font.id]
                    ? previews[font.id]!.join('\n')
                    : (previewErrors[font.id] ?? '…')}</pre>
              </label>
            {/each}
          {/each}
        </div>
      </div>
    </Card>
  {:else}
    <Card title="Picture">
      <div class="stack">
        <div>
          <label for="aa-file">PNG, JPG, WebP, AVIF, SVG or TIFF</label>
          <input
            id="aa-file"
            data-testid="aa-file"
            type="file"
            accept=".svg,.avif,.webp,.tif,.tiff,.png,.jpg,.jpeg,image/svg+xml,image/avif,image/webp,image/tiff,image/png,image/jpeg"
            onchange={onPick}
          />
        </div>

        {#if decodeError}
          <p class="error" role="alert" data-testid="aa-error">{decodeError}</p>
        {:else if decoding}
          <p class="muted" aria-live="polite">Decoding…</p>
        {:else if file && source}
          <p class="muted small" data-testid="aa-input-info">
            {file.name} · {formatBytes(file.size)} · {source.width} × {source.height}px
          </p>
        {/if}

        <div class="row">
          <div>
            <label for="aa-columns">Width ({columns} characters)</label>
            <input
              id="aa-columns"
              data-testid="aa-columns"
              class="num"
              type="number"
              min={MIN_COLUMNS}
              max={MAX_COLUMNS}
              bind:value={columns}
            />
          </div>
          <div>
            <label for="aa-ramp">Characters</label>
            <select id="aa-ramp" data-testid="aa-ramp" bind:value={ramp}>
              {#each RAMPS as option (option.id)}
                <option value={option.id}>{option.label}</option>
              {/each}
            </select>
          </div>
          <div>
            <label for="aa-colour">Colour</label>
            <select id="aa-colour" data-testid="aa-colour" bind:value={colour}>
              <option value={false}>Plain text</option>
              <option value={true}>Per-character colour (HTML / SVG)</option>
            </select>
          </div>
        </div>

        <div class="row">
          <label class="check">
            <input type="checkbox" data-testid="aa-invert" bind:checked={invert} />
            Invert — for light text on a dark background
          </label>
          <div>
            <label for="aa-background">Background</label>
            <input id="aa-background" data-testid="aa-background" type="color" bind:value={background} />
          </div>
          <div>
            <label for="aa-foreground">Ink (plain mode)</label>
            <input id="aa-foreground" data-testid="aa-foreground" type="color" bind:value={foreground} />
          </div>
        </div>
      </div>
    </Card>
  {/if}

  {#if art && art.lines.length > 0}
    <Card title="Output" testid="aa-output-card">
      <div class="stack">
        <p class="muted small" data-testid="aa-size">
          {art.columns} × {art.rows} characters · {plain.length.toLocaleString()} characters of text
        </p>

        <!-- Generated by asciiHtml(), which escapes every character it writes
             and passes colours through a hex/keyword filter — there is no
             path from the file's bytes to markup. -->
        <div class="output" data-testid="aa-output">{@html html}</div>

        <div class="row">
          <button class="btn btn-primary" data-testid="aa-copy" onclick={() => copyOut('text')}>Copy text</button>
          <button class="btn" data-testid="aa-download-txt" onclick={downloadTxt}>Download .txt</button>
          <button class="btn" data-testid="aa-copy-html" onclick={() => copyOut('html')}>Copy HTML</button>
          <button class="btn" data-testid="aa-copy-svg" onclick={() => copyOut('svg')}>Copy SVG</button>
          <button class="btn" data-testid="aa-download-svg" onclick={downloadSvg}>Download .svg</button>
          <button class="btn" data-testid="aa-download-png" onclick={downloadPng}>Download .png</button>
        </div>
        <p class="muted small" aria-live="polite" data-testid="aa-feedback">{feedback ?? ''}</p>
      </div>
    </Card>
  {/if}

  <Explainer summary="Why does my picture come out squashed somewhere else?" testid="explainer-ascii">
    <p>
      A character cell is about twice as tall as it is wide, so this tool emits
      half as many rows as a square-pixel conversion would — that is what keeps
      the picture in proportion. Paste the result somewhere with a different
      line height (a chat window with roomy spacing, a slide, a font that is not
      monospace at all) and the proportions change with it. The SVG and PNG
      downloads carry the grid with them, so they look the same everywhere.
    </p>
    <p>
      The plain-text output is a rectangle: every line is padded to the same
      width. That matters for banners inside comment blocks and for anything
      that draws a box around your art.
    </p>
    <p>
      Text art comes from <code>figlet</code> and the fonts' own FIGfont files —
      including the smushing rules that decide how far letters overlap, which
      is why "Default" and "Smushed" can differ by a column per letter. Nothing
      you type is saved; reloading starts fresh.
    </p>
  </Explainer>
</div>

<style>
  .num {
    width: 6.5rem;
  }

  .small {
    font-size: var(--font-size-sm);
  }

  .error {
    color: var(--color-danger);
    font-size: var(--font-size-sm);
  }

  .check {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: 0;
  }

  .output {
    border: 1.5px solid var(--border-strong-color);
    border-radius: var(--radius-sm);
    padding: var(--space-3);
    overflow-x: auto;
    /* The picture is one long line per row; letting it wrap would turn the
       art into noise, so the box scrolls instead. */
    max-height: 32rem;
    overflow-y: auto;
  }

  .fonts {
    display: grid;
    gap: var(--space-3);
  }

  .group {
    font-size: var(--font-size-sm);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-muted-color);
    margin: var(--space-2) 0 0;
  }

  .font {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--space-2) var(--space-3);
    align-items: start;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    padding: var(--space-3);
    margin-bottom: 0;
    cursor: pointer;
  }

  .font.on {
    border-color: var(--color-primary);
    box-shadow: inset 0 0 0 1px var(--color-primary);
  }

  .font-head {
    display: flex;
    flex-direction: column;
  }

  .font-name {
    font-weight: 600;
  }

  .sample {
    grid-column: 1 / -1;
    overflow-x: auto;
    font-size: 0.7rem;
    line-height: 1.1;
    margin: 0;
    color: var(--text-muted-color);
  }
</style>
