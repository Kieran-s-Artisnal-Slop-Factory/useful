import { describe, expect, it } from 'vitest';
import wordlist from './wordlist.json';
import {
  ALL_CHARS,
  ALPHANUMERIC,
  BACKUP_CHARS,
  BASE32,
  DIGITS,
  DJANGO_CHARS,
  entropyBits,
  GROUPS,
  HEX,
  JWT_BYTES,
  objectId,
  passphrase,
  pick,
  pronounceable,
  randomBytes,
  randomInt,
  randomString,
  RECOVERY_CHARS,
  SECRETS,
  setWordList,
  toBase32,
  toBase64,
  toBase64Url,
  toHex,
  uuidV4,
  uuidV7,
  WIFI_CHARS,
  WORDPRESS_CHARS,
  wordListReady,
} from './secrets';

setWordList(wordlist.words);

const onlyFrom = (value: string, set: string): boolean => [...value].every((c) => set.includes(c));

describe('alphabets', () => {
  it('are the sizes the entropy figures are computed against', () => {
    expect(ALPHANUMERIC).toHaveLength(62);
    expect(ALL_CHARS).toHaveLength(88);
    expect(WIFI_CHARS).toHaveLength(74);
    expect(DJANGO_CHARS).toHaveLength(50);
    expect(BASE32).toHaveLength(32);
    expect(RECOVERY_CHARS).toHaveLength(36);
    expect(BACKUP_CHARS).toHaveLength(36);
  });

  it('have no duplicate characters — a repeat would quietly bias the draw', () => {
    for (const [name, set] of Object.entries({
      ALL_CHARS,
      ALPHANUMERIC,
      WIFI_CHARS,
      DJANGO_CHARS,
      WORDPRESS_CHARS,
      BASE32,
      RECOVERY_CHARS,
      BACKUP_CHARS,
      HEX,
    })) {
      expect(new Set(set).size, `${name} repeats a character`).toBe(set.length);
    }
  });

  it('keeps the literal space WordPress salts are allowed to contain', () => {
    expect(WORDPRESS_CHARS).toContain(' ');
  });
});

describe('randomInt', () => {
  it('stays inside the range', () => {
    for (let i = 0; i < 2000; i++) {
      const v = randomInt(88);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(88);
    }
  });

  it('is uniform enough that the modulo bias would have shown', () => {
    // The bug this guards: `bytes[0] % 88` makes 0..79 about 1.5x as likely as
    // 80..87. Over 88k draws that difference is enormous compared with noise,
    // so comparing the two halves catches it without being flaky.
    const counts = new Array(88).fill(0);
    const draws = 88_000;
    for (let i = 0; i < draws; i++) counts[randomInt(88)]!++;
    const low = counts.slice(0, 80).reduce((a, b) => a + b, 0) / 80;
    const high = counts.slice(80).reduce((a, b) => a + b, 0) / 8;
    expect(Math.abs(low - high) / low).toBeLessThan(0.15);
    expect(Math.min(...counts)).toBeGreaterThan(0);
  });

  it('rejects a bound it cannot serve', () => {
    expect(() => randomInt(0)).toThrow();
    expect(() => randomInt(-1)).toThrow();
    expect(() => randomInt(1.5)).toThrow();
  });

  it('always returns 0 for a single-element set', () => {
    expect(randomInt(1)).toBe(0);
  });
});

describe('randomBytes and randomString', () => {
  it('produce the requested length', () => {
    expect(randomBytes(0)).toHaveLength(0);
    expect(randomBytes(48)).toHaveLength(48);
    expect(randomString(30, ALPHANUMERIC)).toHaveLength(30);
  });

  it('draw only from the given set', () => {
    expect(onlyFrom(randomString(500, HEX), HEX)).toBe(true);
    expect(onlyFrom(randomString(500, DIGITS), DIGITS)).toBe(true);
  });

  it('hands out independent copies, not views onto a shared buffer', () => {
    // The pool reuses one buffer; if `randomBytes` returned a subarray, an
    // earlier value would silently change when a later one was drawn.
    const first = randomBytes(16);
    const snapshot = Uint8Array.from(first);
    randomBytes(64);
    expect(first).toEqual(snapshot);
  });

  it('does not repeat itself', () => {
    const seen = new Set(Array.from({ length: 200 }, () => randomString(16, ALL_CHARS)));
    expect(seen.size).toBe(200);
  });
});

