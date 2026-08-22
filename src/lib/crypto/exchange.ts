/**
 * Key agreement: two people who have never met derive the same secret over a
 * channel anyone can read.
 *
 * Two things live here, and the difference between them is the point.
 *
 * **The real one** is ECDH through WebCrypto — P-256, P-384, P-521, and
 * X25519 where the browser has it (Chrome 133+, Firefox 130+, Safari 17+).
 * This is what a protocol should use.
 *
 * **The teaching one** is finite-field Diffie-Hellman over three-digit
 * primes, in `bigint`, so the arithmetic can be printed on the page and
 * followed by hand. It is a demonstration and it is labelled as one
 * everywhere it appears: at that size the discrete logarithm is a fraction of
 * a second's work, and real finite-field DH needs a 2048-bit safe prime and
 * parameter validation this does not do. WebCrypto has no finite-field DH at
 * all, which is a decision by the standards bodies, not an omission here.
 */
import { encodeBytes } from '../encode/base64';

export type Curve = 'P-256' | 'P-384' | 'P-521' | 'X25519';
export const CURVES: Curve[] = ['P-256', 'P-384', 'P-521', 'X25519'];

function subtle(): SubtleCrypto {
  const source = globalThis.crypto as Crypto | undefined;
  if (!source || !('subtle' in source) || !source.subtle) {
    throw new Error(
      'Key agreement needs crypto.subtle, which only exists in a secure context (https: or localhost).'
    );
  }
  return source.subtle;
}

/** Does this runtime have X25519? Only way to know is to try it. */
export async function supportsX25519(): Promise<boolean> {
  try {
    await subtle().generateKey({ name: 'X25519' }, true, ['deriveBits']);
    return true;
  } catch {
    return false;
  }
}

export interface Party {
  name: string;
  keys: CryptoKeyPair;
  /** SPKI as base64, which is what would actually be sent. */
  publicKey: string;
}

function algorithmFor(curve: Curve): EcKeyGenParams | { name: string } {
  return curve === 'X25519' ? { name: 'X25519' } : { name: 'ECDH', namedCurve: curve };
}

/** One party's key pair, with the public half in the form it would be sent. */
export async function makeParty(name: string, curve: Curve): Promise<Party> {
  const api = subtle();
  const keys = (await api.generateKey(algorithmFor(curve) as EcKeyGenParams, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const spki = new Uint8Array(await api.exportKey('spki', keys.publicKey));
  return { name, keys, publicKey: encodeBytes(spki) };
}

/** The shared secret, from one side's private key and the other's public. */
export async function deriveShared(curve: Curve, mine: CryptoKey, theirs: CryptoKey): Promise<Uint8Array> {
  const bits = curve === 'X25519' ? 256 : curve === 'P-256' ? 256 : curve === 'P-384' ? 384 : 528;
  const derived = await subtle().deriveBits(
    curve === 'X25519' ? ({ name: 'X25519', public: theirs } as unknown as AlgorithmIdentifier) : { name: 'ECDH', public: theirs },
    mine,
    bits
  );
  return new Uint8Array(derived);
}

export interface Agreement {
  curve: Curve;
  alice: Party;
  bob: Party;
  /** Both sides derive the same bytes; both are computed and compared. */
  sharedFromAlice: Uint8Array;
  sharedFromBob: Uint8Array;
  match: boolean;
}

/** Run the whole exchange in the page, both sides, and check they agree. */
export async function runExchange(curve: Curve): Promise<Agreement> {
  const alice = await makeParty('Alice', curve);
  const bob = await makeParty('Bob', curve);
  const sharedFromAlice = await deriveShared(curve, alice.keys.privateKey, bob.keys.publicKey);
  const sharedFromBob = await deriveShared(curve, bob.keys.privateKey, alice.keys.publicKey);
  const match =
    sharedFromAlice.length === sharedFromBob.length &&
    sharedFromAlice.every((byte, index) => byte === sharedFromBob[index]);
  return { curve, alice, bob, sharedFromAlice, sharedFromBob, match };
}

/* ------------------------------------------------- the teaching version --- */

/** Modular exponentiation, square-and-multiply. */
export function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  if (modulus === 1n) return 0n;
  let result = 1n;
  let b = base % modulus;
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % modulus;
    e >>= 1n;
    b = (b * b) % modulus;
  }
  return result;
}

export interface Demonstration {
  p: bigint;
  g: bigint;
  /** Alice's and Bob's private exponents — secret in the real thing. */
  a: bigint;
  b: bigint;
  /** What each sends: g^a mod p and g^b mod p. */
  publicA: bigint;
  publicB: bigint;
  /** Each side raises the other's public value to its own private exponent. */
  secretFromA: bigint;
  secretFromB: bigint;
  match: boolean;
}

/**
 * Finite-field Diffie-Hellman with numbers small enough to check by hand.
 *
 * NOT SECURE, and never fed real input: `p` here is a three-digit prime, where
 * recovering `a` from `g^a mod p` takes a fraction of a second. It exists so
 * the four lines of arithmetic that make key agreement work can be read.
 */
export function demonstrate(p: bigint, g: bigint, a: bigint, b: bigint): Demonstration {
  const publicA = modPow(g, a, p);
  const publicB = modPow(g, b, p);
  const secretFromA = modPow(publicB, a, p);
  const secretFromB = modPow(publicA, b, p);
  return { p, g, a, b, publicA, publicB, secretFromA, secretFromB, match: secretFromA === secretFromB };
}

/** A prime and a generator small enough to print, with a worked example. */
export const DEMO_PRIME = 467n;
export const DEMO_GENERATOR = 2n;
