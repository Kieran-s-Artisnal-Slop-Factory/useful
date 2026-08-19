import { describe, expect, it } from 'vitest';
import type { Event as CalendarEvent, RecurrenceRule } from '../db/types';
import {
  isSeries,
  isUsableRule,
  MAX_OCCURRENCES,
  nextOccurrenceOnOrAfter,
  occurrencesBetween,
} from './occurrences';

/** A minimal event row; only the fields the expander reads matter. */
function ev(partial: Partial<CalendarEvent> & { start: string }): CalendarEvent {
  return {
    id: partial.id ?? 'e1',
    updated_at: '2026-01-01T00:00:00.000Z',
    deleted_at: null,
    server_seq: null,
    title: partial.title ?? 'Event',
    description_md: '',
    end: partial.end ?? null,
    all_day: partial.all_day ?? false,
    notify: partial.notify ?? false,
    recurrence: partial.recurrence ?? null,
    exdates: partial.exdates ?? [],
    series_id: partial.series_id ?? null,
    original_start: partial.original_start ?? null,
    ...partial,
  } as CalendarEvent;
}

const ms = (iso: string): number => Date.parse(iso);
const starts = (list: { start: string }[]): string[] => list.map((o) => o.start);

/** A zone with DST (northern) and one without, to separate the two effects. */
const TORONTO = 'America/Toronto';
const UTC = 'UTC';

describe('isUsableRule', () => {
  it('accepts the two rule shapes', () => {
    expect(isUsableRule({ kind: 'every', interval: 1, unit: 'days' })).toBe(true);
    expect(isUsableRule({ kind: 'weekdays', days: [1, 3] })).toBe(true);
  });

  it('rejects anything the generic data suite might put in that column', () => {
    // The round-trip harness writes an ARRAY into every json column; a parser
    // that threw on one would take unrelated suites down with it.
    expect(isUsableRule(['a', 'b', 'ünï 😀', 3])).toBe(false);
    expect(isUsableRule(null)).toBe(false);
    expect(isUsableRule(undefined)).toBe(false);
    expect(isUsableRule('every day')).toBe(false);
    expect(isUsableRule({})).toBe(false);
    expect(isUsableRule({ kind: 'every', interval: 0, unit: 'days' })).toBe(false);
    expect(isUsableRule({ kind: 'every', interval: 1, unit: 'fortnights' })).toBe(false);
    expect(isUsableRule({ kind: 'weekdays', days: [] })).toBe(false);
    expect(isUsableRule({ kind: 'weekdays', days: [9] })).toBe(false);
  });

  it('a malformed rule expands to nothing instead of throwing', () => {
    const bad = ev({ start: '2026-03-02T14:00:00.000Z', recurrence: ['x'] as unknown as RecurrenceRule });
    expect(isSeries(bad)).toBe(false);
    // It still renders as the one-off event it structurally is.
    const out = occurrencesBetween([bad], ms('2026-03-01T00:00:00Z'), ms('2026-04-01T00:00:00Z'), UTC);
    expect(starts(out)).toEqual(['2026-03-02T14:00:00.000Z']);
  });
});

describe('occurrencesBetween — plain events', () => {
  it('returns a one-off inside the window and nothing outside it', () => {
    const e = ev({ start: '2026-03-10T15:00:00.000Z' });
    expect(
      starts(occurrencesBetween([e], ms('2026-03-01T00:00:00Z'), ms('2026-04-01T00:00:00Z'), UTC))
    ).toEqual(['2026-03-10T15:00:00.000Z']);
    expect(
      occurrencesBetween([e], ms('2026-04-01T00:00:00Z'), ms('2026-05-01T00:00:00Z'), UTC)
    ).toHaveLength(0);
  });

  it('keeps an event on screen while it is still running', () => {
    // Starts before the window, ends inside it.
    const e = ev({ start: '2026-03-09T22:00:00.000Z', end: '2026-03-10T02:00:00.000Z' });
    const out = occurrencesBetween([e], ms('2026-03-10T00:00:00Z'), ms('2026-03-11T00:00:00Z'), UTC);
    expect(out).toHaveLength(1);
  });
});

