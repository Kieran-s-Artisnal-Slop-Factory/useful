/**
 * The app's one text-segmentation layer.
 *
 * Everything that counts, compares or transforms text goes through here, so
 * the diff, the similarity metrics, the readability scores and the case
 * transformations can never disagree about where a word or a character
 * starts. Splitting text is the part that looks trivial and is not: a family
 * emoji is one character to a reader and eleven UTF-16 units to `String
 * .length`, and a naive `/\s+/` word count disagrees with a naive `/[.!?]/`
 * sentence count often enough to move a readability grade by a whole year.
 *
 * The platform does the hard part. `Intl.Segmenter` (Chrome 87+, Firefox
 * 125+, Safari 14.1+, Node 16+) implements the Unicode text-segmentation
 * rules, so "character" means what a reader means by character and CJK text
 * — which has no spaces to split on — is segmented properly rather than
 * counted as one enormous word. Where it is missing, the regex fallbacks
 * below take over and say so through `segmenterAvailable()`; they are
 * Latin-centric and approximate, which is exactly what a caller needs to know
 * before it prints a number.
 *
 * One deliberate departure from the raw Unicode rules: sentence breaking is
 * post-processed for abbreviations. UAX #29 breaks "Mr. Smith" into two
 * sentences, because the rule cannot know that `Mr.` is not the end of
 * anything — and a sentence count that is 30% too high drags every
 * words-per-sentence metric down with it.
 *
 * Pure module: no DOM, no state, no I/O.
 */

/* ------------------------------------------------------------ segmenters --- */

type Granularity = 'grapheme' | 'word' | 'sentence';

const cache = new Map<Granularity, Intl.Segmenter | null>();

/** One segmenter per granularity — constructing one is not cheap. */
function segmenter(granularity: Granularity): Intl.Segmenter | null {
  if (cache.has(granularity)) return cache.get(granularity) ?? null;
  let made: Intl.Segmenter | null = null;
  try {
    // Locale 'en' rather than the user's: these counts back stored numbers and
    // test assertions, and a machine's locale must not change what "one word"
    // means. Segmentation rules are overwhelmingly locale-independent anyway.
    made = new Intl.Segmenter('en', { granularity });
  } catch {
    made = null;
  }
  cache.set(granularity, made);
  return made;
}

/** False when this runtime has no `Intl.Segmenter` and the fallbacks are in use. */
export function segmenterAvailable(): boolean {
  return segmenter('grapheme') !== null;
}

/* ------------------------------------------------------------- graphemes --- */

/**
 * User-perceived characters. `[...text]` gives code points, which splits a
 * flag, a skin-toned emoji or a combining accent into pieces no reader would
 * call separate characters.
 */
export function graphemes(text: string): string[] {
  if (text === '') return [];
  const seg = segmenter('grapheme');
  if (seg) return [...seg.segment(text)].map((s) => s.segment);
  // Fallback: code points. Wrong for combining marks and ZWJ sequences, but
  // never worse than UTF-16 units, which is what the alternative would be.
  return [...text];
}

export function countGraphemes(text: string): number {
  return graphemes(text).length;
}

/* ----------------------------------------------------------------- words --- */

/** Word-joining punctuation: a co-op is one word, and so is it's. */
const WORD_JOINERS = new Set(['-', '‐', '‑', "'", '’', '.', '/']);

/**
 * Words, in document order, with their original casing and punctuation.
 *
 * Word-like segments joined by a hyphen or an apostrophe are merged, because
 * `Intl.Segmenter` splits "co-op" into two and no word counter agrees with
 * that. A joiner between a word and a non-word (a dash used as punctuation)
 * is left alone.
 */
