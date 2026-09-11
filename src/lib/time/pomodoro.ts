/**
 * Pure Pomodoro transitions. Every function returns a PATCH — the fields a
 * caller hands to `putSingleton('pomodoro', …)` — and never touches the
 * database or the clock itself (`now` and `today` are arguments), so the
 * engine, the page and the unit tests all share one piece of arithmetic.
 *
 * The cycle: work round 1 … work round N (N = rounds_before_long), each
 * followed by a short break except the last, which is followed by the long
 * break; after the long break the next cycle starts at round 1.
 */
import type { Pomodoro, SyncFields } from '../db/types';
import { remainingMs } from './duration';

export type PomodoroPhase = Pomodoro['phase'];
export type PomodoroState = Pomodoro['state'];

/** The domain fields — everything on the row except the sync bookkeeping. */
export type PomodoroFields = Omit<Pomodoro, keyof SyncFields>;

/** What a fresh page shows before the row exists (25 / 5 / 15, four rounds). */
export const POMODORO_DEFAULTS: PomodoroFields = {
  work_ms: 25 * 60_000,
  short_break_ms: 5 * 60_000,
  long_break_ms: 15 * 60_000,
  rounds_before_long: 4,
  phase: 'work',
  round: 1,
  state: 'idle',
  end_at: null,
  paused_remaining_ms: null,
  auto_advance: false,
  sound: true,
  vibrate: false,
  notify: false,
  completed_today: 0,
  completed_today_date: '',
};

/** Shortest phase the settings accept, in ms (one second). */
export const MIN_PHASE_MS = 1_000;

/** Local calendar date, YYYY-MM-DD — the tally is "today" on the user's wall
 * clock, not UTC's. */
export function localDate(now: number): string {
  const d = new Date(now);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function durationFor(row: PomodoroFields, phase: PomodoroPhase): number {
  switch (phase) {
    case 'work':
      return row.work_ms;
    case 'short_break':
      return row.short_break_ms;
    case 'long_break':
      return row.long_break_ms;
  }
}

/** Human name of a phase, as shown in the readout and the notices. */
export function phaseLabel(phase: PomodoroPhase): string {
  return phase === 'work' ? 'Focus' : phase === 'short_break' ? 'Short break' : 'Long break';
}

/** Is this work round the last one before the long break? */
export function isLastRound(row: Pick<PomodoroFields, 'round' | 'rounds_before_long'>): boolean {
  return row.round % Math.max(1, row.rounds_before_long) === 0;
}

/** Today's tally, rolling over to zero when the stored date is not today. */
export function completedToday(
  row: Pick<PomodoroFields, 'completed_today' | 'completed_today_date'>,
  today: string
): number {
  return row.completed_today_date === today ? row.completed_today : 0;
}

export interface PhasePatch {
  phase: PomodoroPhase;
  round: number;
  state: 'idle';
  end_at: null;
  paused_remaining_ms: null;
  completed_today: number;
  completed_today_date: string;
}

/**
 * Move to the next phase, parked (`idle`) with no deadline. `counts` is
 * whether a finishing work round adds to today's tally — a completion does,
 * a Skip does not. Breaks never count. The date rolls over here: whatever
 * the stored date, the tally comes back stamped `today`.
 */
export function nextPhase(row: PomodoroFields, today: string, counts = true): PhasePatch {
  const base = {
    state: 'idle' as const,
    end_at: null,
    paused_remaining_ms: null,
    completed_today_date: today,
  };
  const tally = completedToday(row, today);
  if (row.phase === 'work') {
    return {
      ...base,
      phase: isLastRound(row) ? 'long_break' : 'short_break',
      round: row.round,
      completed_today: tally + (counts ? 1 : 0),
    };
  }
  return {
    ...base,
    phase: 'work',
    round: row.phase === 'long_break' ? 1 : row.round + 1,
    completed_today: tally,
  };
}

export interface RunningPatch {
  state: 'running';
  end_at: string;
  paused_remaining_ms: null;
}

/** Start the current phase from its full duration (idle or done → running). */
export function startPhase(row: PomodoroFields, now: number): RunningPatch {
  return {
    state: 'running',
    end_at: new Date(now + durationFor(row, row.phase)).toISOString(),
    paused_remaining_ms: null,
  };
}

export interface PausedPatch {
  state: 'paused';
  end_at: null;
  paused_remaining_ms: number;
}

/** Bank what is left of the running phase (running → paused). */
export function pausePatch(row: PomodoroFields, now: number): PausedPatch {
  return {
    state: 'paused',
    end_at: null,
    paused_remaining_ms: row.end_at ? remainingMs(row.end_at, now) : durationFor(row, row.phase),
  };
}

/** Restore the banked budget as a fresh deadline (paused → running). */
export function resumePatch(row: PomodoroFields, now: number): RunningPatch {
  const budget = row.paused_remaining_ms ?? durationFor(row, row.phase);
  return { state: 'running', end_at: new Date(now + budget).toISOString(), paused_remaining_ms: null };
}

export interface ResetPatch {
  phase: 'work';
  round: 1;
  state: 'idle';
  end_at: null;
  paused_remaining_ms: null;
}

/** Back to work round 1, idle. Settings and today's tally are untouched. */
export function resetPatch(): ResetPatch {
  return { phase: 'work', round: 1, state: 'idle', end_at: null, paused_remaining_ms: null };
}

/** The banner text for the phase that just finished. */
export function completionLabel(row: Pick<PomodoroFields, 'phase' | 'round' | 'rounds_before_long'>): string {
  if (row.phase === 'work') {
    const kind = isLastRound(row) ? 'long break' : 'break';
    return `Focus round ${row.round} of ${row.rounds_before_long} done — ${kind} time`;
  }
  return 'Break over — back to work';
}
