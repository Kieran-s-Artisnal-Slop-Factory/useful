/**
 * Wiki links — `[[Title]]` and `[[Title|Label]]` — as a model the notebook
 * can act on: find them, resolve them to a note, rewrite them on rename, and
 * count who links here.
 *
 * Links resolve by TITLE, not id, so a note's `aliases` (its former titles)
 * keep old links working after a rename. Comparison goes through
 * `normalizeTitle` everywhere, so `[[ada  lovelace]]` finds "Ada Lovelace".
 *
 * Scanning runs over `maskCode`'d text (footnotes.ts) — code is blanked with
 * spaces, never removed, so `[[x]]` in a code sample is not a link AND every
 * offset found applies straight to the original string. That second property
 * is what lets `rewriteWikiLinks` splice a rename into the user's document
 * without touching a byte it did not mean to.
 *
 * Backlinks are computed, never stored: a backup restore writes straight into
 * IndexedDB and would leave a stored index stale.
 */
import { maskCode } from './footnotes';

/**
 * One link. The title stops at the first `|`, neither half may contain
 * brackets or a newline. Exported so markdown.ts tokenizes the same syntax.
 */
export const WIKI_LINK_RE = /\[\[([^[\]\n|]+)(?:\|([^[\]\n]*))?\]\]/g;

export interface WikiLink {
  /** The title as written, trimmed. */
  title: string;
  /** The label as written (trimmed), or the title when there is none. */
  label: string;
  /** Offsets of the whole `[[…]]`, in the original string. */
  from: number;
  to: number;
}

/** The shape every resolver here needs; `aliases` is untrusted JSON. */
export interface NoteLike {
  id: string;
  title: string;
  aliases?: unknown;
}

/** A note with a body — what backlinks are counted over. */
export interface LinkingNote extends NoteLike {
  body_md: string;
  updated_at?: string;
}

/** Odd number of backslashes directly before `at` means the bracket is escaped. */
function isEscaped(text: string, at: number): boolean {
  let n = 0;
  for (let i = at - 1; i >= 0 && text[i] === '\\'; i--) n++;
  return n % 2 === 1;
}

/** Every wiki link, in document order — code and escaped brackets excluded. */
export function findWikiLinks(markdown: string): WikiLink[] {
  const masked = maskCode(markdown);
  const found: WikiLink[] = [];
  const pattern = new RegExp(WIKI_LINK_RE.source, 'g');

  for (const match of masked.matchAll(pattern)) {
    const from = match.index!;
    const to = from + match[0].length;
    if (isEscaped(masked, from)) continue;
    // Slice from the ORIGINAL: masking is offset-preserving, so the title is
    // read back exactly as written even when it sits next to blanked code.
    const inner = markdown.slice(from + 2, to - 2);
    const pipe = inner.indexOf('|');
    const title = (pipe === -1 ? inner : inner.slice(0, pipe)).trim();
    if (!title) continue;
    const label = pipe === -1 ? '' : inner.slice(pipe + 1).trim();
    found.push({ title, label: label || title, from, to });
  }
  return found;
}

