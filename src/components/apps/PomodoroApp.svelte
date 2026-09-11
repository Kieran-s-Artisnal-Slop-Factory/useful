<script lang="ts">
  import { onMount } from 'svelte';
  import Card from '../Card.svelte';
  import Explainer from '../Explainer.svelte';
  import { putSingleton } from '../../lib/db/repo';
  import type { Pomodoro } from '../../lib/db/types';
  import { formatCountdown, remainingMs } from '../../lib/time/duration';
  import {
    POMODORO_NOTICE_ID,
    dismissNotice,
    engineState,
    refreshPomodoro,
    unlockAudio,
  } from '../../lib/time/engine.svelte';
  import {
    MIN_PHASE_MS,
    POMODORO_DEFAULTS,
    completedToday,
    durationFor,
    localDate,
    nextPhase,
    pausePatch,
    phaseLabel,
    resetPatch,
    resumePatch,
    startPhase,
    type PomodoroFields,
  } from '../../lib/time/pomodoro';

  const canVibrate = typeof navigator !== 'undefined' && 'vibrate' in navigator;
  const canNotify = typeof Notification !== 'undefined';

  let loading = $state(true);
  let notifyDenied = $state(false);
  let settingsError: string | null = $state(null);

  // The engine owns the row (it reloads it every tick, and completes it). The
  // page renders whatever is there — or the defaults until the first Start
  // creates the row. A render never writes.
  let row = $derived<PomodoroFields>(engineState.pomodoro ?? POMODORO_DEFAULTS);

  // Settings are edited in a local draft and committed field by field on
  // change, so a half-typed number is never written.
  let draft = $state(toDraft(POMODORO_DEFAULTS));

  function toDraft(r: PomodoroFields) {
    return {
      workMin: msToMin(r.work_ms),
      shortMin: msToMin(r.short_break_ms),
      longMin: msToMin(r.long_break_ms),
      rounds: r.rounds_before_long,
      autoAdvance: r.auto_advance,
      sound: r.sound,
      vibrate: r.vibrate,
      notify: r.notify,
    };
  }

  /** Two decimals, so a 90 s break shows as 1.5 rather than 1.5000000001. */
  function msToMin(ms: number): number {
    return Math.round(ms / 600) / 100;
  }

  function minToMs(min: number): number {
    return Math.round(+min * 60_000);
  }

  onMount(async () => {
    await refreshPomodoro();
    draft = toDraft(engineState.pomodoro ?? POMODORO_DEFAULTS);
    loading = false;
  });

  let remaining = $derived(
    row.state === 'running' && row.end_at
      ? remainingMs(row.end_at, engineState.now)
      : row.state === 'paused' && row.paused_remaining_ms != null
        ? row.paused_remaining_ms
        : durationFor(row, row.phase)
  );

  let phaseMs = $derived(Math.max(1, durationFor(row, row.phase)));
  /** Fraction of the phase elapsed, for the ring. */
  let progress = $derived(row.state === 'idle' ? 0 : Math.min(1, Math.max(0, 1 - remaining / phaseMs)));

  let today = $derived(completedToday(row, localDate(engineState.now)));

  /** One entry per work round in the cycle: done, current, or upcoming. */
  let dots = $derived(
    Array.from({ length: Math.max(1, row.rounds_before_long) }, (_, i) => {
      const n = i + 1;
      if (n < row.round || (n === row.round && row.phase !== 'work')) return 'done';
      if (n === row.round) return 'current';
      return 'todo';
    })
  );

  /** Merge a patch into the singleton. The first write of all carries the
   * full field set (defaults + whatever the draft already says), so the row
   * is complete from the moment it exists. */
  async function write(patch: Partial<PomodoroFields>) {
    if (engineState.pomodoro) {
      await putSingleton<Partial<Pomodoro>>('pomodoro', patch);
    } else {
      await putSingleton<PomodoroFields>('pomodoro', { ...POMODORO_DEFAULTS, ...draftFields(), ...patch });
    }
    await refreshPomodoro();
  }

  function draftFields(): Partial<PomodoroFields> {
    return {
      work_ms: minToMs(draft.workMin),
      short_break_ms: minToMs(draft.shortMin),
      long_break_ms: minToMs(draft.longMin),
      rounds_before_long: Math.max(1, Math.round(+draft.rounds)),
      auto_advance: draft.autoAdvance,
      sound: draft.sound,
      vibrate: draft.vibrate,
      notify: draft.notify,
    };
  }

  async function armAlerts() {
    // The gesture that starts the phase also unlocks audio + permission.
    unlockAudio();
    if (row.notify && canNotify && Notification.permission === 'default') {
      const result = await Notification.requestPermission();
      notifyDenied = result === 'denied';
    } else {
      notifyDenied = row.notify && canNotify && Notification.permission === 'denied';
    }
  }

  async function start() {
    dismissNotice(POMODORO_NOTICE_ID);
    await armAlerts();
    await write(startPhase(row, Date.now()));
  }

  async function resume() {
    await armAlerts();
    await write(resumePatch(row, Date.now()));
  }

  async function pause() {
    await write(pausePatch(row, Date.now()));
  }

  /** Move on without finishing: a skipped focus round is not counted. */
  async function skip() {
    dismissNotice(POMODORO_NOTICE_ID);
    await write(nextPhase(row, localDate(Date.now()), false));
  }

  async function reset() {
    dismissNotice(POMODORO_NOTICE_ID);
    if (!engineState.pomodoro) return; // nothing to reset — and nothing to write
    await write(resetPatch());
  }

  // --- settings -------------------------------------------------------------

  async function commit<K extends keyof PomodoroFields>(key: K, value: PomodoroFields[K]) {
    if (engineState.pomodoro && engineState.pomodoro[key] === value) return;
    await write({ [key]: value } as Partial<PomodoroFields>);
  }

  async function commitDuration(key: 'work_ms' | 'short_break_ms' | 'long_break_ms', minutes: number) {
    const ms = minToMs(minutes);
    if (!Number.isFinite(ms) || ms < MIN_PHASE_MS) {
      settingsError = 'Each phase needs at least one second.';
      return;
    }
    settingsError = null;
    await commit(key, ms);
  }

  async function commitRounds() {
    const n = Math.round(+draft.rounds);
    if (!Number.isFinite(n) || n < 1) {
      settingsError = 'The cycle needs at least one focus round.';
      return;
    }
    settingsError = null;
    draft.rounds = n;
    await commit('rounds_before_long', n);
  }

  let startLabel = $derived(row.state === 'done' ? `Start ${phaseLabel(row.phase).toLowerCase()}` : 'Start');
