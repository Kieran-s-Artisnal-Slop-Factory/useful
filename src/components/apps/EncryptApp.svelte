<script lang="ts">
  /**
   * Encryption and key exchange — AES-GCM with a password, RSA-OAEP, ECDH,
   * bcrypt and a one-time pad.
   *
   * Every operation here is user-triggered: nothing runs on load, nothing runs
   * on a keystroke, and NOTHING is written to IndexedDB — not a password, not
   * a key, not a plaintext. There is deliberately no "save this key pair"
   * button, because a backup of this app is one plain JSON file.
   */
  import Card from '../Card.svelte';
  import Explainer from '../Explainer.svelte';
  import { copyText } from '../../lib/exportFile';
  import {
    DEFAULT_ITERATIONS,
    decryptWithPassword,
    encryptWithPassword,
    MAX_ITERATIONS,
    MIN_ITERATIONS,
  } from '../../lib/crypto/aes';
  import {
    type Curve,
    CURVES,
    DEMO_GENERATOR,
    DEMO_PRIME,
    demonstrate,
    runExchange,
    supportsX25519,
  } from '../../lib/crypto/exchange';
  import * as otp from '../../lib/crypto/otp';
  import {
    type RsaBits,
    decrypt as rsaDecrypt,
    encrypt as rsaEncrypt,
    generatePair,
    maxPlaintextBytes,
    RSA_SIZES,
  } from '../../lib/crypto/rsa';
  import { encodeBytes } from '../../lib/encode/base64';
  import { toHex } from '../../lib/gen/secrets';

  const secure = typeof globalThis.crypto !== 'undefined' && 'subtle' in globalThis.crypto;

  let copied = $state('');
  async function copy(id: string, text: string): Promise<void> {
    if (!text) return;
    if (await copyText(text)) {
      copied = id;
      setTimeout(() => (copied = ''), 1500);
    }
  }

  /* ------------------------------------------------------------ password --- */

  let plaintext = $state('');
  let password = $state('');
  let iterations = $state(DEFAULT_ITERATIONS);
  let bundle = $state('');
  let aesBusy = $state(false);
  let aesError = $state('');
  let decryptBundle = $state('');
  let decryptPassword = $state('');
  let decrypted = $state('');
  let decryptError = $state('');

  async function doEncrypt(): Promise<void> {
    aesError = '';
    bundle = '';
    aesBusy = true;
    try {
      bundle = await encryptWithPassword(plaintext, password, { iterations });
    } catch (error) {
      aesError = error instanceof Error ? error.message : 'That could not be encrypted.';
    } finally {
      aesBusy = false;
    }
  }

  async function doDecrypt(): Promise<void> {
    decryptError = '';
    decrypted = '';
    aesBusy = true;
    try {
      decrypted = await decryptWithPassword(decryptBundle, decryptPassword);
    } catch (error) {
      decryptError = error instanceof Error ? error.message : 'That could not be decrypted.';
    } finally {
      aesBusy = false;
    }
  }

  /* ----------------------------------------------------------------- rsa --- */

  let rsaBits = $state<RsaBits>(2048);
  let publicPem = $state('');
  let privatePem = $state('');
  let rsaBusy = $state(false);
  let rsaError = $state('');
  let rsaMessage = $state('');
  let rsaCipher = $state('');
  let rsaPlain = $state('');

  async function makeKeys(): Promise<void> {
    rsaError = '';
    rsaBusy = true;
    try {
      const pair = await generatePair(rsaBits);
      publicPem = pair.publicPem;
      privatePem = pair.privatePem;
    } catch (error) {
      rsaError = error instanceof Error ? error.message : 'Key generation failed.';
    } finally {
      rsaBusy = false;
    }
  }

  async function rsaEncryptNow(): Promise<void> {
    rsaError = '';
    rsaCipher = '';
    try {
      rsaCipher = await rsaEncrypt(publicPem, rsaMessage);
    } catch (error) {
      rsaError = error instanceof Error ? error.message : 'That could not be encrypted.';
    }
  }

  async function rsaDecryptNow(): Promise<void> {
    rsaError = '';
    rsaPlain = '';
    try {
      rsaPlain = await rsaDecrypt(privatePem, rsaCipher);
    } catch (error) {
      rsaError = error instanceof Error ? error.message : 'That could not be decrypted.';
    }
  }

  /* -------------------------------------------------------------- ecdh --- */

  let curve = $state<Curve>('P-256');
  let x25519 = $state(true);
  let exchange = $state<{ alice: string; bob: string; shared: string; match: boolean } | null>(null);
  let exchangeError = $state('');

  $effect(() => {
    void supportsX25519().then((ok) => (x25519 = ok));
  });

  async function runAgreement(): Promise<void> {
    exchangeError = '';
    exchange = null;
    try {
      const result = await runExchange(curve);
      exchange = {
        alice: result.alice.publicKey,
        bob: result.bob.publicKey,
        shared: toHex(result.sharedFromAlice),
        match: result.match,
      };
    } catch (error) {
      exchangeError = error instanceof Error ? error.message : 'The exchange failed.';
    }
  }

  let demoA = $state(400);
  let demoB = $state(134);
  const demo = $derived(demonstrate(DEMO_PRIME, DEMO_GENERATOR, BigInt(demoA || 1), BigInt(demoB || 1)));

  /* ------------------------------------------------------------- bcrypt --- */

  let bcryptPassword = $state('');
  let bcryptCost = $state(10);
  let bcryptHash = $state('');
  let bcryptMs = $state(0);
  let bcryptTruncated = $state(false);
  let bcryptBusy = $state(false);
  let bcryptError = $state('');
  let verifyPasswordText = $state('');
  let verifyHash = $state('');
  let verifyResult = $state<'yes' | 'no' | ''>('');

  async function hashNow(): Promise<void> {
    bcryptError = '';
    bcryptBusy = true;
    try {
      const { hashPassword } = await import('../../lib/crypto/bcrypt');
      const result = await hashPassword(bcryptPassword, bcryptCost);
      bcryptHash = result.hash;
      bcryptMs = Math.round(result.ms);
      bcryptTruncated = result.truncated;
    } catch (error) {
      bcryptError = error instanceof Error ? error.message : 'bcrypt failed.';
    } finally {
      bcryptBusy = false;
    }
  }

  async function verifyNow(): Promise<void> {
    bcryptError = '';
    verifyResult = '';
    bcryptBusy = true;
    try {
      const { verifyPassword } = await import('../../lib/crypto/bcrypt');
      verifyResult = (await verifyPassword(verifyPasswordText, verifyHash)) ? 'yes' : 'no';
    } catch (error) {
      bcryptError = error instanceof Error ? error.message : 'That is not a bcrypt hash.';
    } finally {
      bcryptBusy = false;
    }
  }

  /* ---------------------------------------------------------------- otp --- */

  let padMessage = $state('');
  let padKey = $state('');
  let padCipher = $state('');
  let padError = $state('');

  function padEncrypt(): void {
    padError = '';
    try {
      const { key, data } = otp.encrypt(padMessage);
      padKey = encodeBytes(key);
      padCipher = encodeBytes(data);
    } catch (error) {
      padError = error instanceof Error ? error.message : 'That could not be encrypted.';
    }
  }
