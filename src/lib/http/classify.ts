/**
 * Working out why a `fetch` failed (0.4.0 plan, Phase 3, decision 6).
 *
 * `fetch` rejects with a bare `TypeError: Failed to fetch` for CORS, for
 * mixed content, for DNS, for a refused connection and for a dropped cable.
 * **That vagueness is deliberate on the browser's part**: telling a page
 * whether a cross-origin host exists, or answered, or refused, would make
 * `fetch` a port scanner. So the browser knows and will not say, and every
 * HTTP client written for a browser is left guessing.
 *
 * This module guesses *out loud*. It reasons from what the page CAN see — the
 * two origins, the two schemes, whether the network is up — and reports a
 * likelihood with the reasoning attached, rather than asserting a cause it
 * cannot actually know. Where it is certain it says so; where it is not, it
 * says that too.
 *
 * Q3 in the plan asked whether to push people at a desktop build to escape
 * CORS. There is no desktop build, and installing the PWA changes nothing —
 * an installed PWA is still a browser page under the same rules. So the honest
 * answer ships instead of a wrong one.
 */

export type FailureKind =
  /** The scheme itself is the problem, and it is certain. */
  | 'mixed-content'
  /** The browser is offline; nothing was going to work. */
  | 'offline'
  /** Cross-origin, and the shape of a CORS refusal. Likely, not certain. */
  | 'cors'
  /** Same-origin, so CORS is not it: the server or the address is. */
  | 'unreachable'
  /** The page cancelled it. */
  | 'aborted'
  /** Something else entirely. */
  | 'unknown';

export interface Failure {
  kind: FailureKind;
  /** One line for the top of the card. */
  title: string;
  /** What is known, what is guessed, and what to do. */
  detail: string;
  /** True when the browser genuinely could have told us and did not. */
  guess: boolean;
}

export interface FailureContext {
  /** The URL that was requested. */
  url: string;
  /** The page's own origin — `location.origin`. */
  pageOrigin: string;
  /** `navigator.onLine`, which is a hint rather than a fact. */
  online: boolean;
}

const originOf = (url: string): string | null => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

const protocolOf = (url: string): string | null => {
  try {
    return new URL(url).protocol;
  } catch {
    return null;
  }
};

/**
 * Classify a rejected `fetch`.
 *
 * The order matters: mixed content and abort are things we KNOW, so they are
 * checked before anything is inferred.
 */
export function classifyFailure(error: unknown, context: FailureContext): Failure {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);

  if (name === 'AbortError') {
    return {
      kind: 'aborted',
      title: 'Cancelled',
      detail: 'The request was stopped before it finished. Nothing was received.',
      guess: false,
    };
  }

  const pageProtocol = protocolOf(context.pageOrigin);
  const targetProtocol = protocolOf(context.url);

  // Certain: a secure page may not fetch an insecure address, and the browser
  // blocks it before any connection is attempted.
  if (pageProtocol === 'https:' && targetProtocol === 'http:') {
    return {
      kind: 'mixed-content',
      title: 'Blocked as mixed content',
      detail:
        'This page was served over https:, and a secure page is not allowed to fetch an http: address. The browser stopped this before it reached the network, so the server never saw it — nothing about the server needs changing. It looks exactly like a CORS failure from in here, which is why it is worth telling them apart: use https: for the target, or open this app over http: too.',
      guess: false,
    };
  }

  if (!context.online) {
    return {
      kind: 'offline',
      title: 'The browser is offline',
      detail:
        'This device reports no network connection, so the request never left. The playground itself works offline — crafting, editing and reading a saved request all do — but sending needs a network like anything else.',
      guess: false,
    };
  }

  const targetOrigin = originOf(context.url);

  if (targetOrigin !== null && targetOrigin === context.pageOrigin) {
    return {
      kind: 'unreachable',
      title: 'The request did not complete',
      detail:
        'The address is on this app’s own origin, so cross-origin rules are not involved. That leaves the server: it may be down, the path may not exist at that host, or the connection may have been dropped. The browser does not say which.',
      guess: false,
    };
  }

  if (targetOrigin !== null) {
    return {
      kind: 'cors',
      title: 'Most likely CORS',
      detail:
        `This is a cross-origin request — from ${context.pageOrigin} to ${targetOrigin} — and it failed without a status, which is what a CORS refusal looks like from inside a page. It is a likelihood, not a certainty: the browser gives a page the same bare error for a refused connection, a name that does not resolve and a dropped network, on purpose, so that a page cannot use fetch to map what is out there. ` +
        'The important part is that CORS is the SERVER’s decision, not this app’s: the target has to answer with an Access-Control-Allow-Origin header naming this origin, or a wildcard. No client running in a browser can opt out of that — not this one, not one you write, and not the same page installed to your home screen.',
      guess: true,
    };
  }

  return {
    kind: 'unknown',
    title: 'The request failed',
    detail: `The browser reported: ${message || 'no detail'}. Check the URL is complete and try again.`,
    guess: true,
  };
}

/**
 * A disagreement between what the server CLAIMS a body is and what its bytes
 * say. The claim is a string anyone can type; the bytes are evidence.
 */
export interface TypeDisagreement {
  claimed: string;
  sniffed: string;
  message: string;
}

export function compareContentType(
  contentTypeHeader: string | null,
  sniffedMime: string | null
): TypeDisagreement | null {
  if (!contentTypeHeader || !sniffedMime) return null;
  const claimed = contentTypeHeader.split(';')[0]!.trim().toLowerCase();
  if (claimed === '' || claimed === sniffedMime) return null;
  // Text sniffs as text/plain whenever it is not something more specific, so a
  // server calling its text something else is not a disagreement worth raising.
  if (sniffedMime === 'text/plain' && claimed.startsWith('text/')) return null;
  if (sniffedMime === 'text/plain' && (claimed.endsWith('/json') || claimed.endsWith('+json'))) {
    return null;
  }
  if (sniffedMime === 'text/plain' && (claimed.endsWith('/xml') || claimed.endsWith('+xml'))) {
    return null;
  }
  return {
    claimed,
    sniffed: sniffedMime,
    message: `The server calls this \`${claimed}\`, but the bytes are ${sniffedMime}. The header is a claim; the bytes are the evidence, and this viewer goes by the bytes.`,
  };
}
