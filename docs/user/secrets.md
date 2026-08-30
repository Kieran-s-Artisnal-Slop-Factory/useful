# Secrets

Passwords, API keys, signing secrets, identifiers and Wi-Fi passphrases, generated in your browser. Every card fills itself when the page opens; **Regenerate** replaces one, **Regenerate all** replaces the lot, and **Copy** puts a value on the clipboard.

The five categories are **fold-out sections**. **Passwords** is open when the page loads and the rest are folded shut, so the page opens as a short contents list rather than twenty-seven cards; click a category's name (or press Enter on it) to open it, and open as many as you like — opening one does not close another. Folded categories are generating all the same, so one you open is showing a value as fresh as the rest, and **Regenerate all** reaches every card whether or not you can see it.

_Describes the code as of v0.4.0 (unreleased; schema v13) — verify against source when in doubt._

## What is on offer

| Group | What it makes |
|---|---|
| **Passwords** | A strong password, a longer "Fort Knox" one, letters-and-digits-only for systems that reject punctuation, a memorable passphrase, a pronounceable password, and a PIN |
| **Keys & secrets** | API key, JWT signing secret, HMAC secret, AES key, salt, initialisation vector, hex strings, URL-safe token |
| **Framework** | Django `SECRET_KEY`, Laravel `APP_KEY`, Flask `SECRET_KEY`, WordPress salt |
| **Identifiers** | UUID v4, UUID v7, MongoDB ObjectId |
| **Network & 2FA** | Wi-Fi (WPA2/WPA3) passphrase, TOTP/2FA secret, WireGuard-style key, recovery key, backup codes |

Where a card has a **Length**, **Words** or **Algorithm** box, changing it makes a new value at once and updates the entropy figure beside the name.

## Reading the entropy figure

Each card says how many bits of entropy its value carries — how many yes/no questions an attacker would need to get right. Under 50 bits is guessable by anyone who cares; around 80 resists someone with real hardware; past 128 the value is no longer the weak link, where it is stored is.

The number is worked out from the actual alphabet and the actual length, so a longer password genuinely reports a bigger number. For backup codes it is **per code**, since each one stands alone.

Identifiers say "identifier — unique, not secret" instead of a number, and that difference matters: a UUID is guaranteed not to collide, not guaranteed to be unguessable. It is a fine database key or filename, and a poor password-reset link.

## Gotchas

- **Nothing here is saved.** Values live in the page and nowhere else — not in the database, not in a backup, not in the address bar. Close the tab or hit Regenerate and the old value is gone for good. Copy it before you leave.
- **A generated secret is only as strong as where it ends up.** A 206-bit password pasted into a note beside the username is a 0-bit password. Put these somewhere designed to hold them.
- **Regenerate all replaces every card**, including one you had already copied but not yet pasted — and including cards inside categories you have not opened.
- **Which categories are open is not remembered.** Reload and you are back to Passwords open and the rest folded. Nothing on this page is written down, and where you had scrolled to is not an exception worth breaking that for.
- **JWT is for HS256, HS384 and HS512 only.** Those sign with a shared secret, which is what this makes — sized to the algorithm, as the standard requires. RS256 and ES256 need a public/private key *pair*, which this tool will not pretend to produce; use `openssl` or your platform's key tooling.
- **The pronounceable password is much weaker than it looks.** Alternating consonants and vowels is a small fraction of the possibilities of the same number of random characters — the entropy figure shows the difference honestly. Use it when a human has to read it aloud, not to protect anything important.
- **There is no WEP generator, on purpose.** WEP has been breakable in minutes since 2007, whatever the key length. If something still requires WEP, the fix is replacing that equipment, not generating a better key for it.
- **The passphrase card takes a moment on first load.** Its 7,776-word list is fetched separately so the rest of the page stays light; until it arrives that one card says so rather than making a weaker phrase from a shorter list.
- **A salt and an IV are not secrets.** They need to be *unique*, not hidden — but never reuse an IV with the same key.