describe('encodings', () => {
  it('hex round-trips a known vector', () => {
    expect(toHex(new Uint8Array([0, 1, 15, 16, 255]))).toBe('00010f10ff');
  });

  it('base64 matches the reference encoding', () => {
    expect(toBase64(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))).toBe('3q2+7w==');
  });

  it('base64url swaps the two unsafe characters and drops padding', () => {
    const out = toBase64Url(new Uint8Array([0xff, 0xef, 0xfe]));
    expect(out).not.toContain('+');
    expect(out).not.toContain('/');
    expect(out).not.toContain('=');
  });

  it('base32 matches RFC 4648 test vectors, padding included', () => {
    const enc = (s: string) => toBase32(new TextEncoder().encode(s));
    expect(enc('f')).toBe('MY======');
    expect(enc('fo')).toBe('MZXQ====');
    expect(enc('foo')).toBe('MZXW6===');
    expect(enc('foob')).toBe('MZXW6YQ=');
    expect(enc('fooba')).toBe('MZXW6YTB');
    expect(enc('foobar')).toBe('MZXW6YTBOI======');
  });

  it('base32 of 20 bytes is 32 characters with no padding', () => {
    expect(toBase32(randomBytes(20))).toHaveLength(32);
  });
});

describe('UUIDs', () => {
  const SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  it('v4 carries the version and variant nibbles', () => {
    for (let i = 0; i < 50; i++) {
      const id = uuidV4();
      expect(id).toMatch(SHAPE);
      expect(id[14]).toBe('4');
      expect('89ab').toContain(id[19]!);
    }
  });

  it('v7 carries its own version and variant', () => {
    for (let i = 0; i < 50; i++) {
      const id = uuidV7();
      expect(id).toMatch(SHAPE);
      expect(id[14]).toBe('7');
      expect('89ab').toContain(id[19]!);
    }
  });

  it('v7 puts the millisecond in front, so ids sort by when they were made', () => {
    const early = uuidV7(1_700_000_000_000);
    const later = uuidV7(1_800_000_000_000);
    expect(early < later).toBe(true);
    // The first 48 bits ARE the timestamp.
    expect(early.replace(/-/g, '').slice(0, 12)).toBe((1_700_000_000_000).toString(16).padStart(12, '0'));
  });

  it('v7 still increases inside a single millisecond', () => {
    const at = 1_750_000_000_000;
    const ids = Array.from({ length: 20 }, () => uuidV7(at));
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i]! > ids[i - 1]!, `${ids[i - 1]} then ${ids[i]}`).toBe(true);
    }
  });

  it('object ids are 24 hex characters starting with the timestamp', () => {
    const id = objectId(1_700_000_000_000);
    expect(id).toMatch(/^[0-9a-f]{24}$/);
    expect(id.slice(0, 8)).toBe((1_700_000_000).toString(16).padStart(8, '0'));
  });
});

describe('passwords', () => {
  it('pronounceable alternates consonants and vowels before the substitutions', () => {
    const value = pronounceable(16);
    expect(value).toHaveLength(16);
    // At most two uppercase and two digits are introduced.
    expect([...value].filter((c) => /[A-Z]/.test(c)).length).toBeLessThanOrEqual(2);
    expect([...value].filter((c) => /[0-9]/.test(c)).length).toBeLessThanOrEqual(2);
  });

  it('a passphrase takes the requested number of words from the list', () => {
    const value = passphrase(wordlist.words, 5);
    const parts = value.split('-');
    // Four of the EFF words are themselves hyphenated, so only check membership.
    expect(parts.length).toBeGreaterThanOrEqual(5);
    expect(value.length).toBeGreaterThan(10);
  });

  it('refuses to invent a passphrase from an empty list', () => {
    expect(() => passphrase([], 4)).toThrow();
  });

  it('the vendored word list is the size its entropy claim depends on', () => {
    expect(wordlist.words).toHaveLength(7776);
    expect(new Set(wordlist.words).size).toBe(7776);
    expect(wordlist.bitsPerWord).toBeCloseTo(12.92, 2);
    expect(wordListReady()).toBe(true);
  });
});

describe('entropyBits', () => {
  it('is floor(len * log2(setSize))', () => {
    expect(entropyBits(16, 88)).toBe(103);
    expect(entropyBits(32, 88)).toBe(206);
    expect(entropyBits(24, 62)).toBe(142);
    expect(entropyBits(20, 74)).toBe(124);
    expect(entropyBits(50, 50)).toBe(282);
  });

  it('is zero when there is nothing to choose', () => {
    expect(entropyBits(0, 88)).toBe(0);
    expect(entropyBits(10, 1)).toBe(0);
  });
});

