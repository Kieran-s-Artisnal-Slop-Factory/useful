/**
 * Phase 5 — extraction, the step scope, the record cap, and the one that
 * matters most: masking happens when a record is BUILT, not when it is drawn.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  extract,
  forStorage,
  normalizeRun,
  normalizeSteps,
  recordBody,
  recordSent,
  redactSecrets,
  starterSteps,
  STORED_BODY_LIMIT,
  type ExtractRule,
  type FlowStep,
} from './flow';
import { chainForStep, runFlow, STEP_SCOPE } from './run';
import { buildChain, GLOBAL_ID } from './env';
import { blankRequest, type HttpRequest } from './model';
import type { HttpSecret } from './secrets';
import type { HttpEnvironment } from '../db/types';
import type { ResponseSummary, SendResult } from './send';

const env = (id: string, name: string, values: unknown): HttpEnvironment =>
  ({ id, name, values, updated_at: '2026-01-01T00:00:00.000Z', deleted_at: null, server_seq: null }) as HttpEnvironment;

const secret = (name: string, value: string, environment_id: string | null = null): HttpSecret => ({
  id: `s-${name}`,
  name,
  value,
  environment_id,
  updated_at: '2026-01-01T00:00:00.000Z',
});

const request = (over: Partial<HttpRequest> = {}): HttpRequest => ({
  ...blankRequest(),
  headers: [],
  ...over,
});

const rule = (over: Partial<ExtractRule> = {}): ExtractRule => ({
  source: 'body',
  path: 'token',
  name: 'token',
  save: false,
  ...over,
});

const step = (over: Partial<FlowStep> = {}): FlowStep => ({
  id: 's1',
  name: 'Step',
  request_id: null,
  request: request(),
  outputs: [],
  ...over,
});

const response = (over: Partial<ResponseSummary> = {}): ResponseSummary => ({
  status: 200,
  statusText: 'OK',
  ok: true,
  headers: [['content-type', 'application/json']],
  bytes: new TextEncoder().encode('{}'),
  ms: 12,
  url: 'https://api.test/x',
  redirected: false,
  contentType: 'application/json',
  sniffedMime: 'text/plain',
  sniffedExtension: 'txt',
  sniffedLabel: 'Text',
  disagreement: null,
  ...over,
});

const jsonResponse = (body: string, over: Partial<ResponseSummary> = {}): ResponseSummary =>
  response({ bytes: new TextEncoder().encode(body), ...over });

describe('extraction rules', () => {
  const input = {
    status: 201,
    headers: [
      ['content-type', 'application/json'],
      ['X-Request-Id', 'abc-123'],
    ] as [string, string][],
    text: '{"token":"t-1","data":{"id":7},"items":[{"id":"first"}]}',
  };

  it('reads a top-level field, a nested one and an indexed one', () => {
    expect(extract(rule({ path: 'token' }), input)).toMatchObject({ ok: true, value: 't-1' });
    expect(extract(rule({ path: 'data.id' }), input)).toMatchObject({ ok: true, value: '7' });
    expect(extract(rule({ path: 'items[0].id' }), input)).toMatchObject({ ok: true, value: 'first' });
  });

  /** `body` is the whole document, so a list response is reachable at all. */
  it('reaches a response that is a list through `body`', () => {
    const list = { ...input, text: '[{"id":"one"},{"id":"two"}]' };
    expect(extract(rule({ path: 'body[1].id' }), list)).toMatchObject({ ok: true, value: 'two' });
  });

  it('reads a header, case-insensitively, and the status', () => {
    expect(extract(rule({ source: 'header', path: 'x-request-id' }), input)).toMatchObject({
      ok: true,
      value: 'abc-123',
    });
    expect(extract(rule({ source: 'status' }), input)).toMatchObject({ ok: true, value: '201' });
  });

  /**
   * The rule the whole design turns on. An empty string here is how a renamed
   * field becomes a request with a blank where the token should be, and a 401
   * three steps later with no clue where it came from.
   */
  it('reports a path that finds nothing rather than yielding an empty string', () => {
    const missing = extract(rule({ path: 'data.nope' }), input);
    expect(missing.ok).toBe(false);
    expect(missing.ok === false && missing.problem).toContain('no `nope` field');

    const noHeader = extract(rule({ source: 'header', path: 'x-nope' }), input);
    expect(noHeader.ok).toBe(false);
    expect(noHeader.ok === false && noHeader.problem).toContain('no `x-nope` header');
  });

  it('says so when the body is not JSON, or not text at all', () => {
    const notJson = extract(rule(), { ...input, text: 'plain words' });
    expect(notJson.ok === false && notJson.problem).toContain('not JSON');
    const notText = extract(rule(), { ...input, text: null });
    expect(notText.ok === false && notText.problem).toContain('not text');
  });

  it('refuses a rule with no name or no path', () => {
    expect(extract(rule({ name: '' }), input).ok).toBe(false);
    expect(extract(rule({ path: '' }), input).ok).toBe(false);
    expect(extract(rule({ source: 'header', path: '  ' }), input).ok).toBe(false);
  });
});

