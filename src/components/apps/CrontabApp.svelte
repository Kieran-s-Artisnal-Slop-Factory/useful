<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import Card from '../Card.svelte';
  import Explainer from '../Explainer.svelte';
  import { copyText } from '../../lib/exportFile';
  import { currentZone } from '../../lib/time/timezone';
  import {
    CronParseError,
    FIELDS,
    FIELD_ORDER,
    PRESETS,
    parseCron,
    type CronExpression,
    type FieldName,
  } from '../../lib/cron/parse';
  import { describeCron, OR_NOTE } from '../../lib/cron/describe';
  import { nextRuns, relativeTo, SEARCH_YEARS } from '../../lib/cron/next';
  import { toOnCalendar } from '../../lib/cron/systemd';
  import {
    MODE_LABELS,
    draftFromSource,
    sourceFromDraft,
    toggleValue,
    type FieldDraft,
    type FieldMode,
  } from '../../lib/cron/builder';

  /**
   * Crontab — read an expression, build one, and find out where the line goes.
   *
   * Stateless: nothing here is written to IndexedDB, and the spec asserts it.
   *
   * Everything on the page reads the parse tree, never the text: the sentence,
   * the next runs, the systemd translation and the builder controls all come
   * from one `parseCron()`, so none of them can disagree with each other about
   * what the expression means.
   */

  let text = $state('5 4 * * *');
  let now = $state(new Date());
  let tick: ReturnType<typeof setInterval> | undefined;
  let feedback = $state<string | null>(null);
  let feedbackTimer: ReturnType<typeof setTimeout> | undefined;

  onMount(() => {
    // The countdown beside each run goes stale on its own; a minute is the
    // resolution cron itself works at.
    tick = setInterval(() => (now = new Date()), 30_000);
  });

  onDestroy(() => {
    clearInterval(tick);
    clearTimeout(feedbackTimer);
  });

  function flash(message: string) {
    feedback = message;
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => (feedback = null), 2500);
  }

  let parsed = $derived.by<{ expr: CronExpression | null; error: CronParseError | null }>(() => {
    try {
      return { expr: parseCron(text), error: null };
    } catch (err) {
      return { expr: null, error: err instanceof CronParseError ? err : new CronParseError(String(err), null, 0) };
    }
  });

  let expr = $derived(parsed.expr);
  // Without the OR note: the page renders that itself, below and in red.
  let description = $derived(expr ? describeCron(expr, false) : '');
  let runs = $derived(expr ? nextRuns(expr, now, 5) : []);
  let timer = $derived(expr ? toOnCalendar(expr) : null);
  const zone = currentZone();

  /** The caret line that points at the character the parser objected to. */
  let caret = $derived(
    parsed.error ? `${' '.repeat(Math.max(0, Math.min(parsed.error.offset, text.length)))}^` : ''
  );

  const timeFormat = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  // ---- the builder -------------------------------------------------------

  /**
   * The controls are derived from the text, and editing one writes the text
   * back. Deriving rather than mirroring is what stops the two drifting: there
   * is no builder state to get out of step, and a field whose shape has no
   * control keeps its text untouched.
   */
  /**
   * The one piece of state the text cannot carry.
   *
   * Picking "Specific" before ticking anything has no expression to be read
   * back out of — an empty selection is written as `*`, which reads back as
   * "Every" and snaps the control shut before the first checkbox can be
   * clicked. The chosen mode is remembered until the expression is edited by
   * hand, at which point the text is the truth again.
   */
  let modeOverride = $state<Partial<Record<FieldName, FieldMode>>>({});

  let drafts = $derived.by<Record<FieldName, FieldDraft>>(() => {
    const sources = expr
      ? FIELD_ORDER.map((name) => expr![name].source)
      : text.trim().split(/\s+/).concat(['*', '*', '*', '*', '*']).slice(0, 5);
    return Object.fromEntries(
      FIELD_ORDER.map((name, i) => {
        const draft = draftFromSource(name, sources[i] ?? '*');
        const override = modeOverride[name];
        // An override only survives while the text still reads as "nothing
        // chosen yet"; the moment the field says something the text wins.
        return [name, override && draft.mode === 'every' ? { ...draft, mode: override } : draft];
      })
    ) as Record<FieldName, FieldDraft>;
  });

  function writeField(name: FieldName, draft: FieldDraft) {
    const parts = FIELD_ORDER.map((n) => (n === name ? sourceFromDraft(n, draft) : drafts[n].source || '*'));
    text = parts.join(' ');
  }

  function setMode(name: FieldName, mode: FieldMode) {
    modeOverride = { ...modeOverride, [name]: mode };
    writeField(name, { ...drafts[name], mode });
  }

  const listValues = (name: FieldName): number[] => {
    const spec = FIELDS[name];
    // Day-of-week's max is 7 (the second Sunday); the picker offers 0-6.
    const max = name === 'dow' ? 6 : spec.max;
    return Array.from({ length: max - spec.min + 1 }, (_, i) => spec.min + i);
  };

  const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const valueLabel = (name: FieldName, value: number): string => {
    if (name === 'month') return MONTH_LABELS[value - 1] ?? String(value);
    if (name === 'dow') return DAY_LABELS[value] ?? String(value);
    return String(value);
  };

  /** Checkboxes for the short fields, a comma list for the long ones. */
  const showsCheckboxes = (name: FieldName): boolean => name === 'month' || name === 'dow';

  async function copy(what: string, label: string) {
    flash((await copyText(what)) ? `${label} copied` : 'Copy failed — select it and copy by hand');
  }
