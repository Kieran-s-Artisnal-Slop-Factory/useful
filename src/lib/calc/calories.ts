/**
 * Daily calorie planning (0.5.0 plan Phase 2, decision 9) — pure arithmetic
 * over three published resting-metabolic-rate equations, an activity
 * multiplier, and a goal expressed as a rate of weight change.
 *
 * What this is: population equations. They were fitted to groups, and an
 * individual sits somewhere in a distribution around them — two people with
 * identical inputs genuinely differ by a few hundred kcal a day. The tool
 * therefore shows its working, names which equation it used, and warns rather
 * than blocks. Nothing here is a prescription, and the UI says so where the
 * number appears rather than burying it in a footnote.
 *
 * Everything internal is metric: kilograms, centimetres, kilocalories. The
 * unit conversions at the bottom exist so the UI can speak imperial at its
 * edge without a second set of formulas drifting from this one.
 */

export type Sex = 'male' | 'female';
export type EquationId = 'mifflin' | 'harris-benedict' | 'katch-mcardle';
export type ActivityId = 'sedentary' | 'light' | 'moderate' | 'very-active' | 'extra-active';
export type GoalDirection = 'maintain' | 'lose' | 'gain';
export type UnitSystem = 'metric' | 'imperial';

/** Energy in a kilogram of body mass:
 * the conventional metric round figure, and a near neighbour of the old
 * 3,500 kcal-per-pound rule — which actually converts to 7,716, not to this.
 * It is an approximation either way, and it ignores how the body adapts to a
 * sustained deficit over months, which is the real reason long plans drift
 * optimistic. The 0.2% between the two figures is nothing beside that. */
export const KCAL_PER_KG = 7700;

export const LB_PER_KG = 2.2046226218487757;
export const CM_PER_INCH = 2.54;

export interface EquationDef {
  id: EquationId;
  label: string;
  /** One sentence: what it assumes, and when to pick it. */
  note: string;
  /** True when it cannot run without a body-fat percentage. */
  needsBodyFat: boolean;
}

export const EQUATIONS: EquationDef[] = [
  {
    id: 'mifflin',
    label: 'Mifflin–St Jeor',
    note: 'The default, and the one dietetics guidance has preferred since a 2005 comparison found it the most accurate for people of typical body composition.',
    needsBodyFat: false,
  },
  {
    id: 'harris-benedict',
    label: 'Harris–Benedict (revised)',
    note: 'The 1984 Roza–Shizgal revision of the 1919 original. Tends to read a little higher than Mifflin–St Jeor; kept because a lot of other calculators use it and comparing is useful.',
    needsBodyFat: false,
  },
  {
    id: 'katch-mcardle',
    label: 'Katch–McArdle',
    note: 'Works from lean mass rather than total weight, so it needs a body-fat percentage — and beats the other two when you have a real measurement and are notably lean or heavy.',
    needsBodyFat: true,
  },
];

export interface ActivityDef {
  id: ActivityId;
  label: string;
  multiplier: number;
  note: string;
}

export const ACTIVITIES: ActivityDef[] = [
  { id: 'sedentary', label: 'Sedentary', multiplier: 1.2, note: 'Desk job, little or no exercise' },
  { id: 'light', label: 'Lightly active', multiplier: 1.375, note: 'Light exercise 1–3 days a week' },
  { id: 'moderate', label: 'Moderately active', multiplier: 1.55, note: 'Moderate exercise 3–5 days a week' },
  { id: 'very-active', label: 'Very active', multiplier: 1.725, note: 'Hard exercise 6–7 days a week' },
  { id: 'extra-active', label: 'Extra active', multiplier: 1.9, note: 'Hard exercise daily plus a physical job' },
];

export const equationById = (id: string): EquationDef | undefined =>
  EQUATIONS.find((e) => e.id === id);

export const activityById = (id: string): ActivityDef | undefined =>
  ACTIVITIES.find((a) => a.id === id);

/**
 * The commonly cited lower bounds for an unsupervised diet. They are rules of
 * thumb from clinical guidance, not laws of physics — which is exactly why
 * crossing one produces a sentence and not a locked button.
 */
export const INTAKE_FLOOR: Record<Sex, number> = { male: 1500, female: 1200 };

export interface BodyInput {
  sex: Sex;
  /** Years. */
  age: number;
  heightCm: number;
  weightKg: number;
  /** 0–100, or null when not measured. Only Katch–McArdle needs it. */
  bodyFatPct: number | null;
}

