/**
 * Filler text (0.3.0 phase 11).
 *
 * Two corpora, both safe to ship:
 *
 *  - **Lorem ipsum**, the scrambled Cicero every typesetter since the 1500s
 *    has used. It is public domain and its word list is the standard one, so
 *    text generated here looks like text generated anywhere else.
 *  - **Office speak**, written for this repository. The wording on the
 *    office-filler sites is someone else's writing; a corpus we author is a
 *    licence question that never comes up. It is a small grammar rather than
 *    a word soup, because meeting-speak is recognisable by its SHAPE — "we
 *    need to socialise the strategic roadmap before we circle back" — and a
 *    bag of buzzwords in random order just reads as noise.
 *
 * Everything is seeded through [random.ts](../random.ts): the same seed and
 * the same options always produce the same text, so a re-generate is a no-op
 * diff and a unit test can assert on the output.
 */
import { mulberry32, pick, randomInt, seedFrom } from '../random';

/** The standard lorem ipsum vocabulary. */
const LOREM_WORDS = [
  'lorem','ipsum','dolor','sit','amet','consectetur','adipiscing','elit','sed','do','eiusmod','tempor',
  'incididunt','ut','labore','et','dolore','magna','aliqua','enim','ad','minim','veniam','quis','nostrud',
  'exercitation','ullamco','laboris','nisi','aliquip','ex','ea','commodo','consequat','duis','aute','irure',
  'in','reprehenderit','voluptate','velit','esse','cillum','eu','fugiat','nulla','pariatur','excepteur','sint',
  'occaecat','cupidatat','non','proident','sunt','culpa','qui','officia','deserunt','mollit','anim','id','est',
  'laborum','perspiciatis','unde','omnis','iste','natus','error','voluptatem','accusantium','doloremque',
  'laudantium','totam','rem','aperiam','eaque','ipsa','quae','ab','illo','inventore','veritatis','quasi',
  'architecto','beatae','vitae','dicta','explicabo','nemo','voluptas','aspernatur','odit','fugit','consequuntur',
  'magni','dolores','eos','ratione','sequi','nesciunt','neque','porro','quisquam','dolorem','adipisci','numquam',
  'modi','tempora','incidunt','magnam','quaerat','minima','nostrum','exercitationem','corporis','suscipit',
];

export const LOREM_OPENING = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit';

/**
 * The office-speak grammar, written here.
 *
 * Kept as separate word classes so a sentence is assembled rather than
 * quoted: nothing in the output is a phrase lifted from anywhere, and the
 * combinations are what make it funny.
 */
const OFFICE = {
  opener: [
    'Going forward',
    'At the end of the day',
    'From a delivery standpoint',
    'Net net',
    'To be transparent',
    'At a high level',
    'Realistically',
    'Between us',
    'In the current climate',
    'Speaking candidly',
  ],
  subject: [
    'we',
    'the leadership team',
    'the working group',
    'our stakeholders',
    'the wider business',
    'this workstream',
    'the steering committee',
    'everyone in the room',
  ],
  verb: [
    'need to socialise',
    'should double-click on',
    'have to align on',
    'are going to circle back on',
    'want to unpack',
    'must operationalise',
    'plan to sunset',
    'are re-baselining',
    'intend to productise',
    'are pressure-testing',
  ],
  adjective: [
    'strategic',
    'cross-functional',
    'scalable',
    'holistic',
    'best-in-class',
    'low-hanging',
    'north-star',
    'mission-critical',
    'value-added',
    'end-to-end',
    'customer-centric',
    'frictionless',
  ],
  noun: [
    'roadmap',
    'deliverables',
    'synergies',
    'learnings',
    'bandwidth',
    'deep dive',
    'touchpoints',
    'action items',
    'success metrics',
    'paradigm',
    'ecosystem',
    'core competencies',
    'value proposition',
  ],
  closer: [
    'before the next sprint',
    'ahead of the quarterly review',
    'once we have the numbers',
    'without boiling the ocean',
    'to move the needle',
    'so we can fail fast',
    'while keeping the lights on',
    'and take it offline afterwards',
    'assuming capacity holds',
    'pending sign-off',
  ],
};

export type Corpus = 'lorem' | 'office';
export type TextUnit = 'paragraphs' | 'sentences' | 'words';

export const CORPUS_LABELS: Record<Corpus, string> = {
  lorem: 'Lorem ipsum (the classic)',
  office: 'Office speak (written for this app)',
};

export interface TextOptions {
  corpus: Corpus;
  unit: TextUnit;
  /** How many paragraphs, sentences or words. Clamped to 1-500. */
  count: number;
  /** Open with the traditional "Lorem ipsum dolor sit amet…". */
  startWithLorem: boolean;
  /** Wrap each paragraph in `<p>` rather than separating with blank lines. */
  html: boolean;
  /** Any text; a number is used as itself. */
  seed: string;
}

