import { describe, expect, it } from 'vitest';
import {
  ALGORITHMS,
  compare,
  damerau,
  indel,
  jaro,
  jaroDetail,
  jaroWinkler,
  lcsLength,
  levenshtein,
  matrix,
  normalize,
  score,
  suggest,
} from './edit';

describe('levenshtein', () => {
  it('matches the textbook cases', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('saturday', 'sunday')).toBe(3);
    expect(levenshtein('flaw', 'lawn')).toBe(2);
    expect(levenshtein('book', 'back')).toBe(2);
  });

  it('is zero for identical strings and the length for an empty one', () => {
    expect(levenshtein('same', 'same')).toBe(0);
    expect(levenshtein('', '')).toBe(0);
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('abc', '')).toBe(3);
  });

  it('is symmetric', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(levenshtein('sitting', 'kitten'));
  });

  it('counts characters as a reader does, not as UTF-16 does', () => {
    // The skin-toned thumb is one grapheme, four UTF-16 units.
    expect(levenshtein('a👍🏽b', 'ab')).toBe(1);
    expect(levenshtein('café', 'cafe')).toBe(1);
  });
});

describe('damerau', () => {
  it('charges one edit for a swap, where Levenshtein charges two', () => {
    expect(levenshtein('ab', 'ba')).toBe(2);
    expect(damerau('ab', 'ba')).toBe(1);
    expect(damerau('teh', 'the')).toBe(1);
    expect(damerau('kitten', 'sitting')).toBe(3);
  });

  it('is the optimal-string-alignment variant, and says so in the numbers', () => {
    // Unrestricted Damerau-Levenshtein answers 2 here by transposing then
    // inserting; OSA never touches a substring twice, so it answers 3. Pinned
    // because the difference is exactly what "which Damerau" means.
    expect(damerau('CA', 'ABC')).toBe(3);
  });
});

describe('indel', () => {
  it('pays twice for a substitution, because that is a delete and an insert', () => {
    expect(indel('ABCD', 'ACBD')).toBe(2);
    expect(indel('kitten', 'sitting')).toBe(5);
    expect(indel('abc', 'abc')).toBe(0);
    expect(indel('abc', '')).toBe(3);
  });

  it('is the longest common subsequence in disguise', () => {
    expect(lcsLength('ABCD', 'ACBD')).toBe(3);
    expect(lcsLength('kitten', 'sitting')).toBe(4);
    expect(lcsLength('abc', 'xyz')).toBe(0);
  });
});

describe('jaro and jaro-winkler', () => {
  it('matches the published values', () => {
    expect(jaro('MARTHA', 'MARHTA')).toBeCloseTo(0.944444, 6);
    expect(jaroWinkler('MARTHA', 'MARHTA')).toBeCloseTo(0.961111, 6);
    expect(jaro('DIXON', 'DICKSONX')).toBeCloseTo(0.766667, 6);
    expect(jaroWinkler('DIXON', 'DICKSONX')).toBeCloseTo(0.813333, 6);
    expect(jaro('CRATE', 'TRACE')).toBeCloseTo(0.733333, 6);
    // No shared prefix, so Winkler adds nothing.
    expect(jaroWinkler('CRATE', 'TRACE')).toBeCloseTo(0.733333, 6);
  });

  it('is 1 for identical strings and 0 when nothing matches', () => {
    expect(jaro('same', 'same')).toBe(1);
    expect(jaroWinkler('same', 'same')).toBe(1);
    expect(jaro('abc', 'xyz')).toBe(0);
    expect(jaro('abc', '')).toBe(0);
  });

  it('shows its working: window, pairing, transpositions and prefix', () => {
    const detail = jaroDetail('MARTHA', 'MARHTA');
    expect(detail.window).toBe(2);
    expect(detail.matches).toBe(6);
    expect(detail.transpositions).toBe(1);
    expect(detail.prefix).toBe(3);
    expect(detail.matchedA.every(Boolean)).toBe(true);
    // T and H swapped: position 3 of MARTHA partners position 4 of MARHTA.
    expect(detail.pairing[3]).toBe(4);
    expect(detail.pairing[4]).toBe(3);
  });

  it('caps the Winkler prefix at four characters', () => {
    const detail = jaroDetail('abcdefgh', 'abcdefxx');
    expect(detail.prefix).toBe(4);
  });
});

describe('the matrix', () => {
  it('is the table the visualizer draws, with the traceback through it', () => {
    const table = matrix('kitten', 'sitting');
    expect(table.rows).toHaveLength(7);
    expect(table.rows[0]).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(table.distance).toBe(3);
    expect(table.path.map((step) => step.op)).toEqual([
      'substitute',
      'match',
      'match',
      'match',
      'substitute',
      'match',
      'insert',
    ]);
    // The costs on the path add up to the distance in the corner.
    expect(table.path.reduce((sum, step) => sum + step.cost, 0)).toBe(3);
  });

  it('uses a transposition step when Damerau is on', () => {
    const table = matrix('teh', 'the', { transpose: true });
    expect(table.distance).toBe(1);
    expect(table.path.map((step) => step.op)).toContain('transpose');
  });

  it('never substitutes in indel mode', () => {
    const table = matrix('abc', 'axc', { indel: true });
    expect(table.distance).toBe(2);
    expect(table.path.map((step) => step.op)).not.toContain('substitute');
    expect(table.path.filter((step) => step.op === 'insert')).toHaveLength(1);
    expect(table.path.filter((step) => step.op === 'delete')).toHaveLength(1);
  });

  it('handles the empty edges', () => {
    expect(matrix('', '').distance).toBe(0);
    expect(matrix('', 'ab').path.map((s) => s.op)).toEqual(['insert', 'insert']);
    expect(matrix('ab', '').path.map((s) => s.op)).toEqual(['delete', 'delete']);
  });
});

describe('scores', () => {
  it('turns every algorithm into a 0-1 number that can share a column', () => {
    expect(normalize('levenshtein', 3, 'kitten', 'sitting')).toBeCloseTo(1 - 3 / 7, 10);
    expect(normalize('indel', 5, 'kitten', 'sitting')).toBeCloseTo(1 - 5 / 13, 10);
    expect(normalize('levenshtein', 0, '', '')).toBe(1);
    for (const def of ALGORITHMS) {
      const value = score(def.id, 'kitten', 'sitting').similarity;
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThan(1);
      expect(score(def.id, 'same', 'same').similarity).toBe(1);
    }
  });

  it('keeps the raw reading beside the score, because they are different facts', () => {
    expect(score('levenshtein', 'kitten', 'sitting').raw).toBe(3);
    expect(score('jaro', 'MARTHA', 'MARHTA').raw).toBeCloseTo(0.944444, 6);
  });

  it('compares one word against many, every algorithm at once', () => {
    const rows = compare('helo', ['hello', 'help', 'world']);
    expect(rows.map((row) => row.word)).toEqual(['hello', 'help', 'world']);
    expect(rows[0]!.scores.levenshtein.raw).toBe(1);
    expect(rows[2]!.scores.jaro.similarity).toBeLessThan(rows[0]!.scores.jaro.similarity);
  });

  it('suggests the closest candidate, deterministically', () => {
    expect(suggest('helo', ['hello', 'help', 'world'])).toEqual({
      word: 'hello',
      likelihood: jaro('helo', 'hello'),
    });
    expect(suggest('helo', ['hello', 'hello'])!.word).toBe('hello');
    expect(suggest('anything', [])).toBeNull();
  });
});
