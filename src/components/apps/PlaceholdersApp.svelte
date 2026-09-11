<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import Card from '../Card.svelte';
  import ColorField from '../ColorField.svelte';
  import Explainer from '../Explainer.svelte';
  import { copyText, downloadBlob, downloadText } from '../../lib/exportFile';
  import { svgDataUri } from '../../lib/svg/build';
  import { decodeToCanvas, encodeCanvas, TARGETS, type TargetFormat } from '../../lib/img/convert';
  import { zipBlob } from '../../lib/zip';
  import { loadLucide } from '../../lib/gen/logo';
  import { mulberry32, pick, seedFrom } from '../../lib/random';
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
    DEFAULT_PALETTE,
    GENERATORS,
    MAX_PALETTE,
    MAX_SHUFFLE_POOL,
    MAX_SIDE,
    MIN_SIDE,
    batchName,
    buildBatch,
    buildImage,
    randomSizes,
    type BatchVariation,
    type GeneratorId,
    type ImageOptions,
  } from '../../lib/placeholder/images';
  import { SCENES, SCENE_GROUPS, type Scene, type SceneId } from '../../lib/placeholder/scenes';
  import THUMBNAILS from '../../lib/placeholder/thumbnails.json';
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

  /** Which generators actually paint with the Ink colour, and which vary with
   * the seed. Both lists exist so a control is only shown where it does
   * something — an inert picker is worse than a missing one. */
  const USES_INK: GeneratorId[] = ['heading', 'noise', 'flow', 'icon'];
  const USES_SEED: GeneratorId[] = ['noise', 'flow', 'material', 'planes', 'mosaic', 'swirl'];
  const USES_PALETTE: GeneratorId[] = ['mosaic', 'swirl'];

  // ---- text ------------------------------------------------------------
  let textOptions = $state<TextOptions>({ ...DEFAULT_TEXT_OPTIONS });
  let filler = $derived(generateText(textOptions));
  let fillerCounts = $derived(countText(filler));

  // ---- images ----------------------------------------------------------
  // Copies of the nested defaults: `$state` writes through to the object it
  // was given, and the palette editor edits in place.
  let image = $state<ImageOptions>({
    ...DEFAULT_IMAGE_OPTIONS,
    gradient: { ...DEFAULT_GRADIENT },
    palette: [...DEFAULT_PALETTE],
  });

  /** Add the next default colour not already in the palette, up to four. */
  function addPaletteColour() {
    if (image.palette.length >= MAX_PALETTE) return;
    const next = DEFAULT_PALETTE.find((c) => !image.palette.includes(c)) ?? '#888888';
    image.palette = [...image.palette, next];
  }

  function removePaletteColour(i: number) {
    if (image.palette.length <= 1) return;
    image.palette = image.palette.filter((_, index) => index !== i);
  }

  /**
   * The swirl's two colours, named rather than numbered (feedback round 1).
   * Kept apart from the mosaic's up-to-four palette so switching generators
   * never loses colours three and four; `options` below hands the swirl these
   * two as its palette, which is what `swirlLayer` always read — the default
   * pair is the default palette's first two, so an existing seed draws the
   * same swirl it did.
   */
  let swirl = $state({ color: DEFAULT_PALETTE[0]!, background: DEFAULT_PALETTE[1]! });

  /** What is actually drawn: the page's settings with the palette the chosen
   * generator edits. Everything that builds an image reads this, not `image`. */
  let options = $derived<ImageOptions>(
    image.generator === 'swirl' ? { ...image, palette: [swirl.color, swirl.background] } : image
  );
  let lockRatio = $state(true);
  let batchCount = $state(3);
  let exportFormat = $state<TargetFormat | 'svg'>('svg');
  let iconName = $state('Mountain');
  let iconQuery = $state('');
  let iconNames = $state<string[]>([]);
  let iconError = $state<string | null>(null);

  let svg = $derived(buildImage(options));
  let previewUri = $derived(svgDataUri(svg));

  /**
   * One small example per generator, rendered once by
   * tools/build-placeholder-thumbs.mjs from the generators' defaults and
   * committed as data. They do not follow the controls — a first version
   * redrew all of them on every change and the page felt slow for pictures whose
   * only job is to say what a flow field looks like; the big preview is the
   * live one.
   */
  const thumbnails = THUMBNAILS as Record<GeneratorId, string>;

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

  // ---- batch variation ------------------------------------------------
  /**
   * "Vary across the batch": each rule is a checkbox plus its parameter, kept
   * as page state so a parameter survives the rule being toggled off and on.
   * `batchVariation()` folds it into the library's `BatchVariation`. Rules
   * for a generator that is not selected are hidden AND passed anyway — they
   * touch fields that generator never reads, so a stale tick is harmless.
   */
  let vary = $state({
    sizes: false,
    sizesRandom: false,
    sizesRatio: 'keep' as 'keep' | 'change',
    background: false,
    ink: false,
    angleOffset: false,
    angleOffsetValue: 15,
    stop1: false,
    stop2: false,
    cycleKind: false,
    grainDelta: false,
    grainDeltaValue: 0.01,
    blurDelta: false,
    blurDeltaValue: 1,
    randomSeed: false,
    lineDelta: false,
    lineDeltaValue: 50,
    opacityDelta: false,
    opacityDeltaValue: 0.1,
    sizeDelta: false,
    sizeDeltaValue: 0.15,
    randomIcon: false,
    scenes: false,
    blockSizeDelta: false,
    blockSizeDeltaValue: 2,
    cutRatioDelta: false,
    cutRatioDeltaValue: 0.1,
    palette: false,
    paletteValue: 'shuffle' as 'shuffle' | 'random',
  });
  /** One row per batch item; `sizeRows[0]` is the first image. A row with
   * `on` off keeps the base size whatever its cells say. */
  let sizeRows = $state<{ width: number; height: number; on: boolean }[]>([]);
  let allowedScenes = $state<SceneId[]>(SCENES.map((s) => s.id));

  /**
   * The shuffle pool (feedback round 2): the colours the `shuffle` palette
   * rule deals from, up to `MAX_SHUFFLE_POOL`. Its own state rather than a
   * view of the generator's palette, because the point is to be BIGGER than
   * what one image can hold — a mosaic takes four of it, a swirl two. It is
   * filled from the generator's current colours the first time the rule is
   * set to shuffled (and whenever it is empty), then it is the user's: it
   * survives the rule being toggled and the generator being switched.
   */
  let shufflePool = $state<string[]>([]);
  $effect(() => {
    if (!vary.palette || vary.paletteValue !== 'shuffle') return;
    const own = options.palette;
    untrack(() => {
      if (shufflePool.length === 0) shufflePool = own.slice(0, MAX_SHUFFLE_POOL);
    });
  });

  /** Add the next default colour not already in the pool, then a grey. */
  function addPoolColour() {
    if (shufflePool.length >= MAX_SHUFFLE_POOL) return;
    const next = DEFAULT_PALETTE.find((c) => !shufflePool.includes(c)) ?? '#888888';
    shufflePool = [...shufflePool, next];
  }

  function removePoolColour(i: number) {
    if (shufflePool.length <= 1) return;
    shufflePool = shufflePool.filter((_, index) => index !== i);
  }

  const clampCount = (n: number): number => (Number.isFinite(n) ? Math.min(50, Math.max(1, Math.trunc(n))) : 1);

  // The sizes table follows the batch count: a new row starts at the current
  // size, a dropped row is forgotten. Existing rows are left alone — someone
  // who typed six sizes and then bumped the count to seven keeps the six.
  $effect(() => {
    const n = clampCount(batchCount);
    untrack(() => {
      if (sizeRows.length === n) return;
      sizeRows = Array.from(
        { length: n },
        (_, i) => sizeRows[i] ?? { width: image.width, height: image.height, on: true }
      );
    });
  });

  /**
   * "Randomize sizes": the table is filled from `randomSizes` with an rng
   * off the batch seed, and refilled whenever what it was rolled from moves —
   * the seed, the count, the base size the ratio is kept from, or the ratio
   * choice itself. The numbers land in the table and stay editable; the
   * batch only ever reads the table, so randomizing IS filling it. Include
   * ticks are kept across a refill.
   */
  $effect(() => {
    if (!vary.sizesRandom) return;
    const n = clampCount(batchCount);
    const keepRatio = vary.sizesRatio === 'keep';
    const rng = mulberry32(seedFrom(`${image.seed}:sizes`));
    const rolled = randomSizes({ width: image.width, height: image.height }, n, keepRatio, rng);
    untrack(() => {
      sizeRows = rolled.map((size, i) => ({ ...size, on: sizeRows[i]?.on ?? true }));
    });
  });

  function setAllSizes(on: boolean) {
    sizeRows = sizeRows.map((row) => ({ ...row, on }));
  }

  const groupIds = (group: Scene['group']): SceneId[] => SCENES.filter((s) => s.group === group).map((s) => s.id);
  const groupOn = (group: Scene['group']): boolean => groupIds(group).every((id) => allowedScenes.includes(id));

  function setGroup(group: Scene['group'], on: boolean) {
    const ids = groupIds(group);
    allowedScenes = on ? [...new Set([...allowedScenes, ...ids])] : allowedScenes.filter((id) => !ids.includes(id));
  }

  function setScene(id: SceneId, on: boolean) {
    allowedScenes = on ? [...new Set([...allowedScenes, id])] : allowedScenes.filter((x) => x !== id);
  }

  function batchVariation(randomIcon: string[] | null): BatchVariation {
    return {
      sizes: vary.sizes
        ? sizeRows.map((row) =>
            row.on ? { width: row.width, height: row.height } : { width: image.width, height: image.height }
          )
        : null,
      background: vary.background,
      ink: vary.ink,
      angleOffset: vary.angleOffset ? vary.angleOffsetValue : null,
      stop1: vary.stop1,
      stop2: vary.stop2,
      cycleKind: vary.cycleKind,
      grainDelta: vary.grainDelta ? vary.grainDeltaValue : null,
      blurDelta: vary.blurDelta ? vary.blurDeltaValue : null,
      randomSeed: vary.randomSeed,
      lineDelta: vary.lineDelta ? vary.lineDeltaValue : null,
      opacityDelta: vary.opacityDelta ? vary.opacityDeltaValue : null,
      sizeDelta: vary.sizeDelta ? vary.sizeDeltaValue : null,
      randomIcon,
      scenes: vary.scenes ? [...allowedScenes] : null,
      blockSizeDelta: vary.blockSizeDelta ? vary.blockSizeDeltaValue : null,
      cutRatioDelta: vary.cutRatioDelta ? vary.cutRatioDeltaValue : null,
      palette: vary.palette ? vary.paletteValue : 'off',
      shufflePool: [...shufflePool],
    };
  }

  /**
   * Random icons for a batch: names picked from the fetched Lucide list with
   * a seeded rng (so the same seed picks the same icons), resolved to markup
   * here — `buildBatch` never fetches. Null when the rule is off or the list
   * has not arrived.
   */
  async function batchIcons(n: number): Promise<string[] | null> {
    if (image.generator !== 'icon' || !vary.randomIcon || iconNames.length === 0) return null;
    const api = await loadLucide();
    const rng = mulberry32(seedFrom(`${image.seed}:icons`));
    return Array.from({ length: n }, () => api.svg(pick(rng, iconNames)!) ?? image.iconSvg ?? '');
  }

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

  async function rasterize(markup: string, target: TargetFormat, width = image.width): Promise<Blob> {
    const file = new File([markup], 'placeholder.svg', { type: 'image/svg+xml' });
    const decoded = await decodeToCanvas(file, width);
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
    const n = clampCount(batchCount);
    const items = buildBatch(options, n, batchVariation(await batchIcons(n)));
    try {
      const entries = [];
      for (const [index, item] of items.entries()) {
        if (exportFormat === 'svg') {
          entries.push({ name: item.name, data: new TextEncoder().encode(item.svg) });
        } else {
          // Each item at its own size — a varied batch has no single width.
          const blob = await rasterize(item.svg, exportFormat, item.options.width);
          entries.push({
            name: batchName(item.options, index + 1, items.length, exportFormat),
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
          <option value="image">Images — eleven generators, seeded</option>
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
                style="flex-basis:1%;"
                value={generator.id as GeneratorId}
                aria-label={`${generator.label} — ${generator.note}`}
                bind:group={image.generator}
              />
              <img
                class="thumb"
                src={thumbnails[generator.id]}
                alt=""
                width="160"
                height="90"
                data-testid={`ph-gen-thumb-${generator.id}`}
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
            <input id="ph-bg" data-testid="ph-bg" type="color" style="height:3rem;" bind:value={image.background} />
          </div>
          <!-- Only where it paints something. The geometry generators draw
               from their own palette and the scenes carry their own colours,
               so an Ink picker there is a control that does nothing. -->
          {#if USES_INK.includes(image.generator)}
            <div>
              <label for="ph-fg">Ink</label>
              <input id="ph-fg" data-testid="ph-fg" type="color" bind:value={image.foreground} />
            </div>
          {/if}
          {#if USES_SEED.includes(image.generator)}
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

        {#if image.generator === 'flow'}
          <div class="row">
            <div>
              <label for="ph-density">Lines ({image.density})</label>
              <input
                id="ph-density"
                data-testid="ph-density"
                type="range"
                min="10"
                max="400"
                step="10"
                bind:value={image.density}
              />
            </div>
            <p class="muted small">Past a few hundred the lines stop reading as lines, and the file stops being small.</p>
          </div>
        {/if}

        {#if image.generator === 'material' || image.generator === 'planes'}
          <div class="row">
            <div>
              <label for="ph-opacity">Shape opacity ({Math.round(image.opacity * 100)}%)</label>
              <input
                id="ph-opacity"
                data-testid="ph-opacity"
                type="range"
                min="0.05"
                max="1"
                step="0.05"
                bind:value={image.opacity}
              />
            </div>
            <p class="muted small">
              The centre of the range, not a flat value — shapes all at one opacity stop looking
              layered.
            </p>
          </div>
        {/if}

        {#if image.generator === 'icon'}
          <div class="row">
            <div>
              <label for="ph-icon-scale">Icon size ({Math.round(image.iconScale * 100)}% of the shorter side)</label>
              <input
                id="ph-icon-scale"
                data-testid="ph-icon-scale"
                type="range"
                min="0.1"
                max="0.95"
                step="0.05"
                bind:value={image.iconScale}
              />
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

        {#if image.generator === 'swirl'}
          <!-- Two named colours rather than a numbered palette: a swirl has
               an arm and a ground, and "Colour 1 / Colour 2" made people
               guess which was which. -->
          <div class="row">
            <div class="palette-entry">
              <label for="ph-swirl-color">Swirl colour</label>
              <ColorField id="ph-swirl-color" testid="ph-swirl-color" bind:value={swirl.color} />
            </div>
            <div class="palette-entry">
              <label for="ph-swirl-background">Background colour</label>
              <ColorField id="ph-swirl-background" testid="ph-swirl-background" bind:value={swirl.background} />
            </div>
          </div>
        {/if}

        {#if image.generator === 'mosaic'}
          <div class="stack">
            <p class="muted small">Palette — up to four colours.</p>
            <div class="row">
              {#each image.palette as _, i (i)}
                <div class="palette-entry">
                  <label for={`ph-palette-${i}`}>Colour {i + 1}</label>
                  <div class="row">
                    <ColorField id={`ph-palette-${i}`} testid={`ph-palette-${i}`} bind:value={image.palette[i]} />
                    <button
                      class="btn"
                      type="button"
                      data-testid={`ph-palette-remove-${i}`}
                      aria-label={`Remove colour ${i + 1}`}
                      disabled={image.palette.length <= 1}
                      onclick={() => removePaletteColour(i)}
                    >
                      ×
                    </button>
                  </div>
                </div>
              {/each}
              <!-- Gone, not greyed, at four: a button that can do nothing
                   is a question, not a control (feedback round 2). -->
              {#if image.palette.length < MAX_PALETTE}
                <button class="btn" type="button" data-testid="ph-palette-add" onclick={addPaletteColour}>
                  Add a colour
                </button>
              {/if}
            </div>
          </div>
        {/if}

        {#if image.generator === 'mosaic'}
          <div class="row">
            <div>
              <label for="ph-block-size">Block size ({image.blockSize}% of the shorter side)</label>
              <input
                id="ph-block-size"
                data-testid="ph-block-size"
                type="range"
                min="2"
                max="25"
                step="1"
                bind:value={image.blockSize}
              />
            </div>
            <div>
              <label for="ph-cut-ratio">Cut out ({Math.round(image.cutRatio * 100)}% of the blocks)</label>
              <input
                id="ph-cut-ratio"
                data-testid="ph-cut-ratio"
                type="range"
                min="0"
                max="1"
                step="0.05"
                bind:value={image.cutRatio}
              />
            </div>
            <p class="muted small">Cut-out blocks show the background, and the cuts gather into patches rather than scattering.</p>
          </div>
        {/if}

        {#if image.generator === 'swirl'}
          <div class="row">
            <div>
              <label for="ph-turns">Turns ({image.turns})</label>
              <input id="ph-turns" data-testid="ph-turns" type="range" min="1" max="8" step="1" bind:value={image.turns} />
            </div>
            <div>
              <label for="ph-arm-width">Arm width ({Math.round(image.armWidth * 100)}% of each turn)</label>
              <input
                id="ph-arm-width"
                data-testid="ph-arm-width"
                type="range"
                min="0.1"
                max="0.9"
                step="0.05"
                bind:value={image.armWidth}
              />
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

        <fieldset class="vary" data-testid="ph-vary-card">
          <legend>Vary across the batch</legend>
          <p class="muted small">
            Each rule that is on changes one thing from image to image; everything else stays as set
            above. A varied batch is still seeded — the same seed gives the same batch again.
          </p>
          <div class="stack">
            <label class="check">
              <input type="checkbox" data-testid="ph-vary-sizes" bind:checked={vary.sizes} />
              Sizes — one per image
            </label>
            {#if vary.sizes}
              <div class="rule">
                <label class="check">
                  <input type="checkbox" data-testid="ph-vary-sizes-random" bind:checked={vary.sizesRandom} />
                  Randomize sizes
                </label>
                {#if vary.sizesRandom}
                  <select
                    aria-label="Randomized sizes and the aspect ratio"
                    data-testid="ph-vary-sizes-ratio"
                    bind:value={vary.sizesRatio}
                  >
                    <option value="keep">Keep the aspect ratio</option>
                    <option value="change">Change it too</option>
                  </select>
                  <span class="muted small">seeded, long side 200–2000; the numbers stay editable</span>
                {/if}
              </div>
              <div class="rule">
                <span class="muted small">Include</span>
                <button class="link" type="button" data-testid="ph-vary-sizes-all" onclick={() => setAllSizes(true)}>
                  all
                </button>
                <span class="muted small">/</span>
                <button class="link" type="button" data-testid="ph-vary-sizes-none" onclick={() => setAllSizes(false)}>
                  none
                </button>
                <span class="muted small">— an image left out keeps the size set above</span>
              </div>
              <table class="sizes" data-testid="ph-vary-sizes-value">
                <thead>
                  <tr>
                    <th scope="col"><span class="visually-hidden">Include</span></th>
                    <th scope="col">Image</th>
                    <th scope="col">Width</th>
                    <th scope="col">Height</th>
                  </tr>
                </thead>
                <tbody>
                  {#each sizeRows as row, i (i)}
                    <tr>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Include image ${i + 1}`}
                          data-testid={`ph-vary-size-${i}-on`}
                          bind:checked={row.on}
                        />
                      </td>
                      <th scope="row">{i + 1}</th>
                      <td>
                        <input
                          class="num"
                          type="number"
                          min={MIN_SIDE}
                          max={MAX_SIDE}
                          aria-label={`Image ${i + 1} width`}
                          data-testid={`ph-vary-size-${i}-w`}
                          disabled={!row.on}
                          bind:value={row.width}
                        />
                      </td>
                      <td>
                        <input
                          class="num"
                          type="number"
                          min={MIN_SIDE}
                          max={MAX_SIDE}
                          aria-label={`Image ${i + 1} height`}
                          data-testid={`ph-vary-size-${i}-h`}
                          disabled={!row.on}
                          bind:value={row.height}
                        />
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            {/if}

            <label class="check">
              <input type="checkbox" data-testid="ph-vary-background" bind:checked={vary.background} />
              Background — a random colour per image
            </label>

            {#if USES_INK.includes(image.generator)}
              <label class="check">
                <input type="checkbox" data-testid="ph-vary-ink" bind:checked={vary.ink} />
                Ink — a random colour per image
              </label>
            {/if}

            {#if USES_SEED.includes(image.generator)}
              <label class="check">
                <input type="checkbox" data-testid="ph-vary-randomSeed" bind:checked={vary.randomSeed} />
                Seed — twelve random characters per image
              </label>
            {/if}

            {#if image.generator === 'gradient'}
              <div class="rule">
                <label class="check">
                  <input type="checkbox" data-testid="ph-vary-angleOffset" bind:checked={vary.angleOffset} />
                  Angle offset
                </label>
                <label class="muted small" for="ph-vary-angle-offset">degrees per image, wrapping at 360</label>
                <input
                  id="ph-vary-angle-offset"
                  class="num"
                  type="number"
                  step="1"
                  data-testid="ph-vary-angleOffset-value"
                  disabled={!vary.angleOffset}
                  bind:value={vary.angleOffsetValue}
                />
              </div>
              <label class="check">
                <input type="checkbox" data-testid="ph-vary-stop1" bind:checked={vary.stop1} />
                Stop 1 — random, never the same as stop 2
              </label>
              <label class="check">
                <input type="checkbox" data-testid="ph-vary-stop2" bind:checked={vary.stop2} />
                Stop 2 — random, never the same as stop 1
              </label>
              <label class="check">
                <input type="checkbox" data-testid="ph-vary-cycleKind" bind:checked={vary.cycleKind} />
                Kind — linear, radial, linear…
              </label>
              <p class="muted small">
                SVG has no conic gradient, so the cycle has two kinds rather than three.
              </p>
            {/if}

            {#if image.generator === 'noise'}
              <div class="rule">
                <label class="check">
                  <input type="checkbox" data-testid="ph-vary-grainDelta" bind:checked={vary.grainDelta} />
                  Grain delta
                </label>
                <label class="muted small" for="ph-vary-grain-delta">per image, kept within 0.002–0.08</label>
                <input
                  id="ph-vary-grain-delta"
                  class="num"
                  type="number"
                  step="0.002"
                  data-testid="ph-vary-grainDelta-value"
                  disabled={!vary.grainDelta}
                  bind:value={vary.grainDeltaValue}
                />
              </div>
              <div class="rule">
                <label class="check">
                  <input type="checkbox" data-testid="ph-vary-blurDelta" bind:checked={vary.blurDelta} />
                  Blur delta
                </label>
                <label class="muted small" for="ph-vary-blur-delta">per image, kept within 0–8</label>
                <input
                  id="ph-vary-blur-delta"
                  class="num"
                  type="number"
                  step="0.5"
                  data-testid="ph-vary-blurDelta-value"
                  disabled={!vary.blurDelta}
                  bind:value={vary.blurDeltaValue}
                />
              </div>
            {/if}

            {#if image.generator === 'flow'}
              <div class="rule">
                <label class="check">
                  <input type="checkbox" data-testid="ph-vary-lineDelta" bind:checked={vary.lineDelta} />
                  Line delta
                </label>
                <label class="muted small" for="ph-vary-line-delta">lines per image; past 400 it wraps back round</label>
                <input
                  id="ph-vary-line-delta"
                  class="num"
                  type="number"
                  step="10"
                  data-testid="ph-vary-lineDelta-value"
                  disabled={!vary.lineDelta}
                  bind:value={vary.lineDeltaValue}
                />
              </div>
            {/if}

            {#if image.generator === 'material' || image.generator === 'planes'}
              <div class="rule">
                <label class="check">
                  <input type="checkbox" data-testid="ph-vary-opacityDelta" bind:checked={vary.opacityDelta} />
                  Opacity delta
                </label>
                <label class="muted small" for="ph-vary-opacity-delta">per image, kept within 5–100%</label>
                <input
                  id="ph-vary-opacity-delta"
                  class="num"
                  type="number"
                  step="0.05"
                  data-testid="ph-vary-opacityDelta-value"
                  disabled={!vary.opacityDelta}
                  bind:value={vary.opacityDeltaValue}
                />
              </div>
            {/if}

            {#if image.generator === 'icon'}
              <div class="rule">
                <label class="check">
                  <input type="checkbox" data-testid="ph-vary-sizeDelta" bind:checked={vary.sizeDelta} />
                  Size delta
                </label>
                <label class="muted small" for="ph-vary-size-delta">of the shorter side per image; past 95% it wraps back round</label>
                <input
                  id="ph-vary-size-delta"
                  class="num"
                  type="number"
                  step="0.05"
                  data-testid="ph-vary-sizeDelta-value"
                  disabled={!vary.sizeDelta}
                  bind:value={vary.sizeDeltaValue}
                />
              </div>
              <label class="check">
                <input
                  type="checkbox"
                  data-testid="ph-vary-randomIcon"
                  disabled={iconNames.length === 0}
                  bind:checked={vary.randomIcon}
                />
                Icon — a random one per image{iconNames.length === 0 ? ' (once the icon set has loaded)' : ''}
              </label>
            {/if}

            {#if image.generator === 'scene'}
              <label class="check">
                <input type="checkbox" data-testid="ph-vary-scenes" bind:checked={vary.scenes} />
                Scene — a random one per image, from these
              </label>
              {#if vary.scenes}
                <div class="stack" data-testid="ph-vary-scenes-value">
                  {#each SCENE_GROUPS as group (group)}
                    <div>
                      <label class="check">
                        <input
                          type="checkbox"
                          data-testid={`ph-vary-scenes-group-${group}`}
                          checked={groupOn(group)}
                          onchange={(e) => setGroup(group, e.currentTarget.checked)}
                        />
                        <strong>Any {group.toLowerCase()}</strong>
                      </label>
                      <div class="chips">
                        {#each SCENES.filter((s) => s.group === group) as scene (scene.id)}
                          <label class="check">
                            <input
                              type="checkbox"
                              data-testid={`ph-vary-scene-${scene.id}`}
                              checked={allowedScenes.includes(scene.id)}
                              onchange={(e) => setScene(scene.id, e.currentTarget.checked)}
                            />
                            {scene.label}
                          </label>
                        {/each}
                      </div>
                    </div>
                  {/each}
                  {#if allowedScenes.length === 0}
                    <p class="warn small">Nothing is allowed, so every image will be the scene chosen above.</p>
                  {/if}
                </div>
              {/if}
            {/if}

            {#if image.generator === 'mosaic'}
              <div class="rule">
                <label class="check">
                  <input type="checkbox" data-testid="ph-vary-block-size" bind:checked={vary.blockSizeDelta} />
                  Block size delta
                </label>
                <label class="muted small" for="ph-vary-block-size-value">percent per image, kept within 2–25</label>
                <input
                  id="ph-vary-block-size-value"
                  class="num"
                  type="number"
                  step="1"
                  data-testid="ph-vary-block-size-value"
                  disabled={!vary.blockSizeDelta}
                  bind:value={vary.blockSizeDeltaValue}
                />
              </div>
              <div class="rule">
                <label class="check">
                  <input type="checkbox" data-testid="ph-vary-cut-ratio" bind:checked={vary.cutRatioDelta} />
                  Cut-out delta
                </label>
                <label class="muted small" for="ph-vary-cut-ratio-value">of the blocks per image, kept within 0–1</label>
                <input
                  id="ph-vary-cut-ratio-value"
                  class="num"
                  type="number"
                  step="0.05"
                  data-testid="ph-vary-cut-ratio-value"
                  disabled={!vary.cutRatioDelta}
                  bind:value={vary.cutRatioDeltaValue}
                />
              </div>
            {/if}

            {#if USES_PALETTE.includes(image.generator)}
              <div class="rule">
                <label class="check">
                  <input type="checkbox" data-testid="ph-vary-palette" bind:checked={vary.palette} />
                  Palette
                </label>
                <select
                  aria-label="How the palette varies"
                  data-testid="ph-vary-palette-value"
                  disabled={!vary.palette}
                  bind:value={vary.paletteValue}
                >
                  <option value="shuffle">shuffled — each image deals its colours from a pool</option>
                  <option value="random">random — new colours per image, as many as above</option>
                </select>
              </div>
              {#if vary.palette && vary.paletteValue === 'shuffle'}
                <!-- The pool the rule deals from, right where the rule is.
                     Its own colours (feedback round 2): it starts as the
                     generator's, and can grow past what one image holds, so
                     shuffling has more to draw from than four (or two). -->
                <div class="stack" data-testid="ph-vary-palette-colours">
                  <p class="muted small">
                    {#if image.generator === 'swirl'}
                      Each image takes its swirl colour and its background colour from this pool, shuffled — up to
                      {MAX_SHUFFLE_POOL} colours.
                    {:else}
                      Each image takes its {options.palette.length === 1 ? 'colour' : `${options.palette.length} colours`}
                      from this pool, shuffled — up to {MAX_SHUFFLE_POOL} colours.
                    {/if}
                  </p>
                  <div class="row">
                    {#each shufflePool as _, i (i)}
                      <div class="palette-entry">
                        <label for={`ph-vary-palette-${i}`}>Pool colour {i + 1}</label>
                        <div class="row">
                          <ColorField
                            id={`ph-vary-palette-${i}`}
                            testid={`ph-vary-palette-${i}`}
                            bind:value={shufflePool[i]}
                          />
                          <button
                            class="btn"
                            type="button"
                            data-testid={`ph-vary-palette-remove-${i}`}
                            aria-label={`Remove pool colour ${i + 1}`}
                            disabled={shufflePool.length <= 1}
                            onclick={() => removePoolColour(i)}
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    {/each}
                    {#if shufflePool.length < MAX_SHUFFLE_POOL}
                      <button class="btn" type="button" data-testid="ph-vary-palette-add" onclick={addPoolColour}>
                        Add a colour
                      </button>
                    {/if}
                  </div>
                </div>
              {/if}
            {/if}
          </div>
        </fieldset>

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
      item, so image 3 of a batch is what that seed produces on its own. The
      batch rules are seeded too: the same seed gives the same set of
      variations.
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

  .vary {
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    padding: var(--space-3);
    margin: 0;
    min-width: 0;
  }

  .vary legend {
    font-weight: 600;
    padding: 0 var(--space-2);
  }

  .vary > p {
    margin-top: 0;
  }

  .rule {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .rule label {
    margin-bottom: 0;
  }

  .palette-entry {
    flex: 0 1 14rem;
  }

  .palette-entry .row {
    flex-wrap: nowrap;
    align-items: stretch;
  }

  .link {
    border: 0;
    background: none;
    padding: 0;
    color: var(--color-primary);
    text-decoration: underline;
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-sm);
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }

  .sizes {
    border-collapse: collapse;
  }

  .sizes th,
  .sizes td {
    padding: 2px var(--space-2);
    text-align: left;
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

  /* The example picture: a fixed 16:9 box so the grid rows line up. */
  .pick .thumb {
    flex: none;
    width: 5rem;
    height: auto;
    aspect-ratio: 16 / 9;
    border: 1px solid var(--border-strong-color);
    background: var(--surface-color);
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
