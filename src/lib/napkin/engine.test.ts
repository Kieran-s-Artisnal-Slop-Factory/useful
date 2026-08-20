/**
 * The Compute Engine wrapper, against the real library.
 *
 * These are the tests that would have caught the two design errors this phase
 * started with: that a pushed scope isolates an evaluation (it does not), and
 * that a numeric result can be read off `.re` (it cannot).
 */
import { describe, expect, it } from 'vitest';
import { boxJson, evaluateFormula, parseFormula } from './engine';

const latex = String.raw;

/** Parse, then evaluate at `values`. */
async function run(source: string, values: Record<string, number | null>) {
  const parsed = await parseFormula(source);
  return evaluateFormula(parsed.expr, values);
}

describe('parseFormula — free variables', () => {
  it('reports the names a formula needs a value for', async () => {
    const parsed = await parseFormula(latex`\frac{\mathrm{revenue}-\mathrm{cost}}{\mathrm{units}}`);
    expect(parsed.variables).toEqual(['cost', 'revenue', 'units']);
    expect(parsed.error).toBeNull();
  });

  it('excludes a bound index', async () => {
    // The sum binds `i`; asking the user for it would be nonsense.
    const parsed = await parseFormula(latex`\sum_{i=1}^{n} i`);
    expect(parsed.variables).toEqual(['n']);
  });

  it('excludes constants', async () => {
    expect((await parseFormula(latex`\pi r^2`)).variables).toEqual(['r']);
    expect((await parseFormula(latex`2\pi`)).variables).toEqual([]);
    expect((await parseFormula(latex`e^{x}`)).variables).toEqual(['x']);
  });

  it('excludes an integral’s variable of integration', async () => {
    expect((await parseFormula(latex`\int_0^1 x\,dx`)).variables).toEqual([]);
  });

  it('takes the right-hand side of an equation', async () => {
    // `total = qty × unit` is the natural way to name a result. Without this
    // the tool would ask for `total` as an input — a value for the answer.
    const parsed = await parseFormula(latex`\mathrm{total} = \mathrm{qty} \times \mathrm{unit}`);
    expect(parsed.variables).toEqual(['qty', 'unit']);
  });

  it('treats an empty formula as nothing rather than an error', async () => {
    const parsed = await parseFormula('   ');
    expect(parsed.variables).toEqual([]);
    expect(parsed.json).toBeNull();
    expect(parsed.error).toBeNull();
  });

  it('reports a formula that does not parse', async () => {
    const parsed = await parseFormula(latex`\frac{`);
    expect(parsed.error).toMatch(/does not parse/);
    expect(parsed.variables).toEqual([]);
  });

  it('renames a SINGLE letter wrapped in \\mathrm{}, which is why the editor will not', async () => {
    // `\mathrm{x}` parses as the symbol `x_upright`, not `x`. The editor's
    // rule only fires on two letters or more, so this cannot happen by typing
    // — but an imported formula can carry it, and the field is then named
    // `x_upright`. Self-consistent, just ugly.
    expect((await parseFormula(latex`\mathrm{x}`)).variables).toEqual(['x_upright']);
    expect((await parseFormula(latex`\mathrm{ab}`)).variables).toEqual(['ab']);
  });

  it('makes a multi-letter name one symbol, not a product of letters', async () => {
    // This is what the editor's \mathrm{} wrapping buys; bare `count` would be
    // c*o*u*n*t.
    expect((await parseFormula(latex`\mathrm{count}`)).variables).toEqual(['count']);
    expect((await parseFormula('count')).variables).toEqual(['c', 'n', 'o', 't', 'u']);
  });
});

describe('evaluateFormula', () => {
  it('computes hand-checkable answers', async () => {
    expect((await run(latex`\frac{x}{y}`, { x: 7, y: 2 })).value).toBe(3.5);
    expect((await run(latex`x^{y}`, { x: 2, y: 10 })).value).toBe(1024);
    expect((await run(latex`\sqrt{x}`, { x: 9 })).value).toBe(3);
    expect((await run(latex`a+b`, { a: 0.1, b: 0.2 })).value).toBeCloseTo(0.3, 10);
  });

  it('does not leak values between evaluations', async () => {
    // The bug this replaced: `assign` inside a pushed scope survived
    // `popScope`, so the next run returned the previous answer and a run with
    // no values at all returned it too.
    const parsed = await parseFormula(latex`\frac{x}{y}`);
    expect((await evaluateFormula(parsed.expr, { x: 7, y: 2 })).value).toBe(3.5);
    expect((await evaluateFormula(parsed.expr, { x: 10, y: 5 })).value).toBe(2);
    const empty = await evaluateFormula(parsed.expr, {});
    expect(empty.value).toBeNull();
    expect(empty.error).toMatch(/Fill in every input/);
    // And the formula still knows what it needs.
    expect(parsed.expr.unknowns.sort()).toEqual(['x', 'y']);
  });

  it('refuses a complex answer instead of reporting its real part', async () => {
    // sqrt(-4) has a real part of 0. Showing that would be a very convincing
    // wrong answer.
    const negative = await run(latex`\sqrt{x}`, { x: -4 });
    expect(negative.value).toBeNull();
    expect(negative.error).toMatch(/real/);
  });

  it('refuses an infinite answer', async () => {
    const divided = await run(latex`\frac{x}{y}`, { x: 1, y: 0 });
    expect(divided.value).toBeNull();
    expect(divided.error).toMatch(/infinite|real/);
  });

  it('refuses NaN', async () => {
    const nan = await run(latex`\frac{x}{y}`, { x: 0, y: 0 });
    expect(nan.value).toBeNull();
    expect(nan.error).toBeTruthy();
  });

  it('says nothing useful when an input is missing, rather than guessing', async () => {
    const partial = await run(latex`x + y`, { x: 1, y: null });
    expect(partial.value).toBeNull();
    expect(partial.error).toMatch(/Fill in every input/);
  });

  it('evaluates a formula boxed back from stored MathJSON', async () => {
    // A saved template carries MathJSON, not a live expression.
    const parsed = await parseFormula(latex`\frac{\mathrm{numerator}}{\mathrm{denominator}}`);
    const round = await boxJson(JSON.parse(JSON.stringify(parsed.json)));
    expect((await evaluateFormula(round, { numerator: 9, denominator: 3 })).value).toBe(3);
  });
});
