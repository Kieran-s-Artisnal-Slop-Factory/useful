import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ITERATIONS,
  decryptWithPassword,
  encryptWithPassword,
  formatBundle,
  parseBundle,
} from './aes';
import {
  CURVES,
  DEMO_GENERATOR,
  DEMO_PRIME,
  demonstrate,
  deriveShared,
  makeParty,
  modPow,
  runExchange,
  supportsX25519,
} from './exchange';
import * as otp from './otp';
import { encrypt as rsaEncrypt, decrypt as rsaDecrypt, fromPem, generatePair, maxPlaintextBytes, toPem } from './rsa';

/** The tests use a small iteration count: PBKDF2 at 600 000 is the point in
 * production and pure waiting in a test. The value under test is the format
 * and the round trip, not the cost. */
const FAST = { iterations: 10_000 };

describe('aes-gcm with a password', () => {
  it('round-trips text', async () => {
    const bundle = await encryptWithPassword('the treasure is buried under the oak', 'hunter2', FAST);
    expect(await decryptWithPassword(bundle, 'hunter2')).toBe('the treasure is buried under the oak');
  });

  it('produces a different ciphertext every time, from the same input', async () => {
    const one = await encryptWithPassword('same', 'password', FAST);
    const two = await encryptWithPassword('same', 'password', FAST);
    expect(one).not.toBe(two);
    // ...because the salt and the IV are fresh, not because the key changed.
    expect(parseBundle(one)!.salt).not.toEqual(parseBundle(two)!.salt);
    expect(parseBundle(one)!.iv).not.toEqual(parseBundle(two)!.iv);
    expect(await decryptWithPassword(two, 'password')).toBe('same');
  });

  it('fails the wrong password as an authentication failure', async () => {
    const bundle = await encryptWithPassword('secret', 'right', FAST);
    await expect(decryptWithPassword(bundle, 'wrong')).rejects.toThrow('did not decrypt');
  });

  it('refuses a bundle that has been altered — that is what GCM is for', async () => {
    const bundle = await encryptWithPassword('secret', 'password', FAST);
    const parsed = parseBundle(bundle)!;
    parsed.data[0] = parsed.data[0]! ^ 0x01;
    await expect(decryptWithPassword(formatBundle(parsed), 'password')).rejects.toThrow('altered');
  });

  it('carries its own parameters, and reads them back', async () => {
    const bundle = await encryptWithPassword('x', 'y', { iterations: 12_345 });
    expect(bundle.startsWith('useful.aes256gcm.pbkdf2-sha256.12345.')).toBe(true);
    const parsed = parseBundle(bundle)!;
    expect(parsed.iterations).toBe(12_345);
    expect(parsed.salt).toHaveLength(16);
    expect(parsed.iv).toHaveLength(12);
    expect(await decryptWithPassword(bundle, 'y')).toBe('x');
  });

  it('defaults to the iteration count the guidance asks for', () => {
    expect(DEFAULT_ITERATIONS).toBe(600_000);
  });

  it('says plainly when a string is not one of its bundles', async () => {
    expect(parseBundle('hello')).toBeNull();
    expect(parseBundle('useful.aes256gcm.pbkdf2-sha256.abc.a.b.c')).toBeNull();
    await expect(decryptWithPassword('nonsense', 'password')).rejects.toThrow('not one of');
  });

  it('refuses to encrypt with no password at all', async () => {
    await expect(encryptWithPassword('x', '')).rejects.toThrow('password is required');
  });
});

