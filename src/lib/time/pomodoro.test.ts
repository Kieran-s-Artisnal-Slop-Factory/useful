import { describe, expect, it } from 'vitest';
import {
  POMODORO_DEFAULTS,
  completedToday,
  completionLabel,
  durationFor,
  isLastRound,
  localDate,
  nextPhase,
  pausePatch,
  resetPatch,
  resumePatch,
  startPhase,
  type PomodoroFields,
} from './pomodoro';

const TODAY = '2026-09-10';
const NOW = Date.UTC(2026, 8, 10, 12, 0, 0);

function row(overrides: Partial<PomodoroFields> = {}): PomodoroFields {
  return { ...POMODORO_DEFAULTS, ...overrides };
}

describe('durationFor / isLastRound', () => {
  it('picks the phase duration', () => {
    const r = row({ work_ms: 1, short_break_ms: 2, long_break_ms: 3 });
    expect(durationFor(r, 'work')).toBe(1);
    expect(durationFor(r, 'short_break')).toBe(2);
    expect(durationFor(r, 'long_break')).toBe(3);
  });

  it('the last round is the one whose number divides by the round count', () => {
    expect(isLastRound({ round: 3, rounds_before_long: 4 })).toBe(false);
    expect(isLastRound({ round: 4, rounds_before_long: 4 })).toBe(true);
    expect(isLastRound({ round: 1, rounds_before_long: 1 })).toBe(true);
    // A nonsense zero never divides by zero.
    expect(isLastRound({ round: 1, rounds_before_long: 0 })).toBe(true);
  });
});

describe('nextPhase', () => {
  it('work → short break keeps the round and counts the completion', () => {
    const patch = nextPhase(row({ phase: 'work', round: 2 }), TODAY);
    expect(patch).toEqual({
      phase: 'short_break',
      round: 2,
      state: 'idle',
      end_at: null,
      paused_remaining_ms: null,
      completed_today: 1,
      completed_today_date: TODAY,
    });
  });

  it('the last work round goes to the long break', () => {
    const patch = nextPhase(row({ phase: 'work', round: 4, rounds_before_long: 4 }), TODAY);
    expect(patch.phase).toBe('long_break');
    expect(patch.round).toBe(4);
  });

  it('short break → work advances the round', () => {
    const patch = nextPhase(row({ phase: 'short_break', round: 2, completed_today: 2, completed_today_date: TODAY }), TODAY);
    expect(patch.phase).toBe('work');
    expect(patch.round).toBe(3);
    // Breaks never count.
    expect(patch.completed_today).toBe(2);
  });

  it('long break → work restarts the cycle at round 1', () => {
    const patch = nextPhase(row({ phase: 'long_break', round: 4 }), TODAY);
    expect(patch.phase).toBe('work');
    expect(patch.round).toBe(1);
  });

  it('a skipped work round does not count', () => {
    const patch = nextPhase(row({ phase: 'work', round: 1, completed_today: 3, completed_today_date: TODAY }), TODAY, false);
    expect(patch.phase).toBe('short_break');
    expect(patch.completed_today).toBe(3);
  });

  it('rolls the tally over on a new day', () => {
    const stale = row({ phase: 'work', round: 1, completed_today: 7, completed_today_date: '2026-09-09' });
    const patch = nextPhase(stale, TODAY);
    expect(patch.completed_today).toBe(1);
    expect(patch.completed_today_date).toBe(TODAY);
    // A break finishing on a new day resets to zero without adding.
    const staleBreak = row({ phase: 'short_break', round: 1, completed_today: 7, completed_today_date: '2026-09-09' });
    expect(nextPhase(staleBreak, TODAY).completed_today).toBe(0);
  });

  it('completedToday reads zero for a stale date', () => {
    expect(completedToday({ completed_today: 5, completed_today_date: TODAY }, TODAY)).toBe(5);
    expect(completedToday({ completed_today: 5, completed_today_date: '' }, TODAY)).toBe(0);
  });
});

describe('start / pause / resume / reset', () => {
  it('startPhase sets a deadline the full phase length away', () => {
    const patch = startPhase(row({ phase: 'short_break', short_break_ms: 300_000 }), NOW);
    expect(patch.state).toBe('running');
    expect(patch.paused_remaining_ms).toBeNull();
    expect(Date.parse(patch.end_at)).toBe(NOW + 300_000);
  });

  it('pausePatch banks what is left of the deadline', () => {
    const running = row({ state: 'running', end_at: new Date(NOW + 90_000).toISOString() });
    expect(pausePatch(running, NOW)).toEqual({ state: 'paused', end_at: null, paused_remaining_ms: 90_000 });
    // An already-passed deadline banks zero, never a negative number.
    const overdue = row({ state: 'running', end_at: new Date(NOW - 5_000).toISOString() });
    expect(pausePatch(overdue, NOW).paused_remaining_ms).toBe(0);
  });

  it('resumePatch restores the banked budget as a fresh deadline', () => {
    const paused = row({ state: 'paused', paused_remaining_ms: 42_000 });
    const patch = resumePatch(paused, NOW);
    expect(patch.state).toBe('running');
    expect(patch.paused_remaining_ms).toBeNull();
    expect(Date.parse(patch.end_at)).toBe(NOW + 42_000);
  });

  it('pause then resume round-trips the remaining time', () => {
    const running = row({ state: 'running', end_at: new Date(NOW + 600_000).toISOString() });
    const paused = { ...running, ...pausePatch(running, NOW + 10_000) };
    const resumed = { ...paused, ...resumePatch(paused, NOW + 60_000) };
    expect(Date.parse(resumed.end_at)).toBe(NOW + 60_000 + 590_000);
  });

  it('resetPatch returns to work round 1 without touching the tally', () => {
    expect(resetPatch()).toEqual({ phase: 'work', round: 1, state: 'idle', end_at: null, paused_remaining_ms: null });
    expect('completed_today' in resetPatch()).toBe(false);
  });
});

describe('labels and dates', () => {
  it('completionLabel names the round and the break kind', () => {
    expect(completionLabel({ phase: 'work', round: 2, rounds_before_long: 4 })).toBe('Focus round 2 of 4 done — break time');
    expect(completionLabel({ phase: 'work', round: 4, rounds_before_long: 4 })).toBe('Focus round 4 of 4 done — long break time');
    expect(completionLabel({ phase: 'short_break', round: 1, rounds_before_long: 4 })).toBe('Break over — back to work');
    expect(completionLabel({ phase: 'long_break', round: 4, rounds_before_long: 4 })).toBe('Break over — back to work');
  });

  it('localDate is the local calendar day, zero-padded', () => {
    const d = new Date(2026, 0, 5, 23, 30); // local time on purpose
    expect(localDate(d.getTime())).toBe('2026-01-05');
  });
});
