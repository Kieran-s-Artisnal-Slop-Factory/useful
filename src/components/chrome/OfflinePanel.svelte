<script lang="ts">
  /**
   * The "download everything for offline use" control, shared by the
   * post-install dialog and the Settings page — the offer has to be repeatable,
   * because the moment someone installs the app is rarely the moment they want
   * to spend 30 MB of someone else's wifi on it.
   *
   * Each bundle is listed with its size and its own state, so a failure names
   * itself instead of collapsing the whole thing into "something went wrong".
   */
  import { onMount } from 'svelte';
  import { formatBytes } from '../../lib/img/convert';
  import {
    downloadAll,
    OFFLINE_BUNDLES,
    OFFLINE_TOTAL_BYTES,
    type BundleProgress,
  } from '../../lib/offline';
  import { getSingleton, putSingleton } from '../../lib/db/repo';
  import type { Preferences } from '../../lib/db/types';

  let { onfinished }: { onfinished?: () => void } = $props();

  /** Bundle ids the user wants; everything is on by default. */
  let picked = $state<Record<string, boolean>>(
    Object.fromEntries(OFFLINE_BUNDLES.map((b) => [b.id, true]))
  );
  let running = $state(false);
  let progress = $state<BundleProgress[]>([]);
  let finishedAt = $state<string | null>(null);
  let modelReady = $state<boolean | null>(null);

  const chosen = $derived(OFFLINE_BUNDLES.filter((b) => picked[b.id]));
  const chosenBytes = $derived(chosen.reduce((sum, b) => sum + b.bytes, 0));
  const stateOf = (id: string) => progress.find((p) => p.id === id);

  onMount(async () => {
    const prefs = await getSingleton<Preferences>('preferences');
    finishedAt = prefs?.offline_ready_at ?? null;
    modelReady = await OFFLINE_BUNDLES.find((b) => b.id === 'bg-model')!.ready();
  });

  async function start() {
    if (running || chosen.length === 0) return;
    running = true;
    try {
      const result = await downloadAll(chosen, (next) => (progress = next));
      const ok = result.every((r) => r.state === 'done');
      if (ok) {
        const at = new Date().toISOString();
        await putSingleton<Partial<Preferences>>('preferences', { offline_ready_at: at });
        finishedAt = at;
      }
      modelReady = await OFFLINE_BUNDLES.find((b) => b.id === 'bg-model')!.ready();
    } finally {
      running = false;
      onfinished?.();
    }
  }
</script>

<div class="stack">
  <p class="muted small" data-testid="offline-summary">
    Downloads everything the app can run without a network — pages you have not
    opened, and the optional engines and models that are normally fetched on
    first use. About {formatBytes(OFFLINE_TOTAL_BYTES)} in total; pick what you want.
  </p>

  <ul class="bundles" data-testid="offline-bundles">
    {#each OFFLINE_BUNDLES as bundle (bundle.id)}
      {@const state = stateOf(bundle.id)}
      <li>
        <label class="check">
          <input type="checkbox" data-testid={'offline-pick-' + bundle.id} bind:checked={picked[bundle.id]} disabled={running} />
          <span>
            <strong>{bundle.label}</strong>
            {#if bundle.bytes > 0}<span class="muted small"> · {formatBytes(bundle.bytes)}</span>{/if}
            {#if bundle.id === 'bg-model' && modelReady}<span class="ready small"> · already downloaded</span>{/if}
            <br />
            <span class="muted small">{bundle.detail}</span>
          </span>
        </label>
        {#if state}
          <span class="state small" data-testid={'offline-state-' + bundle.id} aria-live="polite">
            {#if state.state === 'running'}
              Downloading{state.note ? ` · ${state.note}` : '…'}
            {:else if state.state === 'done'}
              Done
            {:else if state.state === 'failed'}
              <span class="failed">Failed — {state.error}</span>
            {:else}
              Waiting
            {/if}
          </span>
        {/if}
      </li>
    {/each}
  </ul>

  <div class="row">
    <button
      class="btn btn-primary"
      data-testid="offline-start"
      onclick={start}
      disabled={running || chosen.length === 0}
    >
      {running ? 'Downloading…' : `Download ${formatBytes(chosenBytes)}`}
    </button>
    {#if finishedAt}
      <span class="muted small self-end" data-testid="offline-finished">
        Last downloaded {new Date(finishedAt).toLocaleString()}
      </span>
    {/if}
  </div>
  <p class="muted small">
    Everything is kept in this browser. Clearing site data undoes it, and you can
    run this again any time from Settings.
  </p>
</div>

<style>
  .small {
    font-size: var(--font-size-sm);
  }

  .bundles {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .bundles li {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .check {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
  }

  .state {
    color: var(--text-muted-color);
    white-space: nowrap;
  }

  .failed {
    color: var(--color-danger);
    white-space: normal;
  }

  .ready {
    color: var(--color-success);
  }
</style>
