import { describe, expect, it } from 'vitest';
import {
  ACTIVITIES,
  activityById,
  bmr,
  CM_PER_INCH,
  cmToFeetInches,
  cmToInches,
  EQUATIONS,
  equationById,
  feetInchesToCm,
  inchesToCm,
  INTAKE_FLOOR,
  KCAL_PER_KG,
  kgToLb,
  LB_PER_KG,
  lbToKg,
  plan,
  rateStep,
  weightIn,
  weightToKg,
  weightUnit,
} from './calories';
import type {
  ActivityId,
  BmrResult,
  BodyInput,
  CaloriePlan,
  EquationId,
  GoalInput,
  PlanResult,
  Warning,
} from './calories';

/* ----------------------------------------------------------- fixtures ---- */

const male: BodyInput = { sex: 'male', age: 30, heightCm: 175, weightKg: 70, bodyFatPct: null };
const female: BodyInput = { ...male, sex: 'female' };

const maintain: GoalInput = { direction: 'maintain', rateKgPerWeek: 0, targetWeightKg: null };
const lose = (rateKgPerWeek: number, targetWeightKg: number | null = null): GoalInput => ({
  direction: 'lose',
  rateKgPerWeek,
  targetWeightKg,
});
const gain = (rateKgPerWeek: number, targetWeightKg: number | null = null): GoalInput => ({
  direction: 'gain',
  rateKgPerWeek,
  targetWeightKg,
});

const value = (result: BmrResult): number => {
  if (!result.ok) throw new Error(`expected a BMR, got a refusal: ${result.reason}`);
  return result.value;
};

const stepOf = (result: BmrResult) => {
  if (!result.ok) throw new Error(`expected a BMR, got a refusal: ${result.reason}`);
  return result.step;
};

const reason = (result: BmrResult | PlanResult): string => {
  if (result.ok) throw new Error('expected a refusal, got a result');
  return result.reason;
};

const run = (
  body: BodyInput,
  equation: EquationId,
  activity: ActivityId,
  goal: GoalInput,
): CaloriePlan => {
  const result = plan(body, equation, activity, goal);
  if (!result.ok) throw new Error(`expected a plan, got a refusal: ${result.reason}`);
  return result.plan;
};

const ids = (p: CaloriePlan): Warning['id'][] => p.warnings.map((w) => w.id);

const TOO_SMALL = 'Age, height and weight all have to be greater than zero.';
const MISSING = 'Fill in age, height and weight.';
const BAD_RATE = 'Set a rate of change greater than zero, or choose "maintain".';
const BAD_BODY_FAT = 'Body fat has to be between 0 and 100 percent.';

/* ---------------------------------------------------------- the tables --- */

describe('lookup tables', () => {
  it('offers three equations and names only Katch–McArdle as needing a body-fat percentage', () => {
    expect(EQUATIONS.map((e) => e.id)).toEqual(['mifflin', 'harris-benedict', 'katch-mcardle']);
    expect(EQUATIONS.filter((e) => e.needsBodyFat).map((e) => e.id)).toEqual(['katch-mcardle']);
  });

  it('carries the five standard activity multipliers, the metric energy constant and both floors', () => {
    expect(ACTIVITIES.map((a) => a.multiplier)).toEqual([1.2, 1.375, 1.55, 1.725, 1.9]);
    expect(KCAL_PER_KG).toBe(7700);
    expect(INTAKE_FLOOR.male).toBe(1500);
    expect(INTAKE_FLOOR.female).toBe(1200);
  });

  it('looks an equation or activity up by id and returns undefined for anything else', () => {
    expect(equationById('mifflin')!.label).toBe('Mifflin–St Jeor');
    expect(activityById('moderate')!.multiplier).toBe(1.55);
    expect(equationById('nope')).toBeUndefined();
    expect(activityById('nope')).toBeUndefined();
  });
});

/* ------------------------------------------------------------- bmr() ----- */

