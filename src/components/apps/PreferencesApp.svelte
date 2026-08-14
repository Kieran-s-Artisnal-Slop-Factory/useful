<script lang="ts">
  import { onMount } from 'svelte';
  import Card from '../Card.svelte';
  import { getSingleton, putSingleton } from '../../lib/db/repo';
  import type { Preferences } from '../../lib/db/types';
  import { MAX_ALARM_SECONDS } from '../../lib/time/engine.svelte';

  // `preferences` is a singleton row. Rendering never writes (the data suite
  // asserts a page load leaves the database byte-identical); every toggle
  // below writes exactly the one field it names via putSingleton.
  const SYNC_FIELDS = new Set(['id', 'updated_at', 'deleted_at', 'server_seq', 'field_updated_at']);

  const BOOL_PREFS: { key: keyof Preferences & string; label: string; fallback: boolean }[] = [
    { key: 'timer_default_sound', label: 'Play sound', fallback: true },
    { key: 'timer_default_vibrate', label: 'Vibrate', fallback: false },
    { key: 'timer_default_notify', label: 'Show notification', fallback: false },
    { key: 'timer_default_delete_on_complete', label: 'Delete when finished', fallback: false },
  ];
  const KNOWN = new Set<string>([
    ...BOOL_PREFS.map((p) => p.key),
    'timer_alarm_seconds',
    'auto_remember_based_on_last_value',
  ]);

  let loading = $state(true);
  let prefs = $state<Record<string, unknown>>({});
  let alarmSeconds = $state(MAX_ALARM_SECONDS);

  onMount(async () => {
    const row = await getSingleton<Preferences>('preferences');
    prefs = { ...(row ?? {}) };
    alarmSeconds = row?.timer_alarm_seconds ?? MAX_ALARM_SECONDS;
    loading = false;
  });

  function boolValue(key: string, fallback: boolean): boolean {
    const v = prefs[key];
    return typeof v === 'boolean' ? v : fallback;
  }

  async function setPref(key: string, value: unknown) {
    prefs = { ...prefs, [key]: value };
    await putSingleton('preferences', { [key]: value });
  }

  async function saveAlarmSeconds() {
    const v = Math.min(MAX_ALARM_SECONDS, Math.max(1, Math.round(Number(alarmSeconds) || MAX_ALARM_SECONDS)));
    alarmSeconds = v;
    if (prefs.timer_alarm_seconds !== v) await setPref('timer_alarm_seconds', v);
  }

  // Anything else stored on the row (last-used values, future tools) shows
  // read-only below so nothing is invisible.
  let otherFields = $derived(
    Object.entries(prefs).filter(([key]) => !SYNC_FIELDS.has(key) && !KNOWN.has(key))
  );
</script>

<div class="page-header">
  <h1>Preferences</h1>
</div>

{#if loading}
  <p class="muted">Loading…</p>
{:else}
  <div class="stack">
    <Card title="Timer defaults">
      <div class="stack">
        <p class="muted small">
          Pre-filled into every new timer. With auto-remember on, saving a timer
          updates these to whatever it used.
        </p>
        <div class="row">
          {#each BOOL_PREFS as def (def.key)}
            <label class="check">
              <input
                type="checkbox"
                data-testid={'pref-' + def.key}
                checked={boolValue(def.key, def.fallback)}
                onchange={(e) => setPref(def.key, e.currentTarget.checked)}
              />
              {def.label}
            </label>
          {/each}
        </div>
      </div>
    </Card>

    <Card title="Alarm">
      <div class="stack">
        <p class="muted small">
          A finished timer keeps ringing/vibrating until its banner is dismissed
          or the timer is used again — at most this many seconds (cap {MAX_ALARM_SECONDS}).
        </p>
        <div class="row">
          <label class="inline" for="pref-alarm-seconds">Ring for</label>
          <input
            id="pref-alarm-seconds"
            data-testid="pref-timer_alarm_seconds"
            class="num"
            type="number"
            min="1"
            max={MAX_ALARM_SECONDS}
            bind:value={alarmSeconds}
            onchange={saveAlarmSeconds}
          />
          <span class="muted small">seconds</span>
        </div>
      </div>
    </Card>

    <Card title="Behaviour">
      <label class="check">
        <input
          type="checkbox"
          data-testid="pref-auto_remember_based_on_last_value"
          checked={boolValue('auto_remember_based_on_last_value', true)}
          onchange={(e) => setPref('auto_remember_based_on_last_value', e.currentTarget.checked)}
        />
        Auto-remember defaults from the last saved timer
      </label>
    </Card>

    {#if otherFields.length > 0}
      <Card title="Remembered values">
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Preference</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {#each otherFields as [key, value] (key)}
                <tr data-testid="preferences-field" data-field={key}>
                  <td class="mono">{key}</td>
                  <td class="mono">{JSON.stringify(value)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </Card>
    {/if}
  </div>
{/if}

<style>
  .small {
    font-size: var(--font-size-sm);
  }

  .check {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--text-color);
    font-size: var(--font-size-base);
    text-transform: none;
    letter-spacing: normal;
    margin-bottom: 0;
  }

  .inline {
    display: inline;
    margin-bottom: 0;
  }

  .num {
    width: 5rem;
  }

  .mono {
    font-size: var(--font-size-sm);
    overflow-wrap: anywhere;
  }
</style>
