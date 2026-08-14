<script lang="ts">
  import Card from '../Card.svelte';
  import Explainer from '../Explainer.svelte';
  import { buildSnippets, validatePattern } from '../../lib/gen/regexgen';
  import { copyText } from '../../lib/exportFile';
  // Core + grammars in guaranteed order — see the note in lib/prism.ts.
  import Prism from '../../lib/prism';

  // Stateless tool — pure view state, zero IndexedDB traffic.
  let pattern = $state('(?<year>\\d{4})-(?<month>\\d{2})-(?<day>\\d{2})');
  let ignoreCase = $state(false);
  let multiline = $state(false);
  let dotAll = $state(false);

  let error = $derived(pattern.length === 0 ? null : validatePattern(pattern));
  let snippets = $derived(
    pattern.length === 0 || error !== null
      ? []
      : buildSnippets({ pattern, ignoreCase, multiline, dotAll })
  );

  // Prism output is safe HTML (it entity-escapes code text); the input is our
  // own generated snippet, never user HTML.
  function highlight(code: string, lang: string): string {
    const grammar = Prism.languages[lang];
    return grammar ? Prism.highlight(code, grammar, lang) : code
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  }

  let copied = $state<string | null>(null);
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  async function copy(lang: string, code: string) {
    copied = (await copyText(code)) ? lang : null;
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (copied = null), 1500);
  }
</script>

<div class="page-header">
  <h1>Regex snippets</h1>
</div>

<div class="stack">
  <Card title="Pattern">
    <div class="stack">
      <div>
        <label for="rx-pattern">Regular expression</label>
        <input
          id="rx-pattern"
          data-testid="rx-pattern"
          type="text"
          class="mono"
          autocomplete="off"
          spellcheck="false"
          bind:value={pattern}
        />
      </div>
      <div class="row">
        <label class="check">
          <input type="checkbox" data-testid="rx-flag-i" bind:checked={ignoreCase} />
          Ignore case (i)
        </label>
        <label class="check">
          <input type="checkbox" data-testid="rx-flag-m" bind:checked={multiline} />
          Multiline ^$ (m)
        </label>
        <label class="check">
          <input type="checkbox" data-testid="rx-flag-s" bind:checked={dotAll} />
          Dot matches newline (s)
        </label>
      </div>
      {#if error}
        <p class="error" data-testid="rx-error" role="alert">{error}</p>
      {/if}
    </div>
  </Card>

  {#each snippets as snip (snip.lang)}
    <Card title={snip.label}>
      {#snippet actions()}
        <button
          class="btn btn-sm"
          data-testid={'rx-copy-' + snip.lang}
          onclick={() => copy(snip.lang, snip.code)}
        >
          {copied === snip.lang ? 'Copied' : 'Copy'}
        </button>
      {/snippet}
      <div class="stack">
        {#each snip.warnings as warning (warning)}
          <p class="warn" data-testid={'rx-warn-' + snip.lang}>⚠ {warning}</p>
        {/each}
        <pre class="mono" data-testid={'rx-snippet-' + snip.lang}><code>{@html highlight(snip.code, snip.prism)}</code></pre>
      </div>
    </Card>
  {/each}

  <Explainer summary="What gets adapted per language" testid="explainer-regex">
    <p>
      Escaping: Python gets a raw string (with quote juggling handled), Go a
      backtick literal (falling back to an interpreted string when the pattern
      contains a backtick), Rust a raw <code>r"…"</code> string with as many
      <code>#</code> fences as the pattern needs, and JavaScript a regex literal
      with slashes escaped.
    </p>
    <p>
      Flags become <code>/ims</code> in JS, <code>re.IGNORECASE | re.MULTILINE |
      re.DOTALL</code> in Python, and an inline <code>(?ims)</code> prefix in Go and
      Rust. Named groups <code>(?&lt;name&gt;)</code> are rewritten to Python's
      <code>(?P&lt;name&gt;)</code> (and <code>\k&lt;name&gt;</code> to
      <code>(?P=name)</code>). Go's regexp and Rust's regex crate are RE2-family
      engines with no lookahead, lookbehind, or backreferences — those snippets get
      a warning instead of silently broken code.
    </p>
  </Explainer>
</div>

<style>
  .mono {
    font-family: var(--font-mono, ui-monospace, monospace);
  }

  .check {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--text-color);
    font-size: var(--font-size-base);
    text-transform: none;
    letter-spacing: normal;
    margin-bottom: 0;
  }

  .error {
    color: var(--color-danger);
    font-size: var(--font-size-sm);
  }

  .warn {
    color: var(--color-warning);
    font-size: var(--font-size-sm);
    font-weight: 600;
  }

  pre {
    margin: 0;
  }
</style>
