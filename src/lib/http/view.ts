/**
 * Deciding how to show a response body (0.4.0 plan, Phase 3, decision 5).
 *
 * The rule is that **the bytes decide, not the header**. A `Content-Type` is a
 * claim the server makes and can be wrong about, accidentally or otherwise;
 * `sniff.ts` reads the magic numbers, and this module picks a viewer from what
 * it found. The same stance the base64 tool already takes, for the same
 * reason: a body labelled `text/plain` that begins with a PNG signature is a
 * PNG, and pretending otherwise puts binary through a text renderer.
 *
 * Binary gets a download and no viewer at all, which is what the TODO asked
 * for. There is no image preview here on purpose: this is a tool for reading
 * what a server sent, and a viewer that renders arbitrary bytes is a decoder
 * surface nobody asked for.
 */

export type BodyView =
  /** Nothing came back. */
  | 'empty'
  /** Pretty-printed and foldable. */
  | 'json'
  /** Source by default, with a sandboxed preview available. */
  | 'html'
  /** Shown as text. */
  | 'text'
  /** Offered as a download, with no viewer. */
  | 'binary';

export interface ViewChoice {
  view: BodyView;
  /** Why, in a sentence, for the line above the body. */
  reason: string;
  /** Suggested download name for a binary body. */
  filename: string | null;
}

const isJsonType = (type: string): boolean =>
  type.endsWith('/json') || type.endsWith('+json');

const isHtmlType = (type: string): boolean => type === 'text/html' || type === 'application/xhtml+xml';

/**
 * Does this text parse as JSON? Used to confirm a `application/json` claim
 * rather than to trust it.
 */
export function parsesAsJson(text: string): boolean {
  if (text.trim() === '') return false;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Pick a viewer.
 *
 * `sniffedMime` is the evidence and wins wherever it is decisive. It is only
 * ever `null` or `text/plain` for textual bodies, though, and "text" covers
 * JSON, HTML, CSV and everything else — so the declared type is consulted to
 * choose BETWEEN the textual viewers, never to overrule binary.
 */
export function chooseView(
  bytes: Uint8Array,
  contentType: string | null,
  sniffedMime: string | null,
  sniffedExtension: string | null,
  text: string
): ViewChoice {
  if (bytes.length === 0) {
    return { view: 'empty', reason: 'The response has no body.', filename: null };
  }

  // Decisive evidence: the bytes are a known binary format.
  if (sniffedMime !== null && sniffedMime !== 'text/plain' && sniffedMime !== 'image/svg+xml') {
    return {
      view: 'binary',
      reason: `The bytes are ${sniffedMime}. Binary bodies are offered as a download rather than rendered.`,
      filename: `response.${sniffedExtension ?? 'bin'}`,
    };
  }

  // Not sniffable as text either — treat as binary rather than guess.
  if (sniffedMime === null) {
    return {
      view: 'binary',
      reason:
        'These bytes match no format this app recognises and are not valid text, so they are offered as a download rather than rendered.',
      filename: 'response.bin',
    };
  }

  const declared = (contentType ?? '').split(';')[0]!.trim().toLowerCase();

  if (isJsonType(declared) || (declared === '' && parsesAsJson(text))) {
    return parsesAsJson(text)
      ? { view: 'json', reason: 'JSON, pretty-printed below.', filename: null }
      : {
          view: 'text',
          reason: 'The server calls this JSON, but it does not parse. Shown as text, with the parser’s complaint above it.',
          filename: null,
        };
  }

  if (isHtmlType(declared) || sniffedMime === 'image/svg+xml') {
    return {
      view: 'html',
      reason:
        'HTML. Shown as source by default — use Preview to render it in a sandboxed frame with no access to this app.',
      filename: null,
    };
  }

  return { view: 'text', reason: 'Shown as text.', filename: null };
}

/** Pretty-print JSON, or hand the text back untouched when it will not parse. */
export function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** `1.4 KB`, `812 bytes` — the size line beside the status. */
export function formatBytes(count: number): string {
  if (count < 1024) return `${count} ${count === 1 ? 'byte' : 'bytes'}`;
  if (count < 1024 * 1024) return `${(count / 1024).toFixed(1)} KB`;
  return `${(count / (1024 * 1024)).toFixed(2)} MB`;
}

/** `142 ms`, `1.83 s` — timings a person reads rather than counts zeros in. */
export function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

/** The colour-independent word for a status class. */
export function statusFamily(status: number): string {
  if (status >= 500) return 'server error';
  if (status >= 400) return 'client error';
  if (status >= 300) return 'redirect';
  if (status >= 200) return 'success';
  return 'informational';
}
