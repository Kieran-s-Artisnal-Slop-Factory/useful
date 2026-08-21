/**
 * The notebook's pure helpers over Note rows: read-side normalization and the
 * tree the sidebar draws.
 *
 * Two facts shape this module. Nothing read from a stored row is trusted —
 * the generic data suite writes an ARRAY into every json column and can
 * self-parent a row, and a backup is hand-editable. And the tree must never
 * hang: a parent that is missing, tombstoned, the note itself, or part of a
 * cycle is treated as "root", because the only alternative is a sidebar that
 * never finishes drawing.
 */
import type { Note } from '../db/types';

/** Re-shape a stored row into a well-formed Note without writing anything. */
export function normalizeNote(row: Partial<Note> & { id: string }): Note {
  const strings = (value: unknown): string[] =>
    Array.isArray(value)
      ? [...new Set(value.filter((v): v is string => typeof v === 'string' && v.trim() !== ''))]
      : [];
  return {
    ...(row as Note),
    title: typeof row.title === 'string' ? row.title : '',
    body_md: typeof row.body_md === 'string' ? row.body_md : '',
    aliases: strings(row.aliases),
    tags: strings(row.tags),
    parent_id: typeof row.parent_id === 'string' && row.parent_id !== row.id ? row.parent_id : null,
  };
}

/** The title a note is shown under; an unnamed note still needs a row. */
export function displayTitle(note: Pick<Note, 'title'>): string {
  return note.title.trim() || 'Untitled';
}

export interface NoteTree {
  roots: Note[];
  /** parent id -> children, each list sorted by title. */
  children: Map<string, Note[]>;
}

/**
 * Build the tree. A note's parent counts only when it exists in `notes`, is
 * not the note itself, and following parents from it never comes back — so
 * every member of a cycle surfaces at the root, where it can be seen and
 * re-parented, rather than vanishing under a parent that is also its child.
 */
export function buildTree(notes: readonly Note[]): NoteTree {
  const byId = new Map(notes.map((n) => [n.id, n]));
  const children = new Map<string, Note[]>();
  const roots: Note[] = [];
  const byTitle = (a: Note, b: Note) => displayTitle(a).localeCompare(displayTitle(b));

  for (const note of notes) {
    const parent = note.parent_id;
    if (parent && byId.has(parent) && parent !== note.id && !reaches(byId, parent, note.id)) {
      const list = children.get(parent) ?? [];
      list.push(note);
      children.set(parent, list);
    } else {
      roots.push(note);
    }
  }
  roots.sort(byTitle);
  for (const list of children.values()) list.sort(byTitle);
  return { roots, children };
}

/** Does walking `parent_id` from `from` reach `target`? Bounded by the note
 * count, so a cycle that does not include `target` still terminates. */
function reaches(byId: Map<string, Note>, from: string, target: string): boolean {
  let cursor: string | null = from;
  for (let steps = 0; cursor && steps <= byId.size; steps++) {
    if (cursor === target) return true;
    cursor = byId.get(cursor)?.parent_id ?? null;
  }
  return false;
}

/** Every note under `id`, depth-first — what a move must not choose as a new
 * parent, and what a delete reparents. */
export function descendantsOf(tree: NoteTree, id: string): Note[] {
  const out: Note[] = [];
  const stack = [...(tree.children.get(id) ?? [])];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const note = stack.pop()!;
    if (seen.has(note.id)) continue;
    seen.add(note.id);
    out.push(note);
    stack.push(...(tree.children.get(note.id) ?? []));
  }
  return out;
}

/** Root -> … -> note, for the breadcrumb. Stops at a cycle. */
export function ancestorsOf(notes: readonly Note[], note: Note): Note[] {
  const byId = new Map(notes.map((n) => [n.id, n]));
  const chain: Note[] = [];
  const seen = new Set<string>([note.id]);
  let cursor = note.parent_id ? byId.get(note.parent_id) : undefined;
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    chain.unshift(cursor);
    cursor = cursor.parent_id ? byId.get(cursor.parent_id) : undefined;
  }
  return chain;
}

/** Split a comma-separated tag field into clean, unique tags. */
export function parseTags(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[,\n]/)
        .map((t) => t.trim())
        .filter((t) => t !== ''),
    ),
  ];
}
