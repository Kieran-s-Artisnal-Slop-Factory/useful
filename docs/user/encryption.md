# Encryption

**Encryption** (under Generators, or Ctrl/Cmd+K) does five things: encrypts text with a password, makes an RSA key pair, runs a key agreement, hashes a password with bcrypt, and demonstrates a one-time pad. All of it happens in the tab.

_Describes the code as of v0.3.0 (schema v13) — verify against source when in doubt._

## A password (AES-256-GCM)

Type your text and a password, press **Encrypt**, and you get one line back. That line contains everything needed to decrypt it except the password — the salt, the initialisation vector and the iteration count all travel with the ciphertext. Paste it into **Decrypt a bundle** with the password to get your text back.

The **PBKDF2 iterations** field is the work factor: 600 000 is the current guidance and costs about a second. Higher is slower for you and for anyone guessing.

## A key pair (RSA-OAEP)

**Generate a pair** gives you a public key and a private key as PEM blocks. Encrypt with the public one, decrypt with the private one. The limit is stated above the button: **190 bytes at 2048 bits**. That is not a setting — it is how much room the padding leaves.

## Key agreement (ECDH)

**Run the exchange** creates two parties, shows what each would send, and derives the shared secret from both sides. Everything shown as "sent" could be read by anyone in the middle; the secret below it never travelled.

Underneath is the same idea in three-digit numbers you can check by hand. It is a demonstration and it says so — at that size the secret can be worked out in a fraction of a second.

## Password hashing (bcrypt)

Type a password, choose a **cost**, press **Hash**. The result includes its own salt and cost, and the page reports how long it took. Each step of the cost doubles the work. **Verify** checks a password against a hash.

## One-time pad

Type a message and press **Encrypt**. You get a key exactly as long as the message and the ciphertext.

## Gotchas

- **Nothing here is saved.** Not the passwords, not the keys, not the plaintext. There is no "save this key pair" button on purpose: a backup of this app is one plain JSON file, and a private key that reached it would sit in your downloads folder forever. Copy what you need before you leave.
- **A wrong password and a tampered bundle look the same.** AES-GCM tells you the decryption failed, not which of the two happened, and that is deliberate — distinguishing them would leak information.
- **RSA cannot encrypt anything big.** Past 190 bytes (at 2048 bits) it refuses. Everyone — TLS, PGP, age — encrypts a random AES key with RSA and the data with AES; that is the design, not a workaround.
- **bcrypt reads only the first 72 bytes of a password.** Everything after that is ignored, silently, in every implementation. The page tells you when it happened.
- **The one-time pad's rules cannot be enforced by a web page.** A key as long as the message and a random key are handled here. Never reusing it, and getting it to the other person by some other route, are up to you — and reusing one key twice makes both messages recoverable.
- **This is not a key-management system.** It is for learning and small one-off jobs. It has no idea whether the key you pasted is the right one, or who else has it.
- **Everything except the one-time pad and the demonstration needs a secure context** (`https:` or `localhost`), because that is where the browser's crypto lives. The page says so when it is missing.