export interface GoalInput {
  direction: GoalDirection;
  /** Kilograms per week. Ignored when direction is 'maintain'. */
  rateKgPerWeek: number;
  /** Kilograms, for the weeks-to-goal estimate. Null to skip it. */
  targetWeightKg: number | null;
}

/** One line of shown working: what was computed, from what, to what. */
export interface Step {
  label: string;
  /** The formula with the user's values already in it. */
  detail: string;
  value: string;
}

export interface Warning {
  id:
    | 'below-bmr'
    | 'below-floor'
    | 'aggressive-rate'
    | 'fast-gain'
    | 'body-fat-ignored'
    | 'extreme-input'
    | 'wrong-direction'
    | 'impossible-rate';
  message: string;
}

export interface CaloriePlan {
  equation: EquationDef;
  activity: ActivityDef;
  /** Resting metabolic rate, kcal/day. */
  bmr: number;
  /** Maintenance, kcal/day. */
  tdee: number;
  /** What to eat, kcal/day. */
  target: number;
  /** Signed: negative for a deficit, positive for a surplus. */
  dailyDelta: number;
  /** Null when maintaining or no target weight was given. */
  weeksToGoal: number | null;
  steps: Step[];
  warnings: Warning[];
}

export type PlanResult = { ok: true; plan: CaloriePlan } | { ok: false; reason: string };

const num = (n: number, digits = 0): string =>
  n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/**
 * A signed term for a formula that is READ: a real minus sign rather than a
 * hyphen, and a space after it, so "− 5 × 30 + 5" scans as arithmetic instead
 * of running the sign into the number.
 */
const signed = (n: number): string => (n < 0 ? `− ${num(Math.abs(n))}` : `+ ${num(n)}`);

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/* -------------------------------------------------------------- the BMR --- */

export type BmrResult = { ok: true; value: number; step: Step } | { ok: false; reason: string };

/**
 * Resting metabolic rate by the chosen equation, with the substituted formula
 * as a step. A missing body-fat percentage under Katch–McArdle is refused with
 * words rather than silently falling back to another equation — a number
 * produced by a formula you did not choose is worse than no number.
 */
export function bmr(body: BodyInput, equation: EquationId): BmrResult {
  const { sex, age, heightCm, weightKg, bodyFatPct } = body;
  if (!finite(age) || !finite(heightCm) || !finite(weightKg)) {
    return { ok: false, reason: 'Fill in age, height and weight.' };
  }
  if (age <= 0 || heightCm <= 0 || weightKg <= 0) {
    return { ok: false, reason: 'Age, height and weight all have to be greater than zero.' };
  }

  if (equation === 'katch-mcardle') {
    if (!finite(bodyFatPct)) {
      return {
        ok: false,
        reason: 'Katch–McArdle works from lean mass, so it needs a body-fat percentage. Enter one, or pick another equation.',
      };
    }
    if (bodyFatPct < 0 || bodyFatPct >= 100) {
      return { ok: false, reason: 'Body fat has to be between 0 and 100 percent.' };
    }
    const lean = weightKg * (1 - bodyFatPct / 100);
    const value = 370 + 21.6 * lean;
    return {
      ok: true,
      value,
      step: {
        label: 'Resting energy (Katch–McArdle)',
        detail: `370 + 21.6 × ${num(lean, 1)} kg lean mass  (${num(weightKg, 1)} kg × ${num(100 - bodyFatPct, 1)}% lean)`,
        value: `${num(value)} kcal/day`,
      },
    };
  }

  if (equation === 'harris-benedict') {
    const value =
      sex === 'male'
        ? 88.362 + 13.397 * weightKg + 4.799 * heightCm - 5.677 * age
        : 447.593 + 9.247 * weightKg + 3.098 * heightCm - 4.33 * age;
    const c = sex === 'male' ? ['88.362', '13.397', '4.799', '5.677'] : ['447.593', '9.247', '3.098', '4.330'];
    return {
      ok: true,
      value,
      step: {
        label: 'Resting energy (Harris–Benedict, revised)',
        detail: `${c[0]} + ${c[1]} × ${num(weightKg, 1)} kg + ${c[2]} × ${num(heightCm, 1)} cm − ${c[3]} × ${num(age)}`,
        value: `${num(value)} kcal/day`,
      },
    };
  }

  const offset = sex === 'male' ? 5 : -161;
  const value = 10 * weightKg + 6.25 * heightCm - 5 * age + offset;
  return {
    ok: true,
    value,
    step: {
      label: 'Resting energy (Mifflin–St Jeor)',
      detail: `10 × ${num(weightKg, 1)} kg + 6.25 × ${num(heightCm, 1)} cm − 5 × ${num(age)} ${signed(offset)}`,
      value: `${num(value)} kcal/day`,
    },
  };
}

