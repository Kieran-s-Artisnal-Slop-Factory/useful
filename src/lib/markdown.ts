/**
 * The ONE sanctioned markdown → HTML path (timer descriptions, TODO bodies,
 * comments, notebook pages). Sanitization is not optional even in a local-only
 * app: backup-JSON import is an injection vector straight into rendered HTML.
 * Client-only (DOMPurify needs a DOM) — call from components, never during SSR.
 *
 * A factory with hooks, all ON by default so a `[[link]]` in a timer
 * description behaves like one in a note:
 *   - `[[Title]]` / `[[Title|Label]]` wiki links (resolved BY TITLE, to the
 *     notebook route; `exists` marks the ones that would create a note),
 *   - GFM footnotes, numbered in first-use order and collected at the foot,
 *   - `$…$` / `$$…$$` / ```math maths, emitted as source in `data-math` for
 *     `notebook/math.ts` to typeset lazily — KaTeX is never imported here,
 *   - ```mermaid fences, emitted as `<pre class="mermaid">` for
 *     `notebook/mermaid.ts` to draw lazily,
 *   - `resolveImage`, which maps relative and `asset:` sources (never absolute
 *     URLs) to something the browser can show.
 *
 * Fenced code blocks are syntax-highlighted with Prism (statically bundled —
 * offline PWA, no CDN). Token colors live in global.css on the blueprint
 * palette. Unknown languages render as plain escaped code.
 *
 * One `Marked` instance per distinct set of switches, memoized; the per-call
 * functions (`href`, `exists`, `resolveImage`) are read through a module-level
 * context that is set for the duration of one synchronous parse.
 */
import { Marked, type Token, type Tokens, type TokenizerAndRendererExtension } from 'marked';
import { markedHighlight } from 'marked-highlight';
import DOMPurify from 'dompurify';
// Core + grammars in guaranteed order — see the note in lib/prism.ts.
import Prism from './prism';
import { href } from './paths';
import { WIKI_LINK_RE } from './notebook/wiki';

export interface WikiLinkOptions {
  /** The URL a link to `title` points at. Default: the notebook route, by title. */
  href?: (title: string) => string;
  /** When given, a link whose title does not exist gets the `missing` class. */
  exists?: (title: string) => boolean;
}

export interface RenderOptions {
  /** `false` leaves `[[…]]` as literal text. Default: on, pointing at the notebook. */
  wikiLinks?: false | WikiLinkOptions;
  /**
   * Called for relative and `asset:` image sources only — never for `scheme:`,
   * `//` or `/` URLs. Return undefined to leave the source as written.
   */
  resolveImage?: (src: string) => string | undefined;
  math?: boolean;
  mermaid?: boolean;
  footnotes?: boolean;
}

/** The notebook route a wiki link resolves to: by title, never by id. */
export function wikiLinkHref(title: string): string {
  return href('/tools/notebook/') + '?note=' + encodeURIComponent(title);
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[m]!);

const escapeAttr = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]!
  );

const ALIASES: Record<string, string> = { js: 'javascript', ts: 'typescript', py: 'python', sh: 'bash', shell: 'bash', golang: 'go', yml: 'yaml' };

const highlight = markedHighlight({
  highlight(code, lang) {
    const name = ALIASES[lang] ?? lang;
    const grammar = Prism.languages[name];
    // marked-highlight treats the return value as HTML — escape when Prism
    // has no grammar for the language.
    return grammar ? Prism.highlight(code, grammar, name) : escapeHtml(code);
  },
});

// ---------------------------------------------------------------------------
// Per-parse context. Set by renderMarkdown around one synchronous parse; the
// extensions below read it instead of closing over options, so one memoized
// Marked instance serves every caller with the same switches.
// ---------------------------------------------------------------------------

interface FootnoteState {
  /** Labels with a definition somewhere in the document (walkTokens pass). */
  defined: Set<string>;
  /** Rendered definition bodies, first definition wins. */
  bodies: Map<string, string>;
  /** Labels in first-reference order — the numbering. */
  order: string[];
  /** How many references each label has had, for unique ids. */
  refCount: Map<string, number>;
}

interface Context {
  wikiHref: (title: string) => string;
  wikiExists: ((title: string) => boolean) | undefined;
  resolveImage: ((src: string) => string | undefined) | undefined;
  footnotes: FootnoteState;
}

const blankFootnotes = (): FootnoteState => ({
  defined: new Set(),
  bodies: new Map(),
  order: [],
  refCount: new Map(),
});

let ctx: Context = {
  wikiHref: wikiLinkHref,
  wikiExists: undefined,
  resolveImage: undefined,
  footnotes: blankFootnotes(),
};

