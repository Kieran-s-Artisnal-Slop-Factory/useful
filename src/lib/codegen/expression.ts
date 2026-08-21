/**
 * MathJSON -> source, in four languages.
 *
 * A hand-written emitter rather than the Compute Engine's own compiler: that
 * API does not exist in the version this app ships, and even where it does it
 * builds JavaScript at run time, which a strict CSP disables — silently, since
 * its fallback degrades instead of erroring.
 *
 * Two rules the whole file exists to keep:
 *
 * **Nothing is emitted that is silently wrong.** An operator outside the table
 * throws `UnsupportedOperator`, which the UI shows by name. Emitting a
 * plausible-looking function for a node nobody checked is the failure mode
 * this design is chosen to avoid.
 *
 * **The languages disagree, and the differences are real.** Measured against
 * the engine itself:
 *
 *  - `Round` is half **away from zero** (`Round(2.5) = 3`, `Round(-2.5) = -3`).
 *    Python's `round` is banker's (2.5 → 2) and JavaScript's `Math.round` is
 *    half **up** (-2.5 → -2). Both get a helper; Go's `math.Round` and Rust's
 *    `f64::round` already agree.
 *  - `Mod` is **floored** — the sign follows the divisor (`Mod(-7,3) = 2`,
 *    `Mod(7,-3) = -2`). Python's `%` agrees; JavaScript, Go and Rust all
 *    truncate, so all three get a helper.
 *  - `Divide` is always real division, so Python emits `/`, never `//`.
 *
 * Getting any of those wrong emits code that is off by one without saying so.
 */
import { identifierMap, type Language } from './identifiers';

export type { Language };

export class UnsupportedOperator extends Error {
  constructor(readonly operator: string) {
    super(`This formula uses ${operator}, which the code generator cannot write yet.`);
    this.name = 'UnsupportedOperator';
  }
}

/**
 * Binding strength, so parentheses are added only where they change meaning.
 * Higher binds tighter. `ATOM` never needs wrapping.
 */
const PREC = { ADD: 1, MUL: 2, UNARY: 3, POWER: 4, ATOM: 5 } as const;
type Prec = (typeof PREC)[keyof typeof PREC];

interface Fragment {
  text: string;
  prec: Prec;
}

const atom = (text: string): Fragment => ({ text, prec: PREC.ATOM });

/** Wrap `f` if it binds more loosely than the context needs. */
function paren(f: Fragment, need: Prec): string {
  return f.prec < need ? `(${f.text})` : f.text;
}

/** Which emitted helpers a language needs for this formula. */
export type Helper = 'round' | 'mod' | 'sum' | 'product' | 'integrate';

interface Dialect {
  /** A one-argument closure over `body`, as that language spells one. */
  lambda(parameter: string, body: string): string;
  /** `x ** y`, `math.Pow(x, y)`, `x.powf(y)` — whatever raises to a power. */
  power(base: Fragment, exponent: Fragment): Fragment;
  /** A plain unary maths call, e.g. `sqrt`. */
  call(name: string, args: string[]): string;
  /** How a numeric literal is written. */
  number(value: number): string;
  /** `Min`/`Max` are variadic in MathJSON but not in every language. */
  minmax(kind: 'min' | 'max', args: string[]): string;
  /** The constants. */
  pi: string;
  e: string;
}

