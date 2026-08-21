/**
 * Notebook exports: Markdown, a self-contained HTML document, and print.
 *
 * Two facts shape this module. First, the HTML export is one file with no
 * outside dependencies — the stylesheet is the TypeScript template below (never
 * the app's hashed global stylesheet), fonts and images travel as data: URLs,
 * and `htmlExport` itself never writes a <script>, a <link> or an external URL
 * (the no-CDN rule applies to what the app produces, not only what it loads;
 * `externalReferences` is the audit). Second, PDF is `window.print()`, so the
 * only handle on the saved filename is `document.title` (plan Decision 6).
 */

/** Markdown link destinations and HTML attribute values that point at a stored asset. */
const ASSET_REF = /(\(\s*|["'])asset:([A-Za-z0-9._-]+)/g;

/**
 * The note's markdown source, optionally with `asset:<id>` references replaced
 * by data URLs from `assets` (keys are `asset:<id>`, as written in the body).
 * References the map does not know are left exactly as written. A `# Title`
 * line is added only when the body does not already open with that heading.
 */
export function markdownExport(
  note: { title: string; body_md: string },
  opts: { assets?: Map<string, string>; inlineAssets?: boolean } = {}
): string {
  const inline = opts.inlineAssets ?? true;
  let body = note.body_md ?? '';
  const assets = opts.assets;
  if (inline && assets && assets.size > 0) {
    body = body.replace(ASSET_REF, (whole, lead: string, id: string) => {
      const url = assets.get(`asset:${id}`) ?? assets.get(id);
      return url ? `${lead}${url}` : whole;
    });
  }
  const title = note.title.trim();
  const out = title && !startsWithHeading(body, title) ? `# ${title}\n\n${body}` : body;
  return out.endsWith('\n') ? out : out + '\n';
}

function startsWithHeading(body: string, title: string): boolean {
  const first = body.trimStart().split('\n', 1)[0] ?? '';
  const m = /^#\s+(.*?)\s*#*\s*$/.exec(first);
  return m !== null && m[1]!.trim() === title;
}

/**
 * The export stylesheet: the blueprint palette's light sheet baked as literals
 * (theme.css), Prism token colours included, sized to read on paper and on
 * screen without a single external reference.
 */
export const NOTE_CSS: string = `
:root{color-scheme:light}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:#fff;color:#14305e}
body{font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.prose{max-width:44rem;margin:0 auto;padding:2.5rem 1.25rem 4rem;overflow-wrap:break-word}
.prose>:first-child{margin-top:0}
h1,h2,h3,h4,h5,h6{line-height:1.25;margin:1.8em 0 .6em;font-weight:700;color:#102a56}
h1,h2,h3,h4,h5,h6{break-after:avoid}
h1{font-size:2em;letter-spacing:.02em;border-bottom:1.5px solid #14305e;padding-bottom:.3em}
h2{font-size:1.5em}h3{font-size:1.2em}h4{font-size:1.05em}h5,h6{font-size:1em}
p,ul,ol,table,blockquote,pre,figure,.math-display,.mermaid-rendered{margin:0 0 1em}
ul,ol{padding-left:1.6em}li>ul,li>ol{margin-bottom:0}li+li{margin-top:.2em}
ul.contains-task-list,ul:has(>li>input[type=checkbox]){list-style:none;padding-left:.4em}
li>input[type=checkbox]{margin:0 .5em 0 0;vertical-align:-.1em;accent-color:#1c4c9c}
a{color:#1c4c9c;text-decoration-thickness:1px;text-underline-offset:3px}
a.wiki-link{color:#102a56;background:#d9e5f6;padding:0 .2em;text-decoration:none;border-radius:2px}
a.wiki-link.missing,a.wiki-link.unresolved,a.wiki-link[data-unresolved]{background:none}
a.wiki-link.missing,a.wiki-link.unresolved,a.wiki-link[data-unresolved]{border-bottom:1px dashed #5f7aa6}
strong{color:#102a56}hr{border:0;border-top:1.5px solid #5f7aa6;margin:2em 0}
img,svg,video{max-width:100%;height:auto}
figure img{display:block;margin:0 auto}
figcaption{font-size:.85em;color:#3f5c8c;text-align:center;margin-top:.4em}
blockquote{border-left:3px solid #5f7aa6;margin-left:0;padding:.2em 0 .2em 1em;color:#3f5c8c}
blockquote>:last-child{margin-bottom:0}
table{border-collapse:collapse;width:100%;font-size:.95em;display:block;overflow-x:auto}
th,td{border:1px solid #b7c8de;padding:.4em .7em;text-align:left;vertical-align:top}
th{background:#e9eef6;font-weight:600;border-bottom:1.5px solid #5f7aa6}
code,kbd,pre{font-family:ui-monospace,"Cascadia Code",Consolas,"SF Mono",Menlo,monospace}
code,kbd,pre{font-size:.9em}
:not(pre)>code{background:#d9e5f6;padding:0 .25em;border-radius:2px}
pre{background:#e9eef6;border:1px solid #b7c8de;padding:.8em 1em;overflow-x:auto}
pre{line-height:1.5;tab-size:2}
pre code{background:none;padding:0;font-size:1em}
.token.comment,.token.prolog,.token.cdata{color:#3f5c8c;font-style:italic}
.token.keyword,.token.atrule,.token.important,.token.rule{color:#a55f0b;font-weight:600}
.token.string,.token.char,.token.attr-value,.token.regex{color:#17703a}
.token.number,.token.boolean,.token.constant,.token.symbol{color:#9a5b00}
.token.function,.token.class-name,.token.selector,.token.tag{color:#102a56;font-weight:600}
.token.operator,.token.punctuation{color:#3f5c8c}
.token.property,.token.attr-name,.token.variable,.token.builtin{color:#14305e}
.math-display,.katex-display{overflow-x:auto;overflow-y:hidden;padding:.2em 0}
pre.mermaid{background:none;border:0;padding:0;text-align:center}
.mermaid-rendered svg,pre.mermaid svg{max-width:100%;height:auto;margin:0 auto}
sup.footnote-ref a,a[data-footnote-ref]{text-decoration:none;font-weight:600;padding:0 .1em}
.footnotes{margin-top:2.5em;padding-top:.8em;border-top:1px solid #b7c8de}
.footnotes{font-size:.9em;color:#3f5c8c}
.footnotes ol{padding-left:1.4em}.footnotes li{margin-bottom:.4em}.footnotes p{margin:0}
.footnotes a.footnote-backref,.footnotes [data-footnote-backref]{text-decoration:none}
@media print{
@page{margin:1.6cm}
body{font-size:11pt}
.prose{max-width:none;padding:0}
pre{overflow:visible;white-space:pre-wrap;word-break:break-word}
table{display:table;overflow:visible}
pre,table,figure,blockquote,img,svg,.math-display,.mermaid-rendered{break-inside:avoid}
pre,:not(pre)>code,th,a.wiki-link{-webkit-print-color-adjust:exact;print-color-adjust:exact}
a{color:inherit}
}
`.trim();

export interface HtmlExportInput {
  title: string;
  /** Already-rendered, already-sanitized body HTML (the app's markdown pipeline). */
  bodyHtml: string;
  /** Replaces NOTE_CSS when given. */
  css?: string;
  /** Appended after the base stylesheet — KaTeX's CSS, say. */
  extraCss?: string[];
  /** Becomes one @font-face each; entries whose URL is not a data: URL are dropped. */
  fonts?: { family: string; weight?: string; style?: string; dataUrl: string }[];
  lang?: string;
}

/**
 * One complete, self-contained HTML document. Everything lives in a single
 * <style> plus the body markup — no <script>, no <link>, no external URL from
 * this function. What the caller passes in is its own responsibility; run
 * `externalReferences` on the result to check.
 */
export function htmlExport(input: HtmlExportInput): string {
  const css: string[] = [input.css ?? NOTE_CSS, ...(input.extraCss ?? [])];
  for (const font of input.fonts ?? []) {
    if (!/^data:/i.test(font.dataUrl.trim())) continue;
    const decl = [
      `font-family:${cssString(font.family)}`,
      font.weight ? `font-weight:${cssToken(font.weight)}` : '',
      font.style ? `font-style:${cssToken(font.style)}` : '',
      `src:url(${cssString(font.dataUrl.trim())})`,
    ]
      .filter(Boolean)
      .join(';');
    css.push(`@font-face{${decl}}`);
  }
  // A `<` is never valid CSS outside a string, and inside one `\3c ` is the
  // same character — so nothing in the stylesheet can close the <style> or
  // spell a tag.
  const style = css.filter((s) => s.trim()).join('\n').replace(/</g, '\\3c ');
  const lang = escapeAttr((input.lang ?? 'en').trim() || 'en');
  return [
    '<!doctype html>',
    `<html lang="${lang}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(input.title)}</title>`,
    `<style>\n${style}\n</style>`,
    '</head>',
    '<body>',
    `<main class="prose">\n${input.bodyHtml}\n</main>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[m]!);
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

/** A CSS double-quoted string literal. */
function cssString(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\n\r]/g, ' ')}"`;
}

/** A bare CSS token (font-weight / font-style); anything odd is dropped. */
function cssToken(s: string): string {
  return s.replace(/[^A-Za-z0-9 .%-]/g, '').trim() || 'normal';
}

const URL_ATTR = new RegExp(
  String.raw`\b(?:src|href|xlink:href|poster|action|formaction|data|srcset)\s*=\s*` +
    String.raw`(?:"([^"]*)"|'([^']*)'|([^\s>"']+))`,
  'gi'
);
const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]*))\s*\)/gi;
const CSS_IMPORT = /@import\s+(?!url\()\s*(?:"([^"]*)"|'([^']*)')/gi;

