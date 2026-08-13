<script lang="ts">
  import { onMount } from 'svelte';
  import { all, patch, put, softDelete, withSyncFields } from '../../lib/db/repo';
  import type { Preferences, SyncFields } from '../../lib/db/types';
  import Card from '../Card.svelte';

  let loading = $state(true);
  let rows: Preferences[] = $state([]);


  let editingId: string | null = $state(null); // null = closed, '' = new row
  let formError: string | null = $state(null);
  let draft = $state(blankDraft());


  function blankDraft() {
    return {

    };
  }





  async function refresh() {
    rows = await all<Preferences>('preferences');


  }

  onMount(async () => {
    await refresh();
    loading = false;
  });

  function startCreate() {
    draft = blankDraft();

    formError = null;
    editingId = '';
  }

  function startEdit(row: Preferences) {
    draft = {

    };

    formError = null;
    editingId = row.id;
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    formError = null;
    let values: Omit<Preferences, keyof SyncFields>;
    try {
      values = {

      };
    } catch (err) {
      formError = 'Invalid JSON: ' + (err instanceof Error ? err.message : String(err));
      return;
    }
    let savedId: string;
    if (editingId) {
      // patch() re-reads the row from the store and changes ONLY these fields.
      // Writing `{ ...rowFromTheList, ...values }` instead would push the
      // component's snapshot back over anything that changed underneath it —
      // an edit pulled from another device, a change made in another tab —
      // and that reversion then propagates as if it were deliberate.
      const saved = await patch<Preferences>('preferences', editingId, values);
      if (!saved) {
        formError = 'That row was deleted somewhere else — nothing was saved.';
        await refresh();
        return;
      }
      savedId = editingId;
    } else {
      const created = await put('preferences', withSyncFields(values));
      savedId = created.id;
    }

    editingId = null;
    await refresh();
  }

  async function del(row: Preferences) {
    if (!confirm('Delete this row?')) return;
    await softDelete('preferences', row.id);
    await refresh();
  }
</script>

<div class="page-header">
  <h1>Preferences</h1>
  <button class="btn btn-primary" data-testid="preferences-new" onclick={startCreate}>+ New</button>
</div>

{#if editingId !== null}
  <Card title={editingId ? 'Edit' : 'New preferences'}>
    <form class="stack" onsubmit={save}>


      {#if formError}
        <p class="form-error">{formError}</p>
      {/if}
      <div class="row">
        <button class="btn btn-primary" data-testid="preferences-save" type="submit">Save</button>
        <button class="btn" type="button" onclick={() => (editingId = null)}>Cancel</button>
      </div>
    </form>
  </Card>
{/if}

{#if loading}
  <p class="muted">Loading…</p>
{:else if rows.length === 0}
  <p class="muted">Nothing here yet.</p>
{:else}
  <div class="table-wrap">
    <table class="data-table">
      <thead>
        <tr>

          <th></th>
        </tr>
      </thead>
      <tbody>
        {#each rows as row (row.id)}
          <tr data-testid="preferences-row" data-row-id={row.id}>

            <td class="actions">
              <button class="btn btn-sm" data-testid="preferences-edit" onclick={() => startEdit(row)}>Edit</button>
              <button class="btn btn-sm btn-danger" data-testid="preferences-delete" onclick={() => del(row)}>Delete</button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<style>
  .actions {
    display: flex;
    gap: var(--space-1);
    justify-content: flex-end;
  }

  .mono {
    font-family: ui-monospace, monospace;
    font-size: var(--font-size-sm);
  }

  .form-error {
    color: var(--color-danger);
    font-size: var(--font-size-sm);
  }

  .check {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--text-color);
    font-size: var(--font-size-base);
  }

  .inline-new {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }

  .inline-new input {
    max-width: 16rem;
  }

  .link-list {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-4);
    padding: var(--space-2) 0;
  }

  .link-item {
    margin: 0;
  }
</style>
