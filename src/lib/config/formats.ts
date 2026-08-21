/**
 * String-format heuristics for config-schema inference: does a string value
 * look like an email, phone number, URI, date, or date-time?
 *
 * Regex-based and pragmatic, not RFC-complete — a false negative only costs a
 * plain `string` type in the inferred schema, so every check trades corner
 * cases for "no prose ever slips through". detectFormat tries the formats
 * most-specific-first; phone goes last because its character class (digits,
 * spaces, `().-`) also matches dates and plenty of ids.
 */

export type StringFormat = 'email' | 'phone' | 'uri' | 'date' | 'date-time';

/** Detection order for detectFormat: most specific first, phone last.
 * date/date-time are disjoint (one has a 'T', one cannot), but uri before
 * date keeps schemes honest and email first keeps `mailto:` from stealing
 * bare addresses the other way around. */
export const FORMAT_KINDS: readonly StringFormat[] = [
  'email',
  'uri',
  'date-time',
  'date',
  'phone',
];

// One @, word-ish local part, domain with at least one dot; no spaces anywhere.
const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

// scheme://rest with a known-shape scheme ([a-z][a-z0-9+.-]*), or mailto:.
// Requiring '://' (or mailto:) keeps prose like 'note: remember' and
// 'foo:bar' out; \S+ to the anchor rejects anything with a space.
const URI = /^[a-z][a-z0-9+.-]*:\/\/\S+$/i;
const MAILTO = /^mailto:\S+$/i;

// Optional leading +, then 7-20 chars drawn from digits/space/()-. — the
// digit-count floor (>= 7) is checked separately so '(((((((' cannot pass.
const PHONE = /^\+?[0-9()\s.-]{7,20}$/;

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

// ISO 8601: date 'T' hh:mm, optional :ss and fraction, optional Z or ±hh:mm.
const DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:[Zz]|[+-]\d{2}:\d{2})?$/;

function inRange(text: string, min: number, max: number): boolean {
  const n = Number(text);
  return n >= min && n <= max;
}

// Month 01-12, day 01-31 — no per-month day table; '2024-02-31' slipping
// through is the price of staying a heuristic.
function validDateParts(month: string, day: string): boolean {
  return inRange(month, 1, 12) && inRange(day, 1, 31);
}

export function matchesFormat(value: string, format: StringFormat): boolean {
  switch (format) {
    case 'email':
      return EMAIL.test(value);
    case 'uri':
      return URI.test(value) || MAILTO.test(value);
    case 'phone': {
      if (!PHONE.test(value)) return false;
      return value.replace(/\D/g, '').length >= 7;
    }
    case 'date': {
      const m = DATE.exec(value);
      return m !== null && validDateParts(m[2]!, m[3]!);
    }
    case 'date-time': {
      const m = DATE_TIME.exec(value);
      if (m === null || !validDateParts(m[2]!, m[3]!)) return false;
      if (!inRange(m[4]!, 0, 23) || !inRange(m[5]!, 0, 59)) return false;
      return m[6] === undefined || inRange(m[6], 0, 59);
    }
  }
}

/** The most specific format `value` matches, or null when it matches none. */
export function detectFormat(value: string): StringFormat | null {
  for (const format of FORMAT_KINDS) {
    if (matchesFormat(value, format)) return format;
  }
  return null;
}