describe('bmr — Mifflin–St Jeor', () => {
  it('is 10·kg + 6.25·cm − 5·age + 5 for a male: 70/175/30 is 1648.75 and 90/185/40 is 1861.25', () => {
    expect(value(bmr(male, 'mifflin'))).toBeCloseTo(1648.75, 2);
    expect(value(bmr({ ...male, age: 40, heightCm: 185, weightKg: 90 }, 'mifflin'))).toBeCloseTo(1861.25, 2);
  });

  it('is 10·kg + 6.25·cm − 5·age − 161 for a female: 70/175/30 is 1482.75 and 60/165/45 is 1245.25', () => {
    expect(value(bmr(female, 'mifflin'))).toBeCloseTo(1482.75, 2);
    expect(value(bmr({ ...female, age: 45, heightCm: 165, weightKg: 60 }, 'mifflin'))).toBeCloseTo(1245.25, 2);
  });

  it('separates the sexes by exactly the 166 kcal between the +5 and −161 offsets', () => {
    expect(value(bmr(male, 'mifflin')) - value(bmr(female, 'mifflin'))).toBeCloseTo(166, 2);
  });

  it('ignores a body-fat percentage, because this equation works from total weight', () => {
    expect(value(bmr({ ...male, bodyFatPct: 20 }, 'mifflin'))).toBeCloseTo(1648.75, 2);
  });

  it('shows the substituted formula with each sex\'s offset, not the abstract one', () => {
    const m = stepOf(bmr(male, 'mifflin'));
    expect(m.label).toContain('Mifflin');
    expect(m.detail).toContain('70.0 kg');
    expect(m.detail).toContain('175.0 cm');
    expect(m.detail).toMatch(/\+\s?5$/);
    expect(m.value).toBe('1,649 kcal/day');
    expect(stepOf(bmr(female, 'mifflin')).detail).toMatch(/−\s?161$/);
  });
});

describe('bmr — Harris–Benedict (revised)', () => {
  it('is 88.362 + 13.397·kg + 4.799·cm − 5.677·age for a male: 1695.667, and 1954.827 at 90/185/40', () => {
    expect(value(bmr(male, 'harris-benedict'))).toBeCloseTo(1695.667, 2);
    expect(value(bmr({ ...male, age: 40, heightCm: 185, weightKg: 90 }, 'harris-benedict'))).toBeCloseTo(1954.827, 2);
  });

  it('is 447.593 + 9.247·kg + 3.098·cm − 4.330·age for a female: 1507.133', () => {
    expect(value(bmr(female, 'harris-benedict'))).toBeCloseTo(1507.133, 2);
  });

  it('reads higher than Mifflin–St Jeor for this body, as its note claims', () => {
    expect(value(bmr(male, 'harris-benedict'))).toBeGreaterThan(value(bmr(male, 'mifflin')));
  });

  it('shows the sex-specific coefficients in the substituted formula', () => {
    const m = stepOf(bmr(male, 'harris-benedict'));
    expect(m.label).toContain('Harris');
    expect(m.detail).toContain('88.362');
    expect(m.detail).toContain('13.397');
    expect(m.detail).toContain('70.0 kg');
    expect(stepOf(bmr(female, 'harris-benedict')).detail).toContain('447.593');
    expect(stepOf(bmr(female, 'harris-benedict')).detail).toContain('4.330');
  });
});

describe('bmr — Katch–McArdle', () => {
  it('is 370 + 21.6·lean, lean being kg × (1 − bodyFat/100), across the valid range', () => {
    expect(value(bmr({ ...male, bodyFatPct: 0 }, 'katch-mcardle'))).toBeCloseTo(1882, 2);
    expect(value(bmr({ ...male, bodyFatPct: 10 }, 'katch-mcardle'))).toBeCloseTo(1730.8, 2);
    expect(value(bmr({ ...male, bodyFatPct: 20 }, 'katch-mcardle'))).toBeCloseTo(1579.6, 2);
    expect(value(bmr({ ...male, bodyFatPct: 35 }, 'katch-mcardle'))).toBeCloseTo(1352.8, 2);
    expect(value(bmr({ ...male, bodyFatPct: 99.9 }, 'katch-mcardle'))).toBeCloseTo(371.512, 2);
  });

  it('ignores sex, age and height, because lean mass is the only input it reads', () => {
    const a = bmr({ sex: 'male', age: 30, heightCm: 175, weightKg: 70, bodyFatPct: 20 }, 'katch-mcardle');
    const b = bmr({ sex: 'female', age: 70, heightCm: 150, weightKg: 70, bodyFatPct: 20 }, 'katch-mcardle');
    expect(value(a)).toBe(value(b));
  });

  it('shows the lean mass it derived alongside the weight it came from', () => {
    const step = stepOf(bmr({ ...male, bodyFatPct: 20 }, 'katch-mcardle'));
    expect(step.label).toContain('Katch');
    expect(step.detail).toContain('56.0 kg lean mass');
    expect(step.detail).toContain('70.0 kg');
    expect(step.detail).toContain('80.0%');
    expect(step.value).toBe('1,580 kcal/day');
  });

  it('refuses without a body-fat percentage rather than silently using another equation', () => {
    expect(reason(bmr({ ...male, bodyFatPct: null }, 'katch-mcardle')).toLowerCase()).toContain('body-fat');
    expect(reason(bmr({ ...male, bodyFatPct: Number.NaN }, 'katch-mcardle')).toLowerCase()).toContain('body-fat');
  });

  it('refuses a body-fat percentage below 0 or at/above 100, which would break lean mass', () => {
    expect(reason(bmr({ ...male, bodyFatPct: -1 }, 'katch-mcardle'))).toBe(BAD_BODY_FAT);
    expect(reason(bmr({ ...male, bodyFatPct: 100 }, 'katch-mcardle'))).toBe(BAD_BODY_FAT);
    expect(reason(bmr({ ...male, bodyFatPct: 150 }, 'katch-mcardle'))).toBe(BAD_BODY_FAT);
  });

});

