import { describe, expect, it } from 'vitest';
import { buildBody, checkJson, contentTypeWarning, encodeForm } from './body';
import { classifyFailure, compareContentType } from './classify';
import {
  blankHeader,
  checkHeader,
  FORBIDDEN_HEADERS,
  isForbiddenHeader,
  sendableHeaders,
  type HeaderRow,
} from './headers';
import { blankRequest, carriesBody, checkUrl, METHODS, type HttpRequest } from './model';
import { send } from './send';
import {
  chooseView,
  formatBytes,
  formatMs,
  parsesAsJson,
  prettyJson,
  statusFamily,
} from './view';

const header = (name: string, value = 'v', enabled = true): HeaderRow => ({ name, value, enabled });

const request = (over: Partial<HttpRequest> = {}): HttpRequest => ({
  ...blankRequest(),
  url: 'https://example.test/thing',
  ...over,
});

const bytes = (...values: number[]) => new Uint8Array(values);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0);
const text = (value: string) => new TextEncoder().encode(value);

describe('header names and values', () => {
  it('accepts a token name and a printable value', () => {
    expect(checkHeader('X-Api-Key', 'abc123')).toBeNull();
    expect(checkHeader("X-Weird'name*", 'v')).toBeNull();
    expect(checkHeader('accept', 'application/json; charset=utf-8')).toBeNull();
  });

  it('treats a wholly blank row as a blank line, not a mistake', () => {
    expect(checkHeader('', '')).toBeNull();
    expect(checkHeader('   ', '  ')).toBeNull();
  });

  it('names the character that makes a name invalid', () => {
    const problem = checkHeader('X Api', 'v');
    expect(problem?.kind).toBe('name');
    expect(problem?.message).toContain('` `');
    for (const bad of ['X:Api', 'X\tApi', 'X(Api)', 'X@Api', 'X,Api']) {
      expect(checkHeader(bad, 'v')?.kind, bad).toBe('name');
    }
  });

  it('refuses a value carrying a line break — that is header injection', () => {
    expect(checkHeader('X', 'a\nb')?.kind).toBe('value');
    expect(checkHeader('X', 'a\nb')?.message).toContain('line break');
    expect(checkHeader('X', 'a\rb')?.message).toContain('carriage return');
  });

  it('says a value without a name is missing its name', () => {
    expect(checkHeader('', 'orphan')?.kind).toBe('name');
  });
});

describe('the forbidden request headers', () => {
  it('flags every name the Fetch standard reserves, in any case', () => {
    for (const name of FORBIDDEN_HEADERS) {
      expect(isForbiddenHeader(name), name).toBe(true);
      expect(isForbiddenHeader(name.toUpperCase()), name).toBe(true);
    }
  });

  it('flags the Proxy- and Sec- prefixes', () => {
    expect(isForbiddenHeader('Proxy-Authorization')).toBe(true);
    expect(isForbiddenHeader('Sec-Fetch-Mode')).toBe(true);
    // The prefix is `sec-`, not `sec`: a header merely starting with those
    // three letters is an ordinary header and must not be flagged.
    expect(isForbiddenHeader('Section')).toBe(false);
    expect(isForbiddenHeader('Proxying')).toBe(false);
  });

  it('leaves ordinary headers alone', () => {
    for (const name of ['Authorization', 'Accept', 'Content-Type', 'X-Request-Id', 'If-Match']) {
      expect(isForbiddenHeader(name), name).toBe(false);
    }
  });

  /** The point of the feature: a warning, not an error, and never silence. */
  it('warns rather than erroring, and says it will be dropped', () => {
    const problem = checkHeader('Host', 'evil.test');
    expect(problem?.kind).toBe('forbidden');
    expect(problem?.message).toContain('dropped silently');
  });

  it('keeps a forbidden header out of what actually goes over the wire', () => {
    const rows = [header('Authorization', 'Bearer x'), header('Host', 'evil.test'), header('Origin', 'x')];
    expect(sendableHeaders(rows)).toEqual([['Authorization', 'Bearer x']]);
  });
});

