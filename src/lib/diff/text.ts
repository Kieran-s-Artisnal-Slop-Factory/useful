/**
 * Text diffing on top of [myers.ts](myers.ts) — the part that knows about
 * lines, words, whitespace and line endings.
 *
 * Three granularities, because they answer different questions. **Line** is
 * what a diff normally means, and it runs a second word-level pass inside each
 * changed pair of lines so a one-character edit reads as one changed word
 * rather than one deleted line and one added line. **Word** and **character**
 * diff the whole text as one flowing stream, which is what prose wants.
 *
 * Whitespace and case are handled by keying rather than by rewriting: the
 * comparison sees a normalized key, the display always shows the original
 * characters. Deleting the whitespace before diffing would produce a diff of a
 * text nobody wrote.
 *
 * Pure module: no DOM, no state, no I/O.
 */
import { graphemes, lines } from '../text/tokenize';
import { type Change, type ChangeType, diff, similarity } from './myers';

export type Granularity = 'line' | 'word' | 'character';

/** How much whitespace to forgive when deciding whether two tokens match. */
export type WhitespaceMode = 'none' | 'edges' | 'all';

export interface TextDiffOptions {
  granularity?: Granularity;
  ignoreCase?: boolean;
  whitespace?: WhitespaceMode;
  maxCost?: number;
}

export interface InlinePart {
  type: ChangeType;
  text: string;
}

export interface DiffSide {
  /** 1-based line number in that side's text. */
  number: number;
  text: string;
  /** Word-level parts, present only on a `replace` row. */
  parts?: InlinePart[];
}

export interface DiffRow {
  kind: 'equal' | 'insert' | 'delete' | 'replace';
  left: DiffSide | null;
  right: DiffSide | null;
}

export interface DiffStats {
  /** Tokens present only on the right. */
  insertions: number;
  /** Tokens present only on the left. */
  deletions: number;
  /** Lines that changed rather than being purely added or removed. */
  changed: number;
  /** 0–1, twice the shared tokens over the two lengths. */
  similarity: number;
  unit: 'lines' | 'words' | 'characters';
}

export interface LineDiff {
  rows: DiffRow[];
  stats: DiffStats;
  /** True when the edit budget ran out and the middle is one replacement. */
  truncated: boolean;
}

export interface InlineDiff {
  parts: InlinePart[];
  stats: DiffStats;
  truncated: boolean;
}

/* ------------------------------------------------------------ tokenizing --- */

/** Words and the whitespace between them, so the stream can be reassembled. */
export function wordTokens(text: string): string[] {
  return text.match(/\s+|[^\s]+/g) ?? [];
}

export function tokensFor(text: string, granularity: Granularity): string[] {
  if (granularity === 'line') return lines(text);
  if (granularity === 'word') return wordTokens(text);
  return graphemes(text);
}

/** The comparison key for a token: what the options say counts as different. */
export function keyFor(token: string, options: TextDiffOptions): string {
  let key = token;
  if (options.whitespace === 'all') key = key.replace(/\s+/g, '');
  else if (options.whitespace === 'edges') key = key.trim();
  if (options.ignoreCase) key = key.toLowerCase();
  return key;
}

/* ----------------------------------------------------------- line ending --- */

export type LineEnding = 'none' | 'lf' | 'crlf' | 'cr' | 'mixed';

/** Which line ending a text uses — `none` when it has no line break at all. */
export function detectLineEnding(text: string): LineEnding {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const withoutCrlf = text.replace(/\r\n/g, '');
  const lf = (withoutCrlf.match(/\n/g) ?? []).length;
  const cr = (withoutCrlf.match(/\r/g) ?? []).length;
  const kinds = [crlf > 0, lf > 0, cr > 0].filter(Boolean).length;
  if (kinds === 0) return 'none';
  if (kinds > 1) return 'mixed';
  if (crlf > 0) return 'crlf';
  if (lf > 0) return 'lf';
  return 'cr';
}

/**
 * True when the two texts are the same except for how they end their lines.
 *
 * Worth its own answer: without it, a file that came back from Windows shows
 * as every line deleted and every line added, and the reason is invisible.
 */
export function differsOnlyByLineEnding(a: string, b: string): boolean {
  if (a === b) return false;
  const normalize = (text: string) => text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return normalize(a) === normalize(b);
}

/* ------------------------------------------------------------- line diff --- */

/**
 * A text's lines, with the trailing newline reported rather than turned into
 * a final empty line. `"a\nb\n"` is two lines that end in a newline; treating
 * it as three (the last one empty) puts a phantom row in every diff and a
 * phantom context line in every patch.
 */
