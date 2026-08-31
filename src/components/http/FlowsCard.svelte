<script lang="ts">
  /**
   * Multi-step flows: build them, run them, read what happened (0.4.0 plan,
   * Phase 5).
   *
   * Presentational. Every change goes out through a callback and comes back
   * as new props, so the parent owns persistence and there is one place that
   * knows how a flow is written. The records shown here are the same objects
   * that get stored — a secret is already masked in them before this file
   * ever sees one.
   */
  import {
    blankRule,
    type ExtractRule,
    type FlowStep,
    type StepRecord,
  } from '../../lib/http/flow';
  import { formatMs } from '../../lib/http/view';
  import { normalizeRequest } from '../../lib/http/model';
  import type { HttpFlow, HttpSavedRequest } from '../../lib/db/types';

  let {
    flows,
    currentId,
    steps,
    savedRequests,
    records,
    running,
    /** Which step the walk-through will run next. */
    cursor,
    ranAt,
    onSelect,
    onCreate,
    onDelete,
    onRename,
    onStepsChange,
    onRun,
    onRunNext,
    onReset,
    onStop,
    onTakeCurrent,
    onSaveValue,
  }: {
    flows: HttpFlow[];
    currentId: string | null;
    steps: FlowStep[];
    savedRequests: HttpSavedRequest[];
    records: StepRecord[];
    running: boolean;
    cursor: number;
    ranAt: string | null;
    onSelect: (id: string) => void;
    onCreate: (name: string) => void;
    onDelete: () => void;
    onRename: (name: string) => void;
    onStepsChange: (next: FlowStep[]) => void;
    onRun: () => void;
    onRunNext: () => void;
    onReset: () => void;
    onStop: () => void;
    onTakeCurrent: (index: number) => void;
    onSaveValue: (name: string, value: string) => void;
  } = $props();

  let newFlowName = $state('');

  const recordFor = (id: string): StepRecord | undefined =>
    records.find((item) => item.step_id === id);

  /** A one-line description of what a step will send, before it is run. */
  function describe(step: FlowStep): string {
    if (step.request_id) {
      const row = savedRequests.find((item) => item.id === step.request_id);
      if (!row) return 'points at a saved request that is gone';
      const parsed = normalizeRequest(row.request);
      return `${parsed.method} ${parsed.url || '(no URL)'}`;
    }
    if (step.request) return `${step.request.method} ${step.request.url || '(no URL)'} — own copy`;
    return 'no request yet';
  }

  const replace = (index: number, next: FlowStep) =>
    onStepsChange(steps.map((item, i) => (i === index ? next : item)));

  function addStep() {
    onStepsChange([
      ...steps,
      {
        id: crypto.randomUUID(),
        name: `Step ${steps.length + 1}`,
        request_id: null,
        request: null,
        outputs: [],
      },
    ]);
  }

  const removeStep = (index: number) => onStepsChange(steps.filter((_, i) => i !== index));

  function moveStep(index: number, by: number) {
    const target = index + by;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onStepsChange(next);
  }

  const setRule = (stepIndex: number, ruleIndex: number, patch: Partial<ExtractRule>) => {
    const step = steps[stepIndex]!;
    replace(stepIndex, {
      ...step,
      outputs: step.outputs.map((rule, i) => (i === ruleIndex ? { ...rule, ...patch } : rule)),
    });
  };

  const addRule = (stepIndex: number) => {
    const step = steps[stepIndex]!;
    replace(stepIndex, { ...step, outputs: [...step.outputs, blankRule()] });
  };

  const removeRule = (stepIndex: number, ruleIndex: number) => {
    const step = steps[stepIndex]!;
    replace(stepIndex, { ...step, outputs: step.outputs.filter((_, i) => i !== ruleIndex) });
  };

  function createFlow() {
    const name = newFlowName.trim();
    if (name === '') return;
    onCreate(name);
    newFlowName = '';
  }
</script>

