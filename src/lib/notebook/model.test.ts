import { describe, expect, it } from 'vitest';
import type { Note } from '../db/types';
import { ancestorsOf, buildTree, descendantsOf, normalizeNote, parseTags } from './model';

const note = (id: string, title: string, parent_id: string | null = null): Note => ({
  id,
  title,
  body_md: '',
  aliases: [],
  parent_id,
  tags: [],
  updated_at: '2026-01-01T00:00:00.000Z',
  deleted_at: null,
  server_seq: null,
});

describe('normalizeNote', () => {
  it('coerces the junk the generic data suite writes into json and text columns', () => {
    const row = {
      id: 'n1',
      title: 7 as unknown as string,
      body_md: null as unknown as string,
      aliases: ['a', 'b', 'ünï 😀', 3] as unknown as string[],
      tags: [] as string[],
      parent_id: 'n1',
    };
    const clean = normalizeNote(row as Partial<Note> & { id: string });
    expect(clean.title).toBe('');
    expect(clean.body_md).toBe('');
    expect(clean.aliases).toEqual(['a', 'b', 'ünï 😀']);
    expect(clean.tags).toEqual([]);
    // A self-parent is no parent.
    expect(clean.parent_id).toBeNull();
  });

  it('drops blank and duplicate aliases and tags', () => {
    const clean = normalizeNote({ id: 'x', aliases: ['a', ' ', 'a'], tags: ['t', 't', ''] });
    expect(clean.aliases).toEqual(['a']);
    expect(clean.tags).toEqual(['t']);
  });
});

describe('buildTree', () => {
  it('nests children under a living parent and sorts by title', () => {
    const notes = [note('b', 'Beta'), note('a', 'Alpha'), note('c', 'Child', 'a'), note('d', 'Another child', 'a')];
    const tree = buildTree(notes);
    expect(tree.roots.map((n) => n.id)).toEqual(['a', 'b']);
    expect(tree.children.get('a')!.map((n) => n.id)).toEqual(['d', 'c']);
  });

  it('treats a missing, self or cyclic parent as root rather than hanging', () => {
    const notes = [
      note('orphan', 'Orphan', 'gone'),
      note('self', 'Self', 'self'),
      note('x', 'X', 'y'),
      note('y', 'Y', 'x'),
    ];
    const tree = buildTree(notes);
    const roots = tree.roots.map((n) => n.id).sort();
    // Every member of a cycle surfaces at the root: each one's parent check
    // sees the loop, so neither is hidden under the other and nothing hangs.
    expect(roots).toEqual(['orphan', 'self', 'x', 'y']);
    const total = tree.roots.length + [...tree.children.values()].reduce((n, l) => n + l.length, 0);
    expect(total).toBe(4);
  });

  it('an unnamed note sorts as Untitled', () => {
    const tree = buildTree([note('z', 'Zed'), note('u', '   ')]);
    expect(tree.roots.map((n) => n.id)).toEqual(['u', 'z']);
  });
});

describe('descendantsOf and ancestorsOf', () => {
  const notes = [note('r', 'Root'), note('c1', 'C1', 'r'), note('c2', 'C2', 'r'), note('g', 'G', 'c1')];
  const tree = buildTree(notes);

  it('lists every note under a parent, depth-first, once', () => {
    expect(descendantsOf(tree, 'r').map((n) => n.id).sort()).toEqual(['c1', 'c2', 'g']);
    expect(descendantsOf(tree, 'g')).toEqual([]);
  });

  it('walks to the root for a breadcrumb and stops at a cycle', () => {
    expect(ancestorsOf(notes, notes[3]!).map((n) => n.id)).toEqual(['r', 'c1']);
    const loop = [note('x', 'X', 'y'), note('y', 'Y', 'x')];
    expect(ancestorsOf(loop, loop[0]!).map((n) => n.id)).toEqual(['y']);
  });
});

describe('parseTags', () => {
  it('splits on commas and newlines, trims, dedupes, drops blanks', () => {
    expect(parseTags(' a, b ,,a\nc ')).toEqual(['a', 'b', 'c']);
    expect(parseTags('')).toEqual([]);
  });
});
