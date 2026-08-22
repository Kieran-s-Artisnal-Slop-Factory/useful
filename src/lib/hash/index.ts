/**
 * The hash catalogue — one place that knows which digests exist, where each
 * implementation comes from, and what it is safe to use for.
 *
 * Where a digest comes from matters here in a way it usually does not:
 *
 * - **WebCrypto** does SHA-1, SHA-256, SHA-384 and SHA-512, and it needs a
 *   SECURE CONTEXT. On `https:` or `localhost` it is there; on plain `http:`
 *   to a LAN address, or a `dist/` folder opened as `file://`, `crypto.subtle`
 *   is simply `undefined`. That is not an error to be caught at the first
 *   click — it is a fact the page states, and the algorithms that do not need
 *   it keep working.
 * - **This app** does MD5, SHA-224, SHA-3 and SHAKE, because no browser has
 *   them. They work anywhere JavaScript runs.
 *
 * HMAC follows the same split: WebCrypto's HMAC for the SHA-1/2 family, and
 * the generic construction over the local digests for everything else.
 *
 * Pure module apart from `crypto.subtle`: no DOM, no state, no I/O.
 */
import { encodeBytes } from '../encode/base64';
import { md5 } from './md5';
import { sha224, sha256 } from './sha2';
import { sha3_224, sha3_256, sha3_384, sha3_512, shake128, shake256 } from './sha3';

export type HashId =
  | 'md5'
  | 'sha1'
  | 'sha224'
  | 'sha256'
  | 'sha384'
  | 'sha512'
  | 'sha3-224'
  | 'sha3-256'
  | 'sha3-384'
  | 'sha3-512'
  | 'shake128'
  | 'shake256';

export interface HashDef {
  id: HashId;
  name: string;
  family: 'MD5' | 'SHA-1' | 'SHA-2' | 'SHA-3';
  /** Output size in bits; 0 for the extendable-output functions. */
  bits: number;
  /** Where the implementation comes from. */
  source: 'platform' | 'app';
  /** Block size in bytes — HMAC needs it, and it differs per algorithm. */
  blockSize: number;
  /** Said on screen next to the algorithm, when there is something to say. */
  warning?: string;
}

export const HASHES: HashDef[] = [
  {
    id: 'md5',
    name: 'MD5',
    family: 'MD5',
    bits: 128,
    source: 'app',
    blockSize: 64,
    warning:
      'Collision-broken since 2004 — two different inputs can be made to share a digest in seconds. Fine for checksums and cache keys, never for signatures, passwords or deduplicating anything that matters.',
  },
  {
    id: 'sha1',
    name: 'SHA-1',
    family: 'SHA-1',
    bits: 160,
    source: 'platform',
    blockSize: 64,
    warning:
      'Collisions have been demonstrated since 2017 (SHAttered). Still everywhere in git and older systems, but not to be chosen for anything new.',
  },
  { id: 'sha224', name: 'SHA-224', family: 'SHA-2', bits: 224, source: 'app', blockSize: 64 },
  { id: 'sha256', name: 'SHA-256', family: 'SHA-2', bits: 256, source: 'platform', blockSize: 64 },
  { id: 'sha384', name: 'SHA-384', family: 'SHA-2', bits: 384, source: 'platform', blockSize: 128 },
  { id: 'sha512', name: 'SHA-512', family: 'SHA-2', bits: 512, source: 'platform', blockSize: 128 },
  { id: 'sha3-224', name: 'SHA3-224', family: 'SHA-3', bits: 224, source: 'app', blockSize: 144 },
  { id: 'sha3-256', name: 'SHA3-256', family: 'SHA-3', bits: 256, source: 'app', blockSize: 136 },
  { id: 'sha3-384', name: 'SHA3-384', family: 'SHA-3', bits: 384, source: 'app', blockSize: 104 },
  { id: 'sha3-512', name: 'SHA3-512', family: 'SHA-3', bits: 512, source: 'app', blockSize: 72 },
  {
    id: 'shake128',
    name: 'SHAKE128',
    family: 'SHA-3',
    bits: 0,
    source: 'app',
    blockSize: 168,
    warning: 'An extendable-output function: you choose the length. Ask for at least 32 bytes.',
  },
  {
    id: 'shake256',
    name: 'SHAKE256',
    family: 'SHA-3',
    bits: 0,
    source: 'app',
    blockSize: 136,
    warning: 'An extendable-output function: you choose the length. Ask for at least 64 bytes.',
  },
];

export const hashById = (id: string): HashDef | undefined => HASHES.find((def) => def.id === id);

/** WebCrypto's own names for the four it implements. */
const SUBTLE_NAMES: Partial<Record<HashId, string>> = {
  sha1: 'SHA-1',
  sha256: 'SHA-256',
  sha384: 'SHA-384',
  sha512: 'SHA-512',
};

function subtle(): SubtleCrypto | null {
  const source = globalThis.crypto as Crypto | undefined;
  return source && 'subtle' in source && source.subtle ? source.subtle : null;
}

/** Is `crypto.subtle` here at all? False outside a secure context. */
export function subtleAvailable(): boolean {
  return subtle() !== null;
}

