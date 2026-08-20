<script lang="ts">
  /**
   * One row of the filter builder: column, operator, and however many value
   * inputs that operator needs (none for `is true`, one for most, two for
   * `is between`).
   *
   * The input is chosen from the column *and* the operator, not the column
   * alone: `age is 30` wants a number spinner, but `age is any of 30, 40`
   * wants free text, and `email contains` wants text rather than an
   * `type="email"` field that would reject a fragment like `@example`.
   *
   * Nothing is edited in place — every change emits a new condition, so the
   * whole filter tree stays immutable and comparable.
   */
  import {
    operatorDef,
    operatorsFor,
    type Condition,
    type OperatorId,
  } from '../../lib/table/filter';
  import type { Column } from '../../lib/table/types';

  let {
    condition,
    columns,
    testid,
    onChange,
    onRemove,
  }: {
    condition: Condition;
    columns: Column[];
    /** Test-id prefix from the parent — one grid's rows must not collide with another's. */
    testid: string;
    onChange: (next: Condition) => void;
    onRemove: () => void;
  } = $props();

  const column = $derived(columns.find((c) => c.key === condition.column) ?? columns[0]);
  const operators = $derived(column ? operatorsFor(column.kind) : []);
  const def = $derived(operatorDef(condition.op));
  const arity = $derived(def?.arity ?? 1);

  /** Operators that match text fragments or lists, whatever the column is. */
  const TEXTUAL = new Set<OperatorId>([
    'contains',
    'notContains',
    'startsWith',
    'endsWith',
    'matches',
    'anyOf',
    'noneOf',
  ]);

  const inputType = $derived.by(() => {
    if (!column || TEXTUAL.has(condition.op)) return 'text';
    switch (column.type) {
      case 'int':
      case 'float':
      case 'currency':
      case 'percent':
        return 'number';
      case 'date':
        return 'date';
      case 'datetime':
        return 'datetime-local';
      case 'time':
        return 'time';
      default:
        return 'text';
    }
  });

  /** An enum with a fixed list gets a dropdown instead of a free-text box. */
  const asSelect = $derived(
    column?.type === 'enum' && column.options.length > 0 && !TEXTUAL.has(condition.op)
  );

  const placeholder = $derived(
    condition.op === 'anyOf' || condition.op === 'noneOf'
      ? 'comma, separated, values'
      : condition.op === 'matches'
        ? 'regular expression'
        : 'value'
  );

  function pickColumn(key: string) {
    const next = columns.find((c) => c.key === key);
    if (!next) return;
    // Keep the operator when the new column still supports it, so retargeting
    // "contains foo" from one text column to another doesn't lose the work.
    const keep = operatorsFor(next.kind).some((op) => op.id === condition.op);
    onChange({
      ...condition,
      column: key,
      op: keep ? condition.op : (operatorsFor(next.kind)[0]?.id ?? 'eq'),
      value: keep ? condition.value : '',
      value2: keep ? condition.value2 : '',
    });
  }
</script>

<div class="condition">
  <label class="field">
    <span class="visually-hidden">Column</span>
    <select
      data-testid={testid + '-column'}
      value={condition.column}
      onchange={(e) => pickColumn(e.currentTarget.value)}
      aria-label="Column"
    >
      {#each columns as option (option.key)}
        <option value={option.key}>{option.label}</option>
      {/each}
    </select>
  </label>

  <label class="field">
    <span class="visually-hidden">Operator</span>
    <select
      data-testid={testid + '-operator'}
      value={condition.op}
      onchange={(e) => onChange({ ...condition, op: e.currentTarget.value as OperatorId })}
      aria-label="Operator"
    >
      {#each operators as option (option.id)}
        <option value={option.id}>{option.label}</option>
      {/each}
    </select>
  </label>

  {#if arity > 0}
    <label class="field value">
      <span class="visually-hidden">Value</span>
      {#if asSelect && column}
        <select
          data-testid={testid + '-value'}
          value={String(condition.value ?? '')}
          onchange={(e) => onChange({ ...condition, value: e.currentTarget.value })}
          aria-label="Value"
        >
          <option value="">Choose…</option>
          {#each column.options as option (option)}
            <option value={option}>{option}</option>
          {/each}
        </select>
      {:else}
        <input
          data-testid={testid + '-value'}
          type={inputType}
          value={String(condition.value ?? '')}
          {placeholder}
          oninput={(e) => onChange({ ...condition, value: e.currentTarget.value })}
          aria-label="Value"
        />
      {/if}
    </label>
  {/if}

  {#if arity === 2}
    <span class="joiner">and</span>
    <label class="field value">
      <span class="visually-hidden">Upper value</span>
      <input
        data-testid={testid + '-value2'}
        type={inputType}
        value={String(condition.value2 ?? '')}
        placeholder="value"
        oninput={(e) => onChange({ ...condition, value2: e.currentTarget.value })}
        aria-label="Upper value"
      />
    </label>
  {/if}

  <button
    type="button"
    class="icon-btn"
    data-testid={testid + '-remove'}
    onclick={onRemove}
    aria-label="Remove this condition"
    title="Remove condition">×</button
  >
</div>

<style>
  .condition {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .field {
    margin: 0;
  }

  .field select,
  .field input {
    width: auto;
    min-width: 8rem;
    padding: var(--space-1) var(--space-2);
    font-size: var(--font-size-sm);
  }

  .value input,
  .value select {
    min-width: 10rem;
  }

  .joiner {
    font-size: var(--font-size-sm);
    color: var(--text-muted-color);
  }

  .icon-btn {
    border: 1px solid transparent;
    background: none;
    color: var(--text-muted-color);
    border-radius: var(--radius-sm);
    cursor: pointer;
    line-height: 1;
    padding: var(--space-1) var(--space-2);
    font-size: var(--font-size-lg);
  }

  .icon-btn:hover {
    border-color: var(--color-danger);
    color: var(--color-danger);
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
</style>