// ---------------------------------------------------------------------------
// Wiki links
// ---------------------------------------------------------------------------

interface WikiToken extends Tokens.Generic {
  type: 'wikiLink';
  title: string;
  label: string;
}

const WIKI_AT_START = new RegExp('^' + WIKI_LINK_RE.source);

const wikiLinkExtension: TokenizerAndRendererExtension = {
  name: 'wikiLink',
  level: 'inline',
  start: (src) => src.indexOf('[['),
  tokenizer(src) {
    const m = WIKI_AT_START.exec(src);
    if (!m) return undefined;
    const title = m[1]!.trim();
    if (!title) return undefined;
    const label = (m[2] ?? '').trim() || title;
    const token: WikiToken = { type: 'wikiLink', raw: m[0], title, label };
    return token;
  },
  renderer(token) {
    const { title, label } = token as WikiToken;
    const missing = ctx.wikiExists?.(title) === false ? ' missing' : '';
    return (
      `<a class="wiki-link${missing}" data-wiki="${escapeAttr(title)}"` +
      ` href="${escapeAttr(ctx.wikiHref(title))}">${escapeHtml(label)}</a>`
    );
  },
};

// ---------------------------------------------------------------------------
// Footnotes
// ---------------------------------------------------------------------------

/** A label is everything up to the closing bracket, minus whitespace. */
const LABEL = String.raw`[^\]\s]+`;
const DEF_LINE = new RegExp(String.raw`^ {0,3}\[\^(${LABEL})\]:[ \t]?(.*)(?:\n|$)`);
const DEF_ANYWHERE = new RegExp(String.raw`^ {0,3}\[\^${LABEL}\]:`, 'm');
const REF_AT_START = new RegExp(String.raw`^\[\^(${LABEL})\]`);
const CONTINUATION = /^(?: {4,}|\t)\S/;

interface FootnoteDefToken extends Tokens.Generic {
  type: 'footnoteDef';
  label: string;
  tokens: Token[];
}

interface FootnoteRefToken extends Tokens.Generic {
  type: 'footnoteRef';
  label: string;
}

/** Something a browser can anchor to and a label can be recovered from. */
const footnoteId = (label: string) =>
  encodeURIComponent(label).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16));

const footnoteDefExtension: TokenizerAndRendererExtension = {
  name: 'footnoteDef',
  level: 'block',
  start: (src) => DEF_ANYWHERE.exec(src)?.index,
  tokenizer(src) {
    const m = DEF_LINE.exec(src);
    if (!m) return undefined;
    const parts = [m[2]!.trim()];
    let end = m[0].length;
    // Continuation: indented lines, and blank lines that are followed by one —
    // the same rule notebook/footnotes.ts scans by.
    while (end < src.length) {
      const lineEnd = src.indexOf('\n', end);
      const stop = lineEnd === -1 ? src.length : lineEnd;
      const line = src.slice(end, stop);
      const blank = line.trim() === '';
      if (!blank && !CONTINUATION.test(line)) break;
      if (blank) {
        const nextEnd = src.indexOf('\n', stop + 1);
        const next = src.slice(stop + 1, nextEnd === -1 ? src.length : nextEnd);
        if (!CONTINUATION.test(next)) break;
      } else {
        parts.push(line.trim());
      }
      end = lineEnd === -1 ? src.length : lineEnd + 1;
    }
    const token: FootnoteDefToken = {
      type: 'footnoteDef',
      raw: src.slice(0, end),
      label: m[1]!,
      tokens: [],
    };
    this.lexer.inline(parts.filter(Boolean).join(' '), token.tokens);
    return token;
  },
  renderer(token) {
    const { label, tokens } = token as FootnoteDefToken;
    // Rendered here, where a parser is to hand; emitted at the foot by the
    // postprocess hook. The first definition of a label wins.
    if (!ctx.footnotes.bodies.has(label)) {
      ctx.footnotes.bodies.set(label, this.parser.parseInline(tokens));
    }
    return '';
  },
};

const footnoteRefExtension: TokenizerAndRendererExtension = {
  name: 'footnoteRef',
  level: 'inline',
  start: (src) => src.indexOf('[^'),
  tokenizer(src) {
    const m = REF_AT_START.exec(src);
    if (!m) return undefined;
    const token: FootnoteRefToken = { type: 'footnoteRef', raw: m[0], label: m[1]! };
    return token;
  },
  renderer(token) {
    const { label, raw } = token as FootnoteRefToken;
    const state = ctx.footnotes;
    // An orphan renders as the literal text it is.
    if (!state.defined.has(label)) return escapeHtml(raw);
    let n = state.order.indexOf(label) + 1;
    if (n === 0) n = state.order.push(label);
    const seen = (state.refCount.get(label) ?? 0) + 1;
    state.refCount.set(label, seen);
    const id = footnoteId(label);
    const refId = seen === 1 ? `fnref-${id}` : `fnref-${id}-${seen}`;
    return `<sup class="footnote-ref"><a href="#fn-${id}" id="${refId}">${n}</a></sup>`;
  },
};

