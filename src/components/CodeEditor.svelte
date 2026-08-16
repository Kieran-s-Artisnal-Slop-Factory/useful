<script lang="ts">
  /**
   * A themed CodeMirror 6 editor chassis — just the buffer; errors come from
   * whatever runs the code, not from an editor linter.
   *
   * Ported from retoken (src/components/CodeEditor.svelte). Its `--editor-*` /
   * `--syntax-*` token set does not exist here, so the colours are wired
   * straight onto this app's blueprint palette — the same inks Prism uses for
   * rendered markdown, so a SQL buffer and a fenced code block look alike.
   */
  import { onDestroy, onMount } from 'svelte';
  import { EditorView, basicSetup } from 'codemirror';
  import { keymap } from '@codemirror/view';
  import { Compartment, type Extension } from '@codemirror/state';
  import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
  import { tags } from '@lezer/highlight';

  let {
    initialDoc = '',
    extensions = [],
    language = undefined,
    ariaLabel = 'Code editor',
    onDocChange,
    onRun,
  }: {
    initialDoc?: string;
    /** Language support + any per-use extras (autocomplete config, …). */
    extensions?: Extension[];
    /**
     * A language that can change after mount — a SQL dialect that follows the
     * selected engine, say. It lives in its own compartment, so swapping it
     * reconfigures the running editor instead of rebuilding it (which would
     * lose the buffer, the cursor and the undo history).
     */
    language?: Extension;
    ariaLabel?: string;
    onDocChange?: (doc: string) => void;
    /** Invoked on Mod-Enter so the keyboard can drive the Run action. */
    onRun?: () => void;
  } = $props();

  let host: HTMLDivElement;
  let view: EditorView | null = null;
  const languageSlot = new Compartment();

  const chrome = EditorView.theme({
    '&': {
      backgroundColor: 'var(--bg-color)',
      color: 'var(--text-color)',
      fontSize: 'var(--font-size-sm)',
    },
    '.cm-content': { caretColor: 'var(--color-stamp)', fontFamily: 'var(--font-mono)' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-stamp)' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
      { backgroundColor: 'var(--color-primary-soft)' },
    '.cm-activeLine': { backgroundColor: 'var(--color-primary-soft)' },
    '.cm-gutters': {
      backgroundColor: 'var(--surface-color)',
      color: 'var(--text-muted-color)',
      borderRight: '1px solid var(--border-color)',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'var(--color-primary-soft)',
      color: 'var(--text-color)',
    },
    // Autocomplete popup — same surface treatment as the app's own menus.
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

  const highlight = HighlightStyle.define([
    { tag: tags.keyword, color: 'var(--color-stamp)', fontWeight: '600' },
    { tag: [tags.string, tags.special(tags.string)], color: 'var(--color-success)' },
    { tag: [tags.number, tags.bool, tags.null], color: 'var(--color-warning)' },
    { tag: tags.comment, color: 'var(--text-muted-color)', fontStyle: 'italic' },
    { tag: tags.typeName, color: 'var(--color-primary-strong)' },
    { tag: tags.operator, color: 'var(--text-muted-color)' },
    { tag: [tags.name, tags.variableName], color: 'var(--text-color)' },
    { tag: tags.punctuation, color: 'var(--text-muted-color)' },
  ]);

  export function getText(): string {
    return view?.state.doc.toString() ?? '';
  }

  export function setText(text: string): void {
    view?.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  }

  export function focus(): void {
    view?.focus();
  }

  onMount(() => {
    view = new EditorView({
      doc: initialDoc,
      extensions: [
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              onRun?.();
              return true;
            },
          },
        ]),
        basicSetup,
        chrome,
        syntaxHighlighting(highlight),
        languageSlot.of(language ?? []),
        EditorView.contentAttributes.of({ 'aria-label': ariaLabel }),
        ...extensions,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onDocChange?.(update.state.doc.toString());
        }),
      ],
      parent: host,
    });
  });

  // Swap the language when the prop changes. Reads `language` first so the
  // effect tracks it even on the pre-mount run, where there's no view yet.
  $effect(() => {
    const next = language;
    view?.dispatch({ effects: languageSlot.reconfigure(next ?? []) });
  });

  onDestroy(() => view?.destroy());
</script>

<div class="editor" bind:this={host}></div>

<style>
  .editor {
    border: 1px solid var(--border-strong-color);
    /* No overflow:hidden — it would clip the autocomplete popup. */
  }

  .editor :global(.cm-editor) {
    min-height: 12rem;
  }

  .editor :global(.cm-editor.cm-focused) {
    outline: 2px solid var(--color-stamp);
    outline-offset: -1px;
  }
</style>