export function contentLines(text: string): { list: string[]; endsWithNewline: boolean } {
  if (text === '') return { list: [], endsWithNewline: false };
  const list = lines(text);
  const endsWithNewline = list[list.length - 1] === '';
  if (endsWithNewline) list.pop();
  return { list, endsWithNewline };
}

export function diffLines(left: string, right: string, options: TextDiffOptions = {}): LineDiff {
  const a = contentLines(left).list;
  const b = contentLines(right).list;
  const result = diff(a, b, { key: (token) => keyFor(token, options), maxCost: options.maxCost });

  const rows: DiffRow[] = [];
  let leftNumber = 0;
  let rightNumber = 0;
  let changed = 0;

  const changes = result.changes;
  for (let i = 0; i < changes.length; i += 1) {
    const change = changes[i]!;
    if (change.type === 'equal') {
      for (const text of change.tokens) {
        leftNumber += 1;
        rightNumber += 1;
        rows.push({
          kind: 'equal',
          left: { number: leftNumber, text },
          right: { number: rightNumber, text },
        });
      }
      continue;
    }
    if (change.type === 'delete') {
      // A delete run followed by an insert run is a rewrite, not a removal and
      // an unrelated addition — pair them so the row shows what changed.
      const next = changes[i + 1];
      const inserted = next?.type === 'insert' ? next.tokens : [];
      const paired = Math.min(change.tokens.length, inserted.length);
      for (let p = 0; p < paired; p += 1) {
        leftNumber += 1;
        rightNumber += 1;
        changed += 1;
        const from = change.tokens[p]!;
        const to = inserted[p]!;
        const parts = inlineParts(from, to, options);
        rows.push({
          kind: 'replace',
          left: { number: leftNumber, text: from, parts: parts.left },
          right: { number: rightNumber, text: to, parts: parts.right },
        });
      }
      for (let p = paired; p < change.tokens.length; p += 1) {
        leftNumber += 1;
        rows.push({ kind: 'delete', left: { number: leftNumber, text: change.tokens[p]! }, right: null });
      }
      for (let p = paired; p < inserted.length; p += 1) {
        rightNumber += 1;
        rows.push({ kind: 'insert', left: null, right: { number: rightNumber, text: inserted[p]! } });
      }
      if (next?.type === 'insert') i += 1;
      continue;
    }
    for (const text of change.tokens) {
      rightNumber += 1;
      rows.push({ kind: 'insert', left: null, right: { number: rightNumber, text } });
    }
  }

  let insertions = 0;
  let deletions = 0;
  for (const row of rows) {
    if (row.kind === 'insert') insertions += 1;
    if (row.kind === 'delete') deletions += 1;
  }

  return {
    rows,
    truncated: result.truncated,
    stats: {
      insertions,
      deletions,
      changed,
      similarity: similarity(result),
      unit: 'lines',
    },
  };
}

/** The word-level parts inside one replaced line, for both sides. */
function inlineParts(
  from: string,
  to: string,
  options: TextDiffOptions
): { left: InlinePart[]; right: InlinePart[] } {
  const result = diff(wordTokens(from), wordTokens(to), {
    key: (token) => keyFor(token, options),
    maxCost: 600,
  });
  return { left: sideParts(result.changes, 'delete'), right: sideParts(result.changes, 'insert') };
}

/** One side's view of a change list: its own edits plus the shared text. */
function sideParts(changes: Change<string>[], mine: ChangeType): InlinePart[] {
  const out: InlinePart[] = [];
  for (const change of changes) {
    if (change.type !== 'equal' && change.type !== mine) continue;
    const text = change.tokens.join('');
    const last = out[out.length - 1];
    if (last && last.type === change.type) last.text += text;
    else out.push({ type: change.type, text });
  }
  return out;
}

/* ----------------------------------------------------------- inline diff --- */

/** Word- or character-granularity diff of the whole text as one stream. */
export function diffInline(left: string, right: string, options: TextDiffOptions = {}): InlineDiff {
  const granularity = options.granularity === 'character' ? 'character' : 'word';
  const a = tokensFor(left, granularity);
  const b = tokensFor(right, granularity);
  const result = diff(a, b, { key: (token) => keyFor(token, options), maxCost: options.maxCost });

  const parts: InlinePart[] = [];
  let insertions = 0;
  let deletions = 0;
  for (const change of result.changes) {
    const text = change.tokens.join('');
    if (change.type !== 'equal') {
      // Whitespace-only tokens are not words; counting them would report two
      // changes for every one a reader can see.
      const countable = change.tokens.filter((token) => token.trim() !== '').length;
      if (change.type === 'insert') insertions += countable;
      else deletions += countable;
    }
    const last = parts[parts.length - 1];
    if (last && last.type === change.type) last.text += text;
    else parts.push({ type: change.type, text });
  }

  return {
    parts,
    truncated: result.truncated,
    stats: {
      insertions,
      deletions,
      changed: 0,
      similarity: similarity(result),
      unit: granularity === 'character' ? 'characters' : 'words',
    },
  };
}