/** Trim, collapse inner whitespace, NFC — the title as it should be shown. */
export function displayTitle(title: string): string {
  return title.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** `displayTitle` plus case folding — the key two titles are compared by. */
export function normalizeTitle(title: string): string {
  return displayTitle(title).toLowerCase();
}

/** A note's aliases as strings, whatever the json column actually holds. */
export function aliasesOf(note: { aliases?: unknown }): string[] {
  if (!Array.isArray(note.aliases)) return [];
  return note.aliases.filter((a): a is string => typeof a === 'string');
}

/**
 * The note a title points at: a title match beats an alias match, and both
 * are case-insensitive. Null when nothing matches — the "create this note"
 * affordance.
 */
export function resolveNote<T extends NoteLike>(notes: readonly T[], title: string): T | null {
  const key = normalizeTitle(title);
  if (!key) return null;
  const byTitle = notes.find((note) => normalizeTitle(note.title) === key);
  if (byTitle) return byTitle;
  return notes.find((note) => aliasesOf(note).some((a) => normalizeTitle(a) === key)) ?? null;
}

/** Splice a set of replacements in, back to front so offsets stay valid. */
function applyEdits(
  text: string,
  edits: Array<{ from: number; to: number; insert: string }>
): string {
  let out = text;
  for (const edit of [...edits].sort((a, b) => b.from - a.from)) {
    out = out.slice(0, edit.from) + edit.insert + out.slice(edit.to);
  }
  return out;
}

/**
 * Point every `[[fromTitle]]` / `[[fromTitle|Label]]` at `toTitle` instead.
 * Labels survive, code is left alone, and nothing else changes — the title
 * part is the only span that is replaced.
 */
export function rewriteWikiLinks(markdown: string, fromTitle: string, toTitle: string): string {
  const key = normalizeTitle(fromTitle);
  if (!key) return markdown;
  const edits = findWikiLinks(markdown)
    .filter((link) => normalizeTitle(link.title) === key)
    .map((link) => {
      const inner = markdown.slice(link.from + 2, link.to - 2);
      const pipe = inner.indexOf('|');
      const rest = pipe === -1 ? '' : inner.slice(pipe);
      return { from: link.from, to: link.to, insert: `[[${toTitle}${rest}]]` };
    });
  return edits.length ? applyEdits(markdown, edits) : markdown;
}

export interface Backlink<T> {
  note: T;
  /** How many links in `note` point at the target. */
  count: number;
}

/** The normalized titles a link must carry to point at `target`. */
function namesOf(target: NoteLike): Set<string> {
  const names = new Set<string>([normalizeTitle(target.title)]);
  for (const alias of aliasesOf(target)) names.add(normalizeTitle(alias));
  names.delete('');
  return names;
}

/**
 * Every note whose body links to `target` — by its title or any alias — with
 * how many times it does, sorted by title. The target never lists itself.
 */
export function backlinks<T extends LinkingNote>(notes: readonly T[], target: T): Backlink<T>[] {
  const names = namesOf(target);
  const out: Backlink<T>[] = [];
  for (const note of notes) {
    if (note.id === target.id || typeof note.body_md !== 'string') continue;
    const count = findWikiLinks(note.body_md).filter((l) => names.has(normalizeTitle(l.title))).length;
    if (count > 0) out.push({ note, count });
  }
  return out.sort((a, b) => a.note.title.localeCompare(b.note.title));
}

/**
 * `backlinks` with the per-note scan memoized on `id` + `updated_at`, for a
 * view that asks the same question of the same notes on every render. Make one
 * index per view and keep it; hand it the current notes each time. The scan,
 * not the answer, is what is cached: a rename changes the answer for every
 * note without touching most of their bodies.
 */
export function makeBacklinkIndex<T extends LinkingNote>() {
  const cache = new Map<string, { version: string | undefined; titles: string[] }>();
  const titlesIn = (note: T): string[] => {
    const hit = cache.get(note.id);
    if (hit && hit.version === note.updated_at) return hit.titles;
    const titles =
      typeof note.body_md === 'string'
        ? findWikiLinks(note.body_md).map((l) => normalizeTitle(l.title))
        : [];
    cache.set(note.id, { version: note.updated_at, titles });
    return titles;
  };
  return {
    backlinksOf(notes: readonly T[], target: T): Backlink<T>[] {
      const names = namesOf(target);
      const out: Backlink<T>[] = [];
      for (const note of notes) {
        if (note.id === target.id) continue;
        const count = titlesIn(note).filter((t) => names.has(t)).length;
        if (count > 0) out.push({ note, count });
      }
      return out.sort((a, b) => a.note.title.localeCompare(b.note.title));
    },
    /** How many notes the index currently remembers — for tests. */
    get size() {
      return cache.size;
    },
  };
}
