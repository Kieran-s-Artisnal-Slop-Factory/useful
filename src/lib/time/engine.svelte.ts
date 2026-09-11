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
import { all, get, getSingleton, patch, putSingleton, softDelete } from '../db/repo';
import { nextOccurrenceOnOrAfter } from '../scheduler/occurrences';
import type { Event as CalendarEvent, Pomodoro, Preferences, Timer, Todo } from '../db/types';
import { completionLabel, localDate, nextPhase, startPhase } from './pomodoro';

export interface CompletionNotice {
  id: string;
  /** What fired: a finished timer, a pomodoro phase, a due todo, or a
   * starting event. */
  kind: 'timer' | 'pomodoro' | 'todo' | 'event';
  label: string;
  /** Completed while the app was closed — surfaced on open, no sound. */
  missed: boolean;
  at: string;
  /** The alarm loop is still ringing/vibrating for this notice. */
  alarming: boolean;
}

/** The alarm cap: never ring longer than this, whatever preferences say. */
export const MAX_ALARM_SECONDS = 25;

interface ActiveAlarm {
  until: number;
  sound: boolean;
  vibrate: boolean;
}

/** Live completions ring until dismissed/acted-on or their deadline passes. */
const alarms = new Map<string, ActiveAlarm>();

/** Stop the ringing for one notice (dismissal, or acting on the timer). */
export function stopAlarm(id: string): void {
  if (alarms.delete(id) && 'vibrate' in navigator) navigator.vibrate(0);
  const notice = engineState.notices.find((n) => n.id === id);
  if (notice) notice.alarming = false;
}

/** The pomodoro's notice/alarm key. It is a singleton, so one fixed id — the
 * page dismisses it by this name when the user acts on the cycle. */
export const POMODORO_NOTICE_ID = 'pomodoro';