describe('sendableHeaders', () => {
  it('drops unticked rows, blank names and invalid ones', () => {
    const rows = [
      header('A', '1'),
      { ...header('B', '2'), enabled: false },
      header('', '3'),
      header('C D', '4'),
      header('E', 'line\nbreak'),
    ];
    expect(sendableHeaders(rows)).toEqual([['A', '1']]);
  });

  it('trims both halves', () => {
    expect(sendableHeaders([header('  A  ', '  1  ')])).toEqual([['A', '1']]);
  });

  it('is empty for a blank table', () => {
    expect(sendableHeaders([blankHeader()])).toEqual([]);
  });
});

describe('the URL', () => {
  it('accepts http and https', () => {
    expect(checkUrl('https://example.test/a?b=c')).toBeNull();
    expect(checkUrl('http://localhost:3000/api')).toBeNull();
  });

  it('asks for a scheme rather than guessing one', () => {
    expect(checkUrl('example.test/a')?.message).toContain('scheme');
    expect(checkUrl('')?.message).toContain('Enter a URL');
  });

  it('refuses schemes a page cannot fetch, by name', () => {
    expect(checkUrl('file:///etc/passwd')?.message).toContain('file:');
    expect(checkUrl('data:text/plain,hi')?.message).toContain('data:');
    expect(checkUrl('ftp://example.test')?.message).toContain('ftp:');
  });
});

describe('bodies', () => {
  it('knows which methods can carry one', () => {
    expect(carriesBody('GET')).toBe(false);
    expect(carriesBody('HEAD')).toBe(false);
    for (const method of METHODS.filter((m) => m !== 'GET' && m !== 'HEAD')) {
      expect(carriesBody(method), method).toBe(true);
    }
  });

  it('sends nothing for a bodyless method, whatever is typed', () => {
    const built = buildBody(request({ method: 'GET', bodyKind: 'json', bodyText: '{"a":1}' }));
    expect(built).toEqual({ ok: true, body: null, headers: [] });
  });

  describe('urlencoded form', () => {
    const fields = (...pairs: [string, string][]) =>
      pairs.map(([name, value]) => ({ name, value, enabled: true }));

    it('escapes what would otherwise become another field', () => {
      expect(encodeForm(fields(['a', 'x&y=z']))).toBe('a=x%26y%3Dz');
    });

    it('uses + for a space, as the format requires', () => {
      expect(encodeForm(fields(['q', 'two words']))).toBe('q=two+words');
    });

    it('percent-escapes non-ASCII as UTF-8', () => {
      expect(encodeForm(fields(['name', 'café']))).toBe('name=caf%C3%A9');
      expect(encodeForm(fields(['emoji', '🦊']))).toBe('emoji=%F0%9F%A6%8A');
    });

    it('keeps repeated names as repeated fields', () => {
      expect(encodeForm(fields(['tag', 'a'], ['tag', 'b']))).toBe('tag=a&tag=b');
    });

    it('keeps an empty value and drops a nameless row', () => {
      expect(encodeForm(fields(['a', ''], ['', 'orphan']))).toBe('a=');
    });

    it('skips unticked rows', () => {
      const rows = [
        { name: 'a', value: '1', enabled: true },
        { name: 'b', value: '2', enabled: false },
      ];
      expect(encodeForm(rows)).toBe('a=1');
    });

    it('sets the header the format needs', () => {
      const built = buildBody(request({ method: 'POST', bodyKind: 'form', fields: fields(['a', '1']) }));
      expect(built).toMatchObject({
        ok: true,
        body: 'a=1',
        headers: [['Content-Type', 'application/x-www-form-urlencoded;charset=UTF-8']],
      });
    });
  });

  describe('JSON', () => {
    it('passes valid JSON with the right header', () => {
      const built = buildBody(request({ method: 'POST', bodyKind: 'json', bodyText: '{"a":1}' }));
      expect(built).toEqual({ ok: true, body: '{"a":1}', headers: [['Content-Type', 'application/json']] });
    });

    it('blocks the send rather than letting the server reject it', () => {
      const built = buildBody(request({ method: 'POST', bodyKind: 'json', bodyText: '{"a":}' }));
      expect(built.ok).toBe(false);
      if (built.ok) return;
      expect(built.error).toMatch(/\S/);
    });

    it('reports a position when the engine gives one', () => {
      const problem = checkJson('{"a": 1,,}');
      expect(problem).not.toBeNull();
      expect(problem!.message).toMatch(/\S/);
      // V8 names a position; the field is null elsewhere rather than invented.
      expect(problem!.at === null || typeof problem!.at === 'number').toBe(true);
    });

    it('calls an empty body what it is', () => {
      expect(checkJson('   ')?.message).toContain('empty');
    });

    it('accepts a bare value, which is valid JSON', () => {
      expect(checkJson('42')).toBeNull();
      expect(checkJson('"a string"')).toBeNull();
      expect(checkJson('null')).toBeNull();
    });
  });

  describe('multipart', () => {
    it('never sets its own Content-Type — only the browser knows the boundary', () => {
      const built = buildBody(
        request({ method: 'POST', bodyKind: 'multipart', fields: [{ name: 'a', value: '1', enabled: true }] })
      );
      expect(built.ok).toBe(true);
      if (!built.ok) return;
      expect(built.headers).toEqual([]);
      expect(built.body).toBeInstanceOf(FormData);
      expect((built.body as FormData).get('a')).toBe('1');
    });

    it('warns when someone sets one anyway, and explains the consequence', () => {
      const warning = contentTypeWarning(request({ bodyKind: 'multipart' }), ['Content-Type']);
      expect(warning).toContain('boundary');
      expect(contentTypeWarning(request({ bodyKind: 'multipart' }), ['Accept'])).toBeNull();
      expect(contentTypeWarning(request({ bodyKind: 'json' }), ['Content-Type'])).toBeNull();
    });
  });

  describe('raw', () => {
    it('sends the text with the type that was chosen', () => {
      const built = buildBody(
        request({ method: 'POST', bodyKind: 'text', bodyText: '<a/>', bodyContentType: 'application/xml' })
      );
      expect(built).toEqual({ ok: true, body: '<a/>', headers: [['Content-Type', 'application/xml']] });
    });

    it('sends no type when none was chosen', () => {
      const built = buildBody(
        request({ method: 'POST', bodyKind: 'text', bodyText: 'hi', bodyContentType: '  ' })
      );
      expect(built).toEqual({ ok: true, body: 'hi', headers: [] });
    });
  });
});

