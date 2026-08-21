import { describe, expect, it } from 'vitest';
import { NOTE_CSS, externalReferences, htmlExport, markdownExport } from './export';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const WOFF = 'data:font/woff2;base64,d09GMgABAAAA';

describe('markdownExport', () => {
  const assets = new Map([['asset:7f3a', PNG]]);

  it('prepends the title as an H1 when the body has none', () => {
    expect(markdownExport({ title: 'Plan', body_md: 'Body text' })).toBe('# Plan\n\nBody text\n');
  });

  it('leaves a body that already opens with that H1 alone', () => {
    const a = markdownExport({ title: 'Plan', body_md: '# Plan\n\nBody' });
    expect(a).toBe('# Plan\n\nBody\n');
    const b = markdownExport({ title: 'Plan', body_md: '\n\n# Plan #\nBody' });
    expect(b).toBe('\n\n# Plan #\nBody\n');
  });

  it('still adds the title when the body opens with a different H1 or a deeper heading', () => {
    const a = markdownExport({ title: 'Plan', body_md: '# Other\nBody' });
    expect(a).toBe('# Plan\n\n# Other\nBody\n');
    const b = markdownExport({ title: 'Plan', body_md: '## Plan\nBody' });
    expect(b).toBe('# Plan\n\n## Plan\nBody\n');
  });

  it('adds no heading for an empty title', () => {
    expect(markdownExport({ title: '  ', body_md: 'Body' })).toBe('Body\n');
  });

  it('inlines known asset refs as data URLs by default', () => {
    const md = '![shot](asset:7f3a)\n<img src="asset:7f3a" alt="">\n[file](asset:7f3a "t")';
    const out = markdownExport({ title: 'N', body_md: md }, { assets });
    expect(out).toContain(`![shot](${PNG})`);
    expect(out).toContain(`<img src="${PNG}" alt="">`);
    expect(out).toContain(`[file](${PNG} "t")`);
    expect(out).not.toContain('asset:7f3a');
  });

  it('leaves refs the map does not know, and everything when inlining is off', () => {
    const md = '![a](asset:7f3a) ![b](asset:unknown)';
    expect(markdownExport({ title: 'N', body_md: md }, { assets })).toBe(
      `# N\n\n![a](${PNG}) ![b](asset:unknown)\n`
    );
    expect(markdownExport({ title: 'N', body_md: md }, { assets, inlineAssets: false })).toBe(
      `# N\n\n${md}\n`
    );
    expect(markdownExport({ title: 'N', body_md: md })).toBe(`# N\n\n${md}\n`);
  });

  it('does not touch prose that merely mentions asset:', () => {
    const md = 'The scheme is asset:<id> — see `asset:abc` in code.';
    expect(markdownExport({ title: 'N', body_md: md }, { assets })).toBe(`# N\n\n${md}\n`);
  });
});

describe('htmlExport', () => {
  it('emits one complete document with the body inside main.prose', () => {
    const html = htmlExport({ title: 'Plan', bodyHtml: '<h1>Plan</h1><p>Hi</p>' });
    expect(html.startsWith('<!doctype html>\n<html lang="en">')).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<title>Plan</title>');
    expect(html).toContain('<main class="prose">\n<h1>Plan</h1><p>Hi</p>\n</main>');
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
    expect(html.match(/<style>/g)).toHaveLength(1);
  });

  it('escapes a hostile title', () => {
    const html = htmlExport({ title: '<script>alert(1)</script> & co', bodyHtml: '' });
    expect(html).toContain('<title>&lt;script&gt;alert(1)&lt;/script&gt; &amp; co</title>');
    expect(html).not.toContain('<script');
  });

  it('inlines NOTE_CSS by default, a replacement css when given, and extraCss after it', () => {
    const dflt = htmlExport({ title: 't', bodyHtml: '' });
    expect(dflt).toContain(NOTE_CSS);
    const custom = htmlExport({
      title: 't',
      bodyHtml: '',
      css: 'body{color:red}',
      extraCss: ['.katex{display:inline}'],
    });
    expect(custom).not.toContain(NOTE_CSS);
    const base = custom.indexOf('body{color:red}');
    expect(base).toBeGreaterThan(-1);
    expect(base).toBeLessThan(custom.indexOf('.katex{display:inline}'));
  });

  it('writes one @font-face per font, sourced from its data URL', () => {
    const html = htmlExport({
      title: 't',
      bodyHtml: '',
      fonts: [
        { family: 'KaTeX_Main', weight: '400', style: 'normal', dataUrl: WOFF },
        { family: 'KaTeX_Math', style: 'italic', dataUrl: WOFF },
        { family: 'Sneaky', dataUrl: 'https://cdn.example.com/f.woff2' },
      ],
    });
    expect(html.match(/@font-face/g)).toHaveLength(2);
    expect(html).toContain(
      `@font-face{font-family:"KaTeX_Main";font-weight:400;font-style:normal;src:url("${WOFF}")}`
    );
    expect(html).toContain(
      `@font-face{font-family:"KaTeX_Math";font-style:italic;src:url("${WOFF}")}`
    );
    expect(html).not.toContain('cdn.example.com');
  });

  it('never emits a script or link tag, and a </style> in css cannot break out', () => {
    const html = htmlExport({
      title: 't',
      bodyHtml: '<p>x</p>',
      extraCss: ['</style><script>alert(1)</script>'],
      fonts: [{ family: 'F', dataUrl: WOFF }],
    });
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<link/i);
    expect(html.match(/<\/style>/g)).toHaveLength(1);
  });

  it('keeps NOTE_CSS compact and self-contained', () => {
    expect(NOTE_CSS.length).toBeLessThan(6 * 1024);
    expect(externalReferences(NOTE_CSS)).toEqual([]);
    expect(NOTE_CSS).toContain('.token.keyword');
    expect(NOTE_CSS).toContain('.footnotes');
    expect(NOTE_CSS).toContain('.wiki-link');
  });
});

describe('externalReferences', () => {
  it('finds http, https and protocol-relative URLs in src, href and url()', () => {
    const html = [
      '<img src="https://a.example/x.png">',
      "<a href='http://b.example/'>x</a>",
      '<script src=//c.example/lib.js></script>',
      '<style>body{background:url(https://d.example/bg.png)}',
      '@import "https://e.example/x.css";</style>',
      '<div style="background:url(\'//f.example/y.png\')"></div>',
      '<img srcset="https://g.example/1.png 1x, https://g.example/2.png 2x">',
    ].join('\n');
    expect(externalReferences(html)).toEqual([
      'https://a.example/x.png',
      'http://b.example/',
      '//c.example/lib.js',
      'https://g.example/1.png',
      'https://g.example/2.png',
      'https://d.example/bg.png',
      '//f.example/y.png',
      'https://e.example/x.css',
    ]);
  });

  it('ignores data URLs, fragments and relative paths', () => {
    const html = htmlExport({
      title: 'self-contained',
      bodyHtml:
        `<img src="${PNG}"><a href="#fn-1">1</a><a href="../other/">o</a>` +
        `<p style="background:url(${PNG})"></p>`,
      fonts: [{ family: 'F', dataUrl: WOFF }],
    });
    expect(externalReferences(html)).toEqual([]);
  });

  it('dedupes repeated references', () => {
    const html = '<img src="https://a.example/x.png"><img src="https://a.example/x.png">';
    expect(externalReferences(html)).toEqual(['https://a.example/x.png']);
  });
});
