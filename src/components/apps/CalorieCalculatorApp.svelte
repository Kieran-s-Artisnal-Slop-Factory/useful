<script lang="ts">
  import { onMount } from 'svelte';
  import Card from '../Card.svelte';
  import Explainer from '../Explainer.svelte';
  import {
    ACTIVITIES,
    EQUATIONS,
    cmToFeetInches,
    feetInchesToCm,
    kgToLb,
    lbToKg,
    plan,
    rateStep,
    weightUnit,
    type ActivityId,
    type EquationId,
    type GoalDirection,
    type Sex,
    type UnitSystem,
  } from '../../lib/calc/calories';
  import { getSingleton, putSingleton } from '../../lib/db/repo';
  import type { Preferences } from '../../lib/db/types';

  /**
   * Stateless arithmetic with exactly ONE thing remembered: which unit system
   * to show. Body measurements are deliberately not persisted — they would
   * ride every backup export, and the form takes ten seconds to refill.
   */
  let units = $state<UnitSystem>('metric');
  let sex = $state<Sex>('male');
  /**
   * The numeric fields are typed `Field` rather than `string`, and that is not
   * laziness. `bind:value` on an `<input type="number">` hands back a NUMBER
   * once the user edits it, `undefined` when they clear it, and whatever seed
   * value was written in — so any single one of these is the wrong type. The
   * parser below is the one place that has to know.
   */
  type Field = string | number | undefined;
  let age = $state<Field>(30);
  let weight = $state<Field>(70);
  let heightCm = $state<Field>(175);
  let heightFt = $state<Field>(5);
  let heightIn = $state<Field>(9);
  let bodyFat = $state<Field>(undefined);
  let activity = $state<ActivityId>('moderate');
  let equation = $state<EquationId>('mifflin');
  let direction = $state<GoalDirection>('maintain');
  let rate = $state<Field>(0.5);
  let targetWeight = $state<Field>(undefined);

  const num = (value: Field | null): number | null => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const show = (n: number): string => String(Math.round(n * 100) / 100);

  /** Rewrite the displayed numbers so they describe the SAME body in the new
   * units. Split from `switchUnits` because restoring the preference on mount
   * must convert without writing anything back. */
  function convertTo(next: UnitSystem) {
    if (next === units) return;
    const toImperial = next === 'imperial';
    for (const field of ['weight', 'targetWeight', 'rate'] as const) {
      const current = field === 'weight' ? weight : field === 'targetWeight' ? targetWeight : rate;
      const value = num(current);
      if (value === null) continue;
      const converted = show(toImperial ? kgToLb(value) : lbToKg(value));
      if (field === 'weight') weight = converted;
      else if (field === 'targetWeight') targetWeight = converted;
      else rate = converted;
    }
    if (toImperial) {
      const cm = num(heightCm);
      if (cm !== null) {
        const { feet, inches } = cmToFeetInches(cm);
        heightFt = String(feet);
        heightIn = String(inches);
      }
    } else {
      const feet = num(heightFt) ?? 0;
      const inches = num(heightIn) ?? 0;
      heightCm = show(feetInchesToCm(feet, inches));
    }
    units = next;
  }

  /** Changing the toggle is an explicit pick — never a render effect. */
  function switchUnits(next: UnitSystem) {
    if (next === units) return;
    convertTo(next);
    void putSingleton<Partial<Preferences>>('preferences', { calorie_units: next });
  }

  onMount(async () => {
    // Restoring writes nothing; page load never touches the database.
    const prefs = await getSingleton<Preferences>('preferences');
    if (prefs?.calorie_units === 'imperial' || prefs?.calorie_units === 'metric') {
      convertTo(prefs.calorie_units);
    }
  });

  let unitLabel = $derived(weightUnit(units));

  let body = $derived.by(() => {
    const ageValue = num(age);
    const weightValue = num(weight);
    const height =
      units === 'metric'
        ? num(heightCm)
        : feetInchesToCm(num(heightFt) ?? 0, num(heightIn) ?? 0);
    if (ageValue === null || weightValue === null || height === null) return null;
    return {
      sex,
      age: ageValue,
      heightCm: height,
      weightKg: units === 'metric' ? weightValue : lbToKg(weightValue),
      bodyFatPct: num(bodyFat),
    };
  });

  let goal = $derived.by(() => {
    const rateValue = num(rate);
    const targetValue = num(targetWeight);
    const toKg = (v: number | null): number | null =>
      v === null ? null : units === 'metric' ? v : lbToKg(v);
    return {
      direction,
      rateKgPerWeek: toKg(rateValue) ?? 0,
      targetWeightKg: toKg(targetValue),
    };
  });

  let result = $derived(body ? plan(body, equation, activity, goal) : null);
  let ok = $derived(result?.ok === true ? result.plan : null);
  let problem = $derived(result?.ok === false ? result.reason : null);

  const kcal = (n: number): string => Math.round(n).toLocaleString('en-US');

  let equationNote = $derived(EQUATIONS.find((e) => e.id === equation)?.note ?? '');
