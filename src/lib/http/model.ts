/**
 * The HTTP playground's request model (0.4.0 plan, Phase 3).
 *
 * Deliberately a plain object with no behaviour: Phase 4 saves it, Phase 5
 * chains it, and both want something JSON-native they can store without a
 * conversion step. The send path in [send.ts](./send.ts) turns it into a
 * `fetch` call; nothing here knows what a network is.
 */

import type { HeaderRow } from './headers';

export const METHODS = [
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
] as const;

export type Method = (typeof METHODS)[number];

/** Methods the Fetch standard forbids a body on, whatever the page says. */
export const BODYLESS_METHODS: Method[] = ['GET', 'HEAD'];

export type BodyKind = 'none' | 'json' | 'form' | 'multipart' | 'text';

export const BODY_KINDS: { id: BodyKind; label: string; hint: string }[] = [
  { id: 'none', label: 'None', hint: 'No body at all' },
  { id: 'json', label: 'JSON', hint: 'application/json, checked before it is sent' },
  { id: 'form', label: 'Form', hint: 'application/x-www-form-urlencoded' },
  { id: 'multipart', label: 'Multipart', hint: 'multipart/form-data, with files' },
  { id: 'text', label: 'Raw', hint: 'Whatever you type, with a type you choose' },
];

/** One key/value row in a form or multipart body. */
export interface FieldRow {
  name: string;
  value: string;
  enabled: boolean;
}

export const blankField = (): FieldRow => ({ name: '', value: '', enabled: true });

export interface HttpRequest {
  method: Method;
  url: string;
  headers: HeaderRow[];
  bodyKind: BodyKind;
  /** JSON and raw share this; which one is meant is `bodyKind`. */
  bodyText: string;
  /** The `Content-Type` for a raw body. Ignored by every other kind. */
  bodyContentType: string;
  /** Rows for `form` and the text part of `multipart`. */
  fields: FieldRow[];
}

export const blankRequest = (): HttpRequest => ({
  method: 'GET',
  url: '',
  headers: [{ name: 'Accept', value: 'application/json', enabled: true }],
  bodyKind: 'none',
  bodyText: '',
  bodyContentType: 'text/plain',
  fields: [],
});

/** Does this method carry a body? GET and HEAD cannot, and `fetch` throws. */
export const carriesBody = (method: Method): boolean => !BODYLESS_METHODS.includes(method);

export type UrlProblem = { message: string } | null;

/**
 * Is this a URL `fetch` will accept?
 *
 * Only `http:` and `https:` are allowed through: a `file:` or `data:` URL
 * fails in a way that reads like a network error, and saying so here costs
 * nothing.
 */
export function checkUrl(raw: string): UrlProblem {
  const trimmed = raw.trim();
  if (trimmed === '') return { message: 'Enter a URL to send to.' };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      message:
        'That is not a complete URL. It needs a scheme — try https:// in front of it.',
    };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      message: `\`${parsed.protocol}\` cannot be fetched from a page. Only http: and https: can.`,
    };
  }
  return null;
}