<div class="stack">
  <div class="row wrap">
    <label class="inline" for="hp-flow-pick">Flow</label>
    <select
      id="hp-flow-pick"
      data-testid="hp-flow-pick"
      value={currentId ?? ''}
      onchange={(event) => onSelect(event.currentTarget.value)}
    >
      <option value="">(none)</option>
      {#each flows as flow (flow.id)}
        <option value={flow.id}>{flow.name}</option>
      {/each}
    </select>
    {#if currentId}
      <button
        class="btn btn-sm"
        data-testid="hp-flow-rename"
        onclick={() => {
          const next = prompt('Rename flow', flows.find((f) => f.id === currentId)?.name ?? '');
          if (next && next.trim()) onRename(next.trim());
        }}>Rename</button
      >
      <button class="btn btn-sm btn-danger" data-testid="hp-flow-delete" onclick={onDelete}>
        Delete
      </button>
    {/if}
  </div>

  <div class="row wrap">
    <label class="inline" for="hp-flow-new">New flow</label>
    <input
      id="hp-flow-new"
      data-testid="hp-flow-new"
      type="text"
      autocomplete="off"
      placeholder="Log in, then fetch me"
      bind:value={newFlowName}
      onkeydown={(event) => {
        if (event.key === 'Enter') createFlow();
      }}
    />
    <button class="btn btn-sm" data-testid="hp-flow-add" onclick={createFlow}>Create</button>
  </div>

  {#if !currentId}
    <p class="muted small" data-testid="hp-flow-none">
      A flow runs saved requests one after another and carries values between them — log in,
      keep the token, use it on the next request. Create one above; a new flow starts with the
      log-in-then-fetch example already sketched in.
    </p>
  {:else}
    <div class="row wrap controls">
      {#if running}
        <button class="btn btn-danger" data-testid="hp-flow-stop" onclick={onStop}>Stop</button>
      {:else}
        <button
          class="btn btn-primary"
          data-testid="hp-flow-run"
          disabled={steps.length === 0}
          onclick={onRun}>Run all {steps.length} step{steps.length === 1 ? '' : 's'}</button
        >
        <button
          class="btn"
          data-testid="hp-flow-next"
          disabled={cursor >= steps.length}
          onclick={onRunNext}
          >{cursor === 0 ? 'Run first step' : `Run step ${cursor + 1}`}</button
        >
        {#if records.length > 0}
          <button class="btn btn-sm" data-testid="hp-flow-reset" onclick={onReset}>
            Clear the run
          </button>
        {/if}
      {/if}
      {#if ranAt}
        <span class="muted small" data-testid="hp-flow-ran-at">last run {ranAt}</span>
      {/if}
    </div>

    <p class="muted small" data-testid="hp-flow-scope-note">
      Extracted values live for the run and are looked up <strong>before</strong> the
      environment, so a token a step just fetched beats a stale one left in a variable. Tick
      <em>save</em> on a rule to write it into the environment as well — that write is a
      decision, never a side effect.
    </p>
    <p class="muted small" data-testid="hp-flow-record-note">
      The run you are watching shows every value in full. <strong>The recorded copy does
      not</strong>: a token this run extracted is taken back out of the stored records — the
      header the next step sent it in, and the response that issued it — because a live
      credential in a backup file outlasts the token by a very long way. So after a reload this
      run reads with <span class="mono">••••••••</span> where the token was.
    </p>

    <ol class="steps" data-testid="hp-flow-steps">
      {#each steps as step, index (step.id)}
        {@const record = recordFor(step.id)}
        <li class="step" data-testid="hp-flow-step" class:next={index === cursor && !running}>
          <div class="row wrap head">
            <label class="visually-hidden" for={'hp-step-name-' + index}>Step name</label>
            <input
              id={'hp-step-name-' + index}
              data-testid={'hp-step-name-' + index}
              class="name"
              type="text"
              autocomplete="off"
              value={step.name}
              onchange={(event) => replace(index, { ...step, name: event.currentTarget.value })}
            />
            <button
              class="btn btn-sm"
              data-testid={'hp-step-up-' + index}
              aria-label={`Move ${step.name} earlier`}
              disabled={index === 0}
              onclick={() => moveStep(index, -1)}>↑</button
            >
            <button
              class="btn btn-sm"
              data-testid={'hp-step-down-' + index}
              aria-label={`Move ${step.name} later`}
              disabled={index === steps.length - 1}
              onclick={() => moveStep(index, 1)}>↓</button
            >
            <button
              class="btn btn-sm btn-danger"
              data-testid={'hp-step-remove-' + index}
              aria-label={`Remove ${step.name}`}
              onclick={() => removeStep(index)}>×</button
            >
          </div>

          <div class="row wrap">
            <label class="inline" for={'hp-step-request-' + index}>Sends</label>
            <select
              id={'hp-step-request-' + index}
              data-testid={'hp-step-request-' + index}
              value={step.request_id ?? ''}
              onchange={(event) =>
                replace(index, {
                  ...step,
                  request_id: event.currentTarget.value === '' ? null : event.currentTarget.value,
                })}
            >
              <option value="">its own copy of a request</option>
              {#each savedRequests as row (row.id)}
                <option value={row.id}>{row.name}</option>
              {/each}
            </select>
            {#if !step.request_id}
              <button
                class="btn btn-sm"
                data-testid={'hp-step-take-' + index}
                onclick={() => onTakeCurrent(index)}>Copy the request above into it</button
              >
            {/if}
          </div>
          <p class="muted small mono" data-testid={'hp-step-summary-' + index}>{describe(step)}</p>

          <details class="rules" open={step.outputs.length > 0}>
            <summary>Takes from the response ({step.outputs.length})</summary>
            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>From</th>
                    <th>Path</th>
                    <th>Name it</th>
                    <th>Save</th>
                    <th><span class="visually-hidden">Remove</span></th>
                  </tr>
                </thead>
                <tbody>
                  {#each step.outputs as rule, ruleIndex (ruleIndex)}
                    <tr data-testid="hp-rule-row">
                      <td>
                        <label class="visually-hidden" for={`hp-rule-source-${index}-${ruleIndex}`}
                          >Source</label
                        >
                        <select
                          id={`hp-rule-source-${index}-${ruleIndex}`}
                          data-testid={`hp-rule-source-${index}-${ruleIndex}`}
                          value={rule.source}
                          onchange={(event) =>
                            setRule(index, ruleIndex, {
                              source: event.currentTarget.value as ExtractRule['source'],
                            })}
                        >
                          <option value="body">body</option>
                          <option value="header">header</option>
                          <option value="status">status</option>
                        </select>
                      </td>
                      <td>
                        <label class="visually-hidden" for={`hp-rule-path-${index}-${ruleIndex}`}
                          >Path</label
                        >
                        <input
                          id={`hp-rule-path-${index}-${ruleIndex}`}
                          data-testid={`hp-rule-path-${index}-${ruleIndex}`}
                          class="mono"
                          type="text"
                          autocomplete="off"
                          disabled={rule.source === 'status'}
                          placeholder={rule.source === 'header' ? 'x-request-id' : 'data.token'}
                          value={rule.path}
                          onchange={(event) =>
                            setRule(index, ruleIndex, { path: event.currentTarget.value })}
                        />
                      </td>
                      <td>
                        <label class="visually-hidden" for={`hp-rule-name-${index}-${ruleIndex}`}
                          >Name</label
                        >
                        <input
                          id={`hp-rule-name-${index}-${ruleIndex}`}
                          data-testid={`hp-rule-name-${index}-${ruleIndex}`}
                          class="mono"
                          type="text"
                          autocomplete="off"
                          placeholder="token"
                          value={rule.name}
                          onchange={(event) =>
                            setRule(index, ruleIndex, { name: event.currentTarget.value })}
                        />
                      </td>
                      <td>
                        <label class="visually-hidden" for={`hp-rule-save-${index}-${ruleIndex}`}
                          >Also save to the environment</label
                        >
                        <input
                          id={`hp-rule-save-${index}-${ruleIndex}`}
                          data-testid={`hp-rule-save-${index}-${ruleIndex}`}
                          type="checkbox"
                          checked={rule.save}
                          onchange={(event) =>
                            setRule(index, ruleIndex, { save: event.currentTarget.checked })}
                        />
                      </td>
                      <td>
                        <button
                          class="btn btn-sm btn-danger"
                          data-testid={`hp-rule-remove-${index}-${ruleIndex}`}
                          aria-label={`Remove rule ${ruleIndex + 1}`}
                          onclick={() => removeRule(index, ruleIndex)}>×</button
                        >
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
            <button
              class="btn btn-sm"
              data-testid={'hp-rule-add-' + index}
              onclick={() => addRule(index)}>Add a rule</button
            >
            <p class="muted small">
              A path reads the response as JSON: <code>token</code> for a top-level field,
              <code>data.token</code> for a nested one, <code>body[0].id</code> when the
              response is a list. A rule that finds nothing says so — it never quietly becomes
              an empty string.
            </p>
          </details>

          {#if record}
            <div class="record" data-testid={'hp-step-record-' + index}>
              {#if record.failure}
                <p class="error" data-testid={'hp-step-failure-' + index}>
                  <strong>{record.failure.title}.</strong>
                  {record.failure.detail}
                </p>
              {:else if record.response}
                <p class="small" data-testid={'hp-step-status-' + index}>
                  <span class="mono">{record.response.status} {record.response.statusText}</span>
                  <span class="muted">{formatMs(record.response.ms)}</span>
                  <span class="muted">{record.response.bytes} bytes</span>
                </p>
              {/if}

              {#each record.extracted as value (value.name)}
                <p class="small" data-testid="hp-step-extracted">
                  <code>{value.name}</code> ← {value.from}:
                  <span class="mono">{value.value}</span>
                  {#if value.saved}
                    <button
                      class="btn btn-sm"
                      data-testid={'hp-save-value-' + value.name}
                      onclick={() => onSaveValue(value.name, value.value)}
                      >Write it to the environment</button
                    >
                  {/if}
                </p>
              {/each}

              {#each record.problems as problem, i (i)}
                <p class="warn small" data-testid="hp-step-problem">{problem}</p>
              {/each}

              {#if record.sent}
                <details>
                  <summary>What this step sent</summary>
                  <p class="mono small">{record.sent.method} {record.sent.url}</p>
                  <ul class="mono small plain">
                    {#each record.sent.headers as [name, value], i (i)}
                      <li>{name}: {value}</li>
                    {/each}
                  </ul>
                  {#if record.sent.body}
                    <pre class="mono small snippet">{record.sent.body}</pre>
                  {/if}
                  <p class="muted small">
                    Recorded with secret values already masked — they were masked on the way
                    into the record, so the stored row never held them.
                  </p>
                </details>
              {/if}

              {#if record.response?.body}
                <details>
                  <summary
                    >What came back{record.response.redacted ? ' (redacted)' : ''}</summary
                  >
                  <pre class="mono small snippet">{record.response.body}</pre>
                  {#if record.response.note}
                    <p class="muted small" data-testid="hp-step-cap-note">{record.response.note}</p>
                  {/if}
                </details>
              {:else if record.response?.note}
                <p class="muted small" data-testid="hp-step-cap-note">{record.response.note}</p>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ol>

    <button class="btn btn-sm" data-testid="hp-step-add" onclick={addStep}>Add a step</button>
  {/if}
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

  .controls {
    align-items: center;
    gap: var(--space-2);
  }

  .steps {
    list-style: none;
    counter-reset: step;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-3);
  }

  .step {
    counter-increment: step;
    border: 1px solid var(--border-color);
    border-left: 3px solid var(--border-strong-color);
    padding: var(--space-3);
  }

  /* Which step "Run step N" will take next, so walking a flow has a cursor
     you can see rather than one you have to count out. */
  .step.next {
    border-left-color: var(--color-primary);
  }

  .step .head {
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
  }

  .step .head::before {
    content: counter(step);
    font-family: var(--font-mono);
    font-weight: 700;
    color: var(--text-muted-color);
  }

  .name {
    flex: 1 1 12rem;
    min-width: 0;
  }

  .rules {
    margin-top: var(--space-2);
  }

  .rules > summary {
    cursor: pointer;
    font-size: var(--font-size-sm);
    color: var(--text-muted-color);
  }

  .record {
    margin-top: var(--space-3);
    padding-top: var(--space-2);
    border-top: 1px dashed var(--border-color);
  }

  .record summary {
    cursor: pointer;
    font-size: var(--font-size-sm);
    color: var(--text-muted-color);
  }

  .snippet {
    max-height: 14rem;
    overflow: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    padding: var(--space-2);
    border: 1px solid var(--border-color);
    margin: var(--space-1) 0;
  }

  ul.plain {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .error {
    color: var(--color-danger);
    font-size: var(--font-size-sm);
    margin: 0 0 var(--space-1);
  }

  .warn {
    color: var(--color-warning);
    margin: 0 0 var(--space-1);
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