export function words(text: string): string[] {
  if (text.trim() === '') return [];
  const seg = segmenter('word');
  if (!seg) {
    return text.match(/[\p{L}\p{N}]+(?:[-'’\p{L}\p{N}]*[\p{L}\p{N}])?/gu) ?? [];
  }
  const parts = [...seg.segment(text)];
  const out: string[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i]!;
    if (!part.isWordLike) continue;
    let word = part.segment;
    // Absorb `joiner + word` pairs while they keep appearing: "mother-in-law".
    while (
      i + 2 < parts.length &&
      !parts[i + 1]!.isWordLike &&
      WORD_JOINERS.has(parts[i + 1]!.segment) &&
      parts[i + 2]!.isWordLike
    ) {
      word += parts[i + 1]!.segment + parts[i + 2]!.segment;
      i += 2;
    }
    out.push(word);
  }
  return out;
}

export function countWords(text: string): number {
  return words(text).length;
}

/** Words lowercased and stripped of edge punctuation — the key for frequency work. */
export function normalizeWord(word: string): string {
  return word
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/[^\p{L}\p{N}]+$/u, '');
}

/* ------------------------------------------------------------- sentences --- */

/**
 * Abbreviations that are never the end of a sentence, because what follows
 * them is a name: `Dr. Jones`, `Fig. 4`, `e.g. this`. Stored without the stop.
 */
const NEVER_FINAL = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'rev', 'hon', 'sr', 'jr', 'st', 'mt',
  'fig', 'no', 'nos', 'vs', 'ca', 'cf', 'ref', 'vol', 'eq', 'pp',
]);

/**
 * Abbreviations that usually sit mid-sentence but are perfectly capable of
 * ending one — `…hats, coats, etc. Then we left.` These merge only when the
 * next chunk starts in lower case, which is the only local evidence there is.
 */
const USUALLY_MEDIAL = new Set([
  'inc', 'ltd', 'co', 'corp', 'dept', 'est', 'univ', 'assn', 'bros',
  'ave', 'blvd', 'rd', 'etc', 'al', 'approx', 'min', 'max', 'sec',
  'hrs', 'hr', 'mins', 'ibid',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sept', 'sep', 'oct', 'nov', 'dec',
  'mon', 'tue', 'tues', 'wed', 'thu', 'thurs', 'fri', 'sat', 'sun',
]);

/** The dotted token a chunk ends on, lowercased, or null. */
function trailingAbbreviation(chunk: string): string | null {
  const trimmed = chunk.trimEnd();
  if (!trimmed.endsWith('.')) return null;
  const tail = /([\p{L}.]+)\.$/u.exec(trimmed);
  return tail ? tail[1]!.toLowerCase() : null;
}

/**
 * Should `next` be glued back onto `previous`?
 *
 * Unicode sentence breaking splits after every full stop followed by a
 * capital, which is right for prose and wrong for every title and initial in
 * it. Titles and initials always merge; the softer class merges only when the
 * next chunk opens in lower case, since `5 p.m. tomorrow` continues and
 * `5 p.m. They left` does not.
 */
function shouldMerge(previous: string, next: string): boolean {
  const token = trailingAbbreviation(previous);
  if (token === null) return false;
  // A single letter is an initial: "J. R. R. Tolkien".
  if (token.length === 1) return true;
  // A dotted acronym — e.g., i.e., U.S. — reads as one word, not an ending.
  const acronym = /^(?:\p{L}\.)+\p{L}$/u.test(token);
  if (NEVER_FINAL.has(token)) return true;
  if (acronym || USUALLY_MEDIAL.has(token)) {
    const first = next.trimStart()[0];
    return first !== undefined && first.toLowerCase() === first && first.toUpperCase() !== first;
  }
  return false;
}

/**
 * Sentences, trimmed, with empty segments dropped.
 *
 * Text with no terminator at all is one sentence, which is what every
 * readability formula needs it to be — dividing by zero sentences is how a
 * grade level becomes `Infinity`.
 */
