<script lang="ts">
  import { onMount } from 'svelte';
  import Card from '../Card.svelte';
  import Explainer from '../Explainer.svelte';
  import { copyText } from '../../lib/exportFile';
  import { GROUPS, SECRETS, setWordList, wordListReady, type SecretDef } from '../../lib/gen/secrets';

  /**
   * Keys, secrets and passwords, generated in this tab and stored nowhere.
   *
   * Every card holds its own value and its own option; regenerating replaces
   * the value in place. Nothing is written to the database, nothing is put in
   * the URL, and nothing is logged — the only way a value leaves is the copy
   * button.
   */

  interface CardState {
    value: string;
    option: number | string | undefined;
    error: string | null;
  }

  /** One state entry per generator, keyed by id. */
  let cards = $state<Record<string, CardState>>(
    Object.fromEntries(
      SECRETS.map((def) => [def.id, { value: '', option: def.option?.value, error: null }])
    )
  );

  let copiedId = $state<string | null>(null);
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  let wordsReady = $state(false);

  function regenerate(def: SecretDef) {
    const card = cards[def.id]!;
    try {
      card.value = def.generate(card.option);
      card.error = null;
    } catch (err) {
      card.value = '';
      card.error = err instanceof Error ? err.message : 'Could not generate that.';
    }
  }

  function regenerateAll() {
    for (const def of SECRETS) {
      // The passphrase card waits for its word list rather than inventing one.
      if (def.id === 'memorable' && !wordListReady()) continue;
      regenerate(def);
    }
  }

  async function copy(def: SecretDef) {
    const ok = await copyText(cards[def.id]!.value);
    copiedId = ok ? def.id : null;
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (copiedId = null), 1500);
  }

  function setOption(def: SecretDef, raw: string) {
    const card = cards[def.id]!;
    if (def.option?.kind === 'number') {
      const n = Math.round(Number(raw));
      if (!Number.isFinite(n)) return;
      card.option = Math.min(def.option.max, Math.max(def.option.min, n));
    } else {
      card.option = raw;
    }
    regenerate(def);
  }

  /**
   * '' while a generator cannot say yet — the card is showing why.
   *
   * `ready` is passed in rather than read inside: the passphrase's entropy
   * depends on a list that arrives later, and that list lives in a plain module
   * variable. Taking it as an argument is what makes this recompute when it
   * lands.
   */
  const bitsLabel = (def: SecretDef, ready: boolean): string => {
    void ready;
    const bits = def.bits(cards[def.id]!.option);
    if (bits === null) return 'identifier — unique, not secret';
    return bits > 0 ? `${bits} bits of entropy` : '';
  };

  const inGroup = (group: string): SecretDef[] => SECRETS.filter((s) => s.group === group);

  onMount(() => {
    // Fill every card at once so the page is useful the moment it opens.
    regenerateAll();
    // The 7,776-word list is 78 KB and only the passphrase card needs it, so it
    // arrives separately rather than in the page's own bundle.
    void import('../../lib/gen/wordlist.json').then((mod) => {
      setWordList((mod.default as { words: string[] }).words);
      wordsReady = true;
      regenerate(SECRETS.find((s) => s.id === 'memorable')!);
    });
  });
</script>

<div class="page-header">
  <h1>Secrets</h1>
  <button class="btn btn-sm" data-testid="sec-regen-all" onclick={regenerateAll}>Regenerate all</button>
</div>

