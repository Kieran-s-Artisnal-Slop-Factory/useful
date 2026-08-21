// The sanitize stage needs a DOM, which vitest's node environment has not got;
// everything below exercises the marked stage through renderMarkdownUnsafe.
import { describe, expect, it, vi } from 'vitest';
import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import Prism from './prism';
import { renderMarkdownUnsafe as render, wikiLinkHref } from './markdown';

/** The pipeline exactly as it was before the factory: the regression oracle. */
const legacy = new Marked(
  markedHighlight({
    highlight(code, lang) {
      const grammar = Prism.languages[lang];
      return grammar ? Prism.highlight(code, grammar, lang) : code.replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[m]!);
    },
  }),
  { gfm: true }
);
const old = (md: string) => legacy.parse(md, { async: false });

describe('plain markdown is unchanged', () => {
  it.each([
    ['a paragraph', 'Hello *world* — see <https://x.test> and `code`.'],
    ['a fenced code block with Prism tokens', '```js\nconst x = 1;\n```\n'],
    ['an unknown-language fence', '```nope\na < b\n```\n'],
    ['a table', '| a | b |\n|---|---|\n| 1 | 2 |\n'],
    ['a task list', '- [x] done\n- [ ] todo\n'],
    ['headings and links', '# Title\n\n[text](https://x.test "t") ![alt](https://x.test/i.png)\n'],
  ])('%s', (_name, md) => {
    expect(render(md)).toBe(old(md));
  });

  it('a Prism-highlighted block still carries token spans', () => {
    expect(render('```js\nconst x = 1;\n```\n')).toContain('<span class="token keyword">const</span>');
  });
});

describe('wiki links', () => {
  it('renders a bare link to the notebook route by title', () => {
    expect(render('see [[Ada Lovelace]]')).toBe(
      '<p>see <a class="wiki-link" data-wiki="Ada Lovelace"' +
        ` href="${wikiLinkHref('Ada Lovelace')}">Ada Lovelace</a></p>\n`
    );
    expect(wikiLinkHref('Ada Lovelace')).toBe('/tools/notebook/?note=Ada%20Lovelace');
  });

  it('uses the label, escapes it, and marks missing titles', () => {
    const html = render('[[Ada|<b>her</b>]] [[Bob]]', {
      wikiLinks: { href: (t) => `/n/${t}`, exists: (t) => t === 'Ada' },
    });
    expect(html).toContain('<a class="wiki-link" data-wiki="Ada" href="/n/Ada">&lt;b&gt;her&lt;/b&gt;</a>');
    expect(html).toContain('<a class="wiki-link missing" data-wiki="Bob" href="/n/Bob">Bob</a>');
  });

  it('escapes quotes in the title attribute', () => {
    expect(render('[[a"b]]')).toContain('data-wiki="a&quot;b"');
  });

  it('leaves escaped, empty and in-code brackets alone', () => {
    expect(render('\\[[nope]]')).toBe('<p>[[nope]]</p>\n');
    expect(render('[[ ]]')).toBe('<p>[[ ]]</p>\n');
    expect(render('`[[code]]`')).toBe('<p><code>[[code]]</code></p>\n');
    expect(render('```\n[[code]]\n```\n')).not.toContain('wiki-link');
  });

  it('can be switched off', () => {
    expect(render('[[x]]', { wikiLinks: false })).toBe('<p>[[x]]</p>\n');
  });
});

describe('footnotes', () => {
  it('numbers references in first-use order and appends the section', () => {
    const md = 'B[^b] then A[^a] then B again[^b].\n\n[^a]: Note A\n[^b]: Note *B*\n';
    const html = render(md);
    expect(html).toBe(
      '<p>B<sup class="footnote-ref"><a href="#fn-b" id="fnref-b">1</a></sup> then ' +
        'A<sup class="footnote-ref"><a href="#fn-a" id="fnref-a">2</a></sup> then ' +
        'B again<sup class="footnote-ref"><a href="#fn-b" id="fnref-b-2">1</a></sup>.</p>\n' +
        '<section class="footnotes"><ol>' +
        '<li id="fn-b">Note <em>B</em> <a href="#fnref-b" class="footnote-backref">↩</a></li>' +
        '<li id="fn-a">Note A <a href="#fnref-a" class="footnote-backref">↩</a></li>' +
        '</ol></section>'
    );
  });

  it('renders an orphan reference as literal text and drops unused definitions', () => {
    const html = render('see[^gone]\n\n[^unused]: never cited\n');
    expect(html).toBe('<p>see[^gone]</p>\n');
  });

  it('keeps continuation lines and the first of duplicate definitions', () => {
    const html = render('x[^n]\n\n[^n]: first line\n    second line\n[^n]: duplicate\n');
    expect(html).toContain('<li id="fn-n">first line second line <a');
    expect(html).not.toContain('duplicate');
  });

  it('escapes labels in ids and hrefs', () => {
    const html = render('x[^a"b]\n\n[^a"b]: q\n');
    expect(html).toContain('href="#fn-a%22b" id="fnref-a%22b"');
    expect(html).toContain('<li id="fn-a%22b">');
  });

  it('ignores definitions and references inside code', () => {
    const html = render('`[^a]`\n\n```\n[^a]: not a note\n```\n');
    expect(html).not.toContain('footnote');
  });

  it('a definition may interrupt a paragraph, as the scanner assumes', () => {
    expect(render('text[^1]\n[^1]: note\n')).toContain('<li id="fn-1">note');
  });

  it('can be switched off', () => {
    expect(render('x[^a]\n\n[^a]: n\n', { footnotes: false })).not.toContain('footnote');
  });
});