/** The `<section class="footnotes">` for every label that was referenced. */
function footnoteSection(state: FootnoteState): string {
  if (state.order.length === 0) return '';
  const items = state.order.map((label) => {
    const id = footnoteId(label);
    const body = state.bodies.get(label) ?? escapeHtml(label);
    return (
      `<li id="fn-${id}">${body} ` +
      `<a href="#fnref-${id}" class="footnote-backref">↩</a></li>`
    );
  });
  return `<section class="footnotes"><ol>${items.join('')}</ol></section>`;
}

// ---------------------------------------------------------------------------
// Maths and mermaid. Source only — nothing here imports KaTeX or mermaid.
// ---------------------------------------------------------------------------

interface MathToken extends Tokens.Generic {
  type: 'math';
  display: boolean;
  /** Display maths that sits inside a paragraph renders as a span, not a div. */
  inline: boolean;
  text: string;
}

interface MermaidToken extends Tokens.Generic {
  type: 'mermaid';
  text: string;
}

/**
 * remark-math's rule: the content may not start or end with a space, and the
 * closing `$` may not be followed by a digit — so "$5 and $10" is prose.
 */
const MATH_INLINE_DOUBLE = /^\$\$(?![\s$])((?:[^$\n]|\n(?!\n))+?)(?<!\s)\$\$/;
const MATH_INLINE_SINGLE = /^\$(?![\s$])((?:\\.|[^\\$\n]|\n(?!\n))+?)(?<!\s)\$(?!\d)/;
const MATH_BLOCK = /^ {0,3}\$\$[ \t]*\n([\s\S]*?)(?:\n {0,3}\$\$[ \t]*(?:\n|$)|$)/;
const MATH_BLOCK_ANYWHERE = /^ {0,3}\$\$[ \t]*$/m;

const renderMath = (token: MathToken): string => {
  const { display, inline, text } = token;
  const tag = display && !inline ? 'div' : 'span';
  const kind = display ? 'math-display' : 'math-inline';
  return `<${tag} class="math ${kind}" data-math="${escapeAttr(text)}">${escapeHtml(text)}</${tag}>`;
};

const mathInlineExtension: TokenizerAndRendererExtension = {
  name: 'mathInline',
  level: 'inline',
  start: (src) => src.indexOf('$'),
  tokenizer(src) {
    const double = MATH_INLINE_DOUBLE.exec(src);
    if (double) {
      const token: MathToken = {
        type: 'math',
        raw: double[0],
        display: true,
        inline: true,
        text: double[1]!.trim(),
      };
      return token;
    }
    const single = MATH_INLINE_SINGLE.exec(src);
    if (!single) return undefined;
    const token: MathToken = {
      type: 'math',
      raw: single[0],
      display: false,
      inline: true,
      text: single[1]!,
    };
    return token;
  },
};

const mathBlockExtension: TokenizerAndRendererExtension = {
  name: 'mathBlock',
  level: 'block',
  start: (src) => MATH_BLOCK_ANYWHERE.exec(src)?.index,
  tokenizer(src) {
    const m = MATH_BLOCK.exec(src);
    if (!m) return undefined;
    const token: MathToken = {
      type: 'math',
      raw: m[0],
      display: true,
      inline: false,
      text: m[1]!.trim(),
    };
    return token;
  },
};

const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})[ \t]*(math|mermaid)(?:[ \t][^\n]*)?(?:\n|$)/;

/**
 * ```math and ```mermaid fences, claimed before marked's own fence tokenizer
 * (and so before Prism) sees them. Closing rules match CommonMark: same
 * character, at least as long, indented at most three spaces.
 */