describe('classifying a failed fetch', () => {
  const context = { url: 'https://api.test/x', pageOrigin: 'https://app.test', online: true };
  const typeError = new TypeError('Failed to fetch');

  it('knows an abort for certain', () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    const failure = classifyFailure(abort, context);
    expect(failure.kind).toBe('aborted');
    expect(failure.guess).toBe(false);
  });

  /** The case that looks identical to CORS and is not. */
  it('names mixed content separately, and is certain about it', () => {
    const failure = classifyFailure(typeError, {
      url: 'http://api.test/x',
      pageOrigin: 'https://app.test',
      online: true,
    });
    expect(failure.kind).toBe('mixed-content');
    expect(failure.guess).toBe(false);
    expect(failure.detail).toContain('never saw it');
  });

  it('does not call it mixed content when the page is itself http', () => {
    const failure = classifyFailure(typeError, {
      url: 'http://api.test/x',
      pageOrigin: 'http://app.test',
      online: true,
    });
    expect(failure.kind).toBe('cors');
  });

  it('checks offline before guessing at CORS', () => {
    const failure = classifyFailure(typeError, { ...context, online: false });
    expect(failure.kind).toBe('offline');
    expect(failure.guess).toBe(false);
  });

  it('rules CORS out for a same-origin address', () => {
    const failure = classifyFailure(typeError, {
      url: 'https://app.test/api',
      pageOrigin: 'https://app.test',
      online: true,
    });
    expect(failure.kind).toBe('unreachable');
    expect(failure.detail).toContain('not involved');
  });

  it('calls cross-origin failure a LIKELIHOOD, and says why it cannot be sure', () => {
    const failure = classifyFailure(typeError, context);
    expect(failure.kind).toBe('cors');
    expect(failure.guess).toBe(true);
    expect(failure.title).toContain('likely');
    expect(failure.detail).toContain('https://api.test');
    expect(failure.detail).toContain('https://app.test');
    // It must say whose decision this is, and that no browser client escapes it.
    expect(failure.detail).toContain('Access-Control-Allow-Origin');
    expect(failure.detail).toContain('No client running in a browser');
  });

  it('falls back without pretending to know', () => {
    const failure = classifyFailure(new TypeError('boom'), { ...context, url: 'not a url' });
    expect(failure.kind).toBe('unknown');
    expect(failure.detail).toContain('boom');
  });
});