<div class="stack">
  <p class="muted">
    Generated in this tab with your browser's own cryptographic random source. Nothing here is
    stored, sent anywhere, or put in the address bar — leave the page and these values are gone.
    Copy what you need before you go.
  </p>

  {#each GROUPS as group (group)}
    <Card title={group}>
      <div class="stack">
        {#each inGroup(group) as def (def.id)}
          <div class="secret" data-testid={'sec-card-' + def.id}>
            <div class="row head">
              <h3 class="name">{def.name}</h3>
              {#if bitsLabel(def, wordsReady)}
                <span class="muted small bits" data-testid={'sec-bits-' + def.id}>
                  {bitsLabel(def, wordsReady)}{def.id === 'backup-codes' ? ' per code' : ''}
                </span>
              {/if}
            </div>
            <p class="muted small purpose">{def.purpose}</p>
            <div class="row controls">
              {#if def.option}
                <label class="inline" for={'sec-opt-' + def.id}>{def.option.label}</label>
                {#if def.option.kind === 'number'}
                  <input
                    id={'sec-opt-' + def.id}
                    data-testid={'sec-opt-' + def.id}
                    class="num"
                    type="number"
                    min={def.option.min}
                    max={def.option.max}
                    value={cards[def.id]!.option}
                    onchange={(e) => setOption(def, e.currentTarget.value)}
                  />
                {:else}
                  <select
                    id={'sec-opt-' + def.id}
                    data-testid={'sec-opt-' + def.id}
                    value={cards[def.id]!.option}
                    onchange={(e) => setOption(def, e.currentTarget.value)}
                  >
                    {#each def.option.choices as choice (choice.value)}
                      <option value={choice.value}>{choice.label}</option>
                    {/each}
                  </select>
                {/if}
              {/if}
              <span class="spacer"></span>
              <button
                class="btn btn-sm"
                data-testid={'sec-regen-' + def.id}
                onclick={() => regenerate(def)}
              >
                Regenerate
              </button>
              <button
                class="btn btn-sm"
                data-testid={'sec-copy-' + def.id}
                disabled={!cards[def.id]!.value}
                onclick={() => copy(def)}
              >
                {copiedId === def.id ? 'Copied' : 'Copy'}
              </button>
            </div>
            {#if cards[def.id]!.error}
              <p class="form-error" data-testid={'sec-error-' + def.id}>{cards[def.id]!.error}</p>
            {:else if def.id === 'memorable' && !wordsReady}
              <p class="muted small" data-testid={'sec-value-' + def.id}>Loading the word list…</p>
            {:else}
              <output
                class="value mono"
                data-testid={'sec-value-' + def.id}
                aria-label={def.name + ' value'}>{cards[def.id]!.value}</output
              >
            {/if}
          </div>
        {/each}
      </div>
    </Card>
  {/each}

  <Explainer summary="What the entropy number means">
    <p>
      Entropy is how many yes/no questions an attacker would have to get right to guess the value:
      <em>n</em> bits means 2<sup>n</sup> equally likely possibilities. It is computed from the
      alphabet and the length actually used, so changing the length changes the number.
    </p>
    <p>
      As a rough guide: under 50 bits is guessable by anyone who cares, 80 bits or so resists an
      attacker with real hardware, and 128 bits is past the point where guessing is the weak link —
      after that, the risk is where the value is stored, not how it was made.
    </p>
    <p>
      An <strong>identifier</strong> is not a secret. A UUID is unique, not unguessable: it is fine
      as a database key or a filename, and a poor choice for a session token or a password reset
      link.
    </p>
  </Explainer>

  <Explainer summary="Signing secrets, keys and pairs">
    <p>
      A <strong>JWT signing secret</strong> is an HMAC key, not a password. RFC 7518 asks for a key
      at least as long as the hash — 32 bytes for HS256, 48 for HS384, 64 for HS512 — which is why
      these come out as base64 bytes rather than typeable characters. A 16-character password used
      as an HS256 secret is roughly 103 bits against a token an attacker can grind offline.
    </p>
    <p>
      RS256 and ES256 do not use a secret at all: they need a public/private <em>key pair</em>,
      which has to be generated by a tool that can do RSA or elliptic-curve maths (<code
        >openssl genpkey</code
      > and friends). This tool will not pretend to make one.
    </p>
  </Explainer>

  <Explainer summary="Wi-Fi, and why there is no WEP here">
    <p>
      The Wi-Fi generator makes a WPA2/WPA3 pre-shared key: 8 to 63 characters, from a set chosen to
      be typeable on a TV remote or a games console. Twenty characters is about 124 bits, which is
      far past what a wireless attacker can grind.
    </p>
    <p>
      <strong>WEP is not offered.</strong> Its RC4 keystream repeats often enough that a WEP network
      has been breakable in minutes since 2007, at any key length. A generator for it would only help
      somebody configure something already broken.
    </p>
  </Explainer>

  <Explainer summary="Where these come from">
    <p>
      Every value is drawn from <code>crypto.getRandomValues</code>, the browser's cryptographic
      random source — never <code>Math.random</code>, which is predictable by design. Characters are
      chosen by rejection sampling, so each one is equally likely: taking a random byte modulo an
      88-character alphabet would quietly make the first 80 characters half again as likely as the
      last 8.
    </p>
    <p>
      The passphrase words are the
      <a href="https://www.eff.org/dice" rel="noreferrer">EFF Long Wordlist</a> (7,776 words, CC BY
      3.0 US), chosen for words that are easy to type and hard to mishear.
    </p>
  </Explainer>
</div>

<style>
  .page-header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .secret {
    border-bottom: 1px dashed var(--border-color);
    padding-bottom: var(--space-3);
  }

  .secret:last-child {
    border-bottom: none;
    padding-bottom: 0;
  }

  .head {
    align-items: baseline;
    gap: var(--space-2);
  }

  .name {
    font-size: var(--font-size-base);
    letter-spacing: var(--tracking-wide);
  }

  .bits {
    white-space: nowrap;
  }

  .purpose {
    margin: var(--space-1) 0;
  }

  .controls {
    align-items: center;
    margin-bottom: var(--space-2);
  }

  .spacer {
    flex: 1 1 auto;
  }

  .num {
    width: 5rem;
  }

  .inline {
    white-space: nowrap;
  }

  .value {
    display: block;
    width: 100%;
    padding: var(--space-2);
    border: 1.5px solid var(--border-strong-color);
    background: var(--surface-raised-color);
    word-break: break-all;
    white-space: pre-wrap;
    user-select: all;
  }

  .mono {
    font-family: var(--font-mono);
  }
</style>
