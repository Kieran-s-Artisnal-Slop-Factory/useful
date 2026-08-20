<script lang="ts">
  /**
   * A textarea with syntax highlighting behind it.
   *
   * The textarea stays a real textarea — it keeps native selection, undo,
   * spellcheck-off, paste, and the accessibility a contenteditable div throws
   * away. Its text is made transparent (the caret is not), and an identically
   * laid-out `<pre>` sits underneath showing the highlighted version. The two
   * agree because they share one set of typography and padding rules and the
   * scroll positions are synced.
   *
   * The alternative was CodeMirror, which the app already bundles for the SQL
   * playground — but it is a couple of hundred kilobytes and a focus trap, for
   * a box someone pastes JSON into once.
   */
  // Core + grammars in guaranteed order — see the note in lib/prism.ts.
  import Prism from '../lib/prism';

  let {
    value = $bindable(''),
    language = 'json',
    rows = 6,
    placeholder = '',
    ariaLabel,
    testid,
  }: {
    value?: string;
    language?: string;
    rows?: number;
    placeholder?: string;
    ariaLabel: string;
    testid?: string;
  } = $props();

  let scroller: HTMLPreElement | undefined = $state();

  const escape = (text: string): string =>
    text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

  const html = $derived.by(() => {
    // A textarea always reserves a line past its content; without matching
    // that, the underlay is exactly one line shorter and scrolling to the
    // bottom slides the highlight out of step with the text it sits behind.
    const source = `${value}\n`;
    const grammar = Prism.languages[language];
    if (!grammar) return escape(source);
    try {
      return Prism.highlight(source, grammar, language);
    } catch {
      return escape(source);
    }
  });

  function sync(event: Event) {
    const area = event.currentTarget as HTMLTextAreaElement;
    if (!scroller) return;
    scroller.scrollTop = area.scrollTop;
    scroller.scrollLeft = area.scrollLeft;
  }
</script>

<div class="wrap">
  <pre class="underlay" bind:this={scroller} aria-hidden="true"><code
      class={`language-${language}`}>{@html html}</code
    ></pre>
  <textarea
    class="editor"
    data-testid={testid}
    aria-label={ariaLabel}
    {rows}
    {placeholder}
    spellcheck="false"
    autocapitalize="off"
    bind:value
    onscroll={sync}
  ></textarea>
</div>

<style>
  .wrap {
    position: relative;
    display: block;
  }

  /* Everything that affects where a glyph lands must be identical on both
     layers, or the highlight drifts away from the text. */
  .underlay,
  .editor {
    margin: 0;
    padding: var(--space-2);
    border: 1px solid var(--border-color);
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
    line-height: 1.5;
    tab-size: 2;
    white-space: pre-wrap;
    overflow-wrap: break-word;
    word-break: break-word;
  }

  .underlay {
    position: absolute;
    inset: 0;
    overflow: auto;
    background: var(--surface-raised-color);
    pointer-events: none;
  }

  .editor {
    position: relative;
    width: 100%;
    display: block;
    background: transparent;
    /* Transparent text, opaque caret — the underlay supplies the colour. */
    color: transparent;
    caret-color: var(--text-color);
    resize: vertical;
  }

  .editor::placeholder {
    color: var(--text-muted-color);
  }

  .editor::selection {
    /* Without a visible selection the transparent text looks unselectable. */
    background: var(--color-primary-soft);
    color: var(--text-color);
  }
</style>
