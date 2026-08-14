<script lang="ts">
  import { parseCssColor, rgbToHex } from '../lib/gen/color';

  /**
   * A CSS color input: free-form text (any CSS spelling) with a native color
   * picker swatch beside it, kept in sync both ways. The picker always shows
   * the RESOLVED color — falling back to `fallback` (e.g. a derived value)
   * when the text is empty or unparseable — and picking writes hex back into
   * the text. The text input carries the given testid; the picker appends
   * `-pick`.
   */
  let {
    value = $bindable(''),
    id,
    testid,
    placeholder = '',
    ariaLabel,
    /** Picker color when the text doesn't resolve (derived/auto values). */
    fallback = '#000000',
  }: {
    value?: string;
    id?: string;
    testid: string;
    placeholder?: string;
    ariaLabel?: string;
    fallback?: string;
  } = $props();

  let parsed = $derived(parseCssColor(value));
  let pickerValue = $derived(parsed ? rgbToHex(parsed.rgb) : fallback);
  let invalid = $derived(value.trim().length > 0 && parsed === null);
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
  />
  <input
    type="color"
    data-testid={testid + '-pick'}
    value={pickerValue}
    aria-label={(ariaLabel ?? 'Color') + ' picker'}
    oninput={(e) => (value = e.currentTarget.value)}
  />
</div>

<style>
  .color-field {
    display: flex;
    gap: var(--space-2);
    align-items: stretch;
  }

  .color-field input[type='text'] {
    flex: 1 1 auto;
    min-width: 0;
  }

  .mono {
    font-family: var(--font-mono, ui-monospace, monospace);
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
</style>
