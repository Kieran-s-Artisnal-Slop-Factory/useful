import { describe, expect, it } from 'vitest';
import {
  contentLines,
  detectLineEnding,
  differsOnlyByLineEnding,
  diffInline,
  diffLines,
  keyFor,
  unifiedDiff,
  wordTokens,
} from './text';

const LEFT = 'one\ntwo\nthree\nfour\nfive\n';
const RIGHT = 'one\n2\nthree\nfour\nfive\nsix\n';

describe('contentLines', () => {
  it('reports the trailing newline instead of inventing a last empty line', () => {
    expect(contentLines('a\nb\n')).toEqual({ list: ['a', 'b'], endsWithNewline: true });
    expect(contentLines('a\nb')).toEqual({ list: ['a', 'b'], endsWithNewline: false });
    expect(contentLines('')).toEqual({ list: [], endsWithNewline: false });
    expect(contentLines('\n')).toEqual({ list: [''], endsWithNewline: true });
  });
});

describe('diffLines', () => {
  it('pairs a removal and an addition into one changed row', () => {
    const { rows, stats } = diffLines(LEFT, RIGHT);
    expect(rows.map((row) => row.kind)).toEqual([
      'equal',
      'replace',
      'equal',
      'equal',
      'equal',
      'insert',
    ]);
    expect(stats.changed).toBe(1);
    expect(stats.insertions).toBe(1);
    expect(stats.deletions).toBe(0);
    expect(stats.unit).toBe('lines');
  });

  it('numbers each side independently', () => {
    const { rows } = diffLines('a\nb\nc\n', 'a\nc\n');
    expect(rows.map((row) => [row.kind, row.left?.number ?? null, row.right?.number ?? null])).toEqual([
      ['equal', 1, 1],
      ['delete', 2, null],
      ['equal', 3, 2],
    ]);
  });

  it('shows what changed inside a rewritten line, not just that it changed', () => {
    const { rows } = diffLines('the quick brown fox\n', 'the quick red fox\n');
    const row = rows[0]!;
    expect(row.kind).toBe('replace');
    expect(row.left?.parts).toEqual([
      { type: 'equal', text: 'the quick ' },
      { type: 'delete', text: 'brown' },
      { type: 'equal', text: ' fox' },
    ]);
    expect(row.right?.parts).toEqual([
      { type: 'equal', text: 'the quick ' },
      { type: 'insert', text: 'red' },
      { type: 'equal', text: ' fox' },
    ]);
  });

  it('forgives case and whitespace only when asked to', () => {
    expect(diffLines('Hello\n', 'hello\n').stats.changed).toBe(1);
    expect(diffLines('Hello\n', 'hello\n', { ignoreCase: true }).rows[0]!.kind).toBe('equal');
    expect(diffLines('  a  \n', 'a\n', { whitespace: 'edges' }).rows[0]!.kind).toBe('equal');
    expect(diffLines('a b\n', 'ab\n', { whitespace: 'all' }).rows[0]!.kind).toBe('equal');
    // ...and the row still carries the original text, never the normalized one.
    expect(diffLines('  a  \n', 'a\n', { whitespace: 'edges' }).rows[0]!.left!.text).toBe('  a  ');
  });

  it('keys are what the options change, one place', () => {
    expect(keyFor('  Mixed Case  ', {})).toBe('  Mixed Case  ');
    expect(keyFor('  Mixed Case  ', { whitespace: 'edges' })).toBe('Mixed Case');
    expect(keyFor('  Mixed Case  ', { whitespace: 'all', ignoreCase: true })).toBe('mixedcase');
  });

  it('is all-equal for identical texts and empty for two empty ones', () => {
    expect(diffLines(LEFT, LEFT).rows.every((row) => row.kind === 'equal')).toBe(true);
    expect(diffLines(LEFT, LEFT).stats.similarity).toBe(1);
    expect(diffLines('', '').rows).toEqual([]);
  });
});

describe('line endings', () => {
  it('names the ending in use', () => {
    expect(detectLineEnding('a\nb')).toBe('lf');
    expect(detectLineEnding('a\r\nb')).toBe('crlf');
    expect(detectLineEnding('a\rb')).toBe('cr');
    expect(detectLineEnding('a\r\nb\nc')).toBe('mixed');
    expect(detectLineEnding('no breaks here')).toBe('none');
  });

  it('spots the file that came back from Windows', () => {
    // Without this, every line reads as deleted and re-added, for no visible
    // reason: the difference is in characters nothing renders.
    expect(differsOnlyByLineEnding('a\nb\n', 'a\r\nb\r\n')).toBe(true);
    expect(differsOnlyByLineEnding('a\nb\n', 'a\nb\n')).toBe(false);
    expect(differsOnlyByLineEnding('a\nb\n', 'a\r\nc\r\n')).toBe(false);
  });
});

describe('diffInline', () => {
  it('diffs prose as one stream, counting words rather than whitespace', () => {
    const { parts, stats } = diffInline('the quick brown fox', 'the quick red fox');
    expect(parts).toEqual([
      { type: 'equal', text: 'the quick ' },
      { type: 'delete', text: 'brown' },
      { type: 'insert', text: 'red' },
      { type: 'equal', text: ' fox' },
    ]);
    expect(stats.insertions).toBe(1);
    expect(stats.deletions).toBe(1);
    expect(stats.unit).toBe('words');
  });

  it('goes down to characters when asked', () => {
    const { parts, stats } = diffInline('colour', 'color', { granularity: 'character' });
    expect(parts.map((part) => part.type + ':' + part.text)).toEqual([
      'equal:colo',
      'delete:u',
      'equal:r',
    ]);
    expect(stats.unit).toBe('characters');
    expect(stats.deletions).toBe(1);
  });

  it('splits words and their whitespace so the stream can be put back together', () => {
    expect(wordTokens('a  b\nc')).toEqual(['a', '  ', 'b', '\n', 'c']);
    const text = 'The  quick\tbrown\nfox.';
    expect(wordTokens(text).join('')).toBe(text);
  });
});

describe('unifiedDiff', () => {
  it('writes what diff -u writes', () => {
    expect(unifiedDiff(LEFT, RIGHT)).toBe(
      [
        '--- original',
        '+++ changed',
        '@@ -1,5 +1,6 @@',
        ' one',
        '-two',
        '+2',
        ' three',
        ' four',
        ' five',
        '+six',
      ].join('\n')
    );
  });

  it('splits into hunks when the context does not reach', () => {
    expect(unifiedDiff(LEFT, RIGHT, { context: 1 })).toBe(
      [
        '--- original',
        '+++ changed',
        '@@ -1,3 +1,3 @@',
        ' one',
        '-two',
        '+2',
        ' three',
        '@@ -5 +5,2 @@',
        ' five',
        '+six',
      ].join('\n')
    );
  });

  it('marks a missing final newline the way git does', () => {
    expect(unifiedDiff('a\nb', 'a\nc')).toBe(
      [
        '--- original',
        '+++ changed',
        '@@ -1,2 +1,2 @@',
        ' a',
        '-b',
        '\\ No newline at end of file',
        '+c',
        '\\ No newline at end of file',
      ].join('\n')
    );
  });

  it('takes the labels it is given, and is empty when nothing changed', () => {
    const patch = unifiedDiff('a\n', 'b\n', { fromLabel: 'a/notes.md', toLabel: 'b/notes.md' });
    expect(patch.split('\n').slice(0, 2)).toEqual(['--- a/notes.md', '+++ b/notes.md']);
    expect(unifiedDiff(LEFT, LEFT)).toBe('');
  });
});