describe('bmr — input validation', () => {
  it('refuses a non-finite age, height or weight by asking for the missing field', () => {
    expect(reason(bmr({ ...male, age: Number.NaN }, 'mifflin'))).toBe(MISSING);
    expect(reason(bmr({ ...male, heightCm: Number.NaN }, 'mifflin'))).toBe(MISSING);
    expect(reason(bmr({ ...male, weightKg: Number.NaN }, 'mifflin'))).toBe(MISSING);
    expect(reason(bmr({ ...male, weightKg: Number.POSITIVE_INFINITY }, 'mifflin'))).toBe(MISSING);
    expect(reason(bmr({ ...male, heightCm: Number.NEGATIVE_INFINITY }, 'mifflin'))).toBe(MISSING);
  });

  it('refuses zero or negative age, height or weight', () => {
    expect(reason(bmr({ ...male, age: 0 }, 'mifflin'))).toBe(TOO_SMALL);
    expect(reason(bmr({ ...male, heightCm: 0 }, 'mifflin'))).toBe(TOO_SMALL);
    expect(reason(bmr({ ...male, weightKg: 0 }, 'mifflin'))).toBe(TOO_SMALL);
    expect(reason(bmr({ ...male, age: -1 }, 'mifflin'))).toBe(TOO_SMALL);
    expect(reason(bmr({ ...male, heightCm: -175 }, 'mifflin'))).toBe(TOO_SMALL);
    expect(reason(bmr({ ...male, weightKg: -70 }, 'mifflin'))).toBe(TOO_SMALL);
  });

  it('validates the body under every equation, and before the body-fat check', () => {
    expect(reason(bmr({ ...male, age: 0 }, 'harris-benedict'))).toBe(TOO_SMALL);
    expect(reason(bmr({ ...male, weightKg: 0, bodyFatPct: null }, 'katch-mcardle'))).toBe(TOO_SMALL);
  });
});

/* ------------------------------------------------- plan(): tdee, target -- */

describe('plan — maintenance', () => {
  it('multiplies the resting rate by the chosen activity multiplier', () => {
    const p = run(male, 'mifflin', 'sedentary', maintain);
    expect(p.bmr).toBeCloseTo(1648.75, 2);
    expect(p.tdee).toBeCloseTo(1978.5, 2); // 1648.75 × 1.2
    expect(p.tdee).toBeCloseTo(p.bmr * p.activity.multiplier, 2);
    expect(run(male, 'mifflin', 'moderate', maintain).tdee).toBeCloseTo(2555.5625, 2); // × 1.55
    expect(run(male, 'mifflin', 'extra-active', maintain).tdee).toBeCloseTo(3132.625, 2); // × 1.9
  });

  it('carries the chosen equation and activity definitions back for the UI to name', () => {
    const p = run({ ...male, bodyFatPct: 20 }, 'katch-mcardle', 'light', maintain);
    expect(p.equation.id).toBe('katch-mcardle');
    expect(p.activity.id).toBe('light');
    expect(p.activity.multiplier).toBe(1.375);
  });

  it('leaves the target at maintenance with a zero delta and no weeks estimate', () => {
    const p = run(male, 'mifflin', 'sedentary', maintain);
    expect(p.dailyDelta).toBe(0);
    expect(p.target).toBe(p.tdee);
    expect(p.weeksToGoal).toBeNull();
  });

  it('ignores a rate and a target weight supplied alongside "maintain"', () => {
    const p = run(male, 'mifflin', 'sedentary', {
      direction: 'maintain',
      rateKgPerWeek: 0.75,
      targetWeightKg: 60,
    });
    expect(p.dailyDelta).toBe(0);
    expect(p.target).toBe(p.tdee);
    expect(p.weeksToGoal).toBeNull();
  });
});

