/**
 * The file-tree model (0.3.0 phase 9).
 *
 * A tree is nested nodes with a name, a kind and children — nothing else. It
 * is JSON-native on purpose: the whole tree exports as one small file and
 * comes back from one, and nothing in it needs a database.
 *
 * Every operation here is **pure**: it returns a new root rather than editing
 * the one it was given. That is what makes the operations unit-testable
 * without a DOM, and it means the page can hold the whole tree in one piece of
 * state and never wonder whether something mutated underneath it.
 *
 * Ids exist only for the lifetime of a session — they are how the builder
 * points at a node — so they are deliberately NOT serialized. An imported tree
 * gets fresh ones.
 */

export type NodeKind = 'file' | 'folder';

export interface TreeNode {
  /** Session-only handle. Not serialized; regenerated on import. */
  id: string;
  name: string;
  kind: NodeKind;
  /** Always present, always an array — a file's is empty. */
  children: TreeNode[];
}

/** Serialized shape: no ids, and `children` only where there are some. */
export interface SerializedNode {
  name: string;
  kind: NodeKind;
  children?: SerializedNode[];
}

let counter = 0;

/** A fresh id. `crypto.randomUUID` where it exists (browsers, node ≥ 19); the
 * counter is the fallback and is also what keeps ids unique inside one tick,
 * where a coarse clock would collide. */
function newId(): string {
  counter += 1;
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ? `${uuid}-${counter}` : `n${counter}`;
}

export function node(name: string, kind: NodeKind = 'file', children: TreeNode[] = []): TreeNode {
  return { id: newId(), name, kind, children };
}

/** An empty project — what the page opens with. */
export function emptyTree(rootName = 'project'): TreeNode {
  return node(rootName, 'folder');
}

export function find(root: TreeNode, id: string): TreeNode | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    const hit = find(child, id);
    if (hit) return hit;
  }
  return null;
}

export function parentOf(root: TreeNode, id: string): TreeNode | null {
  for (const child of root.children) {
    if (child.id === id) return root;
    const hit = parentOf(child, id);
    if (hit) return hit;
  }
  return null;
}

/** Names from the root down to `id`, inclusive. Empty when it is not there. */
export function pathTo(root: TreeNode, id: string): string[] {
  if (root.id === id) return [root.name];
  for (const child of root.children) {
    const below = pathTo(child, id);
    if (below.length > 0) return [root.name, ...below];
  }
  return [];
}

export function isDescendant(root: TreeNode, ancestorId: string, id: string): boolean {
  const ancestor = find(root, ancestorId);
  if (!ancestor || ancestorId === id) return false;
  return find(ancestor, id) !== null;
}

/** Rebuild the tree, replacing the node with `id` by whatever `fn` returns.
 * Returning null drops it. The single primitive every edit below is built on. */
function replace(current: TreeNode, id: string, fn: (n: TreeNode) => TreeNode | null): TreeNode | null {
  if (current.id === id) return fn(current);
  let changed = false;
  const children: TreeNode[] = [];
  for (const child of current.children) {
    const next = replace(child, id, fn);
    if (next !== child) changed = true;
    if (next) children.push(next);
  }
  return changed ? { ...current, children } : current;
}

/** Add `child` inside `parentId`. A file cannot contain anything, so the
 * parent is turned into a folder rather than silently refusing — that is what
 * someone who just clicked "add file here" meant. */
export function insert(root: TreeNode, parentId: string, child: TreeNode): TreeNode {
  return (
    replace(root, parentId, (parent) => ({
      ...parent,
      kind: 'folder',
      children: [...parent.children, child],
    })) ?? root
  );
}

export function rename(root: TreeNode, id: string, name: string): TreeNode {
  const clean = name.trim();
  if (clean === '') return root;
  return replace(root, id, (n) => ({ ...n, name: clean })) ?? root;
}

export function setKind(root: TreeNode, id: string, kind: NodeKind): TreeNode {
  return replace(root, id, (n) => ({ ...n, kind })) ?? root;
}

/** Remove a node and everything under it. The root itself is never removed —
 * a tree with no root is not a tree. */
export function remove(root: TreeNode, id: string): TreeNode {
  if (root.id === id) return root;
  return replace(root, id, () => null) ?? root;
}

/**
 * Re-parent `id` into `intoId`.
 *
 * Refused, unchanged, when the move would swallow the tree: into itself, into
 * one of its own descendants, or onto a node that is already its parent. The
 * cycle check is the whole reason this is not two lines of splice — a
 * drag-and-drop builder makes that mistake easy to attempt and impossible to
 * recover from.
 */
