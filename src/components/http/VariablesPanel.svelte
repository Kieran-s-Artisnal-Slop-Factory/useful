<script lang="ts">
  /**
   * The pre-send panel: every `{{placeholder}}` in the request, where it
   * resolved from, and what it will become (0.4.0 plan, Phase 4, item 3).
   *
   * Two rules shape it.
   *
   * **A missing variable is an error that blocks the send**, listed by name
   * and by the field it was found in. The failure mode this prevents is a
   * request that goes out carrying `Bearer ` and comes back 401, with nothing
   * anywhere saying the token was never there.
   *
   * **A secret is never displayed, even here.** The masking happens in
   * [resolve.ts](../../lib/http/resolve.ts), not in this file — a preview
   * assembled in a component is a preview that a second component will
   * eventually assemble differently, and one of those two will show a key.
   */
  import { MASK } from '../../lib/http/secrets';
  import type { ResolveResult } from '../../lib/http/resolve';
  import type { ScopeOrigin } from '../../lib/http/env';
  import type { HttpRequest } from '../../lib/http/model';

  let {
    resolved,
    preview,
    /** Names the chain could supply, for the "did you mean" nudge. */
    available,
    /**
     * Take the reader to the row this value is edited in. Only offered when
     * the resolution has an `origin` — a flow's step scope has no row.
     */
    onJump,
  }: {
    resolved: ResolveResult;
    /** The request as it will go out, secrets masked. */
    preview: HttpRequest;
    available: string[];
    onJump: (name: string, origin: ScopeOrigin) => void;
  } = $props();

  const used = $derived(resolved.resolutions);
  const problems = $derived(resolved.problems);
  const enabledHeaders = $derived(preview.headers.filter((row) => row.enabled && row.name.trim()));
  /**
   * Placeholders that DID resolve, to nothing.
   *
   * A variable created and left blank is legal, so it does not block the
   * send — the same call the forbidden-header warning makes. But it produces
   * exactly the request decision 2 exists to prevent, so it is called out
   * loudly here and marked in the table rather than blending in as a row with
   * an empty-looking value cell.
   */
  const blanks = $derived(used.filter((item) => item.value === ''));
</script>

