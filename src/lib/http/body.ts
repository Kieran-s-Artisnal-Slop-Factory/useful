/**
 * Turning the request model's body into something `fetch` will take
 * (0.4.0 plan, Phase 3).
 *
 * The encoding decisions are the substance here, and two of them are the kind
 * that bite quietly:
 *
 * **Form encoding is `URLSearchParams`, not hand-rolled.** A space becomes
 * `+` rather than `%20`, `&` and `=` inside a value are escaped, and non-ASCII
 * goes out as UTF-8 percent-escapes. Writing that by hand is how a value
 * containing an ampersand silently becomes two fields.
 *
 * **Multipart never sets its own `Content-Type`.** `FormData` chooses a
 * boundary and the browser writes the header to match it. Setting the header
 * yourself keeps your boundary and discards the real one, so the server reads
 * a body it cannot split — a classic that produces an empty form and no error.
 * The page says so, and `bodyHeaders` refuses to emit one.
 */

import { carriesBody, type FieldRow, type HttpRequest } from './model';

export type BodyResult =
  | { ok: true; body: BodyInit | null; headers: [string, string][] }
  | { ok: false; error: string; at?: number };

const activeFields = (fields: readonly FieldRow[]): FieldRow[] =>
  fields.filter((field) => field.enabled && field.name.trim() !== '');

/** The form body as it will go over the wire — shown on the page, verbatim. */
export function encodeForm(fields: readonly FieldRow[]): string {
  const params = new URLSearchParams();
  for (const field of activeFields(fields)) params.append(field.name.trim(), field.value);
  return params.toString();
}

export interface JsonProblem {
  message: string;
  /** Character offset the parser gave up at, when it named one. */
  at: number | null;
}

/**
 * Parse the JSON body, keeping the offset.
 *
 * V8 puts the position in the message ("at position 14"); other engines do
 * not, and `SyntaxError` has no standard field for it. Pulling it out when it
 * is there is worth it — the editor can put the caret on the character — and
 * `null` is honest when it is not.
 */
export function checkJson(text: string): JsonProblem | null {
  if (text.trim() === '') return { message: 'The body is empty. JSON needs at least a value.', at: null };
  try {
    JSON.parse(text);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const match = /at position (\d+)/i.exec(message);
    return { message, at: match ? Number(match[1]) : null };
  }
}

/**
 * Build the body and the headers it implies.
 *
 * Returns `ok: false` when the request cannot be sent as written — an invalid
 * JSON body is the only such case, and the page blocks Send on it rather than
 * letting a server reject it a second later.
 */
export function buildBody(
  request: HttpRequest,
  files: readonly { name: string; file: File }[] = []
): BodyResult {
  if (!carriesBody(request.method) || request.bodyKind === 'none') {
    return { ok: true, body: null, headers: [] };
  }

  switch (request.bodyKind) {
    case 'json': {
      const problem = checkJson(request.bodyText);
      if (problem) {
        return { ok: false, error: problem.message, at: problem.at ?? undefined };
      }
      return {
        ok: true,
        body: request.bodyText,
        headers: [['Content-Type', 'application/json']],
      };
    }

    case 'form':
      return {
        ok: true,
        body: encodeForm(request.fields),
        headers: [['Content-Type', 'application/x-www-form-urlencoded;charset=UTF-8']],
      };

    case 'multipart': {
      const form = new FormData();
      for (const field of activeFields(request.fields)) form.append(field.name.trim(), field.value);
      for (const entry of files) form.append(entry.name, entry.file, entry.file.name);
      // No Content-Type: the browser writes one WITH the boundary FormData
      // chose. Ours would keep the wrong boundary and the server would read a
      // body it cannot split.
      return { ok: true, body: form, headers: [] };
    }

    case 'text':
      return {
        ok: true,
        body: request.bodyText,
        headers: request.bodyContentType.trim()
          ? [['Content-Type', request.bodyContentType.trim()]]
          : [],
      };
  }
}

/**
 * Is a `Content-Type` the page set going to be overridden or cause trouble?
 *
 * Only multipart, and only because it is the one where being wrong is silent.
 */
export function contentTypeWarning(request: HttpRequest, headerNames: readonly string[]): string | null {
  if (request.bodyKind !== 'multipart') return null;
  const set = headerNames.some((name) => name.trim().toLowerCase() === 'content-type');
  if (!set) return null;
  return 'Remove the Content-Type header for a multipart body. The browser has to write it itself, because only it knows the boundary FormData picked — yours would name a boundary that is not in the body, and the server would read no fields at all.';
}
