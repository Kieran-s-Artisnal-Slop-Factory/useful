/**
 * RSA-OAEP through WebCrypto: generate a pair, move it in and out as PEM or
 * JWK, and encrypt the small amount of data RSA can actually carry.
 *
 * The size limit is the part everyone meets by surprise. RSA-OAEP can encrypt
 * at most `k - 2 * hLen - 2` bytes, where k is the modulus in bytes and hLen
 * the digest length — so **190 bytes for a 2048-bit key with SHA-256**. It is
 * not a quota that can be raised: it is the size of the block the padding
 * leaves. Anything bigger uses hybrid encryption — a random AES key encrypted
 * with RSA, and the data encrypted with AES — which is what TLS, PGP and age
 * all do, and what [aes.ts](aes.ts) is here for.
 */
import { decodeBytes, encodeBytes } from '../encode/base64';

export type RsaBits = 2048 | 3072 | 4096;
export const RSA_SIZES: RsaBits[] = [2048, 3072, 4096];

function subtle(): SubtleCrypto {
  const source = globalThis.crypto as Crypto | undefined;
  if (!source || !('subtle' in source) || !source.subtle) {
    throw new Error(
      'RSA needs crypto.subtle, which only exists in a secure context (https: or localhost).'
    );
  }
  return source.subtle;
}

/** How many bytes RSA-OAEP with SHA-256 can carry at this key size. */
export function maxPlaintextBytes(bits: RsaBits): number {
  return bits / 8 - 2 * 32 - 2;
}

/* --------------------------------------------------------------------- PEM --- */

/** DER bytes as PEM, wrapped at 64 columns the way OpenSSL writes it. */
export function toPem(label: string, der: Uint8Array): string {
  const body = encodeBytes(der, { wrap: 64 });
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----`;
}

/** The DER bytes inside a PEM block, whatever its label. */
export function fromPem(pem: string): Uint8Array {
  const match = /-----BEGIN [^-]+-----([\s\S]*?)-----END [^-]+-----/.exec(pem.trim());
  if (!match) throw new Error('That is not a PEM block — it needs the BEGIN and END lines.');
  return decodeBytes(match[1]!);
}

export interface RsaPair {
  bits: RsaBits;
  publicPem: string;
  privatePem: string;
  publicJwk: string;
  privateJwk: string;
}

/** A fresh RSA-OAEP pair, exported in both formats people ask for. */
export async function generatePair(bits: RsaBits = 2048): Promise<RsaPair> {
  const api = subtle();
  const pair = (await api.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: bits,
      // 65537, the standard public exponent.
      publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
      hash: 'SHA-256',
    },
    true,
    ['encrypt', 'decrypt']
  )) as CryptoKeyPair;

  const spki = new Uint8Array(await api.exportKey('spki', pair.publicKey));
  const pkcs8 = new Uint8Array(await api.exportKey('pkcs8', pair.privateKey));
  const publicJwk = await api.exportKey('jwk', pair.publicKey);
  const privateJwk = await api.exportKey('jwk', pair.privateKey);

  return {
    bits,
    publicPem: toPem('PUBLIC KEY', spki),
    privatePem: toPem('PRIVATE KEY', pkcs8),
    publicJwk: JSON.stringify(publicJwk, null, 2),
    privateJwk: JSON.stringify(privateJwk, null, 2),
  };
}

export async function importPublic(pem: string): Promise<CryptoKey> {
  return subtle().importKey(
    'spki',
    fromPem(pem) as unknown as BufferSource,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    true,
    ['encrypt']
  );
}

export async function importPrivate(pem: string): Promise<CryptoKey> {
  return subtle().importKey(
    'pkcs8',
    fromPem(pem) as unknown as BufferSource,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    true,
    ['decrypt']
  );
}

/** The modulus size of an imported key, in bits. */
export function keyBits(key: CryptoKey): number {
  const algorithm = key.algorithm as RsaHashedKeyAlgorithm;
  return algorithm.modulusLength ?? 0;
}

/**
 * Encrypt with a public key. Refuses oversized input by name and number
 * rather than truncating it or failing with a DOMException nobody can act on.
 */
export async function encrypt(publicKeyPem: string, plaintext: string): Promise<string> {
  const key = await importPublic(publicKeyPem);
  const bytes = new TextEncoder().encode(plaintext);
  const limit = maxPlaintextBytes((keyBits(key) || 2048) as RsaBits);
  if (bytes.length > limit) {
    throw new Error(
      `RSA-OAEP with a ${keyBits(key)}-bit key carries at most ${limit} bytes; this is ${bytes.length}. Encrypt a random AES key with RSA and the data with AES instead — that is what hybrid encryption is.`
    );
  }
  const data = await subtle().encrypt({ name: 'RSA-OAEP' }, key, bytes as unknown as BufferSource);
  return encodeBytes(new Uint8Array(data));
}

export async function decrypt(privateKeyPem: string, base64: string): Promise<string> {
  const key = await importPrivate(privateKeyPem);
  try {
    const plain = await subtle().decrypt(
      { name: 'RSA-OAEP' },
      key,
      decodeBytes(base64) as unknown as BufferSource
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error('That did not decrypt — wrong key, or the ciphertext has been altered.');
  }
}
