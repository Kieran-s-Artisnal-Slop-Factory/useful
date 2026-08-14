/**
 * Tiny fuzzy matcher for the quick-action palette. Subsequence matching with
 * a score that rewards what people actually mean when they type fragments:
 * matches at the start, matches on word boundaries, and consecutive runs.
 * Pure and dependency-free so it can be unit-tested directly.
 */

/** True when every character of `query` appears in order inside `text`. */
export function isSubsequence(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

const WORD_SEPARATORS = new Set([' ', '-', '_', '/', '.', ':']);

/**
 * Score `query` against `text`. Higher is better; null means no match.
 * An empty query matches everything with score 0.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return 0;
  const t = text.toLowerCase();
  if (q.length > t.length) return null;

  let score = 0;
  let qi = 0;
  let lastMatch = -2; // -2 so index 0 never counts as "consecutive"
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue;
    if (ti === 0) score += 8; // start of the string
    else if (WORD_SEPARATORS.has(t[ti - 1]!)) score += 6; // start of a word
    if (ti === lastMatch + 1) score += 4; // consecutive run
    score += 1;
    lastMatch = ti;
    qi++;
  }
  if (qi < q.length) return null;
  // Prefer tight matches in short strings: penalize how spread out the match
  // is and how much text is left over, but never below a positive floor so a
  // real match always beats no match.
  const spread = lastMatch - (q.length - 1);
  score -= Math.min(spread, 10) * 0.5;
  score -= Math.min(t.length - q.length, 20) * 0.1;
  return Math.max(score, 0.1);
}
