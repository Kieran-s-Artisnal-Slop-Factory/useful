<script lang="ts">
  /**
   * The web playground — HTML, CSS and JavaScript (or TypeScript) with a live
   * preview, a console, and a library of saved sessions.
   *
   * Ported from learn-anywhere's `WebExercise` (same author, MIT) onto this
   * app's own chassis, per the 0.4.0 plan's decision 3: its logic — the tab
   * model, the debounce, the srcdoc assembly — but riding this app's
   * `CodeEditor`, `Card`, theme tokens, `zip.ts` and `repo.ts` rather than
   * growing a second editor stack beside the SQL and config playgrounds.
   *
   * Three things are load-bearing:
   *
   * **All three editors stay mounted**, hidden by tab rather than swapped out,
   * so each keeps its buffer, its cursor and — the part people notice — its
   * undo history when the tab changes.
   *
   * **The preview is the app's one sandboxed previewer**
   * ([SandboxedPreview.svelte](../SandboxedPreview.svelte)): an `srcdoc`
   * iframe with `sandbox="allow-scripts"` and no `allow-same-origin`, so the
   * code someone is writing runs with no origin and cannot reach this app's
   * IndexedDB. It also cannot fetch across origins, which is the first thing
   * the user page says about it.
   *
   * **Nothing is written until Save names it.** A scratch session lives in
   * memory; the data suite asserts that typing writes zero rows. Saving is one
   * row in `web_playgrounds`, and the id is remembered in `preferences` so a
   * reload reopens it — reading only, never writing on load.
   */
  import { onDestroy, onMount } from 'svelte';
  import { keymap } from '@codemirror/view';
  import { html as htmlLang } from '@codemirror/lang-html';
  import { css as cssLang } from '@codemirror/lang-css';
  import { javascript } from '@codemirror/lang-javascript';
  import { abbreviationTracker, expandAbbreviation } from '@emmetio/codemirror6-plugin';
  import Card from '../Card.svelte';
  import CodeEditor from '../CodeEditor.svelte';
  import Explainer from '../Explainer.svelte';
  import SandboxedPreview from '../SandboxedPreview.svelte';
  import { buildPreviewDocument, type ConsoleMessage } from '../../lib/preview/document';
  import { compileScript } from '../../lib/playground/compile';
  import { archiveName, exportFiles } from '../../lib/playground/export';
  import {
    BLANK,
    hasConsole,
    isDetached,
    isEmpty,
    isSingleColumn,
    LAYOUTS,
    normalizeSession,
    showsEditor,
    showsPreview,
    STARTER,
    scriptName,
    type Buffers,
    type Layout,
    type ScriptLang,
  } from '../../lib/playground/model';
  import {
    closeMessage,
    documentMessage,
    isPopoutMessage,
    POPOUT_WINDOW_NAME,
    popoutFeatures,
  } from '../../lib/playground/popout';
  import { href } from '../../lib/paths';
  import { zipBlob } from '../../lib/zip';
  import { copyText, downloadBlob } from '../../lib/exportFile';
  import { all, getSingleton, patch, put, putSingleton, softDelete, withSyncFields } from '../../lib/db/repo';
  import type { Preferences, WebPlayground } from '../../lib/db/types';

  type Tab = 'html' | 'css' | 'script';

  /** The buffers are plain, not `$state`: the editors own the text and tell us. */
  const buffers: Buffers = { ...STARTER };

  let active = $state<Tab>('html');
  let lang = $state<ScriptLang>('js');
  let srcdoc = $state('');
  let tsError = $state<string | null>(null);
  let messages = $state<ConsoleMessage[]>([]);
  let sessions = $state<WebPlayground[]>([]);
  let currentId = $state<string | null>(null);
  let name = $state('');
  let notice = $state<string | null>(null);
  let loading = $state(true);

  let htmlEditor: CodeEditor | undefined = $state();
  let cssEditor: CodeEditor | undefined = $state();
  let scriptEditor: CodeEditor | undefined = $state();

  const VIEWPORTS = [
    { id: 'full', label: 'Full', width: null as number | null },
    { id: 'tablet', label: 'Tablet', width: 768 },
    { id: 'mobile', label: 'Mobile', width: 375 },
  ];
  let viewport = $state('full');
  const viewportWidth = $derived(VIEWPORTS.find((v) => v.id === viewport)?.width ?? null);

  // --- layout ---------------------------------------------------------------
  // Session state, not a preference: the page already forgets everything else
  // on reload, and a remembered layout would be the only thing that did not.
  let layout = $state<Layout>('split');
  /** The popped-out preview window, while one is open. */
  let popout: Window | null = null;
  let popoutBlocked = $state(false);
  let popoutPoll: ReturnType<typeof setInterval> | undefined;
  /** The <dialog> for `modal`, while that layout is chosen. */
  let modalEl = $state<HTMLDialogElement | undefined>();

  /** Emmet on the markup tabs: Tab expands, Ctrl-E does too, as in the source. */
  const emmetKeys = keymap.of([
    { key: 'Tab', run: expandAbbreviation },
    { key: 'Ctrl-e', run: expandAbbreviation },
  ]);

  let debounce: ReturnType<typeof setTimeout> | undefined;

  function flash(message: string) {
    notice = message;
  }

  /**
   * Rebuild the preview document. A TypeScript syntax error leaves the LAST
   * GOOD preview up and shows the message instead — a preview that blanks on
   * every half-typed generic is worse than no preview at all.
   */
  async function rebuild() {
    const compiled = await compileScript(buffers.script, lang);
    if (!compiled.ok) {
      tsError = compiled.error;
      return;
    }
    tsError = null;
    srcdoc = buildPreviewDocument({
      html: buffers.html,
      css: buffers.css,
      script: compiled.code,
    });
    sendToPopout();
  }

  // --- the popped-out preview ----------------------------------------------

  /** Hand the current document to the popout, if one is listening. */
  function sendToPopout() {
    if (!popout || popout.closed || !srcdoc) return;
    try {
      popout.postMessage(documentMessage(srcdoc), window.location.origin);
    } catch {
      /* it went away between the check and the send */
    }
  }

  function onPopoutMessage(event: MessageEvent) {
    // Both windows are ours, so a real origin check is available here — unlike
    // the sandboxed frame, whose origin is the string "null" and proves nothing.
    if (event.origin !== window.location.origin) return;
    if (!popout || event.source !== popout) return;
    if (!isPopoutMessage(event.data)) return;
    if (event.data.type === 'ready') sendToPopout();
    else if (event.data.type === 'console') messages = event.data.messages;
  }

  function openPopout() {
    popoutBlocked = false;
    const opened = window.open(
      href('/tools/web-playground/preview/'),
      POPOUT_WINDOW_NAME,
      popoutFeatures(window.screen.availWidth, window.screen.availHeight)
    );
    if (!opened) {
      // Blocked, or a browser that has no popups to give. Say so and stay put.
      popoutBlocked = true;
      layout = 'split';
      return;
    }
    popout = opened;
    messages = [];
    clearInterval(popoutPoll);
    // The window can be closed from its own title bar, which fires nothing we
    // can hear. Noticing costs one cheap check a second.
    popoutPoll = setInterval(() => {
      if (popout?.closed) {
        popout = null;
        clearInterval(popoutPoll);
        if (layout === 'popout') layout = 'split';
      }
    }, 1000);
  }

  function closePopout() {
    clearInterval(popoutPoll);
    if (popout && !popout.closed) {
      try {
        popout.postMessage(closeMessage(), window.location.origin);
        popout.close();
      } catch {
        /* already gone */
      }
    }
    popout = null;
  }

  /**
   * The dialog is opened from an effect rather than from the click, because
   * the element does not exist until the `{#if}` around it has rendered.
   * `showModal()` is what brings the backdrop, the focus trap, Escape and the
   * inertness of the page behind — none of which is worth hand-rolling.
   */
  $effect(() => {
    const dialog = modalEl;
    if (dialog && !dialog.open) dialog.showModal();
  });

  /** Every way of closing the dialog ends here, so there is one way back. */
  function onModalClose() {
    if (layout === 'modal') layout = 'split';
    void rebuild();
  }

  /** A click on the dialog itself is a click on the backdrop, not the content. */
  function onModalClick(event: MouseEvent) {
    if (event.target === modalEl) modalEl?.close();
  }

  function onLayoutChange(next: Layout) {
    if (next === layout) return;
    // No branch for leaving `modal` here: `showModal()` makes everything
    // outside the dialog inert, so this control cannot be reached while it is
    // open. The dialog's own close event is the only way out, and unmounting
    // it takes it out of the top layer on its own.
    layout = next;
    if (next === 'popout') openPopout();
    else closePopout();
    // Coming back to an inline preview: the frame remounts empty, so give it
    // the document again rather than waiting for the next keystroke.
    if (showsPreview(next)) void rebuild();
  }

  function onEdit(key: Tab, doc: string) {
    buffers[key] = doc;
    notice = null;
    clearTimeout(debounce);
    debounce = setTimeout(() => void rebuild(), 500);
  }

  function setBuffers(next: Buffers) {
    buffers.html = next.html;
    buffers.css = next.css;
    buffers.script = next.script;
    htmlEditor?.setText(next.html);
    cssEditor?.setText(next.css);
    scriptEditor?.setText(next.script);
    tsError = null;
    clearTimeout(debounce);
    void rebuild();
  }

  async function refresh() {
    sessions = (await all<WebPlayground>('web_playgrounds')).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }

  /** `remember: false` on the load path, so opening a page writes nothing. */
  async function open(row: WebPlayground, opts: { remember?: boolean } = {}) {
    const session = normalizeSession(row);
    currentId = row.id;
    name = session.name;
    lang = session.lang;
    setBuffers(session.buffers);
    if (opts.remember !== false) {
      await putSingleton<Partial<Preferences>>('preferences', { web_last_playground_id: row.id });
    }
  }

  async function save() {
    const body = {
      name: name.trim() || 'Untitled',
      lang,
      html: buffers.html,
      css: buffers.css,
      script: buffers.script,
    };
    if (currentId) {
      await patch<WebPlayground>('web_playgrounds', currentId, body);
    } else {
      const row = await put<WebPlayground>('web_playgrounds', withSyncFields(body));
      currentId = row.id;
      await putSingleton<Partial<Preferences>>('preferences', { web_last_playground_id: row.id });
    }
    name = body.name;
    await refresh();
    flash('Session saved.');
  }

  function scratch(next: Buffers) {
    currentId = null;
    name = '';
    setBuffers(next);
  }

  function newSession() {
    scratch({ ...STARTER });
    flash('New scratch session — nothing is saved until you name it and press Save.');
  }

  function resetToBlank() {
    // Nothing to lose, nothing to ask about.
    if (!isEmpty(buffers) && !confirm('Clear all three tabs? Anything unsaved here goes with them.'))
      return;
    scratch({ ...BLANK });
  }

  async function remove(row: WebPlayground) {
    if (!confirm(`Delete “${row.name}”?`)) return;
    await softDelete('web_playgrounds', row.id);
    await refresh();
    if (currentId === row.id) scratch({ ...BLANK });
    flash('Session deleted.');
  }

  async function exportZip() {
    const compiled = await compileScript(buffers.script, lang);
    if (!compiled.ok) {
      flash('Fix the TypeScript error first — the export ships the compiled script.');
      return;
    }
    const files = exportFiles(buffers, lang, compiled.code);
    downloadBlob(zipBlob(files), archiveName(name || 'playground'));
    flash(`Downloaded ${archiveName(name || 'playground')}`);
  }

  async function copyTab() {
    flash((await copyText(buffers[active])) ? 'Copied.' : 'Copy failed.');
  }

  function onLangChange() {
    void rebuild();
  }

  onMount(async () => {
    window.addEventListener('message', onPopoutMessage);
    try {
      await refresh();
      const prefs = await getSingleton<Preferences>('preferences');
      const last = prefs?.web_last_playground_id ?? null;
      const row = last ? sessions.find((s) => s.id === last) : undefined;
      if (row) await open(row, { remember: false });
      else setBuffers(buffers);
    } finally {
      loading = false;
    }
  });

  onDestroy(() => {
    clearTimeout(debounce);
    window.removeEventListener('message', onPopoutMessage);
    closePopout();
  });
