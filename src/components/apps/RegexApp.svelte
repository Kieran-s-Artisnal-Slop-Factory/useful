<script lang="ts">
  import Card from '../Card.svelte';
  import Explainer from '../Explainer.svelte';
  import { buildSnippets, validatePattern } from '../../lib/gen/regexgen';
  import { findMatches, segmentText, MAX_MATCHES } from '../../lib/gen/regexTester';
  import { filterReference } from '../../lib/gen/regexRef';
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

  // Live tester (JS engine — the snippets note where other engines differ).
  let testText = $state('Dates: 2024-01-15, 2025-12-31 — and one that isn\'t: 99-9.');
  let testResult = $derived(
    pattern.length === 0 || error !== null
      ? null
      : findMatches(pattern, { ignoreCase, multiline, dotAll }, testText)
  );
  let segments = $derived(testResult ? segmentText(testText, testResult.matches) : null);

  // Symbol reference filter.
  let refQuery = $state('');
  let refGroups = $derived(filterReference(refQuery));

  // Group N is the same color EVERYWHERE (in-match spans and table chips).
  // Fixed light backgrounds + near-black ink read on both themes.
  const GROUP_COLORS = ['#f0b25e', '#7db8ea', '#7ecfa2', '#cf9fe3', '#ef9d9d', '#7ecfd4'];
  const groupColor = (number: number): string => GROUP_COLORS[(number - 1) % GROUP_COLORS.length]!;
  const groupLabel = (g: { number: number; name: string | null }): string => g.name ?? '$' + g.number;

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

  <Card title="Test">
    <div class="stack">
      <div>
        <label for="rx-test-text">Sample text</label>
        <textarea
          id="rx-test-text"
          data-testid="rx-test-text"
          class="mono"
          rows="4"
          spellcheck="false"
          bind:value={testText}
        ></textarea>
      </div>

      {#if testResult && segments}
        <p class="muted small" data-testid="rx-match-count">
          {testResult.matches.length === 0
            ? 'No matches.'
            : `${testResult.matches.length}${testResult.truncated ? '+' : ''} match${testResult.matches.length === 1 ? '' : 'es'}`}
          <span class="engine-note">(JavaScript engine — see snippet warnings for Go/Rust differences)</span>
        </p>
        <div class="highlighted mono" data-testid="rx-highlighted" aria-label="Sample text with matches highlighted">
          {#each segments as seg, i (i)}
            {#if seg.matchOrdinal !== null}
              <!-- Kept on one line: any template whitespace inside the mark
                   would inject spaces into the match text. -->
              <mark data-testid="rx-mark" title={'Match ' + (seg.matchOrdinal + 1)}>{#each seg.parts ?? [] as part, j (j)}{#if part.groupNumber !== null}<span class="grp" style={`background: ${groupColor(part.groupNumber)}`} title={'Group ' + part.groupNumber}>{part.text}</span>{:else}{part.text}{/if}{/each}</mark>
            {:else}
              <span>{seg.text}</span>
            {/if}
          {/each}
        </div>

        {#if testResult.matches.length > 0}
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Match</th>
                  <th>At</th>
                  <th>Groups</th>
                </tr>
              </thead>
              <tbody>
                {#each testResult.matches.slice(0, 50) as m (m.ordinal)}
                  <tr data-testid="rx-match-row">
                    <td>{m.ordinal + 1}</td>
                    <td class="mono">{m.text}</td>
                    <td class="muted">{m.start}–{m.end}</td>
                    <td class="mono groups">
                      {#if m.groups.length === 0}
                        <span class="muted">—</span>
                      {:else}
                        {#each m.groups as g (g.number)}
                          <span
                            class="group"
                            style={g.value !== null ? `background: ${groupColor(g.number)}` : ''}
                          >{groupLabel(g)}: {g.value ?? '∅'}</span>
                        {/each}
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          {#if testResult.matches.length > 50}
            <p class="muted small">Showing the first 50 of {testResult.matches.length}{testResult.truncated ? '+' : ''} matches.</p>
          {:else if testResult.truncated}
            <p class="muted small">Stopped after {MAX_MATCHES} matches.</p>
          {/if}
        {/if}
      {:else}
        <p class="muted small">Fix the pattern above to test it.</p>
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

  <Card title="Symbol reference">
    <div class="stack">
      <div>
        <label for="rx-ref-filter">Filter</label>
        <input
          id="rx-ref-filter"
          data-testid="rx-ref-filter"
          type="text"
          placeholder="e.g. \d, boundary, lookahead…"
          bind:value={refQuery}
        />
      </div>
      {#if refGroups.length === 0}
        <p class="muted small">Nothing matches that filter.</p>
      {/if}
      {#each refGroups as group (group.category)}
        <div>
          <h3 class="eyebrow ref-heading">{group.category}</h3>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Meaning</th>
                  <th>Example</th>
                </tr>
              </thead>
              <tbody>
                {#each group.entries as entry (entry.token)}
                  <tr data-testid="rx-ref-row">
                    <td class="mono token">{entry.token}</td>
                    <td>{entry.meaning}</td>
                    <td class="muted example">{entry.example}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </div>
      {/each}
    </div>
  </Card>

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

  .small {
    font-size: var(--font-size-sm);
  }

  .engine-note {
    font-weight: 400;
  }

  .highlighted {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    border: 1px solid var(--border-color);
    background: var(--bg-color);
    padding: var(--space-3);
    font-size: var(--font-size-sm);
  }

  /* The primary/on-primary pair is the design system's guaranteed-AA combo. */
  .highlighted mark {
    background: var(--color-primary);
    color: var(--color-on-primary);
    border-radius: 2px;
    padding: 0 1px;
  }

  /* Group chips and in-match spans share fixed light backgrounds; near-black
     ink keeps them AA-readable on both themes. */
  .groups .group {
    display: inline-block;
    margin-right: var(--space-2);
    background: var(--color-primary-soft);
    padding: 0 var(--space-1);
    border-radius: 2px;
  }

  .groups .group[style] {
    color: #10141c;
  }

  .highlighted .grp {
    color: #10141c;
    border-radius: 2px;
  }

  .ref-heading {
    margin-bottom: var(--space-2);
  }

  .token {
    white-space: nowrap;
  }

  .example {
    font-size: var(--font-size-sm);
  }
</style>
