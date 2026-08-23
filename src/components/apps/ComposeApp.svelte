<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import Card from '../Card.svelte';
  import CodeBlock from '../CodeBlock.svelte';
  import Explainer from '../Explainer.svelte';
  import { copyText, downloadBlob, downloadText } from '../../lib/exportFile';
  import { all, patch, put, softDelete, withSyncFields } from '../../lib/db/repo';
  import type { ComposeProject } from '../../lib/db/types';
  import { archiveBlob, archiveName } from '../../lib/compose/archive';
  import { emitCompose } from '../../lib/compose/emit';
  import { ComposeImportError, importCompose, type ImportResult } from '../../lib/compose/import';
  import {
    cloneProject,
    NETWORK_DRIVERS,
    newConfig,
    newMount,
    newNetwork,
    newPort,
    newSecret,
    newService,
    newVolume,
    normalizeProject,
    RESTART_POLICIES,
    starterProject,
    uniqueName,
    type ComposeProjectModel,
    type ComposeService,
    type MountType,
  } from '../../lib/compose/model';
  import { injectSnippet, SNIPPETS, STACKS } from '../../lib/compose/templates';
  import { errorCount, findingsFor, validateProject, type Finding } from '../../lib/compose/validate';

  /**
   * The Docker Compose builder.
   *
   * The model is the state and the YAML is a `$derived` projection of it —
   * there is no code path that parses the textarea back, so the two can never
   * disagree. Everything the page shows (the document, the findings, the
   * badges beside each service) comes from that one model.
   *
   * The library writes to `compose_projects` and nothing else: no preference
   * is remembered, because a compose file is a document you open on purpose.
   */

  let project = $state<ComposeProjectModel>(starterProject());
  let currentId = $state<string | null>(null);
  let rows = $state<ComposeProject[]>([]);
  let search = $state('');
  // The first service starts expanded: a builder that opens with every
  // section shut is a builder whose first click is always the same one.
  let openService = $state<string | null>(project.services[0]?.id ?? null);
  let feedback = $state<string | null>(null);
  let feedbackTimer: ReturnType<typeof setTimeout> | undefined;

  // Paste-an-existing-file state.
  let importText = $state('');
  let importReport = $state<ImportResult | null>(null);
  let importError = $state<string | null>(null);

  let yaml = $derived(emitCompose(project));
  let findings = $derived(validateProject(project));
  let errors = $derived(errorCount(findings));
  let projectFindings = $derived(findings.filter((f) => f.service === ''));

  let matches = $derived(
    search.trim() === ''
      ? rows
      : rows.filter((r) => r.name.toLowerCase().includes(search.trim().toLowerCase()))
  );

  onMount(refresh);
  onDestroy(() => clearTimeout(feedbackTimer));

  function flash(message: string) {
    feedback = message;
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => (feedback = null), 4000);
  }

  async function refresh() {
    rows = (await all<ComposeProject>('compose_projects')).sort((a, b) => a.name.localeCompare(b.name));
  }

  // ---- the library ---------------------------------------------------------

  async function save() {
    const body = { name: project.name.trim() || 'Untitled', model: JSON.parse(JSON.stringify(project)) };
    if (currentId) {
      await patch<ComposeProject>('compose_projects', currentId, body);
    } else {
      const row = await put<ComposeProject>('compose_projects', withSyncFields(body));
      currentId = row.id;
    }
    await refresh();
    flash('Project saved.');
  }

  function openRow(row: ComposeProject) {
    // A stored row is untrusted: a backup is hand-editable and the generic
    // data suite writes an array into every json column.
    project = normalizeProject(row.model);
    currentId = row.id;
    openService = project.services[0]?.id ?? null;
    importReport = null;
  }

  async function remove(row: ComposeProject) {
    await softDelete('compose_projects', row.id);
    await refresh();
    if (currentId === row.id) currentId = null;
    flash('Project deleted.');
  }

  function startFresh() {
    project = starterProject();
    currentId = null;
    openService = project.services[0]?.id ?? null;
    importReport = null;
  }

  // ---- editing -------------------------------------------------------------

  function addService() {
    const service = newService(uniqueName('service', project.services.map((s) => s.name)));
    project.services = [...project.services, service];
    openService = service.id;
  }

  function removeService(id: string) {
    project.services = project.services.filter((s) => s.id !== id);
    if (openService === id) openService = project.services[0]?.id ?? null;
  }

  const listOf = (text: string): string[] =>
    text.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);

  function toggleNetwork(service: ComposeService, name: string) {
    service.networks = service.networks.includes(name)
      ? service.networks.filter((n) => n !== name)
      : [...service.networks, name];
  }

  function toggleIn(list: string[], name: string): string[] {
    return list.includes(name) ? list.filter((n) => n !== name) : [...list, name];
  }

  // ---- templates and snippets ---------------------------------------------

  function loadStack(id: string) {
    const template = STACKS.find((s) => s.id === id);
    if (!template) return;
    project = cloneProject(template.build());
    currentId = null;
    openService = project.services[0]?.id ?? null;
    importReport = null;
    flash(`Loaded ${template.label}. Nothing is saved until you press Save.`);
  }

  function downloadStack(id: string) {
    const template = STACKS.find((s) => s.id === id);
    if (!template) return;
    downloadBlob(archiveBlob(template, template.build()), archiveName(template));
    flash(`${template.label} archive downloaded.`);
  }

  function inject(id: string) {
    const snippet = SNIPPETS.find((s) => s.id === id);
    if (!snippet) return;
    const result = injectSnippet(project, snippet);
    project = result.project;
    openService = project.services[project.services.length - 1]?.id ?? null;
    const parts = [`Added "${result.added.service}"`];
    if (result.added.volumes.length > 0) parts.push(`declared ${result.added.volumes.join(', ')}`);
    for (const moved of result.added.ports) parts.push(`moved host port ${moved.from} to ${moved.to} (already taken)`);
    flash(`${parts.join(' · ')}.`);
  }

  // ---- import --------------------------------------------------------------

  function runImport() {
    importError = null;
    importReport = null;
    if (importText.trim() === '') {
      importError = 'Nothing to read — paste a compose file first.';
      return;
    }
    try {
      importReport = importCompose(importText);
    } catch (err) {
      importError = err instanceof ComposeImportError ? err.message : 'That file could not be read.';
    }
  }

  function acceptImport() {
    if (!importReport) return;
    project = importReport.project;
    currentId = null;
    openService = project.services[0]?.id ?? null;
    flash('Imported. Nothing is saved until you press Save.');
  }

  async function onImportFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    importText = await file.text();
    runImport();
  }

  // ---- output --------------------------------------------------------------

  const fileBase = () => project.name.trim().replace(/[^\w.-]+/g, '-') || 'compose';

  async function copyYaml() {
    flash((await copyText(yaml)) ? 'compose.yaml copied.' : 'Copy failed — select it and copy by hand.');
  }

  function downloadYaml() {
    downloadText(yaml, 'compose.yaml', 'text/yaml');
  }

  function exportProject() {
    downloadText(`${JSON.stringify(project, null, 2)}\n`, `${fileBase()}.json`, 'application/json');
  }

  async function importProjectFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      project = normalizeProject(JSON.parse(await file.text()));
      currentId = null;
      openService = project.services[0]?.id ?? null;
      flash(`Loaded ${file.name}.`);
    } catch {
      flash('That file is not a project export.');
    }
  }

  const badge = (service: ComposeService): Finding[] => findingsFor(findings, service.name);
