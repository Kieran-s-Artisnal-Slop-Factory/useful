/**
 * Recurrence math for todos — pure functions over local calendar dates
 * ('YYYY-MM-DD'). The rule lives ON the todo; completing a recurring todo
 * calls nextDueDate once to date its single successor. Nothing here reads
 * clocks or stores.
 */
import type { RecurrenceRule } from '../db/types';

interface Ymd {
  y: number;
  m: number; // 1-12
  d: number;
}

function parse(date: string): Ymd {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error('not a YYYY-MM-DD date: ' + date);
  return { y: +m[1]!, m: +m[2]!, d: +m[3]! };
}

function format({ y, m, d }: Ymd): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Days in a month (m 1-12). */
function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function addDays(date: Ymd, days: number): Ymd {
  const t = Date.UTC(date.y, date.m - 1, date.d + days);
  const dt = new Date(t);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

/** Same day-of-month `months` later, clamped to the target month's end —
 * Jan 31 + 1 month = Feb 28 (or 29), never Mar 3. */
function addMonthsClamped(date: Ymd, months: number): Ymd {
  const total = date.y * 12 + (date.m - 1) + months;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return { y, m, d: Math.min(date.d, daysInMonth(y, m)) };
}

/** 0 = Sunday … 6 = Saturday, matching Date#getUTCDay. */
export function weekdayOf(date: string): number {
  const { y, m, d } = parse(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * The successor's due date, strictly after `from`.
 *
 * For 'every' rules the cadence anchors on the COMPLETED occurrence's due
 * date (donetick-style: "every 3 days" means 3 days after this one was due).
 * For 'weekdays' rules: the next listed weekday after `from`.
 */
export function nextDueDate(rule: RecurrenceRule, from: string): string {
  const base = parse(from);
  if (rule.kind === 'every') {
    const interval = Math.max(1, Math.round(rule.interval));
    if (rule.unit === 'days') return format(addDays(base, interval));
    if (rule.unit === 'weeks') return format(addDays(base, interval * 7));
    return format(addMonthsClamped(base, interval));
  }
  const days = [...new Set(rule.days)].filter((d) => d >= 0 && d <= 6);
  if (days.length === 0) return format(addDays(base, 1));
  for (let offset = 1; offset <= 7; offset++) {
    const candidate = addDays(base, offset);
    if (days.includes(new Date(Date.UTC(candidate.y, candidate.m - 1, candidate.d)).getUTCDay())) {
      return format(candidate);
    }
  }
  return format(addDays(base, 1)); // unreachable: some weekday always matches
}

/** Human label for a rule ('every 2 weeks', 'weekly on Mon, Wed'). */
export function describeRule(rule: RecurrenceRule): string {
  if (rule.kind === 'every') {
    const unit = rule.interval === 1 ? rule.unit.slice(0, -1) : rule.unit;
    return rule.interval === 1 ? `every ${unit}` : `every ${rule.interval} ${unit}`;
  }
  const NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const days = [...new Set(rule.days)].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
  return 'weekly on ' + days.map((d) => NAMES[d]).join(', ');
}
