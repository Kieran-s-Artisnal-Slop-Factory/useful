<script lang="ts">
  import { allFormats, parseCssColor, rgbToHex, setAlpha } from '../lib/gen/color';

  /**
   * A CSS color input: free-form text (any CSS spelling) with a native color
   * picker swatch beside it, kept in sync both ways. The picker always shows
   * the RESOLVED color — falling back to `fallback` (e.g. a derived value)
   * when the text is empty or unparseable — and picking writes hex back into
   * the text. The text input carries the given testid; the picker appends
   * `-pick`.
   *
   * Alpha is opt-in (`alpha`), because a native `<input type="color">` cannot
   * represent it: with the prop on, a slider edits the alpha channel through
   * `setAlpha` (which re-emits in the spelling the user typed) and the picker
   * PRESERVES the current alpha instead of flattening it. With it off the
   * component behaves exactly as it always has, down to the DOM — the six
   * existing callers are unaffected.
   */
  let {
    value = $bindable(''),
    id,
    testid,
    placeholder = '',
    ariaLabel,
    /** Picker color when the text doesn't resolve (derived/auto values). */
    fallback = '#000000',
    /** Show an alpha slider and keep alpha through a picker change. */
    alpha = false,
    /** Show a preview swatch over a checkerboard (honest about translucency). */
    showSwatch = false,
    /**
     * Fired when an edit is FINALIZED (text `change`, picker closed) — not on
     * every keystroke/drag. Editors with undo/save stacks hook this; plain
     * live previews can ignore it and just bind `value`.
     */
    oncommit,
  }: {
    value?: string;
    id?: string;
    testid: string;
    placeholder?: string;
    ariaLabel?: string;
    fallback?: string;
    alpha?: boolean;
    showSwatch?: boolean;
    oncommit?: () => void;
  } = $props();

  let parsed = $derived(parseCssColor(value));
  let pickerValue = $derived(parsed ? rgbToHex(parsed.rgb) : fallback);
  let invalid = $derived(value.trim().length > 0 && parsed === null);
  /** Percent for the slider; an unresolved color reads as fully opaque. */
  let alphaPercent = $derived(Math.round((parsed?.alpha ?? 1) * 100));
  /** The resolved color INCLUDING alpha, for the swatch. */
  let swatchColor = $derived(parsed ? allFormats(parsed).rgb : fallback);

  /** Picking replaces the color but keeps whatever alpha was already set. */
  function onPick(hex: string) {
    value = alpha ? setAlpha(hex, parsed?.alpha ?? 1) : hex;
  }

  /** Dragging the slider edits alpha in place; an empty field starts from the picker's color. */
  function onAlpha(percent: number) {
    value = setAlpha(value.trim().length > 0 ? value : pickerValue, percent / 100);
  }
</script>

<div class="color-field">
  <input
    {id}
    data-testid={testid}
    type="text"
    class="mono"
    autocomplete="off"
    spellcheck="false"
    {placeholder}
    aria-label={ariaLabel}
    aria-invalid={invalid}
    bind:value
    onchange={() => oncommit?.()}
  />
  {#if showSwatch}
    <span class="swatch checkerboard" data-testid={testid + '-swatch'} aria-hidden="true">
      <span class="swatch-fill" style:background={swatchColor}></span>
    </span>
  {/if}
  <input
    type="color"
    data-testid={testid + '-pick'}
    value={pickerValue}
    aria-label={(ariaLabel ?? 'Color') + ' picker'}
    oninput={(e) => onPick(e.currentTarget.value)}
    onchange={() => oncommit?.()}
  />
  {#if alpha}
    <div class="alpha-row">
      <input
        type="range"
        min="0"
        max="100"
        step="1"
        data-testid={testid + '-alpha'}
        value={alphaPercent}
        aria-label={(ariaLabel ?? 'Color') + ' opacity percent'}
        oninput={(e) => onAlpha(Number(e.currentTarget.value))}
        onchange={() => oncommit?.()}
      />
      <span class="alpha-value mono">{alphaPercent}%</span>
    </div>
  {/if}
</div>

<style>
  .color-field {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: stretch;
  }

  .color-field input[type='text'] {
    flex: 1 1 auto;
    min-width: 0;
  }

  .mono {
    font-family: var(--font-mono);
  }

  input[type='text'][aria-invalid='true'] {
    border-color: var(--color-danger);
  }

  input[type='color'] {
    flex: none;
    width: 2.9rem;
    height: auto;
    padding: 2px;
    cursor: pointer;
  }

  .swatch {
    flex: none;
    width: 2.9rem;
    border: 1.5px solid var(--border-strong-color);
    /* The checkerboard shows through whatever alpha the color carries. */
    display: block;
  }

  .swatch-fill {
    display: block;
    width: 100%;
    height: 100%;
  }

  /* Full-width row under the field — the base layout above is untouched. */
  .alpha-row {
    flex: 1 0 100%;
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }

  .alpha-row input[type='range'] {
    flex: 1 1 auto;
    min-width: 0;
  }

  .alpha-value {
    flex: none;
    min-width: 3.5ch;
    text-align: right;
    font-size: var(--font-size-sm);
    color: var(--text-muted-color);
  }
</style>
