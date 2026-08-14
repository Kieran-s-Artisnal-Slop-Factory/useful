<script lang="ts">
  import { onMount } from 'svelte';
  import Card from '../Card.svelte';
  import Explainer from '../Explainer.svelte';
  import { getSingleton, putSingleton } from '../../lib/db/repo';
  import type { Preferences } from '../../lib/db/types';
  import {
    apertureStops,
    equivalentSettings,
    FORMATS,
    formatById,
    formatShutter,
    formatStops,
    isoStops,
    parseShutter,
    sensorStops,
    shutterStops,
    snapAperture,
    snapFocal,
    snapIso,
    type SensorFormatId,
  } from '../../lib/calc/photography';

  // Set A — the scene settings, shared by both calculators.
  let formatId = $state<SensorFormatId>('mft');
  let focal = $state('20');
  let aperture = $state('2.8');
  let shutter = $state('1/125');
  let iso = $state('200');

  // Set B — the light-stop comparison (focal length doesn't move light).
  let formatIdB = $state<SensorFormatId>('ff');
  let apertureB = $state('2.8');
  let shutterB = $state('1/125');
  let isoB = $state('200');

  onMount(async () => {
    // Restore the remembered sensor format; reading writes nothing.
    const prefs = await getSingleton<Preferences>('preferences');
    if (prefs?.photo_last_format && formatById(prefs.photo_last_format)) {
      formatId = prefs.photo_last_format;
    }
  });

  // Remembering is an explicit pick action — never a render effect.
  function rememberFormat() {
    void putSingleton<Partial<Preferences>>('preferences', { photo_last_format: formatId });
  }

  const num = (s: string): number | null => {
    const v = Number(s);
    return Number.isFinite(v) && v > 0 ? v : null;
  };

  let scene = $derived.by(() => {
    const f = num(focal);
    const n = num(aperture);
    const t = parseShutter(shutter);
    const i = num(iso);
    if (f === null || n === null || t === null || i === null) return null;
    return { focal: f, aperture: n, shutterSec: t, iso: i, crop: formatById(formatId)!.crop };
  });

  let equivalents = $derived.by(() => {
    if (!scene) return null;
    return FORMATS.map((fmt) => {
      const eq = equivalentSettings(scene, scene.crop, fmt.crop);
      return {
        fmt,
        source: fmt.id === formatId,
        focal: snapFocal(eq.focal),
        aperture: snapAperture(eq.aperture),
        iso: snapIso(eq.iso),
      };
    });
  });

  let stops = $derived.by(() => {
    if (!scene) return null;
    const nB = num(apertureB);
    const tB = parseShutter(shutterB);
    const iB = num(isoB);
    if (nB === null || tB === null || iB === null) return null;
    const cropB = formatById(formatIdB)!.crop;

    // Per-component "A − B" per the plan's formulas; positive = A sits higher
    // on that dial. The meaning strings translate into light.
    const sh = shutterStops(scene.shutterSec, tB);
    const ap = apertureStops(scene.aperture, nB);
    const is = isoStops(scene.iso, iB);
    const se = sensorStops(scene.crop, cropB);
    return {
      rows: [
        {
          id: 'shutter',
          name: 'Shutter',
          stops: sh,
          meaning:
            sh === 0
              ? 'Same exposure time.'
              : `A stays open ${fmtX(Math.abs(sh))} ${sh > 0 ? 'longer — more' : 'shorter — less'} light.`,
        },
        {
          id: 'aperture',
          name: 'Aperture',
          stops: ap,
          meaning:
            ap === 0
              ? 'Same f-number.'
              : `A's aperture passes ${fmtX(Math.abs(ap))} ${ap > 0 ? 'less' : 'more'} light.`,
        },
        {
          id: 'iso',
          name: 'ISO',
          stops: is,
          meaning:
            is === 0
              ? 'Same gain.'
              : `A is ${fmtX(Math.abs(is))} ${is > 0 ? 'brighter' : 'darker'} from gain — no light moved.`,
        },
        {
          id: 'sensor',
          name: 'Sensor',
          stops: se,
          meaning:
            se === 0
              ? 'Same sensor area.'
              : `A's sensor gathers ${fmtX(Math.abs(se))} ${se > 0 ? 'less' : 'more'} total light.`,
        },
      ],
      // Positive = A is brighter / gathers more. Aperture and sensor flip sign:
      // a HIGHER f-number or crop factor means LESS light.
      exposure: sh - ap + is,
      totalLight: sh - ap - se,
    };
  });

  /** "0.83 stop" / "2 stops" for the meaning sentences. */
  function fmtX(stops: number): string {
    const r = Math.round(stops * 100) / 100;
    return `${r} ${r === 1 ? 'stop' : 'stops'}`;
  }