describe('occurrencesBetween — daily and weekly', () => {
  it('expands a daily rule from its anchor', () => {
    const e = ev({ start: '2026-03-02T09:00:00.000Z', recurrence: { kind: 'every', interval: 1, unit: 'days' } });
    const out = occurrencesBetween([e], ms('2026-03-01T00:00:00Z'), ms('2026-03-06T00:00:00Z'), UTC);
    expect(starts(out)).toEqual([
      '2026-03-02T09:00:00.000Z',
      '2026-03-03T09:00:00.000Z',
      '2026-03-04T09:00:00.000Z',
      '2026-03-05T09:00:00.000Z',
    ]);
  });

  it('never produces an occurrence before the anchor', () => {
    const e = ev({ start: '2026-03-10T09:00:00.000Z', recurrence: { kind: 'every', interval: 1, unit: 'days' } });
    const out = occurrencesBetween([e], ms('2026-03-01T00:00:00Z'), ms('2026-03-12T00:00:00Z'), UTC);
    expect(out[0]!.start).toBe('2026-03-10T09:00:00.000Z');
  });

  it('keeps interval > 1 aligned to the anchor, not to the window', () => {
    // Every 3 days from Mar 2: 2, 5, 8, 11, 14… A window starting Mar 9 must
    // still land on 11 and 14, not on 9 and 12.
    const e = ev({ start: '2026-03-02T09:00:00.000Z', recurrence: { kind: 'every', interval: 3, unit: 'days' } });
    const out = occurrencesBetween([e], ms('2026-03-09T00:00:00Z'), ms('2026-03-16T00:00:00Z'), UTC);
    expect(starts(out)).toEqual([
      '2026-03-11T09:00:00.000Z',
      '2026-03-14T09:00:00.000Z',
    ]);
  });

  it('expands weeks as 7-day steps', () => {
    const e = ev({ start: '2026-03-02T09:00:00.000Z', recurrence: { kind: 'every', interval: 2, unit: 'weeks' } });
    const out = occurrencesBetween([e], ms('2026-03-01T00:00:00Z'), ms('2026-04-15T00:00:00Z'), UTC);
    expect(starts(out)).toEqual([
      '2026-03-02T09:00:00.000Z',
      '2026-03-16T09:00:00.000Z',
      '2026-03-30T09:00:00.000Z',
      '2026-04-13T09:00:00.000Z',
    ]);
  });
});

describe('occurrencesBetween — weekdays', () => {
  it('fires on the listed weekdays after the anchor', () => {
    // 2026-03-02 is a Monday. Mondays and Wednesdays.
    const e = ev({ start: '2026-03-02T09:00:00.000Z', recurrence: { kind: 'weekdays', days: [1, 3] } });
    const out = occurrencesBetween([e], ms('2026-03-01T00:00:00Z'), ms('2026-03-13T00:00:00Z'), UTC);
    expect(starts(out)).toEqual([
      '2026-03-02T09:00:00.000Z', // Mon
      '2026-03-04T09:00:00.000Z', // Wed
      '2026-03-09T09:00:00.000Z', // Mon
      '2026-03-11T09:00:00.000Z', // Wed
    ]);
  });

  it('keeps the anchor itself even when its weekday is not listed', () => {
    // Anchored on a Monday but repeating on Fridays: the event the user
    // actually created must not vanish.
    const e = ev({ start: '2026-03-02T09:00:00.000Z', recurrence: { kind: 'weekdays', days: [5] } });
    const out = occurrencesBetween([e], ms('2026-03-01T00:00:00Z'), ms('2026-03-10T00:00:00Z'), UTC);
    expect(starts(out)).toEqual([
      '2026-03-02T09:00:00.000Z', // the anchor
      '2026-03-06T09:00:00.000Z', // Fri
    ]);
  });
});

