<script lang="ts">
  import { onDestroy } from 'svelte';
  import Card from '../Card.svelte';
  import Explainer from '../Explainer.svelte';
  import { copyText, downloadBlob, downloadText } from '../../lib/exportFile';
  import { draggable, dropzone } from '../../lib/dragdrop';
  import { asciiSvg } from '../../lib/ascii/render';
  import { decodeToCanvas, encodeCanvas } from '../../lib/img/convert';
  import {
    countKinds,
    deserialize,
    insert,
    move,
    node,
    remove,
    rename,
    reorder,
    serialize,
    sortTree,
    TreeParseError,
    type TreeNode,
  } from '../../lib/tree/model';
  import { FORMAT_LABELS, parseListing, type ListingFormat, type ParseWarning } from '../../lib/tree/parse';
  import {
    CHARSETS,
    DEFAULT_EMOJI_RULES,
    DEFAULT_RENDER_OPTIONS,
    displayWidth,
    renderTree,
    summaryLine,
    type TreeRenderOptions,
  } from '../../lib/tree/render';

  /**
   * File tree — build one by hand or paste a listing, get it back as text or
   * as a picture.
   *
   * Stateless: a tree is typed in one sitting and exported as JSON if it is
   * worth keeping. Nothing here writes to IndexedDB, and the spec asserts it.
   *
   * The three ways in all end at the same model, and the model has exactly one
   * renderer — so an option added to the text output is in the SVG and the PNG
   * for free.
   */

  const STARTER = (): TreeNode =>
    node('project', 'folder', [
      node('src', 'folder', [node('index.ts'), node('lib', 'folder', [node('model.ts')])]),
      node('docs', 'folder', [node('readme.md')]),
      node('package.json'),
    ]);

  let tree = $state<TreeNode>(STARTER());
  let options = $state<TreeRenderOptions>({ ...DEFAULT_RENDER_OPTIONS });
  let selected = $state<string | null>(null);

  // ---- paste a listing -------------------------------------------------
  let listing = $state('');
  let chosenFormat = $state<'auto' | ListingFormat>('auto');
  let warnings = $state<ParseWarning[]>([]);
  let parseNote = $state<string | null>(null);

  // ---- the emoji rule table --------------------------------------------
  let ruleExt = $state('');
  let ruleEmoji = $state('');

  let feedback = $state<string | null>(null);
  let feedbackTimer: ReturnType<typeof setTimeout> | undefined;

  function flash(message: string) {
    feedback = message;
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => (feedback = null), 2500);
  }

  onDestroy(() => clearTimeout(feedbackTimer));

  // ---- the builder -----------------------------------------------------

  interface Row {
    node: TreeNode;
    depth: number;
    parentId: string | null;
  }

  /** The tree as a flat list of rows, which is what a list of controls wants
   * — the nesting is drawn with an indent rather than with nested markup, so
   * every row is a sibling in the DOM and the keyboard order is the reading
   * order. */
  let rows = $derived.by<Row[]>(() => {
    const out: Row[] = [];
    const walk = (n: TreeNode, depth: number, parentId: string | null) => {
      out.push({ node: n, depth, parentId });
      n.children.forEach((c) => walk(c, depth + 1, n.id));
    };
    walk(tree, 0, null);
    return out;
  });

  function addChild(parentId: string, kind: 'file' | 'folder') {
    const child = node(kind === 'folder' ? 'new-folder' : 'new-file.txt', kind);
    tree = insert(tree, parentId, child);
    selected = child.id;
  }

  function onDrop(dragId: string, intoId: string) {
    const next = move(tree, dragId, intoId);
    if (next === tree) {
      flash('That move would put a folder inside itself');
      return;
    }
    tree = next;
  }

  // ---- reading a listing ------------------------------------------------

  function parse() {
    const text = listing;
    if (text.trim() === '') {
      parseNote = 'Nothing to read — paste a listing first.';
      warnings = [];
      return;
    }
    const result = parseListing(text, chosenFormat === 'auto' ? undefined : chosenFormat);
    warnings = result.warnings;
    if (result.entries === 0) {
      parseNote = `Read as ${FORMAT_LABELS[result.format]}, but nothing in it looked like a path.`;
      return;
    }
    tree = result.root;
    selected = null;
    parseNote = `Read ${result.entries} ${result.entries === 1 ? 'entry' : 'entries'} as ${FORMAT_LABELS[result.format]}.`;
  }

  // ---- output ------------------------------------------------------------

  let lines = $derived(renderTree(tree, options));
  let text = $derived(lines.join('\n'));
  let counts = $derived(countKinds(tree));

  /** The SVG canvas is sized on the widest line MEASURED IN CELLS, not in
   * UTF-16 units: one emoji is two cells and several code points, and getting
   * that wrong clips every line that has one. */
  let markup = $derived(
    asciiSvg(
      {
        columns: Math.max(1, ...lines.map(displayWidth)) + 1,
        rows: lines.length,
        lines,
        colours: null,
      },
      { fontSize: 13, background: '#ffffff', foreground: '#111111', fitRows: false }
    )
  );

  async function copyOut(what: 'text' | 'svg' | 'json') {
    const payload = what === 'text' ? text : what === 'svg' ? markup : serialize(tree);
    flash((await copyText(payload)) ? 'Copied' : 'Copy failed — select the text and copy it by hand');
  }

  function downloadTxt() {
    downloadText(text, `${fileBase()}.txt`);
  }

  function downloadSvg() {
    downloadText(markup, `${fileBase()}.svg`, 'image/svg+xml');
  }

  function downloadJson() {
    downloadText(serialize(tree), `${fileBase()}.json`, 'application/json');
  }

  async function downloadPng() {
    try {
      const svgFile = new File([markup], 'tree.svg', { type: 'image/svg+xml' });
      const width = Math.max(320, Math.min(4096, Math.max(1, ...lines.map(displayWidth)) * 9));
      const decoded = await decodeToCanvas(svgFile, width);
      downloadBlob(await encodeCanvas(decoded.canvas, 'png', 100), `${fileBase()}.png`);
      flash('Downloaded PNG');
    } catch {
      flash('That tree could not be rasterized — the SVG download always works');
    }
  }

  const fileBase = () => tree.name.replace(/[^\w.-]+/g, '-') || 'tree';

  async function importJson(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      tree = deserialize(await file.text());
      selected = null;
      flash(`Loaded ${file.name}`);
    } catch (err) {
      flash(err instanceof TreeParseError ? err.message : 'That file could not be read.');
    }
  }

  function addRule() {
    const ext = ruleExt.trim().replace(/^\./, '').toLowerCase();
    const glyph = ruleEmoji.trim();
    if (ext === '' || glyph === '') return;
    options.emojiRules = { ...options.emojiRules, [ext]: glyph };
    ruleExt = '';
    ruleEmoji = '';
  }

  function dropRule(ext: string) {
    const { [ext]: _gone, ...rest } = options.emojiRules;
    options.emojiRules = rest;
  }
