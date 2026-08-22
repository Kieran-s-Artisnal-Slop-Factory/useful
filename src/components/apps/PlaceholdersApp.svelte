<script lang="ts">
  import { onDestroy } from 'svelte';
  import Card from '../Card.svelte';
  import Explainer from '../Explainer.svelte';
  import { copyText, downloadBlob, downloadText } from '../../lib/exportFile';
  import { svgDataUri } from '../../lib/svg/build';
  import { decodeToCanvas, encodeCanvas, TARGETS, type TargetFormat } from '../../lib/img/convert';
  import { zipBlob } from '../../lib/zip';
  import { loadLucide } from '../../lib/gen/logo';
  import { DEFAULT_GRADIENT } from '../../lib/gen/gradient';
  import {
    CORPUS_LABELS,
    DEFAULT_TEXT_OPTIONS,
    countText,
    generateText,
    type Corpus,
    type TextOptions,
    type TextUnit,
  } from '../../lib/placeholder/text';
  import {
    DEFAULT_IMAGE_OPTIONS,
    GENERATORS,
    MAX_SIDE,
    MIN_SIDE,
    batchName,
    buildBatch,
    buildImage,
    type GeneratorId,
    type ImageOptions,
  } from '../../lib/placeholder/images';
  import { SCENES, SCENE_GROUPS } from '../../lib/placeholder/scenes';
  import { RATIOS, SIZE_PRESETS, applyRatio, describeSize, matchRatio } from '../../lib/placeholder/size';

  /**
   * Placeholders — filler text and filler images, both seeded, both drawn
   * here.
   *
   * Stateless: nothing is written to IndexedDB, and the spec asserts it.
   * Nothing reaches the network either — the links card at the bottom is the
   * only thing on the page that leaves this machine, and it says so.
   */

  let mode = $state<'text' | 'image'>('text');

  // ---- text ------------------------------------------------------------
  let textOptions = $state<TextOptions>({ ...DEFAULT_TEXT_OPTIONS });
  let filler = $derived(generateText(textOptions));
  let fillerCounts = $derived(countText(filler));

  // ---- images ----------------------------------------------------------
  let image = $state<ImageOptions>({ ...DEFAULT_IMAGE_OPTIONS, gradient: { ...DEFAULT_GRADIENT } });
  let lockRatio = $state(true);
  let batchCount = $state(3);
  let exportFormat = $state<TargetFormat | 'svg'>('svg');
  let iconName = $state('Mountain');
  let iconQuery = $state('');
  let iconNames = $state<string[]>([]);
  let iconError = $state<string | null>(null);

  let svg = $derived(buildImage(image));
  let previewUri = $derived(svgDataUri(svg));

  let feedback = $state<string | null>(null);
  let feedbackTimer: ReturnType<typeof setTimeout> | undefined;

  function flash(message: string) {
    feedback = message;
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => (feedback = null), 3000);
  }

  onDestroy(() => clearTimeout(feedbackTimer));

  /**
   * Lucide arrives only when the icon generator is chosen — 2 MB of chunk for
   * a picker nobody opened is exactly the freight this app refuses. The logo
   * generator's loader is reused, so there is one copy in the bundle.
   */
  $effect(() => {
    if (image.generator !== 'icon' || iconNames.length > 0) return;
    void loadLucide()
      .then((api) => {
        iconNames = api.names;
        image.iconSvg = api.svg(iconName) ?? null;
      })
      .catch(() => (iconError = 'The icon set could not be loaded.'));
  });

  $effect(() => {
    const name = iconName;
    if (image.generator !== 'icon' || iconNames.length === 0) return;
    void loadLucide().then((api) => (image.iconSvg = api.svg(name) ?? null));
  });

  let shownIcons = $derived(
    iconQuery.trim() === ''
      ? iconNames.slice(0, 60)
      : iconNames.filter((n) => n.toLowerCase().includes(iconQuery.trim().toLowerCase())).slice(0, 60)
  );

  /**
   * Set one side, and follow the ratio with the other when the lock is on.
   *
   * The ratio is read from the size BEFORE the edit — the shape being kept is
   * the one on screen — and the side just typed in is the one left alone. A
   * lock that recomputes the field someone is holding fights the person using
   * it.
   */
  function setSide(side: 'width' | 'height', raw: number) {
    const value = Number.isFinite(raw) ? Math.min(MAX_SIDE, Math.max(MIN_SIDE, Math.round(raw))) : MIN_SIDE;
    const ratio = lockRatio ? matchRatio(image.width, image.height) : undefined;
    const next = { width: image.width, height: image.height, [side]: value } as {
      width: number;
      height: number;
    };
    const sized = ratio ? applyRatio(next.width, next.height, ratio, side) : next;
    image.width = sized.width;
    image.height = sized.height;
  }

  function applyPreset(width: number, height: number) {
    image.width = width;
    image.height = height;
  }

  function applyRatioPreset(id: string) {
    const ratio = RATIOS.find((r) => r.id === id);
    if (!ratio) return;
    const sized = applyRatio(image.width, image.height, ratio, 'width');
    image.width = sized.width;
    image.height = sized.height;
  }

  const fileBase = () => `${image.generator}-${image.width}x${image.height}`;

  async function rasterize(markup: string, target: TargetFormat): Promise<Blob> {
    const file = new File([markup], 'placeholder.svg', { type: 'image/svg+xml' });
    const decoded = await decodeToCanvas(file, image.width);
    return encodeCanvas(decoded.canvas, target, 92);
  }

  async function downloadOne() {
    try {
      if (exportFormat === 'svg') {
        downloadText(svg, `${fileBase()}.svg`, 'image/svg+xml');
      } else {
        downloadBlob(await rasterize(svg, exportFormat), `${fileBase()}.${exportFormat}`);
      }
      flash('Downloaded');
    } catch {
      flash('That image could not be rasterized — the SVG download always works');
    }
  }

  /**
   * A batch as one zip, through the app's own zip writer.
   *
   * Rasterizing happens one at a time rather than in parallel: fifty canvases
   * at once is how a tab runs out of memory, and the whole point of a batch
   * is that it finishes.
   */
  async function downloadBatch() {
    const items = buildBatch(image, batchCount);
    try {
      const entries = [];
      for (const [index, item] of items.entries()) {
        if (exportFormat === 'svg') {
          entries.push({ name: item.name, data: new TextEncoder().encode(item.svg) });
        } else {
          const blob = await rasterize(item.svg, exportFormat);
          entries.push({
            name: batchName(image, index + 1, items.length, exportFormat),
            data: new Uint8Array(await blob.arrayBuffer()),
          });
        }
      }
      downloadBlob(zipBlob(entries), `${fileBase()}-x${items.length}.zip`);
      flash(`${items.length} images zipped`);
    } catch {
      flash('The batch could not be built — try the SVG format');
    }
  }

  async function copyOut(what: string, label: string) {
    flash((await copyText(what)) ? `${label} copied` : 'Copy failed — select it and copy by hand');
  }
