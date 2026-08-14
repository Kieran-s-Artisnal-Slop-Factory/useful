/** Pure duration helpers for the timer and stopwatch tools. */

export interface HMS {
  hours: number;
  minutes: number;
  seconds: number;
}

export function hmsToMs({ hours, minutes, seconds }: HMS): number {
  return Math.max(0, Math.round((hours * 3600 + minutes * 60 + seconds) * 1000));
}

export function msToHms(ms: number): HMS {
  const total = Math.max(0, Math.round(ms / 1000));
  return {
    hours: Math.floor(total / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

/** 'H:MM:SS' (or 'M:SS' under an hour) — countdowns round UP so a running
 * timer never shows 0:00 before it actually fires. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return formatSeconds(total);
}

/** Stopwatch display: 'H:MM:SS.t' with tenths, rounding DOWN. */
export function formatElapsed(ms: number): string {
  const clamped = Math.max(0, ms);
  const tenths = Math.floor((clamped % 1000) / 100);
  return formatSeconds(Math.floor(clamped / 1000)) + '.' + tenths;
}

function formatSeconds(total: number): string {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Remaining budget of a running timer at `now` (clamped at 0). */
export function remainingMs(endAtIso: string, now: number): number {
  return Math.max(0, Date.parse(endAtIso) - now);
}
