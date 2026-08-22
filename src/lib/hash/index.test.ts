import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  available,
  composeInput,
  digest,
  formats,
  hashById,
  HASHES,
  hmac,
  subtleAvailable,
} from './index';
import type { HashId } from './index';

const bytes = (text: string) => new TextEncoder().encode(text);
const hex = (out: Uint8Array) => [...out].map((b) => b.toString(16).padStart(2, '0')).join('');

/** This catalogue's ids next to OpenSSL's names for the same algorithms. */
const OPENSSL: [HashId, string][] = [
  ['md5', 'md5'],
  ['sha1', 'sha1'],
  ['sha224', 'sha224'],
  ['sha256', 'sha256'],
  ['sha384', 'sha384'],
  ['sha512', 'sha512'],
  ['sha3-224', 'sha3-224'],
  ['sha3-256', 'sha3-256'],
  ['sha3-384', 'sha3-384'],
  ['sha3-512', 'sha3-512'],
];

describe('the catalogue', () => {
  it('says where every implementation comes from', () => {
    expect(HASHES).toHaveLength(12);
    expect(hashById('sha256')?.source).toBe('platform');
    expect(hashById('sha224')?.source).toBe('app');
    expect(hashById('sha3-512')?.source).toBe('app');
    // The two that need a warning have one.
    expect(hashById('md5')?.warning).toContain('2004');
    expect(hashById('sha1')?.warning).toContain('2017');
  });

  it('knows what is available in this context', () => {
    expect(subtleAvailable()).toBe(true);
    for (const def of HASHES) expect([def.id, available(def.id)]).toEqual([def.id, true]);
  });

  it('carries the block size HMAC needs, per algorithm', () => {
    expect(hashById('sha256')?.blockSize).toBe(64);
    expect(hashById('sha512')?.blockSize).toBe(128);
    expect(hashById('sha3-256')?.blockSize).toBe(136);
    expect(hashById('sha3-512')?.blockSize).toBe(72);
  });
});

describe('digest', () => {
  it('agrees with OpenSSL for every algorithm in the catalogue', async () => {
    for (const [id, name] of OPENSSL) {
      for (const input of ['', 'abc', 'the quick brown fox', 'x'.repeat(500)]) {
        const expected = createHash(name).update(input).digest('hex');
        expect([id, input.length, hex(await digest(id, bytes(input)))]).toEqual([
          id,
          input.length,
          expected,
        ]);
      }
    }
  });

  it('gives SHAKE the length it was asked for', async () => {
    expect(await digest('shake128', bytes('abc'), 16)).toHaveLength(16);
    expect(await digest('shake256', bytes('abc'), 100)).toHaveLength(100);
    expect(hex(await digest('shake128', bytes('abc'), 16))).toBe(
      createHash('shake128', { outputLength: 16 }).update('abc').digest('hex')
    );
    // The defaults are the sizes the standard suggests.
    expect(await digest('shake128', bytes('abc'))).toHaveLength(32);
    expect(await digest('shake256', bytes('abc'))).toHaveLength(64);
  });

  it('handles non-ASCII input as UTF-8, the way a file would be', async () => {
    const text = 'café 👍🏽';
    expect(hex(await digest('sha256', bytes(text)))).toBe(
      createHash('sha256').update(text, 'utf8').digest('hex')
    );
  });
});

describe('hmac', () => {
  it('agrees with OpenSSL for every algorithm, on both code paths', async () => {
    // sha1/256/384/512 go through WebCrypto here; the rest through the
    // generic construction in this module.
    for (const [id, name] of OPENSSL) {
      const result = await hmac(id, bytes('key'), bytes('The quick brown fox jumps over the lazy dog'));
      expect([id, hex(result)]).toEqual([
        id,
        createHmac(name, 'key').update('The quick brown fox jumps over the lazy dog').digest('hex'),
      ]);
    }
  });

  it('matches the RFC 4231 case where the key is longer than the block', async () => {
    const key = new Uint8Array(200).fill(0xaa);
    for (const [id, name] of OPENSSL) {
      const result = await hmac(id, key, bytes('message'));
      expect([id, hex(result)]).toEqual([
        id,
        createHmac(name, Buffer.from(key)).update('message').digest('hex'),
      ]);
    }
  });

  it('refuses an HMAC of SHAKE by name', async () => {
    await expect(hmac('shake128', bytes('k'), bytes('m'))).rejects.toThrow('extendable-output');
  });
});

describe('composeInput', () => {
  it('states the order it used', () => {
    expect(composeInput({ message: 'secret' })).toEqual({
      bytes: bytes('secret'),
      formula: 'H(message)',
    });
    expect(composeInput({ message: 'secret', salt: 'NaCl' }).formula).toBe('H(salt ‖ message)');
    expect(composeInput({ message: 'secret', salt: 'NaCl', saltPosition: 'suffix' })).toEqual({
      bytes: bytes('secretNaCl'),
      formula: 'H(message ‖ salt)',
    });
    expect(composeInput({ message: 'm', salt: 's', pepper: 'p' })).toEqual({
      bytes: bytes('psm'),
      formula: 'H(pepper ‖ salt ‖ message)',
    });
  });

  it('ignores empty salt and pepper rather than hashing empty strings into the formula', () => {
    expect(composeInput({ message: 'm', salt: '', pepper: '' }).formula).toBe('H(message)');
  });
});

describe('formats', () => {
  it('gives every shape the output is asked for', async () => {
    const out = await digest('sha256', bytes('abc'));
    const shapes = formats(out);
    expect(shapes.hex).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(shapes.hexUpper).toBe(shapes.hex.toUpperCase());
    expect(shapes.base64).toBe(Buffer.from(out).toString('base64'));
    expect(shapes.base64url).toBe(Buffer.from(out).toString('base64url'));
    expect(shapes.grouped.startsWith('ba78 16bf 8f01')).toBe(true);
    expect(shapes.grouped.replace(/ /g, '')).toBe(shapes.hex);
  });
});
