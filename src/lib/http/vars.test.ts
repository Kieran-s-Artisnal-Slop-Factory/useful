/**
 * Phase 4 — the scope chain, resolution, and the masking that keeps a secret
 * out of every preview.
 *
 * These are the tests that matter most in the release: the lookup order is
 * the feature, and masking-before-display is a promise rather than a nicety.
 */
import { describe, expect, it } from 'vitest';
import {
  availableNames,
  buildChain,
  environmentFilename,
  exportEnvironment,
  globalOf,
  GLOBAL_ID,
  normalizeEnvironment,
  secretScopeName,
  selectableEnvironments,
} from './env';
import { MASK, secretHint, secretValues, type HttpSecret } from './secrets';
import {
  maskedRequest,
  maskedText,
  requiredNames,
  resolveRequest,
  unknownNames,
} from './resolve';
import { blankRequest, normalizeRequest, type HttpRequest } from './model';
import type { HttpEnvironment } from '../db/types';

const env = (id: string, name: string, values: unknown): HttpEnvironment =>
  ({ id, name, values, updated_at: '2026-01-01T00:00:00.000Z', deleted_at: null, server_seq: null }) as HttpEnvironment;

const secret = (name: string, value: string, environment_id: string | null): HttpSecret => ({
  id: `s-${name}-${environment_id ?? 'global'}`,
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

describe('environments read back from a store', () => {
  /** The generic data suite writes an ARRAY into every json column. */
  it('re-shapes anything that is not a name → value map', () => {
    expect(normalizeEnvironment(env('a', 'Staging', ['a', 'b'])).values).toEqual({});
    expect(normalizeEnvironment(env('a', 'Staging', null)).values).toEqual({});
    expect(normalizeEnvironment(env('a', 'Staging', 'nope')).values).toEqual({});
    expect(normalizeEnvironment(env('a', '', {})).name).toBe('Untitled');
    expect(normalizeEnvironment(env('a', 'Staging', { x: 1 })).values).toEqual({ x: 1 });
  });

  it('stands in for a Global that nobody has written yet', () => {
    expect(globalOf([])).toEqual({ id: GLOBAL_ID, name: 'Global', values: {} });
    expect(globalOf([env(GLOBAL_ID, 'Global', { a: 1 })]).values).toEqual({ a: 1 });
  });

  it('keeps Global out of the picker, and sorts the rest', () => {
    const list = selectableEnvironments([
      env(GLOBAL_ID, 'Global', {}),
      env('b', 'Staging', {}),
      env('a', 'Production', {}),
    ]);
    expect(list.map((item) => item.name)).toEqual(['Production', 'Staging']);
  });
});

describe('the scope chain', () => {
  const environments = [
    env(GLOBAL_ID, 'Global', { base_url: 'https://global.test', shared: 'from global' }),
    env('e1', 'Staging', { base_url: 'https://staging.test' }),
  ];
  const secrets = [secret('token', 'global-token', null), secret('token', 'staging-token', 'e1')];

  /** The order the plan fixes: step → active environment → Global. */
  it('resolves in step, active environment, Global order', () => {
    const chain = buildChain({
      environments,
      secrets,
      activeId: 'e1',
      step: { base_url: 'https://from-step.test' },
      stepName: 'earlier steps',
    });
    expect(chain.scopes.map((scope) => scope.name)).toEqual([
      'earlier steps',
      'Staging · secrets',
      'Staging',
      'Global · secrets',
      'Global',
    ]);

    const resolved = resolveRequest(request({ url: '{{base_url}}/x' }), chain);
    expect(resolved.ok).toBe(true);
    expect(resolved.request?.url).toBe('https://from-step.test/x');
    expect(resolved.resolutions[0]!.scope).toBe('earlier steps');
  });

  it('lets the active environment shadow Global', () => {
    const chain = buildChain({ environments, secrets, activeId: 'e1' });
    const resolved = resolveRequest(request({ url: '{{base_url}}/x' }), chain);
    expect(resolved.request?.url).toBe('https://staging.test/x');
    // And a name only Global has still resolves — the chain does not stop.
    expect(resolveRequest(request({ url: 'https://x.test/{{shared}}' }), chain).request?.url).toBe(
      'https://x.test/from global'
    );
  });

  it('falls back to Global alone when no environment is active', () => {
    const chain = buildChain({ environments, secrets, activeId: null });
    expect(chain.scopes.map((scope) => scope.name)).toEqual(['Global · secrets', 'Global']);
    expect(resolveRequest(request({ url: '{{base_url}}/x' }), chain).request?.url).toBe(
      'https://global.test/x'
    );
  });

  /** A secret is the more deliberate thing to have created; it wins its level. */
  it('puts a secret ahead of a variable of the same name at the same level', () => {
    const shadowed = [
      env(GLOBAL_ID, 'Global', {}),
      env('e1', 'Staging', { token: 'the plain variable' }),
    ];
    const chain = buildChain({ environments: shadowed, secrets, activeId: 'e1' });
    const resolved = resolveRequest(request({ url: 'https://x.test/{{token}}' }), chain);
    expect(resolved.request?.url).toBe('https://x.test/staging-token');
    expect(resolved.resolutions[0]!.secret).toBe(true);
  });

  it('lists the names it can supply, in lookup order', () => {
    const chain = buildChain({ environments, secrets, activeId: 'e1' });
    expect(availableNames(chain)).toEqual(['token', 'base_url', 'shared']);
  });
});

describe('resolving a request', () => {
  const chain = buildChain({
    environments: [env(GLOBAL_ID, 'Global', { host: 'api.test', page: 2 })],
    secrets: [secret('key', 'sk-live-abcdef123456', null)],
    activeId: null,
  });

  it('templates the URL, header values, body and field values', () => {
    const resolved = resolveRequest(
      request({
        url: 'https://{{host}}/things?page={{page}}',
        headers: [{ name: 'Authorization', value: 'Bearer {{key}}', enabled: true }],
        bodyKind: 'json',
        bodyText: '{"host":"{{host}}"}',
        fields: [{ name: 'q', value: '{{host}}', enabled: true }],
      }),
      chain
    );
    expect(resolved.ok).toBe(true);
    expect(resolved.request?.url).toBe('https://api.test/things?page=2');
    expect(resolved.request?.headers[0]!.value).toBe('Bearer sk-live-abcdef123456');
    expect(resolved.request?.bodyText).toBe('{"host":"api.test"}');
    expect(resolved.request?.fields[0]!.value).toBe('api.test');
  });

  /** Decision 2, and the bug the whole feature exists to prevent. */
  it('refuses to send rather than substituting an empty string', () => {
    const resolved = resolveRequest(
      request({ headers: [{ name: 'Authorization', value: 'Bearer {{token}}', enabled: true }] }),
      chain
    );
    expect(resolved.ok).toBe(false);
    expect(resolved.request).toBeNull();
    expect(resolved.problems).toHaveLength(1);
    expect(resolved.problems[0]!.code).toBe('unresolved');
    expect(resolved.problems[0]!.name).toBe('token');
    expect(resolved.problems[0]!.field.label).toBe('Header “Authorization”');
  });

  it('reports every problem at once, not one per attempt', () => {
    const resolved = resolveRequest(
      request({ url: 'https://{{a}}/x', bodyText: '{{b}} {{c}}' }),
      chain
    );
    expect(resolved.problems.map((problem) => problem.name)).toEqual(['a', 'b', 'c']);
  });

  it('leaves a disabled row alone entirely', () => {
    const resolved = resolveRequest(
      request({ headers: [{ name: 'X', value: '{{nope}}', enabled: false }] }),
      chain
    );
    expect(resolved.ok).toBe(true);
    expect(resolved.request?.headers[0]!.value).toBe('{{nope}}');
  });

  /** The saved row is a template; only the copy that goes on the wire is not. */
  it('never mutates the request it was given', () => {
    const original = request({ url: 'https://{{host}}/x' });
    resolveRequest(original, chain);
    expect(original.url).toBe('https://{{host}}/x');
  });

  it('lists only the names nothing supplies, by their root', () => {
    const target = request({
      url: '{{host}}/{{missing_one}}',
      headers: [{ name: 'A', value: '{{missing_two}}', enabled: true }],
      // Two paths off one root want ONE entry, not two.
      bodyText: '{{deep.a}} {{deep.b}} {{page}}',
    });
    expect(unknownNames(target, chain)).toEqual(['missing_one', 'missing_two', 'deep']);
    // Nothing to add once they exist.
    const filled = buildChain({
      environments: [
        env(GLOBAL_ID, 'Global', { host: 'h', page: 1, missing_one: '', missing_two: '', deep: {} }),
      ],
      secrets: [],
      activeId: null,
    });
    expect(unknownNames(target, filled)).toEqual([]);
  });

  /** A secret counts as supplying the name — it must not be offered again. */
  it('does not offer to create a name a secret already covers', () => {
    expect(unknownNames(request({ url: 'https://x.test/{{key}}' }), chain)).toEqual([]);
  });

  it('names what a request needs before any environment exists', () => {
    expect(
      requiredNames(
        request({
          url: '{{base}}/x',
          headers: [{ name: 'A', value: '{{token}}', enabled: true }],
          bodyText: '{{base}}',
        })
      )
    ).toEqual(['base', 'token']);
  });
});

describe('masking', () => {
  const chain = buildChain({
    environments: [env(GLOBAL_ID, 'Global', { host: 'api.test' })],
    secrets: [secret('key', 'sk-live-abcdef123456', null)],
    activeId: null,
  });

  it('shows variables and hides secrets in the same string', () => {
    expect(maskedText('https://{{host}}/x?k={{key}}', chain)).toBe(`https://api.test/x?k=${MASK}`);
  });

  /**
   * A search-and-replace over the finished text would blank every other
   * occurrence of those characters too. This is why masking re-renders.
   */
  it('masks the placeholder, not every occurrence of the value', () => {
    const literal = buildChain({
      environments: [env(GLOBAL_ID, 'Global', {})],
      secrets: [secret('key', 'test', null)],
      activeId: null,
    });
    expect(maskedText('the latest {{key}} for api.test', literal)).toBe(
      `the latest ${MASK} for api.test`
    );
  });

  it('masks a secret everywhere it appears in a request', () => {
    const shown = maskedRequest(
      request({
        url: 'https://{{host}}/x',
        headers: [{ name: 'Authorization', value: 'Bearer {{key}}', enabled: true }],
        bodyText: '{"k":"{{key}}"}',
      }),
      chain
    );
    expect(shown.url).toBe('https://api.test/x');
    expect(shown.headers[0]!.value).toBe(`Bearer ${MASK}`);
    expect(shown.bodyText).toBe(`{"k":"${MASK}"}`);
    expect(JSON.stringify(shown)).not.toContain('sk-live');
  });

  it('leaves an unresolved placeholder visible rather than masking it away', () => {
    expect(maskedText('{{missing}} and {{host}}', chain)).toBe('{{missing}} and api.test');
  });

  /** A mask that tracked the length would leak how long the key is. */
  it('does not encode the length of what it hides', () => {
    expect(MASK).not.toContain('a');
    expect(secretHint('short')).toBe(`${MASK}hort`);
    expect(secretHint('abc')).toBe(MASK);
  });

  it('picks values out by scope', () => {
    const rows = [secret('a', '1', null), secret('b', '2', 'e1')];
    expect(secretValues(rows, null)).toEqual({ a: '1' });
    expect(secretValues(rows, 'e1')).toEqual({ b: '2' });
  });

  it('names the secret scope after its environment', () => {
    expect(secretScopeName('Staging')).toBe('Staging · secrets');
  });
});

describe('exporting an environment', () => {
  const secrets = [secret('api_key', 'sk-live-abcdef', null), secret('other', 'x', 'e1')];

  /** The whole point of the dedicated export. */
  it('lists secret names and no secret values, and says which it did', () => {
    const file = exportEnvironment(
      { name: 'Global', values: { base_url: 'https://api.test' } },
      secrets,
      null
    );
    expect(file.values).toEqual({ base_url: 'https://api.test' });
    expect(file.secret_names).toEqual(['api_key']);
    expect(file.note).toContain('deliberately not in this file');
    expect(JSON.stringify(file)).not.toContain('sk-live-abcdef');
  });

  it('still says so when there were none to omit', () => {
    const file = exportEnvironment({ name: 'Staging', values: {} }, [], 'e2');
    expect(file.secret_names).toEqual([]);
    expect(file.note).toContain('none to omit');
  });

  it('makes a filename out of a name', () => {
    expect(environmentFilename('Staging API')).toBe('staging-api.http-environment.json');
    expect(environmentFilename('  ')).toBe('environment.http-environment.json');
    expect(environmentFilename('!!!')).toBe('environment.http-environment.json');
  });
});

describe('a request read back from a store', () => {
  it('survives anything the column might actually hold', () => {
    expect(normalizeRequest(['not', 'a', 'request']).method).toBe('GET');
    expect(normalizeRequest(null).headers).toEqual([{ name: 'Accept', value: 'application/json', enabled: true }]);
    expect(normalizeRequest({ method: 'TRACE' }).method).toBe('GET');
    expect(normalizeRequest({ bodyKind: 'exotic' }).bodyKind).toBe('none');
    expect(normalizeRequest({ headers: 'nope' }).headers).toEqual([]);
    expect(normalizeRequest({ headers: [{ name: 'A' }] })).toMatchObject({
      headers: [{ name: 'A', value: '', enabled: true }],
    });
  });

  it('round-trips a real one unchanged', () => {
    const original = request({
      method: 'POST',
      url: 'https://x.test',
      headers: [{ name: 'A', value: 'b', enabled: false }],
      bodyKind: 'json',
      bodyText: '{}',
      fields: [{ name: 'f', value: 'v', enabled: true }],
    });
    expect(normalizeRequest(JSON.parse(JSON.stringify(original)))).toEqual(original);
  });
});
