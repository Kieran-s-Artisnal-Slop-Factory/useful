<script lang="ts">
  import { fuzzyScore } from '../../lib/fuzzy';
  import { citiesLoaded, searchCities, type CityHit } from '../../lib/time/cities';
  import { zoneDisplayName } from '../../lib/time/timezone';

  let {
    id,
    label,
    zones,
    value = $bindable(),
    onpick,
  }: {
    id: string;
    label: string;
    zones: string[];
    value: string;
    onpick?: (zone: string) => void;
  } = $props();

  let query = $state('');
  let open = $state(false);
  let selected = $state(0);
  let cityHits: CityHit[] = $state([]);
  let loadingCities = $state(false);

  const MAX_ZONES = 6;
  const MAX = 12;

  // Zone matches are synchronous — search both the raw IANA name and the
  // friendly display name, so "edmonton", "new salem" and "america/ed" hit.
  let zoneHits = $derived(
    query.trim().length === 0
      ? []
      : zones
          .map((zone) => {
            const score = Math.max(
              fuzzyScore(query, zone) ?? -1,
              fuzzyScore(query, zoneDisplayName(zone)) ?? -1
            );
            return { zone, score };
          })
          .filter((r) => r.score >= 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, MAX_ZONES)
  );

  // City matches come from the lazily-loaded GeoNames chunk (~34k cities);
  // "osaka" or "red deer" resolve to their zone even though no IANA zone
  // carries their name.
  $effect(() => {
    const q = query.trim();
    if (q.length < 2) {
      cityHits = [];
      return;
    }
    let stale = false;
    if (!citiesLoaded()) loadingCities = true;
    void searchCities(q, MAX - MAX_ZONES).then((hits) => {
      if (stale) return;
      cityHits = hits;
      loadingCities = false;
    });
    return () => {
      stale = true;
    };
  });

  interface Option {
    zone: string;
    label: string;
    sub: string;
  }

  let options: Option[] = $derived.by(() => {
    const opts: Option[] = zoneHits.map((z) => ({
      zone: z.zone,
      label: zoneDisplayName(z.zone),
      sub: z.zone,
    }));
    for (const c of cityHits) {
      opts.push({ zone: c.zone, label: `${c.name} (${c.country})`, sub: c.zone });
    }
    return opts.slice(0, MAX);
  });

  $effect(() => {
    if (selected >= options.length) selected = Math.max(0, options.length - 1);
  });

  function pick(zone: string) {
    value = zone;
    query = '';
    open = false;
    onpick?.(zone);
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.isComposing || e.keyCode === 229) return;
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      open = false;
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (options.length > 0) selected = (selected + 1) % options.length;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (options.length > 0) selected = (selected - 1 + options.length) % options.length;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = options[selected];
      if (hit) pick(hit.zone);
    }
  }
</script>

<div class="picker">
  <label for={id}>{label}</label>
  <p class="current" data-testid={id + '-current'}>{zoneDisplayName(value)}</p>
  <input
    {id}
    data-testid={id + '-search'}
    type="text"
    role="combobox"
    aria-expanded={open && options.length > 0}
    aria-controls={id + '-listbox'}
    aria-autocomplete="list"
    aria-activedescendant={open && options[selected] ? id + '-opt-' + selected : undefined}
    placeholder="Search zones…"
    autocomplete="off"
    spellcheck="false"
    bind:value={query}
    oninput={() => {
      open = true;
      selected = 0;
    }}
    onfocus={() => (open = query.trim().length > 0)}
    onblur={() => setTimeout(() => (open = false), 100)}
    {onkeydown}
  />
  {#if open && (options.length > 0 || loadingCities)}
    <ul id={id + '-listbox'} role="listbox" aria-label={label}>
      {#each options as option, i (option.label + option.zone)}
        <li
          id={id + '-opt-' + i}
          role="option"
          aria-selected={i === selected}
          class:selected={i === selected}
          data-testid={id + '-option'}
          onmouseenter={() => (selected = i)}
          onmousedown={(e) => {
            e.preventDefault();
            pick(option.zone);
          }}
        >
          {option.label}
          <span class="raw">{option.sub}</span>
        </li>
      {/each}
      {#if loadingCities}
        <li class="loading" role="option" aria-selected="false" aria-disabled="true">
          Loading city database…
        </li>
      {/if}
    </ul>
  {/if}
</div>

<style>
  .picker {
    position: relative;
    flex: 1;
    min-width: 14rem;
  }

  .current {
    font-weight: 700;
    margin-bottom: var(--space-2);
    overflow-wrap: anywhere;
  }

  ul {
    position: absolute;
    z-index: 10;
    inset-inline: 0;
    margin: var(--space-1) 0 0;
    padding: var(--space-1);
    list-style: none;
    background: var(--surface-raised-color);
    border: 1px solid var(--border-strong-color);
    box-shadow: var(--shadow-2);
    max-height: 16rem;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  li {
    display: flex;
    flex-direction: column;
    padding: var(--space-2) var(--space-3);
    cursor: pointer;
    font-size: var(--font-size-sm);
  }

  li.selected {
    background: var(--color-primary-soft);
    box-shadow: inset 2px 0 0 var(--color-stamp);
  }

  .raw {
    color: var(--text-muted-color);
    font-size: var(--font-size-eyebrow);
    letter-spacing: var(--tracking-wide);
  }

  .loading {
    color: var(--text-muted-color);
    cursor: default;
  }
</style>
