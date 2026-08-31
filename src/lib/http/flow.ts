/**
 * Multi-step flows: the model, extraction, and the shape of a run record
 * (0.4.0 plan, Phase 5).
 *
 * The TODO's example is the whole feature in one sentence: authenticate
 * against one endpoint, use the token on the next. What makes that hard is
 * not the loop — it is getting a value out of one response and into the next
 * request without either coupling every step to a payload shape nobody wrote
 * down, or storing a token somewhere it should not be.
 *
 * **Extraction is by explicit rule, not by free-form path into a recording**
 * (Q2). A rule names its source, its path and the name it produces, and it is
 * visible on the step that owns it. The alternative — letting a later step
 * write `{{steps.auth.response.json.token}}` — reads well in a demo and means
 * that every step silently depends on the exact shape of an earlier response,
 * with the dependency written nowhere but inside a string.
 *
 * **Extracted values are ephemeral by default.** They live for the run. A
 * rule can be marked "save", and then the write into the environment is a
 * thing the reader asked for and can see, rather than a side effect of
 * running a flow.
 *
 * **A record is masked before it is built, not when it is drawn** — see
 * `recordSent`. A flow row rides backups like every other row, so the masking
 * has to happen on the way IN. Masking at render time would mean the value
 * was in the database all along and only the screen was polite about it.
 *
 * Pure module: no DOM, no state, no I/O. The runner is in [run.ts](./run.ts).
 */

import { render } from '../template/engine';
import type { HttpRequest } from './model';
import { maskedRequest } from './resolve';
import type { Chain } from './env';

/** Where an extraction rule reads from. */
export type ExtractSource = 'body' | 'header' | 'status';

export interface ExtractRule {
  source: ExtractSource;
  /**
   * For `body`, a path like `token`, `data.token` or `body[0].id`. For
   * `header`, the header name. Ignored for `status`.
   */
  path: string;
  /** The `{{name}}` later steps will see it under. */
  name: string;
  /**
   * Also write it into the active environment when the run finishes. Off by
   * default: a token that outlives its run is a decision, not a default.
   */
  save: boolean;
}

export interface FlowStep {
  id: string;
  name: string;
  /** A saved request's id, or null when the step carries its own copy. */
  request_id: string | null;
  /** The inline request, when `request_id` is null. */
  request: HttpRequest | null;
  outputs: ExtractRule[];
}

/** The request as it was actually sent, with secret values already masked. */
export interface SentSummary {
  method: string;
  url: string;
  headers: [string, string][];
  body: string | null;
}

export interface ResponseSummaryRecord {
  status: number;
  statusText: string;
  headers: [string, string][];
  ms: number;
  /** The full size in bytes, whatever was kept. */
  bytes: number;
  /** The body as text, capped. `null` when it was not text at all. */
  body: string | null;
  /** True when `body` is shorter than what came back. */
  truncated: boolean;
  /** Set instead of a body when the response was binary, or when cut short. */
  note: string | null;
  /** True when a stored secret's value was found in what came back, and removed. */
  redacted: boolean;
}

export interface ExtractedValue {
  name: string;
  /** The value, as text. Masked if it came from a masked source. */
  value: string;
  /** Where it was read from, for the record: `body.data.token`. */
  from: string;
  saved: boolean;
}

export interface StepRecord {
  step_id: string;
  name: string;
  sent: SentSummary | null;
  response: ResponseSummaryRecord | null;
  /** Why the step stopped, when it did. */
  failure: { title: string; detail: string } | null;
  extracted: ExtractedValue[];
  /** Anything that went wrong short of a failure — a rule that found nothing. */
  problems: string[];
}

export interface FlowRun {
  at: string;
  ok: boolean;
  records: StepRecord[];
  /**
   * The step scope as it ended up, with the values as extracted — REAL, not
   * redacted, because the next step has to be able to send them.
   *
   * In memory only. `forStorage` drops it, and `runFlow` is the only thing
   * that returns it. See that function for why.
   */
  values: Record<string, string>;
}

/**
 * A run as it goes into the database.
 *
 * "The step scope is ephemeral" is the plan's phrase, and this is where it
 * stops being a slogan. Dropping the `values` map is the easy half. The hard
 * half is that the same values are *also* sitting inside the records — a
 * token step one extracted appears again in step two's recorded
 * `Authorization` header, and in the recorded body of the response that
 * issued it. Storing the map would be careless; storing three copies of it in
 * a shape nobody thinks to look at would be worse.
 *
 * So every extracted value is redacted out of the stored records too. The
 * cost is real and worth naming: after a reload, a recorded run shows
 * `••••••••` where the token was, and "did step two carry the right one?"
 * has to be answered from a live run rather than from history. The
 * alternative is a live bearer token sitting in a backup file in a downloads
 * folder for as long as that file exists, which is the thing this release is
 * about not doing. The live view — the run you just watched — keeps every
 * value, because nothing has been written down yet.
 *
 * The only way an extracted value reaches storage deliberately is the
 * explicit "save to the environment" click.
 */
