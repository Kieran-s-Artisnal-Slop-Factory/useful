/**
 * Myers diff — the shortest edit script between two token arrays.
 *
 * Eugene Myers, "An O(ND) Difference Algorithm and Its Variations" (1986): the
 * one every diff tool uses, because its cost is proportional to the SIZE OF
 * THE DIFFERENCE rather than to the size of the inputs. Two thousand-line
 * files with one changed line cost about a thousand steps, not a million.
 *
 * The tokens are whatever the caller wants compared — lines, words, or
 * graphemes — so this module knows nothing about text. Comparison goes through
 * a `key` function, which is how "ignore case" and "ignore whitespace" work
 * without the display ever losing the original characters: the keys decide
 * what is equal, the tokens are what gets shown.
 *
 * The one deliberate limit is `maxCost`. The algorithm is O(ND) where D is the
 * number of edits, so two large and wholly unrelated inputs can cost
 * quadratic time. Rather than freeze the tab, the diff gives up past the
 * budget and reports one wholesale replacement — and says it did, so nobody
 * mistakes the fallback for the real answer.
 *
 * Pure module: no DOM, no state, no I/O.
 */

export type ChangeType = 'equal' | 'insert' | 'delete';

export interface Change<T> {
  type: ChangeType;
  /** The tokens themselves — from `a` for equal/delete, from `b` for insert. */
  tokens: T[];
}

export interface DiffOptions<T> {
  /** What makes two tokens equal. Defaults to the token itself. */
  key?: (token: T) => string;
  /**
   * Give up past this many edits and fall back to one replacement.
   * Defaults to 4000, which is a fraction of a second on any machine.
   */
  maxCost?: number;
}

export interface DiffResult<T> {
  changes: Change<T>[];
  /** Edits in the script — insertions plus deletions, the Myers "D". */
  cost: number;
  /** True when the budget ran out and `changes` is a wholesale replacement. */
  truncated: boolean;
}

const DEFAULT_MAX_COST = 4000;

/** The shortest edit script, or an honest replacement when it costs too much. */
export function diff<T>(a: readonly T[], b: readonly T[], options: DiffOptions<T> = {}): DiffResult<T> {
  const key = options.key ?? ((token: T) => String(token));
  const maxCost = options.maxCost ?? DEFAULT_MAX_COST;

  // Identical inputs, and the empty cases, without touching the algorithm.
  const aKeys = a.map(key);
  const bKeys = b.map(key);

  // Trimming the common head and tail first is not an optimization detail: it
  // is what keeps D small for the ordinary case of one edit in a long file.
  let head = 0;
  while (head < aKeys.length && head < bKeys.length && aKeys[head] === bKeys[head]) head += 1;
  let tail = 0;
  while (
    tail < aKeys.length - head &&
    tail < bKeys.length - head &&
    aKeys[aKeys.length - 1 - tail] === bKeys[bKeys.length - 1 - tail]
  ) {
    tail += 1;
  }

  const aMid = a.slice(head, a.length - tail);
  const bMid = b.slice(head, b.length - tail);
  const aMidKeys = aKeys.slice(head, aKeys.length - tail);
  const bMidKeys = bKeys.slice(head, bKeys.length - tail);

  const script = shortestEdit(aMidKeys, bMidKeys, maxCost);
  const truncated = script === null;
  const middle: Change<T>[] = truncated
    ? replacement(aMid, bMid)
    : runsFrom(script, aMid, bMid);

  const changes: Change<T>[] = [];
  if (head > 0) changes.push({ type: 'equal', tokens: a.slice(0, head) });
  changes.push(...middle);
  if (tail > 0) changes.push({ type: 'equal', tokens: a.slice(a.length - tail) });

  const merged = mergeRuns(changes);
  let cost = 0;
  for (const change of merged) if (change.type !== 'equal') cost += change.tokens.length;
  return { changes: merged, cost, truncated };
}

/** Everything gone, everything new — the shape used when the budget runs out. */
function replacement<T>(a: readonly T[], b: readonly T[]): Change<T>[] {
  const out: Change<T>[] = [];
  if (a.length > 0) out.push({ type: 'delete', tokens: [...a] });
  if (b.length > 0) out.push({ type: 'insert', tokens: [...b] });
  return out;
}

