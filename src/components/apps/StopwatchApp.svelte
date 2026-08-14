<script lang="ts">
  import { onMount } from 'svelte';
  import Card from '../Card.svelte';
  import { getSingleton, putSingleton } from '../../lib/db/repo';
  import type { Stopwatch } from '../../lib/db/types';
  import { formatElapsed } from '../../lib/time/duration';

  // Domain fields only; the row is written exclusively via putSingleton on
  // user actions — never per tick. Display derives from the wall clock, so
  // the stopwatch survives reload, navigation, and app restarts.
  type Fields = Pick<Stopwatch, 'started_at' | 'elapsed_before_pause_ms' | 'laps' | 'state'>;
  const ZERO: Fields = { started_at: null, elapsed_before_pause_ms: 0, laps: [], state: 'idle' };

  let loading = $state(true);
  let sw = $state<Fields>({ ...ZERO });
  let now = $state(Date.now());

  onMount(() => {
    void (async () => {
      const row = await getSingleton<Stopwatch>('stopwatch');
      if (row) sw = { started_at: row.started_at, elapsed_before_pause_ms: row.elapsed_before_pause_ms, laps: row.laps, state: row.state };
      loading = false;
    })();
    // Display tick only — 100ms for smooth tenths; writes nothing.
    const interval = setInterval(() => (now = Date.now()), 100);
    return () => clearInterval(interval);
  });

  let elapsed = $derived(
    sw.elapsed_before_pause_ms + (sw.state === 'running' && sw.started_at ? Math.max(0, now - Date.parse(sw.started_at)) : 0)
  );

  async function write(fields: Fields) {
    sw = fields;
    await putSingleton<Fields>('stopwatch', fields);
  }

  function startOrResume() {
    void write({ ...sw, started_at: new Date().toISOString(), state: 'running' });
  }

  function pause() {
    void write({ ...sw, elapsed_before_pause_ms: elapsed, started_at: null, state: 'paused' });
  }

  function lap() {
    void write({ ...sw, laps: [...sw.laps, elapsed] });
  }

  function reset() {
    void write({ ...ZERO });
  }

  // Newest first, with the split (time since the previous lap).
  let lapRows = $derived(
    sw.laps
      .map((total, i) => ({ n: i + 1, total, split: total - (sw.laps[i - 1] ?? 0) }))
      .reverse()
  );
</script>

<div class="page-header">
  <h1>Stopwatch</h1>
</div>

{#if loading}
  <p class="muted">Loading…</p>
{:else}
  <div class="stack">
    <Card>
      <div class="stack center">
        <p class="clock" data-testid="stopwatch-elapsed" aria-live="off">{formatElapsed(elapsed)}</p>
        <div class="row center-row">
          {#if sw.state === 'running'}
            <button class="btn" data-testid="stopwatch-lap" onclick={lap}>Lap</button>
            <button class="btn btn-primary" data-testid="stopwatch-pause" onclick={pause}>Pause</button>
          {:else}
            <button class="btn btn-primary" data-testid="stopwatch-start" onclick={startOrResume}>
              {sw.state === 'paused' ? 'Resume' : 'Start'}
            </button>
            {#if sw.state === 'paused'}
              <button class="btn" data-testid="stopwatch-reset" onclick={reset}>Reset</button>
            {/if}
          {/if}
        </div>
      </div>
    </Card>

    {#if sw.laps.length > 0}
      <Card title="Laps">
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr><th>Lap</th><th>Split</th><th>Total</th></tr>
            </thead>
            <tbody>
              {#each lapRows as lapRow (lapRow.n)}
                <tr data-testid="stopwatch-lap-row">
                  <td>{lapRow.n}</td>
                  <td>{formatElapsed(lapRow.split)}</td>
                  <td>{formatElapsed(lapRow.total)}</td>
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
  .center {
    align-items: center;
  }

  .center-row {
    justify-content: center;
  }

  .clock {
    font-size: 3.2rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.04em;
  }
</style>
