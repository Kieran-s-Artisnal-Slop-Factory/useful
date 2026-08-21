import { describe, expect, it } from 'vitest';
import { emitExpression, UnsupportedOperator } from './expression';
import { functionName, identifierMap } from './identifiers';
import { generateFunction, type CodeTemplate } from './functions';
import type { NapkinField } from '../db/types';
import type { Language } from './expression';

const LANGUAGES: Language[] = ['python', 'javascript', 'go', 'rust'];

const field = (name: string, over: Partial<NapkinField> = {}): NapkinField => ({
  name,
  label: name,
  description: '',
  type: 'number',
  required: true,
  sign: 'any',
  noZero: false,
  ...over,
});

/** Emit one expression with an identity name map. */
const emit = (json: unknown, language: Language, symbols: string[] = []) =>
  emitExpression(json, language, identifierMap(symbols, language)).expression;

describe('identifierMap', () => {
  it('cleans a symbol into something every language accepts', () => {
    const map = identifierMap(['a_b', 'Δcost', '2x', 'ok'], 'python');
    expect(map.get('a_b')).toBe('a_b');
    expect(map.get('Δcost')).toBe('cost');
    expect(map.get('2x')).toBe('v2x');
    expect(map.get('ok')).toBe('ok');
  });

  it('follows each language’s casing', () => {
    // snake_case for Python and Rust; camelCase for JavaScript and Go, where
    // gofmt will not fix a snake_case name and every linter flags one.
    expect(identifierMap(['costPerUnit'], 'python').get('costPerUnit')).toBe('cost_per_unit');
    expect(identifierMap(['costPerUnit'], 'rust').get('costPerUnit')).toBe('cost_per_unit');
    expect(identifierMap(['cost_per_unit'], 'javascript').get('cost_per_unit')).toBe('costPerUnit');
    expect(identifierMap(['cost_per_unit'], 'go').get('cost_per_unit')).toBe('costPerUnit');
  });

  it('leaves a name that is already camelCase alone', () => {
    // Splitting on underscores alone leaves `costPerMonth` as one part, and
    // lowercasing it gives `costpermonth` — a name nobody typed.
    expect(identifierMap(['costPerMonth'], 'javascript').get('costPerMonth')).toBe('costPerMonth');
    expect(identifierMap(['costPerMonth'], 'go').get('costPerMonth')).toBe('costPerMonth');
  });

  it('does not hand back a reserved word', () => {
    expect(identifierMap(['class'], 'python').get('class')).toBe('class_');
    expect(identifierMap(['fn'], 'rust').get('fn')).toBe('fn_');
    // `math` is not reserved, but the emitted file imports it under that name.
    expect(identifierMap(['math'], 'python').get('math')).toBe('math_');
  });

  it('resolves collisions deterministically, first symbol keeping the plain name', () => {
    const map = identifierMap(['a-b', 'a_b', 'a.b'], 'python');
    expect([...map.values()]).toEqual(['a_b', 'a_b_2', 'a_b_3']);
    // Same input, same answer — a regenerated file must not rename parameters.
    expect([...identifierMap(['a-b', 'a_b', 'a.b'], 'python').values()]).toEqual([...map.values()]);
  });

  it('names the function from the template', () => {
    expect(functionName('Unit economics', 'python')).toBe('unit_economics');
    expect(functionName('Unit economics', 'javascript')).toBe('unitEconomics');
    // Go marks an export with a leading capital, and a pasted function should
    // be callable from wherever it lands.
    expect(functionName('Unit economics', 'go')).toBe('UnitEconomics');
    expect(functionName('', 'go')).toBe('Calculate');
  });
});

