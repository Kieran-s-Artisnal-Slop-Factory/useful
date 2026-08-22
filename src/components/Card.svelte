<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * The app's one grouping block, with two opt-ins over the plain card.
   *
   * `heading` replaces the <h2> for a card whose header is not a fixed label —
   * the notebook's, where the header IS the note's title and is edited in
   * place. Every other card passes `title` and keeps the title-block voice
   * below; the snippet brings its own type, because an editable title should
   * not be tiny uppercase lettering.
   *
   * `collapsible` turns the card into a native <details>: the header becomes
   * its <summary>, so opening and closing it — by click, by Enter, by Space,
   * by the browser's own find-in-page — costs no JavaScript and no ARIA. It
   * is a <details> rather than an `{#if}` on purpose: a closed section keeps
   * its content in the DOM, so anything already rendered inside stays
   * rendered, and nothing is recomputed on the way back open.
   *
   * `open` seeds the initial state only. Nothing here remembers it: a
   * disclosure is a glance, not a preference, and this app writes nothing on
   * page load.
   */
  let {
    title = '',
    heading,
    children,
    actions,
    collapsible = false,
    open = true,
    testid,
  }: {
    title?: string;
    heading?: Snippet;
    children: Snippet;
    actions?: Snippet;
    collapsible?: boolean;
    open?: boolean;
    testid?: string;
  } = $props();
</script>

{#if collapsible}
  <details class="card" {open} data-testid={testid}>
    <!-- The <h2> lives INSIDE the summary rather than instead of it: the page
         keeps its heading outline (h1 → h2 → h3), and the disclosure keeps its
         own role. -->
    <summary class="card-summary">
      <!-- The marker is a real element, hidden from assistive tech, rather
           than generated content on the <summary>: CSS content IS part of an
           element's accessible name, so a bare ::before would have every
           group announce itself as "▸ Passwords" and rename itself on open. -->
      <span class="marker" aria-hidden="true"></span>
      {#if heading}
        {@render heading()}
      {:else if title}<h2>{title}</h2>{/if}
      {#if actions}<div class="actions">{@render actions()}</div>{/if}
    </summary>
    <div class="body">
      {@render children()}
    </div>
  </details>
{:else}
  <section class="card" data-testid={testid}>
    {#if title || heading || actions}
      <header class:snippet-heading={Boolean(heading)}>
        {#if heading}
          {@render heading()}
        {:else if title}<h2>{title}</h2>{/if}
        {#if actions}<div class="actions">{@render actions()}</div>{/if}
      </header>
    {/if}
    <div class="body">
      {@render children()}
    </div>
  </section>
{/if}

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

  header,
  .card-summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--border-color);
  }

  /* The disclosure triangle is drawn as text, the same one the notebook's tree
     turns — a marker the theme controls, rather than the browser's. `display:
     flex` on a <summary> already removes the default marker in Chromium, but
     Safari needs its own pseudo-element told to go. */
  .card-summary {
    cursor: pointer;
    list-style: none;
    /* The triangle belongs beside the title, not at the far edge, so the
       summary packs from the left and the actions claim what is left. */
    justify-content: flex-start;
  }

  .card-summary .actions {
    margin-left: auto;
  }

  .card-summary::-webkit-details-marker {
    display: none;
  }

  .marker {
    color: var(--text-muted-color);
    /* The arm of the triangle is the only thing that moves; reserving its box
       stops the header text stepping sideways as it turns. */
    width: 1ch;
    flex: none;
  }

  .marker::before {
    content: '▸';
  }

  details[open] > .card-summary .marker::before {
    content: '▾';
  }

  .card-summary:hover .marker {
    color: var(--color-primary);
  }

  /* A closed card is a title block on its own: no rule under it to hang. */
  details:not([open]) > .card-summary {
    border-bottom: none;
  }

  /* A snippet heading brings a control, not a word: it is elastic where an
     <h2> is short, so the actions are allowed onto a second line rather than
     being crushed. Gated on the snippet, so every card that names itself with
     `title` keeps the single-line header exactly as drawn. */
  header.snippet-heading {
    flex-wrap: wrap;
  }

  h2 {
    /* Title-block voice: the card header is the drawing's field label. The
       rule is scoped to Card's own <h2>, so a `heading` snippet — authored in
       the calling component — cannot pick this voice up by accident. */
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
