/**
 * Secret, key and password generation — pure functions over the Web Crypto
 * API, with the catalogue declared as data so the UI and the tests read the
 * same source.
 *
 * Nothing here stores, logs or transmits anything: values exist in the tab
 * until they are replaced. Everything is drawn from `crypto.getRandomValues`,
 * never `Math.random`.
 *
 * The catalogue follows randomkeygen.com's CURRENT generators (the site was
 * rebuilt; its old CodeIgniter / 160-bit WPA / WEP entries no longer exist).
 * WEP is deliberately absent here too: RC4 keystream reuse has made it
 * breakable in minutes since 2007, and offering it without saying so would be
 * worse than not offering it. UUID v1 is absent because it embeds the host's
 * MAC address by design.
 */
import { encodeBytes } from '../encode/base64';

/* ------------------------------------------------------------- alphabets --- */

export const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
export const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const DIGITS = '0123456789';
/** Symbols that survive copy/paste and shell quoting without argument. */
export const SYMBOLS_SAFE = '!@#$%^&*_+-=';
export const ALPHANUMERIC = LOWERCASE + UPPERCASE + DIGITS; // 62
export const ALL_CHARS = ALPHANUMERIC + '!@#$%^&*()_+-=[]{}|;:,.<>?'; // 88
export const URL_SAFE = ALPHANUMERIC + '-_'; // 64
export const HEX = '0123456789abcdef';
/** WPA passphrases are typed on TVs and consoles — no brackets or quotes. */
export const WIFI_CHARS = ALPHANUMERIC + SYMBOLS_SAFE; // 74
/** Django's own documented SECRET_KEY alphabet. */
export const DJANGO_CHARS = LOWERCASE + DIGITS + '!@#$%^&*(-_=+)'; // 50
/** WordPress salts include a literal space, on purpose. */
export const WORDPRESS_CHARS = ALPHANUMERIC + '!@#$%^&*()-_ []{}<>~`+=,.;:/?|';
/** RFC 4648 base32, the alphabet authenticator apps expect. */
export const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const RECOVERY_CHARS = UPPERCASE + DIGITS; // 36
export const BACKUP_CHARS = LOWERCASE + DIGITS; // 36
const CONSONANTS = 'bcdfghjklmnprstvwxz';
const VOWELS = 'aeiou';

/* --------------------------------------------------------------- entropy --- */

/**
 * A batched source of cryptographic random bytes.
 *
 * Drawing four fresh bytes per character (what randomkeygen does) asks the
 * platform RNG for ~5x what it needs; refilling one buffer costs a single call
 * per 256 draws instead.
 */
class RandomPool {
  private buffer = new Uint8Array(0);
  private offset = 0;

  constructor(private readonly chunk = 1024) {}

  take(n: number): Uint8Array {
    if (this.offset + n > this.buffer.length) {
      this.buffer = new Uint8Array(Math.max(this.chunk, n));
      cryptoOf().getRandomValues(this.buffer);
      this.offset = 0;
    }
    const out = this.buffer.subarray(this.offset, this.offset + n);
    this.offset += n;
    return out;
  }
}

function cryptoOf(): Crypto {
  const c = globalThis.crypto;
  if (!c?.getRandomValues) {
    throw new Error('Secure random generation needs the Web Crypto API.');
  }
  return c;
}

const pool = new RandomPool();

/** `n` cryptographically random bytes. */
export function randomBytes(n: number): Uint8Array {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError('byte count must be a non-negative integer');
  // Copy out of the pool: callers keep these, and the pool's buffer is reused.
  return Uint8Array.from(pool.take(n));
}

/**
 * A uniform integer in [0, max), by rejection sampling.
 *
 * `getRandomValues(new Uint8Array(1))[0] % max` is measurably biased whenever
 * max does not divide 256 — for an 88-character set, values 0–79 would come up
 * about 1.5x as often as 80–87. Rejecting everything at or above the largest
 * multiple of `max` below 2^32 removes the bias entirely, at the cost of a
 * retry that is vanishingly rare.
 */
export function randomInt(max: number): number {
  if (!Number.isSafeInteger(max) || max <= 0 || max > 2 ** 32) {
    throw new RangeError('upper bound must be an integer in 1..2^32');
  }
  const limit = Math.floor(2 ** 32 / max) * max;
  for (;;) {
    const b = pool.take(4);
    const v = b[0]! * 0x1000000 + b[1]! * 0x10000 + b[2]! * 0x100 + b[3]!;
    if (v < limit) return v % max;
  }
}