describe('emitExpression — precedence', () => {
  it('parenthesises a sum inside a product, and not the other way round', () => {
    const sumInProduct = ['Multiply', 2, ['Add', 'a', 'b']];
    const productInSum = ['Add', 2, ['Multiply', 'a', 'b']];
    for (const language of LANGUAGES) {
      expect(emit(sumInProduct, language, ['a', 'b'])).toContain('(a + b)');
      expect(emit(productInSum, language, ['a', 'b'])).not.toContain('(a * b)');
    }
  });

  it('keeps subtraction of a sum grouped', () => {
    // `a - (b + c)` is not `a - b + c`.
    expect(emit(['Subtract', 'a', ['Add', 'b', 'c']], 'python', ['a', 'b', 'c'])).toBe(
      'a - (b + c)'
    );
  });

  it('groups a sum under a division and under a power', () => {
    expect(emit(['Divide', ['Add', 'a', 'b'], 2], 'python', ['a', 'b'])).toBe('(a + b) / 2.0');
    expect(emit(['Power', ['Add', 'a', 'b'], 2], 'javascript', ['a', 'b'])).toBe('(a + b) ** 2');
  });
});

describe('emitExpression — the operators that differ per language', () => {
  it('writes a power the way each language spells it', () => {
    const power = ['Power', 'x', 2];
    expect(emit(power, 'python', ['x'])).toBe('x ** 2.0');
    expect(emit(power, 'javascript', ['x'])).toBe('x ** 2');
    // Go has no power operator at all.
    expect(emit(power, 'go', ['x'])).toBe('math.Pow(x, 2.0)');
    expect(emit(power, 'rust', ['x'])).toBe('(x as f64).powf(2.0)');
  });

  it('recognises e^x as the exponential, not a power of a constant', () => {
    // `\exp(x)` and `e^x` are the SAME MathJSON node.
    const expNode = ['Power', 'ExponentialE', 'x'];
    expect(emit(expNode, 'python', ['x'])).toBe('math.exp(x)');
    expect(emit(expNode, 'javascript', ['x'])).toBe('Math.exp(x)');
    expect(emit(expNode, 'rust', ['x'])).toBe('(x as f64).exp()');
  });

  it('treats a bare Log as base 10 and a two-argument Log as a change of base', () => {
    expect(emit(['Log', 'x'], 'python', ['x'])).toBe('math.log10(x)');
    expect(emit(['Log', 'x', 2], 'python', ['x'])).toBe('math.log(x) / math.log(2.0)');
    expect(emit(['Log', 'x'], 'rust', ['x'])).toBe('(x as f64).log10()');
  });

  it('folds a variadic Min into pairs where the language needs it', () => {
    const min = ['Min', 'a', 'b', 'c'];
    expect(emit(min, 'python', ['a', 'b', 'c'])).toBe('min(a, b, c)');
    expect(emit(min, 'javascript', ['a', 'b', 'c'])).toBe('Math.min(a, b, c)');
    // Go's math.Min takes exactly two.
    expect(emit(min, 'go', ['a', 'b', 'c'])).toBe('math.Min(math.Min(a, b), c)');
    expect(emit(min, 'rust', ['a', 'b', 'c'])).toBe('a.min(b).min(c)');
  });

  it('emits a helper for Mod everywhere but Python, whose % is already floored', () => {
    // The engine's Mod is floored: Mod(-7, 3) is 2, not -1.
    const mod = ['Mod', 'a', 'b'];
    expect(emit(mod, 'python', ['a', 'b'])).toBe('a % b');
    for (const language of ['javascript', 'go', 'rust'] as Language[]) {
      const out = emitExpression(mod, language, identifierMap(['a', 'b'], language));
      expect(out.expression).toBe('_mod(a, b)');
      expect(out.helpers.has('mod')).toBe(true);
    }
  });

  it('emits a helper for Round in Python and JavaScript, which round differently', () => {
    // Python's round() is banker's (2.5 -> 2); JavaScript's Math.round is half
    // UP (-2.5 -> -2). The engine rounds half away from zero either way.
    for (const language of ['python', 'javascript'] as Language[]) {
      const out = emitExpression(['Round', 'x'], language, identifierMap(['x'], language));
      expect(out.helpers.has('round'), language).toBe(true);
    }
    // Go and Rust already round half away from zero.
    const go = emitExpression(['Round', 'x'], 'go', identifierMap(['x'], 'go'));
    expect(go.expression).toBe('math.Round(x)');
    expect(go.helpers.has('round')).toBe(false);
  });

  it('needs a helper for a Round to a number of digits in every language', () => {
    for (const language of LANGUAGES) {
      const out = emitExpression(['Round', 'x', 2], language, identifierMap(['x'], language));
      expect(out.helpers.has('round'), language).toBe(true);
    }
  });
});