/**
 * Can this digest be computed in this context?
 *
 * The app's own implementations always can. The platform's need
 * `crypto.subtle` — except SHA-256, which this app also implements, so it
 * survives an insecure context too.
 */
export function available(id: HashId): boolean {
  const def = hashById(id);
  if (!def) return false;
  if (def.source === 'app') return true;
  if (id === 'sha256') return true;
  return subtleAvailable();
}

/**
 * The digest of these bytes.
 *
 * `outputBytes` is only read by SHAKE, where it is the whole point.
 */
export async function digest(id: HashId, input: Uint8Array, outputBytes?: number): Promise<Uint8Array> {
  switch (id) {
    case 'md5':
      return md5(input);
    case 'sha224':
      return sha224(input);
    case 'sha3-224':
      return sha3_224(input);
    case 'sha3-256':
      return sha3_256(input);
    case 'sha3-384':
      return sha3_384(input);
    case 'sha3-512':
      return sha3_512(input);
    case 'shake128':
      return shake128(input, outputBytes ?? 32);
    case 'shake256':
      return shake256(input, outputBytes ?? 64);
    default: {
      const name = SUBTLE_NAMES[id];
      const api = subtle();
      if (name && api) return new Uint8Array(await api.digest(name, input as unknown as BufferSource));
      // SHA-256 is the one platform digest this app can also compute itself.
      if (id === 'sha256') return sha256(input);
      throw new Error(`${hashById(id)?.name ?? id} needs crypto.subtle, which this context does not have.`);
    }
  }
}

/* -------------------------------------------------------------------- HMAC --- */

/**
 * HMAC (RFC 2104) over any digest in the catalogue.
 *
 * WebCrypto's HMAC covers the SHA-1/2 family; for MD5, SHA-224 and SHA-3 the
 * generic construction is built here over the local digests —
 * `H((K ^ opad) || H((K ^ ipad) || message))`, with the key hashed first when
 * it is longer than the block and zero-padded when it is shorter.
 */
export async function hmac(id: HashId, key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  const def = hashById(id);
  if (!def) throw new Error(`Unknown hash: ${id}`);
  if (def.bits === 0) throw new Error('SHAKE has no HMAC — it is an extendable-output function.');

  const name = SUBTLE_NAMES[id];
  const api = subtle();
  if (name && api) {
    const material = await api.importKey(
      'raw',
      (key.length === 0 ? new Uint8Array(1) : key) as unknown as BufferSource,
      { name: 'HMAC', hash: name },
      false,
      ['sign']
    );
    return new Uint8Array(await api.sign('HMAC', material, message as unknown as BufferSource));
  }

  const block = def.blockSize;
  let normalized = key.length > block ? await digest(id, key) : key;
  if (normalized.length < block) {
    const padded = new Uint8Array(block);
    padded.set(normalized);
    normalized = padded;
  }
  const inner = new Uint8Array(block + message.length);
  const outer = new Uint8Array(block + def.bits / 8);
  for (let i = 0; i < block; i += 1) {
    inner[i] = normalized[i]! ^ 0x36;
    outer[i] = normalized[i]! ^ 0x5c;
  }
  inner.set(message, block);
  outer.set(await digest(id, inner), block);
  return digest(id, outer);
}

/* ------------------------------------------------------------ composition --- */

export type SaltPosition = 'prefix' | 'suffix';

export interface Composition {
  message: string;
  salt?: string;
  pepper?: string;
  saltPosition?: SaltPosition;
}

export interface ComposedInput {
  bytes: Uint8Array;
  /** The formula actually used, for printing next to the fields. */
  formula: string;
}

const encoder = new TextEncoder();

/**
 * Salt, pepper and message, concatenated in a stated order.
 *
 * There is no standard for this — which is exactly why the page prints the
 * formula it used. A digest of the same three strings in a different order is
 * a different digest, and "salted SHA-256" on its own tells you nothing about
 * how to reproduce it.
 */
export function composeInput({ message, salt, pepper, saltPosition = 'prefix' }: Composition): ComposedInput {
  const parts: string[] = [];
  const names: string[] = [];
  if (pepper) {
    parts.push(pepper);
    names.push('pepper');
  }
  if (salt && saltPosition === 'prefix') {
    parts.push(salt);
    names.push('salt');
  }
  parts.push(message);
  names.push('message');
  if (salt && saltPosition === 'suffix') {
    parts.push(salt);
    names.push('salt');
  }
  return { bytes: encoder.encode(parts.join('')), formula: `H(${names.join(' ‖ ')})` };
}

/* ---------------------------------------------------------------- output --- */

export interface Formats {
  hex: string;
  hexUpper: string;
  base64: string;
  base64url: string;
  /** Hex in groups of four, for reading a fingerprint out loud. */
  grouped: string;
}

export function formats(bytes: Uint8Array): Formats {
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return {
    hex,
    hexUpper: hex.toUpperCase(),
    base64: encodeBytes(bytes),
    base64url: encodeBytes(bytes, { url: true }),
    grouped: (hex.match(/.{1,4}/g) ?? []).join(' '),
  };
}