/** One uniformly chosen character from `set`. */
export function pick(set: string): string {
  return set[randomInt(set.length)]!;
}

/** `len` uniformly chosen characters from `set`. */
export function randomString(len: number, set: string): string {
  let out = '';
  for (let i = 0; i < len; i++) out += pick(set);
  return out;
}

/** Shannon entropy of `len` independent draws from a set, in whole bits. */
export function entropyBits(len: number, setSize: number): number {
  if (len <= 0 || setSize <= 1) return 0;
  return Math.floor(len * Math.log2(setSize));
}

/* ---------------------------------------------------------- encodings ----- */

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/**
 * Base64 and base64url come from [encode/base64.ts](../encode/base64.ts) — one
 * implementation for the whole app, and the only one that reports WHERE a
 * pasted string stopped being base64. Re-exported under these names so the
 * catalogue below reads as it always did.
 */
export const toBase64 = (bytes: Uint8Array): string => encodeBytes(bytes);

/** base64url: the URL/filename-safe alphabet, padding stripped (RFC 4648 §5). */
export const toBase64Url = (bytes: Uint8Array): string => encodeBytes(bytes, { url: true });

/** RFC 4648 base32, padded — what authenticator apps read. */
export function toBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  while (out.length % 8 !== 0) out += '=';
  return out;
}

/* -------------------------------------------------------- identifiers ----- */

