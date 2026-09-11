/**
 * The Compute Engine, wrapped in the few operations this tool actually needs.
 *
 * Two things here were established by probing the real library rather than
 * reading its types, and both are load-bearing:
 *
 * 1. **Evaluation substitutes; it does not assign.** `ce.parse()` declares a
 *    formula's unknowns in the GLOBAL scope, so `ce.assign()` inside a pushed
 *    scope mutates that global binding and `popScope()` does not undo it.
 *    Measured: evaluating `x/y` at 7 and 2, then at 10 and 5, then with NO
 *    values at all returned 3.5, 2, and 2 — the last being the previous
 *    answer, with the formula's `unknowns` now empty. `expr.subs()` has none
 *    of that, leaves the parsed expression untouched, and costs 7 microseconds.
 *
 * 2. **A numeric-looking result can be complex or infinite.** `sqrt(-4)`
 *    reports `re === 0`, so reading `.re` alone would show **0** for the square
 *    root of a negative. A result is only usable when it is a real, finite,
 *    non-NaN literal.
 *
 * `expr.compile()` does not exist in this version, so there is no
 * code-generating path to avoid; the whole evaluation route runs clean under
 * `node --disallow-code-generation-from-strings`.
 */
import type { NapkinField } from '../db/types';

/** The bits of a boxed expression this module uses. */
export interface Boxed {
  json: unknown;
  latex: string;
  isValid: boolean;
  unknowns: string[];
  operator: string;
  ops: Boxed[] | null;
  subs(bindings: Record<string, unknown>): Boxed;
  N(): Boxed;
  isNumberLiteral: boolean;
  isReal: boolean | undefined;
  isFinite: boolean | undefined;
  isNaN: boolean | undefined;
  re: number;
  /** Imaginary part; 0 for a real number. */
  im: number;
  toString(): string;
}

interface Engine {
  parse(latex: string, options?: { canonical?: boolean }): Boxed;
  box(json: unknown, options?: { canonical?: boolean }): Boxed;
  number(value: number): unknown;
}

/**
 * Parse and box WITHOUT canonicalising.
 *
 * Everything else here wants the canonical form, because that is what
 * evaluates. The image export wants the opposite: a tree shaped the way the
 * author wrote it, so that substituting values into it produces the formula
 * they recognise rather than the engine's preferred spelling of it.
 *
 * The difference is not cosmetic. Canonically, `a - b` is
 * `["Add", "a", ["Negate", "b"]]`, so putting b = −7 in renders `5 + 7`;
 * raw, it stays `["Subtract", "a", "b"]` and renders `5 - (-7)`. Likewise
 * `1 + rate` is reordered to `rate + 1` on the way in, and
 * `costPerMonth × 12 × years` becomes `12 × costPerMonth × years`.
 */
export async function parseRaw(latex: string): Promise<Boxed> {
  const ce = await loadEngine();
  return ce.parse(latex, { canonical: false });
}

export async function boxRaw(json: unknown): Promise<Boxed> {
  const ce = await loadEngine();
  return ce.box(json, { canonical: false });
}

let enginePromise: Promise<Engine> | null = null;

/**
 * Load the Compute Engine once.
 *
 * Importing it also registers it on a global that MathLive looks up, which is
 * what makes `getValue('math-json')` return real MathJSON instead of an empty
 * expression — the library bundles no import of its own.
 */
export function loadEngine(): Promise<Engine> {
  if (!enginePromise) {
    enginePromise = import('@cortex-js/compute-engine')
      .then((module) => new module.ComputeEngine() as unknown as Engine)
      // Never cache a rejection: one failed chunk would poison the page.
      .catch((err) => {
        enginePromise = null;
        throw err;
      });
  }
  return enginePromise;
}

export interface ParsedFormula {
  /** Boxed, so a caller can evaluate it repeatedly without re-parsing. */
  expr: Boxed;
  json: unknown;
  /** Free variables, in a stable order. Excludes constants and bound indices. */
  variables: string[];
  error: string | null;
}

/** An empty formula is *valid* and boxes to `Nothing` — that is "not yet". */
const isNothing = (json: unknown) => json === 'Nothing' || json === undefined;

/**
 * Parse a formula and report its inputs.
 *
 * Variables come from `expr.unknowns`, not from walking the tree, because the
 * engine already knows which symbols are genuinely free: `\sum_{i=1}^{n} i`
 * reports `n` and not `i`, and `\pi r^2` reports `r` and not π. A naive walker
 * reports both and asks the user to supply a value for pi.
 */
export async function parseFormula(latex: string): Promise<ParsedFormula> {
  const ce = await loadEngine();
  const trimmed = latex.trim();
  if (!trimmed) {
    const empty = ce.box('Nothing');
    return { expr: empty, json: null, variables: [], error: null };
  }

  let expr = ce.parse(trimmed);
  // A formula written as an equation — `total = qty × unit` — is the natural
  // way to name a result, so take the right-hand side rather than refusing.
  if (expr.operator === 'Equal' && expr.ops?.length === 2) expr = expr.ops[1]!;

  if (!expr.isValid) {
    return { expr, json: expr.json, variables: [], error: 'That formula does not parse.' };
  }
  if (isNothing(expr.json)) {
    return { expr, json: null, variables: [], error: null };
  }
  return { expr, json: expr.json, variables: [...expr.unknowns].sort(), error: null };
}

export interface EvaluationResult {
  value: number | null;
  /** Set when there is no usable number, saying why. */
  error: string | null;
}

/**
 * Evaluate a parsed formula at the given values.
 *
 * Returns `value: null` with an explanation rather than a number whenever the
 * answer is not a real finite quantity — a complex result reports its real
 * part, which for `sqrt(-4)` is a very convincing `0`.
 */
export async function evaluateFormula(
  expr: Boxed,
  values: Readonly<Record<string, number | null>>
): Promise<EvaluationResult> {
  const ce = await loadEngine();
  const bindings: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(values)) {
    if (value === null || Number.isNaN(value)) continue;
    bindings[name] = ce.number(value);
  }

  let out: Boxed;
  try {
    out = expr.subs(bindings).N();
  } catch (err) {
    return { value: null, error: err instanceof Error ? err.message : 'That did not evaluate.' };
  }

  if (!out.isNumberLiteral) return { value: null, error: 'Fill in every input to see a result.' };
  if (out.isNaN === true) return { value: null, error: 'That is not a number (0 ÷ 0, or similar).' };
  // Compute Engine 0.128 leaves `isReal` undefined on a plain numeric literal,
  // so the question is asked of the imaginary part directly.
  if (out.isReal === false || (out.im ?? 0) !== 0)
    return { value: null, error: 'That answer is not a real number.' };
  if (out.isFinite !== true) return { value: null, error: 'That answer is infinite.' };
  if (!Number.isFinite(out.re)) return { value: null, error: 'That answer is infinite.' };
  return { value: out.re, error: null };
}

/** Round-trip a stored MathJSON formula back into something evaluable. */
export async function boxJson(json: unknown): Promise<Boxed> {
  const ce = await loadEngine();
  return ce.box(json);
}

/** Every field's value as a number, or null where the input is unusable. */
export function readValues(
  fields: readonly NapkinField[],
  raw: Readonly<Record<string, string>>
): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const field of fields) {
    const text = (raw[field.name] ?? '').trim();
    if (!text) {
      out[field.name] = null;
      continue;
    }
    const parsed = Number(text);
    out[field.name] = Number.isNaN(parsed) ? null : parsed;
  }
  return out;
}
