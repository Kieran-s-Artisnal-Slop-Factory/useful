import { describe, expect, it } from 'vitest';
import {
  applyTransform,
  capitalizeWords,
  sentenceCase,
  spongebobCase,
  strikeThrough,
  TRANSFORMS,
  wideText,
} from './transform';

describe('sentence case', () => {
  it('lower-cases everything and capitalises each sentence', () => {
    expect(sentenceCase('HELLO there. HOW are YOU?')).toBe('Hello there. How are you?');
    expect(sentenceCase('one. two! three?')).toBe('One. Two! Three?');
  });

  it('uses the shared sentence rules, so an abbreviation is not a new sentence', () => {
    // A regex on full stops would capitalise the S in "smith".
    expect(sentenceCase('DR. SMITH ARRIVED.')).toBe('Dr. smith arrived.');
  });

  it('starts at the first letter, not the first character', () => {
    expect(sentenceCase('"HELLO there."')).toBe('"Hello there."');
    expect(sentenceCase('   spaced OUT.')).toBe('   Spaced out.');
  });

  it('leaves the gaps between sentences exactly as they were', () => {
    expect(sentenceCase('ONE.\n\nTWO.')).toBe('One.\n\nTwo.');
  });
});

describe('capitalize each word', () => {
  it('capitalises every word, including the small ones', () => {
    expect(capitalizeWords('hello there world')).toBe('Hello There World');
    // Not editorial title case, and the summary in TRANSFORMS says so.
    expect(capitalizeWords('the lord of the rings')).toBe('The Lord Of The Rings');
  });

  it('lower-cases the rest of a shouted word', () => {
    expect(capitalizeWords('HELLO THERE')).toBe('Hello There');
  });

  it('leaves numbers and punctuation alone', () => {
    expect(capitalizeWords('42 cats, 3 dogs')).toBe('42 Cats, 3 Dogs');
  });
});

describe('decorations', () => {
  it('strikes each character with a combining overlay', () => {
    expect(strikeThrough('Hi')).toBe('H̶i̶');
    // Line breaks are not struck: the stroke would land on nothing.
    expect(strikeThrough('a\nb')).toBe('a̶\nb̶');
  });

  it('spaces out capitals', () => {
    expect(wideText('Aesthetic')).toBe('A E S T H E T I C');
    expect(wideText('hi there')).toBe('H I   T H E R E');
    expect(wideText('a\nb')).toBe('A\nB');
  });

  it('alternates case over letters only', () => {
    expect(spongebobCase('Aesthetic')).toBe('aEsThEtIc');
    // Punctuation does not take a turn, so the rhythm survives it.
    expect(spongebobCase('ab, cd')).toBe('aB, cD');
  });
});

describe('graphemes, not code units', () => {
  it('never splits an emoji or drops an accent', () => {
    const emoji = 'a👍🏽b';
    expect(wideText(emoji)).toBe('A 👍🏽 B');
    // The emoji does not take a turn, so the two letters alternate across it.
    expect(spongebobCase(emoji)).toBe('a👍🏽B');
    // One stroke per user-perceived character: two letters and the emoji.
    expect([...strikeThrough(emoji)].filter((ch) => ch === '̶')).toHaveLength(3);
    expect(capitalizeWords('éclair')).toBe('Éclair');
  });
});

describe('the catalogue', () => {
  it('applies every transform it advertises, and leaves empty text empty', () => {
    for (const def of TRANSFORMS) {
      expect(typeof applyTransform(def.id, 'Hello there')).toBe('string');
      expect(applyTransform(def.id, '')).toBe('');
      expect(def.summary.length).toBeGreaterThan(0);
      expect(def.example).toContain('→');
    }
    expect(TRANSFORMS.map((def) => def.id)).toEqual([
      'sentence',
      'capitalize',
      'lower',
      'upper',
      'strike',
      'wide',
      'spongebob',
    ]);
  });

  it('routes each id to its own function', () => {
    expect(applyTransform('upper', 'hi')).toBe('HI');
    expect(applyTransform('lower', 'HI')).toBe('hi');
    expect(applyTransform('wide', 'hi')).toBe(wideText('hi'));
    expect(applyTransform('spongebob', 'hi')).toBe(spongebobCase('hi'));
  });
});