describe('what a record keeps', () => {
  const chain = buildChain({
    environments: [env(GLOBAL_ID, 'Global', { host: 'api.test' })],
    secrets: [secret('key', 'sk-live-NEVER-STORED')],
    activeId: null,
  });

  /**
   * The Phase 5 promise, and the plan asks for exactly this test: masking on
   * the way IN, not at render. A record masked only when drawn is a record
   * with the secret in the database, and a flow row rides backups.
   */
  it('masks the request when the record is built, not when it is shown', () => {
    const sent = recordSent(
      request({
        url: 'https://{{host}}/auth',
        headers: [{ name: 'Authorization', value: 'Bearer {{key}}', enabled: true }],
        bodyKind: 'json',
        bodyText: '{"k":"{{key}}"}',
      }),
      chain
    );
    // The variable resolved; the secret did not survive into the record.
    expect(sent.url).toBe('https://api.test/auth');
    expect(JSON.stringify(sent)).not.toContain('sk-live-NEVER-STORED');
    expect(sent.headers).toEqual([['Authorization', 'Bearer ••••••••']]);
    expect(sent.body).toBe('{"k":"••••••••"}');
  });

  it('leaves out headers that were not going to be sent', () => {
    const sent = recordSent(
      request({
        headers: [
          { name: 'A', value: '1', enabled: true },
          { name: 'B', value: '2', enabled: false },
          { name: '', value: '3', enabled: true },
        ],
      }),
      chain
    );
    expect(sent.headers).toEqual([['A', '1']]);
  });

  it('records no body for a request that carries none', () => {
    expect(recordSent(request({ bodyKind: 'none', bodyText: 'x' }), chain).body).toBeNull();
  });

  /** Decision 7: capped in storage, never in transit. */
  it('caps a stored body and says by how much', () => {
    const short = recordBody('hello', 5, 'text/plain');
    expect(short).toEqual({ body: 'hello', truncated: false, note: null, redacted: false });

    const long = 'x'.repeat(STORED_BODY_LIMIT + 500);
    const capped = recordBody(long, long.length, 'text/plain');
    expect(capped.body).toHaveLength(STORED_BODY_LIMIT);
    expect(capped.truncated).toBe(true);
    expect(capped.note).toContain('only the stored copy is capped');
  });

  it('records a note instead of bytes for a binary body', () => {
    const binary = recordBody(null, 8_000_000, 'image/png');
    expect(binary.body).toBeNull();
    expect(binary.note).toContain('image/png');
    expect(binary.note).toContain('a backup is one JSON file');
  });

  /**
   * Masking the REQUEST is not enough, which is the sort of thing a test
   * finds and reasoning does not: plenty of endpoints reflect the
   * `Authorization` header straight back, and every auth endpoint returns a
   * credential in its body by definition. Either way it lands in a recorded
   * response, and a flow row rides backups.
   */
  it('takes a secret back out of what the server sent', () => {
    const body = '{"echo":{"authorization":"Bearer sk-live-REFLECTED"},"ok":true}';
    const record = recordBody(body, body.length, 'text/plain', ['sk-live-REFLECTED']);
    expect(record.body).not.toContain('sk-live-REFLECTED');
    expect(record.body).toContain('••••••••');
    expect(record.redacted).toBe(true);
    // And it says so, rather than leaving the reader to wonder about bullets
    // that the response they watched live did not have.
    expect(record.note).toContain('came back in this body');
  });

  it('says nothing about redaction when there was none to do', () => {
    const record = recordBody('{"ok":true}', 11, 'text/plain', ['sk-live-UNUSED']);
    expect(record.redacted).toBe(false);
    expect(record.note).toBeNull();
  });

  it('redacts the longest match, so one secret inside another goes whole', () => {
    expect(redactSecrets('take abcdef here', ['abc', 'abcdef'])).toBe('take •••••••• here');
    expect(redactSecrets('nothing to do', [])).toBe('nothing to do');
    // An empty "secret" would otherwise match between every character.
    expect(redactSecrets('abc', [''])).toBe('abc');
  });
});

