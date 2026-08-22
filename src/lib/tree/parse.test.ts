/**
 * The listing parsers, against output shaped exactly as the real commands
 * print it — summary lines, `.` and `..` entries, blank lines and all. A
 * parser tested only against tidied-up input is a parser that has never met a
 * terminal.
 */
import { describe, expect, it } from 'vitest';
import { allPaths } from './model';
import { parseListing, sniff, type ListingFormat } from './parse';

const parse = (text: string, format?: ListingFormat) => parseListing(text, format, 'project');

/** Paths under the root, whatever the root ended up called. */
const inside = (text: string, format?: ListingFormat): string[] => {
  const root = parse(text, format).root;
  return allPaths(root)
    .slice(1)
    .map((p) => p.slice(root.name.length + 1));
};

/** What the listing called its own root. */
const rootName = (text: string, format?: ListingFormat): string => parse(text, format).root.name;

describe('sniff', () => {
  it('recognises each format by its own marker', () => {
    expect(sniff(' Directory of C:\\proj\n\n2026-08-22  10:00    <DIR>          src')).toBe('windows-dir');
    expect(sniff('.\n├── src\n└── README.md')).toBe('tree');
    expect(sniff('project\n|-- src\n`-- README.md')).toBe('tree');
    expect(sniff('C:\\proj\\src\nC:\\proj\\src\\index.ts')).toBe('paths');
    expect(sniff('/home/k/proj/src\n/home/k/proj/src/index.ts')).toBe('paths');
    expect(sniff('.:\nREADME.md\nsrc\n\n./src:\nindex.ts')).toBe('ls-recursive');
    expect(sniff('project\n  src\n    index.ts')).toBe('indented');
    expect(sniff('README.md\nsrc\npackage.json')).toBe('flat');
    expect(sniff('')).toBe('flat');
  });
});

describe('Windows `dir`', () => {
  const DIR = [
    ' Volume in drive C has no label.',
    ' Volume Serial Number is 1234-5678',
    '',
    ' Directory of C:\\proj',
    '',
    '2026-08-22  10:00    <DIR>          .',
    '2026-08-22  10:00    <DIR>          ..',
    '2026-08-22  10:00    <DIR>          src',
    '2026-08-22  09:14             1,024 README.md',
    '               1 File(s)          1,024 bytes',
    '               3 Dir(s)  90,000,000 bytes free',
    '',
    ' Directory of C:\\proj\\src',
    '',
    '2026-08-22  10:00    <DIR>          .',
    '2026-08-22  10:00               812 index.ts',
    '2026-08-22  10:00             2,048 my notes.md',
    '               2 File(s)          2,860 bytes',
  ].join('\n');

  it('follows the directory headers and reads the <DIR> marker', () => {
    const result = parse(DIR);
    expect(result.format).toBe('windows-dir');
    expect(inside(DIR)).toEqual([
      'src',
      'src/index.ts',
      'src/my notes.md',
      'README.md',
    ]);
  });

  it('keeps a name with a space in it', () => {
    expect(inside(DIR)).toContain('src/my notes.md');
  });

  it('drops the volume banner and the File(s) summary without complaining', () => {
    expect(parse(DIR).warnings).toEqual([]);
  });

  it('reports a line it cannot read, with its number', () => {
    const result = parse(`${DIR}\nthis is not a dir line`);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.text).toBe('this is not a dir line');
    expect(result.warnings[0]!.line).toBe(19);
  });
});

describe('`dir /b /s` and other full paths', () => {
  const PATHS = [
    'C:\\proj\\src',
    'C:\\proj\\src\\index.ts',
    'C:\\proj\\src\\lib',
    'C:\\proj\\src\\lib\\model.ts',
    'C:\\proj\\README.md',
  ].join('\r\n');

  it('takes the common prefix as the root and keeps the last segment of it', () => {
    expect(inside(PATHS)).toEqual([
      'src',
      'src/index.ts',
      'src/lib',
      'src/lib/model.ts',
      'README.md',
    ]);
  });

  it('calls a path that is a prefix of another a folder, whatever it is named', () => {
    const text = '/a/b.d\n/a/b.d/c.txt';
    const result = parse(text);
    const bd = result.root.children[0]!;
    expect(bd.name).toBe('b.d');
    expect(bd.kind).toBe('folder');
  });

  it('reads POSIX paths as happily as Windows ones', () => {
    expect(inside('/home/k/proj/src/index.ts\n/home/k/proj/README.md')).toEqual([
      'src',
      'src/index.ts',
      'README.md',
    ]);
  });
});

