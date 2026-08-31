<script lang="ts">
  /**
   * The HTTP playground's request/response core (0.4.0 plan, Phase 3).
   *
   * Craft a request, send it, and read what came back — with the browser's own
   * rules stated up front instead of discovered by confusion. Two of those
   * rules shape the whole page:
   *
   * **The forbidden request headers.** A page may not set `Host`, `Origin`,
   * `Cookie`, `Content-Length` and about fifteen others; the browser drops
   * them without a word. This page says so as you type, which is the one thing
   * every browser-based HTTP client fails to do.
   *
   * **The opaque `TypeError`.** A cross-origin failure, a refused connection,
   * a bad name and a dead network all reject `fetch` identically, on purpose,
   * so a page cannot use `fetch` to map the network. When that happens the
   * classifier reasons from what the page CAN see and says how confident it
   * is, rather than asserting a cause it cannot know.
   *
   * Stateless by design this phase: nothing is written to IndexedDB at all,
   * so the send path is provably clean before Phase 4 adds saving to it.
   */
  import { onDestroy } from 'svelte';
  import Card from '../Card.svelte';
  import CodeEditor from '../CodeEditor.svelte';
  import Explainer from '../Explainer.svelte';
  import SandboxedPreview from '../SandboxedPreview.svelte';
  import type { Extension } from '@codemirror/state';
  import { buildBody, checkJson, contentTypeWarning, encodeForm } from '../../lib/http/body';
  import { checkHeader, blankHeader, type HeaderRow } from '../../lib/http/headers';
  import {
    BODY_KINDS,
    blankField,
    blankRequest,
    carriesBody,
    checkUrl,
    METHODS,
    type BodyKind,
    type Method,
  } from '../../lib/http/model';
  import { send, type ResponseSummary } from '../../lib/http/send';
  import type { Failure } from '../../lib/http/classify';
  import {
    chooseView,
    formatBytes,
    formatMs,
    prettyJson,
    statusFamily,
    type BodyView,
  } from '../../lib/http/view';
  import { downloadBlob, copyText } from '../../lib/exportFile';

  const request = $state(blankRequest());
  let files = $state<{ name: string; file: File }[]>([]);

  let busy = $state(false);
  let controller: AbortController | null = null;
  let response = $state<ResponseSummary | null>(null);
  let failure = $state<Failure | null>(null);
  let notice = $state<string | null>(null);
  /** HTML responses show source until this is turned on. */
  let renderHtml = $state(false);

  let jsonLanguage = $state<Extension | undefined>(undefined);

  const urlProblem = $derived(checkUrl(request.url));
  const headerProblems = $derived(
    request.headers.map((row) => (row.enabled ? checkHeader(row.name, row.value) : null))
  );
  const jsonProblem = $derived(
    request.bodyKind === 'json' && carriesBody(request.method) ? checkJson(request.bodyText) : null
  );
  const multipartWarning = $derived(
    contentTypeWarning(
      request,
      request.headers.filter((row) => row.enabled).map((row) => row.name)
    )
  );
  const formPreview = $derived(request.bodyKind === 'form' ? encodeForm(request.fields) : '');
  const blockers = $derived(
    [
      urlProblem?.message,
      jsonProblem ? `The JSON body does not parse: ${jsonProblem.message}` : null,
      ...headerProblems.map((problem) =>
        problem && problem.kind !== 'forbidden' ? problem.message : null
      ),
    ].filter((message): message is string => Boolean(message))
  );

  /** The body as text, decoded once, for every textual viewer. */
  const bodyText = $derived(
    response ? new TextDecoder().decode(response.bytes) : ''
  );
  const choice = $derived(
    response
      ? chooseView(
          response.bytes,
          response.contentType,
          response.sniffedMime,
          response.sniffedExtension,
          bodyText
        )
      : null
  );
  const view = $derived<BodyView | null>(choice?.view ?? null);

  /** The JSON pane's grammar is lazy, like the config playground's. */
  $effect(() => {
    if (request.bodyKind !== 'json' || jsonLanguage) return;
    void import('@codemirror/lang-json')
      .then((module) => (jsonLanguage = module.json()))
      .catch(() => {
        /* no highlighting is a fair fallback — never block editing on it */
      });
  });

  function flash(message: string) {
    notice = message;
  }

  async function doSend() {
    if (blockers.length > 0 || busy) return;
    busy = true;
    notice = null;
    response = null;
    failure = null;
    renderHtml = false;
    controller = new AbortController();
    try {
      const result = await send(request, { signal: controller.signal, files });
      if (result.ok) response = result.response;
      else failure = result.failure;
    } finally {
      busy = false;
      controller = null;
    }
  }

  function cancel() {
    controller?.abort();
  }

  function addHeader() {
    request.headers = [...request.headers, blankHeader()];
  }

  function removeHeader(index: number) {
    request.headers = request.headers.filter((_, i) => i !== index);
  }

  function addField() {
    request.fields = [...request.fields, blankField()];
  }

  function removeField(index: number) {
    request.fields = request.fields.filter((_, i) => i !== index);
  }

  function onFiles(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    files = [...(input.files ?? [])].map((file) => ({ name: 'file', file }));
  }

  function downloadBody() {
    if (!response || !choice?.filename) return;
    downloadBlob(
      new Blob([response.bytes as BlobPart], { type: response.sniffedMime ?? 'application/octet-stream' }),
      choice.filename
    );
    flash(`Downloaded ${choice.filename}`);
  }

  async function copyBody() {
    flash((await copyText(bodyText)) ? 'Body copied.' : 'Copy failed.');
  }

  const previewDoc = $derived(view === 'html' && renderHtml ? bodyText : '');

  onDestroy(() => controller?.abort());