</script>

<div class="page-header">
  <h1>Encryption</h1>
  <p class="muted">
    AES, RSA, key agreement, bcrypt and a one-time pad — all in this tab, none of it stored.
  </p>
</div>

<div class="stack">
  {#if !secure}
    <p class="note warn" role="status" data-testid="enc-insecure">
      <strong>This page is not in a secure context</strong>, so <code>crypto.subtle</code> is missing and
      everything except the one-time pad and the teaching demonstration is unavailable. Open the app over
      <code>https:</code> or from <code>localhost</code>.
    </p>
  {/if}

  <p class="note" data-testid="enc-nothing-stored">
    <strong>Nothing on this page is saved.</strong> Passwords, keys, plaintexts and ciphertexts exist in
    this tab until you replace them or close it. There is no "save this key" button on purpose: a backup
    of this app is one plain JSON file, and a private key that reached it would live in your downloads
    folder forever.
  </p>

  <Card title="A password (AES-256-GCM)">
    <div class="stack">
      <div class="grid-2">
        <div class="field">
          <label for="enc-plaintext">Text to encrypt</label>
          <textarea id="enc-plaintext" data-testid="enc-plaintext" rows="4" bind:value={plaintext}></textarea>
        </div>
        <div class="stack">
          <div class="field">
            <label for="enc-password">Password</label>
            <input id="enc-password" data-testid="enc-password" type="text" autocomplete="off" bind:value={password} />
          </div>
          <div class="field">
            <label for="enc-iterations">PBKDF2 iterations</label>
            <input
              id="enc-iterations"
              data-testid="enc-iterations"
              type="number"
              min={MIN_ITERATIONS}
              max={MAX_ITERATIONS}
              step="10000"
              bind:value={iterations}
            />
            <p class="muted small">
              600 000 is the current guidance. Higher is slower for you and for anyone guessing.
            </p>
          </div>
        </div>
      </div>
      <div class="row">
        <button class="btn btn-primary" data-testid="enc-encrypt" disabled={aesBusy || !secure} onclick={doEncrypt}>
          {aesBusy ? 'Working…' : 'Encrypt'}
        </button>
        {#if bundle}
          <button class="btn btn-sm" data-testid="enc-copy-bundle" onclick={() => copy('bundle', bundle)}>
            {copied === 'bundle' ? 'Copied' : 'Copy'}
          </button>
        {/if}
      </div>
      {#if aesError}
        <p class="error small" role="alert" data-testid="enc-error">{aesError}</p>
      {/if}
      {#if bundle}
        <div class="field">
          <label for="enc-bundle">The encrypted bundle</label>
          <textarea id="enc-bundle" data-testid="enc-bundle" rows="4" readonly value={bundle}></textarea>
          <p class="muted small">
            The salt, the initialisation vector and the iteration count travel with the ciphertext, so
            this line is everything needed to decrypt it — given the password.
          </p>
        </div>
      {/if}
    </div>
  </Card>

  <Card title="Decrypt a bundle" collapsible open={false} testid="enc-decrypt-card">
    <div class="stack">
      <div class="field">
        <label for="enc-decrypt-bundle">Bundle</label>
        <textarea id="enc-decrypt-bundle" data-testid="enc-decrypt-bundle" rows="3" bind:value={decryptBundle}
        ></textarea>
      </div>
      <div class="field">
        <label for="enc-decrypt-password">Password</label>
        <input
          id="enc-decrypt-password"
          data-testid="enc-decrypt-password"
          type="text"
          autocomplete="off"
          bind:value={decryptPassword}
        />
      </div>
      <div class="row">
        <button class="btn" data-testid="enc-decrypt" disabled={aesBusy || !secure} onclick={doDecrypt}>
          {aesBusy ? 'Working…' : 'Decrypt'}
        </button>
      </div>
      {#if decryptError}
        <p class="error small" role="alert" data-testid="enc-decrypt-error">{decryptError}</p>
      {:else if decrypted}
        <div class="field">
          <label for="enc-decrypted">Plaintext</label>
          <textarea id="enc-decrypted" data-testid="enc-decrypted" rows="3" readonly value={decrypted}></textarea>
        </div>
      {/if}
    </div>
  </Card>

  <Card title="A key pair (RSA-OAEP)" collapsible open={false} testid="enc-rsa-card">
    <div class="stack">
      <div class="row">
        <div class="field">
          <label for="enc-rsa-bits">Key size</label>
          <select id="enc-rsa-bits" data-testid="enc-rsa-bits" bind:value={rsaBits}>
            {#each RSA_SIZES as size (size)}
              <option value={size}>{size} bits</option>
            {/each}
          </select>
        </div>
        <button class="btn btn-primary" data-testid="enc-rsa-generate" disabled={rsaBusy || !secure} onclick={makeKeys}>
          {rsaBusy ? 'Generating…' : 'Generate a pair'}
        </button>
        <p class="muted small">
          Carries at most <strong data-testid="enc-rsa-limit">{maxPlaintextBytes(rsaBits)}</strong> bytes.
        </p>
      </div>

      {#if rsaError}
        <p class="error small" role="alert" data-testid="enc-rsa-error">{rsaError}</p>
      {/if}

      {#if publicPem}
        <div class="grid-2">
          <div class="field">
            <label for="enc-rsa-public">Public key (PEM)</label>
            <textarea id="enc-rsa-public" data-testid="enc-rsa-public" rows="6" readonly value={publicPem}></textarea>
            <button class="btn btn-sm" data-testid="enc-rsa-copy-public" onclick={() => copy('pub', publicPem)}>
              {copied === 'pub' ? 'Copied' : 'Copy'}
            </button>
          </div>
          <div class="field">
            <label for="enc-rsa-private">Private key (PEM) — keep this one</label>
            <textarea id="enc-rsa-private" data-testid="enc-rsa-private" rows="6" readonly value={privatePem}
            ></textarea>
            <button class="btn btn-sm" data-testid="enc-rsa-copy-private" onclick={() => copy('priv', privatePem)}>
              {copied === 'priv' ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>

        <div class="field">
          <label for="enc-rsa-message">Message</label>
          <input id="enc-rsa-message" data-testid="enc-rsa-message" type="text" bind:value={rsaMessage} />
        </div>
        <div class="row">
          <button class="btn" data-testid="enc-rsa-encrypt" onclick={rsaEncryptNow}>Encrypt with the public key</button>
          <button class="btn" data-testid="enc-rsa-decrypt" disabled={!rsaCipher} onclick={rsaDecryptNow}>
            Decrypt with the private key
          </button>
        </div>
        {#if rsaCipher}
          <div class="field">
            <label for="enc-rsa-cipher">Ciphertext (base64)</label>
            <textarea id="enc-rsa-cipher" data-testid="enc-rsa-cipher" rows="3" readonly value={rsaCipher}></textarea>
          </div>
        {/if}
        {#if rsaPlain}
          <p data-testid="enc-rsa-plain">Decrypted: <strong>{rsaPlain}</strong></p>
        {/if}
      {/if}
    </div>
  </Card>

  <Card title="Key agreement (ECDH)" collapsible open={false} testid="enc-ecdh-card">
    <div class="stack">
      <div class="row">
        <div class="field">
          <label for="enc-curve">Curve</label>
          <select id="enc-curve" data-testid="enc-curve" bind:value={curve}>
            {#each CURVES as option (option)}
              <option value={option} disabled={option === 'X25519' && !x25519}>
                {option}{option === 'X25519' && !x25519 ? ' — not in this browser' : ''}
              </option>
            {/each}
          </select>
        </div>
        <button class="btn btn-primary" data-testid="enc-run-exchange" disabled={!secure} onclick={runAgreement}>
          Run the exchange
        </button>
      </div>

      {#if exchangeError}
        <p class="error small" role="alert" data-testid="enc-exchange-error">{exchangeError}</p>
      {:else if exchange}
        <div class="grid-2">
          <div class="field">
            <label for="enc-alice">Alice sends (public key)</label>
            <textarea id="enc-alice" data-testid="enc-alice" rows="3" readonly value={exchange.alice}></textarea>
          </div>
          <div class="field">
            <label for="enc-bob">Bob sends (public key)</label>
            <textarea id="enc-bob" data-testid="enc-bob" rows="3" readonly value={exchange.bob}></textarea>
          </div>
        </div>
        <p class="value" data-testid="enc-shared">Shared secret: {exchange.shared}</p>
        <p class="note" data-testid="enc-match">
          {exchange.match
            ? 'Both sides derived the same bytes without ever sending them. Everything above could be read by anyone in the middle; the secret below never travelled.'
            : 'The two sides disagreed, which should be impossible — do not trust this result.'}
        </p>
      {/if}

      <div class="demo">
        <h3>The same idea in numbers you can check</h3>
        <p class="note warn" data-testid="enc-demo-warning">
          <strong>A demonstration, not a cipher.</strong> The prime here is three digits, where working
          out the private exponent from the public value takes a fraction of a second. Real
          finite-field Diffie-Hellman needs a 2048-bit safe prime and parameter checks this does not do —
          which is also why WebCrypto has no finite-field DH at all.
        </p>
        <div class="row">
          <div class="field">
            <label for="enc-demo-a">Alice's secret exponent</label>
            <input id="enc-demo-a" data-testid="enc-demo-a" type="number" min="1" max="466" bind:value={demoA} />
          </div>
          <div class="field">
            <label for="enc-demo-b">Bob's secret exponent</label>
            <input id="enc-demo-b" data-testid="enc-demo-b" type="number" min="1" max="466" bind:value={demoB} />
          </div>
        </div>
        <dl class="working" data-testid="enc-demo">
          <div><dt>Public parameters</dt><dd>p = {demo.p}, g = {demo.g}</dd></div>
          <div><dt>Alice sends</dt><dd>{demo.g}^{demo.a} mod {demo.p} = {demo.publicA}</dd></div>
          <div><dt>Bob sends</dt><dd>{demo.g}^{demo.b} mod {demo.p} = {demo.publicB}</dd></div>
          <div>
            <dt>Alice computes</dt>
            <dd>{demo.publicB}^{demo.a} mod {demo.p} = <strong data-testid="enc-demo-secret-a">{demo.secretFromA}</strong></dd>
          </div>
          <div>
            <dt>Bob computes</dt>
            <dd>{demo.publicA}^{demo.b} mod {demo.p} = <strong data-testid="enc-demo-secret-b">{demo.secretFromB}</strong></dd>
          </div>
        </dl>
      </div>
    </div>
  </Card>

  <Card title="Password hashing (bcrypt)" collapsible open={false} testid="enc-bcrypt-card">
    <div class="stack">
      <div class="row">
        <div class="field grow">
          <label for="enc-bcrypt-password">Password</label>
          <input
            id="enc-bcrypt-password"
            data-testid="enc-bcrypt-password"
            type="text"
            autocomplete="off"
            bind:value={bcryptPassword}
          />
        </div>
        <div class="field">
          <label for="enc-bcrypt-cost">Cost ({bcryptCost})</label>
          <input
            id="enc-bcrypt-cost"
            data-testid="enc-bcrypt-cost"
            type="range"
            min="4"
            max="12"
            step="1"
            bind:value={bcryptCost}
          />
        </div>
        <button class="btn btn-primary" data-testid="enc-bcrypt-hash" disabled={bcryptBusy} onclick={hashNow}>
          {bcryptBusy ? 'Working…' : 'Hash'}
        </button>
      </div>
      <p class="muted small">
        Each step of the cost DOUBLES the work — cost 12 is four times cost 10, not twenty per cent
        more. It runs in a worker so the page stays usable while it does.
      </p>

      {#if bcryptError}
        <p class="error small" role="alert" data-testid="enc-bcrypt-error">{bcryptError}</p>
      {/if}
      {#if bcryptHash}
        <p class="value" data-testid="enc-bcrypt-hash-value">{bcryptHash}</p>
        <p class="muted small" data-testid="enc-bcrypt-time">Took {bcryptMs} ms at cost {bcryptCost}.</p>
        {#if bcryptTruncated}
          <p class="note warn" data-testid="enc-bcrypt-truncated">
            <strong>bcrypt read only the first 72 bytes of that.</strong> Everything after them is
            ignored — silently, in every implementation. A long passphrase needs pre-hashing before
            bcrypt sees it.
          </p>
        {/if}
      {/if}

      <div class="grid-2">
        <div class="field">
          <label for="enc-verify-password">Check a password…</label>
          <input id="enc-verify-password" data-testid="enc-verify-password" type="text" autocomplete="off" bind:value={verifyPasswordText} />
        </div>
        <div class="field">
          <label for="enc-verify-hash">…against a hash</label>
          <input id="enc-verify-hash" data-testid="enc-verify-hash" type="text" bind:value={verifyHash} />
        </div>
      </div>
      <div class="row">
        <button class="btn" data-testid="enc-verify" disabled={bcryptBusy} onclick={verifyNow}>Verify</button>
        {#if verifyResult}
          <p data-testid="enc-verify-result" class={verifyResult === 'yes' ? 'good' : 'bad'}>
            {verifyResult === 'yes' ? 'That password matches the hash.' : 'That password does not match.'}
          </p>
        {/if}
      </div>
    </div>
  </Card>

  <Card title="One-time pad" collapsible open={false} testid="enc-otp-card">
    <div class="stack">
      <p class="note warn" data-testid="enc-otp-rules">
        The only cipher with a proof of perfect secrecy, and the only one whose rules nobody can keep.
        It holds while <strong>the key is as long as the message</strong> (enforced here),
        <strong>the key is random</strong> (enforced here) and <strong>the key is never reused and
        reaches the other person some other way</strong> — which nothing on this page can enforce. Reuse
        one key twice and both messages fall out.
      </p>
      <div class="field">
        <label for="enc-otp-message">Message</label>
        <textarea id="enc-otp-message" data-testid="enc-otp-message" rows="3" bind:value={padMessage}></textarea>
      </div>
      <div class="row">
        <button class="btn btn-primary" data-testid="enc-otp-encrypt" onclick={padEncrypt}>Encrypt</button>
      </div>
      {#if padError}
        <p class="error small" role="alert" data-testid="enc-otp-error">{padError}</p>
      {/if}
      {#if padCipher}
        <div class="field">
          <label for="enc-otp-key">Key — as long as the message, used once</label>
          <textarea id="enc-otp-key" data-testid="enc-otp-key" rows="2" readonly value={padKey}></textarea>
        </div>
        <div class="field">
          <label for="enc-otp-cipher">Ciphertext</label>
          <textarea id="enc-otp-cipher" data-testid="enc-otp-cipher" rows="2" readonly value={padCipher}></textarea>
        </div>
      {/if}
    </div>
  </Card>

  <Explainer summary="What to use, and what this page is for" testid="explainer-encryption">
    <p>
      <strong>A password and some text?</strong> The AES-GCM card. It derives a key with PBKDF2, uses a
      fresh random IV, and authenticates — so a bundle that has been altered fails to decrypt instead of
      producing plausible nonsense.
    </p>
    <p>
      <strong>Sending something to someone with a public key?</strong> RSA, for at most 190 bytes at
      2048 bits. Beyond that everyone — TLS, PGP, age — encrypts a random AES key with RSA and the data
      with AES. That is not a workaround; it is the design.
    </p>
    <p>
      <strong>Agreeing a key over a channel someone is reading?</strong> ECDH. Both sides send a public
      value, both derive the same secret, and the secret never travels.
    </p>
    <p>
      <strong>Storing a password?</strong> bcrypt here, or Argon2id / scrypt / PBKDF2 elsewhere — never
      a plain SHA, however much salt is added to it.
    </p>
    <p>
      This page is for learning and for small one-off jobs. It is not a key-management system: it keeps
      nothing, remembers nothing, and has no idea whether the key you pasted is the right one.
    </p>
  </Explainer>
</div>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .field.grow {
    flex: 1 1 14rem;
  }

  textarea,
  input[type='text'],
  input[type='number'] {
    width: 100%;
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
  }

  textarea {
    resize: vertical;
    word-break: break-all;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    align-items: flex-end;
  }

  .small {
    font-size: var(--font-size-sm);
  }

  .value {
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
    word-break: break-all;
  }

  .note {
    border-left: 3px solid var(--color-stamp);
    padding: var(--space-2) var(--space-3);
    background: color-mix(in srgb, var(--color-stamp) 10%, transparent);
    font-size: var(--font-size-sm);
  }

  .note.warn {
    border-left-color: var(--color-danger);
    background: color-mix(in srgb, var(--color-danger) 10%, transparent);
  }

  .error {
    color: var(--color-danger);
  }

  .good {
    color: var(--color-success);
    font-weight: 700;
  }

  .bad {
    color: var(--color-danger);
    font-weight: 700;
  }

  .demo {
    border-top: 1px solid var(--border-color);
    padding-top: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .demo h3 {
    font-size: var(--font-size-sm);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
  }

  .working {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
  }

  .working > div {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
  }

  .working dt {
    min-width: 12rem;
    color: var(--text-muted-color);
  }
</style>
