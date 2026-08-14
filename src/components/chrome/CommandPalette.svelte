<script lang="ts">
  import { navigate } from 'astro:transitions/client';
  import { href } from '../../lib/paths';
  import { searchRegistry, type ToolDef } from '../../lib/registry';

  let {
    opener = null,
    onclose,
  }: { opener?: HTMLElement | null; onclose: () => void } = $props();

  let query = $state('');
  let selected = $state(0);
  let input: HTMLInputElement | undefined = $state();

  const MAX_RESULTS = 10;
  let results: ToolDef[] = $derived(searchRegistry(query).slice(0, MAX_RESULTS));

  // Keep the selection on a real row as the result list shrinks and grows,
  // and keep the selected row scrolled into the list's viewport.
  $effect(() => {
    if (selected >= results.length) selected = Math.max(0, results.length - 1);
    const active = results[selected];
    if (active) {
      document.getElementById('palette-option-' + active.id)?.scrollIntoView({ block: 'nearest' });
    }
  });

  $effect(() => {
    input?.focus();
    // Focus returns to whichever element opened the palette (passed in by the
    // caller — Safari never focuses clicked buttons, so reading
    // document.activeElement here would record <body> for click-opens).
    return () => opener?.focus();
  });

  function close(): void {
    onclose();
  }

  function open(tool: ToolDef): void {
    close();
    navigate(href(tool.route));
  }

  // On the WRAPPER, not the input: keydown bubbles up from the input, and this
  // way the dialog keeps working even if focus ever ends up elsewhere in it.
  function onkeydown(e: KeyboardEvent): void {
    if (e.isComposing || e.keyCode === 229) return; // IME composition keys are the IME's
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // one Escape per layer — don't also close the drawer
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (results.length > 0) selected = (selected + 1) % results.length;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (results.length > 0) selected = (selected - 1 + results.length) % results.length;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const tool = results[selected];
      if (tool) open(tool);
    } else if (e.key === 'Tab') {
      // The dialog's only focusable control is the input; trap focus there.
      e.preventDefault();
    }
  }

  // Clicks on the dialog's non-interactive surface (list padding, empty rows)
  // must not blur the input — the keyboard handling above assumes focus stays
  // inside, and mousedown is what moves focus.
  function keepFocus(e: MouseEvent): void {
    if (e.target !== input) e.preventDefault();
  }
</script>

<div
  class="backdrop"
  role="presentation"
  {onkeydown}
  onclick={(e) => e.target === e.currentTarget && close()}
>
  <div class="palette" role="dialog" aria-modal="true" aria-label="Search tools" onmousedown={keepFocus}>
    <input
      bind:this={input}
      bind:value={query}
      data-testid="palette-input"
      type="text"
      role="combobox"
      aria-expanded="true"
      aria-controls="palette-results"
      aria-autocomplete="list"
      aria-activedescendant={results[selected] ? 'palette-option-' + results[selected].id : undefined}
      aria-label="Search tools"
      placeholder="Search tools…"
      autocomplete="off"
      spellcheck="false"
    />
    <span class="visually-hidden" role="status" aria-live="polite">
      {results.length === 1 ? '1 result' : results.length + ' results'}
    </span>
    <ul id="palette-results" role="listbox" aria-label="Tools">
      {#each results as tool, i (tool.id)}
        <!-- mousedown, not click: click fires after the input loses focus. -->
        <li
          id={'palette-option-' + tool.id}
          role="option"
          aria-selected={i === selected}
          class:selected={i === selected}
          data-testid="palette-option"
          onmouseenter={() => (selected = i)}
          onmousedown={(e) => {
            e.preventDefault();
            open(tool);
          }}
        >
          <span class="icon" aria-hidden="true">{tool.icon}</span>
          <span class="name">{tool.name}</span>
          <span class="desc">{tool.description}</span>
        </li>
      {:else}
        <li class="empty" role="option" aria-selected="false" aria-disabled="true">No matching tools</li>
      {/each}
    </ul>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgb(0 0 0 / 0.5);
    z-index: 50;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding: 10vh var(--space-4) var(--space-4);
  }

  .palette {
    width: min(34rem, 100%);
    background: var(--surface-raised-color);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-2);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  input {
    border: none;
    border-bottom: 1px solid var(--border-strong-color);
    border-radius: 0;
    background: transparent;
    padding: var(--space-4);
    font-size: var(--font-size-lg);
  }

  input:focus-visible {
    outline: none;
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: var(--space-2);
    max-height: 50vh;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  li {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
    padding: var(--space-3);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  li.selected {
    background: var(--color-primary-soft);
  }

  .icon {
    flex: none;
  }

  .name {
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .desc {
    color: var(--text-muted-color);
    font-size: var(--font-size-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .empty {
    padding: var(--space-4);
    color: var(--text-muted-color);
    cursor: default;
  }
</style>