{#if used.length === 0 && problems.length === 0}
  <p class="muted small" data-testid="hp-vars-none">
    This request uses no <code>{'{{variables}}'}</code>. Put one anywhere in the URL, a header
    value or the body and it will be resolved here before anything is sent.
  </p>
{:else}
  {#if problems.length > 0}
    <p class="error" data-testid="hp-vars-blocked" role="alert">
      {problems.length}
      {problems.length === 1 ? 'placeholder' : 'placeholders'} could not be resolved, so nothing
      will be sent. An unresolved name is never treated as an empty string — that is how a
      request goes out with half a header and no explanation.
    </p>
    <ul class="problems" data-testid="hp-vars-problems">
      {#each problems as problem, i (i)}
        <li>
          <span class="where">{problem.field.label}</span>
          <code>{problem.text}</code>
          <span>{problem.message}</span>
        </li>
      {/each}
    </ul>
    {#if available.length > 0}
      <p class="muted small" data-testid="hp-vars-available">
        In scope right now: {#each available as name, i (name)}<code>{name}</code>{i <
          available.length - 1
            ? ', '
            : ''}{/each}
      </p>
    {:else}
      <p class="muted small" data-testid="hp-vars-available">
        Nothing is in scope yet — add a variable or a secret below.
      </p>
    {/if}
  {/if}

  {#if blanks.length > 0}
    <p class="warn" data-testid="hp-vars-blank" role="status">
      {blanks.length}
      {blanks.length === 1 ? 'variable resolves' : 'variables resolve'} to nothing:
      {#each blanks as item, i (i)}<code>{item.path}</code>{i < blanks.length - 1
          ? ', '
          : ''}{/each}. An empty value is a real value, so the emptiness does not block the
      send by itself — which means the request can go out with a blank where that should be,
      and a blank is what produces a 401 with no explanation. Fill them in below.
    </p>
  {/if}

  {#if used.length > 0}
    <div class="table-wrap">
      <table class="data-table" data-testid="hp-vars-table">
        <thead>
          <tr>
            <th>Placeholder</th>
            <th>In</th>
            <th>Resolved from</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {#each used as item, i (i)}
            <tr data-testid="hp-vars-row">
              <td class="mono">
                {#if item.origin}
                  <!-- The root name, not the path: `user.id` and `user.name`
                       are two placeholders and one row to go and look at. -->
                  <button
                    class="jump"
                    data-testid={'hp-vars-jump-' + item.name}
                    onclick={() => onJump(item.name, item.origin!)}
                    title={`Show where ${item.name} is set`}
                  >
                    {item.path}
                  </button>
                {:else}{item.path}{/if}
              </td>
              <td>{item.field.label}</td>
              <td data-testid="hp-vars-scope">{item.scope}</td>
              <td class="mono">
                {#if item.secret}
                  <span class="masked" data-testid="hp-vars-masked" title="A secret is never shown"
                    >{MASK}</span
                  >
                {:else if item.value === ''}
                  <span class="blank" data-testid="hp-vars-blank-cell">(empty)</span>
                {:else}{item.value}{/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  <details class="preview">
    <summary>What will actually be sent</summary>
    <p class="muted small">
      Resolved, with secret values masked. This is the request, not a rehearsal of it — the only
      difference between this and the bytes on the wire is the
      <span class="mono">{MASK}</span>.
    </p>
    <dl class="sent" data-testid="hp-vars-preview">
      <dt>URL</dt>
      <dd class="mono">{preview.method} {preview.url || '(empty)'}</dd>
      {#if enabledHeaders.length > 0}
        <dt>Headers</dt>
        <dd>
          <ul class="plain mono">
            {#each enabledHeaders as row, i (i)}
              <li>{row.name}: {row.value}</li>
            {/each}
          </ul>
        </dd>
      {/if}
      {#if preview.bodyKind !== 'none' && preview.bodyText.trim() !== ''}
        <dt>Body</dt>
        <dd><pre class="mono body">{preview.bodyText}</pre></dd>
      {/if}
    </dl>
  </details>
{/if}

<style>
  .mono {
    font-family: var(--font-mono);
  }

  .small {
    font-size: var(--font-size-sm);
  }

  .error {
    color: var(--color-danger);
    font-size: var(--font-size-sm);
    margin: 0 0 var(--space-2);
  }

  .problems {
    margin: 0 0 var(--space-3);
    padding-left: var(--space-4);
    font-size: var(--font-size-sm);
  }

  .problems li {
    margin-bottom: var(--space-1);
  }

  .where {
    color: var(--text-muted-color);
    margin-right: var(--space-2);
  }

  /* A link in behaviour, so it looks like one — but a button, because it
     moves focus within this page rather than going anywhere. */
  .jump {
    background: none;
    border: 0;
    padding: 0;
    font: inherit;
    color: var(--color-primary-strong);
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }

  .jump:hover {
    color: var(--color-primary);
  }

  .masked {
    letter-spacing: 0.1em;
    color: var(--text-muted-color);
  }

  /* Not colour alone: the cell says the word "(empty)", and the warning above
     the table names every one of them. */
  .blank {
    color: var(--color-warning);
    font-style: italic;
  }

  .warn {
    color: var(--color-warning);
    font-size: var(--font-size-sm);
    margin: 0 0 var(--space-2);
  }

  .preview {
    margin-top: var(--space-3);
  }

  .preview > summary {
    cursor: pointer;
    font-size: var(--font-size-sm);
    color: var(--text-muted-color);
  }

  .sent {
    display: grid;
    grid-template-columns: minmax(4rem, auto) 1fr;
    gap: var(--space-1) var(--space-3);
    font-size: var(--font-size-sm);
    margin: var(--space-2) 0 0;
  }

  .sent dt {
    color: var(--text-muted-color);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    font-size: var(--font-size-eyebrow);
    padding-top: 0.15em;
  }

  .sent dd {
    margin: 0;
    overflow-wrap: anywhere;
  }

  ul.plain {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .body {
    margin: 0;
    max-height: 12rem;
    overflow: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
