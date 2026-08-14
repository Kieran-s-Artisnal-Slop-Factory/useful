<script lang="ts">
  import { onMount } from 'svelte';
  import Card from '../Card.svelte';
  import ZonePicker from './ZonePicker.svelte';
  import { getSingleton, putSingleton } from '../../lib/db/repo';
  import type { Preferences } from '../../lib/db/types';
  import {
    allZones,
    currentZone,
    instantInZone,
    isValidZone,
    offsetLabel,
    wallTimeToInstant,
    zoneOffsetMinutes,
    type WallTime,
  } from '../../lib/time/timezone';

  const zones = allZones();
  const here = currentZone();

  let from = $state(here);
  let to = $state(here);
  // datetime-local value, interpreted as a wall time IN the from-zone.
  let when = $state(defaultWhen());

  function defaultWhen(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  onMount(async () => {
    const prefs = await getSingleton<Preferences>('preferences');
    // isValidZone, not list membership: a zone picked via city search can be
    // an alias (e.g. Europe/Kyiv) that Intl accepts but the list spells
    // differently.
    if (prefs?.tz_last_from && isValidZone(prefs.tz_last_from)) from = prefs.tz_last_from;
    if (prefs?.tz_last_to && isValidZone(prefs.tz_last_to)) to = prefs.tz_last_to;
  });

  function parseWhen(value: string): WallTime | null {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!m) return null;
    return { year: +m[1]!, month: +m[2]!, day: +m[3]!, hour: +m[4]!, minute: +m[5]! };
  }

  let result = $derived.by(() => {
    const wall = parseWhen(when);
    if (!wall) return null;
    const instant = wallTimeToInstant(wall, from);
    const diffMin = zoneOffsetMinutes(to, instant) - zoneOffsetMinutes(from, instant);
    const sign = diffMin === 0 ? '' : diffMin > 0 ? '+' : '−';
    const abs = Math.abs(diffMin);
    const diffLabel =
      diffMin === 0
        ? 'same offset'
        : `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')} vs ${offsetLabel(from, instant)}`;
    return {
      fromText: instantInZone(instant, from),
      fromOffset: offsetLabel(from, instant),
      toText: instantInZone(instant, to),
      toOffset: offsetLabel(to, instant),
      diffLabel,
    };
  });

  // Remembering the pair is an explicit pick action — never a render effect.
  function remember() {
    void putSingleton<Partial<Preferences>>('preferences', { tz_last_from: from, tz_last_to: to });
  }

  function swap() {
    [from, to] = [to, from];
    remember();
  }
</script>

<div class="page-header">
  <h1>Timezones</h1>
</div>

<div class="stack">
  <Card title="Convert">
    <div class="stack">
      <div>
        <label for="tz-when">Time (in the from-zone)</label>
        <input id="tz-when" data-testid="tz-when" type="datetime-local" bind:value={when} />
      </div>
      <div class="pickers">
        <ZonePicker id="tz-from" label="From" {zones} bind:value={from} onpick={remember} />
        <button class="btn swap" data-testid="tz-swap" onclick={swap} aria-label="Swap zones">⇄</button>
        <ZonePicker id="tz-to" label="To" {zones} bind:value={to} onpick={remember} />
      </div>
      <div class="row">
        <button class="btn btn-sm" data-testid="tz-use-current-from" onclick={() => { from = here; remember(); }}>
          From = my zone
        </button>
        <button class="btn btn-sm" onclick={() => { to = here; remember(); }}>To = my zone</button>
      </div>
    </div>
  </Card>

  {#if result}
    <Card title="Result">
      <div class="stack">
        <div class="line">
          <span class="eyebrow">From · {result.fromOffset}</span>
          <p data-testid="tz-from-text">{result.fromText}</p>
        </div>
        <div class="line">
          <span class="eyebrow">To · {result.toOffset} ({result.diffLabel})</span>
          <p class="to" data-testid="tz-to-text">{result.toText}</p>
        </div>
      </div>
    </Card>
  {/if}
</div>

<style>
  .pickers {
    display: flex;
    align-items: flex-end;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .swap {
    flex: none;
    margin-bottom: 2.4rem;
  }

  .line p {
    font-size: var(--font-size-xl);
    font-weight: 700;
  }

  .to {
    color: var(--color-primary-strong);
  }
</style>
