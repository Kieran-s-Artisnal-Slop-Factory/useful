<script lang="ts">
  /**
   * Hashing — every digest in the catalogue, computed as you type.
   *
   * Writes NOTHING, ever: not the message, not the salt, not the pepper, not
   * the key. The spec asserts the database is byte-identical across a whole
   * session, the same way the secrets page does.
   */
  import Card from '../Card.svelte';
  import Explainer from '../Explainer.svelte';
  import { copyText } from '../../lib/exportFile';
  import {
    available,
    composeInput,
    digest,
    formats,
    type HashId,
    HASHES,
    hashById,
    hmac,
    subtleAvailable,
  } from '../../lib/hash/index';
  import { randomBytes, toHex } from '../../lib/gen/secrets';

  type Format = 'hex' | 'hexUpper' | 'base64' | 'base64url' | 'grouped';

  let message = $state('');
  let salt = $state('');
  let pepper = $state('');
  let saltPosition = $state<'prefix' | 'suffix'>('prefix');
  let format = $state<Format>('hex');
  let shakeBytes = $state(32);
  let hmacKey = $state('');
  let hmacAlgorithm = $state<HashId>('sha256');
  let copied = $state('');

  /** Debounced copies: a digest per keystroke over twelve algorithms is work. */
  let value = $state('');
  let saltValue = $state('');
  let pepperValue = $state('');

  let digests = $state<Record<string, string>>({});
  let hmacValue = $state('');
  let hmacError = $state('');

  const secure = subtleAvailable();
  const composed = $derived(
    composeInput({ message: value, salt: saltValue, pepper: pepperValue, saltPosition })
  );

  $effect(() => {
    const next = { message, salt, pepper };
    const handle = setTimeout(() => {
      value = next.message;
      saltValue = next.salt;
      pepperValue = next.pepper;
    }, 150);
    return () => clearTimeout(handle);
  });

  // Recompute every digest whenever the composed input, the format or the
  // SHAKE length changes. Each effect has its OWN sequence counter: sharing
  // one would let a digest run invalidate an HMAC result that was still
  // current, and the symptom would be an empty field nobody could explain.
  let digestToken = 0;
  let hmacToken = 0;
  $effect(() => {
    const input = composed.bytes;
    const shape = format;
    const shakeLength = shakeBytes;
    const mine = ++digestToken;
    void (async () => {
      const out: Record<string, string> = {};
      for (const def of HASHES) {
        if (!available(def.id)) continue;
        try {
          const bytes = await digest(def.id, input, def.bits === 0 ? shakeLength : undefined);
          out[def.id] = formats(bytes)[shape];
        } catch {
          // An unavailable algorithm is reported by `available`, not here.
        }
      }
      if (mine === digestToken) digests = out;
    })();
  });

  $effect(() => {
    const key = hmacKey;
    const id = hmacAlgorithm;
    const input = composed.bytes;
    const shape = format;
    const mine = ++hmacToken;
    void (async () => {
      if (key === '') {
        if (mine === hmacToken) {
          hmacValue = '';
          hmacError = '';
        }
        return;
      }
      try {
        const bytes = await hmac(id, new TextEncoder().encode(key), input);
        if (mine === hmacToken) {
          hmacValue = formats(bytes)[shape];
          hmacError = '';
        }
      } catch (error) {
        if (mine === hmacToken) {
          hmacValue = '';
          hmacError = error instanceof Error ? error.message : 'That HMAC could not be computed.';
        }
      }
    })();
  });

  async function copy(id: string, text: string): Promise<void> {
    if (text === '') return;
    if (await copyText(text)) {
      copied = id;
      setTimeout(() => (copied = ''), 1500);
    }
  }

  function randomSalt(): void {
    salt = toHex(randomBytes(16));
  }

  const hmacable = $derived(HASHES.filter((def) => def.bits > 0 && available(def.id)));
</script>

<div class="page-header">
  <h1>Hashing</h1>
  <p class="muted">Twelve digests of the same message, computed in this tab and stored nowhere.</p>
</div>