/* ------------------------------------------------------------- the plan --- */

/**
 * The whole calculation: resting rate, maintenance, and what to eat to move
 * at the requested rate — plus every caution the numbers earn.
 */
export function plan(body: BodyInput, equation: EquationId, activity: ActivityId, goal: GoalInput): PlanResult {
  const equationDef = equationById(equation);
  const activityDef = activityById(activity);
  if (!equationDef) return { ok: false, reason: `Unknown equation "${equation}".` };
  if (!activityDef) return { ok: false, reason: `Unknown activity level "${activity}".` };

  const resting = bmr(body, equation);
  if (!resting.ok) return { ok: false, reason: resting.reason };
  // Number.isFinite() passes MAX_VALUE, but ten times MAX_VALUE is Infinity —
  // so a finite input can still produce a resting rate that is not, and an
  // "∞ kcal/day" plan returned as a success is worse than a refusal.
  if (!finite(resting.value)) {
    return { ok: false, reason: 'Those numbers are too large to compute with. Check the weight and height.' };
  }

  const warnings: Warning[] = [];
  const steps: Step[] = [resting.step];

  const tdee = resting.value * activityDef.multiplier;
  steps.push({
    label: `Maintenance (${activityDef.label.toLowerCase()})`,
    detail: `${num(resting.value)} kcal/day × ${activityDef.multiplier}`,
    value: `${num(tdee)} kcal/day`,
  });

  const rate = goal.direction === 'maintain' ? 0 : Math.abs(goal.rateKgPerWeek);
  if (goal.direction !== 'maintain' && (!finite(goal.rateKgPerWeek) || rate <= 0)) {
    return { ok: false, reason: 'Set a rate of change greater than zero, or choose "maintain".' };
  }

  const magnitude = (rate * KCAL_PER_KG) / 7;
  const dailyDelta = goal.direction === 'lose' ? -magnitude : goal.direction === 'gain' ? magnitude : 0;
  const raw = tdee + dailyDelta;
  // A deficit larger than everything the body burns is arithmetically a
  // negative intake. The policy here is warn-don't-block, but "eat −298 kcal"
  // is not a plan a person can act on, so the headline is floored at zero and
  // the impossibility is stated instead of printed as a number.
  const target = Math.max(0, raw);
  if (raw < 0) {
    warnings.push({
      id: 'impossible-rate',
      message: `Losing ${num(rate, 2)} kg a week would need a bigger deficit than your whole daily burn — there is no intake that does it. The target below is floored at zero because the arithmetic ran out, not because it is a diet.`,
    });
  }

  if (goal.direction !== 'maintain') {
    steps.push({
      label: goal.direction === 'lose' ? 'Daily deficit' : 'Daily surplus',
      detail: `${num(rate, 2)} kg/week × ${num(KCAL_PER_KG)} kcal/kg ÷ 7 days`,
      value: `${signed(dailyDelta)} kcal/day`,
    });
  }

  steps.push({
    label: 'Daily target',
    detail:
      goal.direction === 'maintain'
        ? `${num(tdee)} kcal/day maintenance, unchanged`
        : `${num(tdee)} kcal/day ${signed(dailyDelta)} kcal/day`,
    value: `${num(target)} kcal/day`,
  });

  let weeksToGoal: number | null = null;
  if (goal.direction !== 'maintain' && finite(goal.targetWeightKg) && goal.targetWeightKg > 0) {
    // The gap has to point the way the plan is moving. Taking its absolute
    // value gave a losing plan aimed at a HEAVIER target a confident arrival
    // date, for a weight it walks away from a little further every day.
    const gap = goal.targetWeightKg - body.weightKg;
    const agrees = goal.direction === 'lose' ? gap < 0 : gap > 0;
    if (agrees) {
      weeksToGoal = Math.abs(gap) / rate;
      steps.push({
        label: 'Time to target weight',
        detail: `${num(Math.abs(gap), 1)} kg to go ÷ ${num(rate, 2)} kg/week`,
        value: weeksToGoal < 1 ? 'under a week' : `${num(weeksToGoal, 1)} weeks`,
      });
    } else {
      warnings.push({
        id: 'wrong-direction',
        message: `That target weight is ${goal.direction === 'lose' ? 'above' : 'below'} where you are now, but the plan is set to ${goal.direction === 'lose' ? 'lose' : 'gain'}. Nothing here reaches it — switch the direction, or change the target.`,
      });
    }
  }

  /* ------------------------------------------------------------ cautions -- */

  if (goal.direction === 'lose') {
    if (target < resting.value) {
      warnings.push({
        id: 'below-bmr',
        message: `That target (${num(target)} kcal) is below your resting energy of ${num(resting.value)} kcal — what your body uses doing nothing at all. Sustained, that is a medically supervised diet, not a plan to run alone.`,
      });
    }
    const floor = INTAKE_FLOOR[body.sex];
    if (target < floor) {
      warnings.push({
        id: 'below-floor',
        message: `${num(target)} kcal is under the ${num(floor)} kcal a day usually given as the lower bound for an unsupervised diet. Slow the rate down, or take the deficit from activity instead of food.`,
      });
    }
    if (rate > body.weightKg * 0.01) {
      warnings.push({
        id: 'aggressive-rate',
        message: `Losing ${num(rate, 2)} kg a week is over 1% of your body weight. Past that, more of what goes is muscle rather than fat.`,
      });
    }
  }

  if (goal.direction === 'gain' && rate > 0.5) {
    warnings.push({
      id: 'fast-gain',
      message: `Gaining faster than about 0.5 kg a week tends to add fat rather than muscle, whatever the training looks like.`,
    });
  }

  if (equation !== 'katch-mcardle' && finite(body.bodyFatPct)) {
    warnings.push({
      id: 'body-fat-ignored',
      message: `${equationDef.label} works from total weight, so the body-fat percentage you entered is not used. Katch–McArdle is the one that reads it.`,
    });
  }

  // Two-sided on purpose. All three equations were fitted on adults, so a
  // toddler is every bit as much an extrapolation as a 130-year-old — and the
  // one-sided version of this guard let a 1-year-old through with no caution
  // at all while promising in its own wording to cover the range.
  if (
    body.age < 15 ||
    body.age > 120 ||
    body.heightCm < 120 ||
    body.heightCm > 260 ||
    body.weightKg < 30 ||
    body.weightKg > 400
  ) {
    warnings.push({
      id: 'extreme-input',
      message: 'One of those inputs is outside the range these equations were fitted on — they were all built from adults — so the answer is extrapolation rather than estimate.',
    });
  }

  return {
    ok: true,
    plan: {
      equation: equationDef,
      activity: activityDef,
      bmr: resting.value,
      tdee,
      target,
      dailyDelta,
      weeksToGoal,
      steps,
      warnings,
    },
  };
}

