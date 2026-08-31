/**
 * Syntax highlighting for a response body.
 *
 * The interesting decision here is **not using `Prism.highlight`**, which
 * returns an HTML string that a caller has to inject with `{@html}`.
 * [CodeBlock.svelte](../../components/CodeBlock.svelte) does exactly that and
 * is right to: the code it shows is this app's own generated output. A
 * response body is the opposite — it is bytes a stranger chose, and it is the
 * single place in this app where remote content reaches the DOM.
 *
 * Prism's own escaping is sound, and injecting its output would very probably
 * be fine. "Very probably fine" is not the standard for the one untrusted
 * path in the app, and it stops being true the moment someone adds a grammar
 * with a `greedy` alias that round-trips content into an attribute. So this
 * module returns **spans of plain text**, which the caller renders through
 * Svelte's `{#each}` — where the text goes in as a text node and the class
 * comes from the grammar, never from the body. Injection is impossible by
 * construction rather than by audit, and the cost is one array.
 *
 * Nesting is flattened into a combined class list: Prism emits
 * `<span class="attr-value"><span class="punctuation">` and this emits one
 * span classed `token attr-value punctuation`. The existing theme in
 * `global.css` keys off `.token.<name>`, so the inner name still wins the
 * cascade, which is the same result the nested markup produces.
 *
 * Pure module apart from importing the Prism grammars, which must come from
 * [lib/prism.ts](../prism.ts) — see the load-order note there.
 */
import Prism from '../prism';

/** Grammars a response body can be shown in. */
export type SyntaxLanguage = 'json' | 'markup' | 'css' | 'javascript' | 'markdown';

/** One run of text and the classes to put on it. */
export interface Span {
  text: string;
  /** `''` for unhighlighted text, else `token …` ready for `class=`. */
  cls: string;
}

export interface Highlighted {
  spans: Span[];
  /**
   * `null` when the text really is coloured; otherwise the sentence to show
   * instead. Highlighting that quietly does not happen is worse than no
   * highlighting at all — the reader is left comparing a plain body against a
   * label that says it is JSON.
   */
  skipped: string | null;
}

/**
 * Above this many characters the body is shown unhighlighted.
 *
 * Prism tokenises synchronously on the main thread and its cost is
 * superlinear on pathological input — a minified 5 MB bundle is exactly the
 * kind of thing an HTTP client gets handed, and freezing the tab to colour it
 * is a bad trade for a body nobody is going to read span by span anyway. The
 * page says why rather than quietly rendering something different.
 */
export const HIGHLIGHT_LIMIT = 200_000;

/**
 * And a second ceiling, on the OUTPUT rather than the input: every span is a
 * DOM node, and a densely-tokenised body can produce far more of them per
 * kilobyte than a prose one. The character limit alone would let a 200 KB
 * minified bundle become a hundred thousand elements, which is the freeze it
 * was meant to prevent, arriving one step later.
 */
export const MAX_SPANS = 20_000;

/** What a `Content-Type` means, for the types with their own grammar. */
const BY_TYPE: Record<string, SyntaxLanguage> = {
  'text/html': 'markup',
  'application/xhtml+xml': 'markup',
  'text/xml': 'markup',
  'application/xml': 'markup',
  'image/svg+xml': 'markup',
  'application/rss+xml': 'markup',
  'application/atom+xml': 'markup',
  'text/css': 'css',
  'text/javascript': 'javascript',
  'application/javascript': 'javascript',
  'application/x-javascript': 'javascript',
  'text/ecmascript': 'javascript',
  'application/ecmascript': 'javascript',
  'text/markdown': 'markdown',
  'text/x-markdown': 'markdown',
};

const isJsonType = (type: string): boolean => type.endsWith('/json') || type.endsWith('+json');

/**
 * Which grammar to colour a textual body with, or `null` for none.
 *
 * The declared type leads here, unlike everywhere else in this tool, and the
 * reason is that the stake is different: choosing a *decoder* from a server's
 * claim is how you get told a PNG is text, but choosing a *colour scheme*
 * from it risks nothing at all. The worst case is XML painted as if it were
 * HTML, and both are the same grammar anyway.
 *
 * The text is consulted only where the header is absent or useless: a body
 * served as `text/plain` or with no type at all still gets recognised if it
 * parses as JSON or opens with an XML declaration, because a great many
 * servers do exactly that.
 */
