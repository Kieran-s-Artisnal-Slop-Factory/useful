import { describe, expect, it } from 'vitest';
import { initialRank, rankAfter, rankBetween } from './rank';

describe('rankBetween', () => {
  it('produces a key strictly between its bounds', () => {
    const cases: [string | null, string | null][] = [
      [null, null],
      ['n', null],
      [null, 'n'],
      ['a', 'b'], // adjacent — must go deeper
      ['az', 'b'],
      ['abc', 'abd'],
      ['z', null], // beyond the last single char
      ['zz', null],
    ];
    for (const [a, b] of cases) {
      const mid = rankBetween(a, b);
      if (a !== null) expect(mid > a, `${a} < ${mid}`).toBe(true);
      if (b !== null) expect(mid < b, `${mid} < ${b}`).toBe(true);
    }
  });

  it('rejects out-of-order bounds', () => {
    expect(() => rankBetween('b', 'a')).toThrow();
    expect(() => rankBetween('a', 'a')).toThrow();
  });

  it('survives a thousand adjacent insertions at the front', () => {
    // Repeatedly inserting before the smallest key is the pathological case.
    let smallest = initialRank();
    for (let i = 0; i < 1000; i++) {
      const next = rankBetween(null, smallest);
      expect(next < smallest).toBe(true);
      smallest = next;
    }
  });

  it('keeps a full drag-sorted sequence ordered', () => {
    // Simulate building a column by appending, then moving the last card
    // between every adjacent pair.
    const keys = [initialRank()];
    for (let i = 0; i < 50; i++) keys.push(rankAfter(keys[keys.length - 1]!));
    for (let i = 0; i + 1 < keys.length; i++) {
      const moved = rankBetween(keys[i]!, keys[i + 1]!);
      expect(moved > keys[i]!).toBe(true);
      expect(moved < keys[i + 1]!).toBe(true);
    }
  });
});
