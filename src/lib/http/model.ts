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

const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

/**
 * Re-shape a request read from a store.
 *
 * Nothing read back is trusted. The generic data suite writes an ARRAY into
 * every json column, a backup can be hand-edited, and a row written by an
 * older version has whatever shape that version used. Every field is checked
 * and defaulted here so the rest of the tool can treat an `HttpRequest` as
 * the thing its type says it is — the same stance `normalizeProject` takes in
 * the Compose tool.
 */
export function normalizeRequest(raw: unknown): HttpRequest {
  const blank = blankRequest();
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return blank;
  const value = raw as Record<string, unknown>;

  const method = METHODS.includes(value.method as Method) ? (value.method as Method) : blank.method;
  const bodyKind = (['none', 'json', 'form', 'multipart', 'text'] as BodyKind[]).includes(
    value.bodyKind as BodyKind
  )
    ? (value.bodyKind as BodyKind)
    : 'none';

  const rows = <T>(input: unknown, shape: (item: Record<string, unknown>) => T): T[] =>
    Array.isArray(input)
      ? input
          .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
          .map(shape)
      : [];

  return {
    method,
    url: asString(value.url),
    headers: rows(value.headers, (item) => ({
      name: asString(item.name),
      value: asString(item.value),
      // Absent means enabled: a row nobody has touched is a row to send.
      enabled: item.enabled !== false,
    })),
    bodyKind,
    bodyText: asString(value.bodyText),
    bodyContentType: asString(value.bodyContentType, blank.bodyContentType),
    fields: rows(value.fields, (item) => ({
      name: asString(item.name),
      value: asString(item.value),
      enabled: item.enabled !== false,
    })),
  };
}

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