</script>

<div class="page-header">
  <h1>Placeholders</h1>
</div>

<div class="stack">
  <Card title="What do you need?">
    <div class="row">
      <div>
        <label for="ph-mode">Filler</label>
        <select id="ph-mode" data-testid="ph-mode" bind:value={mode}>
          <option value="text">Text — lorem ipsum or office speak</option>
          <option value="image">Images — eight generators, seeded</option>
        </select>
      </div>
    </div>
  </Card>

  {#if mode === 'text'}
    <Card title="Filler text">
      <div class="stack">
        <div class="row">
          <div>
            <label for="ph-corpus">Corpus</label>
            <select id="ph-corpus" data-testid="ph-corpus" bind:value={textOptions.corpus}>
              {#each Object.entries(CORPUS_LABELS) as [id, label] (id)}
                <option value={id as Corpus}>{label}</option>
              {/each}
            </select>
          </div>
          <div>
            <label for="ph-count">How many</label>
            <input
              id="ph-count"
              data-testid="ph-count"
              class="num"
              type="number"
              min="1"
              max="500"
              bind:value={textOptions.count}
            />
          </div>
          <div>
            <label for="ph-unit">Of</label>
            <select id="ph-unit" data-testid="ph-unit" bind:value={textOptions.unit}>
              <option value={'paragraphs' as TextUnit}>Paragraphs</option>
              <option value={'sentences' as TextUnit}>Sentences</option>
              <option value={'words' as TextUnit}>Words</option>
            </select>
          </div>
          <div>
            <label for="ph-text-seed">Seed</label>
            <input id="ph-text-seed" data-testid="ph-text-seed" class="num" bind:value={textOptions.seed} />
          </div>
        </div>

        <div class="row">
          {#if textOptions.corpus === 'lorem'}
            <!-- Only offered for the corpus it belongs to: "Lorem ipsum dolor
                 sit amet" bolted onto office speak is not a feature. -->
            <label class="check">
              <input type="checkbox" data-testid="ph-lorem-start" bind:checked={textOptions.startWithLorem} />
              Start with <em>Lorem ipsum dolor sit amet</em>
            </label>
          {/if}
          <label class="check">
            <input type="checkbox" data-testid="ph-html" bind:checked={textOptions.html} />
            Wrap paragraphs in &lt;p&gt;
          </label>
        </div>

        <pre class="out" data-testid="ph-text">{filler}</pre>
        <p class="muted small" data-testid="ph-text-counts">
          {fillerCounts.paragraphs} paragraphs · {fillerCounts.sentences} sentences · {fillerCounts.words} words
        </p>
        <div class="row">
          <button class="btn btn-primary" data-testid="ph-copy-text" onclick={() => copyOut(filler, 'The text')}>
            Copy
          </button>
          <button
            class="btn"
            data-testid="ph-download-text"
            onclick={() => downloadText(filler, textOptions.html ? 'placeholder.html' : 'placeholder.txt')}
          >
            Download
          </button>
        </div>
      </div>
    </Card>
  {:else}
    <Card title="Generator">
      <div class="stack">
        <div class="generators" data-testid="ph-generators">
          {#each GENERATORS as generator (generator.id)}
            <label class="pick" class:on={image.generator === generator.id} data-testid={`ph-gen-${generator.id}`}>
              <input
                type="radio"
                name="ph-generator"
                value={generator.id as GeneratorId}
                aria-label={`${generator.label} — ${generator.note}`}
                bind:group={image.generator}
              />
              <span>
                <strong>{generator.label}</strong>
                <span class="muted small">{generator.note}</span>
              </span>
            </label>
          {/each}
        </div>

        <div class="row">
          <div>
            <label for="ph-bg">Background</label>
            <input id="ph-bg" data-testid="ph-bg" type="color" bind:value={image.background} />
          </div>
          {#if image.generator !== 'solid' && image.generator !== 'gradient' && image.generator !== 'scene'}
            <div>
              <label for="ph-fg">Ink</label>
              <input id="ph-fg" data-testid="ph-fg" type="color" bind:value={image.foreground} />
            </div>
          {/if}
          {#if image.generator === 'noise' || image.generator === 'flow' || image.generator === 'material'}
            <div>
              <label for="ph-seed">Seed</label>
              <input id="ph-seed" data-testid="ph-seed" class="num" bind:value={image.seed} />
            </div>
          {/if}
        </div>

        {#if image.generator === 'noise'}
          <div class="row">
            <div>
              <label for="ph-frequency">Grain ({image.frequency})</label>
              <input
                id="ph-frequency"
                data-testid="ph-frequency"
                type="range"
                min="0.002"
                max="0.08"
                step="0.002"
                bind:value={image.frequency}
              />
            </div>
            <div>
              <label for="ph-blur">Blur ({image.blur})</label>
              <input id="ph-blur" data-testid="ph-blur" type="range" min="0" max="8" step="0.5" bind:value={image.blur} />
            </div>
          </div>
        {/if}

        {#if image.generator === 'heading'}
          <div class="row">
            <div class="grow">
              <label for="ph-heading">Heading</label>
              <input id="ph-heading" data-testid="ph-heading" bind:value={image.heading} />
            </div>
            <div class="grow">
              <label for="ph-subheading">Sub-heading</label>
              <input id="ph-subheading" data-testid="ph-subheading" bind:value={image.subheading} />
            </div>
          </div>
        {/if}

        {#if image.generator === 'gradient'}
          <div class="row">
            <div>
              <label for="ph-grad-kind">Kind</label>
              <select id="ph-grad-kind" data-testid="ph-grad-kind" bind:value={image.gradient.kind}>
                <option value="linear">Linear</option>
                <option value="radial">Radial</option>
              </select>
            </div>
            {#if image.gradient.kind === 'linear'}
              <div>
                <label for="ph-grad-angle">Angle ({image.gradient.angle}°)</label>
                <input
                  id="ph-grad-angle"
                  data-testid="ph-grad-angle"
                  type="range"
                  min="0"
                  max="360"
                  bind:value={image.gradient.angle}
                />
              </div>
            {/if}
            {#each image.gradient.stops as stop, i (i)}
              <div>
                <label for={`ph-grad-stop-${i}`}>Stop {i + 1}</label>
                <input id={`ph-grad-stop-${i}`} data-testid={`ph-grad-stop-${i}`} type="color" bind:value={stop.color} />
              </div>
            {/each}
          </div>
          <p class="muted small">
            SVG has linear and radial gradients and no conic one, so the conic option from the gradient
            tool is missing here rather than quietly drawn as something else.
          </p>
        {/if}

        {#if image.generator === 'icon'}
          <div class="stack">
            <div class="row">
              <div class="grow">
                <label for="ph-icon-search">Find an icon ({iconNames.length} available)</label>
                <input id="ph-icon-search" data-testid="ph-icon-search" bind:value={iconQuery} placeholder="mountain" />
              </div>
              <p class="muted small">Chosen: <code data-testid="ph-icon-name">{iconName}</code></p>
            </div>
            {#if iconError}
              <p class="warn small">{iconError}</p>
            {/if}
            <div class="icons" data-testid="ph-icons">
              {#each shownIcons as name (name)}
                <button
                  class="chip"
                  class:on={name === iconName}
                  data-testid={`ph-icon-${name}`}
                  onclick={() => (iconName = name)}
                >
                  {name}
                </button>
              {/each}
            </div>
          </div>
        {/if}

        {#if image.generator === 'scene'}
          <div class="stack">
            {#each SCENE_GROUPS as group (group)}
              <div>
                <p class="muted small">{group}</p>
                <div class="chips">
                  {#each SCENES.filter((s) => s.group === group) as scene (scene.id)}
                    <button
                      class="chip"
                      class:on={image.scene === scene.id}
                      data-testid={`ph-scene-${scene.id}`}
                      onclick={() => (image.scene = scene.id)}
                    >
                      {scene.label}
                    </button>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </Card>

    <Card title="Size">
      <div class="stack">
        <div class="row">
          <div>
            <label for="ph-width">Width</label>
            <input
              id="ph-width"
              data-testid="ph-width"
              class="num"
              type="number"
              min={MIN_SIDE}
              max={MAX_SIDE}
              value={image.width}
              onchange={(e) => setSide('width', Number((e.currentTarget as HTMLInputElement).value))}
            />
          </div>
          <div>
            <label for="ph-height">Height</label>
            <input
              id="ph-height"
              data-testid="ph-height"
              class="num"
              type="number"
              min={MIN_SIDE}
              max={MAX_SIDE}
              value={image.height}
              onchange={(e) => setSide('height', Number((e.currentTarget as HTMLInputElement).value))}
            />
          </div>
          <label class="check">
            <input type="checkbox" data-testid="ph-lock" bind:checked={lockRatio} />
            Keep the aspect ratio
          </label>
          <span class="muted small" data-testid="ph-size-note">{describeSize(image.width, image.height)}</span>
        </div>

        <div class="chips" data-testid="ph-ratios">
          {#each RATIOS as ratio (ratio.id)}
            <button
              class="chip"
              class:on={matchRatio(image.width, image.height)?.id === ratio.id}
              data-testid={`ph-ratio-${ratio.id}`}
              onclick={() => applyRatioPreset(ratio.id)}
            >
              {ratio.label}
            </button>
          {/each}
        </div>

        <div class="chips" data-testid="ph-sizes">
          {#each SIZE_PRESETS as preset (preset.label)}
            <button class="chip" onclick={() => applyPreset(preset.width, preset.height)}>{preset.label}</button>
          {/each}
        </div>
      </div>
    </Card>

    <Card title="The image" testid="ph-output-card">
      <div class="stack">
        <img class="preview" src={previewUri} alt="The generated placeholder" data-testid="ph-preview" />

        <div class="row">
          <div>
            <label for="ph-format">Download as</label>
            <select id="ph-format" data-testid="ph-format" bind:value={exportFormat}>
              <option value="svg">SVG (small at any size)</option>
              {#each TARGETS as target (target.id)}
                <option value={target.id}>{target.label}</option>
              {/each}
            </select>
          </div>
          <div>
            <label for="ph-batch">Batch of</label>
            <input id="ph-batch" data-testid="ph-batch" class="num" type="number" min="1" max="50" bind:value={batchCount} />
          </div>
        </div>

        <div class="row">
          <button class="btn btn-primary" data-testid="ph-download" onclick={downloadOne}>Download</button>
          <button class="btn" data-testid="ph-download-batch" onclick={downloadBatch}>Download the batch (.zip)</button>
          <button class="btn" data-testid="ph-copy-svg" onclick={() => copyOut(svg, 'The SVG')}>Copy the SVG</button>
        </div>
        <p class="muted small" aria-live="polite" data-testid="ph-feedback">{feedback ?? ''}</p>
      </div>
    </Card>

    <Card title="Real photos, elsewhere" collapsible open={false} testid="ph-links-card">
      <div class="stack">
        <p class="muted small">
          These are <strong>external sites</strong>. Everything else in this app works with no network;
          these links leave it.
        </p>
        <ul>
          <li><a href="https://unsplash.com/" target="_blank" rel="noreferrer noopener">Unsplash</a> — free photographs, generous licence.</li>
          <li><a href="https://www.pexels.com/" target="_blank" rel="noreferrer noopener">Pexels</a> — photographs and short video.</li>
          <li><a href="https://pixabay.com/" target="_blank" rel="noreferrer noopener">Pixabay</a> — photographs, vectors and illustrations.</li>
          <li><a href="https://placehold.co/" target="_blank" rel="noreferrer noopener">placehold.co</a> — placeholder images by URL, when you want a live one.</li>
        </ul>
        <p class="muted small">
          Read each site's licence before shipping someone else's photograph — "free to download" and
          "free to use in your product" are different sentences.
        </p>
      </div>
    </Card>
  {/if}

  <Explainer summary="Why SVG rather than PNG?" testid="explainer-placeholders">
    <p>
      A placeholder is mostly flat colour and geometry, and SVG stays a few
      kilobytes whatever size you ask for — a 4000-pixel-wide PNG of a grey
      rectangle is megabytes of nothing. The PNG and JPG downloads rasterize
      the same SVG through the image tools' own converter, so they are exactly
      what the preview shows.
    </p>
    <p>
      <strong>Everything here is seeded.</strong> The same seed and settings
      always draw the same picture, so a placeholder can be regenerated on
      another machine and match — and a batch is just the seed varied per
      item, so image 3 of a batch is what that seed produces on its own.
    </p>
    <p>
      The drawn scenes are hand-written SVG in this repository, not stock art.
      That is deliberate: provenance for something we drew is one sentence, and
      provenance for something scraped off the web is a research project.
    </p>
  </Explainer>
</div>

<style>
  .small {
    font-size: var(--font-size-sm);
  }

  .num {
    width: 7rem;
  }

  .grow {
    flex: 1 1 12rem;
  }

  .check {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: 0;
  }

  .warn {
    color: var(--color-danger);
  }

  .out {
    border: 1.5px solid var(--border-strong-color);
    border-radius: var(--radius-sm);
    padding: var(--space-3);
    max-height: 24rem;
    overflow: auto;
    white-space: pre-wrap;
    margin: 0;
  }

  .generators {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
    gap: var(--space-2);
  }

  .pick {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    padding: var(--space-2);
    margin-bottom: 0;
    cursor: pointer;
  }

  .pick.on {
    border-color: var(--color-primary);
    box-shadow: inset 0 0 0 1px var(--color-primary);
  }

  .pick span {
    display: flex;
    flex-direction: column;
  }

  .chips,
  .icons {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .icons {
    max-height: 12rem;
    overflow-y: auto;
  }

  .chip {
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--surface-color);
    color: inherit;
    padding: 2px var(--space-2);
    font-size: var(--font-size-sm);
    cursor: pointer;
  }

  .chip.on {
    border-color: var(--color-primary);
    box-shadow: inset 0 0 0 1px var(--color-primary);
  }

  .preview {
    max-width: 100%;
    max-height: 22rem;
    width: auto;
    height: auto;
    align-self: flex-start;
    object-fit: contain;
    border: 1.5px solid var(--border-strong-color);
    background: repeating-conic-gradient(var(--border-color) 0% 25%, transparent 0% 50%) 0 0 / 16px 16px;
  }
</style>
