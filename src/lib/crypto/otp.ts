/**
 * The one-time pad: the only cipher with a proof of perfect secrecy, and the
 * only one whose rules nobody can keep.
 *
 * XOR the message with a key of the same length, drawn from a real random
 * source, and the ciphertext tells an attacker nothing — every plaintext of
 * that length is equally consistent with it. That proof holds **only** while
 * three things are true, and this module enforces the two it can:
 *
 * 1. The key is at least as long as the message. Enforced: a short key is
 *    refused rather than repeated, because repeating it is exactly the
 *    "two-time pad" that breaks the scheme (XOR two ciphertexts and the key
 *    cancels out).
 * 2. The key is random. Enforced: keys come from `crypto.getRandomValues`,
 *    and there is no way to type one in.
 * 3. The key is never reused, and reaches the other party by some other
 *    channel. **Not enforceable here** — it is a fact about how the key is
 *    handled after it leaves this page, which is why the page says so rather
 *    than pretending.
 */

/** A key of exactly this many bytes, from the platform's RNG. */
export function generateKey(length: number): Uint8Array {
  if (length < 0) throw new Error('A key cannot be shorter than nothing.');
  const key = new Uint8Array(length);
  if (length > 0) globalThis.crypto.getRandomValues(key);
  return key;
}

/**
 * XOR the data with the key. Its own inverse: apply it twice and you are back
 * where you started, which is the whole cipher.
 */
export function apply(data: Uint8Array, key: Uint8Array): Uint8Array {
  if (key.length < data.length) {
    throw new Error(
      `The key is ${key.length} bytes and the message is ${data.length}. A one-time pad needs a key at least as long as the message — reusing a short key is what breaks it completely, so this refuses rather than repeating.`
    );
  }
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i += 1) out[i] = data[i]! ^ key[i]!;
  return out;
}

/** Encrypt text, generating the key that goes with it. */
export function encrypt(plaintext: string): { key: Uint8Array; data: Uint8Array } {
  const data = new TextEncoder().encode(plaintext);
  const key = generateKey(data.length);
  return { key, data: apply(data, key) };
}

/** The inverse, given the same key. */
export function decrypt(data: Uint8Array, key: Uint8Array): string {
  return new TextDecoder().decode(apply(data, key));
}
