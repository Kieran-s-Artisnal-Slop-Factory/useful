/**
 * Occurrence expansion for recurring EVENTS — pure functions over the event
 * rows, reading no clock and writing nothing.
 *
 * Why events differ from todos: a recurring todo spawns its successor when it
 * is COMPLETED (see recurrence.ts), which is a user action and therefore a
 * legitimate moment to write a row. Events are never completed, so there is no
 * such moment — the only trigger available would be page load, and loading a
 * page must not write. Occurrences are therefore VIRTUAL: computed here on
 * every render and on every notification scan, never stored.
 *
 * The model is iCal's, mapped onto the store we already have:
 *
 *   - the series row carries `recurrence` (and optionally `recurrence.until`);
 *     its `start` is the anchor and the first candidate occurrence;
 *   - `exdates` on the series lists occurrence instants that were cancelled;
 *   - a single edited occurrence becomes its own ordinary row ("detached")
 *     carrying `series_id` (the parent) and `original_start` (the instant it
 *     replaces). It renders as itself and suppresses the parent's occurrence.
 *
 * Stepping happens on LOCAL CALENDAR DATES in the device's current zone, and
 * the anchor's wall time is re-applied to each one. That is what keeps a 09:00
 * weekly meeting at 09:00 across a DST boundary even though its UTC instant
 * moves by an hour. (Q1: the zone is the device's, not a stored one — a
 * traveller sees the series at their new local wall time.)
 *
 * Month stepping always counts from the ANCHOR, never from the previous
 * occurrence, so "every month" from the 31st gives Feb 28, Mar 31, Apr 30 —
 * not Feb 28, Mar 28, Apr 28.
 */
import type { Event as CalendarEvent, RecurrenceRule } from '../db/types';
import { currentZone, wallTimeToInstant, zoneOffsetMinutes } from '../time/timezone';

/** One instance of an event on the calendar. */
export interface Occurrence {
  /** The row that supplies the display fields — the series row, or the
   * detached row that overrides this instance. */
  event: CalendarEvent;
  /** The series row's id: the identity of the whole series, for grouping. */
  seriesId: string;
  /** UTC ISO start of THIS instance. */
  start: string;
  /** UTC ISO end of this instance, or null when the event has no end. */
  end: string | null;
  /** The series instant this instance stands in for — null unless detached. */
  originalStart: string | null;
  /** True when a detached row supplies the fields (this one was edited alone). */
  detached: boolean;
}

/**
 * A hard ceiling on how many instances one series contributes to one range.
 * A daily rule anchored years ago is cheap to jump into, but a corrupt rule
 * (interval 0, a range of a century) must not be able to hang a render. The
 * month grid asks for ~6 weeks and the widest view is a year, so anything
 * beyond this is a bug, not a calendar.
 */
export const MAX_OCCURRENCES = 1000;

interface Ymd {
  y: number;
  m: number;
  d: number;
}

const parseYmd = (date: string): Ymd => ({
  y: +date.slice(0, 4),
  m: +date.slice(5, 7),
  d: +date.slice(8, 10),
});

