/**
 * The form-shaped view of a recurrence rule, shared by TODOs and events.
 *
 * A `RecurrenceRule` is a tagged union with optional members; a form needs a
 * flat, always-present set of fields. These two functions are the only place
 * that conversion happens, so the two kinds of recurrence cannot drift apart.
 */
import type { RecurrenceRule } from '../db/types';

export interface RecurDraft {
  recur: 'none' | 'every' | 'weekdays';
  every_interval: number;
  every_unit: 'days' | 'weeks' | 'months';
  weekdays: number[];
  /** Inclusive local end date 'YYYY-MM-DD'; '' = forever. */
  until: string;
}

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** A blank draft, or the draft that reproduces an existing rule. */
export function ruleToDraft(rule: RecurrenceRule | null | undefined): RecurDraft {
  const usable = rule && typeof rule === 'object' && !Array.isArray(rule) ? rule : null;
  return {
    recur: usable === null ? 'none' : usable.kind === 'weekdays' ? 'weekdays' : 'every',
    every_interval: usable?.kind === 'every' ? usable.interval : 1,
    every_unit: usable?.kind === 'every' ? usable.unit : 'days',
    weekdays: usable?.kind === 'weekdays' ? [...usable.days] : [],
    until: usable?.until ?? '',
  };
}

/**
 * The rule a draft describes, or null for "never".
 *
 * There is deliberately no occurrence COUNT alongside `until`: events expand
 * virtually on every render, so honouring "12 times" would mean counting from
 * the anchor every time anything drew.
 */
export function draftToRule(draft: RecurDraft): RecurrenceRule | null {
  const until = /^\d{4}-\d{2}-\d{2}$/.test(draft.until) ? draft.until : null;
  if (draft.recur === 'every') {
    return {
      kind: 'every',
      interval: Math.max(1, Math.round(+draft.every_interval || 1)),
      unit: draft.every_unit,
      until,
    };
  }
  if (draft.recur === 'weekdays') {
    return draft.weekdays.length > 0
      ? { kind: 'weekdays', days: [...new Set(draft.weekdays)].sort((a, b) => a - b), until }
      : null;
  }
  return null;
}