describe('running a flow', () => {
  const base = {
    environments: [env(GLOBAL_ID, 'Global', { host: 'api.test', token: 'the stale one' })],
    secrets: [secret('password', 'hunter2')],
    activeId: null,
  };

  const authStep = step({
    id: 'auth',
    name: 'Authenticate',
    request: request({ method: 'POST', url: 'https://{{host}}/auth' }),
    outputs: [rule({ path: 'token', name: 'token' })],
  });
  const useStep = step({
    id: 'use',
    name: 'Use it',
    request: request({
      url: 'https://{{host}}/me',
      headers: [{ name: 'Authorization', value: 'Bearer {{token}}', enabled: true }],
    }),
  });

  /** The TODO's example, end to end, with no network involved. */
  it('carries an extracted value into the next step', async () => {
    const sent: string[] = [];
    const run = await runFlow({
      steps: [authStep, useStep],
      requestFor: (s) => s.request,
      base,
      now: () => '2026-08-31T00:00:00.000Z',
      send: async (req) => {
        sent.push(`${req.method} ${req.url} | ${req.headers.map((h) => h.value).join(',')}`);
        return {
          ok: true,
          response: jsonResponse('{"token":"t-fresh"}'),
        } satisfies SendResult;
      },
    });

    expect(run.ok).toBe(true);
    expect(run.records).toHaveLength(2);
    expect(run.records[0]!.extracted).toEqual([
      { name: 'token', value: 't-fresh', from: 'body token', saved: false },
    ]);
    // The second request carried the FRESH token, not the stale environment one.
    expect(sent[1]).toContain('Bearer t-fresh');
    expect(sent[1]).not.toContain('the stale one');
    expect(run.values).toEqual({ token: 't-fresh' });
  });

  /** The step scope is ahead of the environment, which is the point of it. */
  it('lets a step value shadow an environment one', () => {
    const chain = chainForStep(base, { token: 'from the run' });
    expect(chain.scopes[0]!.name).toBe(STEP_SCOPE);
    expect(chain.scopes[0]!.values).toEqual({ token: 'from the run' });
  });

  it('halts at the first failure, with the reason in place', async () => {
    const run = await runFlow({
      steps: [authStep, useStep],
      requestFor: (s) => s.request,
      base,
      send: async () => ({
        ok: false,
        ms: 3,
        failure: { kind: 'cors', title: 'Most likely CORS', detail: 'nope', guess: true },
      }),
    });
    expect(run.ok).toBe(false);
    // The second step never ran: no record was even started for it.
    expect(run.records).toHaveLength(1);
    expect(run.records[0]!.failure?.title).toBe('Most likely CORS');
  });

  it('halts when a step points at a request that is not there', async () => {
    const run = await runFlow({
      steps: [step({ request: null, request_id: 'gone' })],
      requestFor: () => null,
      base,
      send: async () => ({ ok: true, response: jsonResponse('{}') }),
    });
    expect(run.ok).toBe(false);
    expect(run.records[0]!.failure?.title).toContain('no request');
  });

  it('halts on an unresolved variable before anything is sent', async () => {
    const send = vi.fn();
    const run = await runFlow({
      steps: [step({ request: request({ url: 'https://{{nowhere}}/x' }) })],
      requestFor: (s) => s.request,
      base,
      send: send as never,
    });
    expect(send).not.toHaveBeenCalled();
    expect(run.ok).toBe(false);
    expect(run.records[0]!.failure?.detail).toContain('nowhere');
  });

  /**
   * A rule that finds nothing is a problem on the record, not a halt: the
   * next step's unresolved `{{name}}` stops the run with a better message,
   * and this record is sitting right above it saying which rule came up dry.
   */
  it('notes a rule that found nothing without stopping there', async () => {
    const run = await runFlow({
      steps: [
        step({ id: 'a', outputs: [rule({ path: 'nope', name: 'nope' })] }),
        step({ id: 'b', request: request({ url: 'https://api.test/ok' }) }),
      ],
      requestFor: (s) => s.request,
      base,
      send: async () => ({ ok: true, response: jsonResponse('{"token":"t"}') }),
    });
    expect(run.ok).toBe(true);
    expect(run.records[0]!.problems[0]).toContain('nope');
    expect(run.records).toHaveLength(2);
  });

  it('records the response, capped, and never the real secret', async () => {
    const run = await runFlow({
      steps: [
        step({
          request: request({
            url: 'https://{{host}}/x',
            headers: [{ name: 'X-Key', value: '{{password}}', enabled: true }],
          }),
        }),
      ],
      requestFor: (s) => s.request,
      base,
      send: async () => ({ ok: true, response: jsonResponse('{"ok":true}') }),
    });
    const record = run.records[0]!;
    expect(record.response?.status).toBe(200);
    expect(record.response?.body).toBe('{"ok":true}');
    expect(record.response?.truncated).toBe(false);
    expect(JSON.stringify(run)).not.toContain('hunter2');
  });

  /** The whole run, against a server that reflects everything it is given. */
  it('keeps a secret out of the record even when the server sends it back', async () => {
    const run = await runFlow({
      steps: [
        step({
          outputs: [rule({ source: 'header', path: 'x-echoed', name: 'echoed' })],
          request: request({
            url: 'https://{{host}}/echo',
            headers: [{ name: 'X-Key', value: '{{password}}', enabled: true }],
          }),
        }),
      ],
      requestFor: (s) => s.request,
      base,
      send: async () => ({
        ok: true,
        response: jsonResponse('{"you_sent":"hunter2"}', {
          headers: [
            ['content-type', 'application/json'],
            ['x-echoed', 'hunter2'],
          ],
        }),
      }),
    });

    // What gets written down: no trace of it, anywhere in the row.
    expect(
      JSON.stringify(forStorage(run)),
      'the secret survived into the stored record'
    ).not.toContain('hunter2');
    expect(run.records[0]!.response?.body).toContain('••••••••');
    expect(run.records[0]!.response?.redacted).toBe(true);
    expect(run.records[0]!.response?.headers).toContainEqual(['x-echoed', '••••••••']);
    expect(run.records[0]!.extracted[0]!.value).toBe('••••••••');

    // And what gets sent: the real thing. Redaction is about what is written
    // down, never about what the next step carries — which is exactly why the
    // scope that holds it is the one thing `forStorage` refuses to keep.
    expect(run.values.echoed).toBe('hunter2');
  });

  it('never stores the step scope, whatever is in it', () => {
    const stored = forStorage({
      at: 'now',
      ok: true,
      records: [],
      values: { token: 'live-credential' },
    });
    expect(JSON.stringify(stored)).not.toContain('live-credential');
    expect('values' in stored).toBe(false);
  });

  /**
   * Dropping the map is the easy half. The same token is also sitting inside
   * the records — in the header the next step sent, and in the body of the
   * response that issued it — and three copies in a shape nobody looks at is
   * worse than one in a field that is obviously sensitive.
   */
  it('redacts a run’s own extracted values out of the stored records', async () => {
    const run = await runFlow({
      steps: [
        step({
          id: 'auth',
          outputs: [rule({ path: 'token', name: 'token' })],
          request: request({ url: 'https://{{host}}/auth', method: 'POST' }),
        }),
        step({
          id: 'use',
          request: request({
            url: 'https://{{host}}/me',
            headers: [{ name: 'Authorization', value: 'Bearer {{token}}', enabled: true }],
          }),
        }),
      ],
      requestFor: (s) => s.request,
      base,
      send: async () => ({ ok: true, response: jsonResponse('{"token":"live-token-xyz"}') }),
    });

    // Live: everything, because nothing has been written down yet.
    expect(run.records[1]!.sent?.headers).toContainEqual([
      'Authorization',
      'Bearer live-token-xyz',
    ]);
    expect(run.records[0]!.extracted[0]!.value).toBe('live-token-xyz');

    // Stored: nowhere — not the header, not the issuing response's body.
    const stored = forStorage(run);
    expect(JSON.stringify(stored), 'a live token reached the stored row').not.toContain(
      'live-token-xyz'
    );
    expect(stored.records[1]!.sent?.headers).toContainEqual(['Authorization', 'Bearer ••••••••']);
    expect(stored.records[0]!.response?.body).toContain('••••••••');
  });

  it('leaves the records alone when a run extracted nothing', async () => {
    const run = await runFlow({
      steps: [step({ request: request({ url: 'https://{{host}}/x' }) })],
      requestFor: (s) => s.request,
      base,
      send: async () => ({ ok: true, response: jsonResponse('{"plain":"body"}') }),
    });
    expect(forStorage(run).records[0]!.response?.body).toBe('{"plain":"body"}');
  });

  it('reports progress as it goes rather than only at the end', async () => {
    const seen: number[] = [];
    await runFlow({
      steps: [step({ id: 'a' }), step({ id: 'b' })],
      requestFor: (s) => s.request,
      base,
      onProgress: (records) => seen.push(records.length),
      send: async () => ({ ok: true, response: jsonResponse('{}') }),
    });
    expect(seen).toEqual([1, 2]);
  });

  it('keeps a binary response out of the record', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const run = await runFlow({
      steps: [step()],
      requestFor: (s) => s.request,
      base,
      send: async () => ({
        ok: true,
        response: response({ bytes: png, sniffedMime: 'image/png', contentType: 'image/png' }),
      }),
    });
    expect(run.records[0]!.response?.body).toBeNull();
    expect(run.records[0]!.response?.note).toContain('image/png');
  });
});

describe('a flow read back from a store', () => {
  it('survives anything the columns might hold', () => {
    expect(normalizeSteps('nope')).toEqual([]);
    expect(normalizeSteps([1, 'two', null])).toEqual([]);
    expect(normalizeSteps([{}])).toMatchObject([{ id: 'step-0', name: 'Step 1', outputs: [] }]);
    expect(normalizeSteps([{ outputs: [{ source: 'exotic' }] }])[0]!.outputs[0]!.source).toBe('body');
    expect(normalizeRun(['not', 'a', 'run'])).toBeNull();
    expect(normalizeRun({ records: 'nope' })).toBeNull();
    expect(normalizeRun({ records: [], ok: true, at: 'x' })).toMatchObject({ ok: true, values: {} });
  });

  it('offers the auth-then-GET example on an empty flow', () => {
    let n = 0;
    const steps = starterSteps(() => `id-${n++}`);
    expect(steps.map((s) => s.name)).toEqual(['Authenticate', 'Use the token']);
    expect(steps[0]!.outputs[0]).toMatchObject({ source: 'body', path: 'token', name: 'token' });
  });
});