</script>

<div class="page-header">
  <h1>Daily calories</h1>
</div>

<div class="stack">
  <Card title="You">
    {#snippet actions()}
      <div class="units" role="group" aria-label="Unit system">
        <button
          class="btn btn-sm"
          class:btn-primary={units === 'metric'}
          data-testid="cal-units-metric"
          aria-pressed={units === 'metric'}
          onclick={() => switchUnits('metric')}>Metric</button
        >
        <button
          class="btn btn-sm"
          class:btn-primary={units === 'imperial'}
          data-testid="cal-units-imperial"
          aria-pressed={units === 'imperial'}
          onclick={() => switchUnits('imperial')}>Imperial</button
        >
      </div>
    {/snippet}
    <div class="stack">
      <div class="grid">
        <fieldset class="sexes">
          <legend class="eyebrow">Sex</legend>
          {#each ['male', 'female'] as s (s)}
            <label class="check">
              <input type="radio" name="cal-sex" value={s} data-testid={'cal-sex-' + s} bind:group={sex} />
              {s}
            </label>
          {/each}
        </fieldset>

        <div>
          <label for="cal-age">Age (years)</label>
          <input id="cal-age" data-testid="cal-age" type="number" min="1" max="120" step="1" bind:value={age} />
        </div>

        {#if units === 'metric'}
          <div>
            <label for="cal-height">Height (cm)</label>
            <input id="cal-height" data-testid="cal-height" type="number" min="1" step="any" bind:value={heightCm} />
          </div>
        {:else}
          <div>
            <label for="cal-height-ft">Height</label>
            <div class="pair">
              <input id="cal-height-ft" data-testid="cal-height-ft" type="number" min="0" step="1" aria-label="Height, feet" bind:value={heightFt} />
              <span class="unit">ft</span>
              <input data-testid="cal-height-in" type="number" min="0" max="11" step="1" aria-label="Height, inches" bind:value={heightIn} />
              <span class="unit">in</span>
            </div>
          </div>
        {/if}

        <div>
          <label for="cal-weight">Weight ({unitLabel})</label>
          <input id="cal-weight" data-testid="cal-weight" type="number" min="1" step="any" bind:value={weight} />
        </div>

        <div>
          <label for="cal-bodyfat">Body fat % <span class="muted">(optional)</span></label>
          <input
            id="cal-bodyfat"
            data-testid="cal-bodyfat"
            type="number"
            min="0"
            max="75"
            step="any"
            placeholder="—"
            bind:value={bodyFat}
          />
        </div>
      </div>
    </div>
  </Card>

  <Card title="Activity and method">
    <div class="stack">
      <div class="grid">
        <div>
          <label for="cal-activity">Activity level</label>
          <select id="cal-activity" data-testid="cal-activity" bind:value={activity}>
            {#each ACTIVITIES as a (a.id)}
              <option value={a.id}>{a.label} — {a.note}</option>
            {/each}
          </select>
        </div>
        <div>
          <label for="cal-equation">Equation</label>
          <select id="cal-equation" data-testid="cal-equation" bind:value={equation}>
            {#each EQUATIONS as e (e.id)}
              <option value={e.id}>{e.label}</option>
            {/each}
          </select>
        </div>
      </div>
      <p class="muted small" data-testid="cal-equation-note">{equationNote}</p>
    </div>
  </Card>

  <Card title="Goal">
    <div class="stack">
      <fieldset class="goals">
        <legend class="eyebrow">Direction</legend>
        {#each [['maintain', 'Maintain'], ['lose', 'Lose weight'], ['gain', 'Gain weight']] as [id, label] (id)}
          <label class="check">
            <input type="radio" name="cal-goal" value={id} data-testid={'cal-goal-' + id} bind:group={direction} />
            {label}
          </label>
        {/each}
      </fieldset>

      {#if direction !== 'maintain'}
        <div class="grid">
          <div>
            <label for="cal-rate">Rate ({unitLabel} per week)</label>
            <input
              id="cal-rate"
              data-testid="cal-rate"
              type="number"
              min="0"
              step={rateStep(units)}
              bind:value={rate}
            />
          </div>
          <div>
            <label for="cal-target">Target weight ({unitLabel}) <span class="muted">(optional)</span></label>
            <input id="cal-target" data-testid="cal-target" type="number" min="0" step="any" placeholder="—" bind:value={targetWeight} />
          </div>
        </div>
      {/if}
    </div>
  </Card>

  {#if problem}
    <Card title="Not enough to work with">
      <p class="error" data-testid="cal-problem" role="alert">{problem}</p>
    </Card>
  {:else if ok}
    <Card title="Estimate">
      <div class="stack">
        <div class="figures">
          <div class="line">
            <span class="eyebrow">Resting (BMR)</span>
            <p data-testid="cal-bmr">{kcal(ok.bmr)} kcal/day</p>
          </div>
          <div class="line">
            <span class="eyebrow">Maintenance (TDEE)</span>
            <p data-testid="cal-tdee">{kcal(ok.tdee)} kcal/day</p>
          </div>
          <div class="line">
            <span class="eyebrow-stamp eyebrow">Daily target</span>
            <p class="big" data-testid="cal-target-kcal">{kcal(ok.target)}</p>
            <p class="muted small">kcal per day</p>
          </div>
        </div>

        {#if ok.weeksToGoal !== null}
          <p class="muted small" data-testid="cal-weeks">
            At this rate, about {ok.weeksToGoal < 1 ? 'under a week' : `${Math.round(ok.weeksToGoal * 10) / 10} weeks`} to your target weight.
          </p>
        {/if}

        {#if ok.warnings.length > 0}
          <div class="warnings" role="status">
            {#each ok.warnings as w (w.id)}
              <p class="warn" data-testid="cal-warning" data-warning={w.id}>⚠ {w.message}</p>
            {/each}
          </div>
        {/if}

        <div class="table-wrap">
          <table class="data-table" data-testid="cal-steps">
            <thead>
              <tr><th>Step</th><th>Working</th><th>Result</th></tr>
            </thead>
            <tbody>
              {#each ok.steps as step, i (step.label + i)}
                <tr>
                  <td>{step.label}</td>
                  <td class="mono detail">{step.detail}</td>
                  <td class="mono">{step.value}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>

        <p class="muted small">
          An estimate from population equations, not a prescription. Two people with
          identical inputs genuinely differ by a few hundred kcal a day — treat this as
          a starting point, weigh yourself over a fortnight, and adjust from what
          actually happens.
        </p>
      </div>
    </Card>
  {/if}

  <Explainer summary="Which equation, and where the numbers come from" testid="explainer-calories">
    <p>
      All three estimate your RESTING rate — what you would burn lying still all day.
      Mifflin–St Jeor is the default because a 2005 comparison of the common equations
      found it the closest for people of typical body composition. Harris–Benedict
      (in its 1984 revision) reads a little higher and is here because so many other
      calculators use it. Katch–McArdle ignores your sex, height and age entirely and
      works from lean mass, which makes it the best of the three when you have a real
      body-fat measurement and the worst when you are guessing one.
    </p>
    <p>
      The activity multiplier turns resting into maintenance, and it is the single
      biggest source of error here — most people place themselves a level too high.
      If the numbers do not match what the scale does over a couple of weeks, that
      multiplier is the first thing to move.
    </p>
    <p>
      Goal pacing uses 7 700 kcal per kilogram of body mass, the metric statement of
      the old 3 500-per-pound rule. It ignores the way metabolism adapts to a sustained
      deficit, so long plans drift optimistic — the further out the target, the more
      the estimate is a direction rather than a date.
    </p>
  </Explainer>
</div>

<style>
  .grid {
    display: grid;
    gap: var(--space-3);
    grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
    align-items: end;
  }

  .units {
    display: flex;
    gap: var(--space-2);
  }

  fieldset.sexes,
  fieldset.goals {
    border: 1px dashed var(--border-color);
    padding: var(--space-2) var(--space-3);
    display: flex;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .check {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--text-color);
    font-size: var(--font-size-base);
    /* The label text is already written the way it should read; the app's
       global label styling would otherwise upper-case it. */
    text-transform: none;
    letter-spacing: normal;
    margin-bottom: 0;
    white-space: nowrap;
  }

  /* Only the sex options are authored lowercase, to match their values. */
  fieldset.sexes .check {
    text-transform: capitalize;
  }

  .pair {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }

  .pair input {
    flex: 1 1 4rem;
    min-width: 0;
  }

  .unit {
    font-size: var(--font-size-sm);
    color: var(--text-muted-color);
  }

  .figures {
    display: flex;
    gap: var(--space-5, 2rem);
    flex-wrap: wrap;
    align-items: flex-end;
  }

  .big {
    font-size: var(--font-size-2xl);
    font-weight: 700;
  }

  .small {
    font-size: var(--font-size-sm);
  }

  .mono {
    font-family: var(--font-mono, ui-monospace, monospace);
  }

  .detail {
    font-size: var(--font-size-sm);
    overflow-wrap: anywhere;
  }

  .warnings {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .warn {
    color: var(--color-warning);
    font-size: var(--font-size-sm);
  }

  .error {
    color: var(--color-danger);
    font-size: var(--font-size-sm);
  }
</style>
