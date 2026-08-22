/**
 * Drawing a tree as text (0.3.0 phase 9).
 *
 * The shape is the one every `tree` on every machine draws — `├──`, `└──`,
 * `│` — with a pure-ASCII fallback (`|--`, `` `-- ``) for terminals, CI logs
 * and fixed-width fonts that mangle box drawing. That fallback is not
 * decoration: a README that renders as mojibake in one reader's terminal is a
 * README that looks broken.
 *
 * Pure and string-in-string-out, so every option below is a unit test rather
 * than a screenshot.
 */
import type { NodeKind, TreeNode } from './model';

export interface Charset {
  id: 'unicode' | 'ascii';
  label: string;
  /** Vertical rail carried down past a node that has later siblings. */
  rail: string;
  /** Blank rail, the same width. */
  gap: string;
  /** Connector for a node with siblings after it. */
  tee: string;
  /** Connector for the last child. */
  corner: string;
}

export const CHARSETS: Charset[] = [
  { id: 'unicode', label: 'Box drawing (├── └──)', rail: '│   ', gap: '    ', tee: '├── ', corner: '└── ' },
  { id: 'ascii', label: 'Plain ASCII (|-- `--)', rail: '|   ', gap: '    ', tee: '|-- ', corner: '`-- ' },
];

export const charsetById = (id: string): Charset => CHARSETS.find((c) => c.id === id) ?? CHARSETS[0]!;

/** How the root line is shown. */
export type RootMode = 'name' | 'dot' | 'hidden' | 'custom';

export type EmojiMode = 'none' | 'kind' | 'extension';

/** Folder/file split — what `emoji: 'kind'` uses. */
export const KIND_EMOJI: Record<NodeKind, string> = { folder: '📂', file: '📄' };

/**
 * Extension → emoji, editable on the page.
 *
 * A dozen common types as the plan asked for, chosen so the glyph says
 * something about the FILE rather than about the language's mascot where the
 * two disagree. Anything not listed falls back to the kind split.
 */
export const DEFAULT_EMOJI_RULES: Record<string, string> = {
  js: '📜',
  ts: '🟦',
  json: '🔧',
  md: '📝',
  html: '🌐',
  css: '🎨',
  png: '🖼️',
  jpg: '🖼️',
  svg: '🖼️',
  py: '🐍',
  sh: '🐚',
  yml: '⚙️',
  yaml: '⚙️',
  zip: '📦',
  pdf: '📕',
  lock: '🔒',
};

export interface TreeRenderOptions {
  charset: 'unicode' | 'ascii';
  /** Folders get a trailing `/`. */
  trailingSlash: boolean;
  emoji: EmojiMode;
  emojiRules: Record<string, string>;
  root: RootMode;
  /** Used when `root` is 'custom'. */
  rootLabel: string;
  /** Show each node's whole path instead of its name. */
  fullPaths: boolean;
}

export const DEFAULT_RENDER_OPTIONS: TreeRenderOptions = {
  charset: 'unicode',
  trailingSlash: true,
  emoji: 'none',
  emojiRules: DEFAULT_EMOJI_RULES,
  root: 'name',
  rootLabel: '.',
  fullPaths: false,
};

/** The extension of a file name, lower-cased and without its dot. A leading
 * dot is a hidden file, not an extension: `.gitignore` has none. */
export function extensionOf(name: string): string {
  const match = /[^.](?:.*)\.([^.]+)$/.exec(name);
  return match ? match[1]!.toLowerCase() : '';
}

/** The emoji for one node, or '' when emoji are off. */
export function emojiFor(node: TreeNode, options: Pick<TreeRenderOptions, 'emoji' | 'emojiRules'>): string {
  if (options.emoji === 'none') return '';
  if (options.emoji === 'kind' || node.kind === 'folder') return KIND_EMOJI[node.kind];
  return options.emojiRules[extensionOf(node.name)] ?? KIND_EMOJI.file;
}

function labelFor(node: TreeNode, path: string[], options: TreeRenderOptions): string {
  const base = options.fullPaths ? path.join('/') : node.name;
  const slash = options.trailingSlash && node.kind === 'folder' ? '/' : '';
  const emoji = emojiFor(node, options);
  return `${emoji ? `${emoji} ` : ''}${base}${slash}`;
}

/**
 * Render the tree, one string per line.
 *
 * `hidden` drops the root line and promotes its children to the top level —
 * which is what someone pasting a tree into a README usually wants, because
 * the heading above it already says which project this is.
 */
export function renderTree(root: TreeNode, options: TreeRenderOptions): string[] {
  const charset = charsetById(options.charset);
  const lines: string[] = [];

  const walk = (node: TreeNode, prefix: string, path: string[]) => {
    node.children.forEach((child, index) => {
      const last = index === node.children.length - 1;
      const here = [...path, child.name];
      lines.push(prefix + (last ? charset.corner : charset.tee) + labelFor(child, here, options));
      if (child.children.length > 0) {
        walk(child, prefix + (last ? charset.gap : charset.rail), here);
      }
    });
  };

  if (options.root === 'hidden') {
    walk(root, '', [root.name]);
    return lines;
  }

  const rootName =
    options.root === 'dot' ? '.' : options.root === 'custom' ? options.rootLabel.trim() || '.' : root.name;
  lines.push(labelFor({ ...root, name: rootName }, [rootName], options));
  walk(root, '', [rootName]);
  return lines;
}

/**
 * How many monospace cells a rendered line occupies.
 *
 * Not `line.length`: box-drawing characters take one cell, emoji take two,
 * and the variation selector and zero-width joiner that hold a modern emoji
 * together take none at all. The SVG renderer needs this to size its canvas —
 * counting UTF-16 units instead clips every line with an emoji in it.
 */
export function displayWidth(line: string): number {
  let width = 0;
  for (const ch of line) {
    const code = ch.codePointAt(0)!;
    // U+FE0F / U+FE0E (variation selectors) and U+200D (zero-width joiner):
    // written as escapes because a literal one is invisible in this file.
    if (code === 0xfe0f || code === 0xfe0e || code === 0x200d) continue;
    width += code > 0x2fff ? 2 : 1;
  }
  return width;
}

/** The summary line `tree` prints under its output. */
export function summaryLine(counts: { files: number; folders: number }): string {
  const dirs = `${counts.folders} ${counts.folders === 1 ? 'directory' : 'directories'}`;
  const files = `${counts.files} ${counts.files === 1 ? 'file' : 'files'}`;
  return `${dirs}, ${files}`;
}
