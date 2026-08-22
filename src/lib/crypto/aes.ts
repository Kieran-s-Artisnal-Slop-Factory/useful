/**
 * AES-GCM with a password, through WebCrypto.
 *
 * Three decisions are load-bearing and none of them is adjustable:
 *
 * - **GCM, not CBC.** GCM authenticates: a ciphertext that has been altered
 *   fails to decrypt instead of producing plausible rubbish. Unauthenticated
 *   encryption is a bug that takes years to surface, and CBC is how people
 *   write it by accident.
 * - **A fresh 96-bit IV for every operation.** Reusing an IV with the same key
 *   in GCM does not degrade the encryption, it destroys it — an attacker who
 *   sees two messages under one nonce can recover the authentication key. The
 *   IV is generated here, never supplied.
 * - **The salt, the IV and the iteration count travel with the ciphertext.**
 *   A blob you cannot decrypt without remembering three parameters is a blob
 *   you will not decrypt. The bundle is one self-describing line.
 *
 * Nothing here is stored. The page that uses it writes nothing to IndexedDB —
 * not the password, not the key, not the plaintext.
 */
import { decodeBytes, encodeBytes } from '../encode/base64';

/**
 * PBKDF2 iterations. OWASP's 2023 guidance for PBKDF2-HMAC-SHA256 is 600 000;
 * it costs a second or so in a browser, which is the point of it.
 */
export const DEFAULT_ITERATIONS = 600_000;
export const MIN_ITERATIONS = 10_000;
export const MAX_ITERATIONS = 2_000_000;

const PREFIX = 'useful.aes256gcm.pbkdf2-sha256';

export interface Bundle {
  iterations: number;
  salt: Uint8Array;
  iv: Uint8Array;
  data: Uint8Array;
}

function subtle(): SubtleCrypto {
  const source = globalThis.crypto as Crypto | undefined;
  if (!source || !('subtle' in source) || !source.subtle) {
    throw new Error(
      'Encryption needs crypto.subtle, which only exists in a secure context (https: or localhost).'
    );
  }
  return source.subtle;
}

function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  globalThis.crypto.getRandomValues(out);
  return out;
}

/** The bundle as one line: prefix, iterations, then three base64url fields. */
export function formatBundle(bundle: Bundle): string {
  return [
    PREFIX,
    String(bundle.iterations),
    encodeBytes(bundle.salt, { url: true }),
    encodeBytes(bundle.iv, { url: true }),
    encodeBytes(bundle.data, { url: true }),
  ].join('.');
}

/** Read a bundle back, or null when the string is not one. */
export function parseBundle(text: string): Bundle | null {
  // base64url contains no dots, so splitting on them is unambiguous: three
  // fields of prefix, then iterations, salt, iv and ciphertext.
  const parts = text.trim().split('.');
  if (parts.length !== 7) return null;
  if (parts.slice(0, 3).join('.') !== PREFIX) return null;
  const iterations = Number(parts[3]);
  if (!Number.isInteger(iterations) || iterations < 1) return null;
  try {
    return {
      iterations,
      salt: decodeBytes(parts[4]!),
      iv: decodeBytes(parts[5]!),
      data: decodeBytes(parts[6]!),
    };
  } catch {
    return null;
  }
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const api = subtle();
  const material = await api.importKey(
    'raw',
    new TextEncoder().encode(password) as unknown as BufferSource,
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return api.deriveKey(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export interface EncryptOptions {
  iterations?: number;
}

/** Encrypt text with a password. Returns the self-describing bundle. */
export async function encryptWithPassword(
  plaintext: string,
  password: string,
  options: EncryptOptions = {}
): Promise<string> {
  if (password === '') throw new Error('A password is required.');
  const iterations = Math.min(
    MAX_ITERATIONS,
    Math.max(MIN_ITERATIONS, Math.floor(options.iterations ?? DEFAULT_ITERATIONS))
  );
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(password, salt, iterations);
  const data = new Uint8Array(
    await subtle().encrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource },
      key,
      new TextEncoder().encode(plaintext) as unknown as BufferSource
    )
  );
  return formatBundle({ iterations, salt, iv, data });
}

/**
 * Decrypt a bundle with a password.
 *
 * A wrong password fails as an AUTHENTICATION failure — GCM's tag does not
 * check out — rather than producing garbage, which is the whole reason for
 * choosing GCM.
 */
export async function decryptWithPassword(bundle: string, password: string): Promise<string> {
  const parsed = parseBundle(bundle);
  if (!parsed) throw new Error('That is not one of this tool’s encrypted bundles.');
  const key = await deriveKey(password, parsed.salt, parsed.iterations);
  try {
    const plain = await subtle().decrypt(
      { name: 'AES-GCM', iv: parsed.iv as unknown as BufferSource },
      key,
      parsed.data as unknown as BufferSource
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error(
      'That did not decrypt: either the password is wrong or the bundle has been altered. AES-GCM cannot tell you which, and that is by design.'
    );
  }
}
