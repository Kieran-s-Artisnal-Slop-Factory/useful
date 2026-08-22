import { describe, expect, it } from 'vitest';
import {
  counts,
  fleschBand,
  formatDuration,
  frequency,
  readability,
  readingSeconds,
  SMOG_MINIMUM_SENTENCES,
  STOP_WORDS,
} from './analysis';

const SAMPLE = 'The cat sat on the mat. The dog barked.';

describe('counts', () => {
  it('counts the sample the way a person would', () => {
    const c = counts(SAMPLE);
    expect(c.words).toBe(9);
    expect(c.uniqueWords).toBe(7); // 'the' appears three times, ignoring case
    expect(c.sentences).toBe(2);
    expect(c.paragraphs).toBe(1);
    expect(c.lines).toBe(1);
    expect(c.characters).toBe(SAMPLE.length);
    expect(c.charactersNoSpaces).toBe(SAMPLE.replace(/\s/g, '').length);
    expect(c.charactersInWords).toBe(29);
    expect(c.syllables).toBe(9);
  });

  it('separates the four measures of length', () => {
    const c = counts('é👍🏽');
    expect(c.characters).toBe(2);
    expect(c.codePoints).toBe(3);
    expect(c.utf16).toBe(5);
    expect(c.bytes).toBe(10);
  });

  it('is all zeroes for empty text rather than NaN', () => {
    const c = counts('');
    expect(c.words).toBe(0);
    expect(c.sentences).toBe(0);
    expect(c.characters).toBe(0);
    expect(c.lines).toBe(0);
  });

  it('counts paragraphs and lines separately', () => {
    const c = counts('One line\nsame paragraph\n\nSecond paragraph\n');
    expect(c.paragraphs).toBe(2);
    expect(c.lines).toBe(4);
  });
});

describe('readability', () => {
  it('computes each formula, checked against the arithmetic by hand', () => {
    // 9 words, 2 sentences, 9 syllables, 29 characters inside words.
    const r = readability(SAMPLE);
    expect(r.wordsPerSentence).toBeCloseTo(4.5, 10);
    expect(r.syllablesPerWord).toBeCloseTo(1, 10);
    expect(r.charactersPerWord).toBeCloseTo(29 / 9, 10);
    // 206.835 − 1.015×4.5 − 84.6×1
    expect(r.flesch).toBeCloseTo(117.6675, 4);
    // 0.39×4.5 + 11.8×1 − 15.59
    expect(r.fleschKincaid).toBeCloseTo(-2.035, 4);
    // 4.71×(29/9) + 0.5×4.5 − 21.43
    expect(r.ari).toBeCloseTo(-4.0033, 3);
  });

  it('refuses SMOG until it has the thirty sentences it was fitted on', () => {
    const short = readability(SAMPLE);
    expect(short.smog).toBeNull();
    expect(short.smogNeeds).toBe(SMOG_MINIMUM_SENTENCES - 2);

    const long = 'Beautiful difficult sentences appear regularly. '.repeat(30);
    const r = readability(long);
    expect(r.smogNeeds).toBe(0);
    // 1.043 × √(90 × 30 / 30) + 3.1291
    expect(r.smog).toBeCloseTo(13.0238, 3);
  });

  it('has no scores at all for empty text', () => {
    const r = readability('');
    expect(r.flesch).toBeNull();
    expect(r.fleschKincaid).toBeNull();
    expect(r.ari).toBeNull();
    expect(r.smog).toBeNull();
    expect(r.band).toBe('Not enough text');
  });

  it('names the band the ease score falls in', () => {
    expect(fleschBand(95)).toContain('Very easy');
    expect(fleschBand(65)).toContain('Plain English');
    expect(fleschBand(10)).toContain('Very difficult');
    expect(fleschBand(null)).toBe('Not enough text');
  });

  it('gets harder as the sentences get longer and the words get denser', () => {
    const easy = readability('The cat sat. The dog ran. The sun set.');
    const hard = readability(
      'Notwithstanding the aforementioned considerations, the committee determined that ' +
        'implementation of the recommendations would necessitate substantial reorganisation.'
    );
    expect(easy.flesch!).toBeGreaterThan(hard.flesch!);
    expect(easy.fleschKincaid!).toBeLessThan(hard.fleschKincaid!);
  });
});

describe('reading time', () => {
  it('is seconds, so a short note is not "0 minutes"', () => {
    expect(readingSeconds(238)).toBeCloseTo(60, 6);
    expect(readingSeconds(40)).toBeGreaterThan(0);
    expect(readingSeconds(0)).toBe(0);
    expect(readingSeconds(100, 0)).toBe(0);
  });

  it('formats like the timers do', () => {
    expect(formatDuration(45)).toBe('45 s');
    expect(formatDuration(60)).toBe('1 min');
    expect(formatDuration(80)).toBe('1 min 20 s');
    expect(formatDuration(3600)).toBe('1 h');
    expect(formatDuration(7500)).toBe('2 h 5 min');
  });
});

describe('frequency', () => {
  const TEXT = 'the cat and the hat and the bat';

  it('counts words, commonest first, ties alphabetical', () => {
    const rows = frequency(TEXT);
    expect(rows[0]).toEqual({ term: 'the', count: 3, share: 3 / 8 });
    expect(rows[1]!.term).toBe('and');
    expect(rows.map((row) => row.term).slice(2)).toEqual(['bat', 'cat', 'hat']);
  });

  it('drops the words that carry no topic when asked', () => {
    const rows = frequency(TEXT, { dropStopWords: true });
    expect(rows.map((row) => row.term)).toEqual(['bat', 'cat', 'hat']);
    expect(STOP_WORDS.has('the')).toBe(true);
    expect(STOP_WORDS.has('cat')).toBe(false);
  });

  it('builds n-grams inside a sentence, never across the full stop', () => {
    const rows = frequency(TEXT, { size: 2 });
    expect(rows[0]).toEqual({ term: 'and the', count: 2, share: 2 / 7 });

    // Two sentences: "end" and "the" are not a phrase just because they touch.
    const pairs = frequency('One at the end. The beginning again.', { size: 2 });
    expect(pairs.map((row) => row.term)).not.toContain('end the');
  });

  it('honours the limit and is empty for empty text', () => {
    expect(frequency(TEXT, { limit: 2 })).toHaveLength(2);
    expect(frequency('')).toEqual([]);
  });
});