/* -------------------------------------------------------------- units ----- */

export const kgToLb = (kg: number): number => kg * LB_PER_KG;
export const lbToKg = (lb: number): number => lb / LB_PER_KG;
export const cmToInches = (cm: number): number => cm / CM_PER_INCH;
export const inchesToCm = (inches: number): number => inches * CM_PER_INCH;

/** 175 cm → 5 ft 9 in. Inches are rounded, and 12 rolls into the next foot. */
export function cmToFeetInches(cm: number): { feet: number; inches: number } {
  const totalInches = Math.round(cmToInches(cm));
  return { feet: Math.floor(totalInches / 12), inches: totalInches % 12 };
}

export const feetInchesToCm = (feet: number, inches: number): number =>
  inchesToCm(feet * 12 + inches);

/** Weight in whatever unit the UI is showing. */
export const weightIn = (kg: number, units: UnitSystem): number =>
  units === 'metric' ? kg : kgToLb(kg);

export const weightToKg = (value: number, units: UnitSystem): number =>
  units === 'metric' ? value : lbToKg(value);

export const weightUnit = (units: UnitSystem): string => (units === 'metric' ? 'kg' : 'lb');

/** The rate step the UI offers: 0.05 kg or 0.1 lb, both fine-grained enough
 * to matter and coarse enough to drag. */
export const rateStep = (units: UnitSystem): number => (units === 'metric' ? 0.05 : 0.1);
