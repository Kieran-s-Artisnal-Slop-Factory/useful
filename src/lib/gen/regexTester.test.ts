import { describe, expect, it } from 'vitest';
import { filterReference, REGEX_REFERENCE } from './regexRef';
import { findMatches, MAX_MATCHES, segmentText, type RegexTestFlags } from './regexTester';

const FLAGS: RegexTestFlags = { ignoreCase: false, multiline: false, dotAll: false };

describe('findMatches', () => {
  it('finds all matches with positions and numbered groups (with spans)', () => {
    const r = findMatches('(\\d+)-(\\d+)', FLAGS, 'a 12-34 b 5-6');
    expect(r).not.toBeNull();
    expect(r!.matches).toHaveLength(2);
    expect(r!.matches[0]).toMatchObject({ start: 2, end: 7, text: '12-34' });
    expect(r!.matches[0]!.groups).toEqual([
      { number: 1, name: null, value: '12', start: 2, end: 4 },
      { number: 2, name: null, value: '34', start: 5, end: 7 },
    ]);
    expect(r!.matches[1]!.text).toBe('5-6');
  });

  it('merges named groups with their numbers instead of listing twice', () => {
    const r = findMatches('(?<y>\\d{4})-(\\d{2})', FLAGS, 'in 2026-08 maybe');
    expect(r!.matches[0]!.groups).toEqual([
      { number: 1, name: 'y', value: '2026', start: 3, end: 7 },
      { number: 2, name: null, value: '08', start: 8, end: 10 },
    ]);
  });

  it('honors the flags', () => {
    expect(findMatches('hello', FLAGS, 'Hello')!.matches).toHaveLength(0);
    expect(findMatches('hello', { ...FLAGS, ignoreCase: true }, 'Hello')!.matches).toHaveLength(1);
    expect(findMatches('^b', FLAGS, 'a\nb')!.matches).toHaveLength(0);
    expect(findMatches('^b', { ...FLAGS, multiline: true }, 'a\nb')!.matches).toHaveLength(1);
    expect(findMatches('a.b', FLAGS, 'a\nb')!.matches).toHaveLength(0);
    expect(findMatches('a.b', { ...FLAGS, dotAll: true }, 'a\nb')!.matches).toHaveLength(1);
  });

  it('unmatched optional groups come back null with null spans', () => {
    const r = findMatches('a(b)?', FLAGS, 'a');
    expect(r!.matches[0]!.groups).toEqual([
      { number: 1, name: null, value: null, start: null, end: null },
    ]);
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
  it('splits text into plain and matched runs with group-colored parts', () => {
    const text = 'a 12-34 b';
    const r = findMatches('(\\d+)-(\\d+)', FLAGS, text)!;
    const segments = segmentText(text, r.matches);
    expect(segments).toHaveLength(3);
    expect(segments[0]).toEqual({ text: 'a ', matchOrdinal: null });
    expect(segments[2]).toEqual({ text: ' b', matchOrdinal: null });
    expect(segments[1]!.matchOrdinal).toBe(0);
    // "12" is $1, "-" belongs to the match itself, "34" is $2.
    expect(segments[1]!.parts).toEqual([
      { text: '12', groupNumber: 1 },
      { text: '-', groupNumber: null },
      { text: '34', groupNumber: 2 },
    ]);
  });

  it('inner (later) groups paint over outer ones', () => {
    const text = 'abc';
    const r = findMatches('(a(b)c)', FLAGS, text)!;
    expect(segmentText(text, r.matches)[0]!.parts).toEqual([
      { text: 'a', groupNumber: 1 },
      { text: 'b', groupNumber: 2 },
      { text: 'c', groupNumber: 1 },
    ]);
  });

  it('a lookahead capture beyond the match is clamped, not crashed', () => {
    const text = 'ab';
    const r = findMatches('a(?=(b))', FLAGS, text)!;
    expect(r.matches[0]!.groups[0]).toMatchObject({ number: 1, value: 'b' });
    const segments = segmentText(text, r.matches);
    expect(segments.map((s) => s.text).join('')).toBe(text);
    expect(segments[0]!.parts).toEqual([{ text: 'a', groupNumber: null }]);
  });

  it('handles adjacent matches and drops zero-length runs', () => {
    const text = 'abab';
    const r = findMatches('ab', FLAGS, text)!;
    const segments = segmentText(text, r.matches);
    expect(segments.map((s) => s.text)).toEqual(['ab', 'ab']);

    const boundaries = findMatches('\\b', FLAGS, 'one two')!;
    const segs = segmentText('one two', boundaries.matches);
    expect(segs.map((s) => s.text).join('')).toBe('one two');
    expect(segs.every((s) => s.text.length > 0)).toBe(true);
  });
});

describe('reference table', () => {
  it('covers the core categories', () => {
    const categories = REGEX_REFERENCE.map((g) => g.category);
    for (const expected of ['Anchors', 'Character classes', 'Quantifiers', 'Groups & references', 'Lookaround', 'Escapes']) {
      expect(categories).toContain(expected);
    }
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
