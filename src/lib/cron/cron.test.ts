/**
 * The crontab parser, description, next-run walk, systemd translation and
 * builder.
 *
 * The next-run cases pin real dates — month ends, leap years, the DOM/DOW OR
 * rule — because "it looked right" is how every cron bug ships.
 */
import { describe, expect, it } from 'vitest';
import { describeCron, joinList, summarise, timePhrase } from './describe';
import { dayMatches, matches, nextRuns, relativeTo } from './next';
import { CronParseError, formatCron, MACROS, parseCron, parseField, PRESETS } from './parse';
import { toOnCalendar } from './systemd';
import { draftFromSource, sourceFromDraft, toggleValue } from './builder';

const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min, 0, 0);
const stamp = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ` +
  `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
const runs = (expr: string, from: Date, count = 3) => nextRuns(parseCron(expr), from, count).map(stamp);

describe('parseField', () => {
  it('reads a star as every value', () => {
    expect(parseField('minute', '*').values).toHaveLength(60);
    expect(parseField('hour', '*').values).toHaveLength(24);
    expect(parseField('dom', '*').values[0]).toBe(1);
    expect(parseField('month', '*').values).toHaveLength(12);
    expect(parseField('dow', '*').values).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('reads lists, ranges and steps', () => {
    expect(parseField('minute', '0,15,30,45').values).toEqual([0, 15, 30, 45]);
    expect(parseField('hour', '9-17').values).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(parseField('minute', '*/15').values).toEqual([0, 15, 30, 45]);
    expect(parseField('hour', '9-17/4').values).toEqual([9, 13, 17]);
    expect(parseField('minute', '0-10/3,45').values).toEqual([0, 3, 6, 9, 45]);
  });

  it('reads `5/10` as Vixie does — from 5 to the end of the field', () => {
    expect(parseField('minute', '5/10').values).toEqual([5, 15, 25, 35, 45, 55]);
  });

  it('reads three-letter month and day names, in any case', () => {
    expect(parseField('month', 'JAN,dec').values).toEqual([1, 12]);
    expect(parseField('dow', 'Mon-Fri').values).toEqual([1, 2, 3, 4, 5]);
    expect(parseField('dow', 'SUN').values).toEqual([0]);
  });

  it('treats 7 and 0 as the same Sunday, and folds the range after expanding it', () => {
    expect(parseField('dow', '7').values).toEqual([0]);
    expect(parseField('dow', '0').values).toEqual([0]);
    // The bit that a naive normalize-first parser gets wrong: 5-7 is Friday,
    // Saturday, Sunday — not a range that runs backwards.
    expect(parseField('dow', '5-7').values).toEqual([0, 5, 6]);
  });

  it('calls a field restricted when it does not begin with a star, exactly as Vixie does', () => {
    expect(parseField('dow', '*').restricted).toBe(false);
    expect(parseField('dow', '*/2').restricted).toBe(false);
    // Matches every day and is STILL restricted — which is what switches the
    // day-of-month/day-of-week rule from AND to OR.
    expect(parseField('dow', '0-6').restricted).toBe(true);
    expect(parseField('dom', '1').restricted).toBe(true);
  });

  it('refuses what it cannot read, naming the field and the offset', () => {
    expect(() => parseField('minute', '60')).toThrow(/out of range/);
    expect(() => parseField('hour', '24')).toThrow(/runs from 0 to 23/);
    expect(() => parseField('dom', '0')).toThrow(/out of range/);
    expect(() => parseField('minute', '10-5')).toThrow(/runs backwards/);
    expect(() => parseField('minute', '*/0')).toThrow(/never run/);
    expect(() => parseField('minute', '*/x')).toThrow(/not a step/);
    expect(() => parseField('month', 'JANUARY')).toThrow(/not a month/);
    expect(() => parseField('minute', '')).toThrow(/empty/);
    expect(() => parseField('minute', '1,,2')).toThrow(/Empty item/);
    expect(() => parseField('minute', '1/2/3')).toThrow(/Only one \//);
  });

  it('points at the character that is wrong', () => {
    try {
      parseField('hour', '1,99', 6);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CronParseError);
      expect((err as CronParseError).field).toBe('hour');
      expect((err as CronParseError).offset).toBe(8);
    }
  });
});

describe('parseCron', () => {
  it('reads the five fields and keeps the command', () => {
    const expr = parseCron('5 4 * * sun /usr/bin/backup --now');
    expect(expr.minute.values).toEqual([5]);
    expect(expr.hour.values).toEqual([4]);
    expect(expr.dow.values).toEqual([0]);
    expect(expr.command).toBe('/usr/bin/backup --now');
    expect(formatCron(expr)).toBe('5 4 * * sun');
  });

  it('expands every macro', () => {
    for (const [macro, expansion] of Object.entries(MACROS)) {
      const expr = parseCron(macro);
      expect(expr.macro).toBe(macro);
      expect(formatCron(expr)).toBe(expansion);
    }
    expect(parseCron('@daily').hour.values).toEqual([0]);
    expect(parseCron('@weekly').dow.values).toEqual([0]);
    expect(parseCron('@reboot').reboot).toBe(true);
    expect(parseCron('@reboot /usr/bin/warm-cache').command).toBe('/usr/bin/warm-cache');
  });

  it('refuses a six-field expression by name instead of reading it one field out', () => {
    expect(() => parseCron('0 0 12 * * ?')).toThrow(/six-field/);
    expect(() => parseCron('*/5 0 0 12 * *')).toThrow(/seconds in front/);
    // Five fields and a command is NOT a six-field expression.
    expect(() => parseCron('0 0 12 * * echo hi')).not.toThrow();
  });

  it('refuses too few fields, a comment, and an unknown macro', () => {
    expect(() => parseCron('0 0 *')).toThrow(/five fields/);
    expect(() => parseCron('# 0 0 * * *')).toThrow(/commented out/);
    expect(() => parseCron('@fortnightly')).toThrow(/not a cron macro/);
    expect(() => parseCron('   ')).toThrow(/Nothing to read/);
  });

  it('flags the expression where both day fields are set', () => {
    expect(parseCron('0 0 13 * 5').domDowOr).toBe(true);
    expect(parseCron('0 0 13 * *').domDowOr).toBe(false);
    expect(parseCron('0 0 * * 5').domDowOr).toBe(false);
    expect(parseCron('0 0 13 * */2').domDowOr).toBe(false);
  });
});

describe('describeCron', () => {
  it('reads a single time as a clock', () => {
    expect(describeCron(parseCron('5 4 * * *'))).toBe('At 04:05.');
    expect(describeCron(parseCron('0 0 * * *'))).toBe('At 00:00.');
    expect(describeCron(parseCron('30 13 * * *'))).toBe('At 13:30.');
  });

  it('describes the every-minute and step cases', () => {
    expect(describeCron(parseCron('* * * * *'))).toBe('Every minute.');
    expect(describeCron(parseCron('*/5 * * * *'))).toBe('Every 5th minute.');
    expect(describeCron(parseCron('0 * * * *'))).toBe('At minute 0.');
    expect(describeCron(parseCron('* 9 * * *'))).toBe('Every minute past hour 9.');
  });

  it('names days and months rather than numbering them', () => {
    expect(describeCron(parseCron('0 9 * * 1-5'))).toBe('At 09:00 on every day-of-week from Monday through Friday.');
    expect(describeCron(parseCron('0 9 * * 1,3,5'))).toBe('At 09:00 on Monday, Wednesday and Friday.');
    expect(describeCron(parseCron('0 0 1 1 *'))).toBe('At 00:00 on day-of-month 1st in January.');
    expect(describeCron(parseCron('0 6 1 1,4,7,10 *'))).toBe(
      'At 06:00 on day-of-month 1st in January, April, July and October.'
    );
  });

  it('lists a handful of clock times rather than a sentence about minutes', () => {
    expect(timePhrase(parseCron('0 9,17 * * *'))).toBe('At 09:00 and 17:00');
  });

  it('says out loud that both day fields means OR', () => {
    const text = describeCron(parseCron('0 0 13 * 5'));
    expect(text).toContain('EITHER');
    expect(text).not.toContain('Friday the 13th');
    expect(describeCron(parseCron('0 0 13 * *'))).not.toContain('EITHER');
  });

  it('has something to say about @reboot', () => {
    expect(describeCron(parseCron('@reboot'))).toBe('Once, when the machine boots.');
    expect(summarise(parseCron('@reboot'))).toBe('At boot');
  });

  it('joins lists the way English does', () => {
    expect(joinList([])).toBe('');
    expect(joinList(['a'])).toBe('a');
    expect(joinList(['a', 'b'])).toBe('a and b');
    expect(joinList(['a', 'b', 'c'])).toBe('a, b and c');
  });
});

describe('nextRuns', () => {
  it('walks a daily job forward', () => {
    expect(runs('5 4 * * *', at(2026, 8, 22, 10, 0))).toEqual([
      '2026-08-23 04:05',
      '2026-08-24 04:05',
      '2026-08-25 04:05',
    ]);
  });

  it('starts strictly after the moment it was given', () => {
    // 04:05 exactly: the run happening right now is not a NEXT run.
    expect(runs('5 4 * * *', at(2026, 8, 22, 4, 5), 1)).toEqual(['2026-08-23 04:05']);
    expect(runs('5 4 * * *', at(2026, 8, 22, 4, 4), 1)).toEqual(['2026-08-22 04:05']);
  });

  it('handles every-minute and step schedules', () => {
    expect(runs('* * * * *', at(2026, 8, 22, 23, 58), 3)).toEqual([
      '2026-08-22 23:59',
      '2026-08-23 00:00',
      '2026-08-23 00:01',
    ]);
    expect(runs('*/15 * * * *', at(2026, 8, 22, 10, 1), 3)).toEqual([
      '2026-08-22 10:15',
      '2026-08-22 10:30',
      '2026-08-22 10:45',
    ]);
  });

  it('skips the months that have no 31st', () => {
    expect(runs('0 0 31 * *', at(2026, 1, 31, 1, 0), 4)).toEqual([
      '2026-03-31 00:00',
      '2026-05-31 00:00',
      '2026-07-31 00:00',
      '2026-08-31 00:00',
    ]);
  });

  it('knows which Februaries have a 29th', () => {
    expect(runs('0 0 29 2 *', at(2026, 1, 1), 2)).toEqual(['2028-02-29 00:00', '2032-02-29 00:00']);
  });

  it('returns nothing for a date that does not exist, rather than hanging', () => {
    expect(nextRuns(parseCron('0 0 30 2 *'), at(2026, 1, 1), 3)).toEqual([]);
    expect(nextRuns(parseCron('0 0 31 4 *'), at(2026, 1, 1), 3)).toEqual([]);
  });

  it('runs on EITHER day field when both are set', () => {
    // November 2026: Fridays are the 6th, 13th, 20th, 27th — and the 13th is
    // a Friday, so it appears once, not twice. The fifth run is next
    // November, because the month field is what actually narrows this.
    expect(runs('0 0 13 11 5', at(2026, 11, 1), 5)).toEqual([
      '2026-11-06 00:00',
      '2026-11-13 00:00',
      '2026-11-20 00:00',
      '2026-11-27 00:00',
      '2027-11-05 00:00',
    ]);
    // With only the day-of-month set it is the 13th of November and nothing
    // else — the same expression minus the weekday drops from four runs a
    // year to one.
    expect(runs('0 0 13 11 *', at(2026, 11, 1), 3)).toEqual([
      '2026-11-13 00:00',
      '2027-11-13 00:00',
      '2028-11-13 00:00',
    ]);
  });

  it('has nothing to say about @reboot', () => {
    expect(nextRuns(parseCron('@reboot'), at(2026, 8, 22), 3)).toEqual([]);
  });

  it('answers matches() and dayMatches() directly', () => {
    const expr = parseCron('0 0 13 * 5');
    expect(dayMatches(expr, at(2026, 11, 13))).toBe(true); // the 13th
    expect(dayMatches(expr, at(2026, 11, 6))).toBe(true); // a Friday
    expect(dayMatches(expr, at(2026, 11, 7))).toBe(false); // neither
    expect(matches(parseCron('5 4 * * *'), at(2026, 8, 22, 4, 5))).toBe(true);
    expect(matches(parseCron('5 4 * * *'), at(2026, 8, 22, 4, 6))).toBe(false);
  });
});

describe('relativeTo', () => {
  it('says how far away a run is', () => {
    const now = at(2026, 8, 22, 10, 0);
    expect(relativeTo(now, at(2026, 8, 22, 10, 0))).toBe('in under a minute');
    expect(relativeTo(now, at(2026, 8, 22, 10, 1))).toBe('in 1 minute');
    expect(relativeTo(now, at(2026, 8, 22, 13, 0))).toBe('in 3 hours');
    expect(relativeTo(now, at(2026, 8, 25, 10, 0))).toBe('in 3 days');
    expect(relativeTo(now, at(2026, 9, 12, 10, 0))).toBe('in 3 weeks');
    expect(relativeTo(now, at(2026, 8, 21))).toBe('in the past');
  });
});

describe('toOnCalendar', () => {
  it('translates the ordinary schedules', () => {
    expect(toOnCalendar(parseCron('5 4 * * *')).onCalendar).toBe('*-*-* 04:05:00');
    expect(toOnCalendar(parseCron('0 9 * * 1-5')).onCalendar).toBe('Mon,Tue,Wed,Thu,Fri *-*-* 09:00:00');
    // Every field has a slot, so an every-hour step keeps its `*:` hour.
    expect(toOnCalendar(parseCron('*/15 * * * *')).onCalendar).toBe('*-*-* *:*/15:00');
    expect(toOnCalendar(parseCron('0 0 1 1 *')).onCalendar).toBe('*-01-01 00:00:00');
    expect(toOnCalendar(parseCron('0 6 1 1,4,7,10 *')).onCalendar).toBe('*-01,04,07,10-01 06:00:00');
  });

  it('writes a whole unit with Persistent=true, which is the reason to switch', () => {
    const unit = toOnCalendar(parseCron('5 4 * * *')).unit!;
    expect(unit).toContain('OnCalendar=*-*-* 04:05:00');
    expect(unit).toContain('Persistent=true');
    expect(unit).toContain('WantedBy=timers.target');
  });

  it('refuses the OR case rather than quietly ANDing it', () => {
    const result = toOnCalendar(parseCron('0 0 13 * 5'));
    expect(result.onCalendar).toBeNull();
    expect(result.warning).toContain('TWO OnCalendar=');
  });

  it('says what @reboot needs instead', () => {
    const result = toOnCalendar(parseCron('@reboot'));
    expect(result.onCalendar).toBeNull();
    expect(result.warning).toContain('OnBootSec=');
  });
});

describe('the builder', () => {
  it('reads each shape it can draw, and admits when it cannot', () => {
    expect(draftFromSource('minute', '*').mode).toBe('every');
    expect(draftFromSource('minute', '*/5')).toMatchObject({ mode: 'step', step: 5 });
    expect(draftFromSource('hour', '9-17')).toMatchObject({ mode: 'range', from: 9, to: 17 });
    expect(draftFromSource('minute', '0,30')).toMatchObject({ mode: 'list', values: [0, 30] });
    // Genuinely free-form: the controls keep their hands off it.
    const custom = draftFromSource('minute', '1-5/2,30');
    expect(custom.mode).toBe('custom');
    expect(custom.source).toBe('1-5/2,30');
  });

  it('writes each shape back out', () => {
    expect(sourceFromDraft('minute', draftFromSource('minute', '*'))).toBe('*');
    expect(sourceFromDraft('minute', draftFromSource('minute', '*/5'))).toBe('*/5');
    expect(sourceFromDraft('hour', draftFromSource('hour', '9-17'))).toBe('9-17');
    expect(sourceFromDraft('minute', draftFromSource('minute', '0,30'))).toBe('0,30');
    expect(sourceFromDraft('minute', draftFromSource('minute', '1-5/2,30'))).toBe('1-5/2,30');
  });

  it('round-trips every preset without changing it', () => {
    for (const preset of PRESETS) {
      if (preset.expression.startsWith('@')) continue;
      const fields = preset.expression.split(' ');
      const names = ['minute', 'hour', 'dom', 'month', 'dow'] as const;
      const back = names.map((name, i) => sourceFromDraft(name, draftFromSource(name, fields[i]!))).join(' ');
      expect(back, preset.label).toBe(preset.expression);
    }
  });

  it('falls back to a star rather than writing an empty field mid-click', () => {
    const draft = { ...draftFromSource('dow', '1,2'), values: [] };
    expect(sourceFromDraft('dow', draft)).toBe('*');
  });

  it('toggles a value in and out of a list', () => {
    const draft = draftFromSource('dow', '1,3');
    expect(toggleValue(draft, 5).values).toEqual([1, 3, 5]);
    expect(toggleValue(draft, 3).values).toEqual([1]);
  });

  it('keeps every preset parseable', () => {
    for (const preset of PRESETS) expect(() => parseCron(preset.expression), preset.label).not.toThrow();
  });
});
