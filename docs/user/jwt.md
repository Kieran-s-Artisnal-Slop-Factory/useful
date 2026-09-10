# JWT

**JWT** (under Generators, or Ctrl/Cmd+K) reads JSON Web Tokens, checks their signatures, and makes new ones. Nothing you paste is uploaded or saved.

_Describes the code as of v0.5.0 (unreleased; schema v16) — verify against source when in doubt._

## Reading a token

Paste a token — or press **Load an example** — and the page splits it into its header and payload, lists the standard claims with their dates spelled out ("expires in 3 days"), and says whether it has expired.

**This is decoding, not verifying.** A JWT payload is base64url text, not encryption: anyone holding the token can read it. Nothing in that card is evidence of anything until the signature has been checked.

## Checking the signature

Under **Verify**, give the page the key: a **shared secret** for the HS algorithms, or a **public key in PEM** for the RSA, ECDSA and EdDSA ones. Press **Check the signature** and you get a plain answer, with the reason when it fails.

## Making a token

**Sign a new token** takes a payload as JSON, an algorithm and a key, and produces a token you can paste straight back into the box above to read.

## Gotchas

- **A JWT is signed, not encrypted.** Never put anything in one that the holder should not read — this page just decoded yours without a key, and so can anyone else.
- **`alg: none` is a real attack.** The original specification allowed unsigned tokens, and libraries that honoured it would accept a token with the signature stripped off. This tool flags it and will never verify one. Whatever library you use, pin it to the algorithm you expect rather than trusting the token's header.
- **Algorithm confusion is the other one.** If a system verifies with an RSA public key but reads the algorithm from the token, an attacker can send an `HS256` token signed with that public key — which is public. This tool refuses that combination and says why.
- **An expired token is only rejected because someone checked.** `exp` is a claim, not an enforcement mechanism, and a token cannot be withdrawn before it expires unless something keeps a list of revoked ones.
- **EdDSA may be missing.** It needs Ed25519 in the browser's crypto; where that is absent the option is listed and disabled rather than quietly gone.
- **Nothing is saved.** Reloading starts empty.