const isExternal = (u: string): boolean => /^(?:https?:)?\/\//i.test(u.trim());

/**
 * Every external URL — http://, https:// or protocol-relative // — found in
 * src/href-style attributes, srcset lists, CSS url(…) and @import. data: URLs,
 * fragments and relative paths are not external. Deduplicated, in document
 * order.
 */
export function externalReferences(html: string): string[] {
  const found: string[] = [];
  const add = (raw: string | undefined) => {
    if (raw === undefined) return;
    const u = raw.trim();
    if (isExternal(u) && !found.includes(u)) found.push(u);
  };
  for (const m of html.matchAll(URL_ATTR)) {
    const value = m[1] ?? m[2] ?? m[3] ?? '';
    // srcset: "url 2x, url 640w" — each candidate's first token is a URL.
    if (value.includes(',') && /srcset/i.test(m[0])) {
      for (const part of value.split(',')) add(part.trim().split(/\s+/)[0]);
    } else {
      add(value);
    }
  }
  for (const m of html.matchAll(CSS_URL)) add(m[1] ?? m[2] ?? m[3]);
  for (const m of html.matchAll(CSS_IMPORT)) add(m[1] ?? m[2]);
  return found;
}

/**
 * Print the current page with `title` as the document title — the only way to
 * seed the browser's suggested PDF filename — then put the old title back once
 * the dialog closes (afterprint; a timeout covers browsers that never fire it).
 */
export function printDocument(title: string): void {
  const previous = document.title;
  const wanted = title.trim() || previous;
  let done = false;
  const restore = () => {
    if (done) return;
    done = true;
    window.removeEventListener('afterprint', restore);
    // Only undo our own change — the app may have navigated meanwhile.
    if (document.title === wanted) document.title = previous;
  };
  window.addEventListener('afterprint', restore);
  document.title = wanted;
  try {
    window.print();
  } finally {
    // Chromium blocks in print() and has already fired afterprint by now;
    // Safari returns at once and fires it later. The fallback is for neither.
    setTimeout(restore, 60_000);
  }
}