export function move(root: TreeNode, id: string, intoId: string): TreeNode {
  if (id === intoId || root.id === id) return root;
  if (isDescendant(root, id, intoId)) return root;
  const moving = find(root, id);
  const target = find(root, intoId);
  if (!moving || !target) return root;
  if (parentOf(root, id)?.id === intoId) return root;
  const without = remove(root, id);
  return insert(without, intoId, moving);
}

/** Move a node up or down among its siblings. */
export function reorder(root: TreeNode, id: string, delta: number): TreeNode {
  const parent = parentOf(root, id);
  if (!parent) return root;
  const index = parent.children.findIndex((c) => c.id === id);
  const next = index + delta;
  if (index < 0 || next < 0 || next >= parent.children.length) return root;
  const children = [...parent.children];
  const [moved] = children.splice(index, 1);
  children.splice(next, 0, moved!);
  return replace(root, parent.id, (p) => ({ ...p, children })) ?? root;
}

/** Folders first, then case-insensitive by name — `ls` order, recursively. */
export function sortTree(current: TreeNode): TreeNode {
  const children = [...current.children].map(sortTree).sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
  });
  return { ...current, children };
}

export function countKinds(root: TreeNode): { files: number; folders: number } {
  let files = 0;
  let folders = 0;
  // The root is not counted: `tree` reports "2 directories, 3 files" for what
  // is INSIDE the directory it was pointed at, and so does this.
  const walk = (n: TreeNode, isRoot: boolean) => {
    if (!isRoot) {
      if (n.kind === 'folder') folders += 1;
      else files += 1;
    }
    n.children.forEach((c) => walk(c, false));
  };
  walk(root, true);
  return { files, folders };
}

/** One entry per line of a listing: the path split into segments, and what it
 * is. The shape every parser in `parse.ts` reduces to. */
export interface Entry {
  path: string[];
  kind: NodeKind;
}

/**
 * Build a tree from a flat list of paths.
 *
 * Intermediate segments are folders by definition — a path only has them
 * because something lives below. An entry that arrives as a file and later
 * turns out to have children is promoted, so the order of the listing does not
 * change the answer.
 */
export function fromEntries(entries: Entry[], rootName = 'project'): TreeNode {
  const root = emptyTree(rootName);
  for (const entry of entries) {
    let current = root;
    entry.path.forEach((segment, index) => {
      const last = index === entry.path.length - 1;
      const wanted = last ? entry.kind : 'folder';
      let next = current.children.find((c) => c.name === segment);
      if (!next) {
        next = node(segment, wanted);
        current.children.push(next);
      } else if (wanted === 'folder') {
        next.kind = 'folder';
      }
      current = next;
    });
  }
  return root;
}

/** Every file path in the tree, root name included, `/`-joined. */
export function allPaths(root: TreeNode): string[] {
  const out: string[] = [];
  const walk = (n: TreeNode, prefix: string[]) => {
    const here = [...prefix, n.name];
    out.push(here.join('/'));
    n.children.forEach((c) => walk(c, here));
  };
  walk(root, []);
  return out;
}

// ---- import / export --------------------------------------------------------

export function toSerializable(current: TreeNode): SerializedNode {
  const out: SerializedNode = { name: current.name, kind: current.kind };
  if (current.children.length > 0) out.children = current.children.map(toSerializable);
  return out;
}

export function serialize(root: TreeNode): string {
  return `${JSON.stringify(toSerializable(root), null, 2)}\n`;
}

export class TreeParseError extends Error {}

/** Re-hydrate a serialized tree, checking every field rather than trusting the
 * file: this is the one input that arrives as a whole document, and a
 * half-valid tree is worse than a refusal with a reason. */
export function fromSerializable(value: unknown, at = 'the root'): TreeNode {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TreeParseError(`${at} is not an object.`);
  }
  const record = value as Record<string, unknown>;
  if (typeof record.name !== 'string' || record.name.trim() === '') {
    throw new TreeParseError(`${at} has no name.`);
  }
  if (record.kind !== 'file' && record.kind !== 'folder') {
    throw new TreeParseError(`${record.name} has kind ${JSON.stringify(record.kind)} — expected "file" or "folder".`);
  }
  const raw = record.children ?? [];
  if (!Array.isArray(raw)) throw new TreeParseError(`${record.name}'s children are not a list.`);
  const children = raw.map((child, i) => fromSerializable(child, `${record.name}'s child ${i + 1}`));
  return { id: newId(), name: record.name, kind: record.kind, children };
}

export function deserialize(text: string): TreeNode {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new TreeParseError(`That is not JSON: ${err instanceof Error ? err.message : 'unreadable'}`);
  }
  return fromSerializable(parsed);
}
