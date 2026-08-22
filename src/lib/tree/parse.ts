/**
 * Reading a directory listing back into a tree (0.3.0 phase 9).
 *
 * Six shapes go in — `ls`, `ls -1`, `ls -R`, `dir`, `dir /b /s`, and the
 * output of `tree` itself — plus a plain indented tree typed by hand. The
 * format is sniffed rather than chosen from a dropdown, because nobody pasting
 * a listing knows what this tool calls it.
 *
 * The rule throughout: **a line that could not be read is reported, not
 * dropped.** Every parser returns its warnings with the line number and the
 * text, and the page lists them under the result. Noise that every listing
 * carries — `total 24`, `Volume in drive C has no label`, `2 directories, 3
 * files` — is recognised and skipped silently; anything else that fails is the
 * user's problem to see, not ours to hide.
 *
 * Everything reduces to `Entry[]` (a path and a kind), which
 * [model.ts](./model.ts)'s `fromEntries` turns into the tree. That is the only
 * contract a new format has to meet.
 */
import { fromEntries, type Entry, type NodeKind, type TreeNode } from './model';

export type ListingFormat =
  | 'windows-dir'
  | 'paths'
  | 'tree'
  | 'ls-recursive'
  | 'indented'
  | 'flat';

export interface ParseWarning {
  /** 1-based line number in the pasted text. */
  line: number;
  text: string;
  reason: string;
}

export interface ParseResult {
  root: TreeNode;
  format: ListingFormat;
  warnings: ParseWarning[];
  /** How many entries were understood. Zero means nothing was recognised. */
  entries: number;
}

export const FORMAT_LABELS: Record<ListingFormat, string> = {
  'windows-dir': 'Windows `dir`',
  paths: 'Full paths (`dir /b /s`, `find`)',
  tree: '`tree` output',
  'ls-recursive': '`ls -R`',
  indented: 'An indented tree',
  flat: 'A flat list (`ls`, `ls -1`)',
};

/** Lines every listing carries that mean nothing to a tree. */
const NOISE = [
  /^\s*$/,
  /^\s*total\s+\d+/i,
  /^\s*Volume\s/i,
  /^\s*Directory\s+of\s*$/i,
  /^\s*\d+\s+File\(s\)/i,
  /^\s*\d+\s+Dir\(s\)/i,
  /^\s*\d+\s+directories?,\s*\d+\s+files?/i,
  /^\s*Folder PATH listing/i,
  /^\s*Volume serial number/i,
  /^\s*\.{1,2}\s*$/,
  /^[-=]{3,}$/,
];

const isNoise = (line: string): boolean => NOISE.some((re) => re.test(line));

/** Extensions are the only hint a bare name gives about what it is. A leaf
 * with a dot in the middle is a file; anything else is only a guess, and the
 * guess is "file" because a folder with no children is rare in a listing. */
const looksLikeFile = (name: string): boolean => /\.[^.\s]+$/.test(name);

const splitPath = (path: string): string[] =>
  path
    .replace(/[\\/]+$/, '')
    .split(/[\\/]+/)
    .filter((s) => s !== '' && s !== '.');

// ---- sniffing ---------------------------------------------------------------

/**
 * Which format is this?
 *
 * Order matters and is the whole design: the checks run from most distinctive
 * marker to least, so a `tree` listing is never mistaken for an indented one
 * (it IS one, with box-drawing characters) and a flat list is only what is
 * left when nothing else fits.
 */
export function sniff(text: string): ListingFormat {
  const lines = text.split(/\r?\n/).filter((l) => !isNoise(l));
  if (lines.length === 0) return 'flat';

  if (/^\s*Directory of\s+\S/im.test(text)) return 'windows-dir';
  if (lines.some((l) => /[├└│]/.test(l) || /^[\s|`]*[|`]--/.test(l))) return 'tree';

  const absolute = lines.filter((l) => /^\s*(?:[A-Za-z]:[\\/]|\\\\|\/)[^\s]/.test(l));
  if (absolute.length >= Math.max(1, lines.length * 0.6)) return 'paths';

  // `ls -R` headers are a path ending in a colon, with entries under them.
  if (lines.some((l) => /^\S.*:$/.test(l.trimEnd()) && !/^[A-Za-z]:$/.test(l.trim()))) {
    return 'ls-recursive';
  }

  if (lines.some((l) => /^[ \t]+\S/.test(l))) return 'indented';
  return 'flat';
}

// ---- the parsers ------------------------------------------------------------

interface Parsed {
  entries: Entry[];
  warnings: ParseWarning[];
  /**
   * The name the listing gave its own root, when it gave one.
   *
   * `dir` heads its output with the directory it listed, `tree` opens with it,
   * and a hand-typed tree starts with the project name. Throwing that away and
   * calling everything "project" loses the one piece of context the paste
   * carried for free.
   */
  rootName?: string;
}

