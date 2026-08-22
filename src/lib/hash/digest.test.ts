import { createHash, webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { md5 } from './md5';
import { sha224, sha256 } from './sha2';
import { sha3_224, sha3_256, sha3_384, sha3_512, shake128, shake256 } from './sha3';

const bytes = (text: string) => new TextEncoder().encode(text);
const hex = (out: Uint8Array) => [...out].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * These are the published vectors — RFC 1321 for MD5, FIPS 180-4 for SHA-2,
 * FIPS 202 for SHA-3 — and then every implementation is ALSO checked against
 * Node's OpenSSL for a set of inputs. The published constants catch a
 * mistyped implementation; the cross-check catches a mistyped constant.
 */
describe('md5', () => {
  it('matches the RFC 1321 test suite', () => {
    const table: [string, string][] = [
      ['', 'd41d8cd98f00b204e9800998ecf8427e'],
      ['a', '0cc175b9c0f1b6a831c399e269772661'],
      ['abc', '900150983cd24fb0d6963f7d28e17f72'],
      ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
      ['abcdefghijklmnopqrstuvwxyz', 'c3fcd3d76192e4007dfb496cca67e13b'],
      [
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
        'd174ab98d277d9f5a5611c2c9f419d9f',
      ],
      ['1234567890'.repeat(8), '57edf4a22be3c955ac49da2e2107b67a'],
    ];
    for (const [input, expected] of table) expect([input, hex(md5(bytes(input)))]).toEqual([input, expected]);
  });
});

describe('sha-2', () => {
  it('matches the FIPS 180-4 examples', () => {
    expect(hex(sha256(bytes('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
    expect(hex(sha256(bytes('')))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
    expect(hex(sha224(bytes('abc')))).toBe('23097d223405d8228642a477bda255b32aadbce4bda0b3f7e36c9da7');
    expect(hex(sha224(bytes('')))).toBe('d14a028c2a3a2bc9476102bb288234c415a2b01f828ea62ac5b3e42f');
  });

  it('handles the two-block message the standard uses to check padding', () => {
    const message = 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq';
    expect(hex(sha256(bytes(message)))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'
    );
  });

  it('agrees with WebCrypto, which is what the app uses for SHA-256', async () => {
    for (const input of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'a'.repeat(1000)]) {
      const platform = new Uint8Array(await webcrypto.subtle.digest('SHA-256', bytes(input)));
      expect([input, hex(sha256(bytes(input)))]).toEqual([input, hex(platform)]);
    }
  });
});

describe('sha-3', () => {
  it('matches the FIPS 202 examples for the empty message', () => {
    expect(hex(sha3_224(bytes('')))).toBe('6b4e03423667dbb73b6e15454f0eb1abd4597f9a1b078e3f5b5a6bc7');
    expect(hex(sha3_256(bytes('')))).toBe(
      'a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a'
    );
    expect(hex(sha3_384(bytes('')))).toBe(
      '0c63a75b845e4f7d01107d852e4c2485c51a50aaaa94fc61995e71bbee983a2ac3713831264adb47fb6bd1e058d5f004'
    );
    expect(hex(sha3_512(bytes('')))).toBe(
      'a69f73cca23a9ac5c8b567dc185a756e97c982164fe25859e0d1dcc1475c80a615b2123af1f5f94c11e3e9402c3ac558f500199d95b6d3e301758586281dcd26'
    );
  });

  it('matches the published digests of "abc"', () => {
    expect(hex(sha3_224(bytes('abc')))).toBe('e642824c3f8cf24ad09234ee7d3c766fc9a3a5168d0c94ad73b46fdf');
    expect(hex(sha3_256(bytes('abc')))).toBe(
      '3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532'
    );
  });

  it('agrees with OpenSSL across the block boundaries', () => {
    const sizes = [0, 1, 71, 72, 73, 135, 136, 137, 143, 144, 200, 1000];
    for (const size of sizes) {
      const input = 'x'.repeat(size);
      for (const [name, fn] of [
        ['sha3-224', sha3_224],
        ['sha3-256', sha3_256],
        ['sha3-384', sha3_384],
        ['sha3-512', sha3_512],
      ] as const) {
        const expected = createHash(name).update(input).digest('hex');
        expect([name, size, hex(fn(bytes(input)))]).toEqual([name, size, expected]);
      }
    }
  });

  it('squeezes as many bytes as SHAKE is asked for', () => {
    expect(hex(shake128(bytes(''), 32))).toBe(
      createHash('shake128', { outputLength: 32 }).update('').digest('hex')
    );
    expect(hex(shake256(bytes('abc'), 64))).toBe(
      createHash('shake256', { outputLength: 64 }).update('abc').digest('hex')
    );
    // Longer than one squeeze block, which is where a sponge goes wrong.
    expect(hex(shake128(bytes('abc'), 500))).toBe(
      createHash('shake128', { outputLength: 500 }).update('abc').digest('hex')
    );
  });

  it('is fast enough for typed text, which is all it is for', () => {
    const input = bytes('x'.repeat(10_000));
    const started = performance.now();
    sha3_256(input);
    // Generous: this is a bigint implementation and the point is that it is
    // not accidentally quadratic, not that it is competitive with wasm.
    expect(performance.now() - started).toBeLessThan(500);
  });
});
