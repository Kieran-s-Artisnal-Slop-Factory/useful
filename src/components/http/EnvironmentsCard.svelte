<script lang="ts">
  /**
   * Environments, their variables, and their secrets (0.4.0 plan, Phase 4,
   * items 2, 4 and 5).
   *
   * The two tables here look alike and are not. Variables are rows in
   * `http_environments`, which rides every backup. Secrets are rows in
   * `http_secrets`, which is local-only and rides none. That difference is
   * the feature, so the page states it in plain words next to the table
   * rather than in a doc nobody opens — "secret" is a word people reasonably
   * read as "encrypted", and it does not mean that here.
   *
   * A revealed secret is revealed one row at a time and goes back to masked
   * on any change of environment. There is no "reveal all".
   */
  import { GLOBAL_ID, GLOBAL_NAME } from '../../lib/http/env';
  import { MASK, type HttpSecret } from '../../lib/http/secrets';

  export interface EnvView {
    id: string;
    name: string;
    values: Record<string, unknown>;
  }

  let {
    environments,
    secrets,
    /** Which environment's contents are being edited. */
    editingId,
    onEditEnvironment,
    onCreateEnvironment,
    onRenameEnvironment,
    onDeleteEnvironment,
    onExportEnvironment,
    onSetVariable,
    onRemoveVariable,
    onSetSecret,
    onRemoveSecret,
    /**
     * A row to go to, set when someone clicks a placeholder in the pre-send
     * panel. `nonce` is what makes clicking the SAME row twice work — the
     * value is otherwise unchanged, so nothing would re-run.
     */
    highlight = null,
  }: {
    environments: EnvView[];
    secrets: HttpSecret[];
    editingId: string;
    onEditEnvironment: (id: string) => void;
    onCreateEnvironment: (name: string) => void;
    onRenameEnvironment: (id: string, name: string) => void;
    onDeleteEnvironment: (id: string) => void;
    onExportEnvironment: (id: string) => void;
    onSetVariable: (id: string, name: string, value: string) => void;
    onRemoveVariable: (id: string, name: string) => void;
    onSetSecret: (environmentId: string | null, name: string, value: string) => void;
    onRemoveSecret: (secretId: string) => void;
    highlight?: { name: string; secret: boolean; nonce: number } | null;
  } = $props();

  let newEnvName = $state('');
  let newVarName = $state('');
  let newVarValue = $state('');
  let newSecretName = $state('');
  let newSecretValue = $state('');
  let revealed = $state<string | null>(null);

  const editing = $derived(environments.find((env) => env.id === editingId) ?? environments[0]);
  const isGlobal = $derived(editing?.id === GLOBAL_ID);
  /** Global's secrets are the ones with no environment; every other has its id. */
  const secretScopeId = $derived(isGlobal ? null : (editing?.id ?? null));
  const scopeSecrets = $derived(
    secrets
      .filter((row) => row.environment_id === secretScopeId)
      .sort((a, b) => a.name.localeCompare(b.name))
  );
  const variables = $derived(
    Object.entries(editing?.values ?? {}).sort(([a], [b]) => a.localeCompare(b))
  );

  /** A revealed secret must not stay revealed once the scope changes. */
  $effect(() => {
    void editingId;
    revealed = null;
  });

  /** The id of a row, built the same way by the markup and by the jump. */
  const rowId = (name: string, secret: boolean): string =>
    `${secret ? 'hp-secret-row' : 'hp-var-row'}-${name}`;

  /**
   * Take the reader to a row and make it obvious which one.
   *
   * `getElementById` rather than a selector, because a variable name is
   * user-supplied and may contain characters that would need CSS escaping.
   *
   * The flash is two pulses of a CSS animation, restarted by removing and
   * re-adding the class — assigning the same class name again is a no-op to
   * the browser, so a second click on the same row would do nothing visible.
   * Under `prefers-reduced-motion` the scroll still happens and the animation
   * does not; that is handled in the stylesheet rather than here, so there is
   * one place that decides.
   */
  $effect(() => {
    const target = highlight;
    if (!target) return;
    // Read `nonce` so a repeat click on the same row re-runs this.
    void target.nonce;
    const element = document.getElementById(rowId(target.name, target.secret));
    if (!element) return;
    element.scrollIntoView({ block: 'center', behavior: 'smooth' });
    element.classList.remove('flash');
    // Force a reflow so the removal lands before the class goes back on.
    void element.offsetWidth;
    element.classList.add('flash');
    // Focus the field, so the jump ends somewhere you can immediately type —
    // and so the keyboard path arrives in the same place the pointer one does.
    element.querySelector<HTMLElement>('input, button')?.focus({ preventScroll: true });
  });

  const asText = (value: unknown): string =>
    typeof value === 'string' ? value : JSON.stringify(value);

  function addEnvironment() {
    const name = newEnvName.trim();
    if (name === '') return;
    onCreateEnvironment(name);
    newEnvName = '';
  }

  function addVariable() {
    const name = newVarName.trim();
    if (name === '' || !editing) return;
    onSetVariable(editing.id, name, newVarValue);
    newVarName = '';
    newVarValue = '';
  }

  function addSecret() {
    const name = newSecretName.trim();
    if (name === '' || newSecretValue === '') return;
    onSetSecret(secretScopeId, name, newSecretValue);
    newSecretName = '';
    newSecretValue = '';
  }