describe('occurrencesBetween — months clamp from the anchor', () => {
  it('clamps to the end of a short month without re-anchoring', () => {
    // From Jan 31: Feb 28 (2026 is not a leap year), then Mar 31 — NOT Mar 28.
    const e = ev({ start: '2026-01-31T12:00:00.000Z', recurrence: { kind: 'every', interval: 1, unit: 'months' } });
    const out = occurrencesBetween([e], ms('2026-01-01T00:00:00Z'), ms('2026-05-01T00:00:00Z'), UTC);
    expect(starts(out)).toEqual([
      '2026-01-31T12:00:00.000Z',
      '2026-02-28T12:00:00.000Z',
      '2026-03-31T12:00:00.000Z',
      '2026-04-30T12:00:00.000Z',
    ]);
  });

  it('finds February 29 in a leap year', () => {
    const e = ev({ start: '2024-01-31T12:00:00.000Z', recurrence: { kind: 'every', interval: 1, unit: 'months' } });
    const out = occurrencesBetween([e], ms('2024-02-01T00:00:00Z'), ms('2024-03-01T00:00:00Z'), UTC);
    expect(starts(out)).toEqual(['2024-02-29T12:00:00.000Z']);
  });

  it('handles a window years after the anchor', () => {
    const e = ev({ start: '2020-06-15T12:00:00.000Z', recurrence: { kind: 'every', interval: 6, unit: 'months' } });
    const out = occurrencesBetween([e], ms('2026-01-01T00:00:00Z'), ms('2027-01-01T00:00:00Z'), UTC);
    expect(starts(out)).toEqual([
      '2026-06-15T12:00:00.000Z',
      '2026-12-15T12:00:00.000Z',
    ]);
  });
});

describe('occurrencesBetween — DST', () => {
  it('keeps the wall time across a spring-forward', () => {
    // 09:00 in Toronto on Mar 6 2026 is 14:00Z (EST, UTC-5). After the Mar 8
    // transition it is 13:00Z (EDT, UTC-4) — the same 09:00 on the clock.
    const e = ev({ start: '2026-03-06T14:00:00.000Z', recurrence: { kind: 'every', interval: 1, unit: 'days' } });
    const out = occurrencesBetween([e], ms('2026-03-06T00:00:00Z'), ms('2026-03-11T00:00:00Z'), TORONTO);
    expect(starts(out)).toEqual([
      '2026-03-06T14:00:00.000Z',
      '2026-03-07T14:00:00.000Z',
      '2026-03-08T13:00:00.000Z', // clocks jumped; 09:00 local is an hour earlier in UTC
      '2026-03-09T13:00:00.000Z',
      '2026-03-10T13:00:00.000Z',
    ]);
  });

  it('keeps the wall time across a fall-back', () => {
    // Nov 1 2026 is the fall-back in Toronto: 09:00 EDT = 13:00Z before,
    // 09:00 EST = 14:00Z after.
    const e = ev({ start: '2026-10-30T13:00:00.000Z', recurrence: { kind: 'every', interval: 1, unit: 'days' } });
    const out = occurrencesBetween([e], ms('2026-10-30T00:00:00Z'), ms('2026-11-04T00:00:00Z'), TORONTO);
    expect(starts(out)).toEqual([
      '2026-10-30T13:00:00.000Z',
      '2026-10-31T13:00:00.000Z',
      '2026-11-01T14:00:00.000Z',
      '2026-11-02T14:00:00.000Z',
      '2026-11-03T14:00:00.000Z',
    ]);
  });

  it('an anchor inside the skipped hour resolves consistently', () => {
    // 02:30 local does not exist on a spring-forward morning. It resolves to
    // the post-transition reading; the series must still produce one
    // occurrence per day and never a duplicate or a gap.
    const e = ev({ start: '2026-03-06T07:30:00.000Z', recurrence: { kind: 'every', interval: 1, unit: 'days' } });
    const out = occurrencesBetween([e], ms('2026-03-06T00:00:00Z'), ms('2026-03-11T00:00:00Z'), TORONTO);
    expect(out).toHaveLength(5);
    expect(new Set(starts(out)).size).toBe(5);
  });

  it('a UK series behaves the same across its own transition', () => {
    // 2026-03-29 is the British spring-forward. 09:00 London = 09:00Z before,
    // 08:00Z after.
    const e = ev({ start: '2026-03-27T09:00:00.000Z', recurrence: { kind: 'every', interval: 1, unit: 'days' } });
    const out = occurrencesBetween([e], ms('2026-03-27T00:00:00Z'), ms('2026-03-31T00:00:00Z'), 'Europe/London');
    expect(starts(out)).toEqual([
      '2026-03-27T09:00:00.000Z',
      '2026-03-28T09:00:00.000Z',
      '2026-03-29T08:00:00.000Z',
      '2026-03-30T08:00:00.000Z',
    ]);
  });
});

