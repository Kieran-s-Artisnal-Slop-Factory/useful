<script lang="ts">
  /**
   * The post-install offer: once the app is installed, ask whether to pull
   * everything down for offline use.
   *
   * Two triggers, because neither alone is reliable: the `appinstalled` event
   * (Chromium fires it, others do not) and the first run in standalone
   * display-mode (which catches installs that happened elsewhere, including
   * iOS "Add to Home Screen"). Asked at most once — the answer is remembered in
   * preferences either way, and Settings keeps the same panel for later.
   *
   * Mounted in the layout with transition:persist, so a client-side navigation
   * cannot make it ask twice.
   */
  import { onMount } from 'svelte';
  import OfflinePanel from './OfflinePanel.svelte';
  import { isInstalled } from '../../lib/offline';
  import { getSingleton, putSingleton } from '../../lib/db/repo';
  import type { Preferences } from '../../lib/db/types';

  let dialog = $state<HTMLDialogElement | null>(null);
  let open = $state(false);
  /** Guards the write, so the same answer is never recorded twice. */
  let answered = false;

  async function offer() {
    if (open) return;
    const prefs = await getSingleton<Preferences>('preferences');
    if (prefs?.offline_prompt_seen) return;
    answered = false;
    open = true;
    // Wait for the element to exist before showing it.
    queueMicrotask(() => dialog?.showModal());
  }

  /**
   * Remember that we asked — whichever way it was answered, and by whichever
   * exit. "Not now", Escape, and finishing the download all land here: the
   * question was put to someone and they dealt with it, so asking again would
   * be nagging. Escape used to leave no trace at all, which meant the offer
   * came back on the next launch.
   */
  async function recordAnswer() {
    if (answered) return;
    answered = true;
    await putSingleton<Partial<Preferences>>('preferences', { offline_prompt_seen: true });
  }

  /** Dismiss and remember. */
  async function close() {
    open = false;
    dialog?.close();
    await recordAnswer();
  }

  onMount(() => {
    const onInstalled = () => void offer();
    window.addEventListener('appinstalled', onInstalled);
    if (isInstalled()) void offer();
    return () => window.removeEventListener('appinstalled', onInstalled);
  });
</script>

{#if open}
  <dialog
    bind:this={dialog}
    class="offline-dialog"
    data-testid="offline-dialog"
    aria-labelledby="offline-title"
    onclose={() => {
      open = false;
      void recordAnswer();
    }}
  >
    <h2 id="offline-title">Make it work offline?</h2>
    <p class="muted small">
      The app is installed. It already works without a network for anything you
      have visited — this fetches the rest, so nothing is missing later.
    </p>
    <OfflinePanel onfinished={() => void recordAnswer()} />
    <div class="row end">
      <button class="btn" data-testid="offline-dismiss" onclick={close}>Not now</button>
    </div>
  </dialog>
{/if}

<style>
  .offline-dialog {
    /* The global reset kills the UA's auto-centering margin. */
    margin: auto;
    width: min(38rem, calc(100vw - 2rem));
    border: 1.5px solid var(--border-strong-color);
    background: var(--surface-color);
    color: var(--text-color);
    padding: var(--space-5);
  }

  .offline-dialog::backdrop {
    background: rgb(0 0 0 / 0.4);
  }

  h2 {
    font-size: var(--font-size-lg);
    margin-bottom: var(--space-2);
  }

  .small {
    font-size: var(--font-size-sm);
  }

  .row.end {
    justify-content: flex-end;
    margin-top: var(--space-4);
  }
</style>