describe('plan — the daily delta', () => {
  it('is rate × 7700 ÷ 7 and negative when losing: 0.5 kg/week is −550 kcal/day', () => {
    const p = run(male, 'mifflin', 'moderate', lose(0.5));
    expect(p.dailyDelta).toBeCloseTo(-550, 2);
    expect(p.target).toBeCloseTo(2005.5625, 2);
    expect(p.target).toBeCloseTo(p.tdee + p.dailyDelta, 2);
  });

  it('is positive when gaining: 0.25 kg/week is +275 kcal/day', () => {
    const p = run(male, 'mifflin', 'moderate', gain(0.25));
    expect(p.dailyDelta).toBeCloseTo(275, 2);
    expect(p.target).toBeCloseTo(2830.5625, 2);
    expect(p.target).toBeCloseTo(p.tdee + p.dailyDelta, 2);
  });

  it('takes the magnitude of the rate, so a negative rate under "lose" still loses', () => {
    expect(run(male, 'mifflin', 'moderate', lose(-0.5)).dailyDelta).toBeCloseTo(-550, 2);
    expect(run(male, 'mifflin', 'moderate', gain(-0.25)).dailyDelta).toBeCloseTo(275, 2);
  });

  it('scales linearly with the rate, the deficit being proportional to kilograms per week', () => {
    const half = run(male, 'mifflin', 'moderate', lose(0.25)).dailyDelta;
    expect(run(male, 'mifflin', 'moderate', lose(0.5)).dailyDelta).toBeCloseTo(half * 2, 2);
  });
});

describe('plan — weeksToGoal', () => {
  it('is the absolute distance to the target weight divided by the rate', () => {
    expect(run(male, 'mifflin', 'moderate', lose(0.5, 60)).weeksToGoal).toBeCloseTo(20, 2);
    expect(run(male, 'mifflin', 'moderate', gain(0.25, 75)).weeksToGoal).toBeCloseTo(20, 2);
  });

  it('refuses to estimate for a target the plan is walking away from', () => {
    // A losing plan aimed at a HEAVIER weight. Taking the absolute gap used to
    // report a confident 20 weeks for a weight the deficit moves away from a
    // little further every day.
    const p = run(male, 'mifflin', 'moderate', lose(0.5, 80));
    expect(p.weeksToGoal).toBeNull();
    expect(p.warnings.map((w) => w.id)).toContain('wrong-direction');
    expect(p.steps.map((s) => s.label)).not.toContain('Time to target weight');

    // Gaining towards a lighter target is the same mistake, mirrored.
    const g = run(male, 'mifflin', 'moderate', gain(0.5, 60));
    expect(g.weeksToGoal).toBeNull();
    expect(g.warnings.map((w) => w.id)).toContain('wrong-direction');
  });

  it('estimates when the target agrees with the direction', () => {
    expect(run(male, 'mifflin', 'moderate', lose(0.5, 60)).weeksToGoal).toBeCloseTo(20, 2);
    expect(run(male, 'mifflin', 'moderate', gain(0.5, 80)).weeksToGoal).toBeCloseTo(20, 2);
  });

  it('treats a target equal to the current weight as unreachable rather than instant', () => {
    // Zero distance is not "you are done in no time" — a plan with a deficit
    // is already moving off the number it is aimed at.
    const p = run(male, 'mifflin', 'moderate', lose(0.5, 70));
    expect(p.weeksToGoal).toBeNull();
    expect(p.warnings.map((w) => w.id)).toContain('wrong-direction');
  });

  it('is null when maintaining, because there is no rate to divide by', () => {
    const p = run(male, 'mifflin', 'moderate', {
      direction: 'maintain',
      rateKgPerWeek: 0,
      targetWeightKg: 60,
    });
    expect(p.weeksToGoal).toBeNull();
  });

  it('is null when the target weight is absent, non-finite or non-positive', () => {
    expect(run(male, 'mifflin', 'moderate', lose(0.5, null)).weeksToGoal).toBeNull();
    expect(run(male, 'mifflin', 'moderate', lose(0.5, Number.NaN)).weeksToGoal).toBeNull();
    expect(run(male, 'mifflin', 'moderate', lose(0.5, 0)).weeksToGoal).toBeNull();
    expect(run(male, 'mifflin', 'moderate', lose(0.5, -5)).weeksToGoal).toBeNull();
  });
});