describe('occurrencesBetween — until, exdates and detached overrides', () => {
  it('honours an inclusive until date', () => {
    const e = ev({
      start: '2026-03-02T09:00:00.000Z',
      recurrence: { kind: 'every', interval: 1, unit: 'days', until: '2026-03-04' },
    });
    const out = occurrencesBetween([e], ms('2026-03-01T00:00:00Z'), ms('2026-03-10T00:00:00Z'), UTC);
    expect(starts(out)).toEqual([
      '2026-03-02T09:00:00.000Z',
      '2026-03-03T09:00:00.000Z',
      '2026-03-04T09:00:00.000Z', // inclusive
    ]);
  });

  it('drops cancelled instants listed in exdates', () => {
    const e = ev({
      start: '2026-03-02T09:00:00.000Z',
      recurrence: { kind: 'every', interval: 1, unit: 'days' },
      exdates: ['2026-03-03T09:00:00.000Z'],
    });
    const out = occurrencesBetween([e], ms('2026-03-01T00:00:00Z'), ms('2026-03-05T00:00:00Z'), UTC);
    expect(starts(out)).toEqual(['2026-03-02T09:00:00.000Z', '2026-03-04T09:00:00.000Z']);
  });

  it('a detached row replaces exactly one instance, in its new place', () => {
    const series = ev({
      id: 'series',
      start: '2026-03-02T09:00:00.000Z',
      recurrence: { kind: 'every', interval: 1, unit: 'days' },
    });
    const moved = ev({
      id: 'moved',
      title: 'Moved',
      start: '2026-03-03T17:00:00.000Z', // same day, later
      series_id: 'series',
      original_start: '2026-03-03T09:00:00.000Z',
    });
    const out = occurrencesBetween([series, moved], ms('2026-03-01T00:00:00Z'), ms('2026-03-05T00:00:00Z'), UTC);
    expect(starts(out)).toEqual([
      '2026-03-02T09:00:00.000Z',
      '2026-03-03T17:00:00.000Z', // the override, not 09:00
      '2026-03-04T09:00:00.000Z',
    ]);
    const override = out.find((o) => o.detached)!;
    expect(override.event.title).toBe('Moved');
    expect(override.seriesId).toBe('series');
    expect(override.originalStart).toBe('2026-03-03T09:00:00.000Z');
  });

  it('an override dragged onto another day still suppresses only its own instant', () => {
    const series = ev({
      id: 'series',
      start: '2026-03-02T09:00:00.000Z',
      recurrence: { kind: 'every', interval: 1, unit: 'days' },
    });
    const moved = ev({
      id: 'moved',
      start: '2026-03-06T09:00:00.000Z',
      series_id: 'series',
      original_start: '2026-03-03T09:00:00.000Z',
    });
    const out = occurrencesBetween([series, moved], ms('2026-03-01T00:00:00Z'), ms('2026-03-08T00:00:00Z'), UTC);
    // Mar 3 is gone from the series; Mar 6 now has two (its own + the moved one).
    expect(starts(out).filter((s) => s.startsWith('2026-03-03'))).toEqual([]);
    expect(starts(out).filter((s) => s.startsWith('2026-03-06'))).toHaveLength(2);
  });

  it('carries the anchor duration to every occurrence', () => {
    const e = ev({
      start: '2026-03-02T09:00:00.000Z',
      end: '2026-03-02T10:30:00.000Z',
      recurrence: { kind: 'every', interval: 1, unit: 'days' },
    });
    const out = occurrencesBetween([e], ms('2026-03-01T00:00:00Z'), ms('2026-03-05T00:00:00Z'), UTC);
    for (const o of out) {
      expect(Date.parse(o.end!) - Date.parse(o.start)).toBe(90 * 60_000);
    }
  });

  it('sorts the whole result by start', () => {
    const a = ev({ id: 'a', start: '2026-03-04T09:00:00.000Z' });
    const b = ev({ id: 'b', start: '2026-03-02T09:00:00.000Z', recurrence: { kind: 'every', interval: 1, unit: 'days' } });
    const out = occurrencesBetween([a, b], ms('2026-03-01T00:00:00Z'), ms('2026-03-06T00:00:00Z'), UTC);
    expect(starts(out)).toEqual([...starts(out)].sort());
  });

  it('caps an unbounded rule so a render cannot hang', () => {
    const e = ev({ start: '2000-01-01T09:00:00.000Z', recurrence: { kind: 'every', interval: 1, unit: 'days' } });
    const out = occurrencesBetween([e], ms('2000-01-01T00:00:00Z'), ms('2100-01-01T00:00:00Z'), UTC);
    expect(out.length).toBeLessThanOrEqual(MAX_OCCURRENCES);
  });
});