export function sentences(text: string): string[] {
  if (text.trim() === '') return [];
  const seg = segmenter('sentence');
  const raw = seg
    ? [...seg.segment(text)].map((s) => s.segment)
    : // Fallback: break after a terminator plus optional closing quote/bracket.
      text.split(/(?<=[.!?…]["'’”)\]]*)\s+/u);
  const out: string[] = [];
  for (const chunk of raw) {
    if (chunk.trim() === '') continue;
    const previous = out[out.length - 1];
    if (previous !== undefined && shouldMerge(previous, chunk)) {
      out[out.length - 1] = previous + chunk;
      continue;
    }
    out.push(chunk);
  }
  return out.map((s) => s.trim()).filter((s) => s !== '');
}

export function countSentences(text: string): number {
  return sentences(text).length;
}

/* ------------------------------------------------- paragraphs and lines --- */

/** Blank-line separated blocks, trimmed. */
export function paragraphs(text: string): string[] {
  return text
    .split(/\r?\n[ \t]*(?:\r?\n[ \t]*)+/)
    .map((p) => p.trim())
    .filter((p) => p !== '');
}

/**
 * Raw lines, nothing dropped — a trailing newline yields a final empty
 * string, because a diff has to be able to tell "ends with a newline" from
 * "does not". Counting callers want `countLines`.
 */
export function lines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

/** Lines as a person counts them: the trailing empty line does not count. */
export function countLines(text: string): number {
  if (text === '') return 0;
  const all = lines(text);
  if (all[all.length - 1] === '') all.pop();
  return all.length;
}

/* ----------------------------------------------------------------- sizes --- */

export interface TextSizes {
  /** User-perceived characters. */
  graphemes: number;
  /** Unicode code points — `[...text].length`. */
  codePoints: number;
  /** UTF-16 code units — what `String.length` returns. */
  utf16: number;
  /** Bytes when encoded as UTF-8, which is what a file or a request weighs. */
  bytes: number;
}

const encoder = new TextEncoder();

/**
 * The four numbers that all get called "length", computed separately because
 * they disagree — and the disagreement is the interesting part. For `"é👍🏽"`
 * they are 2, 3, 5 and 12.
 */
export function sizes(text: string): TextSizes {
  return {
    graphemes: countGraphemes(text),
    codePoints: [...text].length,
    utf16: text.length,
    bytes: encoder.encode(text).length,
  };
}

/* ------------------------------------------------------------- syllables --- */

/**
 * Syllables in one word, by heuristic.
 *
 * There is no exact method without a pronunciation dictionary — English
 * spelling does not carry the information ("queue" is one syllable, "business"
 * two, and both fool every rule-based counter including this one). This is the
 * standard vowel-group approach: strip a silent trailing `e`, count runs of
 * vowels, never return less than one. It is right for most ordinary prose and
 * wrong in ways `syllables.test.ts` pins down on purpose, so a change to the
 * rules cannot quietly move every readability score in the app.
 *
 * Non-letters are ignored, so `"don't"` counts as `dont`. A word with no
 * letters at all (a bare numeral) has no syllables and returns 0.
 */
export function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w === '') return 0;
  if (w.length <= 3) return 1;
  const stripped = w
    // Silent e, and the -es/-ed that follow a consonant: cake, tapes, walked.
    .replace(/(?:[^laeiouy]es|[^laeiouy]ed|[^laeiouy]e)$/, '')
    // A leading y is a consonant: "yellow" starts on the e.
    .replace(/^y/, '');
  const groups = stripped.match(/[aeiouy]+/g);
  return Math.max(1, groups ? groups.length : 1);
}

/** SMOG counts words of three or more syllables; this is that test. */
export function isPolysyllabic(word: string): boolean {
  return syllables(word) >= 3;
}

/** Total syllables across the text, using the same word rules as `words()`. */
export function countSyllables(text: string): number {
  let total = 0;
  for (const word of words(text)) total += syllables(word);
  return total;
}

/** How many of the text's words carry three or more syllables. */
export function countPolysyllables(text: string): number {
  let total = 0;
  for (const word of words(text)) if (isPolysyllabic(word)) total += 1;
  return total;
}
