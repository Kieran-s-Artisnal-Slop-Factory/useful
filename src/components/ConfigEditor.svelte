<script lang="ts">
  /**
   * JSON/YAML flavour of the CodeEditor chassis — wires in the language
   * package for whichever format the document is in, plus a linter fed by the
   * config playground's own parser, so the gutter marks the same problems the
   * page reports.
   *
   * Everything rides the one hot-swappable `language` compartment slot as a
   * single bundle: CodeEditor's `extensions` prop is mount-time only, and the
   * diagnostics change with the format, so the language support and the linter
   * have to swap together. Flipping the format reconfigures the live editor
   * rather than replacing it — the buffer and undo history survive.
   *
   * The packages are loaded lazily, the way SqlEditor loads its dialect: until
   * they arrive the editor is fully usable, just unhighlighted and unlinted.
   */
  import type { Extension } from '@codemirror/state';
  import CodeEditor from './CodeEditor.svelte';

  export interface LintIssue {
    from: number;
    to: number;
    message: string;
    severity: 'error' | 'warning';
  }

  let {
    initialDoc = '',
    format = 'json',
    lint,
    onDocChange,
  }: {
    initialDoc?: string;
    /** Which language package (and which parser) the buffer gets. */
    format?: 'json' | 'yaml';
    /** Positioned issues for the current text; called by the editor's linter. */
    lint?: (text: string) => LintIssue[];
    onDocChange?: (doc: string) => void;
  } = $props();

  let editor: CodeEditor | undefined = $state();
  let language = $state<Extension | undefined>(undefined);

  $effect(() => {
    const wanted = format;
    let current = true;
    void loadBundle(wanted)
      .then((bundle) => {
        // A fast format flip can resolve these out of order; only the latest
        // one may win.
        if (current) language = bundle;
      })
      .catch(() => {
        // No highlighting is a fair fallback — never block editing on it.
        if (current) language = undefined;
      });
    return () => {
      current = false;
    };
  });

  async function loadBundle(fmt: 'json' | 'yaml'): Promise<Extension> {
    const [{ linter, lintGutter }, support] = await Promise.all([
      import('@codemirror/lint'),
      fmt === 'json'
        ? import('@codemirror/lang-json').then((m) => m.json())
        : import('@codemirror/lang-yaml').then((m) => m.yaml()),
    ]);
    const check = linter((view) => {
      const text = view.state.doc.toString();
      const max = text.length;
      // Clamp before handing offsets to CodeMirror: a diagnostic outside the
      // document throws, and the parser's positions can trail a fast edit.
      return (lint?.(text) ?? []).map((issue) => {
        const from = Math.max(0, Math.min(issue.from, max));
        const to = Math.max(from, Math.min(Math.max(issue.to, from), max));
        return { from, to, message: issue.message, severity: issue.severity };
      });
    });
    return [support, check, lintGutter()];
  }

  export function getText(): string {
    return editor?.getText() ?? '';
  }

  export function setText(text: string): void {
    editor?.setText(text);
  }

  export function focus(): void {
    editor?.focus();
  }
</script>

<CodeEditor
  bind:this={editor}
  {initialDoc}
  {language}
  {onDocChange}
  ariaLabel="Configuration document"
/>