/* ---------------------------------------------------------- unified diff --- */

export interface UnifiedOptions extends TextDiffOptions {
  /** Unchanged lines kept around each hunk. Three is what `diff -u` uses. */
  context?: number;
  fromLabel?: string;
  toLabel?: string;
}

/**
 * The `diff -u` form — `---`/`+++` headers, `@@` hunks, one leading space on
 * every context line. This is the shape a patch tool, a code review and a
 * pasted bug report all expect, so it is the form the copy button produces.
 */
export function unifiedDiff(left: string, right: string, options: UnifiedOptions = {}): string {
  const context = Math.max(0, options.context ?? 3);
  const { rows } = diffLines(left, right, options);
  if (rows.every((row) => row.kind === 'equal')) return '';

  // A replace row is a delete and an insert once the file is written out.
  interface Emitted {
    kind: 'equal' | 'insert' | 'delete';
    text: string;
    leftNumber: number;
    rightNumber: number;
  }
  const flat: Emitted[] = [];
  for (const row of rows) {
    if (row.kind === 'equal') {
      flat.push({
        kind: 'equal',
        text: row.left!.text,
        leftNumber: row.left!.number,
        rightNumber: row.right!.number,
      });
    } else if (row.kind === 'replace') {
      flat.push({ kind: 'delete', text: row.left!.text, leftNumber: row.left!.number, rightNumber: 0 });
      flat.push({ kind: 'insert', text: row.right!.text, leftNumber: 0, rightNumber: row.right!.number });
    } else if (row.kind === 'delete') {
      flat.push({ kind: 'delete', text: row.left!.text, leftNumber: row.left!.number, rightNumber: 0 });
    } else {
      flat.push({ kind: 'insert', text: row.right!.text, leftNumber: 0, rightNumber: row.right!.number });
    }
  }

  // Group changed lines into hunks, keeping `context` unchanged lines around
  // each and merging hunks that would otherwise overlap.
  const changedAt = flat.map((entry) => entry.kind !== 'equal');
  const hunks: { start: number; end: number }[] = [];
  for (let i = 0; i < flat.length; i += 1) {
    if (!changedAt[i]) continue;
    const start = Math.max(0, i - context);
    const end = Math.min(flat.length - 1, i + context);
    const last = hunks[hunks.length - 1];
    if (last && start <= last.end + 1) last.end = Math.max(last.end, end);
    else hunks.push({ start, end });
  }

  // Which entries are the final line of their side, so the missing-newline
  // marker can be attached where `diff -u` puts it.
  const leftInfo = contentLines(left);
  const rightInfo = contentLines(right);
  const lastLeft = leftInfo.list.length;
  const lastRight = rightInfo.list.length;

  const out: string[] = [`--- ${options.fromLabel ?? 'original'}`, `+++ ${options.toLabel ?? 'changed'}`];
  for (const hunk of hunks) {
    const slice = flat.slice(hunk.start, hunk.end + 1);
    const leftCount = slice.filter((entry) => entry.kind !== 'insert').length;
    const rightCount = slice.filter((entry) => entry.kind !== 'delete').length;
    const leftStart = slice.find((entry) => entry.kind !== 'insert')?.leftNumber ?? 0;
    const rightStart = slice.find((entry) => entry.kind !== 'delete')?.rightNumber ?? 0;
    out.push(`@@ -${range(leftStart, leftCount)} +${range(rightStart, rightCount)} @@`);
    for (const entry of slice) {
      const marker = entry.kind === 'equal' ? ' ' : entry.kind === 'insert' ? '+' : '-';
      out.push(marker + entry.text);
      const endsLeft = entry.kind !== 'insert' && entry.leftNumber === lastLeft && !leftInfo.endsWithNewline;
      const endsRight = entry.kind !== 'delete' && entry.rightNumber === lastRight && !rightInfo.endsWithNewline;
      if (endsLeft || endsRight) out.push('\\ No newline at end of file');
    }
  }
  return out.join('\n');
}

/** `12,4`, or just `12` for a single line — the form `diff -u` writes. */
function range(start: number, count: number): string {
  if (count === 0) return `${Math.max(0, start - 1)},0`;
  return count === 1 ? `${start}` : `${start},${count}`;
}
