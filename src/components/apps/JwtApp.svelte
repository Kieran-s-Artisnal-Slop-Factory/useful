<script lang="ts">
  /**
   * JWT — decode, verify, sign.
   *
   * Stateless: no token, key or secret is written anywhere. The page's job is
   * to keep one distinction visible at all times — decoding is not verifying —
   * because that is where every JWT incident starts.
   */
  import Card from '../Card.svelte';
  import CodeBlock from '../CodeBlock.svelte';
  import Explainer from '../Explainer.svelte';
  import { copyText } from '../../lib/exportFile';
  import { href } from '../../lib/paths';
  import {
    ALGORITHMS,
    algorithmById,
    claims as claimRows,
    decode,
    type JwtAlgorithm,
    pretty,
    sign,
    supported,
    validity,
    verify,
  } from '../../lib/crypto/jwt';

  /** The example from the specification's own tooling, signed with a known secret. */
  const EXAMPLE_TOKEN =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' +
    '.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ' +
    '.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
  const EXAMPLE_SECRET = 'your-256-bit-secret';

  let token = $state('');
  let secret = $state('');
  let pem = $state('');
  let verifyState = $state<{ valid: boolean; reason?: string } | null>(null);
  let verifyError = $state('');
  let signPayload = $state('{\n  "sub": "1234567890",\n  "name": "John Doe"\n}');
  let signAlgorithm = $state<JwtAlgorithm>('HS256');
  let signSecret = $state('a-secret-nobody-else-has');
  let signPem = $state('');
  let signed = $state('');
  let signError = $state('');
  let copied = $state('');
  let eddsa = $state(true);

  $effect(() => {
    void supported('EdDSA').then((ok) => (eddsa = ok));
  });

  const decoded = $derived.by(() => {
    if (token.trim() === '') return null;
    try {
      return { ok: true as const, value: decode(token) };
    } catch (error) {
      return { ok: false as const, message: error instanceof Error ? error.message : 'Not a JWT.' };
    }
  });

  const state = $derived(decoded?.ok ? validity(decoded.value.payload) : null);
  const rows = $derived(decoded?.ok ? claimRows(decoded.value.payload) : []);
  const algorithm = $derived(decoded?.ok ? decoded.value.algorithm : '');
  const def = $derived(algorithmById(algorithm));

  function loadExample(): void {
    token = EXAMPLE_TOKEN;
    secret = EXAMPLE_SECRET;
    verifyState = null;
    verifyError = '';
  }

  async function doVerify(): Promise<void> {
    verifyError = '';
    verifyState = null;
    try {
      verifyState = await verify(token, def?.symmetric === false ? { pem } : { secret });
    } catch (error) {
      verifyError = error instanceof Error ? error.message : 'That could not be verified.';
    }
  }

  async function doSign(): Promise<void> {
    signError = '';
    signed = '';
    try {
      const payload = JSON.parse(signPayload) as Record<string, unknown>;
      const key = algorithmById(signAlgorithm)?.symmetric ? { secret: signSecret } : { pem: signPem };
      signed = await sign(payload, key, signAlgorithm);
    } catch (error) {
      signError = error instanceof Error ? error.message : 'That could not be signed.';
    }
  }

  async function copy(id: string, text: string): Promise<void> {
    if (!text) return;
    if (await copyText(text)) {
      copied = id;
      setTimeout(() => (copied = ''), 1500);
    }
  }

  const show = (value: unknown): string =>
    typeof value === 'string' ? value : JSON.stringify(value);
</script>

<div class="page-header">
  <h1>JWT</h1>
  <p class="muted">Read a token, check its signature, or make one — none of it leaves the tab.</p>
</div>