/* --------------------------------------------------------- warnings ------ */

describe('plan — warnings', () => {
  it('fires nothing for a moderate, well-inside-the-lines plan', () => {
    expect(ids(run(male, 'mifflin', 'moderate', lose(0.5)))).toEqual([]);
    expect(ids(run(male, 'mifflin', 'sedentary', maintain))).toEqual([]);
  });

  it('fires below-bmr when the target drops under resting energy', () => {
    // sedentary tdee 1978.5 − 440 = 1538.5: under the 1648.75 resting rate, over the 1500 floor
    const p = run(male, 'mifflin', 'sedentary', lose(0.4));
    expect(p.target).toBeCloseTo(1538.5, 2);
    expect(ids(p)).toEqual(['below-bmr']);
    expect(p.warnings[0]!.message).toContain('resting energy');
  });

  it('does not fire below-bmr when the target sits above resting energy, nor when gaining', () => {
    expect(ids(run(male, 'mifflin', 'moderate', lose(0.5)))).not.toContain('below-bmr');
    expect(ids(run(male, 'mifflin', 'sedentary', gain(0.1)))).not.toContain('below-bmr');
  });

  it('fires below-floor when a male target falls under 1500 kcal', () => {
    const p = run(male, 'mifflin', 'sedentary', lose(0.5));
    expect(p.target).toBeCloseTo(1428.5, 2);
    expect(ids(p)).toContain('below-floor');
    expect(p.warnings.find((w) => w.id === 'below-floor')!.message).toContain('1,500');
  });

  it('uses the lower 1200 kcal floor for a female, so a 1229 kcal target does not trip it', () => {
    // female sedentary tdee 1779.3 − 550 = 1229.3: under resting energy, over the female floor
    const p = run(female, 'mifflin', 'sedentary', lose(0.5));
    expect(p.target).toBeCloseTo(1229.3, 2);
    expect(ids(p)).toContain('below-bmr');
    expect(ids(p)).not.toContain('below-floor');
  });

  it('fires below-floor for a female once the target drops under 1200 kcal', () => {
    const p = run(female, 'mifflin', 'sedentary', lose(0.6));
    expect(p.target).toBeCloseTo(1119.3, 2);
    expect(ids(p)).toContain('below-floor');
    expect(p.warnings.find((w) => w.id === 'below-floor')!.message).toContain('1,200');
  });

  it('does not fire below-floor for a comfortable target', () => {
    expect(ids(run(male, 'mifflin', 'moderate', lose(0.5)))).not.toContain('below-floor');
  });

  it('fires aggressive-rate above 1% of body weight per week', () => {
    const p = run(male, 'mifflin', 'extra-active', lose(0.75));
    expect(ids(p)).toContain('aggressive-rate');
    expect(p.warnings.find((w) => w.id === 'aggressive-rate')!.message).toContain('1%');
  });

  it('does not fire aggressive-rate exactly at 1% of body weight — 0.70 kg/week for 70 kg', () => {
    expect(ids(run(male, 'mifflin', 'extra-active', lose(0.7)))).not.toContain('aggressive-rate');
  });

  it('scales aggressive-rate with body weight, so 0.75 kg/week is fine for 100 kg but 1.5 is not', () => {
    const heavy: BodyInput = { ...male, weightKg: 100 };
    expect(ids(run(heavy, 'mifflin', 'extra-active', lose(0.75)))).not.toContain('aggressive-rate');
    expect(ids(run(heavy, 'mifflin', 'extra-active', lose(1.5)))).toContain('aggressive-rate');
  });

  it('does not fire aggressive-rate when gaining fast, which is fast-gain instead', () => {
    expect(ids(run(male, 'mifflin', 'extra-active', gain(0.9)))).not.toContain('aggressive-rate');
  });

  it('fires fast-gain above 0.5 kg a week', () => {
    const p = run(male, 'mifflin', 'moderate', gain(0.6));
    expect(ids(p)).toEqual(['fast-gain']);
    expect(p.warnings[0]!.message).toContain('0.5 kg');
  });

  it('does not fire fast-gain at exactly 0.5 kg a week, nor when losing at that rate', () => {
    expect(ids(run(male, 'mifflin', 'moderate', gain(0.5)))).not.toContain('fast-gain');
    expect(ids(run(male, 'mifflin', 'moderate', lose(0.6)))).not.toContain('fast-gain');
  });

  it('fires body-fat-ignored when a body-fat value is given to an equation that cannot read it', () => {
    const body: BodyInput = { ...male, bodyFatPct: 20 };
    const p = run(body, 'mifflin', 'moderate', maintain);
    expect(ids(p)).toEqual(['body-fat-ignored']);
    expect(p.warnings[0]!.message).toContain('Mifflin');
    expect(ids(run(body, 'harris-benedict', 'moderate', maintain))).toEqual(['body-fat-ignored']);
  });

  it('does not fire body-fat-ignored for Katch–McArdle, nor when no body fat was entered', () => {
    expect(ids(run({ ...male, bodyFatPct: 20 }, 'katch-mcardle', 'moderate', maintain))).not.toContain(
      'body-fat-ignored',
    );
    expect(ids(run(male, 'mifflin', 'moderate', maintain))).not.toContain('body-fat-ignored');
  });

  it('fires extreme-input past 120 years, 260 cm or 400 kg', () => {
    expect(ids(run({ ...male, age: 121 }, 'mifflin', 'moderate', maintain))).toEqual(['extreme-input']);
    expect(ids(run({ ...male, heightCm: 261 }, 'mifflin', 'moderate', maintain))).toEqual(['extreme-input']);
    expect(ids(run({ ...male, weightKg: 401 }, 'mifflin', 'moderate', maintain))).toEqual(['extreme-input']);
  });

  it('does not fire extreme-input exactly at the bounds, which are still inside the fitted range', () => {
    const edge: BodyInput = { ...male, age: 120, heightCm: 260, weightKg: 400 };
    expect(ids(run(edge, 'mifflin', 'moderate', maintain))).not.toContain('extreme-input');
  });

  it('stacks every caution a plan earns rather than reporting only the first', () => {
    const body: BodyInput = { ...female, age: 130, bodyFatPct: 25 };
    const p = run(body, 'mifflin', 'sedentary', lose(1.2));
    // A 1.2 kg/week deficit on a 70 kg body at 1.2x activity is 1320 kcal/day
    // against a maintenance under that, so the target goes negative too.
    // impossible-rate leads: when there is no intake that achieves the plan,
    // that is the thing to read first.
    expect(ids(p)).toEqual([
      'impossible-rate',
      'below-bmr',
      'below-floor',
      'aggressive-rate',
      'body-fat-ignored',
      'extreme-input',
    ]);
  });

  it('floors an impossible target at zero instead of printing a negative intake', () => {
    const small: BodyInput = { ...male, heightCm: 150, weightKg: 50 };
    const p = run(small, 'mifflin', 'sedentary', lose(1.5));
    expect(ids(p)).toContain('impossible-rate');
    expect(p.target).toBe(0);
    // The deficit itself is still reported honestly; only the intake is floored.
    expect(p.dailyDelta).toBeLessThan(0);
    expect(p.steps.some((s) => s.value.includes('-'))).toBe(false);
  });

  it('does not fire impossible-rate for a deficit the body can actually absorb', () => {
    expect(ids(run(male, 'mifflin', 'moderate', lose(0.5)))).not.toContain('impossible-rate');
  });
});

