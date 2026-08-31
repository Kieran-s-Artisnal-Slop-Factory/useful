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
 * Binary always gets a download. It may ALSO get a preview, but only for the
 * handful of formats a browser genuinely renders and only behind a button —
 * see [media.ts](./media.ts) for why that line moved and where it now sits.
 * The offer is computed from the sniffed bytes, never from the header, so the
 * `Content-Type` claim can no more choose a decoder than it can choose a
 * viewer.
 *
 * Textual bodies additionally carry a grammar to colour them with, chosen in
 * [highlight.ts](./highlight.ts). That one DOES read the declared type first,
 * for the reason spelled out there: picking a colour scheme from a stranger's
 * claim risks nothing, while picking a decoder from it risks everything.
 */
import { mediaFor, unrenderableReason, type MediaOffer } from './media';
import { chooseSyntax, type SyntaxLanguage } from './highlight';

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
  /** How a binary body could be shown in the page, when it can be at all. */
  media: MediaOffer | null;
  /** Why a binary body that looks like media still has no preview. */
  unrenderable: string | null;
  /** The grammar to colour a textual body with, or null for plain text. */
  syntax: SyntaxLanguage | null;
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
  const base = { media: null, unrenderable: null, syntax: null } as const;

  if (bytes.length === 0) {
    return { ...base, view: 'empty', reason: 'The response has no body.', filename: null };
  }

  // Decisive evidence: the bytes are a known binary format.
  if (sniffedMime !== null && sniffedMime !== 'text/plain' && sniffedMime !== 'image/svg+xml') {
    const media = mediaFor(sniffedMime);
    const unrenderable = media ? null : unrenderableReason(sniffedMime);
    return {
      ...base,
      view: 'binary',
      reason: media
        ? `The bytes are ${sniffedMime}. Nothing is decoded until you ask for it — download it, or press ${media.label}.`
        : `The bytes are ${sniffedMime}. Binary bodies are offered as a download rather than rendered.`,
      filename: `response.${sniffedExtension ?? 'bin'}`,
      media,
      unrenderable,
    };
  }

  // Not sniffable as text either — treat as binary rather than guess.
  if (sniffedMime === null) {
    return {
      ...base,
      view: 'binary',
      reason:
        'These bytes match no format this app recognises and are not valid text, so they are offered as a download rather than rendered.',
      filename: 'response.bin',
    };
  }

  const declared = (contentType ?? '').split(';')[0]!.trim().toLowerCase();
  const syntax = chooseSyntax(contentType, text);

  if (isJsonType(declared) || (declared === '' && parsesAsJson(text))) {
    return parsesAsJson(text)
      ? { ...base, view: 'json', reason: 'JSON, pretty-printed below.', filename: null, syntax: 'json' }
      : {
          ...base,
          view: 'text',
          reason: 'The server calls this JSON, but it does not parse. Shown as text, with the parser’s complaint above it.',
          filename: null,
          // Not `json`: half a JSON document tokenises into nonsense, and
          // colouring it would dress the broken part up as deliberate.
          syntax: null,
        };
  }

  if (isHtmlType(declared) || sniffedMime === 'image/svg+xml') {
    // `looksLikeSvg` accepts anything opening with an XML declaration, so a
    // plain `application/xml` body reaches here too. It gets the same viewer
    // — a frame renders XML as a collapsible tree, which is useful — but not
    // the same NAME. Calling an RSS feed "HTML" is the kind of small lie that
    // makes a reader distrust the rest of the page.
    const kind = isHtmlType(declared) ? 'HTML' : declared === 'image/svg+xml' ? 'SVG' : 'XML';
    return {
      ...base,
      view: 'html',
      reason: `${kind}. Shown as source by default — use Preview to render it in a sandboxed frame with no access to this app.`,
      filename: null,
      syntax: 'markup',
    };
  }

  return {
    ...base,
    view: 'text',
    reason: syntax === null ? 'Shown as text.' : `Shown as text, highlighted as ${SYNTAX_NAMES[syntax]}.`,
    filename: null,
    syntax,
  };
}

/** What to call a grammar in the line above the body. */
const SYNTAX_NAMES: Record<SyntaxLanguage, string> = {
  json: 'JSON',
  markup: 'XML',
  css: 'CSS',
  javascript: 'JavaScript',
  markdown: 'Markdown',
};

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
