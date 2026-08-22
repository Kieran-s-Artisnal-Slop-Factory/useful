/**
 * Vixie/POSIX crontab expressions (0.3.0 phase 10).
 *
 * Five fields — minute, hour, day-of-month, month, day-of-week — plus the
 * `@macros`, parsed into sets of allowed values. Everything downstream
 * (the description, the next runs, the systemd translation, the builder)
 * reads the parse tree rather than the text, so none of them can drift from
 * what the expression actually means.
 *
 * **Six-field dialects are named, not half-parsed.** Quartz and Spring put
 * seconds in front; a five-field parser handed one of those silently reads
 * every field one place to the left and produces a schedule that looks
 * plausible and is wrong. That is refused by name.
 *
 * Errors carry the field and the character offset in the original line, so
 * the page can point at the character rather than saying "invalid".
 */

export type FieldName = 'minute' | 'hour' | 'dom' | 'month' | 'dow';

export const FIELD_ORDER: FieldName[] = ['minute', 'hour', 'dom', 'month', 'dow'];

export interface FieldRange {
  name: FieldName;
  label: string;
  min: number;
  max: number;
  /** Three-letter names, indexed from `min`. */
  names?: string[];
}

const MONTH_NAMES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export const FIELDS: Record<FieldName, FieldRange> = {
  minute: { name: 'minute', label: 'minute', min: 0, max: 59 },
  hour: { name: 'hour', label: 'hour', min: 0, max: 23 },
  dom: { name: 'dom', label: 'day of month', min: 1, max: 31 },
  month: { name: 'month', label: 'month', min: 1, max: 12, names: MONTH_NAMES },
  // 0 AND 7 are both Sunday in Vixie cron, so the field really does run 0-7 —
  // and `5-7` has to mean Friday, Saturday, Sunday. The 7s are folded onto 0
  // after the range has been expanded, not before, or that range runs
  // backwards and gets refused.
  dow: { name: 'dow', label: 'day of week', min: 0, max: 7, names: DAY_NAMES },
};

export interface CronField {
  name: FieldName;
  /** The text as written. */
  source: string;
  /** Every value this field matches, ascending. */
  values: number[];
  /** False only for a bare `*` — the distinction the DOM/DOW rule turns on. */
  restricted: boolean;
  /** Set when the field carries a step (star-slash-n, or `a-b` slash n). */
  step: number | null;
  /** Set when the field is a single `a-b` range (with or without a step). */
  range: { from: number; to: number } | null;
}

export interface CronExpression {
  minute: CronField;
  hour: CronField;
  dom: CronField;
  month: CronField;
  dow: CronField;
  /** The macro this came from, e.g. '@daily'. */
  macro: string | null;
  /** True for `@reboot`, which has no schedule at all. */
  reboot: boolean;
  /** Anything after the five fields — the command, if one was pasted. */
  command: string;
  /**
   * Both day fields restricted, which is the trap nobody knows: Vixie cron
   * runs when EITHER matches, not both.
   */
  domDowOr: boolean;
}

export class CronParseError extends Error {
  readonly field: FieldName | null;
  /** 0-based character offset in the line the error is about. */
  readonly offset: number;

  constructor(message: string, field: FieldName | null, offset: number) {
    super(message);
    this.name = 'CronParseError';
    this.field = field;
    this.offset = offset;
  }
}

/** The macros every Vixie cron accepts, and what they stand for. */
export const MACROS: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