describe('the Content-Type claim against the bytes', () => {
  it('reports a disagreement in both directions', () => {
    const found = compareContentType('text/plain; charset=utf-8', 'image/png');
    expect(found?.claimed).toBe('text/plain');
    expect(found?.sniffed).toBe('image/png');
    expect(found?.message).toContain('the bytes are the evidence');
  });

  it('says nothing when they agree', () => {
    expect(compareContentType('image/png', 'image/png')).toBeNull();
    expect(compareContentType('application/json', null)).toBeNull();
    expect(compareContentType(null, 'image/png')).toBeNull();
  });

  /**
   * Everything textual sniffs as `text/plain` when it is not something more
   * specific, so a server calling its text JSON, HTML, CSV or XML is agreeing
   * with the bytes, not contradicting them. Crying wolf here would make the
   * warning worthless on the bodies people actually fetch.
   */
  it('does not cry wolf over textual types', () => {
    for (const claimed of [
      'application/json',
      'application/vnd.api+json',
      'text/html',
      'text/csv',
      'application/xml',
      'image/svg+xml',
    ]) {
      expect(compareContentType(claimed, 'text/plain'), claimed).toBeNull();
    }
  });

  it('still reports a binary claim over textual bytes', () => {
    expect(compareContentType('image/png', 'text/plain')?.claimed).toBe('image/png');
  });
});

describe('choosing a viewer', () => {
  it('says so when there is no body', () => {
    expect(chooseView(bytes(), 'text/plain', null, null, '').view).toBe('empty');
  });

  /** The TODO's rule, and the reason sniffing exists here. */
  it('offers binary as a download with no viewer, whatever the header claims', () => {
    const choice = chooseView(PNG, 'text/plain; charset=utf-8', 'image/png', 'png', '');
    expect(choice.view).toBe('binary');
    expect(choice.filename).toBe('response.png');
    expect(choice.reason).toContain('download');
  });

  it('treats unrecognisable, non-text bytes as binary rather than guessing', () => {
    const choice = chooseView(bytes(0x00, 0x01, 0x02, 0x03), null, null, null, '');
    expect(choice.view).toBe('binary');
    expect(choice.filename).toBe('response.bin');
  });

  it('pretty-prints JSON that parses', () => {
    const body = '{"a":1}';
    expect(chooseView(text(body), 'application/json', 'text/plain', 'txt', body).view).toBe('json');
    expect(chooseView(text(body), 'application/vnd.api+json', 'text/plain', 'txt', body).view).toBe('json');
  });

  it('calls out a body that claims JSON and does not parse, without hiding it', () => {
    const body = '{ "almost": true,, }';
    const choice = chooseView(text(body), 'application/json', 'text/plain', 'txt', body);
    expect(choice.view).toBe('text');
    expect(choice.reason).toContain('does not parse');
  });

  it('shows HTML as source, and says the preview is sandboxed', () => {
    const body = '<!doctype html><p>hi</p>';
    const choice = chooseView(text(body), 'text/html; charset=utf-8', 'text/plain', 'txt', body);
    expect(choice.view).toBe('html');
    expect(choice.reason).toContain('source by default');
    expect(choice.reason).toContain('no access to this app');
  });

  it('falls back to text', () => {
    const body = 'a,b,c';
    expect(chooseView(text(body), 'text/csv', 'text/plain', 'txt', body).view).toBe('text');
  });

  it('recognises JSON with no declared type at all', () => {
    const body = '[1,2,3]';
    expect(chooseView(text(body), null, 'text/plain', 'txt', body).view).toBe('json');
  });
});