type Step = ChangeType;

/**
 * The greedy forward pass, keeping one V array per edit distance so the path
 * can be walked back afterwards. Returns null when D passes the budget.
 */
function shortestEdit(a: readonly string[], b: readonly string[], maxCost: number): Step[] | null {
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return [];
  if (n === 0) return Array.from({ length: m }, () => 'insert' as Step);
  if (m === 0) return Array.from({ length: n }, () => 'delete' as Step);

  const max = n + m;
  const offset = max;
  const v = new Int32Array(2 * max + 1);
  const trace: Int32Array[] = [];
  const budget = Math.min(max, Math.max(1, maxCost));

  for (let d = 0; d <= budget; d += 1) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      // Which neighbour we came from: down is an insertion from b, right is a
      // deletion from a. At the edges there is only one choice.
      const down = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!);
      let x = down ? v[offset + k + 1]! : v[offset + k - 1]! + 1;
      let y = x - k;
      // Then run the diagonal as far as the tokens keep matching — this is the
      // "snake", and it is where the algorithm gets its speed.
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(trace, d, n, m, offset);
    }
  }
  return null;
}

/** Walk the saved V arrays backwards, emitting one step per edit or match. */
function backtrack(trace: Int32Array[], d: number, n: number, m: number, offset: number): Step[] {
  const steps: Step[] = [];
  let x = n;
  let y = m;
  for (let depth = d; depth > 0; depth -= 1) {
    const v = trace[depth]!;
    const k = x - y;
    const down = k === -depth || (k !== depth && v[offset + k - 1]! < v[offset + k + 1]!);
    const previousK = down ? k + 1 : k - 1;
    const previousX = v[offset + previousK]!;
    const previousY = previousX - previousK;
    while (x > previousX && y > previousY) {
      steps.push('equal');
      x -= 1;
      y -= 1;
    }
    steps.push(down ? 'insert' : 'delete');
    x = previousX;
    y = previousY;
  }
  while (x > 0 && y > 0) {
    steps.push('equal');
    x -= 1;
    y -= 1;
  }
  return steps.reverse();
}

/** Steps to runs, pulling each token from whichever side it belongs to. */
function runsFrom<T>(steps: Step[], a: readonly T[], b: readonly T[]): Change<T>[] {
  const out: Change<T>[] = [];
  let i = 0;
  let j = 0;
  for (const step of steps) {
    if (step === 'equal') {
      push(out, 'equal', a[i]!);
      i += 1;
      j += 1;
    } else if (step === 'delete') {
      push(out, 'delete', a[i]!);
      i += 1;
    } else {
      push(out, 'insert', b[j]!);
      j += 1;
    }
  }
  return out;
}

function push<T>(out: Change<T>[], type: ChangeType, token: T): void {
  const last = out[out.length - 1];
  if (last && last.type === type) last.tokens.push(token);
  else out.push({ type, tokens: [token] });
}

/** Join runs that ended up adjacent after the head/tail were spliced back on. */
function mergeRuns<T>(changes: Change<T>[]): Change<T>[] {
  const out: Change<T>[] = [];
  for (const change of changes) {
    if (change.tokens.length === 0) continue;
    const last = out[out.length - 1];
    if (last && last.type === change.type) last.tokens.push(...change.tokens);
    else out.push({ type: change.type, tokens: [...change.tokens] });
  }
  return out;
}

/**
 * How much of the two token arrays is shared, 0–1.
 *
 * Twice the matched tokens over the two lengths — the Sørensen-Dice shape,
 * which is the one that reads as a percentage: identical is 1, nothing in
 * common is 0, and adding an unrelated tail to one side lowers it smoothly.
 */
export function similarity<T>(result: DiffResult<T>): number {
  let equal = 0;
  let a = 0;
  let b = 0;
  for (const change of result.changes) {
    const n = change.tokens.length;
    if (change.type === 'equal') {
      equal += n;
      a += n;
      b += n;
    } else if (change.type === 'delete') a += n;
    else b += n;
  }
  if (a === 0 && b === 0) return 1;
  return (2 * equal) / (a + b);
}
