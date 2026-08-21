<script lang="ts">
  /**
   * The mermaid workbench — a "fancier text field" for authoring diagrams.
   * Ported from retoken's DiagramDialog onto this app's tokens.
   *
   * Mermaid has no embeddable visual editor worth adopting, so this pairs a
   * CodeMirror editor with everything that makes text authoring bearable:
   *
   *  - syntax highlighting (codemirror-lang-mermaid), on the blueprint inks;
   *  - completions — diagram types on line 1, then the keyword set for
   *    whichever diagram the first line declared;
   *  - starter templates, which is where most of the ease-of-use lives;
   *  - a live preview pane that keeps the last good picture while showing
   *    mermaid's own parse error for the current text.
   *
   * The caller owns the document: `onSave` receives the diagram source and
   * decides where it goes.
   */
  import { onDestroy, onMount } from 'svelte';
  import { EditorView, keymap } from '@codemirror/view';
  import { EditorState, Prec } from '@codemirror/state';
  import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
  import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
  import { autocompletion } from '@codemirror/autocomplete';
  import {
    mermaid as mermaidLang,
    flowchartTags,
    sequenceTags,
    pieTags,
    ganttTags,
    journeyTags,
    mindmapTags,
    requirementTags,
  } from 'codemirror-lang-mermaid';
  import {
    DIAGRAM_TEMPLATES,
    mermaidCompletionSource,
    renderDiagram,
    validateDiagram,
  } from '../../lib/notebook/mermaid';

  let {
    initial = '',
    onSave,
    onCancel,
  }: {
    /** Existing diagram source when editing; '' for a new one. */
    initial?: string;
    onSave: (code: string) => void;
    onCancel: () => void;
  } = $props();

  let host: HTMLDivElement;
  let cm: EditorView | null = null;
  let code = $state(initial);
  let svg = $state('');
  let error = $state<string | null>(null);
  let rendering = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let seq = 0;

  /** Map the language package's tags onto the --syntax-* inks set on the root. */
  const highlight = HighlightStyle.define([
    { tag: flowchartTags.diagramName, color: 'var(--syntax-keyword)', fontWeight: '700' },
    { tag: flowchartTags.keyword, color: 'var(--syntax-keyword)' },
    { tag: flowchartTags.orientation, color: 'var(--syntax-keyword)' },
    { tag: flowchartTags.nodeEdge, color: 'var(--syntax-operator)' },
    { tag: flowchartTags.nodeEdgeText, color: 'var(--syntax-string)' },
    { tag: flowchartTags.nodeId, color: 'var(--syntax-name)' },
    { tag: flowchartTags.nodeText, color: 'var(--syntax-string)' },
    { tag: flowchartTags.string, color: 'var(--syntax-string)' },
    { tag: flowchartTags.number, color: 'var(--syntax-number)' },
    { tag: flowchartTags.link, color: 'var(--syntax-name)' },
    { tag: flowchartTags.lineComment, color: 'var(--syntax-comment)', fontStyle: 'italic' },
    { tag: sequenceTags.diagramName, color: 'var(--syntax-keyword)', fontWeight: '700' },
    { tag: sequenceTags.keyword1, color: 'var(--syntax-keyword)' },
    { tag: sequenceTags.keyword2, color: 'var(--syntax-type)' },
    { tag: sequenceTags.arrow, color: 'var(--syntax-operator)' },
    { tag: sequenceTags.nodeText, color: 'var(--syntax-name)' },
    { tag: sequenceTags.messageText1, color: 'var(--syntax-string)' },
    { tag: sequenceTags.messageText2, color: 'var(--syntax-string)' },
    { tag: sequenceTags.position, color: 'var(--syntax-type)' },
    { tag: sequenceTags.lineComment, color: 'var(--syntax-comment)', fontStyle: 'italic' },
    { tag: pieTags.diagramName, color: 'var(--syntax-keyword)', fontWeight: '700' },
    { tag: pieTags.title, color: 'var(--syntax-keyword)' },
    { tag: pieTags.titleText, color: 'var(--syntax-string)' },
    { tag: pieTags.string, color: 'var(--syntax-string)' },
    { tag: pieTags.number, color: 'var(--syntax-number)' },
    { tag: ganttTags.diagramName, color: 'var(--syntax-keyword)', fontWeight: '700' },
    { tag: ganttTags.keyword, color: 'var(--syntax-keyword)' },
    { tag: ganttTags.string, color: 'var(--syntax-string)' },
    { tag: journeyTags.diagramName, color: 'var(--syntax-keyword)', fontWeight: '700' },
    { tag: journeyTags.keyword, color: 'var(--syntax-keyword)' },
    { tag: journeyTags.actor, color: 'var(--syntax-name)' },
    { tag: journeyTags.text, color: 'var(--syntax-string)' },
    { tag: journeyTags.score, color: 'var(--syntax-number)' },
    { tag: mindmapTags.diagramName, color: 'var(--syntax-keyword)', fontWeight: '700' },
    { tag: mindmapTags.lineText1, color: 'var(--syntax-name)' },
    { tag: mindmapTags.lineText2, color: 'var(--syntax-string)' },
    { tag: mindmapTags.lineText3, color: 'var(--syntax-type)' },
    { tag: requirementTags.diagramName, color: 'var(--syntax-keyword)', fontWeight: '700' },
    { tag: requirementTags.keyword, color: 'var(--syntax-keyword)' },
    { tag: requirementTags.arrow, color: 'var(--syntax-operator)' },
  ]);

  /** The editor chrome, on the same inks as CodeEditor.svelte. */
  const chrome = EditorView.theme({
    '&': { backgroundColor: 'transparent', color: 'var(--text-color)', height: '100%' },
    '.cm-content': {
      caretColor: 'var(--color-stamp)',
      fontFamily: 'var(--font-mono)',
      padding: 'var(--space-2)',
    },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-stamp)' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
      { backgroundColor: 'var(--color-primary-soft)' },
    '.cm-activeLine': { backgroundColor: 'var(--color-primary-soft)' },
    '&.cm-focused': { outline: 'none' },
    '.cm-tooltip': {
      backgroundColor: 'var(--surface-color)',
      color: 'var(--text-color)',
      border: '1px solid var(--border-strong-color)',
      boxShadow: 'var(--shadow-1)',
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul': {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--font-size-sm)',
      maxHeight: '15em',
    },
    '.cm-tooltip-autocomplete > ul > li': { padding: '2px 6px' },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: 'var(--color-primary)',
      color: 'var(--color-on-primary, #fff)',
    },
    '.cm-completionMatchedText': {
      color: 'var(--color-stamp)',
      textDecoration: 'none',
      fontWeight: '700',
    },
    '.cm-completionDetail': { color: 'var(--text-muted-color)', fontStyle: 'italic' },
  });

  async function refresh(source: string) {
    const mine = ++seq;
    if (!source.trim()) {
      svg = '';
      error = null;
      return;
    }
    rendering = true;
    const problem = await validateDiagram(source);
    if (mine !== seq) return;
    if (problem) {
      // Keep the last good picture on screen; show what's wrong.
      error = problem;
      rendering = false;
      return;
    }
    try {
      const out = await renderDiagram(source);
      if (mine !== seq) return;
      svg = out;
      error = null;
    } catch (err) {
      if (mine !== seq) return;
      error = err instanceof Error ? err.message.split('\n')[0]! : String(err);
    } finally {
      if (mine === seq) rendering = false;
    }
  }

  function scheduleRefresh() {
    clearTimeout(timer);
    timer = setTimeout(() => void refresh(code), 350);
  }

  function setDoc(next: string) {
    code = next;
    cm?.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: next } });
    void refresh(next);
  }

  function save() {
    const text = code.trim();
    if (text) onSave(text);
  }

  onMount(() => {
    cm = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: initial,
        extensions: [
          history(),
          // Ctrl/Cmd+Enter saves without reaching for the mouse.
          Prec.high(keymap.of([{ key: 'Mod-Enter', run: () => (save(), true) }])),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          mermaidLang(),
          chrome,
          syntaxHighlighting(highlight),
          autocompletion({ override: [mermaidCompletionSource] }),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ 'aria-label': 'Diagram source' }),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return;
            code = u.state.doc.toString();
            scheduleRefresh();
          }),
        ],
      }),
    });
    cm.focus();
    if (initial.trim()) void refresh(initial);
  });

  onDestroy(() => {
    clearTimeout(timer);
    cm?.destroy();
  });
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onCancel()} />