/* --------------------------------------------------------- refusals ------ */

describe('plan — refusals', () => {
  it('refuses an unknown equation or activity id by name', () => {
    expect(reason(plan(male, 'nonsense' as EquationId, 'moderate', maintain))).toBe('Unknown equation "nonsense".');
    expect(reason(plan(male, 'mifflin', 'nonsense' as ActivityId, maintain))).toBe(
      'Unknown activity level "nonsense".',
    );
  });

  it('passes a BMR refusal straight through instead of inventing a plan', () => {
    expect(
      reason(plan({ ...male, bodyFatPct: null }, 'katch-mcardle', 'moderate', maintain)).toLowerCase(),
    ).toContain('body-fat');
    expect(reason(plan({ ...male, age: 0 }, 'mifflin', 'moderate', maintain))).toBe(TOO_SMALL);
  });

  it('refuses a rate of zero for a non-maintain goal, pointing at "maintain" instead', () => {
    expect(reason(plan(male, 'mifflin', 'moderate', lose(0)))).toBe(BAD_RATE);
    expect(reason(plan(male, 'mifflin', 'moderate', gain(0)))).toBe(BAD_RATE);
  });

  it('refuses a non-finite rate for a non-maintain goal', () => {
    expect(reason(plan(male, 'mifflin', 'moderate', lose(Number.NaN)))).toBe(BAD_RATE);
    expect(reason(plan(male, 'mifflin', 'moderate', gain(Number.POSITIVE_INFINITY)))).toBe(BAD_RATE);
  });

  it('accepts a rate of zero when maintaining, where the rate is meaningless anyway', () => {
    expect(plan(male, 'mifflin', 'moderate', maintain).ok).toBe(true);
    expect(plan(male, 'mifflin', 'moderate', { ...maintain, rateKgPerWeek: Number.NaN }).ok).toBe(true);
  });
});

