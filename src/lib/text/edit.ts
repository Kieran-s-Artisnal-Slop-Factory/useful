/**
 * String similarity — the algorithm family from
 * [speyl](https://github.com/Descent098/speyl) (MIT), ported to TypeScript and
 * extended with the working-out each one needs in order to be explained.
 *
 * Five measures, and they disagree on purpose:
 *
 * - **Levenshtein** — insert, delete, substitute. The default answer to "how
 *   far apart are these two strings".
 * - **Damerau-Levenshtein** — Levenshtein plus swapping two ADJACENT
 *   characters as one edit, which is what a typo usually is. This is the
 *   *optimal string alignment* variant (see the note on the function).
 * - **Indel** — insert and delete only, no substitutions. Equivalent to the
 *   longest common subsequence, and the one that answers "how much of this is
 *   shared" rather than "how many keystrokes apart is it".
 * - **Jaro** — matched characters within a sliding window, discounted by
 *   transpositions. Built for short strings like names, and by far the fastest
 *   of the five.
 * - **Jaro-Winkler** — Jaro, weighted towards strings that agree at the start,
 *   because people mistype the ends of words more often than the beginnings.
 *
 * Everything works on GRAPHEMES, not UTF-16 units, so an accented letter or an
 * emoji is one character to these algorithms as it is to a reader.
 *
 * Every function is pure, and each one can also hand back the table or the
 * pairing it used — that is what the page's visualizer draws.
 */
import { graphemes } from './tokenize';

export type Algorithm = 'levenshtein' | 'damerau' | 'indel' | 'jaro' | 'jaro-winkler';

export interface AlgorithmDef {
  id: Algorithm;
  name: string;
  /** One line, shown under the name. */
  summary: string;
  /** True when the raw result is a distance in edits rather than a 0-1 score. */
  distance: boolean;
}

export const ALGORITHMS: AlgorithmDef[] = [
  {
    id: 'jaro',
    name: 'Jaro',
    summary: 'Matched characters inside a window, discounted by transpositions. The fast one.',
    distance: false,
  },
  {
    id: 'jaro-winkler',
    name: 'Jaro-Winkler',
    summary: 'Jaro, weighted towards strings that agree at the start.',
    distance: false,
  },
  {
    id: 'levenshtein',
    name: 'Levenshtein',
    summary: 'Insertions, deletions and substitutions — the usual edit distance.',
    distance: true,
  },
  {
    id: 'damerau',
    name: 'Damerau-Levenshtein',
    summary: 'Levenshtein plus one edit for swapping two adjacent characters.',
    distance: true,
  },
  {
    id: 'indel',
    name: 'Indel',
    summary: 'Insertions and deletions only — how much of the two strings is shared.',
    distance: true,
  },
];

/* ------------------------------------------------------------- the table --- */

export type MatrixOp = 'match' | 'substitute' | 'insert' | 'delete' | 'transpose';

export interface MatrixStep {
  /** Row (index into `a`) and column (index into `b`) AFTER the step. */
  i: number;
  j: number;
  op: MatrixOp;
  cost: number;
}

export interface Matrix {
  a: string[];
  b: string[];
  /** `(a.length + 1) × (b.length + 1)` costs. `rows[i]![j]` is the distance
   * between the first i of `a` and the first j of `b`. */
  rows: number[][];
  /** The cheapest route from (0,0) to the bottom-right corner. */
  path: MatrixStep[];
  distance: number;
}

interface TableOptions {
  /** Allow the adjacent-swap edit (Damerau). */
  transpose?: boolean;
  /** Forbid substitution, making every change an insert plus a delete (Indel). */
  indel?: boolean;
}

/**
 * The dynamic-programming table for the three distance metrics, plus the
 * traceback. One function rather than three, because the three differ only in
 * which moves are legal — and seeing that in one place is most of the lesson.
 */
export function matrix(left: string, right: string, options: TableOptions = {}): Matrix {
  const a = graphemes(left);
  const b = graphemes(right);
  const substitutionCost = options.indel ? 2 : 1;
  const rows: number[][] = [];
  for (let i = 0; i <= a.length; i += 1) {
    const row = new Array<number>(b.length + 1).fill(0);
    row[0] = i;
    rows.push(row);
  }
  for (let j = 0; j <= b.length; j += 1) rows[0]![j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const same = a[i - 1] === b[j - 1];
      let best = Math.min(
        rows[i - 1]![j]! + 1, // delete a[i-1]
        rows[i]![j - 1]! + 1, // insert b[j-1]
        rows[i - 1]![j - 1]! + (same ? 0 : substitutionCost)
      );
      if (
        options.transpose &&
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        best = Math.min(best, rows[i - 2]![j - 2]! + 1);
      }
      rows[i]![j] = best;
    }
  }

  return { a, b, rows, path: traceback(a, b, rows, options), distance: rows[a.length]![b.length]! };
}

