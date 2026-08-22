/**
 * When does this expression next run? (0.3.0 phase 10)
 *
 * Computed in the **local** timezone, using local Date arithmetic, because
 * that is what cron does: crond reads the machine's clock, not UTC. The page
 * says whose zone it is showing, since a schedule that is right on your laptop
 * can be six hours out on the server.
 *
 * The walk skips rather than ticks. A minute-by-minute scan would need half a
 * million iterations to discover that `0 0 30 2 *` never runs; skipping a
 * whole month when the month does not match answers that in a few dozen.
 *
 * Two facts fall out of using local time, and both are honest rather than
 * accidental:
 *  - a time that does not exist (02:30 on the morning the clocks go forward)
 *    is skipped, which is what cron does;
 *  - a time that happens twice (the morning they go back) is listed once,
 *    which is what most crons do, and is called out on the page.
 */
import type { CronExpression } from './parse';

/** How far ahead the search gives up. A schedule with no run inside ten years
 * is a schedule that never runs, for every practical purpose — and ten rather
 * than five so a 29 February job still shows more than one run. */
export const SEARCH_YEARS = 10;

/**
 * Does this expression run on this date?
 *
 * The day-of-month / day-of-week rule is the whole function: when BOTH fields
 * are restricted, cron runs when EITHER matches. Every other combination is
 * an AND. This is the single most misread line in crontab(5).
 */
export function dayMatches(expr: CronExpression, date: Date): boolean {
  const dom = expr.dom.values.includes(date.getDate());
  const dow = expr.dow.values.includes(date.getDay());
  if (expr.domDowOr) return dom || dow;
  return dom && dow;
}

export function matches(expr: CronExpression, date: Date): boolean {
  return (
    expr.minute.values.includes(date.getMinutes()) &&
    expr.hour.values.includes(date.getHours()) &&
    expr.month.values.includes(date.getMonth() + 1) &&
    dayMatches(expr, date)
  );
}

/**
 * The next `count` runs strictly after `from`.
 *
 * Returns fewer (or none) when the expression has no run left inside
 * {@link SEARCH_YEARS} — `0 0 30 2 *` is a real expression that a real person
 * writes, and it never runs.
 */
export function nextRuns(expr: CronExpression, from: Date, count = 5): Date[] {
  const out: Date[] = [];
  if (expr.reboot || count <= 0) return out;

  const deadline = new Date(from);
  deadline.setFullYear(deadline.getFullYear() + SEARCH_YEARS);

  const cursor = new Date(from);
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  // A generous ceiling on the skipping loop: each pass either produces a run
  // or advances at least a minute, and most passes advance a day or a month.
  for (let guard = 0; guard < 200_000 && out.length < count; guard++) {
    if (cursor.getTime() > deadline.getTime()) break;

    if (!expr.month.values.includes(cursor.getMonth() + 1)) {
      cursor.setMonth(cursor.getMonth() + 1, 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }
    if (!dayMatches(expr, cursor)) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }
    if (!expr.hour.values.includes(cursor.getHours())) {
      cursor.setHours(cursor.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (!expr.minute.values.includes(cursor.getMinutes())) {
      cursor.setMinutes(cursor.getMinutes() + 1, 0, 0);
      continue;
    }

    out.push(new Date(cursor));
    cursor.setMinutes(cursor.getMinutes() + 1, 0, 0);
  }

  return out;
}

/** "in 3 hours", "in 2 days" — the gap that makes a timestamp mean something. */
export function relativeTo(from: Date, when: Date): string {
  const seconds = Math.round((when.getTime() - from.getTime()) / 1000);
  if (seconds < 0) return 'in the past';
  if (seconds < 60) return 'in under a minute';
  const units: [number, string][] = [
    [60, 'minute'],
    [3600, 'hour'],
    [86400, 'day'],
    [604800, 'week'],
  ];
  let chosen: [number, string] = units[0]!;
  for (const unit of units) if (seconds >= unit[0]) chosen = unit;
  const n = Math.round(seconds / chosen[0]);
  return `in ${n} ${chosen[1]}${n === 1 ? '' : 's'}`;
}
