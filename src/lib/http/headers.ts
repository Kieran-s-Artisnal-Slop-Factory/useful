/**
 * Header validation for the HTTP playground (0.4.0 plan, Phase 3).
 *
 * Two jobs, and the second is the interesting one.
 *
 * **Syntax.** A header name is an RFC 9110 token; a value is visible ASCII
 * plus spaces and tabs. Getting this wrong makes `fetch` throw a `TypeError`
 * that says almost nothing, so it is caught here, at the keystroke, with the
 * character named.
 *
 * **The forbidden list.** The Fetch standard bars a page from setting about
 * twenty headers — `Host`, `Origin`, `Cookie`, `Content-Length` and the rest —
 * because the browser owns them. It does not complain: it **silently drops
 * them**. Every HTTP client that runs in a browser has this behaviour and
 * almost none of them mention it, so the usual experience is a request that
 * plainly does not carry what you typed and a page that acts as though it did.
 * This module names them at edit time instead, which is the whole reason it
 * exists.
 */

/** RFC 9110 token: the characters a header name may be made of. */
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** A header value: visible ASCII, plus space and horizontal tab. */
const VALUE = /^[\t\x20-\x7e\x80-\xff]*$/;

/**
 * Headers the browser will not let a page set, lower-cased.
 *
 * From the Fetch standard's "forbidden request-header" definition. `Proxy-*`
 * and `Sec-*` are prefixes rather than names and are handled separately.
 */
export const FORBIDDEN_HEADERS: string[] = [
  'accept-charset',
  'accept-encoding',
  'access-control-request-headers',
  'access-control-request-method',
  'connection',
  'content-length',
  'cookie',
  'cookie2',
  'date',
  'dnt',
  'expect',
  'host',
  'keep-alive',
  'origin',
  'referer',
  'set-cookie',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'via',
];

const FORBIDDEN_PREFIXES = ['proxy-', 'sec-'];

/**
 * Is this a header the browser reserves for itself?
 *
 * The answer is not "invalid" — it is "you may type it, and it will not be
 * sent", which is a different and much more confusing thing.
 */
export function isForbiddenHeader(name: string): boolean {
  const lower = name.trim().toLowerCase();
  if (FORBIDDEN_HEADERS.includes(lower)) return true;
  return FORBIDDEN_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

export type HeaderProblem =
  /** The name is not a valid token, so `fetch` would refuse it outright. */
  | { kind: 'name'; message: string }
  /** The value carries something a header line cannot. */
  | { kind: 'value'; message: string }
  /** Valid, but the browser will not send it. A warning, not an error. */
  | { kind: 'forbidden'; message: string };

/**
 * What is wrong with this header, if anything. A row with an empty name and
 * an empty value is a blank line in the table, not a mistake.
 */
export function checkHeader(name: string, value: string): HeaderProblem | null {
  const trimmed = name.trim();
  if (trimmed === '') {
    return value.trim() === ''
      ? null
      : { kind: 'name', message: 'This value has no header name.' };
  }

  if (!TOKEN.test(trimmed)) {
    const bad = [...trimmed].find((char) => !TOKEN.test(char));
    return {
      kind: 'name',
      message: `\`${bad}\` cannot appear in a header name — letters, digits and !#$%&'*+-.^_\`|~ only.`,
    };
  }

  if (!VALUE.test(value)) {
    const bad = [...value].find((char) => !VALUE.test(char));
    const shown = bad === '\n' ? 'a line break' : bad === '\r' ? 'a carriage return' : `\`${bad}\``;
    return {
      kind: 'value',
      message: `${shown} cannot appear in a header value.`,
    };
  }

  if (isForbiddenHeader(trimmed)) {
    return {
      kind: 'forbidden',
      message: `The browser sets \`${trimmed}\` itself and will not send yours. It is dropped silently at send time — this is the only warning you get.`,
    };
  }

  return null;
}

export interface HeaderRow {
  name: string;
  value: string;
  /** Unticked rows stay in the table but are not sent. */
  enabled: boolean;
}

export const blankHeader = (): HeaderRow => ({ name: '', value: '', enabled: true });

/**
 * The headers that will actually go out: enabled, named, syntactically valid,
 * and not one the browser reserves. A forbidden header is filtered here as
 * well as flagged, so what the page shows as "will be sent" is the truth
 * rather than a hope.
 */
export function sendableHeaders(rows: readonly HeaderRow[]): [string, string][] {
  return rows
    .filter((row) => row.enabled && row.name.trim() !== '')
    .filter((row) => {
      const problem = checkHeader(row.name, row.value);
      return problem === null;
    })
    .map((row) => [row.name.trim(), row.value.trim()]);
}
