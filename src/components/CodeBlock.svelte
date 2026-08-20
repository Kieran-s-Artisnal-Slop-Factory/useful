<script lang="ts">
  /**
   * Read-only source, syntax-highlighted.
   *
   * Prism rather than CodeMirror: this shows generated output that nobody
   * edits, and an editor would cost a couple of hundred kilobytes plus a
   * focus trap for no benefit. Prism's grammars are already bundled once, in
   * [lib/prism.ts](../lib/prism.ts) — importing them from anywhere else breaks
   * their load order.
   */
  // Core + grammars in guaranteed order — see the note in lib/prism.ts.
  import Prism from '../lib/prism';

  let {
    code,
    language = 'text',
    testid,
    maxHeight = '22rem',
  }: {
    code: string;
    /** A Prism grammar name. Anything unknown renders as escaped plain text. */
    language?: string;
    testid?: string;
    maxHeight?: string;
  } = $props();

  const escape = (text: string): string =>
    text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

  // Prism entity-escapes the code it highlights, and the input here is this
  // app's own generated source — never markup from anywhere else.
  const html = $derived.by(() => {
    const grammar = Prism.languages[language];
    if (!grammar) return escape(code);
    try {
      return Prism.highlight(code, grammar, language);
    } catch {
      // A grammar can throw on pathological input; showing the plain text is
      // strictly better than showing nothing.
      return escape(code);
    }
  });
</script>

<pre class="code" style={`max-height: ${maxHeight}`} data-testid={testid}><code
    class={`language-${language}`}>{@html html}</code
  ></pre>

<style>
  .code {
    overflow: auto;
    margin: 0;
    padding: var(--space-2);
    border: 1px solid var(--border-color);
    background: var(--surface-raised-color);
    font-size: var(--font-size-sm);
    white-space: pre;
    tab-size: 2;
  }
</style>
