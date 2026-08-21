/**
 * String-format heuristics for config-schema inference: does a string value
 * look like an email, phone number, URI, date, or date-time?
 *
 * Regex-based and pragmatic, not RFC-complete — a false negative only costs a
 * plain `string` type in the inferred schema, so every check trades corner
 * cases for "no prose ever slips through". detectFormat tries the formats
 * most-specific-first; phone goes last because its character class (digits,
 * spaces, `().-`) also matches dates and plenty of ids.
 *
 * The patterns are kept as SOURCE STRINGS, and they are the one definition
 * three consumers share: this module's own matchers, the code generator's
 * emitted Python / JavaScript / Go checks, and the web component's runtime.
 * A page that calls a value an email and a generated parser that disagrees is
 * the drift this layout exists to prevent — so every rule lives in the regex
 * itself (month 01-12, seven-plus digits, ...) rather than in code beside it,
 * and every pattern stays portable: RE2-compatible (no lookarounds, no
 * backreferences), case handled by explicit classes rather than a flag, no
 * single quote, backtick or unescaped slash, so each language's literal
 * syntax can wrap it verbatim.
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

/** The portable pattern sources (see the header). */
export const FORMAT_SOURCES: Record<StringFormat, string> = {
  // One @, word-ish local part, domain with at least one dot; no spaces.
  email: '^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)+$',
  // scheme://rest with a known-shape scheme, or mailto:. Requiring '://'
  // (or mailto:) keeps prose like 'note: remember' and 'foo:bar' out; the
  // no-whitespace tail rejects anything with a space.
  uri: '^(?:[A-Za-z][A-Za-z0-9+.-]*:\\/\\/[^\\s]+|[Mm][Aa][Ii][Ll][Tt][Oo]:[^\\s]+)$',
  // Optional leading +, then 7-20 digits with any amount of space/()-.
  // between them. The digit floor is in the pattern (each repetition ends in
  // a digit), so '(((((((' cannot pass.
  phone: '^\\+?(?:[()\\s.-]*[0-9]){7,20}[()\\s.-]*$',
  // YYYY-MM-DD with month 01-12 and day 01-31 — no per-month day table;
  // '2024-02-31' slipping through is the price of staying a heuristic.
  date: '^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])$',
  // ISO 8601: date 'T' hh:mm, optional :ss and fraction, optional Z or ±hh:mm.
  'date-time':
    '^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])[Tt](?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:[Zz]|[+-]\\d{2}:\\d{2})?$',
};

const MATCHERS: Record<StringFormat, RegExp> = {
  email: new RegExp(FORMAT_SOURCES.email),
  uri: new RegExp(FORMAT_SOURCES.uri),
  phone: new RegExp(FORMAT_SOURCES.phone),
  date: new RegExp(FORMAT_SOURCES.date),
  'date-time': new RegExp(FORMAT_SOURCES['date-time']),
};

export function matchesFormat(value: string, format: StringFormat): boolean {
  return MATCHERS[format].test(value);
}

/** The most specific format `value` matches, or null when it matches none. */
export function detectFormat(value: string): StringFormat | null {
  for (const format of FORMAT_KINDS) {
    if (matchesFormat(value, format)) return format;
  }
  return null;
}