/* ------------------------------------------------------------- steps ----- */

describe('plan — shown working', () => {
  it('shows resting energy, maintenance and the daily target when maintaining', () => {
    const p = run(male, 'mifflin', 'sedentary', maintain);
    expect(p.steps).toHaveLength(3);
    expect(p.steps.map((s) => s.label)).toEqual([
      'Resting energy (Mifflin–St Jeor)',
      'Maintenance (sedentary)',
      'Daily target',
    ]);
  });

  it('gives every step a non-empty label, detail and value', () => {
    const p = run(male, 'mifflin', 'moderate', lose(0.5, 60));
    expect(p.steps.length).toBeGreaterThan(0);
    for (const step of p.steps) {
      expect(typeof step.label).toBe('string');
      expect(typeof step.detail).toBe('string');
      expect(typeof step.value).toBe('string');
      expect(step.label.length).toBeGreaterThan(0);
      expect(step.detail.length).toBeGreaterThan(0);
      expect(step.value.length).toBeGreaterThan(0);
    }
  });

  it('substitutes the user\'s own numbers into the maintenance line', () => {
    const step = run(male, 'mifflin', 'sedentary', maintain).steps[1]!;
    expect(step.detail).toContain('1,649');
    expect(step.detail).toContain('1.2');
    expect(step.value).toBe('1,979 kcal/day');
  });

  it('adds a deficit or surplus line showing the rate and the kcal-per-kg constant', () => {
    const losing = run(male, 'mifflin', 'moderate', lose(0.5));
    expect(losing.steps).toHaveLength(4);
    expect(losing.steps[2]!.label).toBe('Daily deficit');
    expect(losing.steps[2]!.detail).toContain('0.50 kg/week');
    expect(losing.steps[2]!.detail).toContain('7,700');
    expect(losing.steps[2]!.value).toMatch(/^−\s?550 kcal\/day$/);

    const gaining = run(male, 'mifflin', 'moderate', gain(0.25));
    expect(gaining.steps[2]!.label).toBe('Daily surplus');
    expect(gaining.steps[2]!.value).toMatch(/^\+\s?275 kcal\/day$/);
  });

  it('omits the delta line entirely when maintaining, and says the target is unchanged', () => {
    const p = run(male, 'mifflin', 'sedentary', maintain);
    expect(p.steps.map((s) => s.label)).not.toContain('Daily deficit');
    expect(p.steps[2]!.detail).toContain('unchanged');
  });

  it('adds a time-to-target line only when a target weight was given', () => {
    const p = run(male, 'mifflin', 'moderate', lose(0.5, 60));
    expect(p.steps).toHaveLength(5);
    expect(p.steps[4]!.label).toBe('Time to target weight');
    expect(p.steps[4]!.detail).toContain('10.0 kg to go');
    expect(p.steps[4]!.detail).toContain('0.50 kg/week');
    expect(p.steps[4]!.value).toBe('20.0 weeks');
    expect(run(male, 'mifflin', 'moderate', lose(0.5)).steps).toHaveLength(4);
  });

  it('says "under a week" rather than a fraction when the goal is close', () => {
    expect(run(male, 'mifflin', 'moderate', lose(0.5, 69.7)).steps[4]!.value).toBe('under a week');
  });
});