describe('the catalogue', () => {
  it('has unique ids in known groups', () => {
    const ids = SECRETS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const def of SECRETS) {
      expect(GROUPS, `${def.id} is in an unknown group`).toContain(def.group);
      expect(def.name.length).toBeGreaterThan(0);
      expect(def.purpose.length).toBeGreaterThan(0);
    }
  });

  it('every generator produces something, twice differently', () => {
    for (const def of SECRETS) {
      const opt = def.option?.value;
      const a = def.generate(opt);
      const b = def.generate(opt);
      expect(a.length, `${def.id} produced nothing`).toBeGreaterThan(0);
      expect(a, `${def.id} is not random`).not.toBe(b);
    }
  });

  it('produces the documented shape for each generator', () => {
    const value = (id: string, opt?: number | string) => SECRETS.find((s) => s.id === id)!.generate(opt);

    expect(value('strong', 16)).toHaveLength(16);
    expect(onlyFrom(value('strong', 16), ALL_CHARS)).toBe(true);
    expect(value('fort-knox', 32)).toHaveLength(32);
    expect(value('alphanumeric', 24)).toHaveLength(24);
    expect(onlyFrom(value('alphanumeric', 24), ALPHANUMERIC)).toBe(true);
    expect(value('pin', 6)).toMatch(/^\d{6}$/);

    expect(value('api-key')).toMatch(/^sk_live_[A-Za-z0-9]{32}$/);
    // JWT secrets are BYTES, not a password charset: 32 bytes is 44 base64 chars.
    expect(value('jwt-secret', 'HS256')).toHaveLength(44);
    expect(value('jwt-secret', 'HS512')).toHaveLength(88);
    expect(value('aes-key', '256')).toMatch(/^[0-9a-f]{64}$/);
    expect(value('aes-key', '128')).toMatch(/^[0-9a-f]{32}$/);
    expect(value('salt')).toMatch(/^[0-9a-f]{32}$/);
    expect(value('hex-256')).toMatch(/^[0-9a-f]{64}$/);
    expect(value('url-token')).not.toMatch(/[+/=]/);

    expect(value('django')).toHaveLength(50);
    expect(onlyFrom(value('django'), DJANGO_CHARS)).toBe(true);
    expect(value('laravel')).toMatch(/^base64:.{44}$/);
    expect(value('flask')).toMatch(/^[0-9a-f]{48}$/);
    expect(value('wordpress')).toHaveLength(64);

    expect(value('uuid-v4')[14]).toBe('4');
    expect(value('uuid-v7')[14]).toBe('7');
    expect(value('object-id')).toMatch(/^[0-9a-f]{24}$/);

    expect(value('wifi', 20)).toHaveLength(20);
    expect(onlyFrom(value('wifi', 20), WIFI_CHARS)).toBe(true);
    expect(value('totp')).toMatch(/^[A-Z2-7]{32}$/);
    expect(value('recovery', 6)).toMatch(/^([A-Z0-9]{4}-){5}[A-Z0-9]{4}$/);
    expect(value('backup-codes', 10).split('\n')).toHaveLength(10);
    expect(value('backup-codes', 3)).toMatch(/^([a-z0-9]{4}-[a-z0-9]{4}\n){2}[a-z0-9]{4}-[a-z0-9]{4}$/);
  });

  it('honours the length option at both ends of its range', () => {
    for (const def of SECRETS) {
      if (def.option?.kind !== 'number') continue;
      const { min, max } = def.option;
      expect(def.generate(min).length, `${def.id} at min`).toBeGreaterThan(0);
      expect(def.generate(max).length, `${def.id} at max`).toBeGreaterThan(0);
      const bits = def.bits(max);
      if (bits !== null) expect(bits, `${def.id} bits at max`).toBeGreaterThan(0);
    }
  });

  it('reports entropy for secrets and nothing for identifiers', () => {
    // A UUID is unique, not unguessable; quoting "122 bits" beside one invites
    // somebody to use it as a session token.
    for (const def of SECRETS) {
      const bits = def.bits(def.option?.value);
      if (def.group === 'Identifiers') expect(bits, `${def.id}`).toBeNull();
      else expect(bits, `${def.id}`).toBeGreaterThan(0);
    }
  });

  it('sizes JWT secrets to the hash, per RFC 7518', () => {
    expect(JWT_BYTES).toEqual({ HS256: 32, HS384: 48, HS512: 64 });
  });

  it('offers no WEP and no UUID v1', () => {
    const ids = SECRETS.map((s) => s.id).join(' ');
    const names = SECRETS.map((s) => s.name).join(' ');
    expect(ids).not.toMatch(/wep/i);
    expect(names).not.toMatch(/WEP/);
    expect(names).not.toMatch(/v1/);
  });
});
