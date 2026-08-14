<script lang="ts">
  import { onMount } from 'svelte';
  import Card from '../Card.svelte';
  import { getSingleton, patch, put, putSingleton, softDelete, withSyncFields } from '../../lib/db/repo';
  import type { Preferences, Timer } from '../../lib/db/types';
  import { formatCountdown, hmsToMs, msToHms, remainingMs } from '../../lib/time/duration';
  import { dismissNotice, engineState, refreshTimers, unlockAudio } from '../../lib/time/engine.svelte';
  import { renderMarkdown } from '../../lib/markdown';

  const canVibrate = typeof navigator !== 'undefined' && 'vibrate' in navigator;
  const canNotify = typeof Notification !== 'undefined';

  let loading = $state(true);
  let editingId: string | null = $state(null); // null = closed, '' = new
  let formError: string | null = $state(null);
  let notifyDenied = $state(false);
  let draft = $state(blankDraft());

  function blankDraft() {
    return {
      label: '',
      description_md: '',
      hours: 0,
      minutes: 5,
      seconds: 0,
      sound: true,
      vibrate: false,
      notify: false,
      deleteOnComplete: false,
    };
  }

  // The engine owns the list; the page just renders it. Running first, then
  // paused/idle/done; stable by label within a state.
  const STATE_ORDER = { running: 0, paused: 1, idle: 2, done: 3 } as const;
  let timers = $derived(
    [...engineState.timers].sort(
      (a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.label.localeCompare(b.label)
    )
  );

  onMount(async () => {
    await refreshTimers();
    loading = false;
  });

  async function startCreate() {
    const prefs = await getSingleton<Preferences>('preferences');
    draft = {
      ...blankDraft(),
      // Auto-fill completion actions from the remembered defaults.
      sound: prefs?.timer_default_sound ?? true,
      vibrate: (prefs?.timer_default_vibrate ?? false) && canVibrate,
      notify: (prefs?.timer_default_notify ?? false) && canNotify,
      deleteOnComplete: prefs?.timer_default_delete_on_complete ?? false,
    };
    formError = null;
    editingId = '';
  }

  function startEdit(t: Timer) {
    const hms = msToHms(t.duration_ms);
    draft = {
      label: t.label,
      description_md: t.description_md,
      hours: hms.hours,
      minutes: hms.minutes,
      seconds: hms.seconds,
      sound: t.sound,
      vibrate: t.vibrate,
      notify: t.notify,
      deleteOnComplete: t.delete_on_complete,
    };
    formError = null;
    editingId = t.id;
  }

  /** Shared by "Save" (form submit) and "Save & start". Returns the saved
   * timer, or null when validation failed. */
  async function doSave(): Promise<Timer | null> {
    formError = null;
    const duration_ms = hmsToMs({ hours: +draft.hours, minutes: +draft.minutes, seconds: +draft.seconds });
    if (!draft.label.trim()) {
      formError = 'A timer needs a label.';
      return null;
    }
    if (duration_ms <= 0) {
      formError = 'Duration must be more than zero.';
      return null;
    }
    const fields = {
      label: draft.label.trim(),
      description_md: draft.description_md,
      duration_ms,
      sound: draft.sound,
      vibrate: draft.vibrate,
      notify: draft.notify,
      delete_on_complete: draft.deleteOnComplete,
    };
    let saved: Timer | null;
    if (editingId) {
      saved = (await patch<Timer>('timers', editingId, fields)) ?? null;
      if (!saved) {
        formError = 'That timer was deleted somewhere else — nothing was saved.';
        await refreshTimers();
        return null;
      }
    } else {
      saved = await put<Timer>(
        'timers',
        withSyncFields({ ...fields, end_at: null, paused_remaining_ms: null, state: 'idle' as const })
      );
    }
    await rememberDefaults();
    editingId = null;
    await refreshTimers();
    return saved;
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    await doSave();
  }

  async function saveAndStart() {
    const saved = await doSave();
    if (saved) await start(saved);
  }

  /** "Store a preference to auto-fill from when updating in future": saving a
   * timer makes its completion actions the defaults — written ONLY when they
   * actually differ, so an unchanged save touches nothing else. */
  async function rememberDefaults() {
    const prefs = await getSingleton<Preferences>('preferences');
    // With auto-remember off, the defaults only change on the Preferences page.
    if (!(prefs?.auto_remember_based_on_last_value ?? true)) return;
    if (
      prefs?.timer_default_sound !== draft.sound ||
      prefs?.timer_default_vibrate !== draft.vibrate ||
      prefs?.timer_default_notify !== draft.notify ||
      prefs?.timer_default_delete_on_complete !== draft.deleteOnComplete
    ) {
      await putSingleton<Partial<Preferences>>('preferences', {
        timer_default_sound: draft.sound,
        timer_default_vibrate: draft.vibrate,
        timer_default_notify: draft.notify,
        timer_default_delete_on_complete: draft.deleteOnComplete,
      });
    }
  }

  async function start(t: Timer) {
    // Acting on the timer acknowledges any completion still ringing for it.
    dismissNotice(t.id);
    // The gesture that arms the alarm also unlocks audio + permission.
    unlockAudio();
    if (t.notify && canNotify && Notification.permission === 'default') {
      const result = await Notification.requestPermission();
      notifyDenied = result === 'denied';
    } else {
      notifyDenied = t.notify && canNotify && Notification.permission === 'denied';
    }
    const budget =
      t.state === 'paused' && t.paused_remaining_ms != null ? t.paused_remaining_ms : t.duration_ms;
    await patch<Timer>('timers', t.id, {
      state: 'running',
      end_at: new Date(Date.now() + budget).toISOString(),
      paused_remaining_ms: null,
    });
    await refreshTimers();
  }

  async function pause(t: Timer) {
    if (!t.end_at) return;
    await patch<Timer>('timers', t.id, {
      state: 'paused',
      paused_remaining_ms: remainingMs(t.end_at, Date.now()),
      end_at: null,
    });
    await refreshTimers();
  }

  async function reset(t: Timer) {
    dismissNotice(t.id); // interrupts a ringing alarm too
    await patch<Timer>('timers', t.id, { state: 'idle', end_at: null, paused_remaining_ms: null });
    await refreshTimers();
  }

  async function del(t: Timer) {
    if (!confirm('Delete timer "' + t.label + '"?')) return;
    await softDelete('timers', t.id);
    await refreshTimers();
  }

  function display(t: Timer): string {
    if (t.state === 'running' && t.end_at) return formatCountdown(remainingMs(t.end_at, engineState.now));
    if (t.state === 'paused' && t.paused_remaining_ms != null) return formatCountdown(t.paused_remaining_ms);
    if (t.state === 'done') return formatCountdown(0);
    return formatCountdown(t.duration_ms);
  }
</script>

<div class="page-header">
  <h1>Timers</h1>
  <button class="btn btn-primary" data-testid="timer-new" onclick={startCreate}>+ New timer</button>
</div>

<p class="muted note">
  Alarms fire while useful is open in a tab or installed window — with no server
  there is no push, so anything that finishes while the app is closed is
  surfaced as missed on your next visit.
</p>

{#if notifyDenied}
  <p class="muted note" data-testid="notify-denied">
    Notifications are blocked for this site — sound and the in-app banner still work.
  </p>
{/if}

{#if editingId !== null}
  <Card title={editingId ? 'Edit timer' : 'New timer'}>
    <form class="stack" onsubmit={save}>
      <div>
        <label for="timer-label">Label</label>
        <input id="timer-label" data-testid="timer-label" bind:value={draft.label} required />
      </div>
      <div>
        <span class="field-label" id="duration-label">Duration</span>
        <div class="row" role="group" aria-labelledby="duration-label">
          <input class="num" data-testid="timer-hours" type="number" min="0" max="99" bind:value={draft.hours} aria-label="Hours" />
          <span aria-hidden="true">h</span>
          <input class="num" data-testid="timer-minutes" type="number" min="0" max="59" bind:value={draft.minutes} aria-label="Minutes" />
          <span aria-hidden="true">m</span>
          <input class="num" data-testid="timer-seconds" type="number" min="0" max="59" bind:value={draft.seconds} aria-label="Seconds" />
          <span aria-hidden="true">s</span>
        </div>
      </div>
      <div>
        <label for="timer-desc">Description (markdown)</label>
        <textarea id="timer-desc" data-testid="timer-desc" rows="3" bind:value={draft.description_md}></textarea>
      </div>
      <div class="row">
        <label class="check"><input type="checkbox" bind:checked={draft.sound} /> Play sound</label>
        {#if canVibrate}
          <label class="check"><input type="checkbox" bind:checked={draft.vibrate} /> Vibrate</label>
        {/if}
        {#if canNotify}
          <label class="check"><input type="checkbox" bind:checked={draft.notify} /> Show notification</label>
        {/if}
        <label class="check">
          <input type="checkbox" data-testid="timer-delete-on-complete" bind:checked={draft.deleteOnComplete} />
          Delete when finished
        </label>
      </div>
      {#if formError}
        <p class="form-error" data-testid="timer-form-error">{formError}</p>
      {/if}
      <div class="row">
        <button class="btn btn-primary" data-testid="timer-save" type="submit">Save</button>
        <button class="btn btn-primary" data-testid="timer-save-start" type="button" onclick={saveAndStart}>
          Save &amp; start
        </button>
        <button class="btn" type="button" onclick={() => (editingId = null)}>Cancel</button>
      </div>
    </form>
  </Card>
{/if}

{#if loading}
  <p class="muted">Loading…</p>
{:else if timers.length === 0 && editingId === null}
  <p class="muted">No timers yet — create one and it stays as a reusable preset.</p>
{:else}
  <div class="grid-2">
    {#each timers as t (t.id)}
      <Card title={t.label}>
        {#snippet actions()}
          <span class="state state-{t.state}" data-testid="timer-state">{t.state}</span>
        {/snippet}
        <div class="stack">
          <p class="countdown" data-testid="timer-countdown">{display(t)}</p>
          {#if t.description_md.trim()}
            <details>
              <summary class="muted">Description</summary>
              <!-- Static markdown through the sanitized renderer — see src/lib/markdown.ts -->
              <div class="desc">{@html renderMarkdown(t.description_md)}</div>
            </details>
          {/if}
          <div class="row">
            {#if t.state === 'running'}
              <button class="btn" data-testid="timer-pause" onclick={() => pause(t)}>Pause</button>
              <button class="btn" data-testid="timer-reset" onclick={() => reset(t)}>Reset</button>
            {:else if t.state === 'paused'}
              <button class="btn btn-primary" data-testid="timer-start" onclick={() => start(t)}>Resume</button>
              <button class="btn" data-testid="timer-reset" onclick={() => reset(t)}>Reset</button>
            {:else if t.state === 'done'}
              <button class="btn btn-primary" data-testid="timer-start" onclick={() => start(t)}>Run again</button>
              <button class="btn" data-testid="timer-reset" onclick={() => reset(t)}>Reset</button>
            {:else}
              <button class="btn btn-primary" data-testid="timer-start" onclick={() => start(t)}>Start</button>
            {/if}
            <button class="btn btn-sm" data-testid="timer-edit" onclick={() => startEdit(t)}>Edit</button>
            <button class="btn btn-sm btn-danger" data-testid="timer-delete" onclick={() => del(t)}>Delete</button>
          </div>
        </div>
      </Card>
    {/each}
  </div>
{/if}

<style>
  .note {
    font-size: var(--font-size-sm);
    margin-bottom: var(--space-4);
  }

  .field-label {
    font-size: var(--font-size-sm);
    color: var(--text-muted-color);
    display: block;
    margin-bottom: var(--space-1);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
  }

  .num {
    width: 4.5rem;
  }

  .check {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--text-color);
    font-size: var(--font-size-base);
    text-transform: none;
    letter-spacing: normal;
    margin-bottom: 0;
  }

  .form-error {
    color: var(--color-danger);
    font-size: var(--font-size-sm);
  }

  .countdown {
    font-size: var(--font-size-2xl);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .state {
    font-size: var(--font-size-eyebrow);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-muted-color);
  }

  .state-running {
    color: var(--color-stamp);
  }

  .desc :global(p) {
    margin-block: var(--space-2);
  }

  .desc :global(ul),
  .desc :global(ol) {
    padding-left: var(--space-5);
  }
</style>