</script>

<div class="page-header">
  <h1>Web playground</h1>
</div>

<div class="stack">
  {#if notice}
    <p class="banner banner-success" data-testid="wp-notice">{notice}</p>
  {/if}

  <div class="row wrap layout-bar">
    <span class="layout-label" id="wp-layout-label">Layout</span>
    <div class="seg" role="group" aria-labelledby="wp-layout-label">
      {#each LAYOUTS as option (option.id)}
        <button
          type="button"
          class="seg-btn"
          class:on={layout === option.id}
          aria-pressed={layout === option.id}
          title={option.title}
          data-testid={'wp-layout-' + option.id}
          onclick={() => onLayoutChange(option.id)}>{option.label}</button
        >
      {/each}
    </div>
    {#if layout === 'modal'}
      <span class="muted small" data-testid="wp-modal-note">
        The preview is over the page. Close it with the ×, with
        <kbd>Esc</kbd>, or by clicking outside it.
      </span>
    {:else if layout === 'popout'}
      <span class="muted small" data-testid="wp-popout-note">
        The preview is in its own window. <strong>Popouts do not work on most
        phones and tablets</strong> — browsers there open a tab you have to switch to
        by hand, and some block it outright. Switch back to Split if it does not
        appear.
      </span>
    {/if}
  </div>

  {#if popoutBlocked}
    <p class="banner banner-danger" data-testid="wp-popout-blocked" role="alert">
      The browser would not open the preview window — it was blocked, or this
      browser has no popups. Allow popups for this site and try again; the
      preview is back beside the editor in the meantime.
    </p>
  {/if}

  <div class="workspace" class:single={isSingleColumn(layout)}>
    {#if showsEditor(layout)}
    <Card title="Editor">
      {#snippet actions()}
        <span class="muted hint">Emmet on HTML and CSS: <kbd>Tab</kbd> expands</span>
      {/snippet}
      <div class="stack">
        <div class="tabs" role="tablist" aria-label="Source files">
          <button
            class="tab"
            class:on={active === 'html'}
            role="tab"
            aria-selected={active === 'html'}
            data-testid="wp-tab-html"
            onclick={() => (active = 'html')}>index.html</button
          >
          <button
            class="tab"
            class:on={active === 'css'}
            role="tab"
            aria-selected={active === 'css'}
            data-testid="wp-tab-css"
            onclick={() => (active = 'css')}>style.css</button
          >
          <button
            class="tab"
            class:on={active === 'script'}
            role="tab"
            aria-selected={active === 'script'}
            data-testid="wp-tab-script"
            onclick={() => (active = 'script')}>{scriptName(lang)}</button
          >
        </div>

        <!-- Every editor stays mounted: hiding rather than unmounting is what
             keeps each tab's undo history alive across a tab switch. -->
        <div class="pane" hidden={active !== 'html'} data-testid="wp-pane-html">
          <CodeEditor
            bind:this={htmlEditor}
            initialDoc={buffers.html}
            ariaLabel="HTML source"
            extensions={[emmetKeys, htmlLang(), abbreviationTracker()]}
            onDocChange={(doc) => onEdit('html', doc)}
          />
        </div>
        <div class="pane" hidden={active !== 'css'} data-testid="wp-pane-css">
          <CodeEditor
            bind:this={cssEditor}
            initialDoc={buffers.css}
            ariaLabel="CSS source"
            extensions={[emmetKeys, cssLang(), abbreviationTracker({ syntax: 'css' })]}
            onDocChange={(doc) => onEdit('css', doc)}
          />
        </div>
        <div class="pane" hidden={active !== 'script'} data-testid="wp-pane-script">
          <CodeEditor
            bind:this={scriptEditor}
            initialDoc={buffers.script}
            ariaLabel="Script source"
            extensions={[javascript({ typescript: true })]}
            onDocChange={(doc) => onEdit('script', doc)}
          />
        </div>

        {#if tsError}
          <p class="error mono" data-testid="wp-ts-error" role="alert">
            TypeScript: {tsError}
          </p>
        {/if}

        <div class="row wrap">
          <label class="inline" for="wp-lang">Script language</label>
          <select
            id="wp-lang"
            data-testid="wp-lang"
            class="narrow"
            bind:value={lang}
            onchange={onLangChange}
          >
            <option value="js">JavaScript</option>
            <option value="ts">TypeScript</option>
          </select>
          <button class="btn btn-sm" data-testid="wp-copy" onclick={copyTab}>Copy this tab</button>
          <button class="btn btn-sm" data-testid="wp-export" onclick={exportZip}>Export .zip</button>
          <button class="btn btn-sm btn-danger reset" data-testid="wp-reset" onclick={resetToBlank}
            >Clear all tabs</button
          >
        </div>

        {#if lang === 'ts'}
          <p class="muted small" data-testid="wp-ts-note">
            TypeScript here is <strong>stripped, not checked</strong>. Types are removed and the
            rest runs as written, so a wrong type is a bug the preview will happily show you.
          </p>
        {/if}
      </div>
    </Card>
    {/if}

    {#if showsPreview(layout) || hasConsole(layout)}
    <Card title={showsPreview(layout) ? 'Preview' : 'Console'}>
      {#snippet actions()}
        {#if showsPreview(layout)}
          <div class="row seg" role="group" aria-label="Preview width">
            {#each VIEWPORTS as v (v.id)}
              <button
                type="button"
                class="seg-btn"
                class:on={viewport === v.id}
                aria-pressed={viewport === v.id}
                data-testid={'wp-viewport-' + v.id}
                onclick={() => (viewport = v.id)}>{v.label}</button
              >
            {/each}
          </div>
        {/if}
      {/snippet}
      <div class="stack">
        {#if showsPreview(layout)}
          <SandboxedPreview
            {srcdoc}
            title="Web playground preview"
            consoleShim
            width={viewportWidth}
            resize="horizontal"
            height={layout === 'preview' ? '38rem' : '26rem'}
            onConsole={(m) => (messages = m)}
          />
        {:else}
          <p class="muted small" data-testid="wp-preview-elsewhere">
            {#if layout === 'modal'}
              The preview is open over the page. Anything it logs still arrives below.
            {:else}
              The preview is running in its own window. Anything it logs still arrives below.
            {/if}
          </p>
        {/if}

        <div class="console" data-testid="wp-console">
          <div class="row console-head">
            <span class="muted hint">Console</span>
            <button class="btn btn-sm" data-testid="wp-console-clear" onclick={() => (messages = [])}
              >Clear</button
            >
          </div>
          {#if messages.length === 0}
            <p class="muted small" data-testid="wp-console-empty">
              Nothing logged yet. <code>console.log</code>, uncaught errors and unhandled
              rejections all arrive here.
            </p>
          {:else}
            <ul>
              {#each messages as message, i (i)}
                <li data-testid="wp-console-line" data-level={message.level}>
                  <span class="level">{message.level}</span>
                  {message.text}
                </li>
              {/each}
            </ul>
          {/if}
        </div>

        <Explainer summary="Why the preview cannot reach the internet" testid="wp-explainer-sandbox">
          <p>
            The preview runs in a frame with <code>sandbox="allow-scripts"</code> and nothing else,
            which gives it no origin of its own. That is what stops the code you are writing from
            reading this app's stored data — and it is also why <code>fetch</code> to another site
            fails there: a page with no origin is refused by every server's cross-origin rules.
          </p>
          <p>
            Everything runs in your browser. Nothing you type here is sent anywhere.
          </p>
        </Explainer>
      </div>
    </Card>
    {/if}
  </div>

  {#if layout === 'modal'}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <dialog
      class="preview-modal"
      bind:this={modalEl}
      data-testid="wp-modal"
      aria-label="Preview"
      onclose={onModalClose}
      onclick={onModalClick}
    >
      <div class="modal-inner">
        <button
          type="button"
          class="modal-close"
          data-testid="wp-modal-close"
          aria-label="Close the preview"
          onclick={() => modalEl?.close()}>×</button
        >
        <SandboxedPreview
          {srcdoc}
          title="Web playground preview"
          consoleShim
          height="100%"
          onConsole={(m) => (messages = m)}
        />
      </div>
    </dialog>
  {/if}

  <Card title="Sessions">
    <div class="stack">
      <div class="row wrap">
        <label class="inline" for="wp-name">Name</label>
        <input
          id="wp-name"
          data-testid="wp-name"
          type="text"
          placeholder="Untitled"
          bind:value={name}
        />
        <button class="btn btn-primary" data-testid="wp-save" onclick={save}>Save</button>
        <button class="btn" data-testid="wp-new" onclick={newSession}>New</button>
      </div>
      <p class="muted small" data-testid="wp-scratch-note">
        {#if currentId}
          Editing a saved session — Save updates it.
        {:else}
          This is a scratch session. Nothing is stored until you press Save.
        {/if}
      </p>

      {#if loading}
        <p class="muted">Loading…</p>
      {:else if sessions.length === 0}
        <p class="muted small" data-testid="wp-library-empty">No saved sessions yet.</p>
      {:else}
        <ul class="library" data-testid="wp-library">
          {#each sessions as row (row.id)}
            <li data-testid="wp-session" data-id={row.id} class:on={currentId === row.id}>
              <button class="link" data-testid="wp-open" onclick={() => open(row)}>{row.name}</button>
              <span class="muted small">{scriptName(normalizeSession(row).lang)}</span>
              <button class="btn btn-sm btn-danger" data-testid="wp-delete" onclick={() => remove(row)}
                >Delete</button
              >
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </Card>
</div>

<style>
  .workspace {
    display: grid;
    gap: var(--space-4);
    grid-template-columns: minmax(0, 1fr);
    align-items: start;
  }

  @media (min-width: 72rem) {
    .workspace {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }

    /* One panel on screen takes the whole sheet rather than half of it. */
    .workspace.single {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  .layout-bar {
    align-items: baseline;
    gap: var(--space-3);
  }

  /* Near fullscreen with a small margin, so it reads as a sheet over the page
     rather than a second page. The UA stylesheet caps a dialog at 100% minus
     its own margins, hence the explicit max-* overrides. */
  .preview-modal {
    inset: 0;
    margin: auto;
    inline-size: calc(100vw - 2rem);
    block-size: calc(100dvh - 2rem);
    max-inline-size: none;
    max-block-size: none;
    padding: 0;
    border: 1.5px solid var(--border-strong-color);
    background: var(--surface-color);
    color: var(--text-color);
  }

  .preview-modal::backdrop {
    background: rgb(0 0 0 / 0.55);
  }

  .modal-inner {
    position: relative;
    block-size: 100%;
  }

  /* Over the preview, which is someone else's page: it needs its own solid
     background to stay legible against whatever is behind it. */
  .modal-close {
    position: absolute;
    inset-block-start: var(--space-2);
    inset-inline-end: var(--space-2);
    z-index: 1;
    inline-size: 2rem;
    block-size: 2rem;
    display: grid;
    place-items: center;
    font-size: 1.25rem;
    line-height: 1;
    cursor: pointer;
    color: var(--text-color);
    background: var(--surface-color);
    border: 1px solid var(--border-strong-color);
    border-radius: var(--radius-md);
  }

  .modal-close:hover {
    background: var(--surface-raised-color);
  }

  .modal-inner :global(.frame-wrap),
  .modal-inner :global(.frame-box) {
    block-size: 100%;
  }

  .modal-inner :global(.frame-box) {
    border: none;
  }

  .layout-label {
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-muted-color);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
  }

  .layout-bar .muted {
    flex: 1 1 18rem;
  }

  .tabs {
    display: flex;
    gap: var(--space-1);
    border-bottom: 1px solid var(--border-color);
  }

  .tab {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    padding: var(--space-1) var(--space-3);
    cursor: pointer;
    color: var(--text-muted-color);
    font: inherit;
    font-weight: 600;
    font-size: var(--font-size-sm);
    font-family: var(--font-mono);
  }

  .tab:hover {
    color: var(--text-color);
  }

  .tab.on {
    color: var(--color-primary-strong);
    border-bottom-color: var(--color-primary);
  }

  .pane[hidden] {
    display: none;
  }

  .seg {
    display: inline-flex;
    gap: 0;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .seg-btn {
    background: none;
    border: none;
    padding: var(--space-1) var(--space-2);
    font: inherit;
    font-size: var(--font-size-sm);
    color: var(--text-muted-color);
    cursor: pointer;
  }

  .seg-btn.on {
    background: var(--color-primary);
    color: var(--color-on-primary);
  }

  .console {
    border: 1px solid var(--border-color);
    padding: var(--space-2) var(--space-3);
  }

  .console-head {
    justify-content: space-between;
  }

  .console ul {
    list-style: none;
    padding: 0;
    margin: var(--space-2) 0 0;
    max-height: 10rem;
    overflow-y: auto;
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
  }

  .console li {
    padding: 2px 0;
    border-top: 1px solid var(--border-color);
    word-break: break-word;
  }

  .console li[data-level='error'] {
    color: var(--color-danger);
  }

  .console li[data-level='warn'] {
    color: var(--color-warning);
  }

  .level {
    display: inline-block;
    min-width: 4ch;
    color: var(--text-muted-color);
    text-transform: uppercase;
    font-size: var(--font-size-eyebrow);
  }

  .library {
    list-style: none;
    padding: 0;
    display: grid;
    gap: var(--space-1);
  }

  .library li {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2);
    border: 1px solid var(--border-color);
  }

  .library li.on {
    border-color: var(--color-primary);
  }

  .library .link {
    margin-right: auto;
  }

  .mono {
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
  }

  .small {
    font-size: var(--font-size-sm);
  }

  .inline {
    display: inline;
    margin-bottom: 0;
  }

  .narrow {
    width: auto;
  }

  .error {
    color: var(--color-danger);
  }

  .reset {
    margin-left: auto;
  }
</style>
