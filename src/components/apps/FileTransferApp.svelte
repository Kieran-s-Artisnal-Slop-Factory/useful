<script lang="ts">
  import Card from '../Card.svelte';
  import Explainer from '../Explainer.svelte';
  import {
    formatDuration,
    SIZE_UNITS,
    sizeUnitById,
    SPEED_UNITS,
    speedBothWays,
    speedUnitById,
    transferSeconds,
  } from '../../lib/calc/transfer';

  // Stateless tool — pure view state, zero IndexedDB traffic.
  let size = $state('1');
  let sizeUnit = $state('GB');
  let speed = $state('100');
  let speedUnit = $state('Mbps');
  let overhead = $state('0');

  const num = (s: string): number | null => {
    const v = Number(s);
    return Number.isFinite(v) ? v : null;
  };

  let result = $derived.by(() => {
    const sizeVal = num(size);
    const speedVal = num(speed);
    const overheadVal = num(overhead || '0');
    const su = sizeUnitById(sizeUnit);
    const spu = speedUnitById(speedUnit);
    if (sizeVal === null || speedVal === null || overheadVal === null || !su || !spu) return null;
    const bytes = sizeVal * su.bytes;
    const bps = speedVal * spu.bitsPerSecond;
    const seconds = transferSeconds(bytes, bps, overheadVal);
    if (seconds === null) return null;
    return {
      seconds,
      duration: formatDuration(seconds),
      bothWays: speedBothWays(bps),
      effective: overheadVal > 0 ? speedBothWays(bps * (1 - overheadVal / 100)) : null,
    };
  });
</script>

<div class="page-header">
  <h1>File transfer</h1>
</div>

<div class="stack">
  <Card title="Transfer">
    <div class="stack">
      <div class="grid">
        <div>
          <label for="ft-size">File size</label>
          <div class="pair">
            <input id="ft-size" data-testid="ft-size" type="number" min="0" step="any" bind:value={size} />
            <select data-testid="ft-size-unit" aria-label="Size unit" bind:value={sizeUnit}>
              {#each SIZE_UNITS as u (u.id)}
                <option value={u.id}>{u.label}</option>
              {/each}
            </select>
          </div>
        </div>
        <div>
          <label for="ft-speed">Network speed</label>
          <div class="pair">
            <input id="ft-speed" data-testid="ft-speed" type="number" min="0" step="any" bind:value={speed} />
            <select data-testid="ft-speed-unit" aria-label="Speed unit" bind:value={speedUnit}>
              {#each SPEED_UNITS as u (u.id)}
                <option value={u.id}>{u.label}</option>
              {/each}
            </select>
          </div>
        </div>
        <div>
          <label for="ft-overhead">Protocol overhead %</label>
          <input id="ft-overhead" data-testid="ft-overhead" type="number" min="0" max="99" step="1" bind:value={overhead} />
        </div>
      </div>
      {#if !result}
        <p class="error" role="alert">
          Enter a positive size and speed (overhead must stay below 100%).
        </p>
      {/if}
    </div>
  </Card>

  {#if result}
    <Card title="Estimate">
      <div class="stack">
        <div class="line">
          <span class="eyebrow-stamp eyebrow">Transfer time</span>
          <p class="big" data-testid="ft-time">{result.duration}</p>
          <p class="muted small" data-testid="ft-seconds">
            {result.seconds >= 100 ? Math.round(result.seconds).toLocaleString() : Number(result.seconds.toPrecision(3))} seconds
          </p>
        </div>
        <div class="line">
          <span class="eyebrow">Link speed</span>
          <p data-testid="ft-speed-both">{result.bothWays}</p>
        </div>
        {#if result.effective}
          <div class="line">
            <span class="eyebrow">After overhead</span>
            <p data-testid="ft-speed-effective">{result.effective}</p>
          </div>
        {/if}
      </div>
    </Card>
  {/if}

  <Explainer summary="Bits vs bytes (and why ISPs sound faster)" testid="explainer-bits-bytes">
    <p>
      Network speeds are sold in BITS per second (Mbps); file sizes are measured in
      BYTES (MB). One byte is 8 bits, so a 100 Mbps line moves at most 12.5 MB of file
      per second — divide the advertised number by 8 before estimating.
    </p>
    <p>
      This calculator uses decimal units throughout (1 MB = 1 000 000 bytes), matching
      how drives and ISPs label things. The overhead field trims the usable share of
      the link — protocol headers, TLS and retransmits typically eat a few percent.
    </p>
  </Explainer>
</div>

<style>
  .grid {
    display: grid;
    gap: var(--space-3);
    grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
  }

  .pair {
    display: flex;
    gap: var(--space-2);
  }

  .pair input {
    flex: 1 1 8rem;
  }

  .pair select {
    flex: 1 1 10rem;
    width: auto;
  }

  .big {
    font-size: var(--font-size-2xl);
    font-weight: 700;
  }

  .small {
    font-size: var(--font-size-sm);
  }

  .error {
    color: var(--color-danger);
    font-size: var(--font-size-sm);
  }
</style>