export const DEFAULT_TEXT_OPTIONS: TextOptions = {
  corpus: 'lorem',
  unit: 'paragraphs',
  count: 3,
  startWithLorem: true,
  html: false,
  seed: 'useful',
};

const capitalise = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

const clampCount = (n: number): number =>
  Number.isFinite(n) ? Math.min(500, Math.max(1, Math.trunc(n))) : 1;

/** One lorem sentence: 6-14 words, a comma somewhere in the longer ones. */
function loremSentence(rng: () => number): string {
  const length = randomInt(rng, 6, 14);
  const words: string[] = [];
  for (let i = 0; i < length; i++) words.push(pick(rng, LOREM_WORDS)!);
  if (length > 9) {
    const at = randomInt(rng, 3, length - 3);
    words[at] = `${words[at]},`;
  }
  return `${capitalise(words.join(' '))}.`;
}

/** One office sentence, assembled from the grammar above. */
function officeSentence(rng: () => number): string {
  const opener = rng() < 0.55 ? `${pick(rng, OFFICE.opener)}, ` : '';
  const closer = rng() < 0.7 ? ` ${pick(rng, OFFICE.closer)}` : '';
  const second = rng() < 0.35 ? ` and ${pick(rng, OFFICE.adjective)} ${pick(rng, OFFICE.noun)}` : '';
  const body =
    `${pick(rng, OFFICE.subject)} ${pick(rng, OFFICE.verb)} the ` +
    `${pick(rng, OFFICE.adjective)} ${pick(rng, OFFICE.noun)}${second}`;
  return `${capitalise(`${opener}${body}${closer}`)}.`;
}

const sentenceFor = (corpus: Corpus, rng: () => number): string =>
  corpus === 'office' ? officeSentence(rng) : loremSentence(rng);

/** Words, for the word-count mode. Office words come from its own vocabulary
 * rather than from its sentences, so a 20-word request is 20 words. */
function wordsFor(corpus: Corpus, rng: () => number, count: number): string[] {
  const pool =
    corpus === 'office'
      ? [...OFFICE.adjective, ...OFFICE.noun, ...OFFICE.subject].flatMap((p) => p.split(' '))
      : LOREM_WORDS;
  return Array.from({ length: count }, () => pick(rng, pool)!);
}

/**
 * Generate the text.
 *
 * The traditional opening is prepended to the first sentence rather than
 * counted as one of them, then the rest of that sentence carries on from it —
 * which is what every lorem generator does and what people expect to see.
 */
export function generateText(options: TextOptions): string {
  const rng = mulberry32(seedFrom(options.seed));
  const count = clampCount(options.count);
  // The traditional opening belongs to lorem ipsum. Pasting "Lorem ipsum
  // dolor sit amet" onto the front of office speak is not a feature, so the
  // flag is ignored for the other corpus (and the page hides it there).
  const opening = options.startWithLorem && options.corpus === 'lorem';

  if (options.unit === 'words') {
    const words = wordsFor(options.corpus, rng, count);
    if (opening && options.corpus === 'lorem') {
      const lead = LOREM_OPENING.toLowerCase().replace(/,/g, '').split(' ');
      words.splice(0, Math.min(lead.length, words.length), ...lead.slice(0, count));
    }
    const text = capitalise(words.slice(0, count).join(' '));
    return options.html ? `<p>${text}</p>` : text;
  }

  const paragraphs: string[] = [];
  if (options.unit === 'sentences') {
    const sentences: string[] = [];
    for (let i = 0; i < count; i++) sentences.push(sentenceFor(options.corpus, rng));
    if (opening) sentences[0] = `${LOREM_OPENING}, ${lowerFirst(sentences[0]!)}`;
    paragraphs.push(sentences.join(' '));
  } else {
    for (let p = 0; p < count; p++) {
      const sentences: string[] = [];
      const length = randomInt(rng, 3, 6);
      for (let i = 0; i < length; i++) sentences.push(sentenceFor(options.corpus, rng));
      if (opening && p === 0) sentences[0] = `${LOREM_OPENING}, ${lowerFirst(sentences[0]!)}`;
      paragraphs.push(sentences.join(' '));
    }
  }

  return options.html
    ? paragraphs.map((p) => `<p>${p}</p>`).join('\n')
    : paragraphs.join('\n\n');
}

const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

/** Words, sentences and paragraphs in a block — what the page shows under it. */
export function countText(text: string): { words: number; sentences: number; paragraphs: number } {
  const plain = text.replace(/<[^>]+>/g, ' ');
  const words = plain.split(/\s+/).filter(Boolean).length;
  const sentences = plain.split(/[.!?]+/).filter((s) => s.trim() !== '').length;
  const paragraphs = text.split(/\n{2,}|<\/p>/).filter((p) => p.trim() !== '').length;
  return { words, sentences, paragraphs };
}
