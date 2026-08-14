import { describe, expect, it } from 'vitest';
import { filterReference, REGEX_REFERENCE } from './regexRef';
import { findMatches, MAX_MATCHES, segmentText, type RegexTestFlags } from './regexTester';

const FLAGS: RegexTestFlags = { ignoreCase: false, multiline: false, dotAll: false };

describe('findMatches', () => {
  it('finds all matches with positions and numbered groups', () => {
    const r = findMatches('(\\d+)-(\\d+)', FLAGS, 'a 12-34 b 5-6');
    expect(r).not.toBeNull();
    expect(r!.matches).toHaveLength(2);
    expect(r!.matches[0]).toMatchObject({ start: 2, end: 7, text: '12-34' });
    expect(r!.matches[0]!.groups).toEqual([
      { label: '$1', value: '12' },
      { label: '$2', value: '34' },
    ]);
    expect(r!.matches[1]!.text).toBe('5-6');
  });

  it('reports named groups by name', () => {
    const r = findMatches('(?<y>\\d{4})', FLAGS, 'in 2026 maybe');
    expect(r!.matches[0]!.groups).toContainEqual({ label: 'y', value: '2026' });
  });

  it('honors the flags', () => {
    expect(findMatches('hello', FLAGS, 'Hello')!.matches).toHaveLength(0);
    expect(findMatches('hello', { ...FLAGS, ignoreCase: true }, 'Hello')!.matches).toHaveLength(1);
    expect(findMatches('^b', FLAGS, 'a\nb')!.matches).toHaveLength(0);
    expect(findMatches('^b', { ...FLAGS, multiline: true }, 'a\nb')!.matches).toHaveLength(1);
    expect(findMatches('a.b', FLAGS, 'a\nb')!.matches).toHaveLength(0);
    expect(findMatches('a.b', { ...FLAGS, dotAll: true }, 'a\nb')!.matches).toHaveLength(1);
  });

  it('unmatched optional groups come back null', () => {
    const r = findMatches('a(b)?', FLAGS, 'a');
    expect(r!.matches[0]!.groups).toEqual([{ label: '$1', value: null }]);
  });

  it('returns null for a broken pattern, and survives zero-length matches', () => {
    expect(findMatches('a(', FLAGS, 'aaa')).toBeNull();
    const r = findMatches('\\b', FLAGS, 'one two');
    expect(r!.matches.length).toBe(4); // word boundaries — all zero-length
    expect(r!.matches[0]!.start).toBe(r!.matches[0]!.end);
  });

  it('truncates instead of freezing on huge match counts', () => {
    const r = findMatches('a', FLAGS, 'a'.repeat(MAX_MATCHES + 50));
    expect(r!.matches).toHaveLength(MAX_MATCHES);
    expect(r!.truncated).toBe(true);
  });
});

describe('segmentText', () => {
  it('splits text into plain and matched runs', () => {
    const text = 'a 12-34 b';
    const r = findMatches('\\d+-\\d+', FLAGS, text)!;
    expect(segmentText(text, r.matches)).toEqual([
      { text: 'a ', matchOrdinal: null },
      { text: '12-34', matchOrdinal: 0 },
      { text: ' b', matchOrdinal: null },
    ]);
  });

  it('handles adjacent matches and match-at-edges', () => {
    const text = 'abab';
    const r = findMatches('ab', FLAGS, text)!;
    expect(segmentText(text, r.matches)).toEqual([
      { text: 'ab', matchOrdinal: 0 },
      { text: 'ab', matchOrdinal: 1 },
    ]);
  });

  it('drops zero-length runs but keeps surrounding text intact', () => {
    const text = 'one two';
    const r = findMatches('\\b', FLAGS, text)!;
    const segments = segmentText(text, r.matches);
    expect(segments.map((s) => s.text).join('')).toBe(text);
    expect(segments.every((s) => s.text.length > 0)).toBe(true);
  });
});

describe('reference table', () => {
  it('covers the core categories', () => {
    const categories = REGEX_REFERENCE.map((g) => g.category);
    for (const expected of ['Anchors', 'Character classes', 'Quantifiers', 'Groups & references', 'Lookaround', 'Escapes']) {
      expect(categories).toContain(expected);
    }
    // Every entry is fully filled in.
    for (const group of REGEX_REFERENCE) {
      for (const entry of group.entries) {
        expect(entry.token.length).toBeGreaterThan(0);
        expect(entry.meaning.length).toBeGreaterThan(0);
        expect(entry.example.length).toBeGreaterThan(0);
      }
    }
  });

  it('filters by token and by meaning, case-insensitively', () => {
    const byToken = filterReference('\\d');
    expect(byToken.some((g) => g.entries.some((e) => e.token === '\\d'))).toBe(true);
    const byMeaning = filterReference('LOOKAHEAD');
    expect(byMeaning).toHaveLength(1);
    expect(byMeaning[0]!.category).toBe('Lookaround');
    expect(filterReference('')).toEqual(REGEX_REFERENCE);
    expect(filterReference('zzzznothing')).toEqual([]);
  });
});
