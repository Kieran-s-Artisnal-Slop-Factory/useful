<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    title = '',
    children,
    actions,
  }: {
    title?: string;
    children: Snippet;
    actions?: Snippet;
  } = $props();
</script>

<section class="card">
  {#if title || actions}
    <header>
      {#if title}<h3>{title}</h3>{/if}
      {#if actions}<div class="actions">{@render actions()}</div>{/if}
    </header>
  {/if}
  <div class="body">
    {@render children()}
  </div>
</section>

<style>
  .card {
    /* Corner registration marks: four L-brackets drawn with positioned
       background gradients (two 10px arms per corner) over the surface. */
    --tick: var(--border-strong-color);
    background-color: var(--surface-color);
    background-image:
      linear-gradient(var(--tick), var(--tick)), linear-gradient(var(--tick), var(--tick)),
      linear-gradient(var(--tick), var(--tick)), linear-gradient(var(--tick), var(--tick)),
      linear-gradient(var(--tick), var(--tick)), linear-gradient(var(--tick), var(--tick)),
      linear-gradient(var(--tick), var(--tick)), linear-gradient(var(--tick), var(--tick));
    background-repeat: no-repeat;
    background-size:
      10px 1.5px, 1.5px 10px,
      10px 1.5px, 1.5px 10px,
      10px 1.5px, 1.5px 10px,
      10px 1.5px, 1.5px 10px;
    background-position:
      top left, top left,
      top right, top right,
      bottom left, bottom left,
      bottom right, bottom right;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-1);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--border-color);
  }

  h3 {
    /* Title-block voice: the card header is the drawing's field label. */
    font-size: var(--font-size-sm);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
  }

  .actions {
    display: flex;
    gap: var(--space-2);
  }

  .body {
    padding: var(--space-4);
  }
</style>
