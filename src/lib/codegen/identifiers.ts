/**
 * Turning a formula's symbol names into legal identifiers, per language.
 *
 * A Compute Engine symbol can be anything the LaTeX allowed: `a_b`, `Δcost`,
 * `n1`. A generated function's parameters cannot. The rules here are shared by
 * every emitter so one template produces the same parameter names in all four
 * languages, and collisions are resolved the same way.
 */

export type Language = 'python' | 'javascript' | 'go' | 'rust';

/** Words that cannot be a parameter name, per language. */
const RESERVED: Record<Language, ReadonlySet<string>> = {
  python: new Set([
    'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class',
    'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global',
    'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return',
    'try', 'while', 'with', 'yield', 'match', 'case', 'math',
  ]),
  javascript: new Set([
    'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
    'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'function',
    'if', 'import', 'in', 'instanceof', 'let', 'new', 'null', 'return', 'super', 'switch',
    'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield',
    'Math', 'NaN', 'Infinity',
  ]),
  go: new Set([
    'break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else', 'fallthrough',
    'for', 'func', 'go', 'goto', 'if', 'import', 'interface', 'map', 'package', 'range',
    'return', 'select', 'struct', 'switch', 'type', 'var', 'math', 'len', 'cap', 'make', 'new',
  ]),
  rust: new Set([
    'as', 'async', 'await', 'break', 'const', 'continue', 'crate', 'dyn', 'else', 'enum',
    'extern', 'false', 'fn', 'for', 'if', 'impl', 'in', 'let', 'loop', 'match', 'mod', 'move',
    'mut', 'pub', 'ref', 'return', 'self', 'Self', 'static', 'struct', 'super', 'trait',
    'true', 'type', 'unsafe', 'use', 'where', 'while', 'abstract', 'become', 'box', 'do',
    'final', 'macro', 'override', 'priv', 'typeof', 'unsized', 'virtual', 'yield',
  ]),
};

/**
 * Strip a symbol down to ASCII letters, digits and underscores.
 *
 * Anything else becomes `_`, because a parameter list is not the place to
 * discover that a language disagrees about identifier characters. A name that
 * reduces to nothing, or that starts with a digit, gets a `v` in front.
 */
function baseName(symbol: string): string {
  let cleaned = symbol.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  if (!cleaned) cleaned = 'v';
  if (/^[0-9]/.test(cleaned)) cleaned = `v${cleaned}`;
  return cleaned;
}

/** `costPerUnit` -> `cost_per_unit`, for the snake_case languages. */
const toSnake = (name: string): string =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/__+/g, '_')
    .toLowerCase();

/**
 * `cost_per_unit` and `costPerUnit` both become `costPerUnit`.
 *
 * Going through snake_case first is what makes the second case work: splitting
 * a name on underscores alone leaves `costPerMonth` as one part, and
 * lowercasing that part gives `costpermonth` — a name nobody typed.
 */
const toCamel = (name: string): string => {
  const parts = toSnake(name).split('_').filter(Boolean);
  if (parts.length === 0) return 'v';
  return parts[0]! + parts.slice(1).map((p) => p[0]!.toUpperCase() + p.slice(1)).join('');
};

/**
 * Go and JavaScript both write identifiers in camelCase; Python and Rust use
 * snake_case. `gofmt` will not fix a snake_case name, and every Go linter
 * flags one, so this is not cosmetic.
 */
const styled = (name: string, language: Language): string =>
  language === 'javascript' || language === 'go' ? toCamel(name) : toSnake(name);

/**
 * Map every symbol to a legal, distinct identifier.
 *
 * Collisions are resolved by suffixing `_2`, `_3`, … in the symbols' own
 * order, so the mapping is deterministic: two different symbols that clean to
 * the same word (`a-b` and `a_b`) always resolve the same way, and the first
 * one keeps the plain name.
 */
export function identifierMap(symbols: readonly string[], language: Language): Map<string, string> {
  const reserved = RESERVED[language];
  const used = new Set<string>();
  const out = new Map<string, string>();
  for (const symbol of symbols) {
    let candidate = styled(baseName(symbol), language);
    if (reserved.has(candidate)) candidate = `${candidate}_`;
    if (used.has(candidate)) {
      let n = 2;
      while (used.has(`${candidate}_${n}`)) n++;
      candidate = `${candidate}_${n}`;
    }
    used.add(candidate);
    out.set(symbol, candidate);
  }
  return out;
}

/** A template name as a function name. */
export function functionName(name: string, language: Language): string {
  const base = baseName(name.trim() || 'calculate');
  const styledName = styled(base, language);
  const reserved = RESERVED[language];
  const safe = reserved.has(styledName) ? `${styledName}_` : styledName;
  // Go marks an export with a leading capital, and a generated function is
  // meant to be called from wherever it is pasted.
  if (language === 'go') return safe.charAt(0).toUpperCase() + safe.slice(1);
  return safe;
}