describe('math', () => {
  it('renders inline maths as a span carrying the source', () => {
    expect(render('so $a<b$ holds')).toBe(
      '<p>so <span class="math math-inline" data-math="a&lt;b">a&lt;b</span> holds</p>\n'
    );
  });

  it('does not treat "$5 and $10" as maths', () => {
    expect(render('$5 and $10')).toBe('<p>$5 and $10</p>\n');
    expect(render('costs $5-$6')).toBe('<p>costs $5-$6</p>\n');
    expect(render('$ a$ and $a $')).toBe('<p>$ a$ and $a $</p>\n');
    expect(render('$$')).toBe('<p>$$</p>\n');
  });

  it('renders display maths blocks as a div and inline $$ as a display span', () => {
    expect(render('$$\n\\int_0^1 x\n$$\n')).toBe(
      '<div class="math math-display" data-math="\\int_0^1 x">\\int_0^1 x</div>'
    );
    expect(render('a $$x$$ b')).toBe(
      '<p>a <span class="math math-display" data-math="x">x</span> b</p>\n'
    );
  });

  it('renders a ```math fence as display maths, untouched by Prism', () => {
    expect(render('```math\nE = mc^2\n```\n')).toBe(
      '<div class="math math-display" data-math="E = mc^2">E = mc^2</div>'
    );
  });

  it('can be switched off, leaving dollars as prose', () => {
    expect(render('$a$', { math: false })).toBe('<p>$a$</p>\n');
    expect(render('```math\nx\n```\n', { math: false })).toContain('<pre><code class="language-math">');
  });
});

describe('mermaid', () => {
  it('renders a mermaid fence as an unhighlighted pre', () => {
    expect(render('```mermaid\ngraph TD\n  A --> B\n```\n')).toBe(
      '<pre class="mermaid">graph TD\n  A --&gt; B</pre>'
    );
  });

  it('respects an indented fence and a longer closing fence', () => {
    expect(render('  ~~~~mermaid\n  graph LR\n  ~~~~~\n')).toBe('<pre class="mermaid">graph LR</pre>');
  });

  it('can be switched off', () => {
    expect(render('```mermaid\ngraph TD\n```\n', { mermaid: false })).toContain(
      '<pre><code class="language-mermaid">'
    );
  });
});

describe('images', () => {
  it('resolves relative and asset: sources only', () => {
    const resolveImage = vi.fn((src: string) => (src === 'asset:7f3a' ? 'data:image/png;base64,AAAA' : undefined));
    const md = [
      '![a](asset:7f3a)',
      '![b](pics/b.png)',
      '![c](https://x.test/c.png)',
      '![d](/abs.png)',
      '![e](//cdn.test/e.png)',
      '![f](data:image/gif;base64,R0lGOD)',
    ].join(' ');
    const html = render(md, { resolveImage });
    expect(resolveImage.mock.calls.map((c) => c[0])).toEqual(['asset:7f3a', 'pics/b.png']);
    expect(html).toContain('<img src="data:image/png;base64,AAAA" alt="a">');
    expect(html).toContain('<img src="pics/b.png" alt="b">');
    expect(html).toContain('<img src="https://x.test/c.png" alt="c">');
  });

  it('renders as written without a resolver', () => {
    expect(render('![a](asset:7f3a)')).toBe('<p><img src="asset:7f3a" alt="a"></p>\n');
  });
});

describe('the unsafe stage is visibly unsafe', () => {
  // The sanitizer is DOMPurify, exercised in the browser; here we only pin
  // that the raw stage passes markup through, so a test that ever sees
  // renderMarkdown strip these knows it is the sanitizer doing it.
  it('passes script tags and handlers through for the sanitizer to strip', () => {
    const html = render('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">');
    expect(html).toContain('<script>');
    expect(html).toContain('onerror=');
  });
});
