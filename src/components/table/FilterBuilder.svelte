<script lang="ts">
  /**
   * The filter tree editor — one group, plus a nested copy of itself for each
   * child group. That recursion is the whole feature: nesting is what lets
   * `A AND (B OR C)` exist, which a flat list of conditions and a single
   * AND/OR switch can never express.
   *
   * Each level owns nothing. It receives its node and emits a replacement
   * through `onChange`, and the parent splices that into its own children and
   * emits upward in turn — so the root ends up with a brand-new tree and no
   * level ever has to know where it sits.
   */
  import Self from './FilterBuilder.svelte';
  import FilterCondition from './FilterCondition.svelte';
  import {
    emptyGroup,
    newCondition,
    type Combinator,
    type FilterGroup,
    type FilterNode,
  } from '../../lib/table/filter';
  import type { Column } from '../../lib/table/types';

  let {
    node,
    columns,
    testid,
    depth = 0,
    onChange,
    onRemove = undefined,
  }: {
    node: FilterGroup;
    columns: Column[];
    /** Test-id prefix; children extend it with their own node id. */
    testid: string;
    /** Nesting level — drives the indent and the alternating tint. */
    depth?: number;
    onChange: (next: FilterGroup) => void;
    /** Absent at the root, which can't be removed. */
    onRemove?: () => void;
  } = $props();

  const replaceChild = (index: number, child: FilterNode) =>
    onChange({ ...node, children: node.children.map((c, i) => (i === index ? child : c)) });

  const removeChild = (index: number) =>
    onChange({ ...node, children: node.children.filter((_, i) => i !== index) });

  const append = (child: FilterNode) =>
    onChange({ ...node, children: [...node.children, child] });

  const setCombinator = (combinator: Combinator) => onChange({ ...node, combinator });
</script>

<div class="group" style="--depth: {depth}">
  <div class="row group-head">
    <div class="seg" role="group" aria-label="Match all or any">
      <button
        type="button"
        class="seg-btn"
        class:on={node.combinator === 'and'}
        data-testid={testid + '-and'}
        aria-pressed={node.combinator === 'and'}
        onclick={() => setCombinator('and')}>AND</button
      >
      <button
        type="button"
        class="seg-btn"
        class:on={node.combinator === 'or'}
        data-testid={testid + '-or'}
        aria-pressed={node.combinator === 'or'}
        onclick={() => setCombinator('or')}>OR</button
      >
    </div>
    <span class="muted hint">
      {node.combinator === 'and' ? 'every' : 'any'} condition below
    </span>
    <div class="spacer"></div>
    <button
      type="button"
      class="btn btn-sm"
      data-testid={testid + '-add-condition'}
      onclick={() => columns[0] && append(newCondition(columns[0]))}
      disabled={columns.length === 0}>+ Condition</button
    >
    <!-- A nested group starts on the opposite combinator: that's the only
         reason to nest one, and it saves a click every time. -->
    <button
      type="button"
      class="btn btn-sm"
      data-testid={testid + '-add-group'}
      onclick={() => append(emptyGroup(node.combinator === 'and' ? 'or' : 'and'))}
      >+ Group</button
    >
    {#if onRemove}
      <button
        type="button"
        class="btn btn-sm btn-danger"
        data-testid={testid + '-remove-group'}
        onclick={onRemove}>Remove group</button
      >
    {/if}
  </div>

  {#if node.children.length === 0}
    <p class="muted empty">
      Nothing here yet — add a condition, or a group to nest the opposite of
      <strong>{node.combinator === 'and' ? 'AND' : 'OR'}</strong> inside it.
    </p>
  {:else}
    <ul class="children">
      {#each node.children as child, index (child.id)}
        <li>
          <span class="lead" aria-hidden="true">
            {index === 0 ? 'where' : node.combinator === 'and' ? 'and' : 'or'}
          </span>
          <div class="child-body">
            {#if child.kind === 'condition'}
              <FilterCondition
                condition={child}
                {columns}
                testid={`${testid}-${child.id}`}
                onChange={(next) => replaceChild(index, next)}
                onRemove={() => removeChild(index)}
              />
            {:else}
              <Self
                node={child}
                {columns}
                testid={`${testid}-${child.id}`}
                depth={depth + 1}
                onChange={(next) => replaceChild(index, next)}
                onRemove={() => removeChild(index)}
              />
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .group {
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: var(--space-3);
    /* Each level of nesting tints a little further from the page, so the
       shape of the tree is readable without counting brackets. */
    background: color-mix(
      in srgb,
      var(--surface-raised-color) calc(min(var(--depth), 3) * 28%),
      var(--surface-color)
    );
  }

  .group-head {
    gap: var(--space-2);
  }

  .spacer {
    flex: 1;
  }

  .hint {
    font-size: var(--font-size-sm);
  }

  .empty {
    font-size: var(--font-size-sm);
    margin-top: var(--space-2);
  }

  .children {
    list-style: none;
    padding: 0;
    margin: var(--space-3) 0 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .children li {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
  }

  .lead {
    flex: 0 0 3.25rem;
    text-align: right;
    font-size: var(--font-size-sm);
    font-weight: 700;
    color: var(--text-muted-color);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding-top: 0.4em;
  }

  .child-body {
    flex: 1;
    min-width: 0;
  }

  .seg {
    display: inline-flex;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .seg-btn {
    border: none;
    background: var(--surface-color);
    color: var(--text-muted-color);
    padding: var(--space-1) var(--space-3);
    font: inherit;
    font-size: var(--font-size-sm);
    font-weight: 700;
    cursor: pointer;
  }

  .seg-btn + .seg-btn {
    border-left: 1px solid var(--border-color);
  }

  .seg-btn.on {
    background: var(--color-primary-soft);
    color: var(--color-primary-strong);
  }

  .muted {
    color: var(--text-muted-color);
  }
</style>