export function forStorage(run: FlowRun): Omit<FlowRun, 'values'> {
  const { values, records, ...rest } = run;
  const live = Object.values(values);
  if (live.length === 0) return { ...rest, records };
  return { ...rest, records: records.map((record) => redactRecord(record, live)) };
}

/** Every place a value that flowed through the run could have landed. */
function redactRecord(record: StepRecord, values: readonly string[]): StepRecord {
  const scrub = (text: string) => redactSecrets(text, values);
  return {
    ...record,
    sent: record.sent && {
      ...record.sent,
      url: scrub(record.sent.url),
      headers: record.sent.headers.map(([name, value]) => [name, scrub(value)] as [string, string]),
      body: record.sent.body === null ? null : scrub(record.sent.body),
    },
    response: record.response && {
      ...record.response,
      headers: record.response.headers.map(
        ([name, value]) => [name, scrub(value)] as [string, string]
      ),
      body: record.response.body === null ? null : scrub(record.response.body),
    },
    extracted: record.extracted.map((item) => ({ ...item, value: scrub(item.value) })),
  };
}

/**
 * How much of a response body a record keeps (decision 7).
 *
 * The live view shows everything; only the STORED copy is capped. A flow that
 * recorded a 200 MB download whole would take the backup file with it, and a
 * backup nobody can open is a backup nobody has.
 */
export const STORED_BODY_LIMIT = 256 * 1024;

export const blankRule = (): ExtractRule => ({ source: 'body', path: '', name: '', save: false });

export const blankStep = (id: string, name: string): FlowStep => ({
  id,
  name,
  request_id: null,
  request: null,
  outputs: [],
});

/**
 * The auth-then-GET example, offered on an empty flow.
 *
 * The plan asks for it by name, and it earns its place: it is the shape
 * almost every real flow has, and having it written out means the first thing
 * someone sees is a working extraction rule rather than an empty table and a
 * guess about what a path looks like.
 */
export function starterSteps(newId: () => string): FlowStep[] {
  const auth = blankStep(newId(), 'Authenticate');
  auth.outputs = [{ source: 'body', path: 'token', name: 'token', save: false }];
  const use = blankStep(newId(), 'Use the token');
  return [auth, use];
}

// --- extraction -----------------------------------------------------------

export interface ExtractInput {
  status: number;
  headers: readonly [string, string][];
  /** The body as text; `null` when it was not text. */
  text: string | null;
}

export type ExtractOutcome =
  | { ok: true; value: string; from: string }
  | { ok: false; problem: string };

/**
 * Read one value out of a response.
 *
 * A rule that finds nothing REPORTS it. The tempting alternative — an empty
 * string — turns a renamed field into a request that goes out with a blank
 * where the token should be, and by the time the 401 comes back the cause is
 * three steps upstream.
 */