/** Parse one field. `offset` is where its text starts in the whole line. */
export function parseField(name: FieldName, source: string, offset = 0): CronField {
  const spec = FIELDS[name];
  const text = source.trim();
  if (text === '') throw new CronParseError(`The ${spec.label} field is empty.`, name, offset);

  const values = new Set<number>();
  let step: number | null = null;
  let range: { from: number; to: number } | null = null;
  const parts = text.split(',');
  let cursor = offset;

  for (const part of parts) {
    const at = cursor;
    cursor += part.length + 1; // +1 for the comma we split on
    if (part === '') throw new CronParseError(`Empty item in the ${spec.label} field.`, name, at);

    const [body, stepText, ...extra] = part.split('/');
    if (extra.length > 0) {
      throw new CronParseError(`Only one / is allowed per item in the ${spec.label} field.`, name, at);
    }

    let itemStep = 1;
    if (stepText !== undefined) {
      if (!/^\d+$/.test(stepText)) {
        throw new CronParseError(
          `"${stepText}" is not a step in the ${spec.label} field — a step is a whole number.`,
          name,
          at + (body?.length ?? 0) + 1
        );
      }
      itemStep = Number(stepText);
      if (itemStep === 0) {
        throw new CronParseError(`A step of 0 in the ${spec.label} field would never run.`, name, at);
      }
      step = itemStep;
    }

    let from: number;
    let to: number;
    if (body === '*' || body === '') {
      // `*/5` and the bare `*`. An empty body (`/5`) is a typo worth naming.
      if (body === '') throw new CronParseError(`"${part}" has nothing before the /.`, name, at);
      from = spec.min;
      to = spec.max;
    } else if (body.includes('-')) {
      const [a, b, ...rest] = body.split('-');
      if (rest.length > 0 || b === undefined) {
        throw new CronParseError(`"${body}" is not a range in the ${spec.label} field.`, name, at);
      }
      from = readValue(name, a!, at);
      to = readValue(name, b, at + a!.length + 1);
      if (from > to) {
        throw new CronParseError(
          `The range "${body}" runs backwards — ${spec.label} ${from} is after ${to}.`,
          name,
          at
        );
      }
      range = { from, to };
    } else {
      from = readValue(name, body!, at);
      // Vixie reads `5/10` as "from 5 to the end of the field, every 10".
      to = stepText === undefined ? from : spec.max;
      if (stepText !== undefined) range = { from, to };
    }

    for (let v = from; v <= to; v += itemStep) values.add(v);
  }

  // Sunday is both 0 and 7. Fold now that every range has been expanded.
  if (name === 'dow' && values.delete(7)) values.add(0);
  const list = [...values].sort((a, b) => a - b);

  /*
   * "Restricted" means "does not begin with a star", which is exactly the
   * test Vixie cron makes (it sets DOM_STAR / DOW_STAR while reading the
   * field). It is NOT "matches fewer than every value": `0-6` in day-of-week
   * matches every day and still counts as restricted, and that is what turns
   * the OR rule on. Getting this subtly wrong would make the trap this tool
   * exists to explain invisible in the one case people hit it.
   */
  const restricted = !text.startsWith('*');
  const single = parts.length === 1;
  return {
    name,
    source: text,
    values: list,
    restricted,
    step: single ? step : null,
    range: single ? range : null,
  };
}

/** One number or three-letter name, checked against the field's range. */
function readValue(name: FieldName, token: string, offset: number): number {
  const spec = FIELDS[name];
  const trimmed = token.trim();
  if (trimmed === '') throw new CronParseError(`Missing a value in the ${spec.label} field.`, name, offset);

  let value: number;
  if (/^\d+$/.test(trimmed)) {
    // 7 is Sunday as well as 0, and day-of-week's max is 7 for that reason.
    // The fold happens in parseField AFTER ranges are expanded, never here:
    // turning the 7 in `5-7` into a 0 on the way in makes the range run
    // backwards and get refused, when it plainly means Fri, Sat, Sun.
    value = Number(trimmed);
  } else if (spec.names) {
    const index = spec.names.indexOf(trimmed.toUpperCase());
    if (index < 0) {
      throw new CronParseError(
        `"${trimmed}" is not a ${spec.label} — try ${spec.names.slice(0, 3).join(', ')}… or a number.`,
        name,
        offset
      );
    }
    return index + spec.min;
  } else {
    throw new CronParseError(`"${trimmed}" is not a number.`, name, offset);
  }

  if (value < spec.min || value > spec.max) {
    throw new CronParseError(
      `${spec.label} ${value} is out of range — it runs from ${spec.min} to ${spec.max}.`,
      name,
      offset
    );
  }
  return value;
}

/** Field text that could be a cron field rather than a command. */
const FIELD_SHAPED = /^(\*|[0-9]{1,2}|[A-Za-z]{3})([-,/][0-9A-Za-z*,\-/]*)*$/;

/**
 * A sixth token that means "this is a seconds-first dialect" rather than "this
 * is the command".
 *
 * Deliberately narrower than a whole field: `0 0 12 * * who` is five fields
 * and a command called `who`, and refusing that would be worse than the bug
 * it guards against. A digit, a star or Quartz's `?` is the tell.
 */
const SIX_FIELD_TAIL = /^(\?|[\d*][\d*,\-/]*)$/;

