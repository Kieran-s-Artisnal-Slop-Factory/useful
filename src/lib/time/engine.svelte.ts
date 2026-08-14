/**
 * The timer engine — one always-mounted instance (NotificationEngine.svelte in
 * the shared layout, `transition:persist`) that keeps alarms firing while the
 * user browses other tools. Module-level runes so any island (the timers page,
 * the engine's toasts) shares the same reactive state.
 *
 * Writes happen ONLY as consequences of explicit user actions: a completion
 * transition exists because the user started that timer. The engine never
 * writes on a tick unless a running timer's deadline has passed.
 *
 * Platform limit (documented in the plan): with no server there is no push —
 * alarms fire only while the app is open in some tab; completions that elapse
 * while closed are surfaced as "missed" on the next open.
 */
import { all, get, patch, softDelete } from '../db/repo';
import type { Timer } from '../db/types';

export interface CompletionNotice {
  id: string;
  label: string;
  /** Completed while the app was closed — surfaced on open, no sound. */
  missed: boolean;
  at: string;
}

export const engineState = $state({
  timers: [] as Timer[],
  notices: [] as CompletionNotice[],
  now: Date.now(),
});

/** A completion this overdue didn't happen "live" — the app was closed (or
 * the machine asleep) when the deadline passed, so it's surfaced as missed
 * and the sound/vibration are skipped. */
const MISSED_THRESHOLD_MS = 5_000;

export async function refreshTimers(): Promise<void> {
  engineState.timers = await all<Timer>('timers');
}

export function dismissNotice(id: string): void {
  engineState.notices = engineState.notices.filter((n) => n.id !== id);
}

/**
 * Resume/create the shared AudioContext from a user gesture (timer start), so
 * autoplay policy can't block the beep when the timer later fires.
 */
let audioCtx: AudioContext | null = null;
export function unlockAudio(): void {
  try {
    audioCtx ??= new AudioContext();
    if (audioCtx.state === 'suspended') void audioCtx.resume();
  } catch {
    audioCtx = null; // no Web Audio — sound silently unavailable
  }
}

function beep(): void {
  if (!audioCtx || audioCtx.state !== 'running') return;
  const t0 = audioCtx.currentTime;
  for (let i = 0; i < 3; i++) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, t0 + i * 0.35);
    gain.gain.exponentialRampToValueAtTime(0.2, t0 + i * 0.35 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.35 + 0.28);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t0 + i * 0.35);
    osc.stop(t0 + i * 0.35 + 0.3);
  }
}

async function showNotification(title: string, body: string, tag: string): Promise<void> {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    // Through the SW registration — new Notification() throws on Android
    // Chrome. Fall back to the constructor where no SW exists (dev builds).
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(title, { body, tag });
    else new Notification(title, { body, tag });
  } catch {
    // Notification refused by the platform — the in-app toast still shows.
  }
}

async function complete(id: string, missed: boolean): Promise<void> {
  // Re-check freshly: another tab's engine may have completed it first.
  const current = await get<Timer>('timers', id);
  if (!current || current.state !== 'running') return;
  const done = await patch<Timer>('timers', id, {
    state: 'done',
    end_at: null,
    paused_remaining_ms: null,
  });
  if (!done) return;

  engineState.notices = [
    ...engineState.notices,
    { id, label: current.label, missed, at: new Date().toISOString() },
  ];
  if (!missed) {
    if (current.sound) beep();
    if (current.vibrate && 'vibrate' in navigator) navigator.vibrate([200, 100, 200]);
  }
  if (current.notify) {
    const title = missed ? `Timer finished while you were away: ${current.label}` : `Timer done: ${current.label}`;
    await showNotification(title, 'useful — timers', 'useful-timer-' + id);
  }
  // One-shot timers clean themselves up; the banner (with the label copied
  // into the notice above) outlives the row until dismissed.
  if (current.delete_on_complete) {
    await softDelete('timers', id);
  }
  await refreshTimers();
}

let stop: (() => void) | null = null;

/** Idempotent; returns a disposer. The island calls this from $effect. */
export function startEngine(): () => void {
  if (stop) return stop;

  let cancelled = false;
  const tick = async () => {
    if (cancelled) return;
    engineState.now = Date.now();
    await refreshTimers();
    for (const t of engineState.timers) {
      if (t.state === 'running' && t.end_at && Date.parse(t.end_at) <= engineState.now) {
        const overdue = engineState.now - Date.parse(t.end_at);
        await complete(t.id, overdue > MISSED_THRESHOLD_MS);
      }
    }
  };

  void tick();
  const interval = setInterval(() => void tick(), 1000);
  stop = () => {
    cancelled = true;
    clearInterval(interval);
    stop = null;
  };
  return stop;
}
