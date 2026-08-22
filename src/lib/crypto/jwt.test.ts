import { describe, expect, it } from 'vitest';
import { encodeText } from '../encode/base64';
import { toPem } from './rsa';
import {
  ALGORITHMS,
  claims,
  decode,
  describeTime,
  type JwtAlgorithm,
  JwtError,
  pretty,
  sign,
  supported,
  validity,
  verify,
} from './jwt';

/** The example token from the JWT specification's own tooling. */
const HS256_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' +
  '.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ' +
  '.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
const HS256_SECRET = 'your-256-bit-secret';

/** Generate a key pair for `algorithm` and return it as PEM. */
async function pemPair(algorithm: JwtAlgorithm): Promise<{ publicPem: string; privatePem: string }> {
  const api = globalThis.crypto.subtle;
  const parameters: Record<string, unknown> =
    algorithm.startsWith('RS')
      ? {
          name: 'RSASSA-PKCS1-v1_5',
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: `SHA-${algorithm.slice(2)}`,
        }
      : algorithm.startsWith('PS')
        ? {
            name: 'RSA-PSS',
            modulusLength: 2048,
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: `SHA-${algorithm.slice(2)}`,
          }
        : algorithm.startsWith('ES')
          ? {
              name: 'ECDSA',
              namedCurve: algorithm === 'ES256' ? 'P-256' : algorithm === 'ES384' ? 'P-384' : 'P-521',
            }
          : { name: 'Ed25519' };
  const pair = (await api.generateKey(parameters as unknown as AlgorithmIdentifier, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  return {
    publicPem: toPem('PUBLIC KEY', new Uint8Array(await api.exportKey('spki', pair.publicKey))),
    privatePem: toPem('PRIVATE KEY', new Uint8Array(await api.exportKey('pkcs8', pair.privateKey))),
  };
}

describe('decode', () => {
  it('splits a token without touching a key', () => {
    const decoded = decode(HS256_TOKEN);
    expect(decoded.header).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(decoded.payload).toEqual({ sub: '1234567890', name: 'John Doe', iat: 1516239022 });
    expect(decoded.algorithm).toBe('HS256');
    expect(decoded.signature).toHaveLength(32);
    expect(decoded.signingInput).toBe(HS256_TOKEN.split('.').slice(0, 2).join('.'));
  });

  it('says what is wrong rather than throwing something generic', () => {
    expect(() => decode('one.two')).toThrow(JwtError);
    expect(() => decode('one.two')).toThrow('three dot-separated parts');
    expect(() => decode('a.b.c.d.e')).toThrow('JWE');
    expect(() => decode('bm90LWpzb24.bm90LWpzb24.')).toThrow('not base64url-encoded JSON');
  });

  it('reads a token with no signature at all', () => {
    const header = encodeText(JSON.stringify({ alg: 'none' }), { url: true });
    const payload = encodeText(JSON.stringify({ sub: 'x' }), { url: true });
    const decoded = decode(`${header}.${payload}.`);
    expect(decoded.signature).toHaveLength(0);
    expect(decoded.algorithm).toBe('none');
  });
});

describe('claims', () => {
  it('puts the registered claims first, with the times spelled out', () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    const rows = claims({ name: 'Ada', sub: 'user-1', exp: Math.floor(now / 1000) + 3600 }, now);
    expect(rows.map((row) => row.name)).toEqual(['sub', 'exp', 'name']);
    expect(rows[1]!.detail).toContain('in 1 hour');
    expect(rows[2]!.detail).toBeUndefined();
  });

  it('renders a timestamp as a date and an age', () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    expect(describeTime(Math.floor(now / 1000) - 7200, now)).toContain('2 hours ago');
    expect(describeTime(Math.floor(now / 1000) + 86400 * 3, now)).toContain('in 3 days');
    expect(describeTime(Math.floor(now / 1000), now)).toContain('2026-01-01 12:00:00 UTC');
  });
});