function fenceTokenizer(src: string, wantMath: boolean, wantMermaid: boolean) {
  const m = FENCE_OPEN.exec(src);
  if (!m) return undefined;
  const lang = m[3] as 'math' | 'mermaid';
  if ((lang === 'math' && !wantMath) || (lang === 'mermaid' && !wantMermaid)) return undefined;
  const indent = m[1]!.length;
  const fence = m[2]!;
  const closing = new RegExp(`^ {0,3}\\${fence[0]}{${fence.length},}[ \\t]*$`);
  const lines: string[] = [];
  let end = m[0].length;
  while (end < src.length) {
    const lineEnd = src.indexOf('\n', end);
    const stop = lineEnd === -1 ? src.length : lineEnd;
    const line = src.slice(end, stop);
    end = lineEnd === -1 ? src.length : lineEnd + 1;
    if (closing.test(line)) break;
    lines.push(indent ? line.replace(new RegExp(`^ {0,${indent}}`), '') : line);
  }
  const text = lines.join('\n');
  if (lang === 'math') {
    const token: MathToken = { type: 'math', raw: src.slice(0, end), display: true, inline: false, text: text.trim() };
    return token;
  }
  const token: MermaidToken = { type: 'mermaid', raw: src.slice(0, end), text };
  return token;
}

const mermaidRenderer: TokenizerAndRendererExtension = {
  name: 'mermaid',
  renderer: (token) => `<pre class="mermaid">${escapeHtml((token as MermaidToken).text)}</pre>`,
};

/** One renderer for the three maths tokenizers: they all emit type 'math'. */
const mathRenderer: TokenizerAndRendererExtension = {
  name: 'math',
  renderer: (token) => renderMath(token as MathToken),
};

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

const HAS_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/** Relative paths and `asset:` refs — what a resolver may rewrite. */
function isResolvable(src: string): boolean {
  if (src.startsWith('asset:')) return true;
  if (src.startsWith('/') || src.startsWith('#')) return false;
  return !HAS_SCHEME.test(src);
}

function resolveImageToken(token: Token): void {
  if (token.type !== 'image') return;
  const image = token as Tokens.Image;
  if (!isResolvable(image.href)) return;
  const resolved = ctx.resolveImage?.(image.href);
  if (resolved !== undefined) image.href = resolved;
}

// ---------------------------------------------------------------------------
// The factory
// ---------------------------------------------------------------------------

interface Switches {
  wiki: boolean;
  footnotes: boolean;
  math: boolean;
  mermaid: boolean;
}

const instances = new Map<string, Marked>();

function build(s: Switches): Marked {
  const extensions: TokenizerAndRendererExtension[] = [];
  if (s.wiki) extensions.push(wikiLinkExtension);
  if (s.footnotes) extensions.push(footnoteDefExtension, footnoteRefExtension);
  if (s.math) extensions.push(mathInlineExtension, mathBlockExtension, mathRenderer);
  if (s.mermaid) extensions.push(mermaidRenderer);
  if (s.math || s.mermaid) {
    extensions.push({
      name: 'fence',
      level: 'block',
      tokenizer: (src) => fenceTokenizer(src, s.math, s.mermaid),
    });
  }
  return new Marked(highlight, { gfm: true }, {
    extensions,
    walkTokens(token) {
      if (s.footnotes && token.type === 'footnoteDef') {
        ctx.footnotes.defined.add((token as FootnoteDefToken).label);
      }
      resolveImageToken(token);
    },
    hooks: {
      preprocess(md) {
        ctx.footnotes = blankFootnotes();
        return md;
      },
      postprocess(html) {
        return s.footnotes ? html + footnoteSection(ctx.footnotes) : html;
      },
    },
  });
}

function instanceFor(s: Switches): Marked {
  const key = `${+s.wiki}${+s.footnotes}${+s.math}${+s.mermaid}`;
  let marked = instances.get(key);
  if (!marked) {
    marked = build(s);
    instances.set(key, marked);
  }
  return marked;
}

/**
 * Markdown → HTML, NOT sanitized. Exported for the unit tests, which run in
 * Node where DOMPurify has no DOM to work with. Every component goes through
 * `renderMarkdown`; nothing else may call this.
 */
export function renderMarkdownUnsafe(md: string, options: RenderOptions = {}): string {
  const switches: Switches = {
    wiki: options.wikiLinks !== false,
    footnotes: options.footnotes !== false,
    math: options.math !== false,
    mermaid: options.mermaid !== false,
  };
  const wiki = options.wikiLinks === false ? {} : (options.wikiLinks ?? {});
  const previous = ctx;
  ctx = {
    wikiHref: wiki.href ?? wikiLinkHref,
    wikiExists: wiki.exists,
    resolveImage: options.resolveImage,
    footnotes: blankFootnotes(),
  };
  try {
    return instanceFor(switches).parse(md, { async: false });
  } finally {
    ctx = previous;
  }
}

export function renderMarkdown(md: string, options: RenderOptions = {}): string {
  return DOMPurify.sanitize(renderMarkdownUnsafe(md, options));
}