<div
  class="backdrop"
  role="presentation"
  onclick={(e) => e.target === e.currentTarget && onCancel()}
>
  <div
    class="modal"
    role="dialog"
    aria-modal="true"
    aria-labelledby="diagram-title"
    data-testid="notebook-diagram-dialog"
  >
    <div class="head">
      <h3 id="diagram-title">{initial ? 'Edit diagram' : 'New diagram'}</h3>
      <button type="button" class="close" aria-label="Close" onclick={onCancel}>×</button>
    </div>

    <div class="templates">
      <span class="muted small">Start from:</span>
      {#each DIAGRAM_TEMPLATES as t (t.id)}
        <button
          type="button"
          class="btn btn-sm"
          data-testid="notebook-diagram-template-{t.id}"
          onclick={() => setDoc(t.code)}>{t.label}</button
        >
      {/each}
    </div>

    <div class="panes">
      <div class="pane">
        <span class="pane-title">
          Diagram source
          <span class="muted small">
            — <kbd>Ctrl</kbd>+<kbd>Space</kbd> completes, <kbd>Ctrl</kbd>+<kbd>Enter</kbd> inserts
          </span>
        </span>
        <div class="cm-host" bind:this={host}></div>
        {#if error}
          <p class="err" role="alert">{error}</p>
        {/if}
      </div>

      <div class="pane">
        <span class="pane-title">
          Preview
          {#if rendering}<span class="muted small">— rendering…</span>{/if}
        </span>
        <div class="preview" class:stale={error !== null}>
          {#if svg}
            <!-- eslint-disable-next-line svelte/no-at-html-tags — mermaid's own SVG output -->
            {@html svg}
          {:else if !error}
            <p class="muted small">Pick a template or start typing — the diagram appears here.</p>
          {/if}
        </div>
        {#if error && svg}
          <p class="muted small">Showing the last diagram that parsed.</p>
        {/if}
      </div>
    </div>

    <div class="actions">
      <span class="muted small">
        Inserted as a <code>```mermaid</code> code block — a published page renders it too.
      </span>
      <button
        type="button"
        class="btn"
        data-testid="notebook-diagram-cancel"
        onclick={onCancel}>Cancel</button
      >
      <button
        type="button"
        class="btn btn-primary"
        data-testid="notebook-diagram-save"
        onclick={save}
        disabled={!code.trim()}
      >
        {initial ? 'Update diagram' : 'Insert diagram'}
      </button>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: var(--scrim-color);
    display: grid;
    place-items: center;
    z-index: 70;
    padding: var(--space-4);

    /* The syntax inks the highlight style reads — the dialog is mounted
       outside the editor's root, so it carries its own copy. */
    --syntax-keyword: var(--color-stamp);
    --syntax-string: var(--color-success);
    --syntax-number: var(--color-warning);
    --syntax-comment: var(--text-muted-color);
    --syntax-type: var(--color-primary-strong);
    --syntax-operator: var(--text-muted-color);
    --syntax-name: var(--text-color);
  }

  .modal {
    background: var(--surface-raised-color);
    border: 1px solid var(--border-strong-color);
    outline: 1px dashed var(--border-color);
    outline-offset: 4px;
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-2);
    padding: var(--space-4);
    width: min(64rem, 100%);
    max-height: min(90vh, 100%);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .head h3 {
    margin: 0;
    font-size: var(--font-size-sm);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
  }

  .close {
    border: none;
    background: none;
    color: var(--text-muted-color);
    font-size: var(--font-size-xl);
    line-height: 1;
    cursor: pointer;
    padding: 0 var(--space-2);
  }

  .close:hover {
    color: var(--text-color);
  }

  .templates {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    flex-wrap: wrap;
  }

  .panes {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3);
    min-height: 0;
    flex: 1;
  }

  .pane {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-height: 0;
  }

  .pane-title {
    font-weight: 600;
    font-size: var(--font-size-sm);
  }

  .cm-host {
    flex: 1;
    min-height: 16rem;
    overflow: auto;
    border: 1px solid var(--border-strong-color);
    border-radius: var(--radius-md);
    background: var(--bg-color);
    font-size: var(--font-size-sm);
  }

  .cm-host :global(.cm-editor.cm-focused) {
    outline: 2px solid var(--color-stamp);
    outline-offset: -1px;
  }

  .preview {
    flex: 1;
    min-height: 16rem;
    overflow: auto;
    display: grid;
    place-items: center;
    padding: var(--space-3);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: var(--bg-color);
  }

  .preview.stale {
    opacity: 0.55;
  }

  .preview :global(svg) {
    max-width: 100%;
    height: auto;
  }

  .err {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border-left: 3px solid var(--color-danger);
    color: var(--color-danger);
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
  }

  .actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .actions .muted {
    margin-right: auto;
  }

  kbd {
    font-family: var(--font-mono);
    font-size: 0.85em;
    padding: 0 0.3em;
    border: 1px solid var(--border-strong-color);
    border-radius: var(--radius-sm);
  }

  .muted {
    color: var(--text-muted-color);
  }

  .small {
    font-size: var(--font-size-sm);
  }

  @media (max-width: 55rem) {
    .panes {
      grid-template-columns: 1fr;
    }
  }
</style>
