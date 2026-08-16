<script lang="ts">
  import { onMount } from 'svelte';
  import Card from '../Card.svelte';
  import OfflinePanel from '../chrome/OfflinePanel.svelte';
  import {
    clearAllData,
    downloadExport,
    importData,
    type ExportEnvelope,
    type ImportMode,
  } from '../../lib/db/export';
  import { requestPersistentStorage, type PersistState } from '../../lib/db/persistence';
  import { href } from '../../lib/paths';

  const THEME_KEY = 'useful-theme';

  let message: string | null = $state(null);
  let messageOk = $state(true);
  let busy = $state(false);
  let theme = $state('auto');
  let persistState: PersistState | null = $state(null);

  onMount(async () => {
    theme = localStorage.getItem(THEME_KEY) ?? 'auto';
    inDeveloperMode = sessionStorage.getItem(DEV_MODE_KEY) === '1';
  });

  function setTheme(value: string) {
    theme = value;
    if (value === 'auto') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, value);
    document.documentElement.style.colorScheme = value === 'auto' ? '' : value;
  }

  async function persist() {
    persistState = await requestPersistentStorage();
  }

  // ---- backup
  let importInput: HTMLInputElement | undefined = $state();

  let importMode: ImportMode = $state('replace');

  async function onImportFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    input.value = '';
    const warning =
      importMode === 'replace'
        ? 'Restore REPLACES the data on this device with the backup. Continue?'
        : 'Merge folds the backup into your current data, keeping whichever copy of each row is newer. Continue?';
    if (!confirm(warning)) return;
    busy = true;
    try {
      const envelope = JSON.parse(await file.text()) as ExportEnvelope;
      const result = await importData(envelope, importMode);
      message =
        'Import complete: ' + result.rows + ' rows loaded' +
        (result.skipped > 0 ? ', ' + result.skipped + ' skipped (local copy newer)' : '') +
        '. Reloading…';
      messageOk = true;
      setTimeout(() => location.reload(), 800);
    } catch (err) {
      // Import validates the whole file before writing anything, so a failure
      // here means nothing was changed.
      message = 'Import failed (nothing was changed): ' + (err instanceof Error ? err.message : String(err));
      messageOk = false;
    }
    busy = false;
  }

  // ---- developer options, gated behind typing the exact phrase once per
  // browser session (sessionStorage, so it resets across sessions)
  const DEV_MODE_KEY = 'useful-inDeveloperMode';
  const DEV_PHRASE = 'I understand I can lose and corrupt my data by using these settings';
  let inDeveloperMode = $state(false);
  let showDevModal = $state(false);
  let devPhraseInput = $state('');

  function unlockDeveloperMode(e: SubmitEvent) {
    e.preventDefault();
    if (devPhraseInput.trim() !== DEV_PHRASE) return;
    sessionStorage.setItem(DEV_MODE_KEY, '1');
    inDeveloperMode = true;
    showDevModal = false;
    devPhraseInput = '';
  }

  async function clearData() {
    if (!confirm('Delete ALL local data? This cannot be undone — export a backup first if in doubt.')) {
      return;
    }
    await clearAllData();
    location.href = href('/');
  }
</script>

<div class="page-header">
  <h1>Settings</h1>
</div>

{#if message}
  <p class={messageOk ? 'ok' : 'err'}>{message}</p>
{/if}

<div class="stack">
  <Card title="Appearance">
    <div class="row">
      {#each ['auto', 'light', 'dark'] as value}
        <button
          class="btn"
          class:btn-primary={theme === value}
          onclick={() => setTheme(value)}
        >
          {value}
        </button>
      {/each}
    </div>
  </Card>

  <Card title="Storage">
    <div class="stack">
      <p class="muted small">
        Data lives in this browser's IndexedDB. Ask the browser to protect it from eviction, and
        export JSON backups regularly — this device is the only copy.
      </p>
      <div class="row">
        <button class="btn" onclick={persist}>Request persistent storage</button>
        {#if persistState}
          <span class={persistState === 'granted' ? 'ok' : 'err'}>{persistState}</span>
        {/if}
      </div>
    </div>
  </Card>

  <Card title="Offline">
    <OfflinePanel />
  </Card>

  <Card title="Backup">
    <div class="stack">
      <p class="muted small">
        Download every table (deleted rows included) as one JSON file, or load a previous backup.
        <strong>Restore</strong> replaces this device's data with the file;
        <strong>Merge</strong> folds the file in, keeping whichever copy of each row is newer.
      </p>
      <div class="row">
        {#each [['replace', 'Restore'], ['merge', 'Merge']] as [value, label]}
          <button
            class="btn"
            class:btn-primary={importMode === value}
            onclick={() => (importMode = value as ImportMode)}
          >
            {label}
          </button>
        {/each}
      </div>
      <div class="row">
        <button class="btn" onclick={() => downloadExport()} disabled={busy}>Export JSON</button>
        <button class="btn" onclick={() => importInput?.click()} disabled={busy}>Import JSON</button>
        <input
          bind:this={importInput}
          type="file"
          accept="application/json,.json"
          style="display: none"
          onchange={onImportFile}
        />
      </div>
    </div>
  </Card>

  <Card title="Developer">
    {#if !inDeveloperMode}
      <div class="stack">
        <p class="muted small">
          Developer options can corrupt or destroy your data and are locked by default.
        </p>
        <div class="row">
          <button class="btn" onclick={() => (showDevModal = true)}>Unlock developer options</button>
        </div>
      </div>
    {:else}
      <div class="stack">
        <p class="muted small">Wipe everything on this device. This is the only copy — export a backup first.</p>
        <div class="row">
          <button class="btn btn-danger" onclick={clearData}>Clear all data</button>
        </div>
      </div>
    {/if}
  </Card>
</div>

{#if showDevModal}
  <div
    class="modal-backdrop"
    role="presentation"
    onclick={(e) => e.target === e.currentTarget && (showDevModal = false)}
  >
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="dev-modal-title">
      <h3 id="dev-modal-title">Unlock developer options</h3>
      <p class="muted small">Type the following phrase exactly to continue:</p>
      <p class="phrase">{DEV_PHRASE}</p>
      <form onsubmit={unlockDeveloperMode}>
        <input bind:value={devPhraseInput} placeholder="Type the phrase…" />
        <div class="row modal-actions">
          <button class="btn" type="button" onclick={() => (showDevModal = false)}>Cancel</button>
          <button class="btn btn-primary" type="submit" disabled={devPhraseInput.trim() !== DEV_PHRASE}>
            Unlock
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  .ok {
    color: var(--color-success);
    font-size: var(--font-size-sm);
  }

  .err {
    color: var(--color-danger);
    font-size: var(--font-size-sm);
  }

  .small {
    font-size: var(--font-size-sm);
  }

  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: var(--scrim-color);
    display: grid;
    place-items: center;
    z-index: 50;
    padding: var(--space-4);
  }

  .modal {
    background: var(--surface-raised-color);
    border: 1px solid var(--border-strong-color);
    outline: 1px dashed var(--border-color);
    outline-offset: 4px;
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-2);
    padding: var(--space-4);
    max-width: 28rem;
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .modal h3 {
    font-size: var(--font-size-sm);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
  }

  .phrase {
    font-size: var(--font-size-sm);
    background: var(--color-primary-soft);
    border-radius: var(--radius-sm);
    padding: var(--space-2) var(--space-3);
    user-select: all;
  }

  .modal form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .modal-actions {
    justify-content: flex-end;
  }
</style>