describe('rsa-oaep', () => {
  it('generates a pair, exports it, and round-trips a short message', async () => {
    const pair = await generatePair(2048);
    expect(pair.publicPem.startsWith('-----BEGIN PUBLIC KEY-----')).toBe(true);
    expect(pair.privatePem.startsWith('-----BEGIN PRIVATE KEY-----')).toBe(true);
    expect(JSON.parse(pair.publicJwk).kty).toBe('RSA');

    const encrypted = await rsaEncrypt(pair.publicPem, 'meet at nine');
    expect(await rsaDecrypt(pair.privatePem, encrypted)).toBe('meet at nine');
  }, 30_000);

  it('states the size limit in the refusal', async () => {
    expect(maxPlaintextBytes(2048)).toBe(190);
    expect(maxPlaintextBytes(4096)).toBe(446);
    const pair = await generatePair(2048);
    await expect(rsaEncrypt(pair.publicPem, 'x'.repeat(200))).rejects.toThrow('at most 190 bytes');
    await expect(rsaEncrypt(pair.publicPem, 'x'.repeat(200))).rejects.toThrow('hybrid encryption');
  }, 30_000);

  it('round-trips PEM wrapping', () => {
    const der = Uint8Array.from({ length: 200 }, (_, i) => i & 0xff);
    const pem = toPem('TEST KEY', der);
    expect(pem.split('\n')[1]).toHaveLength(64);
    expect([...fromPem(pem)]).toEqual([...der]);
    expect(() => fromPem('not a pem')).toThrow('not a PEM block');
  });
});

describe('key agreement', () => {
  it('has both sides arrive at the same secret, on every named curve', async () => {
    for (const curve of CURVES) {
      if (curve === 'X25519' && !(await supportsX25519())) continue;
      const result = await runExchange(curve);
      expect([curve, result.match]).toEqual([curve, true]);
      expect(result.sharedFromAlice.length).toBeGreaterThan(0);
      // The public halves are what would travel; they are not the secret.
      expect(result.alice.publicKey).not.toBe(result.bob.publicKey);
    }
  }, 30_000);

  it('gives different pairs different secrets', async () => {
    const alice = await makeParty('Alice', 'P-256');
    const bob = await makeParty('Bob', 'P-256');
    const eve = await makeParty('Eve', 'P-256');
    const right = await deriveShared('P-256', alice.keys.privateKey, bob.keys.publicKey);
    const wrong = await deriveShared('P-256', alice.keys.privateKey, eve.keys.publicKey);
    expect([...right]).not.toEqual([...wrong]);
  }, 30_000);

  it('the teaching version arrives at the same number from both sides', () => {
    const demo = demonstrate(DEMO_PRIME, DEMO_GENERATOR, 400n, 134n);
    expect(demo.match).toBe(true);
    expect(demo.secretFromA).toBe(demo.secretFromB);
    // The published worked example: p = 467, g = 2, a = 400, b = 134.
    expect(demo.publicA).toBe(modPow(2n, 400n, 467n));
    expect(demo.publicB).toBe(modPow(2n, 134n, 467n));
  });

  it('modPow is right where a naive implementation would overflow', () => {
    expect(modPow(2n, 10n, 1000n)).toBe(24n);
    expect(modPow(3n, 0n, 7n)).toBe(1n);
    expect(modPow(5n, 117n, 19n)).toBe(1n);
    expect(modPow(2n, 4096n, 1n)).toBe(0n);
    // 2^1000 exactly, mod a large prime — nowhere near a double's range.
    expect(modPow(2n, 1000n, 1000003n)).toBe((2n ** 1000n) % 1000003n);
  });
});

describe('one-time pad', () => {
  it('is its own inverse', () => {
    const { key, data } = otp.encrypt('attack at dawn');
    expect(otp.decrypt(data, key)).toBe('attack at dawn');
    expect([...otp.apply(otp.apply(data, key), key)]).toEqual([...data]);
  });

  it('makes a key exactly as long as the message', () => {
    const { key, data } = otp.encrypt('hello');
    expect(key).toHaveLength(5);
    expect(data).toHaveLength(5);
    expect(otp.generateKey(0)).toHaveLength(0);
  });

  it('refuses a short key rather than repeating it', () => {
    const data = new TextEncoder().encode('a longer message');
    expect(() => otp.apply(data, otp.generateKey(4))).toThrow('at least as long');
    expect(() => otp.apply(data, otp.generateKey(4))).toThrow('refuses rather than repeating');
  });

  it('hides the plaintext: the ciphertext looks nothing like it', () => {
    const { data } = otp.encrypt('aaaaaaaaaaaaaaaa');
    // Sixteen identical letters, and the ciphertext bytes are not identical.
    expect(new Set(data).size).toBeGreaterThan(1);
  });
});