/** Walk back from the corner, preferring the move that produced the cost. */
function traceback(a: string[], b: string[], rows: number[][], options: TableOptions): MatrixStep[] {
  const steps: MatrixStep[] = [];
  const substitutionCost = options.indel ? 2 : 1;
  let i = a.length;
  let j = b.length;
  while (i > 0 || j > 0) {
    const here = rows[i]![j]!;
    if (
      options.transpose &&
      i > 1 &&
      j > 1 &&
      a[i - 1] === b[j - 2] &&
      a[i - 2] === b[j - 1] &&
      here === rows[i - 2]![j - 2]! + 1
    ) {
      steps.push({ i, j, op: 'transpose', cost: 1 });
      i -= 2;
      j -= 2;
      continue;
    }
    if (i > 0 && j > 0) {
      const same = a[i - 1] === b[j - 1];
      const diagonal = rows[i - 1]![j - 1]!;
      if (same && here === diagonal) {
        steps.push({ i, j, op: 'match', cost: 0 });
        i -= 1;
        j -= 1;
        continue;
      }
      if (!same && !options.indel && here === diagonal + substitutionCost) {
        steps.push({ i, j, op: 'substitute', cost: 1 });
        i -= 1;
        j -= 1;
        continue;
      }
    }
    if (i > 0 && here === rows[i - 1]![j]! + 1) {
      steps.push({ i, j, op: 'delete', cost: 1 });
      i -= 1;
      continue;
    }
    if (j > 0 && here === rows[i]![j - 1]! + 1) {
      steps.push({ i, j, op: 'insert', cost: 1 });
      j -= 1;
      continue;
    }
    // Unreachable for a well-formed table; bail rather than spin.
    break;
  }
  return steps.reverse();
}

/* ------------------------------------------------------------- distances --- */

/** Insertions, deletions and substitutions. */
export function levenshtein(a: string, b: string): number {
  return matrix(a, b).distance;
}

/**
 * Levenshtein plus adjacent transposition — the *optimal string alignment*
 * variant, which is what almost every library means by "Damerau".
 *
 * The difference from unrestricted Damerau-Levenshtein matters and is worth
 * knowing: OSA never edits a substring more than once, so `CA` → `ABC` costs 3
 * here (and 2 unrestricted, by transposing then inserting). OSA is what a
 * spell-checker wants and what fits in one readable table.
 */
export function damerau(a: string, b: string): number {
  return matrix(a, b, { transpose: true }).distance;
}

/**
 * Insertions and deletions only. Substitution costs two, which is exactly what
 * it is when you cannot substitute: a delete and an insert.
 */
export function indel(a: string, b: string): number {
  return matrix(a, b, { indel: true }).distance;
}

/** The longest common subsequence length, which Indel is the other side of. */
export function lcsLength(a: string, b: string): number {
  const x = graphemes(a).length;
  const y = graphemes(b).length;
  return (x + y - indel(a, b)) / 2;
}

/* ------------------------------------------------------------------ jaro --- */

export interface JaroDetail {
  a: string[];
  b: string[];
  /** How far apart two characters may be and still count as matching. */
  window: number;
  /** Per character of `a` / `b`: did it find a partner? */
  matchedA: boolean[];
  matchedB: boolean[];
  /** Index in `b` each matched character of `a` was paired with, else -1. */
  pairing: number[];
  matches: number;
  /** Matched pairs that came out in a different order — counted in halves. */
  transpositions: number;
  jaro: number;
  /** Shared leading characters counted for Winkler, capped at 4. */
  prefix: number;
  jaroWinkler: number;
}

/**
 * Jaro and Jaro-Winkler, with everything the formula used.
 *
 * The window is `floor(max(|a|, |b|) / 2) - 1`: two characters count as the
 * same only if they are at most that far apart. Transpositions are matched
 * pairs that appear in a different order, counted in halves. Winkler then adds
 * `p × prefix × (1 - jaro)` with `p = 0.1` and the prefix capped at 4.
 */