export function extract(rule: ExtractRule, response: ExtractInput): ExtractOutcome {
  if (rule.name.trim() === '') {
    return { ok: false, problem: 'This rule has no name, so nothing could be stored under it.' };
  }

  if (rule.source === 'status') {
    return { ok: true, value: String(response.status), from: 'status' };
  }

  if (rule.source === 'header') {
    const wanted = rule.path.trim().toLowerCase();
    if (wanted === '') return { ok: false, problem: 'This rule names no header to read.' };
    const hit = response.headers.find(([name]) => name.toLowerCase() === wanted);
    if (!hit) {
      return {
        ok: false,
        problem: `The response has no \`${rule.path.trim()}\` header. It sent: ${
          response.headers.map(([name]) => name).join(', ') || '(no headers)'
        }.`,
      };
    }
    return { ok: true, value: hit[1], from: `header ${hit[0]}` };
  }

  const path = rule.path.trim();
  if (path === '') return { ok: false, problem: 'This rule names no path to read.' };
  if (response.text === null) {
    return { ok: false, problem: 'The response body was not text, so there is no path to read.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.text);
  } catch (error) {
    return {
      ok: false,
      problem: `The response body is not JSON, so \`${path}\` cannot be read from it: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  // The path is resolved by the SAME engine the request templates use, so
  // there is one path syntax in this tool rather than two that almost agree —
  // and one set of error messages, which are better than anything worth
  // writing twice ("`data` has no `token` field").
  //
  // `body` is the whole document, so a response that is a list is reachable
  // as `body[0].id`; top-level keys are also spread in, so the common case is
  // just `token`. A document with a top-level key literally called `body` is
  // shadowed by the alias and reachable as `body.body`.
  const values: Record<string, unknown> =
    typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? { ...(parsed as Record<string, unknown>), body: parsed }
      : { body: parsed };

  const result = render(`{{${path}}}`, [{ name: 'the response', values }]);
  if (!result.ok) {
    return { ok: false, problem: result.errors[0]?.message ?? `\`${path}\` is not in the response.` };
  }
  return { ok: true, value: result.text, from: `body ${path}` };
}

// --- records --------------------------------------------------------------

/**
 * The request as sent, masked, ready to store.
 *
 * Takes the UNRESOLVED request and the chain rather than the resolved one, so
 * the masked copy is built from the template — there is no code path here
 * that has the real secret in hand and chooses not to write it.
 */
export function recordSent(request: HttpRequest, chain: Chain): SentSummary {
  const masked = maskedRequest(request, chain);
  return {
    method: masked.method,
    url: masked.url,
    headers: masked.headers
      .filter((row) => row.enabled && row.name.trim() !== '')
      .map((row) => [row.name, row.value] as [string, string]),
    body: masked.bodyKind === 'none' ? null : masked.bodyText,
  };
}

/**
 * Take any stored secret's value back out of text a SERVER produced.
 *
 * Masking the request is not enough, and finding that out was the point of
 * writing the test first: plenty of endpoints echo the `Authorization` header
 * straight back, and every auth endpoint returns a credential in its body by
 * definition. Either way the value lands in a recorded response, and a flow
 * row rides backups.
 *
 * This is a literal search-and-replace, which is exactly the technique
 * [resolve.ts](./resolve.ts) argues against for the request preview — and the
 * difference is worth being explicit about. There, the placeholders are known
 * and re-rendering is strictly more precise. Here the bytes came from
 * somewhere else and there is nothing to re-render from, so matching the
 * value is the only method available. Its failure mode is over-redaction: a
 * body that happened to contain those characters for another reason loses
 * them. For a promise that a declared secret is not written to disk, erring
 * towards redacting too much is the right direction, and the record says when
 * it happened rather than leaving the reader to wonder about the bullets.
 *
 * Longest first, so a secret that contains another secret redacts whole.
 */
export function redactSecrets(text: string, values: readonly string[]): string {
  let out = text;
  for (const value of [...values].filter(Boolean).sort((a, b) => b.length - a.length)) {
    out = out.split(value).join(MASKED);
  }
  return out;
}

/** What a redacted secret looks like in a record. Matches the UI's mask. */
export const MASKED = '••••••••';

/** Cap a response body for storage, saying so on the record when it is cut. */
export function recordBody(
  text: string | null,
  bytes: number,
  sniffedMime: string | null,
  secretValues: readonly string[] = []
): Pick<ResponseSummaryRecord, 'body' | 'truncated' | 'note' | 'redacted'> {
  if (text === null) {
    return {
      body: null,
      truncated: false,
      redacted: false,
      note: `The body was ${sniffedMime ?? 'not text'} — ${bytes} bytes of it. Binary bodies are not recorded; a backup is one JSON file.`,
    };
  }

  const clean = redactSecrets(text, secretValues);
  const redacted = clean !== text;
  const redactionNote = redacted
    ? ' A stored secret’s value came back in this body and was taken out before the record was written — the response you saw live had it.'
    : '';

  if (clean.length <= STORED_BODY_LIMIT) {
    return { body: clean, truncated: false, redacted, note: redactionNote.trim() || null };
  }
  return {
    body: clean.slice(0, STORED_BODY_LIMIT),
    truncated: true,
    redacted,
    note:
      `Recorded to ${STORED_BODY_LIMIT.toLocaleString('en')} characters of ${clean.length.toLocaleString('en')}. The live view above shows the whole thing; only the stored copy is capped.` +
      redactionNote,
  };
}

// --- reading a stored flow ------------------------------------------------

const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

/** A stored `steps` column, re-shaped. Nothing read from a store is trusted. */
export function normalizeSteps(raw: unknown): FlowStep[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item, index) => ({
      id: asString(item.id, `step-${index}`),
      name: asString(item.name, `Step ${index + 1}`),
      request_id: typeof item.request_id === 'string' ? item.request_id : null,
      request: (item.request ?? null) as HttpRequest | null,
      outputs: normalizeRules(item.outputs),
    }));
}

function normalizeRules(raw: unknown): ExtractRule[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({
      source: (['body', 'header', 'status'] as ExtractSource[]).includes(item.source as ExtractSource)
        ? (item.source as ExtractSource)
        : 'body',
      path: asString(item.path),
      name: asString(item.name),
      save: item.save === true,
    }));
}

/** A stored `last_run` column, re-shaped, or null when there is not one. */
export function normalizeRun(raw: unknown): FlowRun | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (!Array.isArray(value.records)) return null;
  return {
    at: asString(value.at),
    ok: value.ok === true,
    records: value.records as StepRecord[],
    values:
      typeof value.values === 'object' && value.values !== null && !Array.isArray(value.values)
        ? (value.values as Record<string, string>)
        : {},
  };
}