</script>

<div class="page-header">
  <h1>Pomodoro</h1>
</div>

<p class="muted note">
  Focus rounds and breaks on a cycle. Each phase ends with a banner — and sound,
  vibration or a notification if you ask — while useful is open in a tab or
  installed window; a phase that ends while the app is closed shows as missed
  on your next visit.
</p>

{#if notifyDenied}
  <p class="muted note" data-testid="notify-denied">
    Notifications are blocked for this site — sound and the in-app banner still work.
  </p>
{/if}

{#if loading}
  <p class="muted">Loading…</p>
{:else}
  <div class="stack">
    <Card>
      <div class="stack center" data-testid="pom-card" data-state={row.state}>
        <p class="phase" data-testid="pom-phase">{phaseLabel(row.phase)}</p>
        <div class="ring" style="--pct: {Math.round(progress * 100)}%" role="presentation">
          <p class="clock" data-testid="pom-remaining" aria-live="off">{formatCountdown(remaining)}</p>
        </div>
        <p class="round" data-testid="pom-round">
          Round {row.round} of {row.rounds_before_long}
          <span class="state-tag" data-testid="pom-state">{row.state}</span>
        </p>
        <div class="dots" aria-hidden="true">
          {#each dots as d, i (i)}
            <span class="dot dot-{d}" data-testid="pom-dot" data-dot={d}></span>
          {/each}
        </div>
        <div class="row center-row">
          {#if row.state === 'running'}
            <button class="btn btn-primary" data-testid="pom-pause" onclick={pause}>Pause</button>
          {:else if row.state === 'paused'}
            <button class="btn btn-primary" data-testid="pom-resume" onclick={resume}>Resume</button>
          {:else}
            <button class="btn btn-primary" data-testid="pom-start" onclick={start}>{startLabel}</button>
          {/if}
          <button class="btn" data-testid="pom-skip" onclick={skip}>Skip</button>
          <button class="btn" data-testid="pom-reset" onclick={reset}>Reset</button>
        </div>
        <p class="muted" data-testid="pom-today">
          {today} focus {today === 1 ? 'round' : 'rounds'} completed today
        </p>
      </div>
    </Card>

    <Card title="Settings">
      <div class="stack">
        <div class="row wrap">
          <div>
            <label for="pom-work-min">Focus (minutes)</label>
            <input
              id="pom-work-min"
              class="num"
              data-testid="pom-work-min"
              type="number"
              min="0.02"
              step="any"
              bind:value={draft.workMin}
              onchange={() => commitDuration('work_ms', draft.workMin)}
            />
          </div>
          <div>
            <label for="pom-short-min">Short break (minutes)</label>
            <input
              id="pom-short-min"
              class="num"
              data-testid="pom-short-min"
              type="number"
              min="0.02"
              step="any"
              bind:value={draft.shortMin}
              onchange={() => commitDuration('short_break_ms', draft.shortMin)}
            />
          </div>
          <div>
            <label for="pom-long-min">Long break (minutes)</label>
            <input
              id="pom-long-min"
              class="num"
              data-testid="pom-long-min"
              type="number"
              min="0.02"
              step="any"
              bind:value={draft.longMin}
              onchange={() => commitDuration('long_break_ms', draft.longMin)}
            />
          </div>
          <div>
            <label for="pom-rounds">Rounds before the long break</label>
            <input
              id="pom-rounds"
              class="num"
              data-testid="pom-rounds"
              type="number"
              min="1"
              max="12"
              step="1"
              bind:value={draft.rounds}
              onchange={commitRounds}
            />
          </div>
        </div>
        {#if settingsError}
          <p class="form-error" data-testid="pom-settings-error">{settingsError}</p>
        {/if}
        <div class="row wrap">
          <label class="check">
            <input
              type="checkbox"
              data-testid="pom-auto-advance"
              bind:checked={draft.autoAdvance}
              onchange={() => commit('auto_advance', draft.autoAdvance)}
            />
            Start the next phase automatically
          </label>
          <label class="check">
            <input
              type="checkbox"
              data-testid="pom-sound"
              bind:checked={draft.sound}
              onchange={() => commit('sound', draft.sound)}
            />
            Play sound
          </label>
          {#if canVibrate}
            <label class="check">
              <input
                type="checkbox"
                data-testid="pom-vibrate"
                bind:checked={draft.vibrate}
                onchange={() => commit('vibrate', draft.vibrate)}
              />
              Vibrate
            </label>
          {/if}
          {#if canNotify}
            <label class="check">
              <input
                type="checkbox"
                data-testid="pom-notify"
                bind:checked={draft.notify}
                onchange={() => commit('notify', draft.notify)}
              />
              Show notification
            </label>
          {/if}
        </div>
        <p class="muted small">
          A change applies from the next phase — the one running now keeps the deadline it started with.
        </p>
      </div>
    </Card>

    <Explainer summary="How the cycle works" testid="explainer-pomodoro">
      <p>
        A cycle is a run of focus rounds, each followed by a short break, and a long break after the last
        round. With the defaults that is 25 minutes of focus, 5 off, four times over, then 15 off — and
        the next cycle starts at round 1.
      </p>
      <p>
        <strong>Skip</strong> moves to the next phase without finishing this one; a skipped focus round is
        not counted. <strong>Reset</strong> goes back to round 1 and leaves today's count alone. The count
        resets by itself on a new day.
      </p>
      <p>
        Nothing is written while a phase runs: the deadline is stored once when you start it, so reloading
        or switching tools never drifts it, and the banner fires from whichever tab notices first.
      </p>
    </Explainer>
  </div>
{/if}

<style>
  .note {
    font-size: var(--font-size-sm);
    margin-bottom: var(--space-4);
  }

  .small {
    font-size: var(--font-size-sm);
  }

  .center {
    align-items: center;
  }

  .center-row {
    justify-content: center;
  }

  .wrap {
    flex-wrap: wrap;
    align-items: flex-end;
  }

  .phase {
    font-size: var(--font-size-eyebrow);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-muted-color);
  }

  .ring {
    --pct: 0%;
    display: grid;
    place-items: center;
    width: 14rem;
    height: 14rem;
    border-radius: 50%;
    background: conic-gradient(var(--color-stamp) var(--pct), var(--border-color) 0);
  }

  .ring::before {
    content: '';
    grid-area: 1 / 1;
    width: calc(14rem - 1.25rem);
    height: calc(14rem - 1.25rem);
    border-radius: 50%;
    background: var(--surface-color);
  }

  .clock {
    grid-area: 1 / 1;
    font-size: 3.2rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.04em;
  }

  .round {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .state-tag {
    font-size: var(--font-size-eyebrow);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-muted-color);
  }

  .dots {
    display: flex;
    gap: var(--space-2);
  }

  .dot {
    width: 0.8rem;
    height: 0.8rem;
    border-radius: 50%;
    border: 2px solid var(--border-strong-color);
    background: transparent;
  }

  .dot-done {
    background: var(--color-stamp);
    border-color: var(--color-stamp);
  }

  .dot-current {
    border-color: var(--color-stamp);
  }

  .num {
    width: 6rem;
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
</style>
