/**
 * Live regex testing (regex101-style): run the pattern against sample text
 * with the browser's JS engine and hand the UI plain SEGMENTS to render —
 * never HTML strings — so highlighting can't become an injection surface.
 */

export interface RegexTestFlags {
  ignoreCase: boolean;
  multiline: boolean;
  dotAll: boolean;
}

export interface MatchGroup {
  /** "$1", "$2"… for numbered groups, the group's name for named ones. */
  label: string;
  value: string | null;
}

export interface MatchInfo {
  /** 0-based ordinal of the match. */
  ordinal: number;
  start: number;
  end: number;
  text: string;
  groups: MatchGroup[];
}

export interface RegexTestResult {
  matches: MatchInfo[];
  truncated: boolean;
}

/** Cap so a pathological pattern can't freeze the page rendering rows. */
export const MAX_MATCHES = 500;

/** null when the pattern doesn't compile. Always matches globally. */
export function findMatches(
  pattern: string,
  flags: RegexTestFlags,
  text: string
): RegexTestResult | null {
  let re: RegExp;
  try {
    re = new RegExp(
      pattern,
      'g' +
        (flags.ignoreCase ? 'i' : '') +
        (flags.multiline ? 'm' : '') +
        (flags.dotAll ? 's' : '')
    );
  } catch {
    return null;
  }
  const matches: MatchInfo[] = [];
  let truncated = false;
  for (const m of text.matchAll(re)) {
    if (matches.length >= MAX_MATCHES) {
      truncated = true;
      break;
    }
    const groups: MatchGroup[] = [];
    for (let i = 1; i < m.length; i++) groups.push({ label: '$' + i, value: m[i] ?? null });
    for (const [name, value] of Object.entries(m.groups ?? {})) {
      groups.push({ label: name, value: value ?? null });
    }
    matches.push({
      ordinal: matches.length,
      start: m.index,
      end: m.index + m[0].length,
      text: m[0],
      groups,
    });
  }
  return { matches, truncated };
}

export interface TextSegment {
  text: string;
  /** null = plain text, otherwise the ordinal of the match it belongs to. */
  matchOrdinal: number | null;
}

/** Split the text into plain/matched runs for the highlighter to render. */
export function segmentText(text: string, matches: MatchInfo[]): TextSegment[] {
  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const m of matches) {
    if (m.start > cursor) segments.push({ text: text.slice(cursor, m.start), matchOrdinal: null });
    // Zero-length matches produce no visible run — skip the empty segment.
    if (m.end > m.start) segments.push({ text: text.slice(m.start, m.end), matchOrdinal: m.ordinal });
    cursor = Math.max(cursor, m.end);
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), matchOrdinal: null });
  return segments;
}
