import { describe, expect, it } from 'vitest';
import {
  countGraphemes,
  countLines,
  countPolysyllables,
  countSentences,
  countSyllables,
  countWords,
  graphemes,
  isPolysyllabic,
  lines,
  normalizeWord,
  paragraphs,
  segmenterAvailable,
  sentences,
  sizes,
  syllables,
  words,
} from './tokenize';

describe('graphemes', () => {
  it('counts what a reader counts, not what String.length counts', () => {
    // e + combining acute, a four-person ZWJ family, a skin-toned thumb.
    const text = 'é\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}\u{1F44D}\u{1F3FD}';
    expect(countGraphemes(text)).toBe(3);
    expect([...text].length).toBe(11);
    expect(text.length).toBe(17);
  });

  it('is empty for empty text', () => {
    expect(graphemes('')).toEqual([]);
    expect(countGraphemes('')).toBe(0);
  });

  it('keeps a CRLF together — it is one line break, not two characters', () => {
    expect(countGraphemes('a\r\nb')).toBe(3);
  });
});

describe('words', () => {
  it('keeps apostrophes and hyphens inside one word', () => {
    expect(words("It's a co-op")).toEqual(["It's", 'a', 'co-op']);
    expect(words('mother-in-law')).toEqual(['mother-in-law']);
  });

  it('drops punctuation and emoji, keeps numbers and accented letters', () => {
    expect(words('naïve 42 times 👍 — really?')).toEqual(['naïve', '42', 'times', 'really']);
  });

  it('segments text with no spaces in it', () => {
    // CJK has no word spaces; a whitespace split would call this one word.
    expect(countWords('これは日本語です')).toBeGreaterThan(1);
  });

  it('is empty for blank input', () => {
    expect(words('   \n  ')).toEqual([]);
    expect(countWords('')).toBe(0);
  });

  it('normalizes for frequency work without destroying the inside of a word', () => {
    expect(normalizeWord('“Hello,”')).toBe('hello');
    expect(normalizeWord("It's")).toBe("it's");
    expect(normalizeWord('co-op')).toBe('co-op');
  });
});

describe('sentences', () => {
  it('splits on terminators', () => {
    expect(sentences('One. Two! Three? Four')).toEqual(['One.', 'Two!', 'Three?', 'Four']);
  });

  it('does not split on an abbreviation — the whole point of the post-pass', () => {
    // Unicode sentence breaking alone splits after every one of these stops.
    expect(sentences('Mr. Smith went home. He slept.')).toEqual([
      'Mr. Smith went home.',
      'He slept.',
    ]);
    expect(countSentences('Dr. Jones met Prof. Adams.')).toBe(1);
    expect(countSentences('J. R. R. Tolkien wrote it.')).toBe(1);
    // The softer class needs the next word to decide: a capital ends it, a
    // lower-case word continues it.
    expect(countSentences('Bring a hat, sunscreen, etc. Then meet us.')).toBe(2);
    expect(countSentences('We met at 5 p.m. yesterday and left.')).toBe(1);
    expect(countSentences('We met at 5 p.m. They were late.')).toBe(2);
  });

  it('treats text with no terminator as one sentence', () => {
    // Readability formulas divide by this; zero would make every score Infinity.
    expect(countSentences('no full stop here')).toBe(1);
  });

  it('ignores trailing whitespace and blank input', () => {
    expect(sentences('   ')).toEqual([]);
    expect(sentences('Hi.   ')).toEqual(['Hi.']);
  });
});

describe('paragraphs and lines', () => {
  it('splits paragraphs on blank lines, ignoring indentation', () => {
    expect(paragraphs('One\nstill one\n\n  \nTwo\n')).toEqual(['One\nstill one', 'Two']);
  });

  it('keeps every line, including the empty one a trailing newline makes', () => {
    expect(lines('a\nb\n')).toEqual(['a', 'b', '']);
    expect(lines('a\r\nb')).toEqual(['a', 'b']);
    // ...but the count is what a person would say out loud.
    expect(countLines('a\nb\n')).toBe(2);
    expect(countLines('a\nb')).toBe(2);
    expect(countLines('')).toBe(0);
  });
});

describe('sizes', () => {
  it('reports the four numbers that all get called length', () => {
    expect(sizes('é\u{1F44D}\u{1F3FD}')).toEqual({
      graphemes: 2,
      codePoints: 3,
      utf16: 5,
      bytes: 10,
    });
  });

  it('is all zeroes for empty text', () => {
    expect(sizes('')).toEqual({ graphemes: 0, codePoints: 0, utf16: 0, bytes: 0 });
  });

  it('counts ASCII identically in every measure', () => {
    expect(sizes('hello')).toEqual({ graphemes: 5, codePoints: 5, utf16: 5, bytes: 5 });
  });
});

describe('syllables', () => {
  it('counts ordinary prose correctly', () => {
    const table: [string, number][] = [
      ['a', 1],
      ['the', 1],
      ['cake', 1],
      ['hello', 2],
      ['table', 2],
      ['simple', 2],
      ['walked', 1],
      ['reading', 2],
      ['beautiful', 3],
      ['syllable', 3],
      ['readability', 5],
      ['university', 5],
    ];
    for (const [word, count] of table) expect([word, syllables(word)]).toEqual([word, count]);
  });

  it('never returns less than one for a word, and zero for a numeral', () => {
    expect(syllables('rhythm')).toBe(1);
    expect(syllables('42')).toBe(0);
    expect(syllables('')).toBe(0);
  });

  it('has known limits, pinned here so a rule change cannot move scores silently', () => {
    // English spelling does not carry syllable counts, so every
    // dictionary-free counter is wrong somewhere. These are this one's.
    expect(syllables('business')).toBe(3); // really 2 — biz-ness
    expect(syllables('poem')).toBe(1); // really 2 — po-em
    expect(syllables('science')).toBe(1); // really 2 — sci-ence
    // And one it gets right by luck: the vowel run in "queue" is a single
    // group, which is also the correct answer.
    expect(syllables('queue')).toBe(1);
  });

  it('finds the polysyllables SMOG needs', () => {
    expect(isPolysyllabic('beautiful')).toBe(true);
    expect(isPolysyllabic('table')).toBe(false);
    expect(countPolysyllables('A beautiful, difficult sentence about syllables.')).toBe(3);
  });

  it('sums across the text using the same word rules', () => {
    expect(countSyllables('The cake was beautiful.')).toBe(1 + 1 + 1 + 3);
  });
});

describe('the platform', () => {
  it('has Intl.Segmenter here, so these results are the real segmentation', () => {
    expect(segmenterAvailable()).toBe(true);
  });
});
