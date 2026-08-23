# JWT

`/tools/jwt/` — decode, verify and sign JSON Web Tokens. A stateless Svelte island over [jwt.ts](../../../src/lib/crypto/jwt.ts); no token, secret or key is written anywhere.

_Describes the code as of v0.3.0 (schema v13) — verify against source when in doubt._

## The distinction the whole page is built around

**Decoding is not verifying.** `decode()` takes no key, touches no crypto and reports no validity; `verify()` is the only function that can call a token genuine. The page keeps the two visually apart — the decoded card is headed *Decoded — not verified* and carries a note saying the payload is base64url rather than encryption — because every JWT incident starts with someone trusting a decoded claim.

## File map

| Path | Role |
| --- | --- |
| [jwt.ts](../../../src/lib/crypto/jwt.ts) | Decode, claims, validity, verify, sign, the algorithm table |
| [rsa.ts](../../../src/lib/crypto/rsa.ts) | `fromPem` / `toPem`, shared with the encryption page |
| [JwtApp.svelte](../../../src/components/apps/JwtApp.svelte) | The page |
| [jwt.spec.ts](../../../tests/local/jwt.spec.ts), [jwt.test.ts](../../../src/lib/crypto/jwt.test.ts) | Playwright and Vitest |

## Algorithms

| Family | Ids | WebCrypto |
| --- | --- | --- |
| HMAC | HS256/384/512 | `HMAC` + SHA-* |
| RSA | RS256/384/512 | `RSASSA-PKCS1-v1_5` |
| RSA-PSS | PS256/384/512 | `RSA-PSS`, salt length = digest length (what JOSE requires) |
| ECDSA | ES256/384/512 | `ECDSA` on P-256/P-384/**P-521** (note: ES512 is P-521, not P-512) |
| EdDSA | EdDSA | `Ed25519`, feature-detected — listed and disabled where the browser lacks it |

`jwt.test.ts` round-trips every asymmetric algorithm the runtime supports, generating a key pair, signing, and verifying.

## Two attacks refused by name

- **`alg: none`.** The original specification allowed an unsigned token, and libraries that honoured it accepted anything. `verify()` returns invalid with that reason before it looks at a key; the page also flags the header on sight.
- **Algorithm confusion.** A verifier that reads `alg` from the token and holds an RSA public key can be handed an `HS256` token and will use that public key as an HMAC secret — and the key is public, so anyone can forge tokens. Passing a PEM for an HS* algorithm throws with the attack named.

A third guard is quieter: verifying with a PRIVATE key is refused, because someone pasting the wrong half of a pair should be told, not silently accommodated.

Test hooks are prefixed `jwt-`: `jwt-token`, `jwt-example`, `jwt-header`, `jwt-payload`, `jwt-alg`, `jwt-claim-<name>`, `jwt-validity`, `jwt-not-verified`, `jwt-none-warning`, `jwt-secret`, `jwt-pem`, `jwt-verify`, `jwt-verify-result`, `jwt-verify-error`, `jwt-sign-card`, `jwt-sign-alg`, `jwt-sign-payload`, `jwt-sign-secret`, `jwt-sign-pem`, `jwt-sign`, `jwt-signed`, `jwt-copy`, `jwt-error`.
