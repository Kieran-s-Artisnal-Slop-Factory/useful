/**
 * A cron expression in plain English (0.3.0 phase 10).
 *
 * Built from the parse tree rather than from the text, so the sentence cannot
 * disagree with what the expression means — the failure mode of every
 * "cron explainer" that pattern-matches strings.
 *
 * The phrasing follows crontab.guru closely on purpose: that is the wording
 * people have already read, and inventing a second dialect of cron English
 * helps nobody.
 */
import { FIELDS, type CronExpression, type CronField } from './parse';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "a", "a and b", "a, b and c" — the Oxford-free list every English sentence
 * wants and `Intl.ListFormat` would want a locale for. */
export function joinList(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0]!;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

const ordinal = (n: number): string => {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
};

const two = (n: number): string => String(n).padStart(2, '0');

/** Is this field a plain `*`? */
const isEvery = (field: CronField): boolean => field.source === '*';

/**
 * A field as a noun phrase: "every minute", "every 5th minute", "minute 30",
 * "minutes 0, 15, 30 and 45", "every minute from 9 through 17".
 */
function fieldPhrase(field: CronField, singular: string, plural: string, render = String): string {
  const spec = FIELDS[field.name];
  if (isEvery(field)) return `every ${singular}`;

  if (field.step && field.step > 1) {
    const covers = field.range;
    const whole = !covers || (covers.from === spec.min && covers.to === spec.max);
    const every = `every ${ordinal(field.step)} ${singular}`;
    return whole ? every : `${every} from ${render(covers.from)} through ${render(covers.to)}`;
  }

  if (field.range && field.step === null) {
    return `every ${singular} from ${render(field.range.from)} through ${render(field.range.to)}`;
  }

  if (field.values.length === 1) return `${singular} ${render(field.values[0]!)}`;
  return `${plural} ${joinList(field.values.map(render))}`;
}

/** The minute-and-hour half of the sentence. */
export function timePhrase(expr: CronExpression): string {
  const { minute, hour } = expr;

  if (isEvery(minute) && isEvery(hour)) return 'Every minute';

  // The common case, and the one worth reading as a clock: one minute, one
  // hour. "At 04:05" beats "at minute 5 past hour 4" for the 90% of
  // expressions that look like this.
  if (minute.values.length === 1 && hour.values.length === 1 && !minute.step && !hour.step) {
    return `At ${two(hour.values[0]!)}:${two(minute.values[0]!)}`;
  }

  if (isEvery(hour)) {
    if (minute.step && minute.step > 1 && (!minute.range || minute.range.from === 0)) {
      return `Every ${ordinal(minute.step)} minute`;
    }
    return `At ${fieldPhrase(minute, 'minute', 'minutes')}`;
  }

  if (isEvery(minute)) return `Every minute past ${fieldPhrase(hour, 'hour', 'hours')}`;

  // A single minute across several hours reads as a list of clock times when
  // there are few enough of them to be worth reading.
  if (minute.values.length === 1 && hour.values.length <= 4 && !hour.step) {
    const times = hour.values.map((h) => `${two(h)}:${two(minute.values[0]!)}`);
    return `At ${joinList(times)}`;
  }

  return `At ${fieldPhrase(minute, 'minute', 'minutes')} past ${fieldPhrase(hour, 'hour', 'hours')}`;
}

/** The date half: day-of-month, month, day-of-week. */
export function datePhrase(expr: CronExpression): string {
  const parts: string[] = [];

  if (!isEvery(expr.dom)) {
    parts.push(`on ${fieldPhrase(expr.dom, 'day-of-month', 'day-of-month', ordinal)}`);
  }
  if (!isEvery(expr.month)) {
    const name = (m: number | string) => MONTHS[Number(m) - 1] ?? String(m);
    // "in month January" is nobody's English. When the field is a plain list
    // the names carry it; a step or a range still needs the noun to make
    // sense of "every 3rd month from January through October".
    const plain = !expr.month.step && !expr.month.range;
    parts.push(
      plain
        ? `in ${joinList(expr.month.values.map(name))}`
        : `in ${fieldPhrase(expr.month, 'month', 'month', name)}`
    );
  }
  if (!isEvery(expr.dow)) {
    const phrase = fieldPhrase(expr.dow, 'day-of-week', 'day-of-week', (d) => DAYS[Number(d)] ?? String(d));
    // "on day-of-week Monday" is nobody's English; when it is a plain list of
    // days the field name adds nothing.
    const plain = !expr.dow.step && !expr.dow.range;
    parts.push(plain ? `on ${joinList(expr.dow.values.map((d) => DAYS[d] ?? String(d)))}` : `on ${phrase}`);
  }

  return parts.join(' ');
}

/**
 * The whole sentence.
 *
 * The day-of-month/day-of-week note is part of the description rather than a
 * footnote somewhere else, because someone reading "on the 13th and on
 * Friday" will otherwise read it as "Friday the 13th" — which is the
 * opposite of what cron does.
 */
export function describeCron(expr: CronExpression, includeOrNote = true): string {
  if (expr.reboot) return 'Once, when the machine boots.';

  const date = datePhrase(expr);
  const sentence = `${timePhrase(expr)}${date ? ` ${date}` : ''}.`;
  // The page passes false and renders the note itself, in the colour a
  // warning deserves; anything reading a description on its own gets the
  // whole truth in one string.
  return expr.domDowOr && includeOrNote ? `${sentence} ${OR_NOTE}` : sentence;
}

export const OR_NOTE =
  'Both day fields are set, so cron runs this when EITHER matches — not both. ' +
  'That is every one of those days-of-month, PLUS every one of those weekdays.';

/** The short form the page puts beside the expression. */
export function summarise(expr: CronExpression): string {
  if (expr.reboot) return 'At boot';
  return `${timePhrase(expr)}${datePhrase(expr) ? ` ${datePhrase(expr)}` : ''}`;
}