const formatYmd = ({ y, m, d }: Ymd): string =>
  `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Days since the epoch for a calendar date — stepping and differencing unit. */
const dayNumber = ({ y, m, d }: Ymd): number => Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);

const fromDayNumber = (n: number): Ymd => {
  const dt = new Date(n * 86_400_000);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
};

const addMonthsClamped = ({ y, m, d }: Ymd, months: number): Ymd => {
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return { y: ny, m: nm, d: Math.min(d, daysInMonth(ny, nm)) };
};

const weekdayOfYmd = ({ y, m, d }: Ymd): number => new Date(Date.UTC(y, m - 1, d)).getUTCDay();

/** The wall-clock fields an instant shows in `zone`. */
export function wallOf(atMs: number, zone: string): { date: Ymd; hour: number; minute: number } {
  const shifted = new Date(atMs + zoneOffsetMinutes(zone, atMs) * 60_000);
  return {
    date: {
      y: shifted.getUTCFullYear(),
      m: shifted.getUTCMonth() + 1,
      d: shifted.getUTCDate(),
    },
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

/**
 * How far past the whole minute the anchor sits, in ms.
 *
 * Wall-time stepping works in hours and minutes, so an event at 09:30:42 would
 * otherwise recur at 09:30:00. Re-adding the anchor's own residue reproduces it
 * exactly — and it is zero for the whole-minute times the UI can produce, so it
 * changes nothing for anything a person typed.
 */
function subMinuteMs(startMs: number, wall: { date: Ymd; hour: number; minute: number }, zone: string): number {
  const onTheMinute = wallTimeToInstant(
    { year: wall.date.y, month: wall.date.m, day: wall.date.d, hour: wall.hour, minute: wall.minute },
    zone
  );
  const residue = startMs - onTheMinute;
  // Guard against a zone whose offset is not a whole minute (historic zones
  // are, some by seconds): anything outside one minute is not a residue.
  return residue >= 0 && residue < 60_000 ? residue : 0;
}

/** A rule we can actually step. Anything else expands to nothing. */
export function isUsableRule(rule: unknown): rule is RecurrenceRule {
  if (typeof rule !== 'object' || rule === null || Array.isArray(rule)) return false;
  const r = rule as Partial<RecurrenceRule> & { kind?: unknown };
  if (r.kind === 'every') {
    const every = r as Extract<RecurrenceRule, { kind: 'every' }>;
    return (
      typeof every.interval === 'number' &&
      Number.isFinite(every.interval) &&
      every.interval >= 1 &&
      (every.unit === 'days' || every.unit === 'weeks' || every.unit === 'months')
    );
  }
  if (r.kind === 'weekdays') {
    const wd = r as Extract<RecurrenceRule, { kind: 'weekdays' }>;
    return Array.isArray(wd.days) && wd.days.some((d) => typeof d === 'number' && d >= 0 && d <= 6);
  }
  return false;
}

/** `until` as a day number (inclusive), or null when the series never ends. */
function untilDay(rule: RecurrenceRule): number | null {
  const raw = (rule as { until?: string | null }).until;
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  return dayNumber(parseYmd(raw));
}

/** Step size in days for day/week rules; null for month and weekday rules. */
function stepDays(rule: RecurrenceRule): number | null {
  if (rule.kind !== 'every') return null;
  const interval = Math.max(1, Math.round(rule.interval));
  if (rule.unit === 'days') return interval;
  if (rule.unit === 'weeks') return interval * 7;
  return null;
}

/**
 * The local dates a rule fires on, from `fromDay` to `toDay` inclusive
 * (day numbers), anchored at `anchor`. Occurrences before the anchor never
 * exist — the anchor IS the first one.
 */
function ruleDates(rule: RecurrenceRule, anchor: Ymd, fromDay: number, toDay: number): Ymd[] {
  const out: Ymd[] = [];
  const anchorDay = dayNumber(anchor);
  const end = Math.min(toDay, untilDay(rule) ?? Number.POSITIVE_INFINITY);
  if (end < anchorDay || end < fromDay) return out;

  if (rule.kind === 'weekdays') {
    const days = new Set(rule.days.filter((d) => typeof d === 'number' && d >= 0 && d <= 6));
    if (days.size === 0) return out;
    // The anchor's own date always counts, even if its weekday is not listed:
    // it is the event the user actually created, and hiding it would delete
    // something they can see.
    if (anchorDay >= fromDay && anchorDay <= end) out.push(anchor);
    for (let day = Math.max(fromDay, anchorDay + 1); day <= end; day++) {
      const date = fromDayNumber(day);
      if (days.has(weekdayOfYmd(date))) out.push(date);
      if (out.length >= MAX_OCCURRENCES) break;
    }
    return out;
  }

  const step = stepDays(rule);
  if (step !== null) {
    // Jump straight to the first index inside the window instead of walking
    // from an anchor that may be years back.
    const firstIndex = Math.max(0, Math.ceil((fromDay - anchorDay) / step));
    for (let i = firstIndex; out.length < MAX_OCCURRENCES; i++) {
      const day = anchorDay + i * step;
      if (day > end) break;
      out.push(fromDayNumber(day));
    }
    return out;
  }

  // Months: step by index from the anchor so clamping never compounds.
  const interval = Math.max(1, Math.round((rule as Extract<RecurrenceRule, { kind: 'every' }>).interval));
  const fromYmd = fromDayNumber(Math.max(fromDay, anchorDay));
  const monthsApart = (fromYmd.y - anchor.y) * 12 + (fromYmd.m - anchor.m);
  const firstIndex = Math.max(0, Math.floor(monthsApart / interval) - 1);
  for (let i = firstIndex; out.length < MAX_OCCURRENCES; i++) {
    const date = addMonthsClamped(anchor, i * interval);
    const day = dayNumber(date);
    if (day > end) break;
    if (day >= fromDay && day >= anchorDay) out.push(date);
    // Guard: a pathological interval could otherwise spin.
    if (i > MAX_OCCURRENCES * 2) break;
  }
  return out;
}

/** Is this row a series parent (something to expand) rather than a one-off? */
export function isSeries(ev: CalendarEvent): boolean {
  return ev.recurrence != null && isUsableRule(ev.recurrence);
}

const exdatesOf = (ev: CalendarEvent): string[] =>
  Array.isArray(ev.exdates) ? ev.exdates.filter((x): x is string => typeof x === 'string') : [];

/**
 * Every occurrence of every event that overlaps [fromMs, toMs).
 *
 * Pass the whole event list: detached overrides live in it and have to shadow
 * their parent's instance, which cannot be decided one row at a time.
 */
export function occurrencesBetween(
  events: CalendarEvent[],
  fromMs: number,
  toMs: number,
  zone: string = currentZone()
): Occurrence[] {
  const out: Occurrence[] = [];
  // Instants each series has handed to a detached row.
  const overridden = new Map<string, Set<string>>();
  for (const ev of events) {
    if (ev.series_id && ev.original_start) {
      const set = overridden.get(ev.series_id) ?? new Set<string>();
      set.add(ev.original_start);
      overridden.set(ev.series_id, set);
    }
  }

  for (const ev of events) {
    const startMs = Date.parse(ev.start);
    if (Number.isNaN(startMs)) continue;
    const durationMs = ev.end ? Math.max(0, Date.parse(ev.end) - startMs) : null;

    // A detached row, and any plain event, is simply itself.
    if (!isSeries(ev)) {
      const endMs = durationMs === null ? null : startMs + durationMs;
      if (startMs < toMs && (endMs ?? startMs) >= fromMs) {
        out.push({
          event: ev,
          seriesId: ev.series_id ?? ev.id,
          start: ev.start,
          end: ev.end,
          originalStart: ev.original_start ?? null,
          detached: ev.series_id != null,
        });
      }
      continue;
    }

    const skip = new Set(exdatesOf(ev));
    const taken = overridden.get(ev.id) ?? new Set<string>();
    const anchorWall = wallOf(startMs, zone);
    const residueMs = subMinuteMs(startMs, anchorWall, zone);
    // Widen the query window by the event's own length so a long occurrence
    // that STARTED before the window is still on screen while it runs.
    const searchFrom = fromMs - (durationMs ?? 0);
    const rule = ev.recurrence as RecurrenceRule;
    const dates = ruleDates(
      rule,
      anchorWall.date,
      dayNumber(wallOf(searchFrom, zone).date),
      dayNumber(wallOf(toMs, zone).date)
    );

    for (const date of dates) {
      const at =
        wallTimeToInstant(
          { year: date.y, month: date.m, day: date.d, hour: anchorWall.hour, minute: anchorWall.minute },
          zone
        ) + residueMs;
      if (at >= toMs) continue;
      const endAt = durationMs === null ? null : at + durationMs;
      if ((endAt ?? at) < fromMs) continue;
      const iso = new Date(at).toISOString();
      if (skip.has(iso) || taken.has(iso)) continue;
      out.push({
        event: ev,
        seriesId: ev.id,
        start: iso,
        end: endAt === null ? null : new Date(endAt).toISOString(),
        originalStart: null,
        detached: false,
      });
    }
  }

  out.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  return out;
}

/**
 * The first instant at or after `ms` that this event fires, or null.
 *
 * Used by the notification tick, which runs every second over every event, so
 * it jumps arithmetically to the right index rather than expanding a range.
 * Cancelled instants (`exdates`) and instants an override has taken are
 * skipped — the override row is scanned in its own right.
 */
export function nextOccurrenceOnOrAfter(
  ev: CalendarEvent,
  ms: number,
  zone: string = currentZone(),
  overriddenStarts: ReadonlySet<string> = new Set()
): number | null {
  const startMs = Date.parse(ev.start);
  if (Number.isNaN(startMs)) return null;
  if (!isSeries(ev)) return startMs >= ms ? startMs : null;

  const skip = new Set(exdatesOf(ev));
  const anchorWall = wallOf(startMs, zone);
  const residueMs = subMinuteMs(startMs, anchorWall, zone);
  // One day of slack on each side: the wall-time re-application can move an
  // instant across a local midnight relative to a naive day comparison.
  const fromDay = dayNumber(wallOf(ms, zone).date) - 1;
  const rule = ev.recurrence as RecurrenceRule;
  const horizon = fromDay + 366 * 2;
  const dates = ruleDates(rule, anchorWall.date, fromDay, horizon);

  for (const date of dates) {
    const at =
      wallTimeToInstant(
        { year: date.y, month: date.m, day: date.d, hour: anchorWall.hour, minute: anchorWall.minute },
        zone
      ) + residueMs;
    if (at < ms) continue;
    const iso = new Date(at).toISOString();
    if (skip.has(iso) || overriddenStarts.has(iso)) continue;
    return at;
  }
  return null;
}
