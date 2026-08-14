<script lang="ts">
  import { dismissNotice, engineState, startEngine } from '../../lib/time/engine.svelte';

  // Persisted across view transitions (transition:persist in Layout.astro),
  // so a timer keeps ticking — and fires — while the user browses other tools.
  $effect(() => startEngine());
</script>

{#if engineState.notices.length > 0}
  <div class="notices" role="status" aria-live="polite">
    {#each engineState.notices as notice (notice.id + notice.at)}
      <div class="notice" data-testid="timer-notice" data-timer-id={notice.id}>
        <span class="tag">{notice.missed ? 'MISSED' : 'DONE'}</span>
        <span class="label">{notice.label}</span>
        <button
          class="dismiss"
          aria-label={'Dismiss notification for ' + notice.label}
          onclick={() => dismissNotice(notice.id)}
        >
          ×
        </button>
      </div>
    {/each}
  </div>
{/if}

<style>
  .notices {
    position: fixed;
    right: var(--space-4);
    bottom: var(--space-4);
    z-index: 60;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    max-width: min(22rem, calc(100vw - 2 * var(--space-4)));
  }

  .notice {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    background: var(--surface-raised-color);
    border: 1px solid var(--border-strong-color);
    box-shadow: var(--shadow-2), inset 2px 0 0 var(--color-stamp);
    padding: var(--space-3) var(--space-4);
  }

  .tag {
    font-size: var(--font-size-eyebrow);
    font-weight: 600;
    letter-spacing: var(--tracking-label);
    color: var(--color-stamp);
    flex: none;
  }

  .label {
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .dismiss {
    margin-left: auto;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-muted-color);
    font-size: var(--font-size-lg);
    line-height: 1;
    padding: var(--space-1);
  }

  .dismiss:hover {
    color: var(--text-color);
  }
</style>