/**
 * Parse a whole crontab line.
 *
 * Accepts the bare five fields, a macro, or either followed by a command —
 * because that is what people paste. The command is kept rather than
 * discarded so the page can say something useful about it.
 */
export function parseCron(line: string): CronExpression {
  const text = line.trim();
  if (text === '') throw new CronParseError('Nothing to read — type an expression.', null, 0);
  if (text.startsWith('#')) {
    throw new CronParseError('That line is commented out — cron will ignore it entirely.', null, 0);
  }

  if (text.startsWith('@')) return parseMacro(text);

  const tokens: { text: string; offset: number }[] = [];
  const re = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) tokens.push({ text: match[0], offset: match.index });

  if (tokens.length < 5) {
    throw new CronParseError(
      `A cron expression has five fields (minute hour day-of-month month day-of-week) — this has ${tokens.length}.`,
      null,
      text.length
    );
  }

  // Six field-shaped tokens and nothing else is a seconds-first dialect
  // (Quartz, Spring). Reading it as five fields plus a command produces a
  // schedule that looks plausible and is wrong by one field.
  if (
    tokens.length === 6 &&
    tokens.slice(0, 5).every((t) => FIELD_SHAPED.test(t.text)) &&
    SIX_FIELD_TAIL.test(tokens[5]!.text)
  ) {
    throw new CronParseError(
      'That looks like a six-field expression with seconds in front (Quartz, Spring). ' +
        'This tool reads the five-field Vixie/POSIX syntax that crond and crontab use — drop the seconds field.',
      null,
      tokens[5]!.offset
    );
  }

  const fields = FIELD_ORDER.map((name, i) => parseField(name, tokens[i]!.text, tokens[i]!.offset));
  const command = tokens.length > 5 ? text.slice(tokens[5]!.offset) : '';
  return assemble(fields, null, false, command);
}

function parseMacro(text: string): CronExpression {
  const space = text.search(/\s/);
  const word = (space < 0 ? text : text.slice(0, space)).toLowerCase();
  const command = space < 0 ? '' : text.slice(space).trim();

  if (word === '@reboot') {
    const fields = FIELD_ORDER.map((name) => parseField(name, '*'));
    return { ...assemble(fields, '@reboot', true, command) };
  }
  const expansion = MACROS[word];
  if (!expansion) {
    throw new CronParseError(
      `"${word}" is not a cron macro. The ones every cron knows are ${Object.keys(MACROS).join(', ')} and @reboot.`,
      null,
      0
    );
  }
  const parts = expansion.split(' ');
  const fields = FIELD_ORDER.map((name, i) => parseField(name, parts[i]!));
  return assemble(fields, word, false, command);
}

function assemble(fields: CronField[], macro: string | null, reboot: boolean, command: string): CronExpression {
  const [minute, hour, dom, month, dow] = fields as [CronField, CronField, CronField, CronField, CronField];
  return {
    minute,
    hour,
    dom,
    month,
    dow,
    macro,
    reboot,
    command,
    domDowOr: dom.restricted && dow.restricted,
  };
}

/** The five fields back as one line, without the command. */
export function formatCron(expr: CronExpression): string {
  if (expr.reboot) return '@reboot';
  return FIELD_ORDER.map((name) => expr[name].source).join(' ');
}

export interface Preset {
  label: string;
  expression: string;
}

/** The schedules people actually write, so the common case is one click. */
export const PRESETS: Preset[] = [
  { label: 'Every minute', expression: '* * * * *' },
  { label: 'Every 5 minutes', expression: '*/5 * * * *' },
  { label: 'Every 15 minutes', expression: '*/15 * * * *' },
  { label: 'Every hour, on the hour', expression: '0 * * * *' },
  { label: 'Every day at midnight', expression: '0 0 * * *' },
  { label: 'Every day at 04:05', expression: '5 4 * * *' },
  { label: 'Every weekday at 09:00', expression: '0 9 * * 1-5' },
  { label: 'Every Sunday at 03:30', expression: '30 3 * * 0' },
  { label: 'First of the month at midnight', expression: '0 0 1 * *' },
  { label: 'Quarterly, on the 1st at 06:00', expression: '0 6 1 1,4,7,10 *' },
  { label: 'Every year on 1 January', expression: '@yearly' },
  { label: 'At every boot', expression: '@reboot' },
];