describe('emitExpression — refusals', () => {
  it('refuses an operator it has no rule for, by name', () => {
    // Emitting a plausible-looking guess is exactly the failure this avoids.
    expect(() => emit(['Gamma', 'x'], 'python', ['x'])).toThrow(UnsupportedOperator);
    try {
      emit(['Gamma', 'x'], 'python', ['x']);
    } catch (err) {
      expect((err as UnsupportedOperator).operator).toBe('Gamma');
      expect((err as Error).message).toContain('Gamma');
    }
  });

  it('refuses an odd root, which no target language can take of a negative', () => {
    // The engine says (-8)^(1/3) is -2; every target language says NaN.
    expect(() => emit(['Root', 'x', 3], 'python', ['x'])).toThrow(/odd root/);
    // An even root is just a fractional power, which is fine.
    expect(emit(['Root', 'x', 2], 'python', ['x'])).toContain('1 / 2.0');
  });

  it('refuses an empty formula rather than emitting an empty function', () => {
    expect(() => emit('Nothing', 'python')).toThrow(UnsupportedOperator);
  });
});

describe('generateFunction', () => {
  const template: CodeTemplate = {
    name: 'Unit economics',
    description: 'Margin per unit after the per-order cost is spread across the batch.',
    formulaLatex: '\\frac{\\mathrm{revenue} - \\mathrm{cost}}{\\mathrm{units}}',
    formulaJson: ['Divide', ['Subtract', 'revenue', 'cost'], 'units'],
    fields: [
      field('revenue'),
      field('cost'),
      field('units', { type: 'integer', sign: 'positive', noZero: true }),
    ],
  };

  it('produces Python with an import, a docstring, guards and the formula', () => {
    const out = generateFunction(template, 'python');
    expect(out).toContain('def unit_economics(revenue: float, cost: float, units: int) -> float:');
    expect(out).toContain('Margin per unit');
    expect(out).toContain('if units < 0:');
    expect(out).toContain('if units == 0:');
    expect(out).toContain('raise ValueError("units cannot be zero")');
    expect(out).toContain('return (revenue - cost) / units');
  });

  it('produces JavaScript with JSDoc and range guards', () => {
    const out = generateFunction(template, 'javascript');
    expect(out).toContain('export function unitEconomics(revenue, cost, units) {');
    expect(out).toContain('@param {number} revenue');
    expect(out).toContain('if (units === 0) throw new RangeError("units cannot be zero");');
    expect(out).toContain('return (revenue - cost) / units;');
  });

  it('produces Go that returns an error rather than a bad number', () => {
    const out = generateFunction(template, 'go');
    expect(out).toContain('package napkin');
    expect(out).toContain('"errors"');
    expect(out).toContain('func UnitEconomics(revenue float64, cost float64, units float64) (float64, error) {');
    expect(out).toContain('return 0, errors.New("units cannot be zero")');
    expect(out).toContain('return (revenue - cost) / units, nil');
  });

  it('produces Rust that returns a Result', () => {
    const out = generateFunction(template, 'rust');
    expect(out).toContain('pub fn unit_economics(revenue: f64, cost: f64, units: f64) -> Result<f64, String> {');
    expect(out).toContain('return Err("units cannot be zero".to_string());');
    expect(out).toContain('Ok((revenue - cost) / units)');
  });

  it('omits the guard machinery entirely when no field constrains anything', () => {
    const loose: CodeTemplate = { ...template, fields: [field('a'), field('b')] , formulaJson: ['Add', 'a', 'b'] };
    const go = generateFunction(loose, 'go');
    expect(go).not.toContain('errors');
    expect(go).toContain('(float64, error)');
    const rust = generateFunction(loose, 'rust');
    expect(rust).toContain('-> f64');
    expect(rust).not.toContain('Result');
  });

  it('imports the maths library only when the formula uses it', () => {
    const plain: CodeTemplate = { ...template, formulaJson: ['Add', 'revenue', 'cost'], fields: [field('revenue'), field('cost')] };
    expect(generateFunction(plain, 'python')).not.toContain('import math');
    const withSqrt: CodeTemplate = { ...plain, formulaJson: ['Sqrt', 'revenue'] };
    expect(generateFunction(withSqrt, 'python')).toContain('import math');
  });

  it('includes the helper source when the expression calls one', () => {
    const rounded: CodeTemplate = {
      ...template,
      formulaJson: ['Round', ['Divide', 'revenue', 'units'], 2],
      fields: [field('revenue'), field('units')],
    };
    const python = generateFunction(rounded, 'python');
    expect(python).toContain('def _round(');
    expect(python).toContain('import math');
    const js = generateFunction(rounded, 'javascript');
    expect(js).toContain('function _round(');
  });

  it('keeps a hostile label inside its string literal', () => {
    const hostile: CodeTemplate = {
      ...template,
      formulaJson: ['Add', 'a', 1],
      fields: [field('a', { label: 'x") ; import os ; os.system("rm -rf /', noZero: true })],
    };
    const out = generateFunction(hostile, 'python');
    // JSON.stringify is what keeps the guard message a string literal — the
    // quote that would have closed it is escaped.
    expect(out).toContain('raise ValueError("x\\") ;');
    expect(out).not.toContain('raise ValueError("x") ;');
  });

  it('cannot be made to break out of a comment', () => {
    // A label or description containing the comment terminator would end the
    // block early and drop the rest into the file as code.
    const hostile: CodeTemplate = {
      ...template,
      description: 'ends a docstring: \"\"\" and a JSDoc: */ then code',
      formulaJson: ['Add', 'a', 1],
      fields: [field('a', { label: 'label */ with \"\"\" in it' })],
    };
    const python = generateFunction(hostile, 'python');
    // The docstring's own delimiters are the only triple quotes in the file.
    expect(python.split('\"\"\"')).toHaveLength(3);

    const js = generateFunction(hostile, 'javascript');
    // Likewise: one opening /** and one closing */.
    expect(js.indexOf('*/')).toBe(js.lastIndexOf('*/'));
  });

  it('does not let a multi-line label spill out of a line comment', () => {
    const hostile: CodeTemplate = {
      ...template,
      formulaJson: ['Add', 'a', 1],
      fields: [field('a', { label: 'first line\nreturn 0, nil }' })],
    };
    const go = generateFunction(hostile, 'go');
    expect(go).not.toContain('\nreturn 0, nil }');
  });

  it('writes the formula into the comment as Markdown maths, not raw LaTeX', () => {
    for (const language of LANGUAGES) {
      const out = generateFunction(template, language);
      // Readable, and rendered as maths if the comment is lifted into Markdown.
      expect(out, language).toContain('$\\frac{revenue - cost}{units}$');
      // The renderer-only markup is gone.
      expect(out, language).not.toContain('\\mathrm{');
    }
  });

  describe('per-language docstring conventions', () => {
    it('Python uses NumPy-style sections with matching underlines', () => {
      const out = generateFunction(template, 'python');
      expect(out).toContain('Unit economics');
      expect(out).toContain('    Parameters\n    ----------');
      expect(out).toContain('    Returns\n    -------');
      expect(out).toContain('    revenue : float');
      expect(out).toContain('    units : int');
      // The constraints a type cannot express become a Raises section.
      expect(out).toContain('    Raises\n    ------\n    ValueError');
      expect(out).toContain('        If units is zero.');
    });

    it('starts Python at the def when nothing is imported', () => {
      const plain = generateFunction(
        { ...template, formulaJson: ['Add', 'revenue', 'cost'], fields: [field('revenue'), field('cost')] },
        'python'
      );
      expect(plain.startsWith('def ')).toBe(true);
    });

    it('Go uses the # Parameters / # Returns block form', () => {
      const out = generateFunction(template, 'go');
      expect(out).toContain('// # Parameters');
      expect(out).toContain('//  revenue (float64):');
      expect(out).toContain('// # Returns');
      expect(out).toContain('//  float64:');
      expect(out).toContain('//  error: Non-nil when an argument breaks');
    });

    it('Rust names the parameter and its meaning, and nothing the type says', () => {
      const out = generateFunction(template, 'rust');
      expect(out).toContain('/// * `units` — Not negative, not zero');
      // The signature already says f64; repeating it is noise.
      expect(out).not.toContain('whole number');
    });

    it('every language opens with a one-line summary', () => {
      for (const language of LANGUAGES) {
        expect(generateFunction(template, language), language).toContain('Unit economics');
      }
      // With no name, the description's first sentence stands in.
      const unnamed = generateFunction({ ...template, name: '' }, 'rust');
      expect(unnamed).toContain('/// Margin per unit after the per-order cost is spread across the batch.');
    });
  });

  describe('field descriptions', () => {
    const described: CodeTemplate = {
      ...template,
      fields: [
        field('revenue', { description: 'Money taken, before any costs' }),
        field('cost', { description: 'Everything spent to earn it' }),
        field('units', { type: 'integer', sign: 'positive', noZero: true }),
      ],
    };

    it('puts a field description in every language doc block', () => {
      for (const language of LANGUAGES) {
        expect(generateFunction(described, language), language).toContain(
          'Money taken, before any costs'
        );
      }
    });

    it('joins a description and its constraints into one clause', () => {
      const both: CodeTemplate = {
        ...described,
        fields: [field('revenue', { description: 'Money taken', sign: 'positive' })],
        formulaJson: 'revenue',
      };
      expect(generateFunction(both, 'rust')).toContain('/// * `revenue` — Money taken. Not negative');
    });

    it('says nothing at all for a field with neither', () => {
      const bare: CodeTemplate = { ...template, fields: [field('revenue')], formulaJson: 'revenue' };
      expect(generateFunction(bare, 'rust')).toContain('/// * `revenue`\n');
    });

    it('escapes a hostile description like any other comment text', () => {
      const hostile: CodeTemplate = {
        ...template,
        fields: [field('revenue', { description: 'ends a block */ then code' })],
        formulaJson: 'revenue',
      };
      const js = generateFunction(hostile, 'javascript');
      expect(js.indexOf('*/')).toBe(js.lastIndexOf('*/'));
    });
  });
});

