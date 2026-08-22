/**
 * The same schedule as a systemd timer (0.3.0 phase 10).
 *
 * systemd's `OnCalendar=` is the modern answer to cron on any Linux with
 * systemd, and it is better in the ways that matter for a scheduled job:
 * missed runs can be caught up (`Persistent=true`), the timezone is explicit,
 * and the job's output goes to the journal rather than to a mail spool nobody
 * reads.
 *
 * It is NOT a superset of cron, and this module refuses rather than lies
 * about the one place they disagree: when both day fields are restricted,
 * cron runs on **either**, and `OnCalendar=` has no way to say that. Two
 * timers, or one `OnCalendar=` line per day rule, is the honest translation —
 * so that is what the warning says.
 */
import { FIELDS, type CronExpression, type CronField } from './parse';

const DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface TimerTranslation {
  /** The `OnCalendar=` value, or null when cron's meaning cannot be written. */
  onCalendar: string | null;
  /** A complete `.timer` unit, ready to paste. Null for the same reason. */
  unit: string | null;
  /** Why it could not be translated, or a caveat about the one that was. */
  warning: string | null;
}

/** A field as a systemd calendar component: a star, star-slash-5, `9..17`,
 * or a list like `0,15,30`. */
function component(field: CronField, pad = 2): string | null {
  const spec = FIELDS[field.name];
  const render = (n: number) => String(n).padStart(pad, '0');
  if (field.source === '*') return '*';

  if (field.step && field.step > 1) {
    const range = field.range;
    if (!range || (range.from === spec.min && range.to === spec.max)) return `*/${field.step}`;
    return `${render(range.from)}..${render(range.to)}/${field.step}`;
  }
  if (field.range && field.step === null) return `${render(field.range.from)}..${render(field.range.to)}`;
  if (field.values.length === 0) return null;
  return field.values.map(render).join(',');
}

export function toOnCalendar(expr: CronExpression): TimerTranslation {
  if (expr.reboot) {
    return {
      onCalendar: null,
      unit: null,
      warning:
        '@reboot has no OnCalendar equivalent — a systemd timer uses OnBootSec= for that, ' +
        'or the service is simply enabled so it starts with the machine.',
    };
  }

  if (expr.domDowOr) {
    return {
      onCalendar: null,
      unit: null,
      warning:
        'Both day fields are set, so cron runs this when EITHER matches. OnCalendar= always ANDs ' +
        'its day-of-week and its date, so this schedule needs TWO OnCalendar= lines (a unit may ' +
        'carry several) — one for the days of the month, one for the weekdays.',
    };
  }

  const minute = component(expr.minute);
  const hour = component(expr.hour);
  const dom = component(expr.dom);
  const month = component(expr.month);
  if (!minute || !hour || !dom || !month) {
    return { onCalendar: null, unit: null, warning: 'That expression has a field with no values in it.' };
  }

  const days = expr.dow.source === '*' ? '' : `${expr.dow.values.map((d) => DOW_NAMES[d]).join(',')} `;
  const onCalendar = `${days}*-${month}-${dom} ${hour}:${minute}:00`;

  return {
    onCalendar,
    unit: [
      '[Unit]',
      'Description=What this job is for',
      '',
      '[Timer]',
      `OnCalendar=${onCalendar}`,
      '# Catch up a run the machine slept through — cron simply misses it.',
      'Persistent=true',
      '',
      '[Install]',
      'WantedBy=timers.target',
    ].join('\n'),
    warning:
      'A timer runs in the timezone systemd is configured for; add Timezone= (or use a UTC ' +
      'OnCalendar) if the machine and the schedule disagree.',
  };
}
