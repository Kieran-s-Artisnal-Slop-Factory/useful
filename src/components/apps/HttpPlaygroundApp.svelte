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
  import { onDestroy, onMount, tick } from 'svelte';
  import Card from '../Card.svelte';
  // Type-only: the real module is a 350 KB CodeMirror chunk, fetched when a
  // JSON body is actually chosen. See `loadEditor` below.
  import type CodeEditor from '../CodeEditor.svelte';
  import Explainer from '../Explainer.svelte';
  import SandboxedPreview from '../SandboxedPreview.svelte';
  import EnvironmentsCard from '../http/EnvironmentsCard.svelte';
  import FlowsCard from '../http/FlowsCard.svelte';
  import VariablesPanel from '../http/VariablesPanel.svelte';
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
    normalizeRequest,
    type BodyKind,
    type HttpRequest,
    type Method,
  } from '../../lib/http/model';
  import {
    availableNames,
    buildChain,
    environmentFilename,
    exportEnvironment,
    globalOf,
    GLOBAL_ID,
    GLOBAL_NAME,
    normalizeEnvironment,
    selectableEnvironments,
    type ScopeOrigin,
  } from '../../lib/http/env';
  import {
    allSecrets,
    deleteSecret,
    deleteSecretsFor,
    putSecret,
    type HttpSecret,
  } from '../../lib/http/secrets';
  import {
    maskedRequest,
    resolveRequest,
    requiredNames,
    unknownNames,
  } from '../../lib/http/resolve';
  import {
    forStorage,
    normalizeRun,
    normalizeSteps,
    starterSteps,
    type FlowStep,
    type StepRecord,
  } from '../../lib/http/flow';
  import { runFlow } from '../../lib/http/run';
  import {
    all,
    getSingleton,
    patch,
    put,
    putSingleton,
    softDelete,
    withSyncFields,
  } from '../../lib/db/repo';
  import type {
    HttpEnvironment,
    HttpFlow,
    HttpSavedRequest,
    Preferences,
  } from '../../lib/db/types';
  import { downloadText } from '../../lib/exportFile';
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
  import { ensureGrammars, highlight } from '../../lib/http/highlight';
  import { mediaCaution } from '../../lib/http/media';
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
  /** Binary media stays bytes until this is turned on (see lib/http/media.ts). */
  let showMedia = $state(false);
  /** The object URL behind the media element, alive only while it is shown. */
  let mediaUrl = $state<string | null>(null);
  /**
   * Origins that have answered this page in this session, so the failure
   * classifier can rule out "the host is down" the moment it is not true.
   * Memory only: this is evidence about right now, not a fact to store.
   */
  let provenOrigins = $state<string[]>([]);

  function rememberOrigin(url: string) {
    try {
      const origin = new URL(url).origin;
      if (!provenOrigins.includes(origin)) provenOrigins = [...provenOrigins, origin];
    } catch {
      /* a URL that will not parse teaches us nothing */
    }
  }

  let jsonLanguage = $state<Extension | undefined>(undefined);
  let jsonEditor = $state<CodeEditor | undefined>();
  /**
   * The editor component itself, once its chunk has landed.
   *
   * CodeMirror is ~350 KB and this page's default state is a GET with no body
   * at all, so it must not ride along with the page (0.4.0 Phase 7, payload
   * pass). It arrives when someone picks a JSON body.
   */
  let EditorComponent = $state<typeof CodeEditor | null>(null);
  /** Prism's grammars, likewise lazy — see lib/http/highlight.ts. */
  let grammarsReady = $state(false);

  // --- Phase 4: environments, variables, secrets ----------------------------
  let environments = $state<HttpEnvironment[]>([]);
  let secrets = $state<HttpSecret[]>([]);
  let saved = $state<HttpSavedRequest[]>([]);
  /** The environment resolved against at send time; null means Global alone. */
  let activeEnvId = $state<string | null>(null);
  /** The environment whose contents the management card is editing. */
  let editingEnvId = $state<string>(GLOBAL_ID);
  /** The saved row this request came from, if any. */
  let currentId = $state<string | null>(null);
  let requestName = $state('');

  // --- Phase 5: flows -------------------------------------------------------
  let flows = $state<HttpFlow[]>([]);
  let flowId = $state<string | null>(null);
  /** The working copy of the selected flow's steps. */
  let flowSteps = $state<FlowStep[]>([]);
  let flowRecords = $state<StepRecord[]>([]);
  /** Values earlier steps produced, kept so a walk-through can continue. */
  let flowValues = $state<Record<string, string>>({});
  let flowCursor = $state(0);
  let flowRanAt = $state<string | null>(null);
  let flowRunning = $state(false);
  let flowController: AbortController | null = null;

  const envViews = $derived([
    globalOf(environments),
    ...selectableEnvironments(environments),
  ]);
  const chain = $derived(buildChain({ environments, secrets, activeId: activeEnvId }));
  /**
   * Resolution runs on every keystroke, deliberately: the panel showing what
   * a request will actually send is worth nothing if it lags behind what is
   * typed. It is a handful of small strings through a hand-rolled scanner.
   */
  const resolved = $derived(resolveRequest(request, chain));
  const preview = $derived(maskedRequest(request, chain));
  const inScope = $derived(availableNames(chain));
  const usesVariables = $derived(requiredNames(request).length > 0);
  /** Names this request needs that nothing supplies — what the button creates. */
  const unknown = $derived(unknownNames(request, chain));
  /** The row the Environments card should scroll to and flash, if any. */
  let jumpTarget = $state<{ name: string; secret: boolean; nonce: number } | null>(null);
  let jumpCount = 0;

  /**
   * Take the reader from a placeholder in the pre-send panel to the row it is
   * actually set in.
   *
   * The card is a `<details>`, and a closed one cannot be scrolled to — so it
   * is opened here, imperatively, before the state change that triggers the
   * scroll. `Card` deliberately treats its `open` prop as a seed rather than
   * a binding ("a disclosure is a glance, not a preference"), and reaching
   * for the element by test id is a smaller intrusion than making a component
   * used on forty pages carry a two-way binding for this one caller.
   */
  function jumpToVariable(name: string, origin: ScopeOrigin) {
    editingEnvId = origin.environmentId;
    document
      .querySelector<HTMLDetailsElement>('[data-testid="hp-env-card"]')
      ?.setAttribute('open', '');
    // A fresh nonce every time, so clicking the same name twice flashes twice.
    jumpCount += 1;
    jumpTarget = { name, secret: origin.secret, nonce: jumpCount };
  }

  /** Where the button would put them, named on the button itself. */
  const targetEnvName = $derived(
    envViews.find((env) => env.id === (activeEnvId ?? GLOBAL_ID))?.name ?? GLOBAL_NAME
  );

  /**
   * Checked AFTER resolution: `{{base_url}}/things` is not a URL and is not
   * meant to be one. While resolution is failing, the placeholder is the
   * problem worth reporting, not the shape of the text around it.
   */
  const urlProblem = $derived(checkUrl(resolved.ok ? resolved.request.url : request.url));
  /** Placeholders in the URL that resolved to an empty string. */
  const blankUrlNames = $derived(
    resolved.resolutions
      .filter((item) => item.field.id === 'url' && item.value === '')
      .map((item) => `\`${item.path}\``)
  );
  const headerProblems = $derived(
    request.headers.map((row) => (row.enabled ? checkHeader(row.name, row.value) : null))
  );
  /**
   * The JSON check runs on the RESOLVED body, not on what was typed.
   *
   * `{"page": {{page}}}` is not valid JSON as written and is perfectly valid
   * once `page` is 2 — checking the template would block a request that is
   * fine, which is the sort of thing that teaches people to distrust a
   * validator. While resolution is failing there is nothing meaningful to
   * check, and the unresolved placeholder is the blocker worth showing.
   */
  const jsonSubject = $derived(resolved.ok ? resolved.request.bodyText : null);
  const jsonProblem = $derived(
    request.bodyKind === 'json' && carriesBody(request.method) && jsonSubject !== null
      ? checkJson(jsonSubject)
      : null
  );
  /** True when the offsets in that complaint are into text nobody typed. */
  const jsonAfterResolve = $derived(jsonSubject !== null && jsonSubject !== request.bodyText);
  const multipartWarning = $derived(
    contentTypeWarning(
      request,
      request.headers.filter((row) => row.enabled).map((row) => row.name)
    )
  );
  const formPreview = $derived(request.bodyKind === 'form' ? encodeForm(request.fields) : '');
  const blockers = $derived(
    [
      // Decision 2: a name with nowhere to come from stops the send, and says
      // which field it was in rather than leaving a 401 to explain it.
      ...resolved.problems.map((problem) => `${problem.field.label}: ${problem.message}`),
      // A URL that resolved to nonsense BECAUSE a variable in it is empty
      // reads as "you typed a bad URL" otherwise, which sends someone
      // inspecting the address bar instead of the variable that emptied it.
      resolved.ok && urlProblem
        ? urlProblem.message + (blankUrlNames.length > 0 ? ` ${blankUrlNames.join(' and ')} resolved to nothing, which is likely why.` : '')
        : null,
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

  /** The text actually on screen — pretty-printed for JSON, verbatim otherwise. */
  const shownText = $derived(view === 'json' ? prettyJson(bodyText) : bodyText);
  /**
   * Spans rather than an HTML string: this is the one place in the app where
   * a stranger's bytes reach the DOM, and Svelte's own escaping is a stronger
   * guarantee than an audit of Prism's. The reasoning is in lib/http/highlight.ts.
   */
  const highlighted = $derived(
    view === 'binary' || view === 'empty'
      ? { spans: [], skipped: null }
      : // `grammarsReady` is read so this re-derives the moment Prism lands.
        highlight(shownText, grammarsReady ? (choice?.syntax ?? null) : null)
  );
  /** Said BEFORE the button is pressed, so the decision is the reader's. */
  const caution = $derived(
    response && choice?.media ? mediaCaution(choice.media.kind, response.bytes.length) : null
  );

  /** The JSON pane's grammar is lazy, like the config playground's. */
  $effect(() => {
    if (request.bodyKind !== 'json' || jsonLanguage) return;
    void import('@codemirror/lang-json')
      .then((module) => (jsonLanguage = module.json()))
      .catch(() => {
        /* no highlighting is a fair fallback — never block editing on it */
      });
  });

  /** And the editor itself, for the same reason and at the same moment. */
  $effect(() => {
    if (request.bodyKind !== 'json' || EditorComponent) return;
    void import('../CodeEditor.svelte')
      .then((module) => (EditorComponent = module.default))
      .catch(() => {
        /* the textarea fallback below keeps the body editable */
      });
  });

  /**
   * Prism's grammars, once a response wants colouring. Deliberately AFTER the
   * response has arrived rather than with the page: the body renders plain
   * immediately and gains colour when the chunk lands, so nothing waits on a
   * download it might never need.
   */
  $effect(() => {
    if (!choice?.syntax || grammarsReady) return;
    void ensureGrammars().then(() => (grammarsReady = true));
  });

  function flash(message: string) {
    notice = message;
  }

  /**
   * Drop the object URL. An un-revoked one pins the whole body in memory for
   * the life of the document, and a session spent poking at image endpoints
   * would accumulate every one of them.
   */
  function revokeMedia() {
    if (mediaUrl === null) return;
    URL.revokeObjectURL(mediaUrl);
    mediaUrl = null;
  }

  /** The button from media.ts rule 3: bytes stay bytes until this runs. */
  function toggleMedia() {
    if (showMedia) {
      showMedia = false;
      revokeMedia();
      return;
    }
    if (!response || !choice?.media) return;
    revokeMedia();
    mediaUrl = URL.createObjectURL(
      // The SNIFFED type, never the header's claim — handing the browser a
      // stranger's `Content-Type` would let it pick the decoder.
      new Blob([response.bytes as BlobPart], { type: response.sniffedMime ?? 'application/octet-stream' })
    );
    showMedia = true;
  }

  async function doSend() {
    if (blockers.length > 0 || busy) return;
    busy = true;
    notice = null;
    response = null;
    failure = null;
    renderHtml = false;
    showMedia = false;
    revokeMedia();
    controller = new AbortController();
    try {
      // The RESOLVED copy goes on the wire. `request` keeps its placeholders,
      // which is what makes saving it safe: a saved request is a template,
      // never a snapshot of one send with a key baked into it.
      const outgoing = resolved.ok ? resolved.request : request;
      const result = await send(outgoing, { signal: controller.signal, files, provenOrigins });
      if (result.ok) {
        response = result.response;
        rememberOrigin(result.response.url);
      } else failure = result.failure;
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

  // --- the library, environments and secrets --------------------------------

  async function refresh() {
    [environments, saved, secrets, flows] = await Promise.all([
      all<HttpEnvironment>('http_environments'),
      all<HttpSavedRequest>('http_requests'),
      allSecrets(),
      all<HttpFlow>('http_flows'),
    ]);
  }

  /** Replace the whole request in place, editor included. */
  async function setRequest(next: HttpRequest) {
    request.method = next.method;
    request.url = next.url;
    request.headers = next.headers;
    request.bodyKind = next.bodyKind;
    request.bodyText = next.bodyText;
    request.bodyContentType = next.bodyContentType;
    request.fields = next.fields;
    files = [];
    // The editor owns its document, so a state change alone will not move it.
    // It may also not be mounted yet — `initialDoc` covers that case.
    await tick();
    jsonEditor?.setText(next.bodyText);
  }

  const byName = <T extends { name: string }>(rows: T[]): T[] =>
    [...rows].sort((a, b) => a.name.localeCompare(b.name));

  async function openSaved(row: HttpSavedRequest, opts: { remember?: boolean } = {}) {
    currentId = row.id;
    requestName = typeof row.name === 'string' ? row.name : '';
    activeEnvId = typeof row.environment_id === 'string' ? row.environment_id : null;
    await setRequest(normalizeRequest(row.request));
    response = null;
    failure = null;
    if (opts.remember !== false) {
      await putSingleton<Partial<Preferences>>('preferences', { http_last_request_id: row.id });
    }
  }

  async function saveRequest() {
    const body = {
      name: requestName.trim() || 'Untitled request',
      environment_id: activeEnvId,
      // Placeholders unresolved, deliberately — see the note in doSend.
      request: JSON.parse(JSON.stringify(request)) as unknown,
    };
    if (currentId) {
      await patch<HttpSavedRequest>('http_requests', currentId, body);
    } else {
      const row = await put<HttpSavedRequest>('http_requests', withSyncFields(body));
      currentId = row.id;
      await putSingleton<Partial<Preferences>>('preferences', { http_last_request_id: row.id });
    }
    requestName = body.name;
    await refresh();
    flash('Request saved. Its {{placeholders}} were saved unresolved — it is a template.');
  }

  function newRequest() {
    currentId = null;
    requestName = '';
    void setRequest(blankRequest());
    response = null;
    failure = null;
    flash('New request. Nothing is saved until you name it and press Save.');
  }

  async function deleteRequest(row: HttpSavedRequest) {
    if (!confirm(`Delete “${row.name}”?`)) return;
    await softDelete('http_requests', row.id);
    if (currentId === row.id) newRequest();
    await refresh();
    flash('Request deleted.');
  }

  /**
   * The row for an environment, creating Global on first write.
   *
   * Global is written lazily: it is always in scope whether or not a row
   * exists, so an empty one would be a write on page load for nothing. Its id
   * is the fixed `GLOBAL_ID` rather than a fresh uuid, so two devices that
   * both create it converge on one row instead of two.
   */
  async function environmentRow(id: string): Promise<HttpEnvironment | undefined> {
    const existing = environments.find((env) => env.id === id);
    if (existing) return existing;
    if (id !== GLOBAL_ID) return undefined;
    const row = await put<HttpEnvironment>('http_environments', {
      ...withSyncFields({ name: GLOBAL_NAME, values: {} }),
      id: GLOBAL_ID,
    });
    await refresh();
    return row;
  }

  async function createEnvironment(name: string) {
    const row = await put<HttpEnvironment>(
      'http_environments',
      withSyncFields({ name, values: {} })
    );
    await refresh();
    editingEnvId = row.id;
    activeEnvId = row.id;
    await rememberEnvironment();
    flash(`Environment “${name}” created and made active.`);
  }

  async function renameEnvironment(id: string, name: string) {
    await patch<HttpEnvironment>('http_environments', id, { name });
    await refresh();
  }

  async function removeEnvironment(id: string) {
    const row = environments.find((env) => env.id === id);
    if (!row) return;
    const count = saved.filter((item) => item.environment_id === id).length;
    const warning =
      count > 0
        ? `Delete “${row.name}”? ${count} saved request${count === 1 ? '' : 's'} will be left without an environment, and its secrets are deleted with it.`
        : `Delete “${row.name}”? Its secrets are deleted with it.`;
    if (!confirm(warning)) return;
    // Secrets go first and go for real. A tombstone keeps the value, which is
    // exactly what "delete a secret" must not mean.
    await deleteSecretsFor(id);
    await softDelete('http_environments', id);
    if (activeEnvId === id) {
      activeEnvId = null;
      await rememberEnvironment();
    }
    if (editingEnvId === id) editingEnvId = GLOBAL_ID;
    await refresh();
    flash('Environment deleted, and its secrets with it.');
  }

  /**
   * Create a row for every name the request needs and nothing supplies, so
   * they can be filled in rather than typed out twice.
   *
   * They arrive EMPTY, which is worth being deliberate about: an empty value
   * resolves to an empty string, so this trades the send-blocking error for a
   * send that goes out with blanks in it — the exact failure decision 2 was
   * written to prevent. It is still the right behaviour, for the same reason
   * a forbidden header is a warning here rather than an error: the row is
   * legal, and the user made it on purpose. What the app owes them is that
   * the emptiness is impossible to miss, which is the Variables panel's job
   * from here — it lists every empty one and marks it in the table.
   *
   * One write, not one per name: a table this is scaffolding could easily
   * have ten rows in it.
   */
  async function addMissingVariables() {
    // Copied, not read live: `unknown` is derived from the chain, and the
    // refresh below is what makes these names resolvable — so by the time the
    // message is built it would correctly report zero left to add.
    const adding = [...unknown];
    const where = targetEnvName;
    if (adding.length === 0) return;
    const row = await environmentRow(activeEnvId ?? GLOBAL_ID);
    if (!row) return;
    const values = { ...normalizeEnvironment(row).values };
    for (const name of adding) if (!(name in values)) values[name] = '';
    await patch<HttpEnvironment>('http_environments', row.id, { values });
    await refresh();
    editingEnvId = row.id;
    flash(
      `Added ${adding.length} empty variable${adding.length === 1 ? '' : 's'} to ${where}. They resolve to nothing until you fill them in — the Variables panel lists which are still blank.`
    );
  }

  async function setVariable(id: string, name: string, value: string) {
    const row = await environmentRow(id);
    if (!row) return;
    const values = { ...normalizeEnvironment(row).values, [name]: value };
    await patch<HttpEnvironment>('http_environments', row.id, { values });
    await refresh();
  }

  async function removeVariable(id: string, name: string) {
    const row = environments.find((env) => env.id === id);
    if (!row) return;
    const values = { ...normalizeEnvironment(row).values };
    delete values[name];
    await patch<HttpEnvironment>('http_environments', id, { values });
    await refresh();
  }

  async function setSecret(environmentId: string | null, name: string, value: string) {
    await putSecret({ name, value, environment_id: environmentId });
    await refresh();
    flash(`Secret “${name}” saved to this browser only — never to a backup.`);
  }

  async function removeSecret(id: string) {
    await deleteSecret(id);
    await refresh();
    flash('Secret deleted — the value is gone, not tombstoned.');
  }

  /** Writes a file that lists secret NAMES and no secret values. */
  function exportEnv(id: string) {
    const view = envViews.find((env) => env.id === id);
    if (!view) return;
    const scopeId = view.id === GLOBAL_ID ? null : view.id;
    const file = exportEnvironment(view, secrets, scopeId);
    const name = environmentFilename(view.name);
    downloadText(JSON.stringify(file, null, 2), name, 'application/json');
    flash(`Downloaded ${name} — secret names only, no values.`);
  }

  // --- flows ----------------------------------------------------------------

  /** The request a step means — its own copy, or the saved row it names. */
  function requestForStep(step: FlowStep) {
    if (step.request_id) {
      const row = saved.find((item) => item.id === step.request_id);
      return row ? normalizeRequest(row.request) : null;
    }
    return step.request ? normalizeRequest(step.request) : null;
  }

  function selectFlow(id: string) {
    flowId = id === '' ? null : id;
    const row = flows.find((item) => item.id === flowId);
    flowSteps = row ? normalizeSteps(row.steps) : [];
    const run = row ? normalizeRun(row.last_run) : null;
    flowRecords = run?.records ?? [];
    flowValues = run?.values ?? {};
    flowRanAt = run?.at ?? null;
    // A restored run is finished, not paused: walking resumes from the top.
    flowCursor = 0;
  }

  async function createFlow(name: string) {
    const row = await put<HttpFlow>(
      'http_flows',
      withSyncFields({
        name,
        environment_id: activeEnvId,
        // The auth-then-GET example the plan asks for, sketched in rather
        // than left as an empty table and a guess at what a path looks like.
        steps: starterSteps(() => crypto.randomUUID()) as unknown,
        last_run: null as unknown,
      })
    );
    await refresh();
    selectFlow(row.id);
    flash(`Flow “${name}” created, with the log-in-then-fetch example sketched in.`);
  }

  async function saveSteps(next: FlowStep[]) {
    flowSteps = next;
    if (!flowId) return;
    await patch<HttpFlow>('http_flows', flowId, { steps: next as unknown });
    await refresh();
  }

  async function renameFlow(name: string) {
    if (!flowId) return;
    await patch<HttpFlow>('http_flows', flowId, { name });
    await refresh();
  }

  async function deleteFlow() {
    if (!flowId) return;
    const row = flows.find((item) => item.id === flowId);
    if (!row || !confirm(`Delete “${row.name}”? Its recorded run goes with it.`)) return;
    await softDelete('http_flows', flowId);
    flowId = null;
    selectFlow('');
    await refresh();
    flash('Flow deleted.');
  }

  /** Snapshot the request in the card above into a step's own copy. */
  function takeCurrentInto(index: number) {
    // Placeholders and all: a step's copy is a template for the same reason a
    // saved request is one.
    const copy = JSON.parse(JSON.stringify(request)) as unknown;
    void saveSteps(
      flowSteps.map((step, i) =>
        i === index ? { ...step, request_id: null, request: normalizeRequest(copy) } : step
      )
    );
  }

  function resetRun() {
    flowRecords = [];
    flowValues = {};
    flowCursor = 0;
    flowRanAt = null;
  }

  async function execute(from: number, limit: number | undefined) {
    if (!flowId || flowRunning) return;
    flowRunning = true;
    flowController = new AbortController();
    try {
      const result = await runFlow({
        steps: flowSteps,
        requestFor: requestForStep,
        base: { environments, secrets, activeId: activeEnvId },
        provenOrigins,
        signal: flowController.signal,
        from,
        limit,
        values: flowValues,
        records: from === 0 ? [] : flowRecords,
        onProgress: (records) => (flowRecords = records),
      });
      flowRecords = result.records;
      flowValues = result.values;
      flowRanAt = result.at;
      flowCursor = result.ok ? Math.min(result.records.length, flowSteps.length) : flowSteps.length;
      // The row keeps the LATEST run and nothing older, and `forStorage`
      // drops the step scope: records are masked and redacted, but the values
      // map holds live credentials by necessity, so it is never written down.
      await patch<HttpFlow>('http_flows', flowId, { last_run: forStorage(result) as unknown });
      await refresh();
      if (!result.ok) flash('The run stopped at the step shown below.');
    } finally {
      flowRunning = false;
      flowController = null;
    }
  }

  const runWholeFlow = () => {
    resetRun();
    return execute(0, undefined);
  };
  const runNextStep = () => execute(flowCursor, 1);
  const stopFlow = () => flowController?.abort();

  /** "save to environment" is a click, never a side effect of running. */
  async function saveExtracted(name: string, value: string) {
    await setVariable(activeEnvId ?? GLOBAL_ID, name, value);
    flash(`\`${name}\` written into ${activeEnvId ? 'the active environment' : GLOBAL_NAME}.`);
  }

  async function rememberEnvironment() {
    await putSingleton<Partial<Preferences>>('preferences', {
      http_active_environment_id: activeEnvId ?? '',
    });
  }

  async function onActiveEnvironment(value: string) {
    activeEnvId = value === '' ? null : value;
    editingEnvId = activeEnvId ?? GLOBAL_ID;
    await rememberEnvironment();
  }

  onMount(async () => {
    await refresh();
    const prefs = await getSingleton<Preferences>('preferences');
    const wanted = prefs?.http_active_environment_id;
    if (wanted && environments.some((env) => env.id === wanted)) {
      activeEnvId = wanted;
      editingEnvId = wanted;
    }
    const last = prefs?.http_last_request_id;
    const row = last ? saved.find((item) => item.id === last) : undefined;
    // `remember: false`: reopening what was already remembered must not be a
    // write. Page load writes nothing, in this tool as in every other.
    if (row) await openSaved(row, { remember: false });
  });

  onDestroy(() => {
    controller?.abort();
    flowController?.abort();
    revokeMedia();
  });
</script>

<div class="page-header">
  <h1>HTTP playground</h1>
</div>

<div class="stack">
  {#if notice}
    <p class="banner banner-success" data-testid="hp-notice">{notice}</p>
  {/if}

  <Card title="Saved requests" collapsible open={false} testid="hp-library-card">
    <div class="stack">
      <div class="row wrap">
        <label class="inline" for="hp-name">Name</label>
        <input
          id="hp-name"
          data-testid="hp-name"
          type="text"
          autocomplete="off"
          placeholder="Untitled request"
          bind:value={requestName}
        />
        <button class="btn btn-sm" data-testid="hp-save" onclick={saveRequest}>
          {currentId ? 'Save' : 'Save as new'}
        </button>
        <button class="btn btn-sm" data-testid="hp-new" onclick={newRequest}>New</button>
      </div>

      {#if saved.length === 0}
        <p class="muted small" data-testid="hp-library-empty">
          Nothing saved yet. A saved request keeps its <code>{'{{placeholders}}'}</code> as
          written — it is a template, resolved fresh every time it is sent, which is why saving
          one never stores a secret.
        </p>
      {:else}
        <ul class="library" data-testid="hp-library">
          {#each byName(saved) as row (row.id)}
            <li class:on={row.id === currentId}>
              <button
                class="link"
                data-testid={'hp-open-' + row.name}
                onclick={() => openSaved(row)}
              >
                <span class="method">{normalizeRequest(row.request).method}</span>
                {row.name}
              </button>
              <span class="muted small">
                {envViews.find((env) => env.id === row.environment_id)?.name ?? 'no environment'}
              </span>
              <button
                class="btn btn-sm btn-danger"
                data-testid={'hp-delete-' + row.name}
                aria-label={`Delete ${row.name}`}
                onclick={() => deleteRequest(row)}>×</button
              >
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </Card>

  <Card title="Request">
    <div class="stack">
      <div class="row wrap env-row">
        <label class="inline" for="hp-env-active">Environment</label>
        <select
          id="hp-env-active"
          data-testid="hp-env-active"
          value={activeEnvId ?? ''}
          onchange={(event) => onActiveEnvironment(event.currentTarget.value)}
        >
          <option value="">{GLOBAL_NAME} only</option>
          {#each selectableEnvironments(environments) as env (env.id)}
            <option value={env.id}>{env.name}</option>
          {/each}
        </select>
        <span class="muted small" data-testid="hp-env-order">
          Looked up in {activeEnvId ? 'this environment, then ' : ''}{GLOBAL_NAME} — secrets
          first at each level.
        </span>
      </div>

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

      {#if unknown.length > 0}
        <div class="row wrap missing-row" data-testid="hp-missing-vars">
          <button class="btn btn-sm" data-testid="hp-add-missing-vars" onclick={addMissingVariables}>
            Add {unknown.length}
            {unknown.length === 1 ? 'variable' : 'variables'} to {targetEnvName}
          </button>
          <span class="muted small">
            {#each unknown as name, i (name)}<code>{name}</code>{i < unknown.length - 1
                ? ', '
                : ''}{/each}
            — created empty, ready to fill in.
          </span>
        </div>
      {/if}

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
              {#if EditorComponent}
                {@const Editor = EditorComponent}
                <Editor
                  bind:this={jsonEditor}
                  initialDoc={request.bodyText}
                  ariaLabel="JSON request body"
                  language={jsonLanguage}
                  onDocChange={(doc) => (request.bodyText = doc)}
                />
              {:else}
                <!-- The editor is a 350 KB chunk on its way. A textarea in the
                     meantime, not a spinner: the body stays editable and
                     nothing is lost when the real editor replaces it, because
                     it mounts with `initialDoc` set to whatever was typed. -->
                <label class="visually-hidden" for="hp-json-plain">JSON request body</label>
                <textarea
                  id="hp-json-plain"
                  data-testid="hp-json-plain"
                  class="mono raw"
                  rows="6"
                  bind:value={request.bodyText}
                ></textarea>
              {/if}
            </div>
            {#if jsonProblem}
              <p class="error" data-testid="hp-json-error" role="alert">
                {jsonProblem.message}{jsonProblem.at !== null
                  ? ` (character ${jsonProblem.at})`
                  : ''}{jsonAfterResolve
                  ? ' — checked after the variables were filled in, so that position is into the resolved body, not what is typed above.'
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
              {#if request.fields.some((row) => row.value.includes('{{'))}
                <p class="muted small" data-testid="hp-form-templated">
                  …with the <code>{'{{placeholders}}'}</code> still in it. They are resolved
                  before the encoding happens — Variables, below, shows the result.
                </p>
              {/if}
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

      <details class="section" open={usesVariables} data-testid="hp-vars-section">
        <summary>Variables</summary>
        <VariablesPanel
          resolved={resolved}
          preview={preview}
          available={inScope}
          onJump={jumpToVariable}
        />
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

  <Card title="Environments and secrets" collapsible open={false} testid="hp-env-card">
    <EnvironmentsCard
      environments={envViews}
      {secrets}
      editingId={editingEnvId}
      onEditEnvironment={(id) => (editingEnvId = id)}
      onCreateEnvironment={createEnvironment}
      onRenameEnvironment={renameEnvironment}
      onDeleteEnvironment={removeEnvironment}
      onExportEnvironment={exportEnv}
      onSetVariable={setVariable}
      onRemoveVariable={removeVariable}
      onSetSecret={setSecret}
      onRemoveSecret={removeSecret}
      highlight={jumpTarget}
    />
  </Card>

  <Card title="Flows" collapsible open={false} testid="hp-flows-card">
    <FlowsCard
      flows={byName(flows)}
      currentId={flowId}
      steps={flowSteps}
      savedRequests={byName(saved)}
      records={flowRecords}
      running={flowRunning}
      cursor={flowCursor}
      ranAt={flowRanAt}
      onSelect={selectFlow}
      onCreate={createFlow}
      onDelete={deleteFlow}
      onRename={renameFlow}
      onStepsChange={saveSteps}
      onRun={runWholeFlow}
      onRunNext={runNextStep}
      onReset={resetRun}
      onStop={stopFlow}
      onTakeCurrent={takeCurrentInto}
      onSaveValue={saveExtracted}
    />
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
            <div class="row wrap">
              <button class="btn" data-testid="hp-download" onclick={downloadBody}>
                Download {choice?.filename}
              </button>
              {#if choice?.media}
                <button
                  class="btn btn-sm"
                  data-testid="hp-show-media"
                  aria-pressed={showMedia}
                  onclick={toggleMedia}
                >
                  {showMedia ? 'Hide preview' : choice.media.label}
                </button>
              {/if}
            </div>

            {#if choice?.unrenderable}
              <p class="muted small" data-testid="hp-unrenderable">{choice.unrenderable}</p>
            {/if}
            {#if caution}
              <p class="warn" data-testid="hp-media-caution" role="status">{caution}</p>
            {/if}

            {#if showMedia && choice?.media && mediaUrl}
              {#if choice.media.kind === 'image'}
                <!-- No alt text can be honest here: nobody has described this
                     image, and inventing a description would be worse than
                     naming what it is. -->
                <img
                  class="media-image"
                  data-testid="hp-media-image"
                  src={mediaUrl}
                  alt="The image the server returned, undescribed — nothing here knows what it depicts."
                />
              {:else if choice.media.kind === 'pdf'}
                <p class="muted small" data-testid="hp-media-pdf-note">
                  This is your browser's own PDF viewer, the same one it uses for a PDF you
                  open from a link. Unlike the HTML preview above, this frame is
                  <strong>not sandboxed</strong> — a sandboxed frame refuses to start the PDF
                  viewer at all, so the choice was this or no preview. A PDF cannot run
                  scripts against this page the way HTML can; the viewer renders it in a
                  separate process and gives it no way back. Downloading it and opening it
                  elsewhere runs the very same viewer.
                </p>
                <!-- No `sandbox` attribute, deliberately, and it is the only
                     frame in this app without one. Chrome declines to
                     instantiate its PDF viewer inside a sandboxed frame — ANY
                     value of the attribute, `allow-same-origin` included —
                     so the frame either has no sandbox or shows a blank box.
                     What is given up is smaller than it looks: the document
                     here is a plugin document, not markup, and a PDF has no
                     scripting bridge to the embedding page. `referrerpolicy`
                     and an empty `allow` stay, and the URL is a blob this app
                     minted from bytes it already holds, so nothing is
                     fetched. If a future browser renders PDFs under a
                     sandbox, put one back. -->
                <iframe
                  class="media-frame"
                  data-testid="hp-media-pdf"
                  title={choice.media.title}
                  src={mediaUrl}
                  referrerpolicy="no-referrer"
                  allow=""
                ></iframe>
              {:else if choice.media.kind === 'video'}
                <!-- svelte-ignore a11y_media_has_caption -->
                <video
                  class="media-player"
                  data-testid="hp-media-video"
                  src={mediaUrl}
                  controls
                  preload="metadata"
                  aria-label={choice.media.title}
                ></video>
              {:else}
                <audio
                  class="media-player"
                  data-testid="hp-media-audio"
                  src={mediaUrl}
                  controls
                  preload="metadata"
                  aria-label={choice.media.title}
                ></audio>
              {/if}
            {/if}
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
              {#if highlighted.skipped}
                <p class="muted small" data-testid="hp-highlight-skipped">{highlighted.skipped}</p>
              {/if}
              <!-- One line on purpose: this is a `pre`, so any newline the
                   template introduced would become a newline in the body. The
                   spans carry plain text and a grammar-chosen class, never
                   markup — see lib/http/highlight.ts. -->
              <pre class="body mono" data-testid="hp-body">{#each highlighted.spans as span, i (i)}<span class={span.cls}>{span.text}</span>{/each}</pre>
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
          <p>
            <strong>One host can allow some resources and refuse others</strong>, and this is
            the case that most often looks like a bug in the client rather than a setting on
            the server. The header is attached per response, so a rule matching only
            <code>.png</code>, <code>.jpg</code> and <code>.mp3</code> — a common nginx
            <code>location</code> block, and the default on more than one image CDN — gives
            you a working image and a refused <code>.csv</code> from the same directory. If one
            URL from a host works and another does not, the request is not what differs.
            Compare the two responses' headers on the server side.
          </p>
          <p>
            This page remembers which hosts have answered it during this session, so when one
            of them then refuses something, it can tell you that outright instead of guessing.
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

  .missing-row {
    align-items: baseline;
    gap: var(--space-2);
  }

  .env-row {
    align-items: baseline;
    gap: var(--space-2);
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--border-color);
  }

  .library {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .library li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    border-bottom: 1px solid var(--border-color);
  }

  .library li.on {
    background: var(--color-primary-soft);
  }

  .library .link {
    flex: 1;
    text-align: left;
    background: none;
    border: 0;
    padding: 0;
    color: inherit;
    font: inherit;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }

  .library .method {
    font-family: var(--font-mono);
    font-size: var(--font-size-eyebrow);
    color: var(--text-muted-color);
    margin-right: var(--space-2);
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

  /* The checkerboard is the point: a PNG's transparent regions are part of
     what came back, and a preview on a flat surface hides them. */
  .media-image {
    display: block;
    max-width: 100%;
    max-height: 32rem;
    width: auto;
    height: auto;
    object-fit: contain;
    border: 1px solid var(--border-strong-color);
    background-color: #fff;
    background-image:
      linear-gradient(45deg, #d8d8d8 25%, transparent 25%),
      linear-gradient(-45deg, #d8d8d8 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #d8d8d8 75%),
      linear-gradient(-45deg, transparent 75%, #d8d8d8 75%);
    background-size: 16px 16px;
    background-position:
      0 0,
      0 8px,
      8px -8px,
      -8px 0;
  }

  .media-player {
    display: block;
    width: 100%;
    max-width: 48rem;
    max-height: 32rem;
    border: 1px solid var(--border-strong-color);
  }

  .media-frame {
    display: block;
    width: 100%;
    height: 32rem;
    border: 1px solid var(--border-strong-color);
    /* The viewer draws its own chrome and assumes a light canvas. */
    background: #fff;
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
