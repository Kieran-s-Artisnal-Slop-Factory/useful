import { describe, expect, it } from 'vitest';
import { fuzzyScore, isSubsequence } from './fuzzy';

describe('isSubsequence', () => {
  it('accepts in-order characters with gaps', () => {
    expect(isSubsequence('sts', 'settings')).toBe(true);
    expect(isSubsequence('tz', 'timezone')).toBe(true);
  });

  it('rejects out-of-order or missing characters', () => {
    expect(isSubsequence('gs', 'sg')).toBe(false);
    expect(isSubsequence('xyz', 'settings')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isSubsequence('SeT', 'settings')).toBe(true);
  });
});

describe('fuzzyScore', () => {
  it('returns null when there is no subsequence match', () => {
    expect(fuzzyScore('xyz', 'settings')).toBeNull();
    expect(fuzzyScore('settings!', 'settings')).toBeNull(); // longer than text
  });

  it('matches everything with score 0 on an empty or whitespace query', () => {
    expect(fuzzyScore('', 'anything')).toBe(0);
    expect(fuzzyScore('   ', 'anything')).toBe(0);
  });

  it('always scores a real match above zero', () => {
    expect(fuzzyScore('sg', 'a settings-ish string with spread out letters')).toBeGreaterThan(0);
  });

  it('prefers a prefix match over a mid-string match', () => {
    expect(fuzzyScore('set', 'settings')!).toBeGreaterThan(fuzzyScore('set', 'reset options')!);
  });

  it('prefers consecutive runs over scattered letters', () => {
    expect(fuzzyScore('time', 'timers')!).toBeGreaterThan(fuzzyScore('time', 'the wide mixer')!);
  });

  it('rewards word-boundary matches', () => {
    expect(fuzzyScore('cp', 'color-picker')!).toBeGreaterThan(fuzzyScore('cp', 'clipboard')!);
  });

  it('is case-insensitive', () => {
    expect(fuzzyScore('SET', 'Settings')).toEqual(fuzzyScore('set', 'settings'));
  });
});