/**
 * Windows `dir`. Directory headers set the context; each entry line carries a
 * date, a time, then either `<DIR>` or a size, then the name — which may
 * contain spaces, so the name is everything after the marker rather than the
 * last column.
 */
function parseWindowsDir(lines: string[]): Parsed {
  const entries: Entry[] = [];
  const warnings: ParseWarning[] = [];
  let base: string[] = [];
  let root: string[] | null = null;

  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    if (isNoise(line)) return;

    const header = /^\s*Directory of\s+(.+?)\s*$/i.exec(line);
    if (header) {
      const segments = splitPath(header[1]!);
      // The first header is the tree's root; everything after it is relative
      // to that, so a listing of C:\proj does not come back as C:, then proj.
      root ??= segments;
      base = segments.slice(root.length);
      return;
    }

    const entry = /^\s*\d{2,4}[-/]\d{2}[-/]\d{2,4}\s+\S+\s*(?:AM|PM)?\s+(<DIR>|[\d.,]+)\s+(.+?)\s*$/i.exec(line);
    if (entry) {
      const name = entry[2]!;
      if (name === '.' || name === '..') return;
      entries.push({ path: [...base, name], kind: entry[1]!.toUpperCase() === '<DIR>' ? 'folder' : 'file' });
      return;
    }

    warnings.push({ line: i + 1, text: line, reason: 'not a `dir` entry line' });
  });

  return { entries, warnings, rootName: rootLabel(root ?? []) };
}

/** The last segment of a path, unless it is only a drive or a dot. */
function rootLabel(segments: string[]): string | undefined {
  const last = segments[segments.length - 1];
  if (!last || last === '.' || last === '..' || /^[A-Za-z]:\.?$/.test(last)) return undefined;
  return last;
}

/**
 * One absolute path per line (`dir /b /s`, `find .`).
 *
 * The common prefix of every path becomes the root, so a listing of one
 * project does not come back nested twelve deep under `C:`. A path that is a
 * prefix of another is a folder by definition; the rest fall back to the
 * extension guess.
 */
function parsePaths(lines: string[]): Parsed {
  const warnings: ParseWarning[] = [];
  const paths: string[][] = [];

  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (isNoise(line)) return;
    const segments = splitPath(line);
    if (segments.length === 0) {
      warnings.push({ line: i + 1, text: line, reason: 'no path on this line' });
      return;
    }
    paths.push(segments);
  });

  const prefix = commonPrefix(paths);
  const trimmed = paths.map((p) => p.slice(prefix.length)).filter((p) => p.length > 0);
  const folders = new Set<string>();
  for (const p of trimmed) {
    for (let i = 1; i < p.length; i++) folders.add(p.slice(0, i).join('\u0000'));
  }
  const entries: Entry[] = trimmed.map((path) => ({
    path,
    kind: folders.has(path.join('\u0000')) ? 'folder' : guessKind(path[path.length - 1]!),
  }));
  return { entries, warnings, rootName: rootLabel(prefix) };
}

function commonPrefix(paths: string[][]): string[] {
  if (paths.length === 0) return [];
  // Never eat the last segment of the shortest path: if every line is under
  // one directory, that directory is the root and must survive as one.
  const limit = Math.min(...paths.map((p) => p.length)) - 1;
  const out: string[] = [];
  for (let i = 0; i < limit; i++) {
    const segment = paths[0]![i]!;
    if (paths.every((p) => p[i] === segment)) out.push(segment);
    else break;
  }
  return out;
}

const guessKind = (name: string): NodeKind => (looksLikeFile(name) ? 'file' : 'folder');

/**
 * The output of `tree` — both dialects.
 *
 * Unix draws `├── name`, Windows `tree /f` draws `├───name` and lists files
 * under a folder with plain indentation. Both put a name at a column that is a
 * multiple of four, so depth is read from WHERE the name starts rather than
 * from counting connectors — which is what makes one parser handle both, and
 * an indented tree as well.
 */
function parseTreeOutput(lines: string[]): Parsed {
  return parseByIndent(lines, (raw) => {
    const line = raw.replace(/\s+$/, '');
    if (line.trim() === '') return null;
    // Three groups: the vertical rails, the connector, then the name. The
    // connector alternation is what lets one parser read box-drawing output
    // and the pure-ASCII fallback (`|--`, `` `-- ``) our own renderer emits.
    const match = /^([\s│|`+]*)((?:[├└`+][-─]+|--)?\s?)(.*)$/u.exec(line);
    if (!match) return null;
    const name = match[3]!.trim();
    if (name === '') return null;
    return { column: line.length - match[3]!.length, name };
  });
}

/** A hand-typed indented tree: depth is leading whitespace, tabs counted as
 * one level each. */
function parseIndented(lines: string[]): Parsed {
  return parseByIndent(lines, (raw) => {
    if (raw.trim() === '') return null;
    const indent = /^[\t ]*/.exec(raw)![0];
    const column = indent.replace(/\t/g, '    ').length;
    return { column, name: raw.trim() };
  });
}

