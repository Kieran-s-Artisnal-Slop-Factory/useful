/**
 * Live regex testing (regex101-style): run the pattern against sample text
 * with the browser's JS engine and hand the UI plain SEGMENTS to render —
 * never HTML strings — so highlighting can't become an injection surface.
 *
 * Matches compile with the `d` flag, so every capturing group carries its
 * span; the UI colors group N the same everywhere (chips and in-match
 * spans), which is what makes "which part did $2 grab" readable at a glance.
 */

export interface RegexTestFlags {
  ignoreCase: boolean;
  multiline: boolean;
  dotAll: boolean;
}

export interface MatchGroup {
  /** 1-based group number ($1, $2…). Named groups keep their number. */
  number: number;
  /** The group's name, when it has one. */
  name: string | null;
  value: string | null;
  /** Span in the OVERALL text; null when the group didn't participate. */
  start: number | null;
  end: number | null;
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
      'dg' +
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
    // Map group names to their numbers by comparing spans + values: in JS a
    // named group IS a numbered group, so we merge rather than list twice.
    const nameByNumber = new Map<number, string>();
    const namedSpans = m.indices?.groups ?? {};
    for (const [name, span] of Object.entries(namedSpans)) {
      for (let i = 1; i < m.length; i++) {
        const numbered = m.indices?.[i];
        const sameSpan =
          (span === undefined && numbered === undefined) ||
          (span !== undefined && numbered !== undefined && span[0] === numbered[0] && span[1] === numbered[1]);
        if (sameSpan && m.groups?.[name] === m[i] && !nameByNumber.has(i)) {
          nameByNumber.set(i, name);
          break;
        }
      }
    }
    const groups: MatchGroup[] = [];
    for (let i = 1; i < m.length; i++) {
      const span = m.indices?.[i];
      groups.push({
        number: i,
        name: nameByNumber.get(i) ?? null,
        value: m[i] ?? null,
        start: span?.[0] ?? null,
        end: span?.[1] ?? null,
      });
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

export interface MatchPart {
  text: string;
  /** The group number this run belongs to (innermost wins), null = the match
   * itself outside any group. */
  groupNumber: number | null;
}

export interface TextSegment {
  text: string;
  /** null = plain text, otherwise the ordinal of the match it belongs to. */
  matchOrdinal: number | null;
  /** Present on match segments: the text split into group-colored runs. */
  parts?: MatchPart[];
}

/** Split the text into plain/matched runs; each match run further splits into
 * group-colored parts (later/inner groups paint over earlier ones). */
export function segmentText(text: string, matches: MatchInfo[]): TextSegment[] {
  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const m of matches) {
    if (m.start > cursor) segments.push({ text: text.slice(cursor, m.start), matchOrdinal: null });
    if (m.end > m.start) {
      segments.push({
        text: text.slice(m.start, m.end),
        matchOrdinal: m.ordinal,
        parts: matchParts(text, m),
      });
    }
    cursor = Math.max(cursor, m.end);
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), matchOrdinal: null });
  return segments;
}

function matchParts(text: string, m: MatchInfo): MatchPart[] {
  const len = m.end - m.start;
  const owner = new Array<number | null>(len).fill(null);
  for (const g of m.groups) {
    if (g.start === null || g.end === null) continue;
    // Clamp: a lookahead's group can capture beyond the match itself.
    const from = Math.max(g.start, m.start);
    const to = Math.min(g.end, m.end);
    for (let i = from; i < to; i++) owner[i - m.start] = g.number;
  }
  const parts: MatchPart[] = [];
  for (let i = 0; i < len; i++) {
    const num = owner[i]!;
    const last = parts[parts.length - 1];
    if (last && last.groupNumber === num) last.text += text[m.start + i]!;
    else parts.push({ text: text[m.start + i]!, groupNumber: num });
  }
  return parts;
}
