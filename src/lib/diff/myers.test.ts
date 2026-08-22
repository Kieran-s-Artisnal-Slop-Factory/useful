import { describe, expect, it } from 'vitest';
import { type Change, diff, similarity } from './myers';

/** Apply an edit script to `a` and see whether `b` comes out. */
function apply<T>(changes: Change<T>[]): T[] {
  const out: T[] = [];
  for (const change of changes) {
    if (change.type !== 'delete') out.push(...change.tokens);
  }
  return out;
}

/** The left-hand text an edit script implies. */
function original<T>(changes: Change<T>[]): T[] {
  const out: T[] = [];
  for (const change of changes) {
    if (change.type !== 'insert') out.push(...change.tokens);
  }
  return out;
}

const chars = (text: string) => [...text];

describe('diff', () => {
  it('finds the shortest script for the paper\'s own example', () => {
    // Myers 1986, figure 1: ABCABBA → CBABAC needs five edits.
    const result = diff(chars('ABCABBA'), chars('CBABAC'));
    expect(result.cost).toBe(5);
    expect(result.truncated).toBe(false);
    expect(apply(result.changes).join('')).toBe('CBABAC');
    expect(original(result.changes).join('')).toBe('ABCABBA');
  });

  it('reports identical inputs as one equal run', () => {
    const result = diff(chars('same'), chars('same'));
    expect(result.changes).toEqual([{ type: 'equal', tokens: chars('same') }]);
    expect(result.cost).toBe(0);
    expect(similarity(result)).toBe(1);
  });

  it('handles the empty cases', () => {
    expect(diff([], []).changes).toEqual([]);
    expect(diff([], chars('new')).changes).toEqual([{ type: 'insert', tokens: chars('new') }]);
    expect(diff(chars('old'), []).changes).toEqual([{ type: 'delete', tokens: chars('old') }]);
    expect(similarity(diff([], []))).toBe(1);
  });

  it('keeps the head and tail out of the edit script', () => {
    const result = diff(chars('prefix-OLD-suffix'), chars('prefix-NEW-suffix'));
    expect(result.changes[0]).toEqual({ type: 'equal', tokens: chars('prefix-') });
    expect(result.changes[result.changes.length - 1]).toEqual({ type: 'equal', tokens: chars('-suffix') });
    expect(apply(result.changes).join('')).toBe('prefix-NEW-suffix');
  });

  it('compares through the key function, so display keeps the original text', () => {
    const result = diff(['Hello', 'World'], ['HELLO', 'World'], { key: (t) => t.toLowerCase() });
    expect(result.cost).toBe(0);
    // The tokens that come back are the left-hand ones, unchanged.
    expect(result.changes).toEqual([{ type: 'equal', tokens: ['Hello', 'World'] }]);
  });

  it('reconstructs both sides for a hundred random pairs', () => {
    // A diff that cannot be applied is not a diff. Seeded by hand so a failure
    // is reproducible rather than "it went red once".
    let seed = 12345;
    const next = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const random = (n: number) =>
      Array.from({ length: Math.floor(next() * n) }, () => 'abcde'[Math.floor(next() * 5)]!);
    for (let i = 0; i < 100; i += 1) {
      const a = random(14);
      const b = random(14);
      const result = diff(a, b);
      expect(apply(result.changes)).toEqual(b);
      expect(original(result.changes)).toEqual(a);
    }
  });

  it('gives up honestly rather than grinding on two unrelated walls of text', () => {
    const a = Array.from({ length: 400 }, (_, i) => `left ${i}`);
    const b = Array.from({ length: 400 }, (_, i) => `right ${i}`);
    const result = diff(a, b, { maxCost: 8 });
    expect(result.truncated).toBe(true);
    expect(result.changes.map((c) => c.type)).toEqual(['delete', 'insert']);
    // Even the fallback has to be applicable.
    expect(apply(result.changes)).toEqual(b);
    expect(original(result.changes)).toEqual(a);
  });

  it('scores similarity between 0 and 1', () => {
    expect(similarity(diff(chars('abcdef'), chars('abcdef')))).toBe(1);
    expect(similarity(diff(chars('abc'), chars('xyz')))).toBe(0);
    expect(similarity(diff(chars('abcd'), chars('abxy')))).toBeCloseTo(0.5, 10);
  });
});