describe('validity', () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);
  const seconds = Math.floor(now / 1000);

  it('reports expiry, earliness and the absence of an expiry', () => {
    expect(validity({ exp: seconds - 60 }, now).expired).toBe(true);
    expect(validity({ exp: seconds + 60 }, now).expired).toBe(false);
    expect(validity({ nbf: seconds + 60 }, now).notYetValid).toBe(true);
    const forever = validity({ sub: 'x' }, now);
    expect(forever.neverExpires).toBe(true);
    expect(forever.summary).toContain('does not expire');
  });
});

describe('verify', () => {
  it('accepts the specification example with its own secret', async () => {
    expect(await verify(HS256_TOKEN, { secret: HS256_SECRET })).toEqual({ valid: true });
  });

  it('rejects the wrong secret, and says why', async () => {
    const result = await verify(HS256_TOKEN, { secret: 'not-the-secret' });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('does not match');
  });

  it('rejects a tampered payload even though it decodes cleanly', async () => {
    const decoded = decode(HS256_TOKEN);
    const tampered = `${decoded.parts.header}.${encodeText(
      JSON.stringify({ ...decoded.payload, name: 'Mallory' }),
      { url: true }
    )}.${decoded.parts.signature}`;
    expect(decode(tampered).payload.name).toBe('Mallory');
    expect((await verify(tampered, { secret: HS256_SECRET })).valid).toBe(false);
  });

  it('refuses alg: none by name', async () => {
    const header = encodeText(JSON.stringify({ alg: 'none', typ: 'JWT' }), { url: true });
    const payload = encodeText(JSON.stringify({ admin: true }), { url: true });
    const result = await verify(`${header}.${payload}.`, { secret: 'anything' });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('alg: none');
  });

  it('refuses the algorithm-confusion shape', async () => {
    const { publicPem } = await pemPair('RS256');
    await expect(verify(HS256_TOKEN, { pem: publicPem })).rejects.toThrow('algorithm-confusion');
  }, 30_000);

  it('refuses to verify with a private key', async () => {
    const { privatePem } = await pemPair('RS256');
    const token = await sign({ sub: 'x' }, { privatePem } as never, 'RS256').catch(() => null);
    void token;
    await expect(
      verify(
        `${encodeText(JSON.stringify({ alg: 'RS256' }), { url: true })}.${encodeText(
          JSON.stringify({ sub: 'x' }),
          { url: true }
        )}.AA`,
        { pem: privatePem }
      )
    ).rejects.toThrow('PUBLIC key');
  }, 30_000);
});

describe('sign', () => {
  it('round-trips HMAC', async () => {
    const token = await sign({ sub: 'alice', iat: 1 }, { secret: 'shh' }, 'HS512');
    expect(decode(token).header).toEqual({ alg: 'HS512', typ: 'JWT' });
    expect(await verify(token, { secret: 'shh' })).toEqual({ valid: true });
    expect((await verify(token, { secret: 'shh!' })).valid).toBe(false);
  });

  it('round-trips every asymmetric algorithm the runtime supports', async () => {
    for (const def of ALGORITHMS.filter((entry) => !entry.symmetric)) {
      if (def.family === 'EdDSA' && !(await supported('EdDSA'))) continue;
      const { publicPem, privatePem } = await pemPair(def.id);
      const token = await sign({ sub: def.id }, { pem: privatePem }, def.id);
      expect([def.id, await verify(token, { pem: publicPem })]).toEqual([def.id, { valid: true }]);
    }
  }, 120_000);

  it('puts the algorithm in the header and keeps extra header fields', async () => {
    const token = await sign({ sub: 'x' }, { secret: 's' }, 'HS256', { kid: 'key-1' });
    expect(decode(token).header).toEqual({ alg: 'HS256', typ: 'JWT', kid: 'key-1' });
  });
});

describe('pretty', () => {
  it('formats for the editor panes', () => {
    expect(pretty({ a: 1 })).toBe('{\n  "a": 1\n}');
  });
});