export function chooseSyntax(contentType: string | null, text: string): SyntaxLanguage | null {
  const declared = (contentType ?? '').split(';')[0]!.trim().toLowerCase();

  if (isJsonType(declared)) return 'json';
  const known = BY_TYPE[declared];
  if (known) return known;
  // A suffix nobody enumerated: `application/vnd.whatever+xml`.
  if (declared.endsWith('+xml')) return 'markup';

  // No usable claim. Fall back to the bytes for the two shapes that are
  // unambiguous enough to be worth guessing at.
  if (declared === '' || declared === 'text/plain') {
    const head = text.trimStart();
    if (head.startsWith('<?xml') || head.startsWith('<!DOCTYPE') || head.startsWith('<html')) {
      return 'markup';
    }
    if (parsesAsJson(text)) return 'json';
  }
  return null;
}

function parsesAsJson(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === '') return false;
  // A cheap gate before the expensive parse: `JSON.parse` on a megabyte of
  // prose is wasted work, and prose does not start with a brace.
  if (!'{['.includes(trimmed[0]!)) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

/** Does Prism have this grammar loaded? `false` means "render it plain". */
export function hasGrammar(language: SyntaxLanguage): boolean {
  return Boolean(Prism.languages[language]);
}

/**
 * Tokenise `text` into spans.
 *
 * Every failure mode ends the same way — one unclassed span holding the whole
 * body — because the body is the point and the colours are not. What differs
 * is whether `skipped` explains it: a grammar that throws is this app's
 * problem to swallow quietly, while a body too large to colour is a fact the
 * reader is owed.
 */
export function highlight(text: string, language: SyntaxLanguage | null): Highlighted {
  const plain = (skipped: string | null): Highlighted => ({
    spans: text === '' ? [] : [{ text, cls: '' }],
    skipped,
  });

  if (text === '' || language === null) return plain(null);
  if (text.length > HIGHLIGHT_LIMIT) {
    return plain(
      `Too long to highlight — over ${HIGHLIGHT_LIMIT.toLocaleString('en')} characters. Shown as plain text; the body itself is complete.`
    );
  }
  const grammar = Prism.languages[language];
  if (!grammar) return plain(null);

  try {
    const spans: Span[] = [];
    collect(Prism.tokenize(text, grammar), [], spans);
    const merged = merge(spans);
    if (merged.length > MAX_SPANS) {
      return plain(
        'Too densely tokenised to highlight without stalling the page. Shown as plain text; the body itself is complete.'
      );
    }
    return { spans: merged, skipped: null };
  } catch {
    // A grammar can throw or blow the stack on pathological input.
    return plain(null);
  }
}

type PrismToken = { type: string; content: unknown; alias?: string | string[] };

const isToken = (value: unknown): value is PrismToken =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as PrismToken).type === 'string' &&
  'content' in (value as PrismToken);

/** Walk Prism's token tree, carrying the enclosing token names down with it. */
function collect(node: unknown, names: string[], out: Span[]): void {
  if (typeof node === 'string') {
    if (node !== '') out.push({ text: node, cls: names.length ? `token ${names.join(' ')}` : '' });
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) collect(child, names, out);
    return;
  }
  if (!isToken(node)) return;

  const aliases = node.alias === undefined ? [] : Array.isArray(node.alias) ? node.alias : [node.alias];
  collect(node.content, [...names, node.type, ...aliases], out);
}

/**
 * Fold neighbouring spans that share a class. Prism emits a string per
 * grammar branch, so a plain JSON body arrives as thousands of one-character
 * unclassed spans; each one is a DOM node the browser has to make. Merging is
 * a few lines and cuts the node count by an order of magnitude.
 */
function merge(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const span of spans) {
    const last = out[out.length - 1];
    if (last && last.cls === span.cls) last.text += span.text;
    else out.push({ ...span });
  }
  return out;
}
