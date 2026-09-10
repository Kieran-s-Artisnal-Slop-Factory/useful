import { describe, expect, it } from 'vitest';
import { substituteJson, substitutedLatex, usableValues } from './substitute';

/* `substitutedLatex` needs the Compute Engine, which loads fine in Node — the
   cases below are the ones that decide whether this feature is honest, so
   they are asserted against the real library rather than a stand-in. The tree
   walk is tested separately because MathJSON is plain JSON and deserves
   assertions that do not cost 2.5 MB to run. */

describe('substituteJson', () => {
  it('replaces a bare string symbol', () => {
    expect(substituteJson('rate', { rate: 0.05 })).toBe(0.05);
  });

  it('leaves a symbol with no value alone', () => {
    expect(substituteJson('rate', { other: 1 })).toBe('rate');
  });

  it('never replaces the operator head, only the arguments', () => {
    // A formula with a variable genuinely called "Add" must not rewrite the
    // operator of every sum in the tree.
    expect(substituteJson(['Add', 'Add', 2], { Add: 7 })).toEqual(['Add', 7, 2]);
  });

  it('walks nested applications', () => {
    expect(
      substituteJson(['Divide', ['Add', 'a', 'b'], 'c'], { a: 1, b: 2, c: 4 })
    ).toEqual(['Divide', ['Add', 1, 2], 4]);
  });

  it('handles the {sym} long form', () => {
    expect(substituteJson({ sym: 'x' }, { x: 9 })).toBe(9);
    expect(substituteJson({ sym: 'x' }, { y: 9 })).toEqual({ sym: 'x' });
  });

  it('handles the {fn} long form and keeps its siblings', () => {
    expect(substituteJson({ fn: ['Add', 'a', 1], comment: 'k' }, { a: 3 })).toEqual({
      fn: ['Add', 3, 1],
      comment: 'k',
    });
  });

  it('accepts the _upright alias a single-letter \\mathrm{} produces', () => {
    // `\mathrm{w}` parses as `w_upright`, not `w` — an imported formula can
    // carry it even though the editor never writes one.
    expect(substituteJson('w_upright', { w: 70 })).toBe(70);
  });

  it('reports which names it actually used', () => {
    const replaced = new Set<string>();
    substituteJson(['Add', 'a', 'zzz'], { a: 1, b: 2 }, replaced);
    expect([...replaced]).toEqual(['a']);
  });

  it('leaves numbers and nulls untouched', () => {
    expect(substituteJson(42, { a: 1 })).toBe(42);
    expect(substituteJson(null, { a: 1 })).toBeNull();
  });
});

describe('usableValues', () => {
  it('keeps real numbers and drops everything else', () => {
    expect(usableValues({ a: 1, b: null, c: 0, d: NaN, e: Infinity, f: -2.5 })).toEqual({
      a: 1,
      c: 0,
      f: -2.5,
    });
  });

  it('keeps zero, which is a value and not an absence', () => {
    expect(usableValues({ discount: 0 })).toEqual({ discount: 0 });
  });
});

describe('substitutedLatex against the real engine', () => {
  it('writes the values in WITHOUT evaluating the formula', async () => {
    // This is the whole point. `expr.subs()` — which the evaluator uses —
    // returns 900 for this input, because it partially evaluates.
    const out = await substitutedLatex('\\mathrm{costPerMonth}\\times 12\\times\\mathrm{years}', {
      costPerMonth: 25,
      years: 3,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.latex).toBe('25\\times12\\times3');
    expect(out.replaced).toEqual(['costPerMonth', 'years']);
  }, 60_000);

  it('keeps a square root a square root instead of solving it', async () => {
    const out = await substitutedLatex('\\sqrt{x^2+y^2}', { x: 3, y: 4 });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    // subs() gives "5" here.
    expect(out.latex).toBe('\\sqrt{3^2+4^2}');
  }, 60_000);

  it('keeps a subtraction a subtraction, and parenthesises a negative', async () => {
    // Canonically `a - b` is Add(a, Negate(b)), so b = -7 renders as "5 + 7".
    // The non-canonical parse keeps Subtract and shows the honest "5 - (-7)".
    const out = await substitutedLatex('a-b', { a: 5, b: -7 });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.latex).toBe('5-(-7)');
  }, 60_000);

  it('preserves the order the author wrote', async () => {
    const out = await substitutedLatex(
      '\\mathrm{principal}\\cdot\\left(1+\\mathrm{rate}\\right)^{\\mathrm{years}}',
      { principal: 1000, rate: 0.05, years: 10 }
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    // Canonically this reorders to (rate + 1).
    expect(out.latex).toContain('(1+0.05)');
    expect(out.latex).toContain('^{10}');
  }, 60_000);

  it('does not touch a name that merely appears inside another word', async () => {
    // The string-replacement trap: `\text{rated}` must not become `\text{0.05d}`.
    const out = await substitutedLatex('\\mathrm{rate}\\times\\mathrm{rated}', {
      rate: 2,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.latex).toContain('2');
    expect(out.latex).not.toContain('2d');
    expect(out.replaced).toEqual(['rate']);
  }, 60_000);

  it('substitutes only the fields that have values', async () => {
    const out = await substitutedLatex('\\frac{\\mathrm{aa}}{\\mathrm{bb}}', {
      aa: 10,
      bb: null,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.replaced).toEqual(['aa']);
    expect(out.latex).toContain('10');
  }, 60_000);

  it('refuses an empty formula', async () => {
    const out = await substitutedLatex('   ', { a: 1 });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toMatch(/no formula/i);
  }, 60_000);

  it('refuses when nothing has a value yet', async () => {
    const out = await substitutedLatex('a+b', { a: null, b: null });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toMatch(/nothing to substitute/i);
  }, 60_000);

  it('refuses when none of the named values appear in the formula', async () => {
    const out = await substitutedLatex('\\mathrm{qty}+1', { somethingElse: 5 });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toMatch(/none of the named inputs/i);
  }, 60_000);
});
