/**
 * Text analysis — the counts, the readability scores and the word frequencies
 * behind `/tools/text-analysis/`.
 *
 * The three difficulty metrics are the ones
 * [readn](https://github.com/Descent098/readn) (MIT) computes, ported with its
 * caveat attached: syllable and sentence counting are heuristics, the formulas
 * were fitted to English prose in the middle of the last century, and a score
 * is a smell rather than a measurement. Where a formula cannot honestly be
 * computed — SMOG under thirty sentences — this module returns `null` rather
 * than a number, and the page prints the reason instead.
 *
 * Everything is counted through [tokenize.ts](tokenize.ts), so these numbers
 * agree with the diff's and the similarity tool's by construction.
 *
 * Pure module: no DOM, no state, no I/O.
 */
import {
  countGraphemes,
  countLines,
  normalizeWord,
  paragraphs,
  sentences,
  sizes,
  syllables,
  words,
} from './tokenize';

export interface Counts {
  /** User-perceived characters, spaces included. */
  characters: number;
  charactersNoSpaces: number;
  codePoints: number;
  utf16: number;
  bytes: number;
  words: number;
  uniqueWords: number;
  sentences: number;
  paragraphs: number;
  lines: number;
  syllables: number;
  /** Words of three or more syllables — what SMOG counts. */
  polysyllables: number;
  /** Characters inside words, which is what ARI divides by. */
  charactersInWords: number;
}

export function counts(text: string): Counts {
  const size = sizes(text);
  const list = words(text);
  const unique = new Set<string>();
  let syllableTotal = 0;
  let polysyllables = 0;
  let charactersInWords = 0;
  for (const word of list) {
    const key = normalizeWord(word);
    if (key !== '') unique.add(key);
    const count = syllables(word);
    syllableTotal += count;
    if (count >= 3) polysyllables += 1;
    charactersInWords += countGraphemes(word);
  }
  return {
    characters: size.graphemes,
    charactersNoSpaces: countGraphemes(text.replace(/\s+/gu, '')),
    codePoints: size.codePoints,
    utf16: size.utf16,
    bytes: size.bytes,
    words: list.length,
    uniqueWords: unique.size,
    sentences: sentences(text).length,
    paragraphs: paragraphs(text).length,
    lines: countLines(text),
    syllables: syllableTotal,
    polysyllables,
    charactersInWords,
  };
}

/* ----------------------------------------------------------- readability --- */

export interface Readability {
  /** Flesch reading ease, 0-100ish (it can exceed both ends). */
  flesch: number | null;
  /** The band `flesch` falls in, e.g. "Fairly easy". */
  band: string;
  /** Flesch-Kincaid US grade level. */
  fleschKincaid: number | null;
  /** Automated Readability Index, also a grade level. */
  ari: number | null;
  /** SMOG grade — `null` until there are 30 sentences to compute it from. */
  smog: number | null;
  /** How many more sentences SMOG needs. 0 once it has enough. */
  smogNeeds: number;
  wordsPerSentence: number;
  syllablesPerWord: number;
  charactersPerWord: number;
}

/** SMOG's own requirement: the formula was fitted on 30-sentence samples. */
export const SMOG_MINIMUM_SENTENCES = 30;

const BANDS: [number, string][] = [
  [90, 'Very easy — around a 5th-grade reader'],
  [80, 'Easy — conversational English'],
  [70, 'Fairly easy'],
  [60, 'Plain English — around 8th to 9th grade'],
  [50, 'Fairly difficult'],
  [30, 'Difficult — university level'],
  [0, 'Very difficult — professional or academic'],
];

export function fleschBand(score: number | null): string {
  if (score === null) return 'Not enough text';
  for (const [floor, label] of BANDS) if (score >= floor) return label;
  return 'Very difficult — professional or academic';
}

export function readability(text: string, precounted?: Counts): Readability {
  const c = precounted ?? counts(text);
  const empty = c.words === 0 || c.sentences === 0;
  const wordsPerSentence = empty ? 0 : c.words / c.sentences;
  const syllablesPerWord = empty ? 0 : c.syllables / c.words;
  const charactersPerWord = empty ? 0 : c.charactersInWords / c.words;

  const flesch = empty ? null : 206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord;
  const fleschKincaid = empty ? null : 0.39 * wordsPerSentence + 11.8 * syllablesPerWord - 15.59;
  const ari = empty ? null : 4.71 * charactersPerWord + 0.5 * wordsPerSentence - 21.43;
  const smog =
    c.sentences >= SMOG_MINIMUM_SENTENCES
      ? 1.043 * Math.sqrt((c.polysyllables * 30) / c.sentences) + 3.1291
      : null;

  return {
    flesch,
    band: fleschBand(flesch),
    fleschKincaid,
    ari,
    smog,
    smogNeeds: Math.max(0, SMOG_MINIMUM_SENTENCES - c.sentences),
    wordsPerSentence,
    syllablesPerWord,
    charactersPerWord,
  };
}

