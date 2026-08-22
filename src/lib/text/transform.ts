/**
 * Case and decoration transforms for the text-analysis page.
 *
 * Every one of them walks GRAPHEMES rather than UTF-16 units, so an emoji, a
 * flag or a combining accent survives being spaced out, struck through or
 * alternated. Splitting `"👍🏽"` in half — which any `text.split('')` does — is
 * the failure this module exists to avoid.
 *
 * Pure module: no DOM, no state, no I/O.
 */
import { graphemes, lines, neverEndsSentence } from './tokenize';

export type TransformId =
  | 'sentence'
  | 'capitalize'
  | 'lower'
  | 'upper'
  | 'strike'
  | 'wide'
  | 'spongebob';

export interface TransformDef {
  id: TransformId;
  name: string;
  /** What it does, in the shortest form that is still honest. */
  summary: string;
  /** The transform applied to "Hello there" — the button's own preview. */
  example: string;
}

/** The combining long stroke overlay: one per character, after the character. */
const STRIKE = '̶';

/**
 * Lower case, with the first letter of each sentence capitalised.
 *
 * This does NOT use `sentences()`, and the reason is worth writing down. The
 * Unicode sentence rules refuse to break before a lower-case word — `one. two`
 * is one sentence to them, because a lower-case word after a full stop usually
 * means an abbreviation. That is right for counting and exactly wrong here:
 * all-lower-case text is precisely what this transform is handed.
 *
 * So it walks the text itself, capitalising after every terminator, and asks
 * [tokenize.ts](tokenize.ts) the one question that still matters — was the
 * word before the stop an abbreviation — so `dr. smith` becomes `Dr. smith`
 * rather than `Dr. Smith`, the same judgement the counts make.
 */
export function sentenceCase(text: string): string {
  const parts = graphemes(text.toLocaleLowerCase());
  const out: string[] = [];
  let capitalizeNext = true;
  /** The word being read, so a terminator can ask what it followed. */
  let word = '';
  /** A terminator has been seen and is waiting for whitespace to confirm it. */
  let pending = false;

  for (const part of parts) {
    if (/\p{L}|\p{N}/u.test(part)) {
      word += part;
      if (capitalizeNext && /\p{L}/u.test(part)) {
        out.push(part.toLocaleUpperCase());
        capitalizeNext = false;
        continue;
      }
      out.push(part);
      continue;
    }

    if (/[.!?…]/u.test(part)) {
      // A full stop only breaks the sentence if the word it followed was not
      // an abbreviation. `!` and `?` always break.
      pending = part !== '.' || !neverEndsSentence(word);
      word = '';
      out.push(part);
      continue;
    }

    if (/\s/u.test(part)) {
      if (pending) {
        capitalizeNext = true;
        pending = false;
      }
      word = '';
      out.push(part);
      continue;
    }

    // Quotes and brackets sit between the terminator and the next sentence, so
    // they neither confirm nor cancel the break.
    out.push(part);
  }
  return out.join('');
}

/** Upper-case the first letter, leaving anything before it (quotes, brackets). */
function capitalizeFirst(text: string): string {
  const parts = graphemes(text);
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i]!;
    if (/\p{L}/u.test(part)) {
      parts[i] = part.toLocaleUpperCase();
      break;
    }
  }
  return parts.join('');
}

export function capitalizeWords(text: string): string {
  return text.replace(/[\p{L}\p{M}][\p{L}\p{M}\p{Nd}'’]*/gu, (word) =>
    capitalizeFirst(word.toLocaleLowerCase())
  );
}

/** s̶t̶r̶i̶k̶e̶t̶h̶r̶o̶u̶g̶h̶ — a text effect, not markup; some fonts ignore it. */
export function strikeThrough(text: string): string {
  return lines(text)
    .map((line) =>
      graphemes(line)
        .map((part) => part + STRIKE)
        .join('')
    )
    .join('\n');
}

/** W I D E   T E X T — upper case with a space between every character. */
export function wideText(text: string): string {
  return lines(text)
    .map((line) => graphemes(line.toLocaleUpperCase()).join(' '))
    .join('\n');
}

/** sPoNgEbOb — alternating case over letters, punctuation left alone. */
export function spongebobCase(text: string): string {
  let upper = false;
  return graphemes(text)
    .map((part) => {
      if (!/\p{L}/u.test(part)) return part;
      const done = upper ? part.toLocaleUpperCase() : part.toLocaleLowerCase();
      upper = !upper;
      return done;
    })
    .join('');
}

export const TRANSFORMS: TransformDef[] = [
  {
    id: 'sentence',
    name: 'Sentence case',
    summary: 'Lower case, with the first letter of each sentence capitalised.',
    example: 'Hello there. how are you? → Hello there. How are you?',
  },
  {
    id: 'capitalize',
    name: 'Capitalize Each Word',
    summary: 'Every word starts with a capital. Not editorial title case — "the" is capitalised too.',
    example: 'hello there → Hello There',
  },
  { id: 'lower', name: 'lower case', summary: 'Everything in lower case.', example: 'Hello There → hello there' },
  { id: 'upper', name: 'UPPER CASE', summary: 'Everything in capitals.', example: 'Hello There → HELLO THERE' },
  {
    id: 'strike',
    name: 'S̶t̶r̶i̶k̶e̶t̶h̶r̶o̶u̶g̶h̶',
    summary: 'A combining stroke after each character. It travels as text, but some fonts drop it.',
    example: 'Hello → H̶e̶l̶l̶o̶',
  },
  {
    id: 'wide',
    name: 'W I D E',
    summary: 'Capitals with a space between every character.',
    example: 'Aesthetic → A E S T H E T I C',
  },
  {
    id: 'spongebob',
    name: 'sPoNgEbOb',
    summary: 'Alternating case over the letters, starting in lower case.',
    example: 'Aesthetic → aEsThEtIc',
  },
];

export function applyTransform(id: TransformId, text: string): string {
  switch (id) {
    case 'sentence':
      return sentenceCase(text);
    case 'capitalize':
      return capitalizeWords(text);
    case 'lower':
      return text.toLocaleLowerCase();
    case 'upper':
      return text.toLocaleUpperCase();
    case 'strike':
      return strikeThrough(text);
    case 'wide':
      return wideText(text);
    case 'spongebob':
      return spongebobCase(text);
    default:
      return text;
  }
}
