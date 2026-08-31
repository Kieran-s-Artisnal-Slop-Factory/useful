/**
 * Rendering a request's `{{placeholders}}` before it is sent (0.4.0 plan,
 * Phase 4, scope item 3).
 *
 * The engine in [template/engine.ts](../template/engine.ts) does the work per
 * string; this module knows which strings a request is made of, keeps track
 * of which field each result came from, and refuses to hand back a request
 * that is not fully resolved.
 *
 * **An unresolved placeholder is an error, never an empty string** (decision
 * 2). This is the bug the whole feature is shaped around: sending
 * `Authorization: Bearer` because `{{token}}` quietly became nothing produces
 * a 401 from the server and no clue whatsoever from the client, and every
 * HTTP client that treats a missing variable as empty has cost someone an
 * afternoon. Here the send is blocked and the placeholder is named.
 *
 * **What is templated.** URL, header values, the body text, and form/multipart
 * field values. Not header NAMES and not field names: the plan lists values,
 * a templated header name is a thing nobody has ever wanted, and leaving them
 * literal keeps the "this request needs …" list about data rather than shape.
 *
 * Pure module: no DOM, no state, no I/O. The masking here is why — a preview
 * built by a component could be built two different ways by two components,
 * and one of them would eventually show a key.
 */

import { lint, render, type Resolution, type TemplateError } from '../template/engine';
import type { Chain } from './env';
import { MASK } from './secrets';
import type { HttpRequest } from './model';

/** Which part of a request a placeholder was found in. */
export interface FieldRef {
  /** Shown to the reader: `URL`, `Header “Authorization”`, `Body`. */
  label: string;
  /** Stable identifier for a test or a key. */
  id: string;
}

export interface ResolvedField extends Resolution {
  field: FieldRef;
  /** True when the winning scope is a secret one — never display `value`. */
  secret: boolean;
}

export interface ResolveProblem extends TemplateError {
  field: FieldRef;
}

export type ResolveResult =
  | { ok: true; request: HttpRequest; resolutions: ResolvedField[]; problems: [] }
  | { ok: false; request: null; resolutions: ResolvedField[]; problems: ResolveProblem[] };

/** One templated string in a request, paired with where it goes back. */
interface Slot {
  field: FieldRef;
  text: string;
  put: (request: HttpRequest, value: string) => void;
}

function slotsOf(request: HttpRequest): Slot[] {
  const slots: Slot[] = [
    {
      field: { label: 'URL', id: 'url' },
      text: request.url,
      put: (target, value) => {
        target.url = value;
      },
    },
  ];

  request.headers.forEach((row, index) => {
    if (!row.enabled) return;
    slots.push({
      field: { label: `Header “${row.name || '(unnamed)'}”`, id: `header-${index}` },
      text: row.value,
      put: (target, value) => {
        target.headers[index]!.value = value;
      },
    });
  });

  slots.push({
    field: { label: 'Body', id: 'body' },
    text: request.bodyText,
    put: (target, value) => {
      target.bodyText = value;
    },
  });

  request.fields.forEach((row, index) => {
    if (!row.enabled) return;
    slots.push({
      field: { label: `Field “${row.name || '(unnamed)'}”`, id: `field-${index}` },
      text: row.value,
      put: (target, value) => {
        target.fields[index]!.value = value;
      },
    });
  });

  return slots;
}

/**
 * A deep-enough copy to write resolved values into without touching the
 * caller's request. `structuredClone` would do it, but the request is three
 * levels of plain data and spelling the copy out keeps it obvious that the
 * ORIGINAL — the one that gets saved — keeps its placeholders.
 */
const copy = (request: HttpRequest): HttpRequest => ({
  ...request,
  headers: request.headers.map((row) => ({ ...row })),
  fields: request.fields.map((row) => ({ ...row })),
});

/**
 * Resolve every templated part of `request` against `chain`.
 *
 * Returns EVERY problem rather than stopping at the first: the pre-send panel
 * lists them all, and failing one at a time would mean one fix per attempt.
 */
export function resolveRequest(request: HttpRequest, chain: Chain): ResolveResult {
  const rendered = copy(request);
  const resolutions: ResolvedField[] = [];
  const problems: ResolveProblem[] = [];

  for (const slot of slotsOf(request)) {
    const result = render(slot.text, chain.scopes);
    for (const resolution of result.resolutions) {
      resolutions.push({
        ...resolution,
        field: slot.field,
        secret: chain.secretScopes.has(resolution.scope),
      });
    }
    for (const error of result.errors) problems.push({ ...error, field: slot.field });
    if (result.ok) slot.put(rendered, result.text);
  }

  if (problems.length > 0) return { ok: false, request: null, resolutions, problems };
  return { ok: true, request: rendered, resolutions, problems: [] };
}

/**
 * What the request looks like with its placeholders filled in, for the
 * pre-send preview — with **secret values masked**.
 *
 * Built by re-rendering from the resolutions rather than by string-replacing
 * the rendered output, because a search-and-replace over the finished text
 * would also blank any other occurrence of those characters, and would miss a
 * secret whose value happened to be a substring of something else.
 */
export function maskedText(text: string, chain: Chain): string {
  const result = render(text, chain.scopes);
  const pieces: string[] = [];
  let cursor = 0;
  // `resolutions` are in source order, and each carries the offset and length
  // of the placeholder it replaced.
  for (const resolution of result.resolutions) {
    pieces.push(text.slice(cursor, resolution.offset));
    pieces.push(chain.secretScopes.has(resolution.scope) ? MASK : resolution.value);
    cursor = resolution.offset + resolution.length;
  }
  pieces.push(text.slice(cursor));
  return pieces.join('');
}

/** The whole request, previewed with secrets masked. */
export function maskedRequest(request: HttpRequest, chain: Chain): HttpRequest {
  const shown = copy(request);
  for (const slot of slotsOf(request)) slot.put(shown, maskedText(slot.text, chain));
  return shown;
}

/**
 * Every distinct placeholder name the request mentions, in first-seen order —
 * the "this request needs …" list, available before any environment exists.
 */
export function requiredNames(request: HttpRequest): string[] {
  const names: string[] = [];
  for (const slot of slotsOf(request)) {
    for (const name of lint(slot.text).names) if (!names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * The names this request needs that no scope can supply, in first-seen order.
 *
 * Note it is the ROOT name, not the path: `{{user.id}}` and `{{user.name}}`
 * both want one entry called `user`, and offering to create two would create
 * a table that cannot work. A root that resolves to an object is the caller's
 * problem to fill in properly; this only reports that nothing provides it.
 */
export function unknownNames(request: HttpRequest, chain: Chain): string[] {
  return requiredNames(request).filter(
    (name) => !chain.scopes.some((scope) => Object.prototype.hasOwnProperty.call(scope.values, name))
  );
}