export function jaroDetail(left: string, right: string, p = 0.1, maxPrefix = 4): JaroDetail {
  const a = graphemes(left);
  const b = graphemes(right);
  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const matchedA = new Array<boolean>(a.length).fill(false);
  const matchedB = new Array<boolean>(b.length).fill(false);
  const pairing = new Array<number>(a.length).fill(-1);

  let matches = 0;
  for (let i = 0; i < a.length; i += 1) {
    const from = Math.max(0, i - window);
    const to = Math.min(b.length - 1, i + window);
    for (let j = from; j <= to; j += 1) {
      if (matchedB[j] || a[i] !== b[j]) continue;
      matchedA[i] = true;
      matchedB[j] = true;
      pairing[i] = j;
      matches += 1;
      break;
    }
  }

  let transpositions = 0;
  if (matches > 0) {
    const orderA = pairing.filter((j) => j >= 0);
    const orderB: number[] = [];
    for (let j = 0; j < b.length; j += 1) if (matchedB[j]) orderB.push(j);
    for (let k = 0; k < orderA.length; k += 1) if (orderA[k] !== orderB[k]) transpositions += 1;
    transpositions /= 2;
  }

  const jaro =
    matches === 0
      ? 0
      : (matches / a.length + matches / b.length + (matches - transpositions) / matches) / 3;

  let prefix = 0;
  const limit = Math.min(maxPrefix, a.length, b.length);
  while (prefix < limit && a[prefix] === b[prefix]) prefix += 1;

  return {
    a,
    b,
    window,
    matchedA,
    matchedB,
    pairing,
    matches,
    transpositions,
    jaro,
    prefix,
    jaroWinkler: jaro + prefix * p * (1 - jaro),
  };
}

export function jaro(a: string, b: string): number {
  if (a === b) return 1;
  return jaroDetail(a, b).jaro;
}

export function jaroWinkler(a: string, b: string, p = 0.1): number {
  if (a === b) return 1;
  return jaroDetail(a, b, p).jaroWinkler;
}

/* ------------------------------------------------------------ comparison --- */

export interface Score {
  algorithm: Algorithm;
  /** Edits for the distance metrics, 0-1 for Jaro and Jaro-Winkler. */
  raw: number;
  /** 0-1 for every algorithm, so a table can be sorted across them. */
  similarity: number;
}

/**
 * A distance turned into a 0-1 score.
 *
 * Levenshtein and Damerau divide by the longer string, because that is the
 * most edits either could need. Indel divides by the two lengths added
 * together, because that is its own worst case: delete everything, insert
 * everything.
 */
export function normalize(algorithm: Algorithm, distance: number, a: string, b: string): number {
  const x = graphemes(a).length;
  const y = graphemes(b).length;
  if (x === 0 && y === 0) return 1;
  if (algorithm === 'indel') return 1 - distance / (x + y);
  return 1 - distance / Math.max(x, y);
}

export function score(algorithm: Algorithm, a: string, b: string): Score {
  if (algorithm === 'jaro') return { algorithm, raw: jaro(a, b), similarity: jaro(a, b) };
  if (algorithm === 'jaro-winkler') {
    const value = jaroWinkler(a, b);
    return { algorithm, raw: value, similarity: value };
  }
  const distance =
    algorithm === 'levenshtein' ? levenshtein(a, b) : algorithm === 'damerau' ? damerau(a, b) : indel(a, b);
  return { algorithm, raw: distance, similarity: normalize(algorithm, distance, a, b) };
}

export interface Comparison {
  word: string;
  scores: Record<Algorithm, Score>;
}

/** Every algorithm against every candidate — what the results table renders. */
export function compare(word: string, candidates: readonly string[]): Comparison[] {
  return candidates.map((candidate) => {
    const scores = {} as Record<Algorithm, Score>;
    for (const def of ALGORITHMS) scores[def.id] = score(def.id, word, candidate);
    return { word: candidate, scores };
  });
}

/**
 * speyl's `SuggestWord`: the closest candidate and how confident that is.
 * Ties are broken by the earlier candidate, so the result is deterministic.
 */
export function suggest(
  word: string,
  candidates: readonly string[],
  algorithm: Algorithm = 'jaro'
): { word: string; likelihood: number } | null {
  let best: { word: string; likelihood: number } | null = null;
  for (const candidate of candidates) {
    const { similarity } = score(algorithm, word, candidate);
    if (!best || similarity > best.likelihood) best = { word: candidate, likelihood: similarity };
  }
  return best;
}
