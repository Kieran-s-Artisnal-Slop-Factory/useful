# Hashing

**Hashing** (under Generators, or Ctrl/Cmd+K) computes twelve digests of the same text at once — MD5, SHA-1, the SHA-2 family, SHA-3 and SHAKE — plus HMAC, with optional salt and pepper. Everything happens in the tab: nothing you type is uploaded or saved.

_Describes the code as of v0.3.0 (unreleased; schema v13) — verify against source when in doubt._

## Using it

1. Type or paste into **Text to hash**. Every digest updates as you type.
2. **Show as** changes the format of every value at once: lower-case hex, upper-case hex, base64, base64url, or hex grouped in fours for reading aloud.
3. **Copy** beside any algorithm puts that digest on the clipboard.
4. **Salt** and **Pepper** are added to the message before hashing. The line underneath shows the exact composition being used, because there is no standard order and a digest is only reproducible if you know it. **Random** fills the salt with 16 fresh random bytes.
5. **SHAKE bytes** sets how long the two SHAKE outputs are — they are extendable-output functions, so the length is yours to choose.
6. **HMAC** takes a key and turns the hash into a message authentication code: only someone with the key can produce or check it.

## Gotchas

- **A salted SHA-256 is not password storage.** These algorithms are built to be fast, and fast is exactly what you do not want for a password: a graphics card gets through billions of guesses a second. A salt only stops one precomputed table covering every account at once. Use Argon2id, scrypt, bcrypt (the Encryption page has one) or PBKDF2 — all of them deliberately slow, with a work factor.
- **MD5 and SHA-1 are broken.** MD5 collisions take seconds on a laptop and have since 2004; SHA-1's were demonstrated in 2017. They are here because a great deal of existing data uses them. Fine for a checksum against accidental corruption, never for a signature or anything an adversary can influence.
- **Some algorithms may be unavailable.** SHA-1, SHA-384 and SHA-512 come from the browser's own crypto, which only exists in a secure context — over `https:` or from `localhost`. Open the app from a file or over plain `http:` and those three grey out with the reason. MD5, SHA-224, SHA-256, SHA-3 and SHAKE are this app's own code and work anywhere.
- **A hash is not encryption.** There is no way back: that is the point of it. If you need something you can recover, the Encryption page is next door.
- **Nothing is saved.** Not the message, not the salt, not the pepper, not the key. Reloading the page starts empty.
