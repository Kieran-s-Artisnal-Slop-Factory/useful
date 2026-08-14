<script lang="ts">
  import { onMount } from 'svelte';
  import { getSingleton } from '../../lib/db/repo';
  import type { Preferences } from '../../lib/db/types';
  import Card from '../Card.svelte';

  // `preferences` is a singleton row of per-tool defaults, written by the
  // tools themselves ("remember these settings"). This page only shows what
  // has been remembered — rendering never writes (the data suite asserts a
  // page load leaves the database byte-identical).
  const SYNC_FIELDS = new Set(['id', 'updated_at', 'deleted_at', 'server_seq', 'field_updated_at']);

  let loading = $state(true);
  let fields: [string, unknown][] = $state([]);

  onMount(async () => {
    const row = await getSingleton<Preferences>('preferences');
    fields = row
      ? Object.entries(row).filter(([key]) => !SYNC_FIELDS.has(key))
      : [];
    loading = false;
  });
</script>

<div class="page-header">
  <h1>Preferences</h1>
</div>

<Card title="Remembered defaults">
  {#if loading}
    <p class="muted">Loading…</p>
  {:else if fields.length === 0}
    <p class="muted" data-testid="preferences-empty">
      Nothing remembered yet. As tools arrive, the defaults you save in them
      (timer completion settings, last-used values, …) show up here.
    </p>
  {:else}
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Preference</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {#each fields as [key, value] (key)}
            <tr data-testid="preferences-field" data-field={key}>
              <td class="mono">{key}</td>
              <td class="mono">{JSON.stringify(value)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</Card>

<style>
  .mono {
    font-size: var(--font-size-sm);
    overflow-wrap: anywhere;
  }
</style>
