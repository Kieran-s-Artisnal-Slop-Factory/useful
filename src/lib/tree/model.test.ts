import { describe, expect, it } from 'vitest';
import {
  allPaths,
  countKinds,
  deserialize,
  emptyTree,
  find,
  fromEntries,
  insert,
  isDescendant,
  move,
  node,
  parentOf,
  pathTo,
  remove,
  rename,
  reorder,
  serialize,
  sortTree,
  TreeParseError,
  type TreeNode,
} from './model';

/** project/ { src/ { index.ts, lib/ { model.ts } }, README.md } */
function sample(): TreeNode {
  return node('project', 'folder', [
    node('src', 'folder', [node('index.ts'), node('lib', 'folder', [node('model.ts')])]),
    node('README.md'),
  ]);
}

const byName = (root: TreeNode, name: string): TreeNode => {
  const hit = (function walk(n: TreeNode): TreeNode | null {
    if (n.name === name) return n;
    for (const c of n.children) {
      const found = walk(c);
      if (found) return found;
    }
    return null;
  })(root);
  if (!hit) throw new Error(`no node named ${name}`);
  return hit;
};

describe('the model', () => {
  it('gives every node its own id', () => {
    const root = sample();
    const ids = allPaths(root).map((_, i) => i);
    const seen = new Set<string>();
    (function walk(n: TreeNode) {
      expect(seen.has(n.id)).toBe(false);
      seen.add(n.id);
      n.children.forEach(walk);
    })(root);
    expect(seen.size).toBe(ids.length);
  });

  it('finds nodes, their parents and their paths', () => {
    const root = sample();
    const model = byName(root, 'model.ts');
    expect(find(root, model.id)).toBe(model);
    expect(parentOf(root, model.id)?.name).toBe('lib');
    expect(pathTo(root, model.id)).toEqual(['project', 'src', 'lib', 'model.ts']);
    expect(parentOf(root, root.id)).toBeNull();
    expect(pathTo(root, 'nope')).toEqual([]);
  });

  it('counts what is inside the root, not the root itself', () => {
    expect(countKinds(sample())).toEqual({ files: 3, folders: 2 });
    expect(countKinds(emptyTree())).toEqual({ files: 0, folders: 0 });
  });
});

describe('editing', () => {
  it('never mutates the tree it was given', () => {
    const root = sample();
    const before = serialize(root);
    rename(root, byName(root, 'src').id, 'source');
    remove(root, byName(root, 'README.md').id);
    insert(root, root.id, node('extra'));
    expect(serialize(root)).toBe(before);
  });

  it('adds a child, turning a file into a folder rather than refusing', () => {
    const root = sample();
    const readme = byName(root, 'README.md');
    const next = insert(root, readme.id, node('nested.md'));
    const changed = byName(next, 'README.md');
    expect(changed.kind).toBe('folder');
    expect(changed.children.map((c) => c.name)).toEqual(['nested.md']);
  });

  it('renames, and ignores an empty name', () => {
    const root = sample();
    const src = byName(root, 'src').id;
    expect(byName(rename(root, src, ' source '), 'source').name).toBe('source');
    expect(serialize(rename(root, src, '   '))).toBe(serialize(root));
  });

  it('removes a subtree but never the root', () => {
    const root = sample();
    const next = remove(root, byName(root, 'src').id);
    expect(next.children.map((c) => c.name)).toEqual(['README.md']);
    expect(serialize(remove(root, root.id))).toBe(serialize(root));
  });

  it('reorders siblings and stops at the ends', () => {
    const root = sample();
    const readme = byName(root, 'README.md').id;
    expect(reorder(root, readme, -1).children.map((c) => c.name)).toEqual(['README.md', 'src']);
    expect(reorder(root, readme, 1).children.map((c) => c.name)).toEqual(['src', 'README.md']);
    expect(reorder(root, root.id, 1)).toBe(root);
  });

  it('sorts folders first, then by name, case- and number-aware', () => {
    const root = node('r', 'folder', [
      node('b.txt'),
      node('file10.txt'),
      node('file2.txt'),
      node('Alpha', 'folder'),
      node('a.txt'),
    ]);
    expect(sortTree(root).children.map((c) => c.name)).toEqual([
      'Alpha',
      'a.txt',
      'b.txt',
      'file2.txt',
      'file10.txt',
    ]);
  });
});