describe('`tree`', () => {
  const UNIX = [
    '.',
    '├── docs',
    '│   └── readme.md',
    '├── src',
    '│   ├── index.ts',
    '│   └── lib',
    '│       └── model.ts',
    '└── package.json',
    '',
    '3 directories, 4 files',
  ].join('\n');

  const WINDOWS = [
    'Folder PATH listing for volume OS',
    'Volume serial number is 1234-5678',
    'C:.',
    '│   package.json',
    '│',
    '├───docs',
    '│       readme.md',
    '│',
    '└───src',
    '    │   index.ts',
    '    │',
    '    └───lib',
    '            model.ts',
  ].join('\n');

  it('reads the Unix shape', () => {
    expect(inside(UNIX)).toEqual([
      'docs',
      'docs/readme.md',
      'src',
      'src/index.ts',
      'src/lib',
      'src/lib/model.ts',
      'package.json',
    ]);
  });

  it('reads `tree /f` on Windows, where files are indented without a connector', () => {
    expect(inside(WINDOWS)).toEqual([
      'package.json',
      'docs',
      'docs/readme.md',
      'src',
      'src/index.ts',
      'src/lib',
      'src/lib/model.ts',
    ]);
  });

  it('reads the pure-ASCII shape this app can also emit', () => {
    const ascii = ['project', '|-- src', '|   `-- index.ts', '`-- README.md'].join('\n');
    expect(inside(ascii)).toEqual(['src', 'src/index.ts', 'README.md']);
  });

  it('ignores the "3 directories, 4 files" footer', () => {
    expect(parse(UNIX).warnings).toEqual([]);
  });
});

describe('`ls -R` and plain `ls`', () => {
  const LS_R = ['.:', 'README.md  src', '', './src:', 'index.ts', 'lib', '', './src/lib:', 'model.ts'].join(
    '\n'
  );

  it('follows the directory headers', () => {
    expect(inside(LS_R)).toEqual([
      'README.md',
      'src',
      'src/index.ts',
      'src/lib',
      'src/lib/model.ts',
    ]);
  });

  it('splits `ls` column output on runs of spaces', () => {
    expect(inside('a.txt    b.txt    c.txt', 'flat')).toEqual(['a.txt', 'b.txt', 'c.txt']);
  });

  it('keeps a single space inside a name', () => {
    expect(inside('my notes.md', 'flat')).toEqual(['my notes.md']);
  });

  it('reads a trailing slash as a folder (`ls -F`)', () => {
    const result = parse('src/\nREADME.md', 'flat');
    expect(result.root.children.map((c) => [c.name, c.kind])).toEqual([
      ['src', 'folder'],
      ['README.md', 'file'],
    ]);
  });
});

describe('an indented tree typed by hand', () => {
  it('reads two-space indentation, with the first line as the root', () => {
    const text = ['project', '  src', '    index.ts', '  README.md'].join('\n');
    expect(inside(text)).toEqual(['src', 'src/index.ts', 'README.md']);
  });

  it('counts a tab as one level', () => {
    const text = ['project', '\tsrc', '\t\tindex.ts'].join('\n');
    expect(inside(text)).toEqual(['src', 'src/index.ts']);
  });

  it('does NOT eat the first line when the outer level has siblings', () => {
    // Three top-level entries and no root line: swallowing `src` would
    // silently reparent everything else under it.
    const text = ['src', '  index.ts', 'docs', 'README.md'].join('\n');
    expect(inside(text, 'indented')).toEqual(['src', 'src/index.ts', 'docs', 'README.md']);
  });
});

describe('the front door', () => {
  it('reports how many entries it understood, so "nothing happened" is visible', () => {
    expect(parse('').entries).toBe(0);
    expect(parse('a\nb').entries).toBe(2);
  });

  it('lets the format be overridden when a listing looks like two things', () => {
    // Read as an indented tree, `a` names the tree and `b` is inside it; read
    // as a flat list they are two siblings. The sniffer picks one; the page
    // lets someone else decide.
    expect(rootName('a\n  b', 'indented')).toBe('a');
    expect(inside('a\n  b', 'indented')).toEqual(['b']);
    expect(inside('a\n  b', 'flat')).toEqual(['a', 'b']);
  });

  it('takes the root name from the listing when it gave one', () => {
    expect(rootName(' Directory of C:\\proj\n\n2026-08-22  10:00    <DIR>          src')).toBe('proj');
    expect(rootName('/home/k/proj/src/index.ts\n/home/k/proj/README.md')).toBe('proj');
    expect(rootName('myapp\n  src\n    index.ts')).toBe('myapp');
    // ...and falls back to the given name when the listing only says "here".
    expect(rootName('.\n├── src\n└── README.md')).toBe('project');
    expect(rootName('C:.\n├───src')).toBe('project');
    expect(rootName('README.md\nsrc')).toBe('project');
  });
});
