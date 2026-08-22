/**
 * The notebook's bulk operations, as pure functions over Note rows: what the
 * library lists, which parents a selection may move under, where the children
 * of deleted notes go, and what each exported file is called.
 *
 * The component writes one patch per changed row; everything it needs to
 * decide is computed here so it can be tested without a page.
 */
import type { Note } from '../db/types';
import { buildTree, descendantsOf, displayTitle, type NoteTree } from './model';

/**
 * The tree flattened depth-first — every note in the order the sidebar draws
 * them, which is the order a selection is acted on and exported in. The
 * sidebar itself draws the nesting by recursing, so no depth is carried here.
 */
export function flattenTree(tree: NoteTree): Note[] {
  const out: Note[] = [];
  const walk = (items: readonly Note[]) => {
    for (const note of items) {
      out.push(note);
      walk(tree.children.get(note.id) ?? []);
    }
  };
  walk(tree.roots);
  return out;
}

/** `id` and everything under it — what "select with nested" adds. */
export function subtreeIds(tree: NoteTree, id: string): string[] {
  return [id, ...descendantsOf(tree, id).map((n) => n.id)];
}

/**
 * Parents the selection may move under: any note that is neither selected
 * nor inside a selected note — moving a note under its own descendant would
 * close a cycle. Sorted by title; top level is the caller's `''` option.
 */
export function moveTargets(notes: readonly Note[], selected: ReadonlySet<string>): Note[] {
  const tree = buildTree(notes);
  const forbidden = new Set<string>();
  for (const id of selected) for (const sub of subtreeIds(tree, id)) forbidden.add(sub);
  return notes
    .filter((n) => !forbidden.has(n.id))
    .sort((a, b) => displayTitle(a).localeCompare(displayTitle(b)));
}

/**
 * Where the children of deleted notes go: each surviving note whose parent is
 * being deleted moves up to its nearest surviving ancestor, or to the top
 * level when every ancestor goes — the same "children move up a level" rule
 * as deleting one note, applied once for the whole set. Returns only the
 * notes that change, with their new parent.
 */
export function reparentForDelete(
  notes: readonly Note[],
  deleting: ReadonlySet<string>
): Map<string, string | null> {
  const byId = new Map(notes.map((n) => [n.id, n]));
  const out = new Map<string, string | null>();
  for (const note of notes) {
    if (deleting.has(note.id) || !note.parent_id || !deleting.has(note.parent_id)) continue;
    let cursor: string | null = note.parent_id;
    const seen = new Set<string>([note.id]);
    while (cursor && deleting.has(cursor) && !seen.has(cursor)) {
      seen.add(cursor);
      cursor = byId.get(cursor)?.parent_id ?? null;
    }
    // A cycle among deleted notes, or a parent that was never a row: top level.
    out.set(note.id, cursor && byId.has(cursor) && !deleting.has(cursor) ? cursor : null);
  }
  return out;
}

/** Tags after adding `add`: order kept, duplicates (case-sensitive) dropped. */
export function addTags(tags: readonly string[], add: readonly string[]): string[] {
  return [...new Set([...tags, ...add])];
}

/** Tags after removing `remove`, compared case-insensitively. */
export function removeTags(tags: readonly string[], remove: readonly string[]): string[] {
  const drop = new Set(remove.map((t) => t.toLowerCase()));
  return tags.filter((t) => !drop.has(t.toLowerCase()));
}

/**
 * A filename for an exported note that is safe on every filesystem and unique
 * within `taken` (which it extends): the same `[^a-z0-9._-]` → `-` rule the
 * single-note export uses, `Untitled` when nothing is left, and `-2`, `-3`, …
 * appended on a clash. Comparison is case-insensitive because the archive
 * may land on a case-insensitive disk.
 */
export function exportFileName(title: string, ext: string, taken: Set<string>): string {
  const stem =
    title
      .trim()
      .replace(/[^a-z0-9._-]+/gi, '-')
      .replace(/^[.-]+|[.-]+$/g, '')
      .slice(0, 120) || 'Untitled';
  let name = `${stem}.${ext}`;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${stem}-${n}.${ext}`;
  taken.add(name.toLowerCase());
  return name;
}