/* ------------------------------------------------------------------ time --- */

/**
 * Silent reading of English prose runs at about 238 words per minute and
 * speaking aloud at about 150 (Brysbaert 2019, meta-analysis of 190 studies).
 * Both are averages over adults and ordinary prose — a dense technical page is
 * slower, and nobody reads at exactly the average.
 */
export const READING_WPM = 238;
export const SPEAKING_WPM = 150;

/** Seconds, not minutes: a 40-word note should not read as "0 minutes". */
export function readingSeconds(wordCount: number, wpm = READING_WPM): number {
  if (wordCount <= 0 || wpm <= 0) return 0;
  return (wordCount / wpm) * 60;
}

/** "1 min 20 s", "45 s", "2 h 5 min" — the same voice as the timers. */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
  const hours = Math.floor(minutes / 60);
  const minutesLeft = minutes % 60;
  return minutesLeft === 0 ? `${hours} h` : `${hours} h ${minutesLeft} min`;
}

/* ------------------------------------------------------------- frequency --- */

/**
 * The words that carry no topic. Kept short and obvious: a long list starts
 * hiding words that were the point ("no", "not" and "own" are all on some
 * published lists, and all three can be the finding).
 */
export const STOP_WORDS = new Set([
  'a', 'about', 'after', 'again', 'all', 'also', 'am', 'an', 'and', 'any', 'are', 'as', 'at',
  'be', 'because', 'been', 'before', 'being', 'between', 'both', 'but', 'by',
  'can', 'could', 'did', 'do', 'does', 'doing', 'down', 'during',
  'each', 'few', 'for', 'from', 'further', 'had', 'has', 'have', 'having', 'he', 'her', 'here',
  'hers', 'him', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself',
  'just', 'me', 'more', 'most', 'my', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'our',
  'out', 'over', 'said', 'same', 'she', 'should', 'so', 'some', 'such',
  'than', 'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'those',
  'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was', 'we', 'were', 'what', 'when',
  'where', 'which', 'while', 'who', 'whom', 'why', 'will', 'with', 'would', 'you', 'your',
]);

export interface Frequency {
  term: string;
  count: number;
  /** Share of the counted terms, 0-1. */
  share: number;
}

export interface FrequencyOptions {
  /** Drop the words that carry no topic. */
  dropStopWords?: boolean;
  /** How many rows to return. */
  limit?: number;
  /** 1 for single words, 2 for pairs, 3 for triples. */
  size?: number;
}

/**
 * The commonest words or phrases, most frequent first. Ties break
 * alphabetically so the table is stable between runs.
 *
 * N-grams are built from consecutive words WITHIN a sentence — a phrase that
 * straddles a full stop is not a phrase, and counting it as one is how "the
 * end the beginning" ends up in a top-ten list.
 */
export function frequency(text: string, options: FrequencyOptions = {}): Frequency[] {
  const size = Math.max(1, Math.floor(options.size ?? 1));
  const limit = Math.max(1, Math.floor(options.limit ?? 20));
  const drop = options.dropStopWords ?? false;

  const tally = new Map<string, number>();
  let total = 0;
  for (const sentence of sentences(text)) {
    const list = words(sentence)
      .map(normalizeWord)
      .filter((word) => word !== '');
    if (size === 1) {
      for (const word of list) {
        if (drop && STOP_WORDS.has(word)) continue;
        tally.set(word, (tally.get(word) ?? 0) + 1);
        total += 1;
      }
      continue;
    }
    for (let i = 0; i + size <= list.length; i += 1) {
      const gram = list.slice(i, i + size);
      if (drop && gram.every((word) => STOP_WORDS.has(word))) continue;
      const key = gram.join(' ');
      tally.set(key, (tally.get(key) ?? 0) + 1);
      total += 1;
    }
  }

  return [...tally.entries()]
    .map(([term, count]) => ({ term, count, share: total === 0 ? 0 : count / total }))
    .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term))
    .slice(0, limit);
}
