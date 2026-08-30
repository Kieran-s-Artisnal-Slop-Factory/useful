import { describe, expect, it } from 'vitest';
import {
  appendMessage,
  buildPreviewDocument,
  CONSOLE_CHANNEL,
  CONSOLE_LIMIT,
  CONSOLE_MAX_CHARS,
  CONSOLE_SHIM,
  escapeCloseTag,
  injectConsoleShim,
  isConsoleMessage,
  type ConsoleMessage,
} from './document';

describe('escapeCloseTag', () => {
  it('neutralises the closing tag wherever it appears', () => {
    expect(escapeCloseTag('const s = "</script>";', 'script')).toBe(
      'const s = "<\\/script>";'
    );
    expect(escapeCloseTag('/* </script> */', 'script')).toBe('/* <\\/script> */');
    expect(escapeCloseTag('a { content: "</style>" }', 'style')).toBe(
      'a { content: "<\\/style>" }'
    );
  });

  it('is case-insensitive and catches every occurrence', () => {
    expect(escapeCloseTag('</SCRIPT></script></Script>', 'script')).toBe(
      '<\\/SCRIPT><\\/script><\\/Script>'
    );
  });

  it('escapes conservatively — the opening tag and unrelated text are untouched', () => {
    // `</scriptfoo` does not actually end an element, but escaping it costs
    // nothing and keeps the rule "no `</tag` survives" simple enough to trust.
    expect(escapeCloseTag('</scriptfoo', 'script')).toBe('<\\/scriptfoo');
    expect(escapeCloseTag('<script>x</b>', 'script')).toBe('<script>x</b>');
    expect(escapeCloseTag('a < b && c > d', 'script')).toBe('a < b && c > d');
    expect(escapeCloseTag('', 'script')).toBe('');
  });

  it('leaves an already-escaped close alone in the only way that matters', () => {
    // Double-escaping is not a correctness problem; ending the element is.
    expect(escapeCloseTag('<\\/script>', 'script')).not.toContain('</script');
  });
});

describe('buildPreviewDocument', () => {
  it('puts each buffer in its own slot', () => {
    const doc = buildPreviewDocument({
      html: '<h1>Title</h1>',
      css: 'h1 { color: red }',
      script: 'console.log(1)',
    });
    expect(doc).toContain('<style>h1 { color: red }</style>');
    expect(doc).toContain('<h1>Title</h1>');
    expect(doc).toContain('<script type="module">console.log(1)');
    expect(doc.indexOf('<style>')).toBeLessThan(doc.indexOf('<h1>Title</h1>'));
    expect(doc.indexOf('<h1>Title</h1>')).toBeLessThan(doc.indexOf('console.log(1)'));
  });

  it('starts with the doctype, so the preview is never in quirks mode', () => {
    expect(buildPreviewDocument({}).startsWith('<!doctype html>')).toBe(true);
  });

  it('survives empty buffers', () => {
    const doc = buildPreviewDocument({});
    expect(doc).toContain('<style></style>');
    expect(doc).toContain('<body>');
    expect(doc).toContain('</html>');
  });

  it('a `</script>` in user JavaScript cannot end the wrapper element', () => {
    const doc = buildPreviewDocument({ script: 'const end = "</script>"; alert(end)' });
    // Exactly one real close tag: the one this function wrote.
    expect(doc.split('</script>')).toHaveLength(2);
    expect(doc).toContain('const end = "<\\/script>"');
    expect(doc.trimEnd().endsWith('</html>')).toBe(true);
  });

  it('a `</style>` in user CSS cannot end the style element', () => {
    const doc = buildPreviewDocument({ css: 'a::after { content: "</style>" }' });
    expect(doc.split('</style>')).toHaveLength(2);
  });

  it('user HTML goes in as written — it is markup by intent', () => {
    const doc = buildPreviewDocument({ html: '<script>alert(1)</script>' });
    expect(doc).toContain('<script>alert(1)</script>');
  });

  it('takes a script type when a module is not wanted', () => {
    expect(buildPreviewDocument({ scriptType: 'text/javascript' })).toContain(
      '<script type="text/javascript">'
    );
  });
});

