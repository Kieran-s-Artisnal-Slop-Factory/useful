import { describe, expect, it } from 'vitest';
import { countKinds, node, type TreeNode } from './model';
import {
  DEFAULT_EMOJI_RULES,
  DEFAULT_RENDER_OPTIONS,
  displayWidth,
  emojiFor,
  extensionOf,
  renderTree,
  summaryLine,
  type TreeRenderOptions,
} from './render';

/** project/ { docs/ { readme.md }, src/ { index.ts, lib/ { model.ts } }, package.json } */
const sample = (): TreeNode =>
  node('project', 'folder', [
    node('docs', 'folder', [node('readme.md')]),
    node('src', 'folder', [node('index.ts'), node('lib', 'folder', [node('model.ts')])]),
    node('package.json'),
  ]);

const render = (root: TreeNode, options: Partial<TreeRenderOptions> = {}): string[] =>
  renderTree(root, { ...DEFAULT_RENDER_OPTIONS, trailingSlash: false, ...options });

describe('renderTree', () => {
  it('draws the shape every `tree` draws', () => {
    expect(render(sample())).toEqual([
      'project',
      '├── docs',
      '│   └── readme.md',
      '├── src',
      '│   ├── index.ts',
      '│   └── lib',
      '│       └── model.ts',
      '└── package.json',
    ]);
  });

  it('carries the rail past a folder that has siblings after it, and drops it after the last', () => {
    const lines = render(sample());
    // `lib` is the last child of `src`, and `src` still has `package.json`
    // after it — so its own children are indented under a rail, but with a
    // gap where `lib`'s connector was.
    expect(lines[6]).toBe('│       └── model.ts');
    const deep = node('r', 'folder', [node('a', 'folder', [node('b', 'folder', [node('c')])])]);
    expect(render(deep)).toEqual(['r', '└── a', '    └── b', '        └── c']);
  });

  it('has a pure-ASCII charset that says the same thing', () => {
    expect(render(sample(), { charset: 'ascii' })).toEqual([
      'project',
      '|-- docs',
      '|   `-- readme.md',
      '|-- src',
      '|   |-- index.ts',
      '|   `-- lib',
      '|       `-- model.ts',
      '`-- package.json',
    ]);
  });

  it('marks folders with a trailing slash on request', () => {
    const lines = render(sample(), { trailingSlash: true });
    expect(lines[0]).toBe('project/');
    expect(lines[1]).toBe('├── docs/');
    expect(lines[7]).toBe('└── package.json');
  });

  it('renders an empty tree as its root alone', () => {
    expect(render(node('empty', 'folder'))).toEqual(['empty']);
  });
});

describe('the root options', () => {
  it('shows it, hides it, dots it, or renames it', () => {
    expect(render(sample(), { root: 'name' })[0]).toBe('project');
    expect(render(sample(), { root: 'dot' })[0]).toBe('.');
    expect(render(sample(), { root: 'custom', rootLabel: 'my-app' })[0]).toBe('my-app');
    // An empty custom label would render a blank first line, which reads as a
    // bug rather than as a choice.
    expect(render(sample(), { root: 'custom', rootLabel: '  ' })[0]).toBe('.');

    const hidden = render(sample(), { root: 'hidden' });
    expect(hidden[0]).toBe('├── docs');
    expect(hidden).toHaveLength(7);
  });
});

describe('full paths', () => {
  it('prints the whole path of each node instead of its name', () => {
    expect(render(sample(), { fullPaths: true })).toEqual([
      'project',
      '├── project/docs',
      '│   └── project/docs/readme.md',
      '├── project/src',
      '│   ├── project/src/index.ts',
      '│   └── project/src/lib',
      '│       └── project/src/lib/model.ts',
      '└── project/package.json',
    ]);
  });

  it('follows the renamed root, so the paths are the ones the reader sees', () => {
    expect(render(sample(), { fullPaths: true, root: 'dot' })[1]).toBe('├── ./docs');
  });
});

describe('emoji', () => {
  it('is off by default', () => {
    expect(render(sample())[1]).toBe('├── docs');
  });

  it('splits folders from files', () => {
    const lines = render(sample(), { emoji: 'kind' });
    expect(lines[1]).toBe('├── 📂 docs');
    expect(lines[2]).toBe('│   └── 📄 readme.md');
  });

  it('reads the extension table, falling back to the plain file glyph', () => {
    const lines = render(sample(), { emoji: 'extension' });
    expect(lines[2]).toBe('│   └── 📝 readme.md');
    expect(lines[4]).toBe('│   ├── 🟦 index.ts');
    expect(lines[7]).toBe('└── 🔧 package.json');
    // Folders keep the folder glyph in both modes — an extension rule can
    // never describe a directory.
    expect(lines[1]).toBe('├── 📂 docs');
    expect(render(node('r', 'folder', [node('LICENSE')]), { emoji: 'extension' })[1]).toBe('└── 📄 LICENSE');
  });

  it('takes an edited rule table', () => {
    const lines = render(sample(), { emoji: 'extension', emojiRules: { ...DEFAULT_EMOJI_RULES, ts: '🦕' } });
    expect(lines[4]).toBe('│   ├── 🦕 index.ts');
  });

  it('answers for one node on its own', () => {
    expect(emojiFor(node('a.md'), { emoji: 'none', emojiRules: DEFAULT_EMOJI_RULES })).toBe('');
    expect(emojiFor(node('a.md'), { emoji: 'kind', emojiRules: DEFAULT_EMOJI_RULES })).toBe('📄');
    expect(emojiFor(node('a.md'), { emoji: 'extension', emojiRules: DEFAULT_EMOJI_RULES })).toBe('📝');
  });
});

describe('extensionOf', () => {
  it('reads the last extension, lower-cased', () => {
    expect(extensionOf('index.TS')).toBe('ts');
    expect(extensionOf('archive.tar.gz')).toBe('gz');
  });

  it('gives a dotfile no extension, because a dotfile has none', () => {
    expect(extensionOf('.gitignore')).toBe('');
    expect(extensionOf('.env')).toBe('');
    expect(extensionOf('Makefile')).toBe('');
    expect(extensionOf('')).toBe('');
  });
});

describe('displayWidth', () => {
  it('counts monospace cells, not UTF-16 units', () => {
    expect(displayWidth('abc')).toBe(3);
    // Box drawing is one cell each; the SVG canvas is sized on this, so
    // counting `.length` instead would clip every line with an emoji in it.
    expect(displayWidth('├── src')).toBe(7);
    expect(displayWidth('📂')).toBe(2);
    // The variation selector that holds a modern emoji together is not a cell.
    expect(displayWidth('🖼️')).toBe(2);
    expect(displayWidth('├── 📂 src')).toBe(10);
    expect(displayWidth('')).toBe(0);
  });
});

describe('summaryLine', () => {
  it('reads the way `tree` prints it, singular and plural', () => {
    expect(summaryLine(countKinds(sample()))).toBe('3 directories, 4 files');
    expect(summaryLine({ folders: 1, files: 1 })).toBe('1 directory, 1 file');
    expect(summaryLine({ folders: 0, files: 0 })).toBe('0 directories, 0 files');
  });
});