describe('move', () => {
  it('re-parents a node', () => {
    const root = sample();
    const readme = byName(root, 'README.md').id;
    const lib = byName(root, 'lib').id;
    const next = move(root, readme, lib);
    expect(byName(next, 'lib').children.map((c) => c.name)).toEqual(['model.ts', 'README.md']);
    expect(next.children.map((c) => c.name)).toEqual(['src']);
  });

  it('refuses the moves that would swallow the tree', () => {
    const root = sample();
    const src = byName(root, 'src').id;
    const lib = byName(root, 'lib').id;
    // Into itself, into its own descendant, and the root into anything: all
    // of them either lose nodes or loop forever when rendered.
    expect(move(root, src, src)).toBe(root);
    expect(move(root, src, lib)).toBe(root);
    expect(move(root, root.id, lib)).toBe(root);
    expect(isDescendant(root, src, lib)).toBe(true);
    expect(isDescendant(root, lib, src)).toBe(false);
    expect(isDescendant(root, src, src)).toBe(false);
  });

  it('is a no-op when the node is already there', () => {
    const root = sample();
    expect(move(root, byName(root, 'README.md').id, root.id)).toBe(root);
  });
});

describe('fromEntries', () => {
  it('builds a tree from paths, inferring the folders on the way', () => {
    const root = fromEntries(
      [
        { path: ['src', 'index.ts'], kind: 'file' },
        { path: ['src', 'lib', 'model.ts'], kind: 'file' },
        { path: ['README.md'], kind: 'file' },
      ],
      'project'
    );
    expect(allPaths(root)).toEqual([
      'project',
      'project/src',
      'project/src/index.ts',
      'project/src/lib',
      'project/src/lib/model.ts',
      'project/README.md',
    ]);
    expect(byName(root, 'src').kind).toBe('folder');
  });

  it('promotes a node that arrived as a file and turned out to have children', () => {
    const root = fromEntries(
      [
        { path: ['src'], kind: 'file' },
        { path: ['src', 'index.ts'], kind: 'file' },
      ],
      'p'
    );
    expect(byName(root, 'src').kind).toBe('folder');
  });

  it('does not duplicate a path listed twice', () => {
    const root = fromEntries(
      [
        { path: ['a', 'b'], kind: 'file' },
        { path: ['a', 'b'], kind: 'file' },
      ],
      'p'
    );
    expect(byName(root, 'a').children).toHaveLength(1);
  });
});

describe('import and export', () => {
  it('round-trips through JSON without carrying session ids into the file', () => {
    const root = sample();
    const text = serialize(root);
    expect(text).not.toContain('"id"');
    const back = deserialize(text);
    expect(serialize(back)).toBe(text);
    expect(back.id).not.toBe(root.id);
  });

  it('leaves out empty children arrays', () => {
    expect(serialize(node('a', 'file'))).toBe('{\n  "name": "a",\n  "kind": "file"\n}\n');
  });

  it('refuses a broken file with a reason that names the node', () => {
    expect(() => deserialize('nope')).toThrow(TreeParseError);
    expect(() => deserialize('[]')).toThrow(/not an object/);
    expect(() => deserialize('{"kind":"file"}')).toThrow(/no name/);
    expect(() => deserialize('{"name":"a","kind":"blob"}')).toThrow(/expected "file" or "folder"/);
    expect(() => deserialize('{"name":"a","kind":"folder","children":{}}')).toThrow(/not a list/);
    // A node that has a name is named in its own error; one that does not is
    // pointed at by position, because "something is wrong somewhere" is not a
    // reason anybody can act on.
    expect(() => deserialize('{"name":"a","kind":"folder","children":[{"name":"b"}]}')).toThrow(
      /^b has kind undefined/
    );
    expect(() => deserialize('{"name":"a","kind":"folder","children":[{"kind":"file"}]}')).toThrow(
      /a's child 1 has no name/
    );
  });
});