</script>

<div class="stack">
  <div class="row wrap">
    <label class="inline" for="hp-env-edit">Editing</label>
    <select
      id="hp-env-edit"
      data-testid="hp-env-edit"
      value={editingId}
      onchange={(event) => onEditEnvironment(event.currentTarget.value)}
    >
      {#each environments as env (env.id)}
        <option value={env.id}>{env.name}</option>
      {/each}
    </select>

    {#if editing && !isGlobal}
      <button
        class="btn btn-sm"
        data-testid="hp-env-rename"
        onclick={() => {
          const next = prompt('Rename environment', editing.name);
          if (next && next.trim()) onRenameEnvironment(editing.id, next.trim());
        }}>Rename</button
      >
      <button
        class="btn btn-sm btn-danger"
        data-testid="hp-env-delete"
        onclick={() => onDeleteEnvironment(editing.id)}>Delete</button
      >
    {/if}
    {#if editing}
      <button
        class="btn btn-sm"
        data-testid="hp-env-export"
        onclick={() => onExportEnvironment(editing.id)}>Export…</button
      >
    {/if}
  </div>

  <div class="row wrap">
    <label class="inline" for="hp-env-new">New environment</label>
    <input
      id="hp-env-new"
      data-testid="hp-env-new"
      type="text"
      autocomplete="off"
      placeholder="Staging"
      bind:value={newEnvName}
      onkeydown={(event) => {
        if (event.key === 'Enter') addEnvironment();
      }}
    />
    <button class="btn btn-sm" data-testid="hp-env-add" onclick={addEnvironment}>Add</button>
  </div>

  {#if isGlobal}
    <p class="muted small" data-testid="hp-env-global-note">
      <strong>{GLOBAL_NAME}</strong> is always in scope, underneath whichever environment is
      active. It is the place for the things that do not change between environments. It cannot
      be renamed or deleted.
    </p>
  {/if}

  <section class="group">
    <h3>Variables</h3>
    <p class="muted small">
      Plain values, resolved into <code>{'{{name}}'}</code> at send time.
      <strong>These are in your backups</strong> — which is right for a base URL and wrong for a
      key. Keys go in the table below.
    </p>
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Value</th>
            <th><span class="visually-hidden">Remove</span></th>
          </tr>
        </thead>
        <tbody>
          {#each variables as [name, value] (name)}
            <tr data-testid="hp-var-row" id={rowId(name, false)}>
              <th scope="row" class="mono">{name}</th>
              <td>
                <label class="visually-hidden" for={'hp-var-value-' + name}>Value of {name}</label>
                <input
                  id={'hp-var-value-' + name}
                  data-testid={'hp-var-value-' + name}
                  class="mono"
                  type="text"
                  autocomplete="off"
                  value={asText(value)}
                  onchange={(event) =>
                    editing && onSetVariable(editing.id, name, event.currentTarget.value)}
                />
              </td>
              <td>
                <button
                  class="btn btn-sm btn-danger"
                  data-testid={'hp-var-remove-' + name}
                  aria-label={`Remove variable ${name}`}
                  onclick={() => editing && onRemoveVariable(editing.id, name)}>×</button
                >
              </td>
            </tr>
          {:else}
            <tr>
              <td colspan="3" class="muted small" data-testid="hp-var-empty">
                No variables in this environment yet.
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <div class="row wrap">
      <label class="visually-hidden" for="hp-var-new-name">New variable name</label>
      <input
        id="hp-var-new-name"
        data-testid="hp-var-new-name"
        class="mono"
        type="text"
        autocomplete="off"
        placeholder="base_url"
        bind:value={newVarName}
      />
      <label class="visually-hidden" for="hp-var-new-value">New variable value</label>
      <input
        id="hp-var-new-value"
        data-testid="hp-var-new-value"
        class="mono"
        type="text"
        autocomplete="off"
        placeholder="https://api.example.com"
        bind:value={newVarValue}
        onkeydown={(event) => {
          if (event.key === 'Enter') addVariable();
        }}
      />
      <button class="btn btn-sm" data-testid="hp-var-add" onclick={addVariable}>Add variable</button>
    </div>
  </section>

  <section class="group">
    <h3>Secrets</h3>
    <p class="muted small" data-testid="hp-secrets-note">
      Resolved into <code>{'{{name}}'}</code> exactly like a variable, and ahead of one with the
      same name. Stored apart from everything else, and here is precisely what that means:
    </p>
    <ul class="muted small facts">
      <li><strong>Not in backups.</strong> Not in an export, not in the environment file the button above writes, not in a saved request — a saved request keeps the <code>{'{{name}}'}</code>, never the value.</li>
      <li><strong>Not encrypted.</strong> They are ordinary rows in this browser's storage, on this machine. Anything with access to this browser profile can read them.</li>
      <li><strong>Not synced anywhere</strong>, because nothing in this app is.</li>
    </ul>
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Value</th>
            <th><span class="visually-hidden">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {#each scopeSecrets as row (row.id)}
            <tr data-testid="hp-secret-row" id={rowId(row.name, true)}>
              <th scope="row" class="mono">{row.name}</th>
              <td class="mono" data-testid={'hp-secret-value-' + row.name}>
                {revealed === row.id ? row.value : MASK}
              </td>
              <td>
                <div class="row">
                  <button
                    class="btn btn-sm"
                    data-testid={'hp-secret-reveal-' + row.name}
                    aria-pressed={revealed === row.id}
                    onclick={() => (revealed = revealed === row.id ? null : row.id)}
                    >{revealed === row.id ? 'Hide' : 'Reveal'}</button
                  >
                  <button
                    class="btn btn-sm btn-danger"
                    data-testid={'hp-secret-remove-' + row.name}
                    aria-label={`Remove secret ${row.name}`}
                    onclick={() => onRemoveSecret(row.id)}>×</button
                  >
                </div>
              </td>
            </tr>
          {:else}
            <tr>
              <td colspan="3" class="muted small" data-testid="hp-secret-empty">
                No secrets in this scope.
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <div class="row wrap">
      <label class="visually-hidden" for="hp-secret-new-name">New secret name</label>
      <input
        id="hp-secret-new-name"
        data-testid="hp-secret-new-name"
        class="mono"
        type="text"
        autocomplete="off"
        placeholder="api_key"
        bind:value={newSecretName}
      />
      <label class="visually-hidden" for="hp-secret-new-value">New secret value</label>
      <!-- type=password so a shoulder or a screen share does not get it, and
           autocomplete off so the browser's password manager does not offer
           to remember a value that is not a login. -->
      <input
        id="hp-secret-new-value"
        data-testid="hp-secret-new-value"
        class="mono"
        type="password"
        autocomplete="off"
        placeholder="value"
        bind:value={newSecretValue}
        onkeydown={(event) => {
          if (event.key === 'Enter') addSecret();
        }}
      />
      <button class="btn btn-sm" data-testid="hp-secret-add" onclick={addSecret}>Add secret</button>
    </div>
  </section>
</div>

<style>
  .inline {
    display: inline;
    margin-bottom: 0;
  }

  .mono {
    font-family: var(--font-mono);
  }

  .small {
    font-size: var(--font-size-sm);
  }

  .group {
    border-top: 1px solid var(--border-color);
    padding-top: var(--space-3);
  }

  .group h3 {
    font-size: var(--font-size-sm);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-muted-color);
    margin: 0 0 var(--space-2);
  }

  /* Two pulses, then gone. `:global` because the class is added imperatively
     by the jump rather than appearing in this component's markup, so Svelte's
     scoper never sees it and would prune the rule. */
  :global(tr.flash > *) {
    animation: flash 0.55s ease-in-out 2;
  }

  @keyframes flash {
    0%,
    100% {
      background-color: transparent;
    }
    50% {
      background-color: var(--color-primary-soft);
    }
  }

  /* The scroll still happens; only the pulsing stops. Someone who has asked
     for less motion still needs to be shown which row they landed on, so the
     highlight becomes a steady one rather than nothing. */
  @media (prefers-reduced-motion: reduce) {
    :global(tr.flash > *) {
      animation: none;
      background-color: var(--color-primary-soft);
    }
  }

  .facts {
    margin: 0 0 var(--space-3);
    padding-left: var(--space-4);
  }

  .facts li {
    margin-bottom: var(--space-1);
  }

  .visually-hidden {
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