<div class="stack">
  <Card title="Token">
    {#snippet actions()}
      <button class="btn btn-sm" data-testid="jwt-example" onclick={loadExample}>Load an example</button>
    {/snippet}
    <div class="field">
      <label for="jwt-token">Paste a JWT</label>
      <textarea id="jwt-token" data-testid="jwt-token" rows="4" spellcheck="false" bind:value={token}></textarea>
    </div>
  </Card>

  {#if decoded && !decoded.ok}
    <Card title="Decoded">
      <p class="error" role="alert" data-testid="jwt-error">{decoded.message}</p>
    </Card>
  {:else if decoded?.ok}
    <Card title="Decoded — not verified">
      <div class="stack">
        <p class="note" data-testid="jwt-not-verified">
          <strong>This is what the token says about itself.</strong> Anyone holding it can read this —
          a JWT payload is base64url, not encryption. Nothing here is evidence of anything until the
          signature has been checked against a key you trust, below.
        </p>

        <div class="grid-2">
          <div>
            <span class="eyebrow">Header</span>
            <CodeBlock code={pretty(decoded.value.header)} language="json" testid="jwt-header" maxHeight="10rem" />
          </div>
          <div>
            <span class="eyebrow">Payload</span>
            <CodeBlock code={pretty(decoded.value.payload)} language="json" testid="jwt-payload" maxHeight="10rem" />
          </div>
        </div>

        <p class="row">
          <span class="eyebrow">Algorithm</span>
          <strong data-testid="jwt-alg">{algorithm || '—'}</strong>
          <span class="muted small">{def?.description ?? 'Not an algorithm this tool knows.'}</span>
        </p>

        {#if algorithm === 'none'}
          <p class="note warn" data-testid="jwt-none-warning">
            <strong>alg: none</strong> means an unsigned token. Nothing can verify it, and a library
            that accepts one accepts whatever anybody sends it.
          </p>
        {/if}

        <p
          class="badge"
          class:bad={state?.expired || state?.notYetValid}
          data-testid="jwt-validity"
        >
          {state?.summary}
        </p>

        {#if rows.length > 0}
          <div class="table-wrap">
            <table class="data-table">
              <caption class="sr-only">The claims in this token</caption>
              <thead>
                <tr><th scope="col">Claim</th><th scope="col">Value</th><th scope="col">Meaning</th></tr>
              </thead>
              <tbody>
                {#each rows as row (row.name)}
                  <tr data-testid={`jwt-claim-${row.name}`}>
                    <th scope="row">{row.name}</th>
                    <td>{show(row.value)}</td>
                    <td class="muted">{row.detail ?? row.label}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>
    </Card>

    <Card title="Verify">
      <div class="stack">
        {#if def?.symmetric === false}
          <div class="field">
            <label for="jwt-pem">Public key (PEM)</label>
            <textarea id="jwt-pem" data-testid="jwt-pem" rows="5" spellcheck="false" bind:value={pem}></textarea>
          </div>
        {:else}
          <div class="field">
            <label for="jwt-secret">Shared secret</label>
            <input id="jwt-secret" data-testid="jwt-secret" type="text" autocomplete="off" bind:value={secret} />
          </div>
        {/if}
        <div class="row">
          <button class="btn btn-primary" data-testid="jwt-verify" onclick={doVerify}>Check the signature</button>
        </div>
        {#if verifyError}
          <p class="error small" role="alert" data-testid="jwt-verify-error">{verifyError}</p>
        {:else if verifyState}
          <p
            class="badge"
            class:good={verifyState.valid}
            class:bad={!verifyState.valid}
            data-testid="jwt-verify-result"
          >
            {verifyState.valid
              ? 'Signature verified — this token was signed with that key and has not been altered since.'
              : verifyState.reason}
          </p>
        {/if}
      </div>
    </Card>
  {/if}

  <Card title="Sign a new token" collapsible open={false} testid="jwt-sign-card">
    <div class="stack">
      <div class="row">
        <div class="field">
          <label for="jwt-sign-alg">Algorithm</label>
          <select id="jwt-sign-alg" data-testid="jwt-sign-alg" bind:value={signAlgorithm}>
            {#each ALGORITHMS as entry (entry.id)}
              <option value={entry.id} disabled={entry.id === 'EdDSA' && !eddsa}>
                {entry.id}{entry.id === 'EdDSA' && !eddsa ? ' — not in this browser' : ''}
              </option>
            {/each}
          </select>
        </div>
      </div>
      <div class="field">
        <label for="jwt-sign-payload">Payload (JSON)</label>
        <textarea id="jwt-sign-payload" data-testid="jwt-sign-payload" rows="6" spellcheck="false" bind:value={signPayload}
        ></textarea>
      </div>
      {#if algorithmById(signAlgorithm)?.symmetric}
        <div class="field">
          <label for="jwt-sign-secret">Shared secret</label>
          <input id="jwt-sign-secret" data-testid="jwt-sign-secret" type="text" autocomplete="off" bind:value={signSecret} />
        </div>
      {:else}
        <div class="field">
          <label for="jwt-sign-pem">Private key (PEM)</label>
          <textarea id="jwt-sign-pem" data-testid="jwt-sign-pem" rows="5" spellcheck="false" bind:value={signPem}></textarea>
          <p class="muted small">
            Generate one on the <a href={href('/tools/encryption/')}>Encryption</a> page, or paste
            your own.
          </p>
        </div>
      {/if}
      <div class="row">
        <button class="btn btn-primary" data-testid="jwt-sign" onclick={doSign}>Sign</button>
        {#if signed}
          <button class="btn btn-sm" data-testid="jwt-copy" onclick={() => copy('token', signed)}>
            {copied === 'token' ? 'Copied' : 'Copy'}
          </button>
        {/if}
      </div>
      {#if signError}
        <p class="error small" role="alert" data-testid="jwt-sign-error">{signError}</p>
      {:else if signed}
        <div class="field">
          <label for="jwt-signed">The token</label>
          <textarea id="jwt-signed" data-testid="jwt-signed" rows="4" readonly value={signed}></textarea>
        </div>
      {/if}
    </div>
  </Card>

  <Explainer summary="The three things that go wrong with JWTs" testid="explainer-jwt">
    <p>
      <strong>A payload is not private.</strong> It is base64url — this page decoded yours without a key,
      and so can anyone else who has the token. Never put anything in a JWT that the holder should not
      read.
    </p>
    <p>
      <strong>`alg: none` was in the original specification.</strong> Libraries that honoured it would
      accept a token with the signature removed and the algorithm changed. Nothing here will verify one,
      and any library you use should be pinned to the algorithm you expect rather than trusting the
      header.
    </p>
    <p>
      <strong>Algorithm confusion.</strong> A verifier that reads `alg` from the token and holds an RSA
      public key can be handed an `HS256` token instead — and will use the PUBLIC key as an HMAC
      secret. The key is public, so anyone can forge tokens that pass. This tool refuses that shape by
      name.
    </p>
    <p>
      Two more worth knowing: a token cannot be revoked before it expires unless something keeps a list,
      and `exp` is checked by the receiver — an expired token is only rejected because someone bothered
      to look.
    </p>
  </Explainer>
</div>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  textarea,
  input[type='text'] {
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
    align-items: center;
  }

  .small {
    font-size: var(--font-size-sm);
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

  .badge {
    display: inline-block;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border-strong-color);
    font-size: var(--font-size-sm);
  }

  .badge.good {
    border-color: var(--color-success);
    background: color-mix(in srgb, var(--color-success) 12%, transparent);
  }

  .badge.bad {
    border-color: var(--color-danger);
    background: color-mix(in srgb, var(--color-danger) 12%, transparent);
  }

  .error {
    color: var(--color-danger);
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