</script>

<div class="page-header">
  <h1>Docker Compose</h1>
</div>

<div class="stack">
  <Card title="Project" testid="dc-project-card">
    {#snippet actions()}
      <button class="btn btn-sm btn-primary" data-testid="dc-save" onclick={save}>Save</button>
      <button class="btn btn-sm" data-testid="dc-new" onclick={startFresh}>New</button>
    {/snippet}

    <div class="stack">
      <div class="row">
        <div class="grow">
          <label for="dc-name">Project name</label>
          <input id="dc-name" data-testid="dc-name" bind:value={project.name} />
        </div>
        <div>
          <label for="dc-export">Take it with you</label>
          <div class="row" id="dc-export">
            <button class="btn btn-sm" data-testid="dc-export-json" onclick={exportProject}>Export .json</button>
            <input
              class="file-sm"
              data-testid="dc-import-json"
              type="file"
              accept=".json,application/json"
              aria-label="Load a project export"
              onchange={importProjectFile}
            />
          </div>
        </div>
      </div>

      <p class="muted small" data-testid="dc-secrets-note">
        <strong>A compose file can contain secrets.</strong> Environment variables, database passwords
        and inline config content are part of the project, and saved projects ride this app's plain-JSON
        backup like everything else. Use <code>${'{'}VAR{'}'}</code> interpolation or a
        <code>secrets:</code> file for anything that should not sit in a backup in your downloads folder.
      </p>

      {#if rows.length > 0}
        <div>
          <label for="dc-search">Saved projects ({rows.length})</label>
          <input id="dc-search" data-testid="dc-search" type="search" placeholder="Search" bind:value={search} />
          <ul class="library" data-testid="dc-library">
            {#each matches as row (row.id)}
              <li class:on={row.id === currentId}>
                <button class="link" data-testid={`dc-open-${row.name}`} onclick={() => openRow(row)}>{row.name}</button>
                <button class="btn btn-sm btn-danger" data-testid={`dc-delete-${row.name}`} onclick={() => remove(row)}>
                  Delete
                </button>
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    </div>
  </Card>

  <Card title="Start from a template" collapsible open={false} testid="dc-templates-card">
    <div class="stack">
      <p class="muted small">
        A stack replaces what is open. <strong>Every tag below is pinned as of today, and tags move</strong> —
        check them before you rely on one.
      </p>
      <div class="cards" data-testid="dc-stacks">
        {#each STACKS as template (template.id)}
          <div class="template">
            <strong>{template.label}</strong>
            <span class="muted small">{template.note}</span>
            <span class="pins">{template.pins.join(' · ')}</span>
            <div class="row">
              <button class="btn btn-sm" data-testid={`dc-stack-${template.id}`} onclick={() => loadStack(template.id)}>
                Load
              </button>
              <button class="btn btn-sm" data-testid={`dc-zip-${template.id}`} onclick={() => downloadStack(template.id)}>
                Download .zip
              </button>
            </div>
            {#if template.steps}
              <span class="muted small">Ships README steps — the framework scaffolds itself.</span>
            {/if}
          </div>
        {/each}
      </div>

      <h3 class="group">Add one service to what is open</h3>
      <div class="chips" data-testid="dc-snippets">
        {#each SNIPPETS as snippet (snippet.id)}
          <button class="chip" data-testid={`dc-snippet-${snippet.id}`} title={snippet.note} onclick={() => inject(snippet.id)}>
            + {snippet.label}
          </button>
        {/each}
      </div>
    </div>
  </Card>

  <Card title="Import an existing compose file" collapsible open={false} testid="dc-import-card">
    <div class="stack">
      <p class="muted small">
        Best effort, and it says what it could not read. This builder covers a large part of the Compose
        specification and nothing like all of it — anything it cannot represent is listed below rather
        than dropped, so you can decide whether to carry on editing here.
      </p>
      <textarea
        data-testid="dc-import-text"
        rows="6"
        bind:value={importText}
        aria-label="An existing compose file"
        placeholder={'services:\n  web:\n    image: nginx'}
      ></textarea>
      <div class="row">
        <button class="btn btn-primary" data-testid="dc-import-run" onclick={runImport}>Read it</button>
        <input
          class="file-sm"
          data-testid="dc-import-file"
          type="file"
          accept=".yaml,.yml,text/yaml"
          aria-label="A compose file to read"
          onchange={onImportFile}
        />
      </div>

      {#if importError}
        <p class="warn small" role="alert" data-testid="dc-import-error">{importError}</p>
      {/if}

      {#if importReport}
        <div class="report" data-testid="dc-import-report">
          <p class="small">
            <strong>{importReport.project.services.length}</strong> service{importReport.project.services
              .length === 1
              ? ''
              : 's'} read.
            {#if importReport.unsupported.length > 0}
              <strong>{importReport.unsupported.length}</strong> key{importReport.unsupported.length === 1 ? '' : 's'}
              could not be represented.
            {:else}
              Everything in the file has a control here.
            {/if}
          </p>
          {#if importReport.unsupported.length > 0}
            <ul class="small">
              {#each importReport.unsupported as note (note.path)}
                <li><code>{note.path}</code> — {note.message}</li>
              {/each}
            </ul>
          {/if}
          {#if importReport.notes.length > 0}
            <p class="small muted">Read, but changed on the way in:</p>
            <ul class="small muted">
              {#each importReport.notes as note (note.path)}
                <li><code>{note.path}</code> — {note.message}</li>
              {/each}
            </ul>
          {/if}
          <button class="btn btn-primary" data-testid="dc-import-accept" onclick={acceptImport}>
            Replace what is open with this
          </button>
        </div>
      {/if}
    </div>
  </Card>

  <Card title="Services" testid="dc-services-card">
    {#snippet actions()}
      <button class="btn btn-sm" data-testid="dc-add-service" onclick={addService}>+ Service</button>
    {/snippet}

    <div class="stack">
      {#if project.services.length === 0}
        <p class="muted small">No services yet. Add one, load a template, or paste a compose file.</p>
      {/if}

      {#each project.services as service, index (service.id)}
        {@const problems = badge(service)}
        <div class="service" class:open={openService === service.id} data-testid={`dc-service-${service.name}`}>
          <div class="service-head">
            <button
              class="disclose"
              aria-expanded={openService === service.id}
              data-testid={`dc-toggle-${service.name}`}
              onclick={() => (openService = openService === service.id ? null : service.id)}
            >
              <span aria-hidden="true">{openService === service.id ? '▾' : '▸'}</span>
              <strong>{service.name || `service ${index + 1}`}</strong>
              <span class="muted small">{service.image || 'no image'}</span>
            </button>
            {#if problems.length > 0}
              <span
                class="count"
                class:bad={problems.some((p) => p.level === 'error')}
                data-testid={`dc-badge-${service.name}`}
              >
                {problems.length}
              </span>
            {/if}
            <button
              class="btn btn-sm btn-danger"
              data-testid={`dc-remove-${service.name}`}
              onclick={() => removeService(service.id)}
            >
              ×
            </button>
          </div>

          {#if openService === service.id}
            <div class="service-body stack">
              {#if problems.length > 0}
                <ul class="findings small" data-testid={`dc-findings-${service.name}`}>
                  {#each problems as finding (finding.message)}
                    <li class:bad={finding.level === 'error'}>
                      <strong>{finding.level === 'error' ? 'Error' : 'Careful'}</strong> — {finding.message}
                    </li>
                  {/each}
                </ul>
              {/if}

              <!-- Container -->
              <div class="row">
                <div class="grow">
                  <label for={`dc-sname-${service.id}`}>Name</label>
                  <input id={`dc-sname-${service.id}`} data-testid={`dc-sname-${index}`} bind:value={service.name} />
                </div>
                <div class="grow">
                  <label for={`dc-image-${service.id}`}>Image (with a tag)</label>
                  <input
                    id={`dc-image-${service.id}`}
                    data-testid={`dc-image-${index}`}
                    placeholder="nginx:1.27-alpine"
                    bind:value={service.image}
                  />
                </div>
                <div>
                  <label for={`dc-restart-${service.id}`}>Restart</label>
                  <select id={`dc-restart-${service.id}`} data-testid={`dc-restart-${index}`} bind:value={service.restart}>
                    {#each RESTART_POLICIES as policy (policy)}
                      <option value={policy}>{policy === '' ? '(default)' : policy}</option>
                    {/each}
                  </select>
                </div>
              </div>

              <div class="row">
                <div class="grow">
                  <label for={`dc-command-${service.id}`}>Command</label>
                  <input
                    id={`dc-command-${service.id}`}
                    data-testid={`dc-command-${index}`}
                    placeholder="npm run dev"
                    bind:value={service.command}
                  />
                </div>
                <div class="grow">
                  <label for={`dc-env-${service.id}`}>Environment (KEY=value per line)</label>
                  <textarea
                    id={`dc-env-${service.id}`}
                    data-testid={`dc-env-${index}`}
                    rows="2"
                    value={service.environment.map((e) => `${e.key}=${e.value}`).join('\n')}
                    onchange={(e) => {
                      service.environment = (e.currentTarget as HTMLTextAreaElement).value
                        .split('\n')
                        .map((line) => line.trim())
                        .filter(Boolean)
                        .map((line) => {
                          const at = line.indexOf('=');
                          return at < 0 ? { key: line, value: '' } : { key: line.slice(0, at), value: line.slice(at + 1) };
                        });
                    }}
                  ></textarea>
                </div>
              </div>

              <!-- Ports -->
              <fieldset class="block">
                <legend>Ports</legend>
                {#if service.networkMode.trim() === 'host'}
                  <p class="warn small" data-testid={`dc-ports-disabled-${index}`}>
                    Disabled: with <code>network_mode: host</code> the container is already on the host
                    network, so a published port does nothing at all.
                  </p>
                {:else}
                  {#each service.ports as port, p (p)}
                    <div class="row">
                      <input
                        class="num"
                        data-testid={`dc-port-published-${index}-${p}`}
                        placeholder="host"
                        bind:value={port.published}
                        aria-label="Host port"
                      />
                      <span aria-hidden="true">:</span>
                      <input
                        class="num"
                        data-testid={`dc-port-target-${index}-${p}`}
                        placeholder="container"
                        bind:value={port.target}
                        aria-label="Container port"
                      />
                      <select bind:value={port.protocol} aria-label="Protocol">
                        <option value="tcp">tcp</option>
                        <option value="udp">udp</option>
                      </select>
                      <input
                        class="num"
                        placeholder="host IP"
                        bind:value={port.hostIp}
                        aria-label="Bind to one host interface"
                      />
                      <button
                        class="btn btn-sm btn-danger"
                        aria-label="Remove this port"
                        onclick={() => (service.ports = service.ports.filter((_, i) => i !== p))}
                      >
                        ×
                      </button>
                    </div>
                  {/each}
                  <button
                    class="btn btn-sm"
                    data-testid={`dc-add-port-${index}`}
                    onclick={() => (service.ports = [...service.ports, newPort()])}
                  >
                    + Port
                  </button>
                {/if}
              </fieldset>

              <!-- Storage -->
              <fieldset class="block">
                <legend>Storage</legend>
                {#each service.volumes as mount, m (m)}
                  <div class="row">
                    <select
                      data-testid={`dc-mount-type-${index}-${m}`}
                      value={mount.type}
                      onchange={(e) => (mount.type = (e.currentTarget as HTMLSelectElement).value as MountType)}
                      aria-label="Mount type"
                    >
                      <option value="volume">named volume</option>
                      <option value="bind">bind (host folder)</option>
                      <option value="tmpfs">tmpfs (memory)</option>
                    </select>
                    {#if mount.type !== 'tmpfs'}
                      <input
                        data-testid={`dc-mount-source-${index}-${m}`}
                        placeholder={mount.type === 'bind' ? './src' : 'volume name'}
                        bind:value={mount.source}
                        aria-label="Source"
                      />
                    {/if}
                    <input
                      data-testid={`dc-mount-target-${index}-${m}`}
                      placeholder="/app"
                      bind:value={mount.target}
                      aria-label="Container path"
                    />
                    <label class="check">
                      <input type="checkbox" bind:checked={mount.readOnly} />
                      read-only
                    </label>
                    <button
                      class="btn btn-sm btn-danger"
                      aria-label="Remove this mount"
                      onclick={() => (service.volumes = service.volumes.filter((_, i) => i !== m))}
                    >
                      ×
                    </button>
                  </div>
                {/each}
                <button
                  class="btn btn-sm"
                  data-testid={`dc-add-mount-${index}`}
                  onclick={() => (service.volumes = [...service.volumes, newMount()])}
                >
                  + Mount
                </button>
              </fieldset>

              <!-- Networking -->
              <fieldset class="block">
                <legend>Networking</legend>
                <div class="row">
                  <div>
                    <label for={`dc-netmode-${service.id}`}>Network mode</label>
                    <select id={`dc-netmode-${service.id}`} data-testid={`dc-netmode-${index}`} bind:value={service.networkMode}>
                      <option value="">(use networks below)</option>
                      <option value="host">host</option>
                      <option value="none">none</option>
                    </select>
                  </div>
                  {#if project.networks.length > 0 && !service.networkMode}
                    <div class="chips">
                      {#each project.networks as network (network.name)}
                        <label class="chip" class:on={service.networks.includes(network.name)}>
                          <input
                            type="checkbox"
                            data-testid={`dc-join-${index}-${network.name}`}
                            checked={service.networks.includes(network.name)}
                            onchange={() => toggleNetwork(service, network.name)}
                          />
                          {network.name}
                        </label>
                      {/each}
                    </div>
                  {/if}
                </div>
              </fieldset>

              <Explainer summary="Lifecycle, resources and the rest" testid={`dc-advanced-${index}`}>
                <div class="stack">
                  <div class="row">
                    <div>
                      <label for={`dc-hc-${service.id}`}>Healthcheck command</label>
                      <input
                        id={`dc-hc-${service.id}`}
                        data-testid={`dc-hc-${index}`}
                        placeholder="pg_isready -U app"
                        value={service.healthcheck.test}
                        onchange={(e) => {
                          service.healthcheck.test = (e.currentTarget as HTMLInputElement).value;
                          service.healthcheck.enabled = service.healthcheck.test.trim() !== '';
                        }}
                      />
                    </div>
                    <div>
                      <label for={`dc-hc-interval-${service.id}`}>Interval</label>
                      <input id={`dc-hc-interval-${service.id}`} class="num" placeholder="10s" bind:value={service.healthcheck.interval} />
                    </div>
                    <div>
                      <label for={`dc-hc-retries-${service.id}`}>Retries</label>
                      <input id={`dc-hc-retries-${service.id}`} class="num" placeholder="5" bind:value={service.healthcheck.retries} />
                    </div>
                  </div>

                  <div class="row">
                    <div>
                      <label for={`dc-cpu-${service.id}`}>CPU limit</label>
                      <input id={`dc-cpu-${service.id}`} class="num" placeholder="0.5" bind:value={service.cpuLimit} />
                    </div>
                    <div>
                      <label for={`dc-mem-${service.id}`}>Memory limit</label>
                      <input id={`dc-mem-${service.id}`} class="num" placeholder="512M" bind:value={service.memLimit} />
                    </div>
                    <div>
                      <label for={`dc-user-${service.id}`}>User</label>
                      <input id={`dc-user-${service.id}`} class="num" placeholder="1000:1000" bind:value={service.user} />
                    </div>
                    <div>
                      <label for={`dc-workdir-${service.id}`}>Working directory</label>
                      <input id={`dc-workdir-${service.id}`} placeholder="/app" bind:value={service.workingDir} />
                    </div>
                  </div>

                  <div class="row">
                    <label class="check">
                      <input type="checkbox" bind:checked={service.tty} /> tty
                    </label>
                    <label class="check">
                      <input type="checkbox" bind:checked={service.stdinOpen} /> stdin_open
                    </label>
                    <label class="check">
                      <input type="checkbox" data-testid={`dc-privileged-${index}`} bind:checked={service.privileged} />
                      privileged
                    </label>
                  </div>

                  {#if project.services.length > 1}
                    <div>
                      <span class="label-ish">Depends on</span>
                      <div class="chips" data-testid={`dc-depends-${index}`}>
                        {#each project.services.filter((s) => s.id !== service.id) as other (other.id)}
                          {@const dep = service.dependsOn.find((d) => d.service === other.name)}
                          <label class="chip" class:on={Boolean(dep)}>
                            <input
                              type="checkbox"
                              data-testid={`dc-depend-${index}-${other.name}`}
                              checked={Boolean(dep)}
                              onchange={() => {
                                service.dependsOn = dep
                                  ? service.dependsOn.filter((d) => d.service !== other.name)
                                  : [
                                      ...service.dependsOn,
                                      { service: other.name, condition: 'service_started', required: true, restart: false },
                                    ];
                              }}
                            />
                            {other.name}
                          </label>
                          {#if dep}
                            <select
                              data-testid={`dc-condition-${index}-${other.name}`}
                              value={dep.condition}
                              onchange={(e) => (dep.condition = (e.currentTarget as HTMLSelectElement).value as typeof dep.condition)}
                              aria-label={`Condition for ${other.name}`}
                            >
                              <option value="service_started">started</option>
                              <option value="service_healthy">healthy</option>
                              <option value="service_completed_successfully">completed</option>
                            </select>
                          {/if}
                        {/each}
                      </div>
                    </div>
                  {/if}

                  <div class="row">
                    <div class="grow">
                      <label for={`dc-envfile-${service.id}`}>env_file (one per line)</label>
                      <textarea
                        id={`dc-envfile-${service.id}`}
                        rows="2"
                        value={service.envFiles.join('\n')}
                        onchange={(e) => (service.envFiles = listOf((e.currentTarget as HTMLTextAreaElement).value))}
                      ></textarea>
                    </div>
                    <div class="grow">
                      <label for={`dc-hosts-${service.id}`}>extra_hosts (one per line)</label>
                      <textarea
                        id={`dc-hosts-${service.id}`}
                        rows="2"
                        value={service.extraHosts.join('\n')}
                        onchange={(e) => (service.extraHosts = listOf((e.currentTarget as HTMLTextAreaElement).value))}
                      ></textarea>
                    </div>
                  </div>

                  {#if project.secrets.length > 0 || project.configs.length > 0}
                    <div class="row">
                      {#if project.secrets.length > 0}
                        <div>
                          <span class="label-ish">Secrets</span>
                          <div class="chips">
                            {#each project.secrets as secret (secret.name)}
                              <label class="chip" class:on={service.secrets.includes(secret.name)}>
                                <input
                                  type="checkbox"
                                  checked={service.secrets.includes(secret.name)}
                                  onchange={() => (service.secrets = toggleIn(service.secrets, secret.name))}
                                />
                                {secret.name}
                              </label>
                            {/each}
                          </div>
                        </div>
                      {/if}
                      {#if project.configs.length > 0}
                        <div>
                          <span class="label-ish">Configs</span>
                          <div class="chips">
                            {#each project.configs as config (config.name)}
                              <label class="chip" class:on={service.configs.includes(config.name)}>
                                <input
                                  type="checkbox"
                                  checked={service.configs.includes(config.name)}
                                  onchange={() => (service.configs = toggleIn(service.configs, config.name))}
                                />
                                {config.name}
                              </label>
                            {/each}
                          </div>
                        </div>
                      {/if}
                    </div>
                  {/if}
                </div>
              </Explainer>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </Card>

  <Card title="Networks, volumes, secrets and configs" collapsible open={false} testid="dc-resources-card">
    <div class="stack">
      <fieldset class="block">
        <legend>Networks</legend>
        {#each project.networks as network, n (n)}
          <div class="row">
            <input data-testid={`dc-network-name-${n}`} bind:value={network.name} aria-label="Network name" />
            <select data-testid={`dc-network-driver-${n}`} bind:value={network.driver} aria-label="Driver">
              {#each NETWORK_DRIVERS as driver (driver.id)}
                <option value={driver.id}>{driver.label}</option>
              {/each}
            </select>
            {#if network.driver === 'ipvlan' || network.driver === 'macvlan'}
              <input
                class="num"
                data-testid={`dc-network-parent-${n}`}
                placeholder="eth0"
                bind:value={network.parent}
                aria-label="Parent interface"
              />
            {/if}
            <input class="num" placeholder="subnet" bind:value={network.subnet} aria-label="Subnet" />
            <button
              class="btn btn-sm btn-danger"
              aria-label="Remove this network"
              onclick={() => (project.networks = project.networks.filter((_, i) => i !== n))}
            >
              ×
            </button>
          </div>
        {/each}
        <button
          class="btn btn-sm"
          data-testid="dc-add-network"
          onclick={() => (project.networks = [...project.networks, newNetwork(uniqueName('backend', project.networks.map((x) => x.name)))])}
        >
          + Network
        </button>
      </fieldset>

      <fieldset class="block">
        <legend>Volumes</legend>
        {#each project.volumes as volume, v (v)}
          <div class="row">
            <input data-testid={`dc-volume-name-${v}`} bind:value={volume.name} aria-label="Volume name" />
            <label class="check">
              <input type="checkbox" bind:checked={volume.external} /> external
            </label>
            <button
              class="btn btn-sm btn-danger"
              aria-label="Remove this volume"
              onclick={() => (project.volumes = project.volumes.filter((_, i) => i !== v))}
            >
              ×
            </button>
          </div>
        {/each}
        <button
          class="btn btn-sm"
          data-testid="dc-add-volume"
          onclick={() => (project.volumes = [...project.volumes, newVolume(uniqueName('data', project.volumes.map((x) => x.name)))])}
        >
          + Volume
        </button>
      </fieldset>

      <fieldset class="block">
        <legend>Secrets</legend>
        {#each project.secrets as secret, s (s)}
          <div class="row">
            <input data-testid={`dc-secret-name-${s}`} bind:value={secret.name} aria-label="Secret name" />
            <input placeholder="./secrets/db.txt" bind:value={secret.file} aria-label="File on the host" />
            <button
              class="btn btn-sm btn-danger"
              aria-label="Remove this secret"
              onclick={() => (project.secrets = project.secrets.filter((_, i) => i !== s))}
            >
              ×
            </button>
          </div>
        {/each}
        <button
          class="btn btn-sm"
          data-testid="dc-add-secret"
          onclick={() => (project.secrets = [...project.secrets, newSecret(uniqueName('db_password', project.secrets.map((x) => x.name)))])}
        >
          + Secret
        </button>
      </fieldset>

      <fieldset class="block">
        <legend>Configs</legend>
        {#each project.configs as config, c (c)}
          <div class="row">
            <input data-testid={`dc-config-name-${c}`} bind:value={config.name} aria-label="Config name" />
            <input placeholder="./nginx.conf" bind:value={config.file} aria-label="File on the host" />
            <button
              class="btn btn-sm btn-danger"
              aria-label="Remove this config"
              onclick={() => (project.configs = project.configs.filter((_, i) => i !== c))}
            >
              ×
            </button>
          </div>
        {/each}
        <button
          class="btn btn-sm"
          data-testid="dc-add-config"
          onclick={() => (project.configs = [...project.configs, newConfig(uniqueName('app_config', project.configs.map((x) => x.name)))])}
        >
          + Config
        </button>
      </fieldset>
    </div>
  </Card>

  <Card title="compose.yaml" testid="dc-output-card">
    <div class="stack">
      {#if findings.length > 0}
        <ul class="findings small" data-testid="dc-findings">
          {#each findings as finding (`${finding.service}-${finding.message}`)}
            <li class:bad={finding.level === 'error'}>
              <strong>{finding.level === 'error' ? 'Error' : 'Careful'}</strong>
              {#if finding.service}<code>{finding.service}</code>{/if}
              — {finding.message}
            </li>
          {/each}
        </ul>
      {:else}
        <p class="muted small" data-testid="dc-findings-clear">Nothing to flag.</p>
      {/if}

      <CodeBlock code={yaml} language="yaml" testid="dc-yaml" maxHeight="28rem" />

      <div class="row">
        <button class="btn btn-primary" data-testid="dc-copy" onclick={copyYaml}>Copy</button>
        <button class="btn" data-testid="dc-download" onclick={downloadYaml}>Download compose.yaml</button>
        <span class="muted small" data-testid="dc-error-count">
          {errors === 0 ? 'No errors' : `${errors} error${errors === 1 ? '' : 's'}`}
        </span>
      </div>
      <p class="muted small" aria-live="polite" data-testid="dc-feedback">{feedback ?? ''}</p>
    </div>
  </Card>

  <Explainer summary="The four that catch everyone" testid="explainer-compose">
    <p>
      <strong>Host networking publishes nothing.</strong> <code>network_mode: host</code> puts the
      container on the host's network stack, so there is no separate address to map a port to — a
      <code>ports:</code> list beside it is silently ignored. The ports editor disables itself and says
      so rather than letting you write a file that lies.
    </p>
    <p>
      <strong>A bare word in a volume is a NAMED VOLUME, not a folder.</strong>
      <code>- src:/app</code> does not mount your <code>./src</code> directory; it creates a volume
      called <code>src</code> and mounts that, and your changes appear to vanish. A bind mount must
      start with <code>./</code> or <code>/</code>.
    </p>
    <p>
      <strong><code>depends_on</code> waits for started, not for ready.</strong> A database container
      is "started" long before it accepts connections. <code>condition: service_healthy</code> is the
      one that waits — and it only works if the other service actually has a healthcheck, which is
      why this page treats a missing one as an error rather than a suggestion.
    </p>
    <p>
      <strong>ipvlan and macvlan need a real interface.</strong> Both attach containers directly to
      your LAN through a named parent (<code>eth0</code>, <code>en0</code>), and neither works inside
      Docker Desktop's virtual machine. Most Wi-Fi access points also drop the extra MAC addresses
      macvlan needs, so it tends to work on Ethernet and fail on wireless with no error worth reading.
    </p>
  </Explainer>
</div>

<style>
  .small {
    font-size: var(--font-size-sm);
  }

  .grow {
    flex: 1 1 12rem;
  }

  .num {
    width: 7rem;
  }

  .file-sm {
    font-size: var(--font-size-sm);
  }

  .check {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: 0;
    white-space: nowrap;
  }

  .label-ish {
    display: block;
    font-size: var(--font-size-sm);
    color: var(--text-muted-color);
    margin-bottom: var(--space-1, 2px);
  }

  .warn {
    color: var(--color-danger);
  }

  .library {
    list-style: none;
    margin: var(--space-2) 0 0;
    padding: 0;
    max-height: 12rem;
    overflow-y: auto;
  }

  .library li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: 2px var(--space-2);
    border-bottom: 1px solid var(--border-color);
  }

  .library li.on {
    background: var(--surface-raised-color);
  }

  .link {
    background: none;
    border: none;
    color: var(--color-primary);
    cursor: pointer;
    padding: 0;
    text-align: left;
    flex: 1;
  }

  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr));
    gap: var(--space-3);
  }

  .template {
    display: flex;
    flex-direction: column;
    gap: 4px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    padding: var(--space-3);
  }

  .pins {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    color: var(--text-muted-color);
    overflow-wrap: anywhere;
  }

  .group {
    font-size: var(--font-size-sm);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-muted-color);
    margin: var(--space-2) 0 0;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--surface-color);
    color: inherit;
    padding: 2px var(--space-2);
    font-size: var(--font-size-sm);
    cursor: pointer;
    margin-bottom: 0;
  }

  .chip.on {
    border-color: var(--color-primary);
    box-shadow: inset 0 0 0 1px var(--color-primary);
  }

  .service {
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
  }

  .service.open {
    border-color: var(--border-strong-color);
  }

  .service-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
  }

  .disclose {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    flex: 1;
    text-align: left;
    padding: 0;
  }

  .service-body {
    padding: 0 var(--space-3) var(--space-3);
    border-top: 1px solid var(--border-color);
    padding-top: var(--space-3);
  }

  .count {
    border-radius: 999px;
    border: 1px solid var(--border-strong-color);
    padding: 0 var(--space-2);
    font-size: var(--font-size-sm);
  }

  .count.bad {
    border-color: var(--color-danger);
    color: var(--color-danger);
  }

  .findings {
    margin: 0;
    padding-left: var(--space-4);
  }

  .findings li.bad {
    color: var(--color-danger);
  }

  .block {
    border: 1px dashed var(--border-color);
    border-radius: var(--radius-sm);
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    align-items: flex-start;
  }

  .block legend {
    font-size: var(--font-size-sm);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-muted-color);
    padding: 0 var(--space-2);
  }

  .report {
    border: 1px dashed var(--border-strong-color);
    border-radius: var(--radius-sm);
    padding: var(--space-3);
  }

  .report ul {
    margin: var(--space-2) 0;
    padding-left: var(--space-4);
  }
</style>
