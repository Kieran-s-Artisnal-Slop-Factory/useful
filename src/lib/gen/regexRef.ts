/**
 * The symbol lookup table (regex101-style quick reference) — static data the
 * regex page renders and filters. Meanings describe the common JS/PCRE
 * behavior; engine caveats live in the snippet warnings, not here.
 */

export interface RefEntry {
  token: string;
  meaning: string;
  example: string;
}

export interface RefGroup {
  category: string;
  entries: RefEntry[];
}

export const REGEX_REFERENCE: RefGroup[] = [
  {
    category: 'Anchors',
    entries: [
      { token: '^', meaning: 'Start of string (or line with the m flag)', example: '^Hello matches "Hello world", not "say Hello"' },
      { token: '$', meaning: 'End of string (or line with the m flag)', example: 'end$ matches "the end"' },
      { token: '\\b', meaning: 'Word boundary — the edge between a word character and a non-word character', example: '\\bcat\\b matches "cat" but not "concatenate"' },
      { token: '\\B', meaning: 'NOT a word boundary', example: '\\Bcat matches the "cat" in "concatenate"' },
    ],
  },
  {
    category: 'Character classes',
    entries: [
      { token: '.', meaning: 'Any single character except a newline (any at all with the s flag)', example: 'h.t matches "hat", "hot", "h9t"' },
      { token: '\\d', meaning: 'A digit 0–9', example: '\\d\\d matches "42"' },
      { token: '\\D', meaning: 'Anything that is NOT a digit', example: '\\D+ matches "abc!"' },
      { token: '\\w', meaning: 'A word character: letter, digit or underscore', example: '\\w+ matches "hello_42"' },
      { token: '\\W', meaning: 'Anything that is NOT a word character', example: '\\W matches "!" or a space' },
      { token: '\\s', meaning: 'A whitespace character (space, tab, newline)', example: 'a\\sb matches "a b"' },
      { token: '\\S', meaning: 'Anything that is NOT whitespace', example: '\\S+ matches "word"' },
      { token: '[abc]', meaning: 'Any ONE of the characters in the set', example: '[bcr]at matches "bat", "cat", "rat"' },
      { token: '[^abc]', meaning: 'Any one character NOT in the set', example: '[^b]at matches "cat", not "bat"' },
      { token: '[a-z]', meaning: 'Any one character in the range', example: '[0-5] matches "3", not "7"' },
    ],
  },
  {
    category: 'Quantifiers',
    entries: [
      { token: '*', meaning: 'The previous item, zero or more times', example: 'lo*l matches "ll", "lol", "loool"' },
      { token: '+', meaning: 'The previous item, one or more times', example: 'lo+l matches "lol", not "ll"' },
      { token: '?', meaning: 'The previous item, optional (zero or one)', example: 'colou?r matches "color" and "colour"' },
      { token: '{3}', meaning: 'Exactly 3 of the previous item', example: '\\d{4} matches "2026"' },
      { token: '{3,}', meaning: '3 or more of the previous item', example: 'a{2,} matches "aaa"' },
      { token: '{3,5}', meaning: 'Between 3 and 5 of the previous item', example: '\\d{2,4} matches "123"' },
      { token: '*?', meaning: 'Lazy version — matches as LITTLE as possible (also +? and ??)', example: '<.+?> matches "<a>" inside "<a><b>", not the whole thing' },
    ],
  },
  {
    category: 'Groups & references',
    entries: [
      { token: '(abc)', meaning: 'Capturing group — matched text is remembered as $1, $2…', example: '(\\d+)-(\\d+) captures "12" and "34" from "12-34"' },
      { token: '(?:abc)', meaning: 'Non-capturing group — groups without remembering', example: '(?:ab)+ matches "abab" with nothing captured' },
      { token: '(?<name>abc)', meaning: 'Named capturing group', example: '(?<year>\\d{4}) captures 2026 as "year"' },
      { token: '\\1', meaning: 'Backreference — match group 1\u2019s text again (not in Go/Rust)', example: '(\\w)\\1 matches the "oo" in "look"' },
      { token: '\\k<name>', meaning: 'Backreference to a named group (not in Go/Rust)', example: '(?<q>["\'])\\k<q> matches a matching quote pair' },
      { token: 'a|b', meaning: 'Alternation — either the left or the right side', example: 'cat|dog matches "cat" or "dog"' },
    ],
  },
  {
    category: 'Lookaround',
    entries: [
      { token: '(?=abc)', meaning: 'Lookahead — the next text must match, but is not consumed (not in Go/Rust)', example: '\\d+(?=px) matches the "16" in "16px"' },
      { token: '(?!abc)', meaning: 'Negative lookahead — the next text must NOT match (not in Go/Rust)', example: '\\d+(?!px) matches "16" in "16em"' },
      { token: '(?<=abc)', meaning: 'Lookbehind — the preceding text must match (not in Go/Rust)', example: '(?<=\\$)\\d+ matches the "5" in "$5"' },
      { token: '(?<!abc)', meaning: 'Negative lookbehind — the preceding text must NOT match (not in Go/Rust)', example: '(?<!\\$)\\b\\d+ matches "5" but not the 5 in "$5"' },
    ],
  },
  {
    category: 'Escapes',
    entries: [
      { token: '\\.', meaning: 'A literal dot (same for \\* \\+ \\? \\( \\[ \\{ \\| \\^ \\$)', example: '3\\.14 matches "3.14", not "3x14"' },
      { token: '\\\\', meaning: 'A literal backslash', example: 'C:\\\\ matches "C:\\"' },
      { token: '\\n', meaning: 'A newline character', example: 'end\\n matches "end" followed by a line break' },
      { token: '\\t', meaning: 'A tab character', example: 'a\\tb matches "a<TAB>b"' },
    ],
  },
];

/** Case-insensitive substring filter over token + meaning; empty query = all. */
export function filterReference(query: string): RefGroup[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return REGEX_REFERENCE;
  return REGEX_REFERENCE.map((group) => ({
    category: group.category,
    entries: group.entries.filter(
      (e) => e.token.toLowerCase().includes(q) || e.meaning.toLowerCase().includes(q)
    ),
  })).filter((g) => g.entries.length > 0);
}