</script>

<div class="page-header">
  <h1>Crontab</h1>
</div>

<div class="stack">
  <Card title="The expression">
    <div class="stack">
      <div>
        <label for="cron-input">A crontab line (five fields, or a @macro)</label>
        <input
          id="cron-input"
          data-testid="cron-input"
          class="expression"
          spellcheck="false"
          autocapitalize="off"
          autocorrect="off"
          bind:value={text}
          oninput={() => (modeOverride = {})}
        />
      </div>

      {#if parsed.error}
        <div class="error-box" role="alert" data-testid="cron-error">
          <pre class="caret" aria-hidden="true">{text}
{caret}</pre>
          <p>{parsed.error.message}</p>
          {#if parsed.error.field}
            <p class="muted small">In the {FIELDS[parsed.error.field].label} field.</p>
          {/if}
        </div>
      {:else if expr}
        <p class="description" data-testid="cron-description">{description}</p>
        {#if expr.domDowOr}
          <p class="warn small" data-testid="cron-or-warning">{OR_NOTE}</p>
        {/if}
        {#if expr.macro}
          <p class="muted small" data-testid="cron-macro">
            <code>{expr.macro}</code> is shorthand for <code>{FIELD_ORDER.map((n) => expr![n].source).join(' ')}</code>.
          </p>
        {/if}
        {#if expr.command}
          <p class="muted small" data-testid="cron-command">
            The command is <code>{expr.command}</code> — cron runs it with <code>sh -c</code>.
          </p>
        {/if}
      {/if}

      <div class="row">
        <button class="btn" data-testid="cron-copy" onclick={() => copy(text, 'The line')}>Copy the line</button>
      </div>

      <div>
        <p class="muted small">Common schedules</p>
        <div class="chips" data-testid="cron-presets">
          {#each PRESETS as preset (preset.expression + preset.label)}
            <button
              class="chip"
              class:on={text.trim() === preset.expression}
              data-testid={`cron-preset-${preset.expression}`}
              onclick={() => {
                text = preset.expression;
                modeOverride = {};
              }}
            >
              {preset.label}
            </button>
          {/each}
        </div>
      </div>
    </div>
  </Card>

  <Card title="Build it" collapsible open={false} testid="cron-builder-card">
    <div class="stack">
      <p class="muted small">
        These controls read the expression above and write it back. A field written in a shape the
        controls cannot draw (<code>1-5/2,30</code>, say) is left exactly as typed.
      </p>
      {#each FIELD_ORDER as name (name)}
        {@const draft = drafts[name]}
        <div class="field" data-testid={`cron-field-${name}`}>
          <div class="field-head">
            <span class="field-name">{FIELDS[name].label}</span>
            <code class="field-source">{draft.source || '*'}</code>
          </div>
          <div class="row">
            <select
              aria-label={`How to set the ${FIELDS[name].label}`}
              data-testid={`cron-mode-${name}`}
              value={draft.mode}
              onchange={(e) => setMode(name, (e.currentTarget as HTMLSelectElement).value as FieldMode)}
            >
              {#each Object.entries(MODE_LABELS) as [mode, label] (mode)}
                <option value={mode} disabled={mode === 'custom' && draft.mode !== 'custom'}>{label}</option>
              {/each}
            </select>

            {#if draft.mode === 'step'}
              <label class="inline" for={`cron-step-${name}`}>every</label>
              <input
                id={`cron-step-${name}`}
                data-testid={`cron-step-${name}`}
                class="num"
                type="number"
                min="1"
                max={FIELDS[name].max}
                value={draft.step}
                onchange={(e) =>
                  writeField(name, { ...draft, step: Number((e.currentTarget as HTMLInputElement).value) })}
              />
            {:else if draft.mode === 'range'}
              <label class="inline" for={`cron-from-${name}`}>from</label>
              <input
                id={`cron-from-${name}`}
                data-testid={`cron-from-${name}`}
                class="num"
                type="number"
                min={FIELDS[name].min}
                max={FIELDS[name].max}
                value={draft.from}
                onchange={(e) =>
                  writeField(name, { ...draft, from: Number((e.currentTarget as HTMLInputElement).value) })}
              />
              <label class="inline" for={`cron-to-${name}`}>through</label>
              <input
                id={`cron-to-${name}`}
                data-testid={`cron-to-${name}`}
                class="num"
                type="number"
                min={FIELDS[name].min}
                max={FIELDS[name].max}
                value={draft.to}
                onchange={(e) =>
                  writeField(name, { ...draft, to: Number((e.currentTarget as HTMLInputElement).value) })}
              />
            {:else if draft.mode === 'list'}
              {#if showsCheckboxes(name)}
                <div class="chips">
                  {#each listValues(name) as value (value)}
                    <label class="chip check-chip" class:on={draft.values.includes(value)}>
                      <input
                        type="checkbox"
                        checked={draft.values.includes(value)}
                        data-testid={`cron-pick-${name}-${value}`}
                        onchange={() => writeField(name, toggleValue(draft, value))}
                      />
                      {valueLabel(name, value)}
                    </label>
                  {/each}
                </div>
              {:else}
                <label class="inline" for={`cron-list-${name}`}>at</label>
                <input
                  id={`cron-list-${name}`}
                  data-testid={`cron-list-${name}`}
                  value={draft.values.join(',')}
                  placeholder="0,15,30"
                  onchange={(e) => {
                    const values = (e.currentTarget as HTMLInputElement).value
                      .split(',')
                      .map((v) => Number(v.trim()))
                      .filter((v) => Number.isFinite(v));
                    writeField(name, { ...draft, values });
                  }}
                />
              {/if}
            {/if}
          </div>
        </div>
      {/each}
    </div>
  </Card>

  <Card title="When it runs" testid="cron-runs-card">
    <div class="stack">
      {#if expr?.reboot}
        <p data-testid="cron-runs-note">
          <code>@reboot</code> has no schedule — it runs once, when cron starts at boot. It does
          <strong>not</strong> run when you edit the crontab.
        </p>
      {:else if !expr}
        <p class="muted" data-testid="cron-runs-note">Fix the expression above and the next runs appear here.</p>
      {:else if runs.length === 0}
        <p class="warn" data-testid="cron-runs-note">
          This expression never runs — there is no matching date in the next {SEARCH_YEARS} years.
          <code>0 0 30 2 *</code> is the classic: February has no 30th.
        </p>
      {:else}
        <ol class="runs" data-testid="cron-runs">
          {#each runs as run (run.getTime())}
            <li>
              <time datetime={run.toISOString()}>{timeFormat.format(run)}</time>
              <span class="muted small">{relativeTo(now, run)}</span>
            </li>
          {/each}
        </ol>
        <p class="muted small" data-testid="cron-zone">
          Shown in <strong>{zone}</strong>, this browser's timezone. Cron reads the
          <em>machine's</em> clock, so a server in another zone runs this at a different moment.
        </p>
        <p class="muted small">
          Daylight saving bites once a year: a daily job at a time that does not exist on the morning
          the clocks go forward is skipped, and one at a time that happens twice on the morning they
          go back runs once on most crons — which is why 02:30 daily is a bad habit and 04:00 is not.
        </p>
      {/if}
    </div>
  </Card>

  <Card title="As a systemd timer" collapsible open={false} testid="cron-systemd-card">
    <div class="stack">
      {#if timer?.onCalendar}
        <p class="muted small">The same schedule, for a machine with systemd:</p>
        <pre class="out" data-testid="cron-oncalendar">OnCalendar={timer.onCalendar}</pre>
        <pre class="out" data-testid="cron-unit">{timer.unit}</pre>
        <div class="row">
          <button class="btn" data-testid="cron-copy-unit" onclick={() => copy(timer!.unit!, 'The unit')}>
            Copy the unit
          </button>
        </div>
        <p class="muted small">
          Save it as <code>/etc/systemd/system/myjob.timer</code> beside a <code>myjob.service</code>
          holding the command, then <code>systemctl enable --now myjob.timer</code>.
        </p>
      {/if}
      {#if timer?.warning}
        <p class="warn small" data-testid="cron-systemd-warning">{timer.warning}</p>
      {/if}
    </div>
  </Card>

  <Card title="Where the line goes" collapsible open={false} testid="cron-where-card">
    <div class="stack">
      <table class="where">
        <thead>
          <tr><th>Place</th><th>Takes a user column?</th><th>What it is for</th></tr>
        </thead>
        <tbody>
          <tr>
            <td><code>crontab -e</code></td>
            <td><strong>No</strong></td>
            <td>Your own crontab. Five fields, then the command. Never edit the file under
              <code>/var/spool/cron</code> by hand — <code>crontab -e</code> validates and reloads.</td>
          </tr>
          <tr>
            <td><code>/etc/crontab</code></td>
            <td><strong>Yes</strong></td>
            <td>System-wide. Five fields, then <em>the user to run as</em>, then the command.</td>
          </tr>
          <tr>
            <td><code>/etc/cron.d/yourfile</code></td>
            <td><strong>Yes</strong></td>
            <td>One file per package or job — the tidy place for system jobs. Same user column.</td>
          </tr>
          <tr>
            <td><code>/etc/cron.hourly</code> and friends</td>
            <td>—</td>
            <td>No cron line at all: drop an <strong>executable script</strong> in, with
              <strong>no file extension</strong>. <code>run-parts</code> silently ignores anything
              named <code>backup.sh</code>.</td>
          </tr>
        </tbody>
      </table>
      <p class="warn small" data-testid="cron-user-column">
        The user column is the mistake that eats an afternoon: paste a line from
        <code>crontab -e</code> straight into <code>/etc/cron.d</code> and cron reads the first word
        of your command as a username, then gives up — usually without telling you.
      </p>
    </div>
  </Card>

  <Explainer summary="It works in my shell but not in cron" testid="explainer-cron">
    <p>
      <strong>Cron's <code>PATH</code> is nearly empty.</strong> Most crons run jobs with
      <code>PATH=/usr/bin:/bin</code> and nothing else — no <code>/usr/local/bin</code>, none of
      your shell's additions. A command that works when you type it fails with "not found" here.
      Use absolute paths, or set <code>PATH=</code> at the top of the crontab.
    </p>
    <p>
      <strong><code>%</code> means newline.</strong> Inside a cron command an unescaped
      <code>%</code> ends the command and everything after it becomes standard input. That is why
      <code>date +%Y-%m-%d</code> mysteriously produces nothing: write <code>\%</code> for each one.
    </p>
    <p>
      <strong>It is not your login shell.</strong> No <code>.bashrc</code>, no
      <code>.profile</code>, and <code>SHELL</code> is <code>/bin/sh</code> unless the crontab says
      otherwise — so bashisms fail. The environment is so nearly empty that the reliable habit is a
      script that sets up its own, with the crontab line just calling it.
    </p>
    <p>
      <strong>Output goes somewhere you are not looking.</strong> Anything a job prints is mailed to
      the crontab's owner, and on a machine with no mail set up it vanishes. Redirect it yourself:
      <code>&gt;&gt; /var/log/myjob.log 2&gt;&amp;1</code>.
    </p>
    <p>
      <strong>The last line needs a newline.</strong> Some crons silently ignore a final line with
      no line ending after it.
    </p>
  </Explainer>

  <p class="muted small" aria-live="polite" data-testid="cron-feedback">{feedback ?? ''}</p>
</div>

<style>
  .small {
    font-size: var(--font-size-sm);
  }

  .num {
    width: 5.5rem;
  }

  .inline {
    display: inline;
    margin-bottom: 0;
  }

  .expression {
    font-family: var(--font-mono);
    font-size: var(--font-size-lg, 1.1rem);
    letter-spacing: 0.06em;
  }

  .description {
    font-size: var(--font-size-lg, 1.1rem);
    font-weight: 600;
  }

  .error-box {
    border: 1.5px solid var(--color-danger);
    border-radius: var(--radius-sm);
    padding: var(--space-3);
    color: var(--color-danger);
  }

  .caret {
    font-family: var(--font-mono);
    letter-spacing: 0.06em;
    margin: 0 0 var(--space-2);
    white-space: pre;
    overflow-x: auto;
  }

  .warn {
    color: var(--color-danger);
  }

  .out {
    border: 1.5px solid var(--border-strong-color);
    border-radius: var(--radius-sm);
    padding: var(--space-3);
    overflow-x: auto;
    white-space: pre;
    margin: 0;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
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
  }

  .chip.on {
    border-color: var(--color-primary);
    box-shadow: inset 0 0 0 1px var(--color-primary);
  }

  .check-chip {
    margin-bottom: 0;
  }

  .field {
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    padding: var(--space-3);
  }

  .field-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
  }

  .field-name {
    font-weight: 600;
    text-transform: capitalize;
  }

  .field-source {
    font-family: var(--font-mono);
    color: var(--text-muted-color);
  }

  .runs {
    margin: 0;
    padding-left: var(--space-5);
  }

  .runs li {
    display: flex;
    gap: var(--space-3);
    align-items: baseline;
    padding: 2px 0;
  }

  .runs time {
    font-family: var(--font-mono);
  }

  .where {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--font-size-sm);
  }

  .where th,
  .where td {
    border: 1px solid var(--border-color);
    padding: var(--space-2);
    text-align: left;
    vertical-align: top;
  }
</style>
