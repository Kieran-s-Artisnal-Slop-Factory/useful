<script lang="ts">
  /**
   * A thin Svelte wrapper around MathLive's `<math-field>`.
   *
   * Both libraries are `import()`ed here, not at module scope, so no other
   * route pays for them — 801 KB of editor and 2.53 MB of computer algebra. Three settings are load-bearing, and each was chosen
   * from a measurement rather than from the documentation:
   *
   * **`inlineShortcuts = {}`.** MathLive ships 259 text shortcuts, and any one
   * whose trigger appears inside a variable name fires mid-word and corrupts
   * the formula. Typing `sqrtish` produces `\mathrm{\sqrt{ish}}`, which does
   * not parse; typing `count*rate` produces `\mathrm{count\cdot rate}`, which
   * does not either. In a tool whose whole premise is multi-letter named
   * variables, the built-ins are actively hostile. LaTeX commands typed with a
   * backslash still work, and the virtual keyboard still offers symbols.
   * The assignment has to happen AFTER the element is connected — before that
   * MathLive throws "Mathfield not mounted".
   *
   * **`onInlineShortcut` wraps a run of two or more letters in `\mathrm{}`.**
   * Without it `count` is implicit multiplication of five separate symbols.
   * Two or more, not one: `\mathrm{x}` on a single letter parses as the symbol
   * `x_upright`, quietly renaming the variable.
   *
   * **`soundsDirectory = null`** skips 227 KB of keypress `.wav` files. A
   * Playwright check asserts none is ever requested, including on the "plonk"
   * path an invalid keystroke takes.
   *
   * Fonts arrive through a stylesheet rather than `fontsDirectory`, which is
   * what lets the browser fetch faces on demand — two rather than all twenty.
   */
  import { onDestroy, onMount } from 'svelte';
  import { ensureFontCss } from '../lib/math/fonts';

  let {
    value = $bindable(''),
    testid = 'mathfield',
    ariaLabel = 'Formula',
    onchange = undefined,
  }: {
    value?: string;
    testid?: string;
    ariaLabel?: string;
    onchange?: (latex: string) => void;
  } = $props();

  let host: HTMLDivElement | undefined = $state();
  interface Field extends HTMLElement {
    value: string;
    inlineShortcuts: unknown;
    onInlineShortcut: (mf: unknown, symbol: string) => string;
    getValue(format: string): unknown;
    executeCommand(command: string | [string, ...unknown[]]): boolean;
  }
  let field: Field | undefined;
  let ready = $state(false);
  let error = $state<string | null>(null);
  let destroyed = false;
  /** Set while WE are writing `value` in, so the input handler does not echo. */
  let writing = false;

  /** Two or more letters, so a single letter is never renamed. */
  const IDENTIFIER = /^[a-zA-Z][a-zA-Z0-9]+$/;

  onMount(async () => {
    ensureFontCss();
    try {
      // The Compute Engine registers itself on a global that MathLive looks
      // up. Without this import `getValue('math-json')` silently returns an
      // empty expression — the library bundles no import of its own.
      await import('@cortex-js/compute-engine');
      const { MathfieldElement } = await import('mathlive');
      if (destroyed) return;

      MathfieldElement.soundsDirectory = null;
      MathfieldElement.fontsDirectory = null;

      const created = new MathfieldElement() as unknown as Field;
      created.setAttribute('data-testid', testid);
      created.setAttribute('aria-label', ariaLabel);
      created.onInlineShortcut = (_mf: unknown, symbol: string) =>
        IDENTIFIER.test(symbol) ? `\\mathrm{${symbol}}` : '';
      host?.append(created);
      // Only settable once connected.
      created.inlineShortcuts = {};
      created.value = value;
      created.addEventListener('input', () => {
        if (writing) return;
        value = created.value;
        onchange?.(created.value);
      });
      field = created;
      ready = true;
    } catch (err) {
      if (!destroyed) error = err instanceof Error ? err.message : 'The formula editor failed to load.';
    }
  });

  onDestroy(() => {
    destroyed = true;
  });

  // Push an external change in without bouncing it back out as an edit.
  $effect(() => {
    const next = value;
    if (!ready || !field || field.value === next) return;
    writing = true;
    field.value = next;
    writing = false;
  });

  /** The formula as MathJSON, straight from the field. */
  export function mathJson(): unknown {
    return ready && field ? field.getValue('math-json') : null;
  }

  export function focusField() {
    field?.focus();
  }

  /**
   * Put `latex` where the cursor is.
   *
   * Through the mathfield's own `insert` command rather than by splicing the
   * value string: only the field knows where the caret is, and rebuilding the
   * value would move it to the end and lose the selection. `#0` in the LaTeX
   * marks where the caret should land afterwards.
   */
  export function insert(latex: string) {
    if (!ready || !field) return;
    field.focus();
    field.executeCommand(['insert', latex, { focus: true, feedback: false, scrollIntoView: true }]);
    // The command mutates the field without firing `input`, so the change
    // would otherwise never reach the page's own state.
    value = field.value;
    onchange?.(field.value);
  }
</script>

<div class="mathfield" bind:this={host}>
  {#if !ready && !error}
    <p class="muted small" data-testid={testid + '-loading'}>Loading the formula editor…</p>
  {/if}
  {#if error}
    <p class="form-error" data-testid={testid + '-error'}>{error}</p>
  {/if}
</div>

<style>
  .mathfield {
    display: block;
  }

  /* The custom element is not in this component's markup, so it needs the
     global escape to be styled at all. */
  .mathfield :global(math-field) {
    display: block;
    width: 100%;
    padding: var(--space-2);
    border: 1px solid var(--border-color);
    background: var(--surface-color);
    color: var(--text-color);
    font-size: var(--font-size-lg);
  }

  .mathfield :global(math-field:focus-within) {
    border-color: var(--color-primary);
  }

  .muted {
    color: var(--text-muted-color);
  }

  .small {
    font-size: var(--font-size-sm);
  }
</style>