/* ------------------------------------------------------------- units ----- */

describe('kgToLb / lbToKg', () => {
  it('converts by the exact pounds-per-kilogram constant', () => {
    expect(kgToLb(1)).toBe(LB_PER_KG);
    expect(kgToLb(70)).toBeCloseTo(154.323584, 6);
    expect(lbToKg(154.3235835294143)).toBeCloseTo(70, 6);
  });

  it('round-trips stably in both directions', () => {
    for (const kg of [0, 0.5, 45.359237, 70, 123.456, 400]) {
      expect(lbToKg(kgToLb(kg))).toBeCloseTo(kg, 6);
    }
    for (const lb of [1, 154.32, 220]) {
      expect(kgToLb(lbToKg(lb))).toBeCloseTo(lb, 6);
    }
  });
});

describe('cmToInches / inchesToCm', () => {
  it('converts by the exact centimetres-per-inch constant', () => {
    expect(CM_PER_INCH).toBe(2.54);
    expect(inchesToCm(1)).toBe(2.54);
    expect(cmToInches(175)).toBeCloseTo(68.897638, 6);
  });

  it('round-trips stably in both directions', () => {
    for (const cm of [0, 30.48, 150, 175, 182.88, 260]) {
      expect(inchesToCm(cmToInches(cm))).toBeCloseTo(cm, 6);
    }
    for (const inches of [12, 69, 72.5]) {
      expect(cmToInches(inchesToCm(inches))).toBeCloseTo(inches, 6);
    }
  });
});

describe('cmToFeetInches', () => {
  it('reads 175 cm as 5 ft 9 in', () => {
    expect(cmToFeetInches(175)).toEqual({ feet: 5, inches: 9 });
  });

  it('rolls a rounded 12 inches into the next foot rather than reporting "5 ft 12 in"', () => {
    // 181.9 cm is 71.61 in; rounding the leftover 11.61 in on its own would give 5 ft 12 in
    expect(cmToFeetInches(181.9)).toEqual({ feet: 6, inches: 0 });
    expect(cmToFeetInches(182.88)).toEqual({ feet: 6, inches: 0 });
    expect(cmToFeetInches(152.4)).toEqual({ feet: 5, inches: 0 });
  });

  it('never reports 12 or more inches across a metre of plausible heights', () => {
    for (let tenths = 1400; tenths <= 2400; tenths += 1) {
      const { feet, inches } = cmToFeetInches(tenths / 10);
      expect(inches).toBeLessThan(12);
      expect(inches).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(feet)).toBe(true);
    }
  });
});

describe('feetInchesToCm', () => {
  it('is the inch conversion of the total inches', () => {
    expect(feetInchesToCm(5, 9)).toBeCloseTo(175.26, 6);
    expect(feetInchesToCm(6, 0)).toBeCloseTo(182.88, 6);
    expect(feetInchesToCm(0, 1)).toBe(2.54);
  });

  it('round-trips with cmToFeetInches to within the half-inch that rounding costs', () => {
    for (const cm of [150, 160.5, 168, 175, 181.9, 190.2, 200]) {
      const { feet, inches } = cmToFeetInches(cm);
      expect(Math.abs(feetInchesToCm(feet, inches) - cm)).toBeLessThanOrEqual(CM_PER_INCH / 2);
    }
  });
});

describe('unit-system helpers', () => {
  it('shows, reads back, labels and steps weight in whichever unit the UI is using', () => {
    expect(weightIn(70, 'metric')).toBe(70);
    expect(weightIn(70, 'imperial')).toBeCloseTo(154.323584, 6);
    expect(weightToKg(70, 'metric')).toBe(70);
    expect(weightToKg(weightIn(83.4, 'imperial'), 'imperial')).toBeCloseTo(83.4, 6);
    expect(weightUnit('metric')).toBe('kg');
    expect(weightUnit('imperial')).toBe('lb');
    expect(rateStep('metric')).toBe(0.05);
    expect(rateStep('imperial')).toBe(0.1);
  });
});