describe('formatting', () => {
  it('parses and pretty-prints, or hands back what it got', () => {
    expect(parsesAsJson('{"a":1}')).toBe(true);
    expect(parsesAsJson('nope')).toBe(false);
    expect(prettyJson('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(prettyJson('not json')).toBe('not json');
  });

  it('sizes and times in units a person reads', () => {
    expect(formatBytes(0)).toBe('0 bytes');
    expect(formatBytes(1)).toBe('1 byte');
    expect(formatBytes(1023)).toBe('1023 bytes');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.00 MB');
    expect(formatMs(0)).toBe('0 ms');
    expect(formatMs(142.4)).toBe('142 ms');
    expect(formatMs(1830)).toBe('1.83 s');
  });

  /** Never colour alone: the family has a word. */
  it('names each status family', () => {
    expect(statusFamily(200)).toBe('success');
    expect(statusFamily(301)).toBe('redirect');
    expect(statusFamily(404)).toBe('client error');
    expect(statusFamily(500)).toBe('server error');
    expect(statusFamily(100)).toBe('informational');
  });
});

describe('send', () => {
  const okResponse = (body: string, headers: Record<string, string> = {}) =>
    new Response(body, { status: 200, statusText: 'OK', headers });

  it('reports a non-2xx as a RESULT, not a failure — 404 is an answer', async () => {
    const result = await send(request(), {
      fetchImpl: async () => new Response('gone', { status: 404, statusText: 'Not Found' }),
      pageOrigin: 'https://app.test',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response.status).toBe(404);
    expect(result.response.ok).toBe(false);
  });

  it('never sends cookies, whatever the address', async () => {
    let seen: RequestInit | undefined;
    await send(request(), {
      pageOrigin: 'https://app.test',
      fetchImpl: async (_url, init) => {
        seen = init;
        return okResponse('{}');
      },
    });
    expect(seen?.credentials).toBe('omit');
  });

  it('sends the method, the URL and the headers that survived validation', async () => {
    let url: string | undefined;
    let init: RequestInit | undefined;
    await send(
      request({
        method: 'POST',
        url: '  https://example.test/x  ',
        headers: [header('X-Ok', '1'), header('Host', 'evil.test')],
        bodyKind: 'json',
        bodyText: '{"a":1}',
      }),
      {
        pageOrigin: 'https://app.test',
        fetchImpl: async (u, i) => {
          url = String(u);
          init = i;
          return okResponse('{}');
        },
      }
    );
    expect(url).toBe('https://example.test/x');
    expect(init?.method).toBe('POST');
    const sent = new Headers(init?.headers);
    expect(sent.get('X-Ok')).toBe('1');
    expect(sent.get('Content-Type')).toBe('application/json');
    expect(sent.has('Host')).toBe(false);
  });

  it('lets an explicit Content-Type override the body kind default', async () => {
    let init: RequestInit | undefined;
    await send(
      request({
        method: 'POST',
        bodyKind: 'json',
        bodyText: '{}',
        headers: [header('Content-Type', 'application/vnd.me+json')],
      }),
      {
        pageOrigin: 'https://app.test',
        fetchImpl: async (_u, i) => {
          init = i;
          return okResponse('{}');
        },
      }
    );
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/vnd.me+json');
  });

  it('times the whole thing including reading the body', async () => {
    let tick = 1000;
    const result = await send(request(), {
      pageOrigin: 'https://app.test',
      now: () => (tick += 25),
      fetchImpl: async () => okResponse('{}'),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response.ms).toBeGreaterThan(0);
  });

  it('sniffs the body and reports the server disagreeing with it', async () => {
    const result = await send(request(), {
      pageOrigin: 'https://app.test',
      fetchImpl: async () =>
        new Response(PNG, { status: 200, headers: { 'content-type': 'text/plain' } }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response.sniffedMime).toBe('image/png');
    expect(result.response.contentType).toContain('text/plain');
    expect(result.response.disagreement?.sniffed).toBe('image/png');
  });

  it('refuses to send an invalid JSON body and says why', async () => {
    let called = false;
    const result = await send(request({ method: 'POST', bodyKind: 'json', bodyText: '{oops' }), {
      pageOrigin: 'https://app.test',
      fetchImpl: async () => {
        called = true;
        return okResponse('{}');
      },
    });
    expect(called, 'a broken body must not reach the network').toBe(false);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.title).toContain('body');
  });

  it('routes a rejected fetch through the classifier', async () => {
    const result = await send(request({ url: 'https://api.test/x' }), {
      pageOrigin: 'https://app.test',
      online: true,
      fetchImpl: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe('cors');
  });

  it('reports an abort as a cancellation rather than an error', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await send(request(), {
      pageOrigin: 'https://app.test',
      signal: controller.signal,
      fetchImpl: async (_u, init) => {
        if (init?.signal?.aborted) {
          const error = new Error('aborted');
          error.name = 'AbortError';
          throw error;
        }
        return okResponse('{}');
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe('aborted');
  });
});