describe('CONSOLE_SHIM', () => {
  it('is one well-formed script element', () => {
    expect(CONSOLE_SHIM.startsWith('<script>')).toBe(true);
    expect(CONSOLE_SHIM.endsWith('</script>')).toBe(true);
    expect(CONSOLE_SHIM.split('</script>')).toHaveLength(2);
    // The `\/` in the source must not survive into the emitted markup.
    expect(CONSOLE_SHIM).not.toContain('<\\/script');
  });

  it('carries the channel tag the receiving side checks for', () => {
    expect(CONSOLE_SHIM).toContain(JSON.stringify(CONSOLE_CHANNEL));
  });

  /**
   * The shim ships as a string, so "does it contain the word console" proves
   * nothing. Run it for real with stand-in globals — the same trick the raster
   * history tests use for canvases.
   */
  function runShim() {
    const body = CONSOLE_SHIM.replace(/^<script>/, '').replace(/<\/script>$/, '');
    const sent: Record<string, unknown>[] = [];
    const passedThrough: unknown[][] = [];
    const listeners: Record<string, (event: never) => void> = {};
    const consoleStub: Record<string, (...args: unknown[]) => void> = {
      log: (...args) => passedThrough.push(args),
      info: (...args) => passedThrough.push(args),
      warn: (...args) => passedThrough.push(args),
      error: (...args) => passedThrough.push(args),
    };
    const run = new Function('console', 'parent', 'addEventListener', body) as (
      c: unknown,
      p: unknown,
      a: unknown
    ) => void;
    run(
      consoleStub,
      { postMessage: (message: Record<string, unknown>) => sent.push(message) },
      (type: string, handler: (event: never) => void) => {
        listeners[type] = handler;
      }
    );
    return { consoleStub, sent, passedThrough, listeners };
  }

  it('parses and installs without a DOM', () => {
    const { listeners } = runShim();
    expect(Object.keys(listeners).sort()).toEqual(['error', 'unhandledrejection']);
  });

  it('forwards all four levels and still calls the original method', () => {
    const { consoleStub, sent, passedThrough } = runShim();
    consoleStub.log!('hello');
    consoleStub.info!('info');
    consoleStub.warn!('warn');
    consoleStub.error!('error');
    expect(sent.map((m) => m.level)).toEqual(['log', 'info', 'warn', 'error']);
    expect(sent.every((m) => m.channel === CONSOLE_CHANNEL)).toBe(true);
    expect(passedThrough).toEqual([['hello'], ['info'], ['warn'], ['error']]);
  });

  it('joins arguments and JSON-stringifies the ones that are not text', () => {
    const { consoleStub, sent } = runShim();
    consoleStub.log!('n =', 1, { a: [1, 2] }, true, null);
    expect(sent[0]!.text).toBe('n = 1 {"a":[1,2]} true null');
  });

  it('falls back to String() on a value JSON cannot take', () => {
    const { consoleStub, sent } = runShim();
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    consoleStub.log!(cycle);
    expect(sent[0]!.text).toBe('[object Object]');
  });

  it('truncates a message rather than shipping a whole document', () => {
    const { consoleStub, sent } = runShim();
    consoleStub.log!('x'.repeat(CONSOLE_MAX_CHARS * 2));
    const text = String(sent[0]!.text);
    expect(text).toHaveLength(CONSOLE_MAX_CHARS + '… (truncated)'.length);
    expect(text.endsWith('… (truncated)')).toBe(true);
  });

  it('reports uncaught errors and unhandled rejections as errors', () => {
    const { listeners, sent } = runShim();
    (listeners.error as (event: { message: string }) => void)({ message: 'boom' });
    (listeners.unhandledrejection as (event: { reason: string }) => void)({ reason: 'nope' });
    expect(sent.map((m) => [m.level, m.text])).toEqual([
      ['error', 'boom'],
      ['error', 'Unhandled rejection: nope'],
    ]);
  });

  it('never throws into the page it is watching', () => {
    const body = CONSOLE_SHIM.replace(/^<script>/, '').replace(/<\/script>$/, '');
    const run = new Function('console', 'parent', 'addEventListener', body) as (
      c: unknown,
      p: unknown,
      a: unknown
    ) => void;
    const consoleStub: Record<string, (...args: unknown[]) => void> = {
      log: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    };
    // A parent that refuses messages is the realistic hostile case.
    run(
      consoleStub,
      {
        postMessage: () => {
          throw new Error('refused');
        },
      },
      () => {}
    );
    expect(() => consoleStub.log!('anything')).not.toThrow();
  });
});