</script>

<div class="page-header">
  <h1>File tree</h1>
</div>

<div class="stack">
  <Card title="The tree" testid="ft-tree-card">
    {#snippet actions()}
      <button class="btn btn-sm" data-testid="ft-add-folder" onclick={() => addChild(selected ?? tree.id, 'folder')}>
        + Folder
      </button>
      <button class="btn btn-sm" data-testid="ft-add-file" onclick={() => addChild(selected ?? tree.id, 'file')}>
        + File
      </button>
      <button class="btn btn-sm" data-testid="ft-sort" onclick={() => (tree = sortTree(tree))}>Sort</button>
      <button class="btn btn-sm" data-testid="ft-reset" onclick={() => { tree = STARTER(); selected = null; }}>
        Reset
      </button>
      <!-- Empty, not the example: "clear" that hands back three folders you
           did not ask for is not clear. The root survives, because a tree
           with no root is not a tree — rename it and start typing. -->
      <button
        class="btn btn-sm btn-danger"
        data-testid="ft-clear"
        onclick={() => { tree = node(tree.name, 'folder'); selected = null; }}
      >
        Clear
      </button>
    {/snippet}

    <div class="stack">
      <p class="muted small">
        Click a row to select it — new files and folders go inside the selection. Drag a row onto a
        folder to move it there.
      </p>

      <ul class="rows" data-testid="ft-rows">
        {#each rows as row (row.node.id)}
          <li
            class="row-item"
            class:on={selected === row.node.id}
            style={`--depth: ${row.depth}`}
            data-testid={`ft-row-${row.node.name}`}
            data-droptarget={row.node.kind === 'folder' ? '' : undefined}
            use:draggable={{
              data: { kind: 'tree-node', id: row.node.id },
              label: row.node.name,
              handle: '.grip',
              disabled: row.parentId === null,
            }}
            use:dropzone={{
              accepts: (data) => data.kind === 'tree-node' && row.node.kind === 'folder',
              onDrop: (data) => onDrop(data.id, row.node.id),
            }}
          >
            <span class="grip" aria-hidden="true" title="Drag to move">⠿</span>
            <!-- Decorative: the kind is already in the name field's label,
                 and a screen reader announcing "folder" twice per row is
                 noise. A row becomes a folder by having something put in it. -->
            <span class="kind" aria-hidden="true">{row.node.kind === 'folder' ? '📁' : '📄'}</span>
            <input
              class="name"
              value={row.node.name}
              aria-label={`Name of ${row.node.name}`}
              data-testid={`ft-name-${row.node.name}`}
              onfocus={() => (selected = row.node.id)}
              onchange={(e) => (tree = rename(tree, row.node.id, (e.currentTarget as HTMLInputElement).value))}
            />
            <span class="controls">
              <button class="btn btn-sm" title="Move up" onclick={() => (tree = reorder(tree, row.node.id, -1))}>↑</button>
              <button class="btn btn-sm" title="Move down" onclick={() => (tree = reorder(tree, row.node.id, 1))}>↓</button>
              <button
                class="btn btn-sm btn-danger"
                title="Delete"
                data-testid={`ft-delete-${row.node.name}`}
                disabled={row.parentId === null}
                onclick={() => { tree = remove(tree, row.node.id); if (selected === row.node.id) selected = null; }}
              >×</button>
            </span>
          </li>
        {/each}
      </ul>

      <div class="row">
        <div>
          <label for="ft-import">Load a tree you exported earlier</label>
          <input id="ft-import" data-testid="ft-import" type="file" accept=".json,application/json" onchange={importJson} />
        </div>
      </div>
    </div>
  </Card>

  <Card title="Paste a listing" collapsible open={false} testid="ft-paste-card">
    <div class="stack">
      <p class="muted small">
        Output from <code>ls</code>, <code>ls -R</code>, <code>dir</code>, <code>dir /b /s</code> or
        <code>tree</code> — or a tree you typed with indentation. The format is recognised for you;
        override it if the guess is wrong.
      </p>
      <textarea
        data-testid="ft-listing"
        rows="8"
        bind:value={listing}
        aria-label="A directory listing to read"
        placeholder={'.\n├── src\n│   └── index.ts\n└── README.md'}
      ></textarea>
      <div class="row">
        <div>
          <label for="ft-format">Read it as</label>
          <select id="ft-format" data-testid="ft-format" bind:value={chosenFormat}>
            <option value="auto">Work it out for me</option>
            {#each Object.entries(FORMAT_LABELS) as [id, label] (id)}
              <option value={id}>{label.replace(/`/g, '')}</option>
            {/each}
          </select>
        </div>
        <button class="btn btn-primary" data-testid="ft-parse" onclick={parse}>Read it</button>
      </div>

      {#if parseNote}
        <p class="muted small" aria-live="polite" data-testid="ft-parse-note">{parseNote}</p>
      {/if}

      {#if warnings.length > 0}
        <div class="warnings" data-testid="ft-warnings">
          <p class="small">
            <strong>{warnings.length} {warnings.length === 1 ? 'line' : 'lines'} could not be read.</strong>
            They are listed rather than dropped, so nothing goes missing quietly.
          </p>
          <ul class="small">
            {#each warnings.slice(0, 12) as warning (warning.line)}
              <li><code>line {warning.line}</code> — {warning.reason}: <code>{warning.text}</code></li>
            {/each}
          </ul>
          {#if warnings.length > 12}
            <p class="small muted">…and {warnings.length - 12} more.</p>
          {/if}
        </div>
      {/if}
    </div>
  </Card>

  <Card title="Output" testid="ft-output-card">
    <div class="stack">
      <div class="row">
        <div>
          <label for="ft-charset">Drawing</label>
          <select id="ft-charset" data-testid="ft-charset" bind:value={options.charset}>
            {#each CHARSETS as charset (charset.id)}
              <option value={charset.id}>{charset.label}</option>
            {/each}
          </select>
        </div>
        <div>
          <label for="ft-root">Root</label>
          <select id="ft-root" data-testid="ft-root" bind:value={options.root}>
            <option value="name">Its own name</option>
            <option value="dot">Shown as .</option>
            <option value="hidden">Hidden</option>
            <option value="custom">Something else</option>
          </select>
        </div>
        {#if options.root === 'custom'}
          <div>
            <label for="ft-root-label">Call the root</label>
            <input id="ft-root-label" data-testid="ft-root-label" bind:value={options.rootLabel} />
          </div>
        {/if}
        <div>
          <label for="ft-emoji">Emoji</label>
          <select id="ft-emoji" data-testid="ft-emoji" bind:value={options.emoji}>
            <option value="none">None</option>
            <option value="kind">Folder or file (📂 / 📄)</option>
            <option value="extension">By extension</option>
          </select>
        </div>
      </div>

      <div class="row">
        <label class="check">
          <input type="checkbox" data-testid="ft-slash" bind:checked={options.trailingSlash} />
          Trailing / on folders
        </label>
        <label class="check">
          <input type="checkbox" data-testid="ft-full-paths" bind:checked={options.fullPaths} />
          Full paths instead of names
        </label>
      </div>

      {#if options.emoji === 'extension'}
        <div class="rules" data-testid="ft-rules">
          <p class="small muted">Extension rules — anything not listed falls back to 📄.</p>
          <div class="chips">
            {#each Object.entries(options.emojiRules) as [ext, glyph] (ext)}
              <span class="chip">
                {glyph} .{ext}
                <button class="chip-x" aria-label={`Forget the .${ext} rule`} onclick={() => dropRule(ext)}>×</button>
              </span>
            {/each}
          </div>
          <div class="row">
            <div>
              <label for="ft-rule-ext">Extension</label>
              <input id="ft-rule-ext" data-testid="ft-rule-ext" class="num" bind:value={ruleExt} placeholder="rs" />
            </div>
            <div>
              <label for="ft-rule-emoji">Emoji</label>
              <input id="ft-rule-emoji" data-testid="ft-rule-emoji" class="num" bind:value={ruleEmoji} placeholder="🦀" />
            </div>
            <button class="btn" data-testid="ft-add-rule" onclick={addRule}>Add rule</button>
            <button class="btn" data-testid="ft-restore-rules" onclick={() => (options.emojiRules = { ...DEFAULT_EMOJI_RULES })}>
              Restore defaults
            </button>
            <!-- Every rule, including the dozen that shipped: with none left,
                 every file falls back to 📄 and every folder to 📂, which is
                 a real choice rather than an empty state. -->
            <button class="btn btn-danger" data-testid="ft-clear-rules" onclick={() => (options.emojiRules = {})}>
              Clear all
            </button>
          </div>
        </div>
      {/if}

      <pre class="output" data-testid="ft-output">{text}</pre>
      <p class="muted small" data-testid="ft-summary">{summaryLine(counts)}</p>

      <div class="row">
        <button class="btn btn-primary" data-testid="ft-copy" onclick={() => copyOut('text')}>Copy text</button>
        <button class="btn" data-testid="ft-download-txt" onclick={downloadTxt}>Download .txt</button>
        <button class="btn" data-testid="ft-copy-svg" onclick={() => copyOut('svg')}>Copy SVG</button>
        <button class="btn" data-testid="ft-download-svg" onclick={downloadSvg}>Download .svg</button>
        <button class="btn" data-testid="ft-download-png" onclick={downloadPng}>Download .png</button>
        <button class="btn" data-testid="ft-download-json" onclick={downloadJson}>Download .json</button>
      </div>
      <p class="muted small" aria-live="polite" data-testid="ft-feedback">{feedback ?? ''}</p>
    </div>
  </Card>

  <Explainer summary="Why does my tree look wrong in someone else's terminal?" testid="explainer-file-tree">
    <p>
      The box-drawing characters (<code>├── └── │</code>) are Unicode, and a
      terminal or font without them draws boxes, question marks or nothing at
      all. The <strong>plain ASCII</strong> drawing says the same thing with
      <code>|--</code> and <code>`--</code>, which every font since 1963 has.
    </p>
    <p>
      Emoji are a second version of the same problem, and a worse one in an
      SVG: an exported file carries no font, so it renders in whatever the
      reader has. On a machine with no emoji font your carefully labelled tree
      is a column of empty rectangles. The PNG is the safe way to send one,
      because it is already a picture.
    </p>
    <p>
      Nothing here is saved. Export the tree as JSON if you want it back
      tomorrow — that file re-imports exactly, and it is the only copy.
    </p>
  </Explainer>
</div>

<style>
  .small {
    font-size: var(--font-size-sm);
  }

  .num {
    width: 6rem;
  }

  .check {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: 0;
  }

  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    max-height: 24rem;
    overflow-y: auto;
  }

  .row-item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 2px var(--space-2);
    /* The nesting is drawn, not structural: every row is a sibling so the tab
       order is the reading order. */
    padding-left: calc(var(--space-2) + var(--depth) * 1.25rem);
    border-bottom: 1px solid var(--border-color);
  }

  .row-item:last-child {
    border-bottom: none;
  }

  .row-item.on {
    background: var(--surface-raised-color);
  }

  .grip {
    cursor: grab;
    color: var(--text-muted-color);
    touch-action: none;
    padding: 0 2px;
  }

  .kind {
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    font-size: var(--font-size-sm);
  }

  .name {
    flex: 1 1 auto;
    min-width: 6rem;
    margin-bottom: 0;
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
  }

  .controls {
    display: flex;
    gap: 2px;
    flex: none;
  }

  .output {
    border: 1.5px solid var(--border-strong-color);
    border-radius: var(--radius-sm);
    padding: var(--space-3);
    overflow-x: auto;
    max-height: 32rem;
    overflow-y: auto;
    white-space: pre;
  }

  .warnings {
    border: 1px dashed var(--color-danger);
    border-radius: var(--radius-sm);
    padding: var(--space-3);
  }

  .warnings ul {
    margin: var(--space-2) 0 0;
    padding-left: var(--space-4);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    padding: 1px var(--space-2);
    font-size: var(--font-size-sm);
  }

  .chip-x {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-muted-color);
    padding: 0 2px;
  }
</style>