</script>

<div class="page-header">
  <h1>HTTP playground</h1>
</div>

<div class="stack">
  {#if notice}
    <p class="banner banner-success" data-testid="hp-notice">{notice}</p>
  {/if}

  <Card title="Request">
    <div class="stack">
      <div class="row wrap send-row">
        <label class="visually-hidden" for="hp-method">Method</label>
        <select id="hp-method" data-testid="hp-method" class="narrow" bind:value={request.method}>
          {#each METHODS as method (method)}
            <option value={method}>{method}</option>
          {/each}
        </select>
        <label class="visually-hidden" for="hp-url">URL</label>
        <input
          id="hp-url"
          data-testid="hp-url"
          class="url mono"
          type="text"
          inputmode="url"
          autocomplete="off"
          spellcheck="false"
          placeholder="https://example.com/api/thing"
          bind:value={request.url}
        />
        {#if busy}
          <button class="btn btn-danger" data-testid="hp-cancel" onclick={cancel}>Cancel</button>
        {:else}
          <button
            class="btn btn-primary"
            data-testid="hp-send"
            disabled={blockers.length > 0}
            onclick={doSend}>Send</button
          >
        {/if}
      </div>

      {#if blockers.length > 0}
        <ul class="blockers" data-testid="hp-blockers">
          {#each blockers as message, i (i)}
            <li>{message}</li>
          {/each}
        </ul>
      {/if}

      <details class="section" open>
        <summary>Headers</summary>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Send</th>
                <th>Name</th>
                <th>Value</th>
                <th><span class="visually-hidden">Remove</span></th>
              </tr>
            </thead>
            <tbody>
              {#each request.headers as row, index (index)}
                <tr data-testid="hp-header-row">
                  <td>
                    <label class="visually-hidden" for={'hp-header-on-' + index}>Send this header</label>
                    <input
                      id={'hp-header-on-' + index}
                      data-testid={'hp-header-on-' + index}
                      type="checkbox"
                      bind:checked={row.enabled}
                    />
                  </td>
                  <td>
                    <label class="visually-hidden" for={'hp-header-name-' + index}>Header name</label>
                    <input
                      id={'hp-header-name-' + index}
                      data-testid={'hp-header-name-' + index}
                      class="mono"
                      type="text"
                      autocomplete="off"
                      spellcheck="false"
                      bind:value={row.name}
                    />
                  </td>
                  <td>
                    <label class="visually-hidden" for={'hp-header-value-' + index}>Header value</label>
                    <input
                      id={'hp-header-value-' + index}
                      data-testid={'hp-header-value-' + index}
                      class="mono"
                      type="text"
                      autocomplete="off"
                      spellcheck="false"
                      bind:value={row.value}
                    />
                  </td>
                  <td>
                    <button
                      class="btn btn-sm btn-danger"
                      data-testid={'hp-header-remove-' + index}
                      aria-label={`Remove header ${index + 1}`}
                      onclick={() => removeHeader(index)}>×</button
                    >
                  </td>
                </tr>
                {#if headerProblems[index]}
                  <tr>
                    <td colspan="4">
                      <p
                        class={headerProblems[index]!.kind === 'forbidden' ? 'warn' : 'error'}
                        data-testid={'hp-header-problem-' + index}
                        data-kind={headerProblems[index]!.kind}
                        role={headerProblems[index]!.kind === 'forbidden' ? 'status' : 'alert'}
                      >
                        {headerProblems[index]!.message}
                      </p>
                    </td>
                  </tr>
                {/if}
              {/each}
            </tbody>
          </table>
        </div>
        <button class="btn btn-sm" data-testid="hp-header-add" onclick={addHeader}>Add header</button>
      </details>

      <details class="section" open={carriesBody(request.method)}>
        <summary>Body</summary>
        {#if !carriesBody(request.method)}
          <p class="muted small" data-testid="hp-no-body">
            {request.method} requests carry no body — the standard forbids one, and
            <code>fetch</code> throws rather than sending it. Choose another method to send one.
          </p>
        {:else}
          <div class="row wrap">
            <label class="inline" for="hp-body-kind">Body</label>
            <select id="hp-body-kind" data-testid="hp-body-kind" class="narrow" bind:value={request.bodyKind}>
              {#each BODY_KINDS as kind (kind.id)}
                <option value={kind.id}>{kind.label}</option>
              {/each}
            </select>
            <span class="muted small" data-testid="hp-body-hint">
              {BODY_KINDS.find((k) => k.id === request.bodyKind)?.hint}
            </span>
          </div>

          {#if request.bodyKind === 'json'}
            <div class="editor" data-testid="hp-json">
              <CodeEditor
                initialDoc={request.bodyText}
                ariaLabel="JSON request body"
                language={jsonLanguage}
                onDocChange={(doc) => (request.bodyText = doc)}
              />
            </div>
            {#if jsonProblem}
              <p class="error" data-testid="hp-json-error" role="alert">
                {jsonProblem.message}{jsonProblem.at !== null
                  ? ` (character ${jsonProblem.at})`
                  : ''}
              </p>
            {/if}
          {:else if request.bodyKind === 'form' || request.bodyKind === 'multipart'}
            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Send</th>
                    <th>Field</th>
                    <th>Value</th>
                    <th><span class="visually-hidden">Remove</span></th>
                  </tr>
                </thead>
                <tbody>
                  {#each request.fields as row, index (index)}
                    <tr data-testid="hp-field-row">
                      <td>
                        <label class="visually-hidden" for={'hp-field-on-' + index}>Send this field</label>
                        <input
                          id={'hp-field-on-' + index}
                          type="checkbox"
                          data-testid={'hp-field-on-' + index}
                          bind:checked={row.enabled}
                        />
                      </td>
                      <td>
                        <label class="visually-hidden" for={'hp-field-name-' + index}>Field name</label>
                        <input
                          id={'hp-field-name-' + index}
                          data-testid={'hp-field-name-' + index}
                          class="mono"
                          type="text"
                          autocomplete="off"
                          bind:value={row.name}
                        />
                      </td>
                      <td>
                        <label class="visually-hidden" for={'hp-field-value-' + index}>Field value</label>
                        <input
                          id={'hp-field-value-' + index}
                          data-testid={'hp-field-value-' + index}
                          class="mono"
                          type="text"
                          autocomplete="off"
                          bind:value={row.value}
                        />
                      </td>
                      <td>
                        <button
                          class="btn btn-sm btn-danger"
                          data-testid={'hp-field-remove-' + index}
                          aria-label={`Remove field ${index + 1}`}
                          onclick={() => removeField(index)}>×</button
                        >
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
            <button class="btn btn-sm" data-testid="hp-field-add" onclick={addField}>Add field</button>

            {#if request.bodyKind === 'form'}
              <p class="muted small">
                Sent as <code>application/x-www-form-urlencoded</code>, exactly like this:
              </p>
              <p class="encoded mono" data-testid="hp-form-encoded">{formPreview || '(empty)'}</p>
            {:else}
              <div class="row wrap">
                <label class="inline" for="hp-files">Files</label>
                <input id="hp-files" data-testid="hp-files" type="file" multiple onchange={onFiles} />
              </div>
              <p class="muted small" data-testid="hp-multipart-note">
                The browser writes the <code>Content-Type</code> for a multipart body itself,
                because only it knows the boundary it picked. Setting one by hand names a
                boundary that is not in the body, and the server reads no fields at all.
              </p>
            {/if}
          {:else if request.bodyKind === 'text'}
            <div class="row wrap">
              <label class="inline" for="hp-body-type">Content-Type</label>
              <input
                id="hp-body-type"
                data-testid="hp-body-type"
                class="mono"
                type="text"
                autocomplete="off"
                bind:value={request.bodyContentType}
              />
            </div>
            <label class="visually-hidden" for="hp-body-text">Request body</label>
            <textarea
              id="hp-body-text"
              data-testid="hp-body-text"
              class="mono raw"
              rows="6"
              bind:value={request.bodyText}
            ></textarea>
          {/if}

          {#if multipartWarning}
            <p class="warn" data-testid="hp-multipart-warning" role="status">{multipartWarning}</p>
          {/if}
        {/if}
      </details>

      <div class="stack explainers">
        <Explainer summary="Why some headers cannot be set" testid="hp-explainer-forbidden">
          <p>
            The Fetch standard reserves about twenty header names for the browser —
            <code>Host</code>, <code>Origin</code>, <code>Cookie</code>,
            <code>Content-Length</code>, <code>Referer</code> and the rest. A page may type
            them, and the browser <strong>drops them without saying so</strong>.
          </p>
          <p>
            That silence is why this page flags them while you type rather than at send time.
            Every HTTP client that runs in a browser behaves this way; almost none of them
            mention it, so the usual experience is a request that does not carry what you wrote
            and no clue as to why.
          </p>
        </Explainer>
      </div>
    </div>
  </Card>

  <Card title="Response">
    <div class="stack">
      {#if busy}
        <p class="muted" data-testid="hp-busy">Sending… <em>Cancel</em> stops it.</p>
      {:else if failure}
        <div class="failure" data-testid="hp-failure" data-kind={failure.kind}>
          <p class="failure-title">
            <strong>{failure.title}</strong>
            {#if failure.guess}
              <span class="badge" data-testid="hp-failure-guess">a guess, not a fact</span>
            {/if}
          </p>
          <p>{failure.detail}</p>
          {#if failure.kind === 'cors' || failure.kind === 'mixed-content'}
            <p class="muted small">
              The ways out are on the server's side, and they are explained on the
              <a href="https://developer.mozilla.org/docs/Web/HTTP/CORS" rel="noreferrer">
                MDN CORS page</a
              >: send the right <code>Access-Control-*</code> headers, or put a proxy you
              control in front of it.
            </p>
          {/if}
        </div>
      {:else if response}
        <div class="row wrap status-row" data-testid="hp-status">
          <span class="status" data-family={statusFamily(response.status)}>
            {response.status}
            {response.statusText}
          </span>
          <span class="muted small">{statusFamily(response.status)}</span>
          <span class="muted small" data-testid="hp-timing">{formatMs(response.ms)}</span>
          <span class="muted small" data-testid="hp-size">{formatBytes(response.bytes.length)}</span>
          {#if response.redirected}
            <span class="muted small" data-testid="hp-redirected">redirected to {response.url}</span>
          {/if}
        </div>

        {#if response.disagreement}
          <p class="warn" data-testid="hp-disagreement" role="status">
            {response.disagreement.message}
          </p>
        {/if}

        <details class="section" open>
          <summary>Headers ({response.headers.length})</summary>
          <!-- A plain table rather than `DataTable`: the plan suggested the
               latter, but it wants a schema per response and brings search,
               filtering, paging and export chrome that a ten-row header list
               does not need. This matches the request card's own tables. -->
          <div class="table-wrap" data-testid="hp-response-headers">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Header</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {#each response.headers as [name, value] (name)}
                  <tr data-testid="hp-response-header">
                    <th scope="row" class="mono">{name}</th>
                    <td class="mono">{value}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </details>

        <details class="section" open>
          <summary>Body</summary>
          <p class="muted small" data-testid="hp-body-reason">{choice?.reason}</p>

          {#if view === 'binary'}
            <button class="btn" data-testid="hp-download" onclick={downloadBody}>
              Download {choice?.filename}
            </button>
          {:else if view === 'empty'}
            <p class="muted small">Nothing to show.</p>
          {:else}
            <div class="row wrap">
              <button class="btn btn-sm" data-testid="hp-copy-body" onclick={copyBody}>Copy body</button>
              {#if view === 'html'}
                <button
                  class="btn btn-sm"
                  data-testid="hp-render-html"
                  aria-pressed={renderHtml}
                  onclick={() => (renderHtml = !renderHtml)}
                >
                  {renderHtml ? 'Show source' : 'Preview'}
                </button>
              {/if}
            </div>

            {#if view === 'html' && renderHtml}
              <p class="muted small" data-testid="hp-preview-note">
                This is the server's HTML running in a frame with no origin of its own — it
                cannot reach this app's data, and it cannot fetch anything.
              </p>
              <SandboxedPreview
                srcdoc={previewDoc}
                title="Response preview"
                height="22rem"
              />
            {:else}
              <pre class="body mono" data-testid="hp-body">{view === 'json'
                  ? prettyJson(bodyText)
                  : bodyText}</pre>
            {/if}
          {/if}
        </details>
      {:else}
        <p class="muted" data-testid="hp-idle">
          Nothing sent yet. Craft a request above and press <strong>Send</strong>.
        </p>
      {/if}

      <div class="stack explainers">
        <Explainer summary="Why a request can fail with no explanation" testid="hp-explainer-cors">
          <p>
            When a <code>fetch</code> fails, the browser tells the page almost nothing: a
            cross-origin refusal, a name that does not resolve, a refused connection and a
            dropped network all arrive as the same bare error. That is deliberate — a page that
            could tell those apart could use <code>fetch</code> to map a network it was never
            given access to.
          </p>
          <p>
            So this page reasons rather than reports, and says which it is doing.
            <strong>CORS is the target server's decision</strong>: it has to answer with an
            <code>Access-Control-Allow-Origin</code> header naming this origin. No client
            running in a browser can opt out of that — not this one, not one you write, and not
            this app installed to your home screen, because an installed web app is still a
            browser page under the same rules.
          </p>
        </Explainer>
      </div>
    </div>
  </Card>
</div>

<style>
  .send-row {
    align-items: center;
    gap: var(--space-2);
  }

  .url {
    flex: 1 1 22rem;
    min-width: 0;
  }

  .narrow {
    width: auto;
  }

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

  .section {
    border-top: 1px solid var(--border-color);
    padding-top: var(--space-2);
  }

  .section > summary {
    cursor: pointer;
    font-size: var(--font-size-sm);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-muted-color);
    margin-bottom: var(--space-2);
  }

  .blockers {
    margin: 0;
    padding-left: var(--space-4);
    color: var(--color-danger);
    font-size: var(--font-size-sm);
  }

  .error {
    color: var(--color-danger);
    font-size: var(--font-size-sm);
    margin: var(--space-1) 0 0;
  }

  .warn {
    color: var(--color-warning);
    font-size: var(--font-size-sm);
    margin: var(--space-1) 0 0;
  }

  .encoded {
    font-size: var(--font-size-sm);
    padding: var(--space-2);
    border: 1px solid var(--border-color);
    overflow-wrap: anywhere;
    margin: 0;
  }

  .editor {
    border: 1px solid var(--border-color);
  }

  .raw {
    width: 100%;
    font-size: var(--font-size-sm);
  }

  .status-row {
    align-items: baseline;
    gap: var(--space-3);
  }

  .status {
    font-family: var(--font-mono);
    font-weight: 700;
    font-size: var(--font-size-lg);
  }

  /* The family is spelled out beside this, so colour is never the only signal. */
  .status[data-family='success'] {
    color: var(--color-success);
  }

  .status[data-family='redirect'] {
    color: var(--color-warning);
  }

  .status[data-family='client error'],
  .status[data-family='server error'] {
    color: var(--color-danger);
  }

  .failure {
    border-left: 3px solid var(--color-danger);
    padding-left: var(--space-3);
    font-size: var(--font-size-sm);
  }

  .failure-title {
    margin-top: 0;
  }

  .badge {
    display: inline-block;
    margin-left: var(--space-2);
    padding: 0 var(--space-2);
    border: 1px solid var(--border-strong-color);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-eyebrow);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-muted-color);
  }

  .body {
    max-height: 26rem;
    overflow: auto;
    padding: var(--space-3);
    border: 1px solid var(--border-color);
    font-size: var(--font-size-sm);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    margin: 0;
  }

  .explainers {
    gap: var(--space-2);
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