describe('injectConsoleShim', () => {
  it('goes just inside <head>, ahead of anything that could log', () => {
    const out = injectConsoleShim('<!doctype html><html><head><title>t</title></head><body>');
    expect(out.indexOf(CONSOLE_SHIM)).toBeGreaterThan(out.indexOf('<head>'));
    expect(out.indexOf(CONSOLE_SHIM)).toBeLessThan(out.indexOf('<title>'));
  });

  it('handles a <head> with attributes', () => {
    const out = injectConsoleShim('<html><head data-x="1"><script>log()</script></head>');
    expect(out.indexOf(CONSOLE_SHIM)).toBeLessThan(out.indexOf('log()'));
  });

  it('falls back to just inside <html> when there is no head', () => {
    const out = injectConsoleShim('<html><body>hi</body></html>');
    expect(out.indexOf(CONSOLE_SHIM)).toBeGreaterThan(out.indexOf('<html>'));
    expect(out.indexOf(CONSOLE_SHIM)).toBeLessThan(out.indexOf('<body>'));
  });

  it('never displaces a doctype — quirks mode is not an acceptable side effect', () => {
    const out = injectConsoleShim('<!DOCTYPE html>\n<p>bare body</p>');
    expect(out.trimStart().toLowerCase().startsWith('<!doctype html>')).toBe(true);
    expect(out).toContain(CONSOLE_SHIM);
    expect(out.indexOf(CONSOLE_SHIM)).toBeLessThan(out.indexOf('<p>'));
  });

  it('prepends when the document has no structure at all', () => {
    expect(injectConsoleShim('just text').startsWith(CONSOLE_SHIM)).toBe(true);
    expect(injectConsoleShim('')).toBe(CONSOLE_SHIM + '\n');
  });

  it('lands before the user script in an assembled document', () => {
    const doc = injectConsoleShim(buildPreviewDocument({ script: 'console.log(1)' }));
    expect(doc.indexOf(CONSOLE_SHIM)).toBeLessThan(doc.indexOf('console.log(1)'));
    expect(doc.startsWith('<!doctype html>')).toBe(true);
  });
});

describe('isConsoleMessage', () => {
  const good = { channel: CONSOLE_CHANNEL, level: 'warn', text: 'careful' };

  it('accepts a message from our shim', () => {
    expect(isConsoleMessage(good)).toBe(true);
  });

  const rejected: [string, unknown][] = [
    ['a different channel', { ...good, channel: 'someone-else' }],
    ['no channel', { level: 'log', text: 'x' }],
    ['an unknown level', { ...good, level: 'debug' }],
    ['a non-string level', { ...good, level: 1 }],
    ['a non-string body', { ...good, text: { a: 1 } }],
    ['no body', { channel: CONSOLE_CHANNEL, level: 'log' }],
    ['null', null],
    ['undefined', undefined],
    ['a string', 'useful-preview-console'],
    ['a number', 42],
    ['an array', [good]],
  ];

  for (const [label, value] of rejected) {
    it(`rejects ${label}`, () => {
      expect(isConsoleMessage(value)).toBe(false);
    });
  }
});

describe('appendMessage', () => {
  const message = (n: number): ConsoleMessage => ({ level: 'log', text: String(n) });

  it('appends in order', () => {
    expect(appendMessage([message(1)], message(2)).map((m) => m.text)).toEqual(['1', '2']);
  });

  it('keeps only the last CONSOLE_LIMIT, dropping the oldest', () => {
    let list: ConsoleMessage[] = [];
    for (let i = 0; i < CONSOLE_LIMIT * 3; i++) list = appendMessage(list, message(i));
    expect(list).toHaveLength(CONSOLE_LIMIT);
    expect(list[0]!.text).toBe(String(CONSOLE_LIMIT * 2));
    expect(list.at(-1)!.text).toBe(String(CONSOLE_LIMIT * 3 - 1));
  });

  it('does not mutate the list it was given', () => {
    const before: ConsoleMessage[] = [message(1)];
    appendMessage(before, message(2));
    expect(before).toHaveLength(1);
  });
});