export const engineState = $state({
  timers: [] as Timer[],
  /** The pomodoro singleton, or null until the first Start creates it. */
  pomodoro: null as Pomodoro | null,
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

export async function refreshPomodoro(): Promise<void> {
  engineState.pomodoro = (await getSingleton<Pomodoro>('pomodoro')) ?? null;
}

export function dismissNotice(id: string): void {
  stopAlarm(id);
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

  await announce({
    id,
    kind: 'timer',
    label: current.label,
    missed,
    sound: current.sound,
    vibrate: current.vibrate,
    notify: current.notify,
    title: missed ? `Timer finished while you were away: ${current.label}` : `Timer done: ${current.label}`,
    body: 'useful — timers',
    tag: 'useful-timer-' + id,
  });
  // One-shot timers clean themselves up; the banner (with the label copied
  // into the notice above) outlives the row until dismissed.
  if (current.delete_on_complete) {
    await softDelete('timers', id);
  }
  await refreshTimers();
}

interface Announcement {
  id: string;
  kind: CompletionNotice['kind'];
  label: string;
  missed: boolean;
  sound: boolean;
  vibrate: boolean;
  notify: boolean;
  /** System-notification title / body / tag, used when `notify`. */
  title: string;
  body: string;
  tag: string;
}

/**
 * The completion side-effects a timer and a pomodoro phase share: the banner,
 * the first beep/buzz, the alarm-loop entry and the system notification. Pure
 * presentation — the caller has already written the row.
 */
async function announce(a: Announcement): Promise<void> {
  // Live completions keep ringing until someone dismisses the banner or acts
  // on the source — capped by the configured alarm duration.
  const prefs = await getSingleton<Preferences>('preferences');
  const alarmSeconds = Math.min(
    MAX_ALARM_SECONDS,
    Math.max(0, prefs?.timer_alarm_seconds ?? MAX_ALARM_SECONDS)
  );
  const alarming = !a.missed && (a.sound || a.vibrate) && alarmSeconds > 0;
  engineState.notices = [
    ...engineState.notices,
    { id: a.id, kind: a.kind, label: a.label, missed: a.missed, at: new Date().toISOString(), alarming },
  ];
  if (alarming) {
    alarms.set(a.id, { until: Date.now() + alarmSeconds * 1000, sound: a.sound, vibrate: a.vibrate });
  }
  if (!a.missed) {
    if (a.sound) beep();
    if (a.vibrate && 'vibrate' in navigator) navigator.vibrate([200, 100, 200]);
  }
  if (a.notify) await showNotification(a.title, a.body, a.tag);
}

/**
 * A pomodoro phase's deadline has passed. One write: the row moves to the
 * next phase, and either starts it (`auto_advance`, live completions only —
 * a phase that ended while the app was closed is not a reason to start a
 * break now) or parks it in `done` until the user presses Start.
 */
async function completePomodoro(missed: boolean): Promise<void> {
  // Re-check freshly: another tab's engine may have completed it first.
  const current = await getSingleton<Pomodoro>('pomodoro');
  if (!current || current.state !== 'running') return;
  const label = completionLabel(current);
  const now = Date.now();
  const advanced = nextPhase(current, localDate(now));
  const auto = current.auto_advance && !missed;
  await putSingleton<Partial<Pomodoro>>('pomodoro', {
    ...advanced,
    ...(auto ? startPhase({ ...current, ...advanced }, now) : { state: 'done' as const }),
  });
  // Dismissing here (not just stopping) so an auto-advanced cycle never
  // stacks a banner per phase: the newest label replaces the last one.
  engineState.notices = engineState.notices.filter((n) => n.id !== POMODORO_NOTICE_ID);
  alarms.delete(POMODORO_NOTICE_ID);
  await announce({
    id: POMODORO_NOTICE_ID,
    kind: 'pomodoro',
    label,
    missed,
    sound: current.sound,
    vibrate: current.vibrate,
    notify: current.notify,
    title: missed ? `Pomodoro finished while you were away: ${label}` : `Pomodoro: ${label}`,
    body: 'useful — pomodoro',
    tag: 'useful-pomodoro',
  });
  await refreshPomodoro();
}

/**
 * Scheduler due-time notifications. Fired keys are in-memory only: no row is
 * written when a due moment passes (page loads must write nothing), so a
 * full reload can re-notify — the fire window below keeps that to items due
 * within the last minute.
 */
const firedDue = new Set<string>();
const DUE_FIRE_WINDOW_MS = 60_000;

async function scanDue(now: number): Promise<void> {
  const [todos, events] = await Promise.all([all<Todo>('todos'), all<CalendarEvent>('events')]);
  for (const t of todos) {
    if (!t.notify || t.status === 'completed' || !t.due_date || !t.due_time) continue;
    const due = new Date(`${t.due_date}T${t.due_time}`).getTime();
    const key = `todo:${t.id}:${t.due_date}T${t.due_time}`;
    if (Number.isNaN(due) || now < due || now - due > DUE_FIRE_WINDOW_MS || firedDue.has(key)) continue;
    firedDue.add(key);
    engineState.notices = [
      ...engineState.notices,
      { id: t.id, kind: 'todo', label: t.title, missed: false, at: new Date().toISOString(), alarming: false },
    ];
    await showNotification('Due now: ' + t.title, 'useful — scheduler', 'useful-todo-' + t.id);
  }
  // Instants a series has handed to a detached override: the override row is
  // scanned in its own right, so firing the series' version too would notify
  // twice for the same meeting.
  const overridden = new Map<string, Set<string>>();
  for (const ev of events) {
    if (ev.series_id && ev.original_start) {
      const set = overridden.get(ev.series_id) ?? new Set<string>();
      set.add(ev.original_start);
      overridden.set(ev.series_id, set);
    }
  }

  for (const ev of events) {
    if (!ev.notify) continue;
    // A recurring event has no single start to compare against, so ask for the
    // one it is closest to. Looking from the start of the fire window means a
    // moment that has just passed is still found.
    const start = nextOccurrenceOnOrAfter(ev, now - DUE_FIRE_WINDOW_MS, undefined, overridden.get(ev.id));
    if (start === null) continue;
    const startIso = new Date(start).toISOString();
    // Keyed per OCCURRENCE, so next week's meeting is a separate notice.
    const key = `event:${ev.id}:${startIso}`;
    if (now < start || now - start > DUE_FIRE_WINDOW_MS || firedDue.has(key)) continue;
    firedDue.add(key);
    engineState.notices = [
      ...engineState.notices,
      {
        id: `${ev.id}@${startIso}`,
        kind: 'event',
        label: ev.title,
        missed: false,
        at: new Date().toISOString(),
        alarming: false,
      },
    ];
    await showNotification('Starting now: ' + ev.title, 'useful — scheduler', `useful-event-${ev.id}@${startIso}`);
  }
}

let stop: (() => void) | null = null;

/**
 * Stop the tick, if one is running. Exposed for the test hook rather than for
 * the app: a suite that rebuilds the database at an older schema version has
 * to stop this first, because every tick reads through repo.ts and so REOPENS
 * the database — which blocks `indexedDB.deleteDatabase` for as long as the
 * tab lives. The islands call the disposer `startEngine` returns instead.
 */
export function stopEngine(): void {
  stop?.();
}

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
    await refreshPomodoro();
    const p = engineState.pomodoro;
    if (p && p.state === 'running' && p.end_at && Date.parse(p.end_at) <= engineState.now) {
      const overdue = engineState.now - Date.parse(p.end_at);
      await completePomodoro(overdue > MISSED_THRESHOLD_MS);
    }
    await scanDue(engineState.now);
    // Keep active alarms ringing; retire the expired ones.
    for (const [id, alarm] of alarms) {
      const notice = engineState.notices.find((n) => n.id === id);
      if (!notice || engineState.now >= alarm.until) {
        stopAlarm(id);
        continue;
      }
      if (alarm.sound) beep();
      if (alarm.vibrate && 'vibrate' in navigator) navigator.vibrate([300, 150, 300]);
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
