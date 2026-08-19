<script lang="ts">
  import { DAY_NAMES, type RecurDraft } from '../../lib/scheduler/recurDraft';

  /**
   * The repeat editor, shared by TODOs and events so both kinds of recurrence
   * read and behave the same. It owns no state and no conversion: the parent
   * keeps a `RecurDraft` (see lib/scheduler/recurDraft.ts) and binds it here.
   */
  let {
    draft = $bindable(),
    /** Prefix for ids and test ids, e.g. 'todo' or 'event'. */
    idPrefix,
  }: {
    draft: RecurDraft;
    idPrefix: string;
  } = $props();
</script>

<div>
  <label for={`${idPrefix}-recur`}>Repeats</label>
  <select id={`${idPrefix}-recur`} data-testid={`${idPrefix}-recur`} bind:value={draft.recur}>
    <option value="none">never</option>
    <option value="every">every N…</option>
    <option value="weekdays">weekly on…</option>
  </select>
</div>
{#if draft.recur === 'every'}
  <div>
    <label for={`${idPrefix}-every-n`}>Every</label>
    <div class="row">
      <input
        id={`${idPrefix}-every-n`}
        data-testid={`${idPrefix}-every-n`}
        class="num"
        type="number"
        min="1"
        max="365"
        bind:value={draft.every_interval}
      />
      <select bind:value={draft.every_unit} data-testid={`${idPrefix}-every-unit`} aria-label="Unit">
        <option value="days">days</option>
        <option value="weeks">weeks</option>
        <option value="months">months</option>
      </select>
    </div>
  </div>
{:else if draft.recur === 'weekdays'}
  <div class="row" role="group" aria-label="Weekdays">
    {#each DAY_NAMES as name, day (day)}
      <label class="check">
        <input
          type="checkbox"
          checked={draft.weekdays.includes(day)}
          onchange={(e) => {
            draft.weekdays = e.currentTarget.checked
              ? [...draft.weekdays, day]
              : draft.weekdays.filter((d) => d !== day);
          }}
        />
        {name}
      </label>
    {/each}
  </div>
{/if}
{#if draft.recur !== 'none'}
  <div>
    <label for={`${idPrefix}-until`}>Until (optional)</label>
    <input
      id={`${idPrefix}-until`}
      data-testid={`${idPrefix}-until`}
      type="date"
      bind:value={draft.until}
    />
  </div>
{/if}

<style>
  .num {
    width: 5rem;
  }

  .check {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    white-space: nowrap;
  }
</style>
