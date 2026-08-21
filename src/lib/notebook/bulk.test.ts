import { describe, expect, it } from 'vitest';
import type { Note } from '../db/types';
import { buildTree } from './model';
import {
  addTags,
  exportFileName,
  flattenTree,
  moveTargets,
  removeTags,
  reparentForDelete,
  subtreeIds,
} from './bulk';

function note(id: string, title: string, parent_id: string | null = null, tags: string[] = []): Note {
  return {
    id,
    title,
    body_md: '',
    aliases: [],
    tags,
    parent_id,
    created_at: 0,
    updated_at: 0,
    deleted_at: null,
  } as unknown as Note;
}

// root-a
//   child-a1
//     grand-a1x
//   child-a2
// root-b
const NOTES = [
  note('a', 'Root A'),
  note('a1', 'Child A1', 'a'),
  note('a1x', 'Grand A1x', 'a1'),
  note('a2', 'Child A2', 'a'),
  note('b', 'Root B'),
];

describe('flattenTree', () => {
  it('lists the tree depth-first with depths, in sidebar order', () => {
    const rows = flattenTree(buildTree(NOTES));
    expect(rows.map((r) => `${r.depth}:${r.note.id}`)).toEqual([
      '0:a',
      '1:a1',
      '2:a1x',
      '1:a2',
      '0:b',
    ]);
  });
});

describe('subtreeIds', () => {
  it('is the note and everything under it', () => {
    const tree = buildTree(NOTES);
    expect(subtreeIds(tree, 'a').sort()).toEqual(['a', 'a1', 'a1x', 'a2']);
    expect(subtreeIds(tree, 'b')).toEqual(['b']);
  });
});

describe('moveTargets', () => {
  it('excludes the selection and everything inside it', () => {
    expect(moveTargets(NOTES, new Set(['a1'])).map((n) => n.id)).toEqual(['a2', 'a', 'b']);
  });

  it('leaves only the top level when everything is selected', () => {
    expect(moveTargets(NOTES, new Set(NOTES.map((n) => n.id)))).toEqual([]);
  });
});

describe('reparentForDelete', () => {
  it('moves children of a deleted note up to its parent', () => {
    expect([...reparentForDelete(NOTES, new Set(['a1']))]).toEqual([['a1x', 'a']]);
  });

  it('skips deleted ancestors until a survivor, or the top level', () => {
    // Deleting a and a1: a1x goes to the top; a2 goes to the top.
    const moves = reparentForDelete(NOTES, new Set(['a', 'a1']));
    expect(new Map(moves)).toEqual(new Map([['a1x', null], ['a2', null]]));
  });

  it('does not touch notes that are themselves deleted, or unaffected', () => {
    const moves = reparentForDelete(NOTES, new Set(['a1', 'a1x']));
    expect(moves.size).toBe(0);
  });

  it('survives a cycle among the deleted notes', () => {
    const cyclic = [note('p', 'P', 'q'), note('q', 'Q', 'p'), note('kid', 'Kid', 'p')];
    expect([...reparentForDelete(cyclic, new Set(['p', 'q']))]).toEqual([['kid', null]]);
  });
});

describe('tags', () => {
  it('adds without duplicates and keeps order', () => {
    expect(addTags(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('removes case-insensitively', () => {
    expect(removeTags(['Work', 'home', 'Urgent'], ['work', 'URGENT'])).toEqual(['home']);
  });
});

describe('exportFileName', () => {
  it('sanitises like the single export and dedupes case-insensitively', () => {
    const taken = new Set<string>();
    expect(exportFileName('My note: draft?', 'md', taken)).toBe('My-note-draft.md');
    expect(exportFileName('my note draft', 'md', taken)).toBe('my-note-draft-2.md');
    expect(exportFileName('   ', 'html', taken)).toBe('Untitled.html');
    expect(exportFileName('', 'html', taken)).toBe('Untitled-2.html');
  });
});
