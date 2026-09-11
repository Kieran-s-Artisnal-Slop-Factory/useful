# Encryption

`/tools/encryption/` — AES-GCM with a password, RSA-OAEP, ECDH key agreement, bcrypt and a one-time pad. A stateless Svelte island over `src/lib/crypto/`; it writes **nothing** to IndexedDB, and there is deliberately no "save this key" control anywhere on it.

_Describes the code as of v0.6.0 (schema v17) — verify against source when in doubt._

## File map

| Path | Role |
| --- | --- |
| [aes.ts](../../../src/lib/crypto/aes.ts) | AES-256-GCM with a PBKDF2-derived key, and the self-describing bundle format |
| [rsa.ts](../../../src/lib/crypto/rsa.ts) | RSA-OAEP key generation, PEM/JWK export and import, the size limit |
| [exchange.ts](../../../src/lib/crypto/exchange.ts) | ECDH (P-256/384/521, X25519) plus the small-numbers teaching demonstration |
| [otp.ts](../../../src/lib/crypto/otp.ts) | The one-time pad, and the two of its three rules that can be enforced |
| [bcrypt.ts](../../../src/lib/crypto/bcrypt.ts), [bcrypt-worker.ts](../../../src/lib/crypto/bcrypt-worker.ts) | bcrypt off the main thread |
| [EncryptApp.svelte](../../../src/components/apps/EncryptApp.svelte) | The page |
| [encryption.spec.ts](../../../tests/local/encryption.spec.ts), [crypto.test.ts](../../../src/lib/crypto/crypto.test.ts) | Playwright and Vitest |

## The decisions that are not options

- **AES-GCM, never CBC.** GCM authenticates, so an altered ciphertext fails to decrypt instead of producing plausible rubbish. `crypto.test.ts` flips one bit of a bundle and asserts the failure.
- **A fresh 96-bit IV per operation, generated in the module.** Reusing an IV with the same key in GCM does not weaken it, it destroys it — two messages under one nonce leak the authentication key. There is no way to supply one.
- **The salt, IV and iteration count travel with the ciphertext.** The bundle is one line: `useful.aes256gcm.pbkdf2-sha256.<iterations>.<salt>.<iv>.<data>`, base64url throughout (which contains no dots, so splitting on them is unambiguous). A blob that needs three remembered parameters is a blob nobody decrypts.
- **PBKDF2 defaults to 600 000 iterations**, which is OWASP's 2023 figure for PBKDF2-HMAC-SHA256 and costs about a second in a browser. That cost is the feature.
- **RSA states its size limit in the refusal.** RSA-OAEP carries `k - 2·hLen - 2` bytes — 190 at 2048 bits with SHA-256 — and the error says the number, the actual length, and that hybrid encryption is the answer rather than a bigger key.
- **bcrypt runs in a worker.** `bcryptjs` is a pure-JavaScript implementation of a deliberately slow algorithm; cost 12 on the main thread is a frozen tab. The import lives in the worker alone, so it stays out of every other bundle, and the cost is capped at 12.

## Two Diffie-Hellmans, and why

WebCrypto has **ECDH** and no finite-field DH at all — a decision by the standards bodies, not an omission here. So the page carries both:

- `runExchange(curve)` generates both parties' keys, derives the secret from each side, and compares them. What is shown as "sent" is the SPKI public key; the secret never travels.
- `demonstrate(p, g, a, b)` is the same idea over a three-digit prime in `bigint`, so the four lines of arithmetic can be read and checked. It is labelled **a demonstration, not a cipher** on the page and in its own doc comment: at that size the discrete logarithm is instant, and real finite-field DH needs a 2048-bit safe prime and parameter validation this does not do.

## The one-time pad's third rule

`otp.ts` enforces two of the three things the proof of perfect secrecy depends on — the key is as long as the message (a short key is refused, never repeated) and the key is random (`crypto.getRandomValues`, with no way to type one in). The third — never reuse it, and get it to the other party some other way — is a fact about what happens after the key leaves the page, so the page states it instead of pretending to enforce it.

Test hooks are prefixed `enc-`.
