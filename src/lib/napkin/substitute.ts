/**
 * "The formula, with your numbers in it" — the middle row of the image export
 * (0.5.0 plan Phase 3, decision 7).
 *
 * The obvious two implementations are both wrong, and it is worth saying why
 * because both look right until you try them:
 *
 * 1. **String replacement on the LaTeX.** Replacing `rate` with `0.05` also
 *    hits the `rate` inside `\text{separate}`, and replacing `x` hits the `x`
 *    in `\max`. A formula is a tree, not a string.
 * 2. **`expr.subs(values)`, which the evaluator already uses.** It does not
 *    substitute — it *partially evaluates*. Measured against the real library:
 *    `sqrt(x² + y²)` at 3 and 4 comes back as `5`, and
 *    `costPerMonth × 12 × years` at 25 and 3 comes back as `900`. Those are
 *    answers, and the answer is the row underneath.
 *
 * So this walks the MathJSON tree and swaps symbol nodes for number nodes,
 * then renders the tree back to LaTeX. Both the parse and the render are
 * NON-CANONICAL (`parseRaw` / `boxRaw`), because canonicalising rewrites the
 * author's formula on the way in: `a - b` becomes `a + (-b)`, so a negative
 * value renders as `5 + 7` where the honest reading is `5 - (-7)`.
 *
 * When the result cannot be trusted the row is REFUSED rather than shown.
 * A picture captioned "your calculation" that quietly contains
 * `\operatorname{__unit__}` is worse than one row shorter.
 */
import { boxRaw, parseRaw } from './engine';

export type SubstitutionResult =
  | { ok: true; latex: string; replaced: string[] }
  | { ok: false; reason: string };

/**
 * Markers that mean the engine did not understand something. `\error` and
 * `\mathtip` are how it renders a node it could not interpret; `__unit__` is
 * an internal head that leaks out of a non-canonical parse of certain
 * single-letter `\mathrm{}` forms.
 */
const BROKEN = [/\\error/, /\\mathtip/, /__unit__/, /\\operatorname\{\\_\\_/];

/**
 * A single letter wrapped in `\mathrm{}` parses as a DIFFERENT symbol —
 * `\mathrm{x}` is `x_upright`, not `x`. The editor never emits that (its rule
 * needs two or more letters), but an imported formula can carry it, so both
 * spellings are accepted for the same field name.
 */
const aliases = (name: string): string[] => [name, `${name}_upright`];

/**
 * Replace free symbols with numbers throughout a MathJSON tree.
 *
 * Pure and exported so the tree walk is testable without loading a 2.5 MB
 * engine: MathJSON is plain JSON, and every shape it can take is covered here
 * — a bare string symbol, the `{sym}` long form, a function application as an
 * array, and the `{fn}` long form.
 */
export function substituteJson(
  node: unknown,
  values: Readonly<Record<string, number>>,
  replaced: Set<string> = new Set()
): unknown {
  const lookup = (name: string): number | undefined => {
    for (const key of Object.keys(values)) {
      if (aliases(key).includes(name)) {
        replaced.add(key);
        return values[key];
      }
    }
    return undefined;
  };

  if (typeof node === 'string') {
    const hit = lookup(node);
    return hit === undefined ? node : hit;
  }
  if (Array.isArray(node)) {
    // Element 0 is the operator head and is never a variable.
    const [head, ...rest] = node;
    return [head, ...rest.map((child) => substituteJson(child, values, replaced))];
  }
  if (node !== null && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    if (typeof obj.sym === 'string') {
      const hit = lookup(obj.sym);
      if (hit !== undefined) return hit;
    }
    if ('fn' in obj) return { ...obj, fn: substituteJson(obj.fn, values, replaced) };
  }
  return node;
}

/** The values worth substituting: every field that holds a real number. */
export function usableValues(
  values: Readonly<Record<string, number | null>>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, value] of Object.entries(values)) {
    if (value !== null && Number.isFinite(value)) out[name] = value;
  }
  return out;
}

/**
 * `latex` with every named value put in its place, or a reason it could not
 * be done. Needs the Compute Engine, so it is async and lazy like everything
 * else on this page.
 */
export async function substitutedLatex(
  latex: string,
  values: Readonly<Record<string, number | null>>
): Promise<SubstitutionResult> {
  const trimmed = latex.trim();
  if (!trimmed) return { ok: false, reason: 'There is no formula to substitute into.' };

  const usable = usableValues(values);
  if (Object.keys(usable).length === 0) {
    return { ok: false, reason: 'No inputs have values yet, so there is nothing to substitute.' };
  }

  let out: string;
  const replaced = new Set<string>();
  try {
    const parsed = await parseRaw(trimmed);
    out = (await boxRaw(substituteJson(parsed.json, usable, replaced))).latex;
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : 'That formula could not be re-rendered.',
    };
  }

  if (!out || BROKEN.some((pattern) => pattern.test(out))) {
    return {
      ok: false,
      reason: 'This formula does not survive having its values written into it — the engine could not render the result.',
    };
  }
  if (replaced.size === 0) {
    return { ok: false, reason: 'None of the named inputs appear in the formula.' };
  }
  return { ok: true, latex: out, replaced: [...replaced].sort() };
}
