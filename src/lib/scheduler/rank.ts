/**
 * Fractional ordering keys for kanban drag-reorder: lexicographic strings
 * over 'a'..'z' with a midpoint operation, so moving ONE card writes ONE row
 * — the oracle's isolated-delta checks depend on that.
 */
const MIN = 'a'.charCodeAt(0); // 97
const MAX = 'z'.charCodeAt(0); // 122

/**
 * A key strictly between `a` and `b` (null = open end). Both null yields the
 * midpoint of the whole space. Callers must pass a < b when both are given.
 */
export function rankBetween(a: string | null, b: string | null): string {
  const lo = a ?? '';
  const hi = b ?? '';
  if (hi !== '' && lo >= hi) throw new Error(`rankBetween: '${lo}' is not below '${hi}'`);
  let result = '';
  for (let i = 0; ; i++) {
    const ca = i < lo.length ? lo.charCodeAt(i) : MIN - 1; // virtual -infinity digit
    const cb = i < hi.length ? hi.charCodeAt(i) : MAX + 1; // virtual +infinity digit
    if (ca === cb) {
      result += lo[i];
      continue;
    }
    const mid = Math.floor((ca + cb) / 2);
    // Never RETURN a key ending in 'a': nothing sorts between '' and 'a', so
    // such a key would be a dead end for later insert-before operations.
    if (mid > ca && mid > MIN) return result + String.fromCharCode(mid);
    // Adjacent digits: keep the low digit and find room one position deeper.
    result += i < lo.length ? lo[i] : 'a';
  }
}

/** First key for an empty column. */
export function initialRank(): string {
  return rankBetween(null, null);
}

/** A key after the current last one. */
export function rankAfter(last: string | null): string {
  return rankBetween(last, null);
}