/** UUID v4 — 122 random bits, from the platform's own generator. */
export function uuidV4(): string {
  const c = cryptoOf();
  if (typeof c.randomUUID === 'function') return c.randomUUID();
  // Same layout by hand, for a context without randomUUID.
  const b = randomBytes(16);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = toHex(b);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Monotonic counter for v7s minted inside the same millisecond. */
let lastV7Ms = -1;
let lastV7Seq = 0;

/**
 * UUID v7 (RFC 9562) — a 48-bit big-endian millisecond timestamp followed by
 * randomness, so ids sort by creation time and do not fragment a B-tree index
 * the way v4 does. There is no native API for it and none is coming, so this is
 * hand-rolled: bytes 0–5 are the timestamp, the high nibble of byte 6 is the
 * version, and the top two bits of byte 8 are the variant.
 *
 * `now` is injectable so the monotonic behaviour can be tested.
 */
export function uuidV7(now: number = Date.now()): string {
  const b = randomBytes(16);
  const ms = Math.max(0, Math.floor(now));
  b[0] = (ms / 2 ** 40) & 0xff;
  b[1] = (ms / 2 ** 32) & 0xff;
  b[2] = (ms / 2 ** 24) & 0xff;
  b[3] = (ms / 2 ** 16) & 0xff;
  b[4] = (ms / 2 ** 8) & 0xff;
  b[5] = ms & 0xff;
  // Within one millisecond, count up in rand_a so successive ids still sort.
  if (ms === lastV7Ms) {
    lastV7Seq = (lastV7Seq + 1) & 0x0fff;
  } else {
    lastV7Ms = ms;
    lastV7Seq = ((b[6]! & 0x0f) << 8) | b[7]!;
  }
  b[6] = 0x70 | ((lastV7Seq >> 8) & 0x0f);
  b[7] = lastV7Seq & 0xff;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = toHex(b);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** A MongoDB ObjectId-shaped 12-byte hex identifier. */
export function objectId(now: number = Date.now()): string {
  const b = randomBytes(12);
  const seconds = Math.floor(now / 1000);
  b[0] = (seconds >>> 24) & 0xff;
  b[1] = (seconds >>> 16) & 0xff;
  b[2] = (seconds >>> 8) & 0xff;
  b[3] = seconds & 0xff;
  return toHex(b);
}

/* ----------------------------------------------------------- passwords ---- */

/**
 * A pronounceable password: alternating consonants and vowels, then a couple of
 * capitals and digit substitutions. Easier to read aloud, and MUCH weaker than
 * the same length drawn uniformly — the card says so.
 */
export function pronounceable(len: number): string {
  let out = '';
  for (let i = 0; i < len; i++) out += pick(i % 2 === 0 ? CONSONANTS : VOWELS);
  const chars = out.split('');
  for (let i = 0; i < Math.min(2, chars.length); i++) {
    const at = randomInt(chars.length);
    chars[at] = chars[at]!.toUpperCase();
  }
  for (let i = 0; i < Math.min(2, chars.length); i++) {
    const at = randomInt(chars.length);
    chars[at] = pick(DIGITS);
  }
  return chars.join('');
}

/** Entropy of a pronounceable password: the syllable structure is the limit. */
export function pronounceableBits(len: number): number {
  const consonantCount = Math.ceil(len / 2);
  const vowelCount = Math.floor(len / 2);
  return Math.floor(consonantCount * Math.log2(CONSONANTS.length) + vowelCount * Math.log2(VOWELS.length));
}

/**
 * The word list, once something has handed it over.
 *
 * The catalogue is synchronous — a card generates on click — but the list is
 * 78 KB and only one generator needs it, so the component imports it lazily and
 * registers it here. Until then the passphrase card says it is loading rather
 * than silently producing something weaker from a fallback list.
 */
let words: readonly string[] = [];

export function setWordList(list: readonly string[]): void {
  words = list;
}

export function wordListReady(): boolean {
  return words.length > 0;
}

function loadedWords(): readonly string[] {
  if (words.length === 0) throw new Error('the word list has not been loaded yet');
  return words;
}

/** A passphrase: `count` words from `words`, joined by `separator`. */
export function passphrase(words: readonly string[], count: number, separator = '-'): string {
  if (words.length === 0) throw new Error('the word list is empty');
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(words[randomInt(words.length)]!);
  return out.join(separator);
}

/* ------------------------------------------------------------ catalogue --- */

export type SecretGroup = 'Passwords' | 'Keys & secrets' | 'Framework' | 'Identifiers' | 'Network & 2FA';

export const GROUPS: SecretGroup[] = [
  'Passwords',
  'Keys & secrets',
  'Framework',
  'Identifiers',
  'Network & 2FA',
];

/** One adjustable knob on a generator. */
export type SecretOption =
  | { kind: 'number'; label: string; min: number; max: number; value: number }
  | { kind: 'choice'; label: string; choices: { value: string; label: string }[]; value: string };

export interface SecretDef {
  id: string;
  group: SecretGroup;
  name: string;
  /** One plain-word line: what this is for. */
  purpose: string;
  option?: SecretOption;
  /** Produce a value. `opt` is the current option value, if the def has one. */
  generate(opt?: number | string): string;
  /** Entropy of that value in whole bits, or null when it is not a secret
   * (an identifier is unique, not unguessable, and saying "122 bits" about a
   * UUID invites someone to use one as a token). */
  bits(opt?: number | string): number | null;
}

const num = (label: string, min: number, max: number, value: number): SecretOption => ({
  kind: 'number',
  label,
  min,
  max,
  value,
});

const asNum = (opt: number | string | undefined, fallback: number): number => {
  const n = typeof opt === 'string' ? Number(opt) : opt;
  return Number.isFinite(n) ? Math.round(n as number) : fallback;
};

/** Byte length for each HMAC algorithm, per RFC 7518 §3.2: at least the hash size. */
export const JWT_BYTES: Record<string, number> = { HS256: 32, HS384: 48, HS512: 64 };

export const SECRETS: SecretDef[] = [
  {
    id: 'strong',
    group: 'Passwords',
    name: 'Strong password',
    purpose: 'A general-purpose password for anything a password manager will remember for you.',
    option: num('Length', 8, 64, 16),
    generate: (o) => randomString(asNum(o, 16), ALL_CHARS),
    bits: (o) => entropyBits(asNum(o, 16), ALL_CHARS.length),
  },
  {
    id: 'fort-knox',
    group: 'Passwords',
    name: 'Fort Knox password',
    purpose: 'The same alphabet, twice as long — for the account that protects the others.',
    option: num('Length', 24, 128, 32),
    generate: (o) => randomString(asNum(o, 32), ALL_CHARS),
    bits: (o) => entropyBits(asNum(o, 32), ALL_CHARS.length),
  },
  {
    id: 'alphanumeric',
    group: 'Passwords',
    name: 'Alphanumeric password',
    purpose: 'Letters and digits only, for the systems that still reject punctuation.',
    option: num('Length', 8, 64, 24),
    generate: (o) => randomString(asNum(o, 24), ALPHANUMERIC),
    bits: (o) => entropyBits(asNum(o, 24), ALPHANUMERIC.length),
  },
  {
    id: 'pronounceable',
    group: 'Passwords',
    name: 'Pronounceable password',
    purpose: 'Readable over the phone. Much weaker per character than the ones above.',
    option: num('Length', 8, 32, 12),
    generate: (o) => pronounceable(asNum(o, 12)),
    bits: (o) => pronounceableBits(asNum(o, 12)),
  },
  {
    id: 'memorable',
    group: 'Passwords',
    name: 'Memorable passphrase',
    purpose:
      'Words you can actually remember, from the EFF Long Wordlist (7,776 words, so 12.9 bits each).',
    option: num('Words', 3, 10, 5),
    // The word list is passed in by the caller: it is 78 KB, and a page that
    // never opens this card should not download it.
    generate: (o) => passphrase(loadedWords(), asNum(o, 5)),
    // 0 until the list is here: `bits` is read while rendering, so it must not
    // be able to throw the way `generate` can.
    bits: (o) => (wordListReady() ? entropyBits(asNum(o, 5), words.length) : 0),
  },
  {
    id: 'pin',
    group: 'Passwords',
    name: 'PIN',
    purpose: 'Digits only, for a lock screen or a door.',
    option: num('Digits', 4, 12, 6),
    generate: (o) => randomString(asNum(o, 6), DIGITS),
    bits: (o) => entropyBits(asNum(o, 6), DIGITS.length),
  },

  {
    id: 'api-key',
    group: 'Keys & secrets',
    name: 'API key',
    purpose: 'A bearer token in the shape most APIs issue: a readable prefix and 32 random characters.',
    generate: () => 'sk_live_' + randomString(32, ALPHANUMERIC),
    bits: () => entropyBits(32, ALPHANUMERIC.length),
  },
  {
    id: 'jwt-secret',
    group: 'Keys & secrets',
    name: 'JWT signing secret',
    purpose:
      'An HMAC key sized to the algorithm (RFC 7518 §3.2), base64. Not a password — RS256 and ES256 need a key PAIR, not a secret.',
    option: {
      kind: 'choice',
      label: 'Algorithm',
      choices: [
        { value: 'HS256', label: 'HS256 — 32 bytes' },
        { value: 'HS384', label: 'HS384 — 48 bytes' },
        { value: 'HS512', label: 'HS512 — 64 bytes' },
      ],
      value: 'HS256',
    },
    generate: (o) => toBase64(randomBytes(JWT_BYTES[String(o ?? 'HS256')] ?? 32)),
    bits: (o) => (JWT_BYTES[String(o ?? 'HS256')] ?? 32) * 8,
  },
  {
    id: 'hmac-secret',
    group: 'Keys & secrets',
    name: 'HMAC secret',
    purpose: 'A 32-byte key for signing webhooks and cookies, base64.',
    generate: () => toBase64(randomBytes(32)),
    bits: () => 256,
  },
  {
    id: 'aes-key',
    group: 'Keys & secrets',
    name: 'AES key',
    purpose: 'A symmetric encryption key of the chosen strength, hex.',
    option: {
      kind: 'choice',
      label: 'Key size',
      choices: [
        { value: '128', label: '128-bit' },
        { value: '192', label: '192-bit' },
        { value: '256', label: '256-bit' },
      ],
      value: '256',
    },
    generate: (o) => toHex(randomBytes(asNum(o, 256) / 8)),
    bits: (o) => asNum(o, 256),
  },
  {
    id: 'salt',
    group: 'Keys & secrets',
    name: 'Salt',
    purpose: 'A 16-byte value to mix into a password hash. Not secret — just unique per record.',
    generate: () => toHex(randomBytes(16)),
    bits: () => 128,
  },
  {
    id: 'iv',
    group: 'Keys & secrets',
    name: 'Initialisation vector',
    purpose: 'A 16-byte IV/nonce. Never reuse one with the same key.',
    generate: () => toHex(randomBytes(16)),
    bits: () => 128,
  },
  {
    id: 'hex-256',
    group: 'Keys & secrets',
    name: '256-bit hex string',
    purpose: '32 random bytes as hex, for anything that asks for a hex secret.',
    generate: () => toHex(randomBytes(32)),
    bits: () => 256,
  },
  {
    id: 'hex-128',
    group: 'Keys & secrets',
    name: '128-bit hex string',
    purpose: '16 random bytes as hex.',
    generate: () => toHex(randomBytes(16)),
    bits: () => 128,
  },
  {
    id: 'url-token',
    group: 'Keys & secrets',
    name: 'URL-safe token',
    purpose: 'base64url over 32 bytes — safe in a link, a filename or a header.',
    generate: () => toBase64Url(randomBytes(32)),
    bits: () => 256,
  },

  {
    id: 'django',
    group: 'Framework',
    name: 'Django SECRET_KEY',
    purpose: '50 characters from the alphabet Django’s own generator uses.',
    generate: () => randomString(50, DJANGO_CHARS),
    bits: () => entropyBits(50, DJANGO_CHARS.length),
  },
  {
    id: 'laravel',
    group: 'Framework',
    name: 'Laravel APP_KEY',
    purpose: '32 random bytes, base64, with the `base64:` prefix Laravel expects.',
    generate: () => 'base64:' + toBase64(randomBytes(32)),
    bits: () => 256,
  },
  {
    id: 'flask',
    group: 'Framework',
    name: 'Flask SECRET_KEY',
    purpose: '24 random bytes as hex, for session signing.',
    generate: () => toHex(randomBytes(24)),
    bits: () => 192,
  },
  {
    id: 'wordpress',
    group: 'Framework',
    name: 'WordPress salt',
    purpose: '64 characters for one of the AUTH_KEY / SALT constants in wp-config.php.',
    generate: () => randomString(64, WORDPRESS_CHARS),
    bits: () => entropyBits(64, WORDPRESS_CHARS.length),
  },

  {
    id: 'uuid-v4',
    group: 'Identifiers',
    name: 'UUID v4',
    purpose: 'The usual random identifier: 122 random bits, unordered.',
    generate: () => uuidV4(),
    bits: () => null,
  },
  {
    id: 'uuid-v7',
    group: 'Identifiers',
    name: 'UUID v7',
    purpose: 'Time-ordered (RFC 9562), so a database index stays tidy. Sorts by when it was made.',
    generate: () => uuidV7(),
    bits: () => null,
  },
  {
    id: 'object-id',
    group: 'Identifiers',
    name: 'MongoDB ObjectId',
    purpose: '12 bytes of hex in Mongo’s shape, timestamp first.',
    generate: () => objectId(),
    bits: () => null,
  },

  {
    id: 'wifi',
    group: 'Network & 2FA',
    name: 'Wi-Fi (WPA2/WPA3) passphrase',
    purpose: 'A pre-shared key of 8–63 characters, from a set that types cleanly on a TV remote.',
    option: num('Length', 8, 63, 20),
    generate: (o) => randomString(asNum(o, 20), WIFI_CHARS),
    bits: (o) => entropyBits(asNum(o, 20), WIFI_CHARS.length),
  },
  {
    id: 'totp',
    group: 'Network & 2FA',
    name: 'TOTP / 2FA secret',
    purpose: '20 random bytes in RFC 4648 base32 — the format an authenticator app expects.',
    generate: () => toBase32(randomBytes(20)),
    bits: () => 160,
  },
  {
    id: 'wireguard',
    group: 'Network & 2FA',
    name: 'WireGuard-style key',
    purpose: '32 random bytes, base64. A real WireGuard private key is clamped by the tool that uses it.',
    generate: () => toBase64(randomBytes(32)),
    bits: () => 256,
  },
  {
    id: 'recovery',
    group: 'Network & 2FA',
    name: 'Recovery key',
    purpose: 'Grouped in fours so it can be read out and typed back without losing your place.',
    option: num('Groups', 4, 8, 6),
    generate: (o) =>
      Array.from({ length: asNum(o, 6) }, () => randomString(4, RECOVERY_CHARS)).join('-'),
    bits: (o) => entropyBits(asNum(o, 6) * 4, RECOVERY_CHARS.length),
  },
  {
    id: 'backup-codes',
    group: 'Network & 2FA',
    name: 'Backup codes',
    purpose:
      'One-time codes to print and keep somewhere that is not this device. Each code stands alone, so the entropy shown is per code.',
    option: num('Codes', 1, 20, 10),
    generate: (o) =>
      Array.from(
        { length: asNum(o, 10) },
        () => randomString(4, BACKUP_CHARS) + '-' + randomString(4, BACKUP_CHARS)
      ).join('\n'),
    bits: () => entropyBits(8, BACKUP_CHARS.length),
  },
];

export const byId = (id: string): SecretDef | undefined => SECRETS.find((s) => s.id === id);