</script>

<div class="page-header">
  <h1>Photography</h1>
</div>

<div class="stack">
  <Card title="Your settings">
    <div class="stack">
      <div class="grid">
        <div>
          <label for="ph-format">Sensor format</label>
          <select id="ph-format" data-testid="ph-format" bind:value={formatId} onchange={rememberFormat}>
            {#each FORMATS as fmt (fmt.id)}
              <option value={fmt.id}>{fmt.label} ({fmt.crop}× crop)</option>
            {/each}
          </select>
        </div>
        <div>
          <label for="ph-focal">Focal length (mm)</label>
          <input id="ph-focal" data-testid="ph-focal" type="number" min="1" step="1" bind:value={focal} />
        </div>
        <div>
          <label for="ph-aperture">Aperture (f-number)</label>
          <input id="ph-aperture" data-testid="ph-aperture" type="number" min="0.7" step="0.1" bind:value={aperture} />
        </div>
        <div>
          <label for="ph-shutter">Shutter (1/250, 0.5 or 2s)</label>
          <input id="ph-shutter" data-testid="ph-shutter" type="text" bind:value={shutter} />
        </div>
        <div>
          <label for="ph-iso">ISO</label>
          <input id="ph-iso" data-testid="ph-iso" type="number" min="25" step="25" bind:value={iso} />
        </div>
      </div>
      {#if !scene}
        <p class="error" role="alert">Enter a positive focal length, f-number, shutter and ISO.</p>
      {/if}
    </div>
  </Card>

  <Card title="Equivalent settings">
    <div class="stack">
      {#if equivalents}
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Format</th>
                <th>Focal</th>
                <th>Aperture</th>
                <th>ISO</th>
                <th>Shutter</th>
              </tr>
            </thead>
            <tbody>
              {#each equivalents as row (row.fmt.id)}
                <tr data-testid={'ph-eq-' + row.fmt.id} class:source={row.source}>
                  <td>
                    {row.fmt.label}
                    {#if row.source}<span class="eyebrow"> · yours</span>{/if}
                  </td>
                  <td data-testid={'ph-eq-' + row.fmt.id + '-focal'}>{row.focal}mm</td>
                  <td data-testid={'ph-eq-' + row.fmt.id + '-aperture'}>f/{row.aperture}</td>
                  <td data-testid={'ph-eq-' + row.fmt.id + '-iso'}>ISO {row.iso}</td>
                  <td>{formatShutter(scene!.shutterSec)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <p class="muted small">
          Total-light equivalents (focal × crop, f-number × crop, ISO × crop², shutter
          unchanged), snapped to the standard 1/3-stop scale.
        </p>
      {:else}
        <p class="muted">Waiting for valid settings above.</p>
      {/if}

      <Explainer summary="What 'equivalent' means here" testid="explainer-equivalence">
        <p>
          At the same f-number, shutter and ISO, every format meters the same — per-area
          <em>exposure</em> is identical. What differs is the AREA collecting it: a full
          frame sensor is crop² larger than a Micro 4/3 sensor, so it gathers 4× the
          total light for the same exposure.
        </p>
        <p>
          These rows match total light (and so noise and depth of field): multiply the
          focal length and f-number by the crop ratio and the ISO by its square. The
          brightness of the picture doesn't change — the ISO rise offsets the smaller
          per-area exposure the dimmer f-number causes.
        </p>
      </Explainer>
    </div>
  </Card>

  <Card title="Light stops — compare a second set">
    <div class="stack">
      <div class="grid">
        <div>
          <label for="ph-b-format">Sensor format</label>
          <select id="ph-b-format" data-testid="ph-b-format" bind:value={formatIdB}>
            {#each FORMATS as fmt (fmt.id)}
              <option value={fmt.id}>{fmt.label} ({fmt.crop}× crop)</option>
            {/each}
          </select>
        </div>
        <div>
          <label for="ph-b-aperture">Aperture (f-number)</label>
          <input id="ph-b-aperture" data-testid="ph-b-aperture" type="number" min="0.7" step="0.1" bind:value={apertureB} />
        </div>
        <div>
          <label for="ph-b-shutter">Shutter</label>
          <input id="ph-b-shutter" data-testid="ph-b-shutter" type="text" bind:value={shutterB} />
        </div>
        <div>
          <label for="ph-b-iso">ISO</label>
          <input id="ph-b-iso" data-testid="ph-b-iso" type="number" min="25" step="25" bind:value={isoB} />
        </div>
      </div>

      {#if stops}
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Component</th>
                <th>Stops (A − B)</th>
                <th>Meaning</th>
              </tr>
            </thead>
            <tbody>
              {#each stops.rows as row (row.id)}
                <tr>
                  <td>{row.name}</td>
                  <td class="mono" data-testid={'ph-stops-' + row.id}>{formatStops(row.stops)}</td>
                  <td class="muted small">{row.meaning}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <div class="totals">
          <div class="line">
            <span class="eyebrow">Image brightness</span>
            <p data-testid="ph-stops-exposure">
              {formatStops(stops.exposure)} stops
              <span class="muted small">
                — your settings (A) render {stops.exposure === 0 ? 'the same brightness as' : stops.exposure > 0 ? 'brighter than' : 'darker than'} set B
              </span>
            </p>
          </div>
          <div class="line">
            <span class="eyebrow">Total light</span>
            <p data-testid="ph-stops-light">
              {formatStops(stops.totalLight)} stops
              <span class="muted small">
                — A gathers {stops.totalLight === 0 ? 'the same total light as' : stops.totalLight > 0 ? 'more total light than' : 'less total light than'} B (noise / DoF)
              </span>
            </p>
          </div>
        </div>
      {:else}
        <p class="muted">Waiting for a valid second set.</p>
      {/if}

      <Explainer summary="How the stops are computed" testid="explainer-stops">
        <p>
          Each row is exact, not snapped: shutter <code>log2(tA/tB)</code>, ISO
          <code>log2(isoA/isoB)</code>, aperture <code>2·log2(NA/NB)</code>, sensor
          <code>2·log2(cropA/cropB)</code>. One stop is a doubling of light — aperture
          and sensor terms are doubled because light scales with the SQUARE of the
          f-number and of the crop factor.
        </p>
        <p>
          Image brightness sums shutter, aperture and ISO; total light swaps ISO (gain,
          not light) for the sensor-area term. Micro 4/3 vs APS-C at identical settings
          is 2·log2(2.0/1.5) ≈ 0.83 stop of total light.
        </p>
      </Explainer>
    </div>
  </Card>
</div>

<style>
  .grid {
    display: grid;
    gap: var(--space-3);
    grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
  }

  .source td {
    background: var(--color-primary-soft);
  }

  .small {
    font-size: var(--font-size-sm);
  }

  .error {
    color: var(--color-danger);
    font-size: var(--font-size-sm);
  }

  .mono {
    font-family: var(--font-mono, ui-monospace, monospace);
  }

  .totals {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .line p {
    font-size: var(--font-size-lg);
    font-weight: 700;
  }

  .line p .muted {
    font-weight: 400;
  }
</style>
