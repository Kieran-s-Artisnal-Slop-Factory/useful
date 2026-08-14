<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * "How to do it by hand" disclosure (plan §4.1.4/§4.2.1.4). A native
   * <details>/<summary>, so keyboard toggling (Enter/Space on the focused
   * summary) and the accessibility tree come for free.
   */
  let {
    summary,
    children,
    testid = 'explainer',
  }: {
    summary: string;
    children: Snippet;
    testid?: string;
  } = $props();
</script>

<details class="explainer" data-testid={testid}>
  <summary>{summary}</summary>
  <div class="body">
    {@render children()}
  </div>
</details>

<style>
  .explainer {
    border: 1px dashed var(--border-strong-color);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--surface-color) 88%, transparent);
  }

  summary {
    cursor: pointer;
    padding: var(--space-2) var(--space-3);
    font-size: var(--font-size-sm);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-muted-color);
    list-style-position: inside;
  }

  summary:hover {
    color: var(--text-color);
  }

  .explainer[open] summary {
    border-bottom: 1px dashed var(--border-color);
    color: var(--text-color);
  }

  .body {
    padding: var(--space-3);
    font-size: var(--font-size-sm);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .body :global(code) {
    background: var(--color-primary-soft);
    padding: 0 var(--space-1);
  }
</style>
