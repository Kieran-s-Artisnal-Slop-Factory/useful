/**
 * Running a flow (0.4.0 plan, Phase 5).
 *
 * One step at a time, in order, stopping at the first failure. The whole
 * interesting part is what happens BETWEEN steps: each step is resolved
 * against a chain whose top scope is everything earlier steps extracted, so a
 * token fetched by step one is simply a `{{token}}` in step two.
 *
 * **A failed step halts the run.** Continuing past one would mean sending
 * requests built from a scope that is missing whatever the failed step was
 * supposed to produce — a cascade of 401s whose real cause is three records
 * up. The record shows where it stopped and why, in place.
 *
 * **The step scope is ephemeral.** It exists for the run. `runFlow` returns
 * the values it ended with; writing any of them into an environment is the
 * caller's decision to take, prompted by the rules the user marked `save`.
 *
 * `send` and the clock are injected so the whole thing is testable without a
 * network — the same shape [send.ts](./send.ts) already uses.
 */

import { buildChain, type Chain, type ChainInput } from './env';
import {
  extract,
  recordBody,
  recordSent,
  redactSecrets,
  type ExtractedValue,
  type FlowRun,
  type FlowStep,
  type StepRecord,
} from './flow';
import type { HttpRequest } from './model';
import { resolveRequest } from './resolve';
import { send as realSend, type SendResult } from './send';

/** What the step scope is called where the reader can see it. */
export const STEP_SCOPE = 'earlier steps';

export interface FlowRunInput {
  steps: readonly FlowStep[];
  /**
   * The request a step means, resolved from its `request_id` or its inline
   * copy. Returning null is a halt with a stated reason — a step pointing at
   * a request somebody deleted is exactly the case this covers.
   */
  requestFor: (step: FlowStep) => HttpRequest | null;
  /** Everything below the step scope; the runner supplies the step scope. */
  base: Omit<ChainInput, 'step' | 'stepName'>;
  send?: typeof realSend;
  signal?: AbortSignal;
  now?: () => string;
  /**
   * Origins already known to answer this page. The runner adds to its own
   * copy as steps succeed, so a step three that fails against a host steps
   * one and two just used gets told that plainly instead of "most likely".
   */
  provenOrigins?: readonly string[];
  /** Called after each step, so the page can draw a run as it happens. */
  onProgress?: (records: StepRecord[]) => void;

  // --- stepping through, one step at a time -------------------------------
  // The plan asks for both "run it" and "walk it". Walking is the same
  // function with a window over the steps and the previous partial run handed
  // back in, rather than a second code path that would drift from this one.
  /** Index of the first step to run. Default 0. */
  from?: number;
  /** Run at most this many steps. Default: all of them. */
  limit?: number;
  /** Values an earlier partial run ended with. */
  values?: Readonly<Record<string, string>>;
  /** Records an earlier partial run produced, kept in front of the new ones. */
  records?: readonly StepRecord[];
}

const decoder = new TextDecoder();

/** The chain for one step: earlier values on top of the ordinary lookup. */
export function chainForStep(
  base: Omit<ChainInput, 'step' | 'stepName'>,
  values: Record<string, string>
): Chain {
  return buildChain({ ...base, step: values, stepName: STEP_SCOPE });
}