const DIALECTS: Record<Language, Dialect> = {
  python: {
    lambda: (p, body) => `lambda ${p}: ${body}`,
    power: (b, x) => ({ text: `${paren(b, PREC.UNARY)} ** ${paren(x, PREC.UNARY)}`, prec: PREC.POWER }),
    call: (name, args) => `math.${name}(${args.join(', ')})`,
    // A bare integer would make `7 / 2` real anyway in Python 3, but writing
    // `7.0` keeps the emitted formula honest about what the engine computed.
    number: (v) => (Number.isInteger(v) ? `${v}.0` : String(v)),
    minmax: (kind, args) => `${kind}(${args.join(', ')})`,
    pi: 'math.pi',
    e: 'math.e',
  },
  javascript: {
    lambda: (p, body) => `(${p}) => ${body}`,
    power: (b, x) => ({ text: `${paren(b, PREC.UNARY)} ** ${paren(x, PREC.UNARY)}`, prec: PREC.POWER }),
    call: (name, args) => `Math.${name}(${args.join(', ')})`,
    number: (v) => String(v),
    minmax: (kind, args) => `Math.${kind}(${args.join(', ')})`,
    pi: 'Math.PI',
    e: 'Math.E',
  },
  go: {
    lambda: (p, body) => `func(${p} float64) float64 { return ${body} }`,
    // Go has no power operator at all.
    power: (b, x) => atom(`math.Pow(${b.text}, ${x.text})`),
    call: (name, args) => `math.${name[0]!.toUpperCase()}${name.slice(1)}(${args.join(', ')})`,
    number: (v) => (Number.isInteger(v) ? `${v}.0` : String(v)),
    // Go's math.Min/Max take exactly two arguments, so fold.
    minmax: (kind, args) => {
      const fn = kind === 'min' ? 'math.Min' : 'math.Max';
      return args.reduce((left, right) => `${fn}(${left}, ${right})`);
    },
    pi: 'math.Pi',
    e: 'math.E',
  },
  rust: {
    lambda: (p, body) => `|${p}: f64| ${body}`,
    power: (b, x) => atom(`(${b.text} as f64).powf(${x.text})`),
    call: (name, args) => `(${args[0]} as f64).${name}(${args.slice(1).join(', ')})`,
    number: (v) => (Number.isInteger(v) ? `${v}.0` : String(v)),
    minmax: (kind, args) => args.reduce((left, right) => `${left}.${kind}(${right})`),
    pi: 'std::f64::consts::PI',
    e: 'std::f64::consts::E',
  },
};

/** MathJSON trig/transcendental heads -> the per-language method name. */
const UNARY_MATH: Record<string, { python: string; javascript: string; go: string; rust: string }> = {
  Sqrt: { python: 'sqrt', javascript: 'sqrt', go: 'sqrt', rust: 'sqrt' },
  Abs: { python: 'fabs', javascript: 'abs', go: 'abs', rust: 'abs' },
  Exp: { python: 'exp', javascript: 'exp', go: 'exp', rust: 'exp' },
  Ln: { python: 'log', javascript: 'log', go: 'log', rust: 'ln' },
  Floor: { python: 'floor', javascript: 'floor', go: 'floor', rust: 'floor' },
  Ceil: { python: 'ceil', javascript: 'ceil', go: 'ceil', rust: 'ceil' },
  Sin: { python: 'sin', javascript: 'sin', go: 'sin', rust: 'sin' },
  Cos: { python: 'cos', javascript: 'cos', go: 'cos', rust: 'cos' },
  Tan: { python: 'tan', javascript: 'tan', go: 'tan', rust: 'tan' },
  Arcsin: { python: 'asin', javascript: 'asin', go: 'asin', rust: 'asin' },
  Arccos: { python: 'acos', javascript: 'acos', go: 'acos', rust: 'acos' },
  Arctan: { python: 'atan', javascript: 'atan', go: 'atan', rust: 'atan' },
  Sinh: { python: 'sinh', javascript: 'sinh', go: 'sinh', rust: 'sinh' },
  Cosh: { python: 'cosh', javascript: 'cosh', go: 'cosh', rust: 'cosh' },
  Tanh: { python: 'tanh', javascript: 'tanh', go: 'tanh', rust: 'tanh' },
};

/** Every head the emitter handles. The evaluator whitelists the same set. */
export const SUPPORTED_OPERATORS: readonly string[] = [
  'Add', 'Subtract', 'Multiply', 'Divide', 'Rational', 'Negate', 'Power', 'Root',
  'Min', 'Max', 'Mod', 'Round', 'Log', 'Sum', 'Product', 'Integrate',
  ...Object.keys(UNARY_MATH),
];

export interface EmitResult {
  expression: string;
  /** Helpers the emitted expression calls and the file must therefore define. */
  helpers: Set<Helper>;
  /** True when the expression mentions the language's maths library. */
  usesMath: boolean;
}