<div class="stack">
  {#if !secure}
    <p class="note warn" role="status" data-testid="hash-insecure">
      <strong>This page is not in a secure context</strong>, so <code>crypto.subtle</code> is missing —
      SHA-1, SHA-384 and SHA-512 are unavailable here. MD5, SHA-224, SHA-256, SHA-3 and SHAKE are this
      app's own implementations and work anyway. Open the app over <code>https:</code> or from
      <code>localhost</code> for the rest.
    </p>
  {/if}

  <Card title="Message">
    <div class="stack">
      <div class="field">
        <label for="hash-input">Text to hash</label>
        <textarea id="hash-input" data-testid="hash-input" rows="5" spellcheck="false" bind:value={message}
        ></textarea>
      </div>
      <div class="controls">
        <div class="field grow">
          <label for="hash-salt">Salt</label>
          <div class="pair">
            <input id="hash-salt" data-testid="hash-salt" type="text" spellcheck="false" bind:value={salt} />
            <button class="btn btn-sm" data-testid="hash-salt-random" onclick={randomSalt}>Random</button>
          </div>
        </div>
        <div class="field">
          <label for="hash-salt-position">Salt goes</label>
          <select id="hash-salt-position" data-testid="hash-salt-position" bind:value={saltPosition}>
            <option value="prefix">Before the message</option>
            <option value="suffix">After the message</option>
          </select>
        </div>
        <div class="field grow">
          <label for="hash-pepper">Pepper</label>
          <input id="hash-pepper" data-testid="hash-pepper" type="text" spellcheck="false" bind:value={pepper} />
        </div>
      </div>
      <p class="formula" data-testid="hash-formula">{composed.formula}</p>
      <p class="muted small">
        There is no standard order for these, which is why the formula above says the one being used.
        A pepper is a secret that lives with the application rather than with the data — it only helps
        while it stays out of the same database.
      </p>
    </div>
  </Card>

  <Card title="Digests">
    {#snippet actions()}
      <label class="inline">
        <span>Show as</span>
        <select data-testid="hash-format" aria-label="Output format" bind:value={format}>
          <option value="hex">hex</option>
          <option value="hexUpper">HEX</option>
          <option value="base64">base64</option>
          <option value="base64url">base64url</option>
          <option value="grouped">hex, grouped</option>
        </select>
      </label>
      <label class="inline">
        <span>SHAKE bytes</span>
        <input
          type="number"
          min="1"
          max="512"
          data-testid="hash-shake-bytes"
          aria-label="SHAKE output length in bytes"
          bind:value={shakeBytes}
        />
      </label>
    {/snippet}
    <div class="stack">
      {#each HASHES as def (def.id)}
        <div class="digest" data-testid="hash-row" data-algo={def.id} class:unavailable={!available(def.id)}>
          <div class="head">
            <span class="eyebrow">{def.name}</span>
            <span class="muted small">
              {def.bits > 0 ? `${def.bits}-bit` : 'variable'} ·
              {def.source === 'platform' ? 'WebCrypto' : "this app's own"}
            </span>
            <button
              class="btn btn-sm"
              data-testid={`hash-copy-${def.id}`}
              disabled={!digests[def.id]}
              onclick={() => copy(def.id, digests[def.id] ?? '')}
            >
              {copied === def.id ? 'Copied' : 'Copy'}
            </button>
          </div>
          {#if available(def.id)}
            <p class="value" data-testid={`hash-value-${def.id}`}>{digests[def.id] ?? ''}</p>
          {:else}
            <p class="muted small" data-testid={`hash-missing-${def.id}`}>
              Needs <code>crypto.subtle</code>, which this context does not have.
            </p>
          {/if}
          {#if def.warning}
            <p class="warning small" data-testid={`hash-warning-${def.id}`}>{def.warning}</p>
          {/if}
        </div>
      {/each}
    </div>
  </Card>

  <Card title="HMAC">
    <div class="stack">
      <div class="controls">
        <div class="field grow">
          <label for="hash-hmac-key">Key</label>
          <input id="hash-hmac-key" data-testid="hash-hmac-key" type="text" spellcheck="false" bind:value={hmacKey} />
        </div>
        <div class="field">
          <label for="hash-hmac-algo">Algorithm</label>
          <select id="hash-hmac-algo" data-testid="hash-hmac-algo" bind:value={hmacAlgorithm}>
            {#each hmacable as def (def.id)}
              <option value={def.id}>{def.name}</option>
            {/each}
          </select>
        </div>
      </div>
      {#if hmacError}
        <p class="error small" role="alert" data-testid="hash-hmac-error">{hmacError}</p>
      {:else if hmacValue}
        <p class="value" data-testid="hash-hmac-value">{hmacValue}</p>
        <button class="btn btn-sm" data-testid="hash-hmac-copy" onclick={() => copy('hmac', hmacValue)}>
          {copied === 'hmac' ? 'Copied' : 'Copy'}
        </button>
      {:else}
        <p class="muted small" data-testid="hash-hmac-empty">
          A key turns a hash into a message authentication code: only someone with the key can produce
          or check it.
        </p>
      {/if}
    </div>
  </Card>

  <Card title="Not password storage">
    <div class="stack">
      <p class="note warn" data-testid="hash-password-note">
        <strong>A salted SHA-256 is not a way to store passwords.</strong> These algorithms are built to
        be fast, and fast is exactly wrong for a password: a consumer graphics card gets through
        billions of SHA-256 guesses a second, and a salt does nothing about that — it only stops one
        table of precomputed hashes covering every account at once.
      </p>
      <p class="small">
        What to use instead, in order of preference: <strong>Argon2id</strong>, <strong>scrypt</strong>,
        <strong>bcrypt</strong> (the encryption page has one), or <strong>PBKDF2</strong> with a high
        iteration count, which is the one WebCrypto has built in. All four are deliberately slow and
        take a work factor you can raise as hardware gets faster.
      </p>
      <p class="small muted">
        If you are hashing a password to compare against something a framework produced, find out which
        of these it used — the answer is never a bare SHA.
      </p>
    </div>
  </Card>

  <Explainer summary="Which of these should I use?" testid="explainer-hashes">
    <p>
      For anything new: <strong>SHA-256</strong>. It is fast, everywhere, and unbroken.
      <strong>SHA-512</strong> is faster on 64-bit machines and gives a longer digest;
      <strong>SHA-384</strong> is SHA-512 truncated, which is what makes it immune to the
      length-extension trick the others are vulnerable to.
    </p>
    <p>
      <strong>SHA-3</strong> is not a newer SHA-2 — it is a different construction (a sponge, over the
      Keccak permutation) picked so that a break in SHA-2 would not carry over. Use it when a standard
      or a protocol asks for it. <strong>SHAKE</strong> is the same sponge with an output length you
      choose, which is what makes it useful for deriving keys and fingerprints of an unusual size.
    </p>
    <p>
      <strong>MD5</strong> and <strong>SHA-1</strong> are here because the world is full of them, and
      both are broken for anything an adversary can influence. A checksum against accidental corruption
      is fine; a signature, a password, or deduplicating files someone else supplied is not.
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
  input[type='text'] {
    width: 100%;
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
  }

  textarea {
    resize: vertical;
  }

  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
    align-items: flex-end;
  }

  .pair {
    display: flex;
    gap: var(--space-2);
  }

  .pair input {
    flex: 1 1 auto;
  }

  .inline {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--font-size-sm);
  }

  .inline input[type='number'] {
    width: 5rem;
  }

  .small {
    font-size: var(--font-size-sm);
  }

  .formula {
    font-family: var(--font-mono);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border-color);
    background: var(--surface-raised-color);
  }

  .digest {
    border-bottom: 1px solid var(--border-color);
    padding-bottom: var(--space-3);
  }

  .digest:last-child {
    border-bottom: none;
    padding-bottom: 0;
  }

  .digest.unavailable {
    opacity: 0.65;
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .head .btn {
    margin-left: auto;
  }

  .value {
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
    word-break: break-all;
    margin-top: var(--space-1);
  }

  .warning {
    color: var(--color-warning);
    margin-top: var(--space-1);
  }

  .error {
    color: var(--color-danger);
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
</style>