export async function runFlow(input: FlowRunInput): Promise<FlowRun> {
  const doSend = input.send ?? realSend;
  const clock = input.now ?? (() => new Date().toISOString());
  const at = clock();
  const records: StepRecord[] = [...(input.records ?? [])];
  const values: Record<string, string> = { ...(input.values ?? {}) };
  let ok = true;

  const emit = () => input.onProgress?.([...records]);

  const from = input.from ?? 0;
  const window = input.steps.slice(from, input.limit === undefined ? undefined : from + input.limit);

  /**
   * Every stored secret's value, for redacting anything a server sends back.
   * ALL of them, not only the ones in scope: being out of scope for this run
   * does not make a value safe to write into a row that rides backups.
   */
  const secretText = input.base.secrets.map((row) => row.value);

  const proven = new Set(input.provenOrigins ?? []);
  const noteOrigin = (url: string) => {
    try {
      proven.add(new URL(url).origin);
    } catch {
      /* nothing to learn from a URL that will not parse */
    }
  };

  for (const step of window) {
    const record: StepRecord = {
      step_id: step.id,
      name: step.name,
      sent: null,
      response: null,
      failure: null,
      extracted: [],
      problems: [],
    };
    records.push(record);

    const request = input.requestFor(step);
    if (!request) {
      record.failure = {
        title: 'This step has no request',
        detail:
          'It points at a saved request that is not there any more, or it never carried one. Pick a request for it and run again.',
      };
      ok = false;
      emit();
      break;
    }

    const chain = chainForStep(input.base, values);

    // Masked FIRST, and from the template rather than from the resolved copy:
    // there is deliberately no point in this function where the real secret
    // is in a variable that gets written to a record.
    record.sent = recordSent(request, chain);

    const resolved = resolveRequest(request, chain);
    if (!resolved.ok) {
      record.failure = {
        title: 'A variable could not be resolved',
        detail: resolved.problems
          .map((problem) => `${problem.field.label}: ${problem.message}`)
          .join(' '),
      };
      ok = false;
      emit();
      break;
    }

    let result: SendResult;
    try {
      result = await doSend(resolved.request, {
        signal: input.signal,
        provenOrigins: [...proven],
      });
    } catch (error) {
      record.failure = {
        title: 'The step could not be sent',
        detail: error instanceof Error ? error.message : String(error),
      };
      ok = false;
      emit();
      break;
    }

    if (!result.ok) {
      record.failure = { title: result.failure.title, detail: result.failure.detail };
      ok = false;
      emit();
      break;
    }

    const response = result.response;
    noteOrigin(response.url);
    const textual = response.sniffedMime === null || response.sniffedMime.startsWith('text/') ||
      response.sniffedMime === 'image/svg+xml' || isTextualType(response.contentType);
    const text = textual ? decoder.decode(response.bytes) : null;

    record.response = {
      status: response.status,
      statusText: response.statusText,
      // Headers get the same treatment as the body: an endpoint that reflects
      // your credential into a header is no less of a leak than one that puts
      // it in the payload.
      headers: response.headers.map(
        ([name, value]) => [name, redactSecrets(value, secretText)] as [string, string]
      ),
      ms: response.ms,
      bytes: response.bytes.length,
      ...recordBody(text, response.bytes.length, response.sniffedMime, secretText),
    };

    for (const rule of step.outputs) {
      // Extraction reads the RAW text: a rule pointing at a field that
      // happens to hold a credential must still produce the real value, or
      // the next step sends bullets. Only what is RECORDED is redacted.
      const outcome = extract(rule, {
        status: response.status,
        headers: response.headers,
        text,
      });
      if (!outcome.ok) {
        record.problems.push(`\`${rule.name || '(unnamed)'}\`: ${outcome.problem}`);
        continue;
      }
      values[rule.name] = outcome.value;
      const captured: ExtractedValue = {
        name: rule.name,
        value: redactSecrets(outcome.value, secretText),
        from: outcome.from,
        saved: rule.save,
      };
      record.extracted.push(captured);
    }

    // A rule that found nothing does not stop the run on its own — the next
    // step's unresolved `{{name}}` will, with a better message and the record
    // above it showing exactly which rule came up empty.
    emit();
  }

  return { at, ok, records, values };
}

/**
 * `sniff` reports `text/plain` for anything textual, which loses the fact
 * that a JSON body IS text worth recording. The declared type is consulted
 * only for this — deciding whether to KEEP the bytes as text, never to decide
 * how to render them.
 */
function isTextualType(contentType: string | null): boolean {
  const declared = (contentType ?? '').split(';')[0]!.trim().toLowerCase();
  if (declared === '') return false;
  return (
    declared.startsWith('text/') ||
    declared.endsWith('/json') ||
    declared.endsWith('+json') ||
    declared.endsWith('/xml') ||
    declared.endsWith('+xml') ||
    declared === 'application/javascript' ||
    declared === 'application/x-www-form-urlencoded'
  );
}
