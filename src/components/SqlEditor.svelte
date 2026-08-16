<script lang="ts">
  /**
   * SQL flavour of the CodeEditor chassis — wires in the dialect (and keyword
   * autocomplete) of whichever engine is running, so a Postgres session gets
   * Postgres keywords and a SQLite one gets SQLite's. Validity errors come
   * from the engine, not an editor linter.
   *
   * The dialect is loaded through `adapter.editorLanguage()`, which is lazy:
   * `@codemirror/lang-sql` is only fetched once an editor actually mounts.
   * Until it arrives the editor is fully usable, just unhighlighted — and
   * switching engines reconfigures the live editor rather than replacing it,
   * so the buffer and undo history survive.
   */
  import type { Extension } from '@codemirror/state';
  import { sqliteAdapter } from '../lib/sql/adapter';
  import type { RuntimeAdapter } from '../lib/sql/types';
  import CodeEditor from './CodeEditor.svelte';

  let {
    initialDoc = '',
    adapter = sqliteAdapter,
    onDocChange,
    onRun,
  }: {
    initialDoc?: string;
    /** Engine whose SQL dialect the editor should speak. */
    adapter?: RuntimeAdapter;
    onDocChange?: (doc: string) => void;
    /** Invoked on Mod-Enter so the keyboard can drive the Run action. */
    onRun?: () => void;
  } = $props();

  let editor: CodeEditor | undefined = $state();
  let language = $state<Extension | undefined>(undefined);

  $effect(() => {
    const wanted = adapter;
    let current = true;
    void wanted
      .editorLanguage()
      .then((support) => {
        // A fast engine switch can resolve these out of order; only the
        // latest one may win.
        if (current) language = support;
      })
      .catch(() => {
        // No highlighting is a fair fallback — never block editing on it.
        if (current) language = undefined;
      });
    return () => {
      current = false;
    };
  });

  export function getText(): string {
    return editor?.getText() ?? '';
  }

  export function setText(text: string): void {
    editor?.setText(text);
  }
</script>

<CodeEditor
  bind:this={editor}
  {initialDoc}
  {language}
  {onDocChange}
  {onRun}
  ariaLabel="SQL editor"
/>