describe('nextOccurrenceOnOrAfter', () => {
  it('never looks backwards', () => {
    const e = ev({ start: '2026-03-02T09:00:00.000Z', recurrence: { kind: 'every', interval: 1, unit: 'days' } });
    for (const at of ['2026-03-02T08:59:00Z', '2026-03-02T09:00:00Z', '2026-03-02T09:00:01Z', '2026-05-20T12:34:00Z']) {
      const next = nextOccurrenceOnOrAfter(e, ms(at), UTC);
      expect(next).not.toBeNull();
      expect(next!).toBeGreaterThanOrEqual(ms(at));
    }
  });

  it('returns the anchor itself for a one-off, and null once it has passed', () => {
    const e = ev({ start: '2026-03-02T09:00:00.000Z' });
    expect(nextOccurrenceOnOrAfter(e, ms('2026-03-01T00:00:00Z'), UTC)).toBe(ms('2026-03-02T09:00:00.000Z'));
    expect(nextOccurrenceOnOrAfter(e, ms('2026-03-03T00:00:00Z'), UTC)).toBeNull();
  });

  it('skips cancelled and overridden instants', () => {
    const e = ev({
      start: '2026-03-02T09:00:00.000Z',
      recurrence: { kind: 'every', interval: 1, unit: 'days' },
      exdates: ['2026-03-03T09:00:00.000Z'],
    });
    expect(nextOccurrenceOnOrAfter(e, ms('2026-03-02T10:00:00Z'), UTC)).toBe(ms('2026-03-04T09:00:00.000Z'));
    expect(
      nextOccurrenceOnOrAfter(e, ms('2026-03-02T10:00:00Z'), UTC, new Set(['2026-03-04T09:00:00.000Z']))
    ).toBe(ms('2026-03-05T09:00:00.000Z'));
  });

  it('returns null past an until date', () => {
    const e = ev({
      start: '2026-03-02T09:00:00.000Z',
      recurrence: { kind: 'every', interval: 1, unit: 'days', until: '2026-03-04' },
    });
    expect(nextOccurrenceOnOrAfter(e, ms('2026-03-05T00:00:00Z'), UTC)).toBeNull();
  });

  it('agrees with the range expander on the same series', () => {
    const e = ev({ start: '2026-03-02T09:00:00.000Z', recurrence: { kind: 'every', interval: 3, unit: 'days' } });
    const window = occurrencesBetween([e], ms('2026-03-01T00:00:00Z'), ms('2026-04-01T00:00:00Z'), TORONTO);
    for (const occ of window) {
      const at = Date.parse(occ.start);
      expect(nextOccurrenceOnOrAfter(e, at, TORONTO)).toBe(at);
    }
  });
});

describe('sub-minute anchors', () => {
  it('reproduces the anchor exactly, seconds included', () => {
    const e = ev({ start: '2026-03-02T09:00:42.500Z', recurrence: { kind: 'every', interval: 1, unit: 'days' } });
    const out = occurrencesBetween([e], ms('2026-03-01T00:00:00Z'), ms('2026-03-05T00:00:00Z'), UTC);
    expect(starts(out)).toEqual([
      '2026-03-02T09:00:42.500Z',
      '2026-03-03T09:00:42.500Z',
      '2026-03-04T09:00:42.500Z',
    ]);
  });

  it('keeps the seconds across a DST change too', () => {
    const e = ev({ start: '2026-03-06T14:00:30.000Z', recurrence: { kind: 'every', interval: 1, unit: 'days' } });
    const out = occurrencesBetween([e], ms('2026-03-06T00:00:00Z'), ms('2026-03-10T00:00:00Z'), TORONTO);
    expect(starts(out)).toEqual([
      '2026-03-06T14:00:30.000Z',
      '2026-03-07T14:00:30.000Z',
      '2026-03-08T13:00:30.000Z',
      '2026-03-09T13:00:30.000Z',
    ]);
  });

  it('the scan agrees with the expander on a sub-minute anchor', () => {
    const e = ev({ start: '2026-03-02T09:00:42.500Z', recurrence: { kind: 'every', interval: 1, unit: 'days' } });
    expect(nextOccurrenceOnOrAfter(e, ms('2026-03-03T00:00:00Z'), UTC)).toBe(ms('2026-03-03T09:00:42.500Z'));
  });
});