describe('Sum, Product and Integrate', () => {
  const sumTemplate: CodeTemplate = {
    name: 'Summation',
    description: '',
    formulaLatex: String.raw`\sum_{x=1}^{4}\left(x+3+y\right)`,
    formulaJson: ['Sum', ['Add', 'x', 'y', 3], ['Limits', 'x', 1, 4]],
    fields: [field('y')],
  };
  const productTemplate: CodeTemplate = {
    name: 'Rising factorial',
    description: '',
    formulaLatex: String.raw`\prod_{k=1}^{n}\left(k+a\right)`,
    formulaJson: ['Product', ['Add', 'a', 'k'], ['Limits', 'k', 1, 'n']],
    fields: [field('a'), field('n')],
  };
  const integralTemplate: CodeTemplate = {
    name: 'Area under',
    description: '',
    formulaLatex: String.raw`\int_{2}^{3}x^2dx`,
    // The body arrives wrapped when the LaTeX carries a `dx`.
    formulaJson: ['Integrate', ['Function', ['Block', ['Power', 'x', 2]], 'x'], ['Limits', 'x', 2, 3]],
    fields: [],
  };

  it('emits a loop helper and a closure over the bound index', () => {
    for (const language of LANGUAGES) {
      const out = generateFunction(sumTemplate, language);
      expect(out, language).toContain('_sum(');
      // The helper travels with the function that calls it.
      expect(out, language).toMatch(/(def|function|func|fn) _sum/);
      // The index is the closure's parameter, not a parameter of the function
      // itself — the signature takes `y` alone.
      // Go capitalises the name, so match on the tail of it. Compare the
      // PARAMETER LIST rather than the whole line — `export` has an x in it.
      const signature = out.split('\n').find((line) => /ummation\(/.test(line));
      expect(signature, language).toBeDefined();
      const params = /ummation\(([^)]*)\)/.exec(signature!)![1]!;
      expect(params, language).not.toContain('x');
      expect(params, language).toContain('y');
    }
  });

  it('spells the closure the way each language does', () => {
    expect(generateFunction(sumTemplate, 'python')).toContain('lambda x:');
    expect(generateFunction(sumTemplate, 'javascript')).toContain('(x) =>');
    expect(generateFunction(sumTemplate, 'go')).toContain('func(x float64) float64 { return');
    expect(generateFunction(sumTemplate, 'rust')).toContain('|x: f64|');
  });

  it('handles a product, including bounds that are themselves variables', () => {
    const out = generateFunction(productTemplate, 'javascript');
    expect(out).toContain('_product(1, n,');
    expect(out).toContain('function _product');
  });

  it('unwraps an integral body however it arrived', () => {
    // `\int x^2 dx` wraps the body in Function/Block; `\int x \, dx` does not.
    const wrapped = generateFunction(integralTemplate, 'javascript');
    const bare: CodeTemplate = {
      ...integralTemplate,
      formulaJson: ['Integrate', ['Power', 'x', 2], ['Limits', 'x', 2, 3]],
    };
    expect(wrapped).toContain('_integrate(2, 3, (x) => x ** 2)');
    expect(generateFunction(bare, 'javascript')).toContain('_integrate(2, 3, (x) => x ** 2)');
  });

  it('refuses one without bounds rather than inventing a range', () => {
    const unbounded: CodeTemplate = {
      ...sumTemplate,
      formulaJson: ['Sum', ['Add', 'x', 'y']],
    };
    expect(() => generateFunction(unbounded, 'python')).toThrow(/Sum without bounds/);
  });

  it('renames a bound index that would shadow a parameter', () => {
    // A hand-built formula can bind `x` while a field is also called `x`. The
    // engine would not produce that, but an imported file could, and silently
    // shadowing the parameter inside the loop would change the answer.
    const clashing: CodeTemplate = {
      ...sumTemplate,
      formulaJson: ['Sum', ['Add', 'x', 'y'], ['Limits', 'x', 1, 4]],
      fields: [field('x'), field('y')],
    };
    const out = generateFunction(clashing, 'javascript');
    expect(out).toContain('function summation(x, y)');
    // The index took a different name, so the parameter is still reachable.
    expect(out).toContain('(x_2) =>');
  });

  it('pulls in the maths library only where the helper needs it', () => {
    // Go's loops round their bounds with math.Round; Python's do not.
    expect(generateFunction(sumTemplate, 'go')).toContain('"math"');
    expect(generateFunction(sumTemplate, 'python')).not.toContain('import math');
  });

  it('says an integral is approximate, because it is', () => {
    for (const language of LANGUAGES) {
      expect(generateFunction(integralTemplate, language), language).toMatch(/APPROXIMATE/);
      expect(generateFunction(integralTemplate, language), language).toMatch(/Simpson/);
    }
  });

  it('computes the same answers the engine does', () => {
    // The point of the whole exercise: run the emitted JavaScript and check it
    // against arithmetic done by hand.
    const run = (source: string, name: string) =>
      new Function(`${source.replace('export function', 'function')}; return ${name};`)();

    // x from 1 to 4 of (x + 3 + y), at y = 5: 9 + 10 + 11 + 12 = 42.
    expect(run(generateFunction(sumTemplate, 'javascript'), 'summation')(5)).toBe(42);
    // k from 1 to 4 of (k + 1): 2 * 3 * 4 * 5 = 120.
    expect(run(generateFunction(productTemplate, 'javascript'), 'risingFactorial')(1, 4)).toBe(120);
    // The integral of x^2 from 2 to 3 is 19/3; Simpson is exact up to a cubic.
    expect(run(generateFunction(integralTemplate, 'javascript'), 'areaUnder')()).toBeCloseTo(
      19 / 3,
      9
    );
  });
});