/**
 * Shared spine for the two indentation formats.
 *
 * Columns are turned into depths by keeping a stack of the columns seen so
 * far, rather than dividing by a fixed width: `tree` indents by four but a
 * hand-typed tree indents by two, and a listing that mixes them still has an
 * unambiguous nesting order.
 */
function parseByIndent(
  lines: string[],
  read: (line: string) => { column: number; name: string } | null
): Parsed {
  const warnings: ParseWarning[] = [];
  const rows: { column: number; name: string }[] = [];

  lines.forEach((raw, i) => {
    if (isNoise(raw)) return;
    const parsed = read(raw);
    if (!parsed) {
      warnings.push({ line: i + 1, text: raw.trim(), reason: 'no name on this line' });
      return;
    }
    rows.push(parsed);
  });

  // A listing usually opens with the directory it is a listing OF (`.`,
  // `C:.`, `project/`), and that line is the tree's root rather than an entry
  // in it. It counts as the root only when it is the ONLY line at the outer
  // level — otherwise these are siblings, and eating the first one would
  // silently reparent all the rest under it.
  const outer = rows[0]?.column ?? 0;
  const atOuter = rows.filter((r) => r.column === outer).length;
  const hasRootLine = atOuter === 1 && rows.length > 1;
  const body = hasRootLine ? rows.slice(1) : rows;
  const rootName = hasRootLine ? rootLabel(splitPath(rows[0]!.name)) : undefined;

  const entries: Entry[] = [];
  const stack: { column: number; path: string[] }[] = [];
  for (const row of body) {
    while (stack.length > 0 && stack[stack.length - 1]!.column >= row.column) stack.pop();
    const parent = stack[stack.length - 1] ?? { column: -1, path: [] };
    const trailing = /[\\/]$/.test(row.name);
    const name = row.name.replace(/[\\/]+$/, '');
    if (name === '') continue;
    const path = [...parent.path, name];
    entries.push({ path, kind: trailing ? 'folder' : guessKind(name) });
    stack.push({ column: row.column, path });
  }

  return { entries, warnings, rootName };
}

/**
 * `ls -R`: blocks headed by `path:`, each holding that directory's names.
 * Plain `ls` puts several names on one line separated by runs of spaces, so
 * columns are split apart — a name with a single space in it survives.
 */
function parseLsRecursive(lines: string[]): Parsed {
  const entries: Entry[] = [];
  const warnings: ParseWarning[] = [];
  let base: string[] = [];

  lines.forEach((raw, i) => {
    const line = raw.replace(/\s+$/, '');
    if (isNoise(line)) return;

    const header = /^(\S.*):$/.exec(line);
    if (header) {
      base = splitPath(header[1]!);
      if (base.length > 0) entries.push({ path: base, kind: 'folder' });
      return;
    }
    if (/^\s/.test(line)) {
      warnings.push({ line: i + 1, text: line.trim(), reason: 'indented under `ls -R`, which does not indent' });
      return;
    }
    for (const name of splitColumns(line)) {
      entries.push({ path: [...base, name], kind: guessKind(name) });
    }
  });

  return { entries, warnings };
}

/** One `ls` line into names: two or more spaces separate columns. */
function splitColumns(line: string): string[] {
  return line
    .split(/\s{2,}|\t+/)
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

function parseFlat(lines: string[]): Parsed {
  const entries: Entry[] = [];
  const warnings: ParseWarning[] = [];
  lines.forEach((raw, i) => {
    if (isNoise(raw)) return;
    const names = splitColumns(raw.trim());
    if (names.length === 0) {
      warnings.push({ line: i + 1, text: raw.trim(), reason: 'nothing on this line' });
      return;
    }
    for (const name of names) {
      const trailing = /[\\/]$/.test(name);
      const clean = name.replace(/[\\/]+$/, '');
      if (clean === '') continue;
      entries.push({ path: [clean], kind: trailing ? 'folder' : guessKind(clean) });
    }
  });
  return { entries, warnings };
}

// ---- the front door ---------------------------------------------------------

const PARSERS: Record<ListingFormat, (lines: string[]) => Parsed> = {
  'windows-dir': parseWindowsDir,
  paths: parsePaths,
  tree: parseTreeOutput,
  'ls-recursive': parseLsRecursive,
  indented: parseIndented,
  flat: parseFlat,
};

/**
 * Parse a pasted listing into a tree.
 *
 * Pass `format` to override the sniffer — the page offers it, because a
 * listing that looks like two things should be the user's call and not a
 * coin toss.
 */
export function parseListing(text: string, format?: ListingFormat, rootName = 'project'): ParseResult {
  const chosen = format ?? sniff(text);
  const lines = text.split(/\r?\n/);
  const parsed = PARSERS[chosen](lines);
  const { entries, warnings } = parsed;
  return {
    root: fromEntries(entries, parsed.rootName ?? rootName),
    format: chosen,
    warnings,
    entries: entries.length,
  };
}