/** Read a MathJSON number node, whatever shape it arrived in. */
function numberOf(node: unknown): number | null {
  if (typeof node === 'number') return node;
  if (typeof node === 'object' && node !== null && 'num' in node) {
    const parsed = Number((node as { num: unknown }).num);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

/**
 * Emit `json` as an expression in `language`.
 *
 * `names` maps Compute Engine symbols to the identifiers the function's
 * parameter list uses.
 */
export function emitExpression(
  json: unknown,
  language: Language,
  names: ReadonlyMap<string, string>
): EmitResult {
  const d = DIALECTS[language];
  const helpers = new Set<Helper>();
  let usesMath = false;

  const mathCall = (name: string, args: string[]) => {
    usesMath = true;
    return d.call(name, args);
  };

  /**
   * Emit `node`.
   *
   * `scope` is the name map in force here: the outer one for most of a
   * formula, and the outer one plus a bound index inside a sum, product or
   * integral. A bound index is not a field, so it never appears in the
   * caller's map and has to be named on the way in.
   */
  function walk(node: unknown, scope: ReadonlyMap<string, string> = names): Fragment {
    const literal = numberOf(node);
    if (literal !== null) return atom(d.number(literal));

    if (typeof node === 'string') {
      if (node === 'Pi') {
        usesMath = language !== 'javascript' && language !== 'rust';
        return atom(d.pi);
      }
      if (node === 'ExponentialE') {
        usesMath = language !== 'javascript' && language !== 'rust';
        return atom(d.e);
      }
      if (node === 'Nothing') throw new UnsupportedOperator('an empty formula');
      return atom(scope.get(node) ?? node);
    }

    if (!Array.isArray(node) || node.length === 0) {
      throw new UnsupportedOperator('an expression it does not recognise');
    }

    const head = String(node[0]);
    const args = node.slice(1);

    switch (head) {
      case 'Add': {
        const parts = args.map((a) => walk(a, scope)).map((f) => paren(f, PREC.ADD));
        return { text: parts.join(' + '), prec: PREC.ADD };
      }
      case 'Subtract': {
        const [a, b] = args.map((a) => walk(a, scope));
        // The right operand needs MUL strength: `a - (b + c)` is not `a - b + c`.
        return { text: `${paren(a!, PREC.ADD)} - ${paren(b!, PREC.MUL)}`, prec: PREC.ADD };
      }
      case 'Negate': {
        const inner = walk(args[0], scope);
        return { text: `-${paren(inner, PREC.UNARY)}`, prec: PREC.UNARY };
      }
      case 'Multiply': {
        const parts = args.map((a) => walk(a, scope)).map((f) => paren(f, PREC.MUL));
        return { text: parts.join(' * '), prec: PREC.MUL };
      }
      case 'Divide':
      case 'Rational': {
        const [a, b] = args.map((a) => walk(a, scope));
        // A Rational is a literal fraction; emitting `1 / 2` keeps it exact in
        // every language that has real division, which all four do here.
        return { text: `${paren(a!, PREC.MUL)} / ${paren(b!, PREC.UNARY)}`, prec: PREC.MUL };
      }
      case 'Power': {
        // `e^x` and `exp(x)` are the SAME node, so the exponential has to be
        // recognised here or it would be emitted as a power of a constant.
        if (args[0] === 'ExponentialE') return atom(mathCall(UNARY_MATH['Exp']![language], [walk(args[1], scope).text]));
        return d.power(walk(args[0], scope), walk(args[1], scope));
      }
      case 'Root': {
        const index = numberOf(args[1]);
        // A cube root of a negative is -2 to the engine and NaN to every
        // target language's `pow`. Rather than emit that, refuse: an odd root
        // over a possibly-negative value has no portable spelling.
        if (index === null || index % 2 === 0) {
          return d.power(walk(args[0], scope), atom(`1 / ${d.number(index ?? 2)}`));
        }
        throw new UnsupportedOperator(
          `an odd root (index ${index}), which the target languages cannot do over negative values`
        );
      }
      case 'Sqrt':
        return atom(mathCall(UNARY_MATH['Sqrt']![language], [walk(args[0], scope).text]));
      case 'Log': {
        const value = walk(args[0], scope).text;
        if (args.length === 1) {
          // A bare Log is base 10 in MathJSON.
          return atom(
            language === 'rust' ? `(${value} as f64).log10()` : mathCall('log10', [value])
          );
        }
        const base = walk(args[1], scope).text;
        usesMath = true;
        return language === 'rust'
          ? atom(`(${value} as f64).log(${base})`)
          : atom(`${d.call(UNARY_MATH['Ln']![language], [value])} / ${d.call(UNARY_MATH['Ln']![language], [base])}`);
      }
      case 'Min':
      case 'Max': {
        const kind = head.toLowerCase() as 'min' | 'max';
        if (language === 'go') usesMath = true;
        if (language === 'javascript') usesMath = false;
        return atom(d.minmax(kind, args.map((a) => walk(a, scope).text)));
      }
      case 'Mod': {
        // Floored, following the engine. Only Python's `%` already agrees.
        const [a, b] = args.map((a) => walk(a, scope));
        if (language === 'python') return { text: `${paren(a!, PREC.MUL)} % ${paren(b!, PREC.UNARY)}`, prec: PREC.MUL };
        helpers.add('mod');
        return atom(`_mod(${a!.text}, ${b!.text})`);
      }
      case 'Round': {
        const value = walk(args[0], scope).text;
        const digits = args.length > 1 ? walk(args[1], scope).text : null;
        if (language === 'go' || language === 'rust') {
          if (digits === null) {
            usesMath = language === 'go';
            return atom(language === 'go' ? `math.Round(${value})` : `(${value} as f64).round()`);
          }
          helpers.add('round');
          return atom(`_round(${value}, ${digits})`);
        }
        // Python rounds to even and JavaScript rounds half up; the engine
        // rounds half away from zero. Neither can be spelled inline.
        helpers.add('round');
        return atom(`_round(${value}, ${digits ?? '0'})`);
      }
      case 'Sum':
      case 'Product':
      case 'Integrate': {
        const helper = head === 'Sum' ? 'sum' : head === 'Product' ? 'product' : 'integrate';
        // `["Limits", index, lower, upper]`. Without it there is no range to
        // walk, and an indefinite sum has no value to compute.
        const limits = args[1];
        if (!Array.isArray(limits) || limits[0] !== 'Limits' || limits.length < 4) {
          throw new UnsupportedOperator(`${head} without bounds`);
        }
        const indexSymbol = String(limits[1]);
        // An integral's body sometimes arrives wrapped: `\int x^2 dx` parses
        // to `["Function", ["Block", body], "x"]` while `\int x \, dx` gives
        // the bare body. Both shapes reach here.
        let body = args[0];
        if (Array.isArray(body) && body[0] === 'Function') {
          const inner = body[1];
          body = Array.isArray(inner) && inner[0] === 'Block' ? inner[1] : inner;
        }
        // Name the index through the same machinery as everything else, with
        // the outer names in play so it cannot collide with a parameter.
        const indexName = identifierMap([...scope.keys(), indexSymbol], language).get(indexSymbol)!;
        const inner = new Map(scope);
        inner.set(indexSymbol, indexName);

        const lower = walk(limits[2], scope).text;
        const upper = walk(limits[3], scope).text;
        const term = d.lambda(indexName, walk(body, inner).text);
        helpers.add(helper);
        // Go's helpers round their bounds with math.Round.
        if (language === 'go') usesMath = true;
        return atom(`_${helper}(${lower}, ${upper}, ${term})`);
      }

      default: {
        const unary = UNARY_MATH[head];
        if (unary && args.length === 1) return atom(mathCall(unary[language], [walk(args[0], scope).text]));
        throw new UnsupportedOperator(head);
      }
    }
  }

  const fragment = walk(json);
  return { expression: fragment.text, helpers, usesMath };
}

/** Build the symbol → identifier map an emit needs. */
export const namesFor = identifierMap;
