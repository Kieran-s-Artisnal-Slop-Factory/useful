/**
 * The send path (0.4.0 plan, Phase 3).
 *
 * The one impure module in `src/lib/http/`: everything it decides is decided
 * elsewhere, so what is left here is `fetch`, a clock and an `AbortController`.
 *
 * Nothing is sent that was not explicitly asked for. There is no retry, no
 * preflight of our own, no telemetry, no proxy — one click, one request, and
 * `payload.spec.ts` keeps proving the rest of the app never calls out at all.
 */

import { sniff } from '../encode/sniff';
import { buildBody } from './body';
import { classifyFailure, compareContentType, type Failure, type TypeDisagreement } from './classify';
import { sendableHeaders } from './headers';
import type { HttpRequest } from './model';

export interface ResponseSummary {
  status: number;
  statusText: string;
  /** `true` for 2xx. */
  ok: boolean;
  /** Response headers, in the order the browser hands them over. */
  headers: [string, string][];
  /** The body, whole. Capping is a Phase 5 concern — the live view shows it all. */
  bytes: Uint8Array;
  /** Wall clock from just before `fetch` to the body being fully read. */
  ms: number;
  /** The final URL, which differs from the request's when it was redirected. */
  url: string;
  redirected: boolean;
  /** What the server said the body is. */
  contentType: string | null;
  /** What the bytes say it is, which is not always the same thing. */
  sniffedMime: string | null;
  sniffedExtension: string | null;
  sniffedLabel: string | null;
  disagreement: TypeDisagreement | null;
}

export type SendResult =
  | { ok: true; response: ResponseSummary }
  | { ok: false; failure: Failure; ms: number };

export interface SendOptions {
  signal?: AbortSignal;
  /** Files for a multipart body, paired with their field names. */
  files?: readonly { name: string; file: File }[];
  /** Injected so the classifier can be tested without a browser. */
  pageOrigin?: string;
  online?: boolean;
  /**
   * Origins that have already answered this page. Passed straight to the
   * classifier, which uses them to turn "most likely CORS" into a certainty
   * when the host has demonstrably served this page before.
   */
  provenOrigins?: readonly string[];
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/**
 * Send the request and read the whole response.
 *
 * A non-2xx status is a RESULT, not a failure: 404 is an answer, and the
 * viewer shows it like any other. Only a rejected `fetch` — where the browser
 * declines to say what happened — reaches the classifier.
 */
export async function send(request: HttpRequest, options: SendOptions = {}): Promise<SendResult> {
  const doFetch = options.fetchImpl ?? fetch;
  const clock = options.now ?? (() => Date.now());
  const pageOrigin =
    options.pageOrigin ?? (typeof location === 'undefined' ? '' : location.origin);
  const online = options.online ?? (typeof navigator === 'undefined' ? true : navigator.onLine);

  const built = buildBody(request, options.files ?? []);
  if (!built.ok) {
    return {
      ok: false,
      ms: 0,
      failure: {
        kind: 'unknown',
        title: 'The body is not ready to send',
        detail: built.error,
        guess: false,
      },
    };
  }

  // The body's own Content-Type goes on first so an explicit header still wins.
  const headers = new Headers();
  for (const [name, value] of built.headers) headers.set(name, value);
  for (const [name, value] of sendableHeaders(request.headers)) headers.set(name, value);

  const started = clock();
  try {
    const response = await doFetch(request.url.trim(), {
      method: request.method,
      headers,
      body: built.body,
      signal: options.signal,
      // No cookies, ever: this is a request builder, not a session. Sending
      // ambient credentials to whatever address someone types would be a way
      // to leak them to it.
      credentials: 'omit',
      redirect: 'follow',
    });

    const buffer = await response.arrayBuffer();
    const ms = clock() - started;
    const bytes = new Uint8Array(buffer);
    const kind = sniff(bytes);
    const contentType = response.headers.get('content-type');

    return {
      ok: true,
      response: {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        headers: [...response.headers.entries()],
        bytes,
        ms,
        url: response.url || request.url.trim(),
        redirected: response.redirected,
        contentType,
        sniffedMime: kind?.mime ?? null,
        sniffedExtension: kind?.extension ?? null,
        sniffedLabel: kind?.label ?? null,
        disagreement: compareContentType(contentType, kind?.mime ?? null),
      },
    };
  } catch (error) {
    return {
      ok: false,
      ms: clock() - started,
      failure: classifyFailure(error, {
        url: request.url.trim(),
        pageOrigin,
        online,
        provenOrigins: options.provenOrigins,
      }),
    };
  }
}
