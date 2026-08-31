import { describe, expect, it } from 'vitest';
import { compileScript } from './compile';
import { archiveName, exportFiles, exportIndexHtml } from './export';
import {
  BLANK,
  hasConsole,
  isDetached,
  isEmpty,
  isLayout,
  isScriptLang,
  isSingleColumn,
  LAYOUTS,
  normalizeSession,
  scriptName,
  showsEditor,
  showsPreview,
  STARTER,
  type Buffers,
  type Layout,
} from './model';
import { zipEntries, zipBytes } from '../zip';
import type { WebPlayground } from '../db/types';

const buffers = (over: Partial<Buffers> = {}): Buffers => ({
  html: '<h1>hi</h1>',
  css: 'h1 { color: red }',
  script: 'console.log(1)',
  ...over,
});

describe('normalizeSession', () => {
  it('reads a well-formed row', () => {
    const row = {
      name: 'My page',
      lang: 'ts',
      html: '<p>a</p>',
      css: 'p{}',
      script: 'const x: number = 1',
    } as Partial<WebPlayground>;
    expect(normalizeSession(row)).toEqual({
      name: 'My page',
      lang: 'ts',
      buffers: { html: '<p>a</p>', css: 'p{}', script: 'const x: number = 1' },
    });
  });

  /**
   * The generic data suite writes an ARRAY into every column it can, and a
   * backup is a text file anyone can edit. Nothing here may reach the editor
   * as a non-string.
   */
  const hostile: [string, unknown][] = [
    ['an array', []],
    ['an object', { a: 1 }],
    ['a number', 42],
    ['null', null],
    ['undefined', undefined],
    ['true', true],
  ];

  for (const [label, value] of hostile) {
    it(`replaces ${label} in a buffer with an empty string`, () => {
      const result = normalizeSession({
        name: 'x',
        lang: 'js',
        html: value,
        css: value,
        script: value,
      } as unknown as Partial<WebPlayground>);
      expect(result.buffers).toEqual({ html: '', css: '', script: '' });
      expect(typeof result.name).toBe('string');
    });
  }

  it('falls back to a name and a language rather than showing junk', () => {
    expect(normalizeSession({ name: 42 } as unknown as Partial<WebPlayground>).name).toBe(
      'Untitled'
    );
    expect(normalizeSession({ name: '' } as Partial<WebPlayground>).name).toBe('Untitled');
    expect(normalizeSession({ lang: 'python' } as Partial<WebPlayground>).lang).toBe('js');
    expect(normalizeSession(null).lang).toBe('js');
    expect(normalizeSession(undefined).buffers).toEqual({ html: '', css: '', script: '' });
  });

  it('knows which language strings are real', () => {
    expect(isScriptLang('js')).toBe(true);
    expect(isScriptLang('ts')).toBe(true);
    expect(isScriptLang('tsx')).toBe(false);
    expect(isScriptLang(null)).toBe(false);
  });
});

describe('isEmpty', () => {
  it('is true only when there is nothing worth keeping', () => {
    expect(isEmpty(BLANK)).toBe(true);
    expect(isEmpty({ html: '   ', css: '\n', script: '\t' })).toBe(true);
    expect(isEmpty(STARTER)).toBe(false);
    expect(isEmpty({ html: '', css: '', script: 'x' })).toBe(false);
  });
});

describe('scriptName', () => {
  it('names the script by its language', () => {
    expect(scriptName('js')).toBe('script.js');
    expect(scriptName('ts')).toBe('script.ts');
  });
});

describe('compileScript', () => {
  it('hands JavaScript straight back, untouched', async () => {
    const source = 'const a = 1; // : not a type\n';
    await expect(compileScript(source, 'js')).resolves.toEqual({ ok: true, code: source });
  });

  it('strips TypeScript types', async () => {
    const result = await compileScript('const x: number = 1;\nlet y!: string;\n', 'ts');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.code).toContain('const x = 1');
    expect(result.code).not.toContain(': number');
  });

  it('drops interfaces and type-only imports entirely', async () => {
    const result = await compileScript(
      'interface Point { x: number }\nconst p = { x: 1 } as Point;\nexport {};\n',
      'ts'
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.code).not.toContain('interface');
    expect(result.code).toContain('{ x: 1 }');
  });

  /** The whole point of the note on the page: no checking happens. */
  it('does NOT type-check — a wrong type compiles happily', async () => {
    const result = await compileScript('const n: number = "not a number";\n', 'ts');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.code).toContain('"not a number"');
  });

  it('returns a syntax error instead of throwing, so the last preview can stay', async () => {
    const result = await compileScript('const x: = ;;;\n', 'ts');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/\S/);
  });
});

describe('exportIndexHtml', () => {
  it('links the sibling files so the unzipped folder just opens', () => {
    const doc = exportIndexHtml('<h1>hi</h1>');
    expect(doc.startsWith('<!doctype html>')).toBe(true);
    expect(doc).toContain('<link rel="stylesheet" href="style.css">');
    expect(doc).toContain('<script type="module" src="script.js">');
    expect(doc).toContain('<h1>hi</h1>');
    // Exactly one real close tag — the one this function wrote.
    expect(doc.split('</script>')).toHaveLength(2);
  });
});

describe('exportFiles', () => {
  it('writes three files for a JavaScript session', () => {
    const files = exportFiles(buffers(), 'js', 'console.log(1)');
    expect(files.map((f) => f.name)).toEqual(['index.html', 'style.css', 'script.js']);
  });

  it('ships the TypeScript original beside the compiled script', () => {
    const files = exportFiles(buffers({ script: 'const x: number = 1' }), 'ts', 'const x = 1');
    expect(files.map((f) => f.name)).toEqual([
      'index.html',
      'style.css',
      'script.js',
      'script.ts',
    ]);
    expect(files.find((f) => f.name === 'script.js')!.data).toBe('const x = 1');
    expect(files.find((f) => f.name === 'script.ts')!.data).toBe('const x: number = 1');
  });

  it('round-trips through the archive writer', () => {
    const files = exportFiles(buffers(), 'js', 'console.log(1)');
    const read = zipEntries(zipBytes(files));
    const decode = (name: string) =>
      new TextDecoder().decode(read.find((e) => e.name === name)!.data);
    expect(read.map((e) => e.name)).toEqual(['index.html', 'style.css', 'script.js']);
    expect(decode('style.css')).toBe('h1 { color: red }');
    expect(decode('script.js')).toBe('console.log(1)');
    expect(decode('index.html')).toContain('<h1>hi</h1>');
  });
});

describe('archiveName', () => {
  const cases: [string, string][] = [
    ['My Page', 'my-page.zip'],
    ['  spaced  out  ', 'spaced-out.zip'],
    ['Ünïcødé ✨', 'n-c-d.zip'],
    ['', 'playground.zip'],
    ['   ', 'playground.zip'],
    ['!!!', 'playground.zip'],
    ['a/b\\c', 'a-b-c.zip'],
    ['../../etc/passwd', 'etc-passwd.zip'],
  ];

  for (const [input, expected] of cases) {
    it(`turns ${JSON.stringify(input)} into ${expected}`, () => {
      expect(archiveName(input)).toBe(expected);
    });
  }

  it('cannot produce a path separator or a traversal', () => {
    for (const [input] of cases) {
      const name = archiveName(input);
      expect(name).not.toContain('/');
      expect(name).not.toContain('\\');
      expect(name).not.toContain('..');
    }
  });

  it('caps a very long name', () => {
    expect(archiveName('x'.repeat(500)).length).toBeLessThanOrEqual(64);
  });
});

describe('layout', () => {
  it('offers exactly the four modes, split first', () => {
    expect(LAYOUTS.map((l) => l.id)).toEqual(['split', 'editor', 'preview', 'modal']);
    for (const layout of LAYOUTS) {
      expect(layout.label).toMatch(/\S/);
      expect(layout.title).toMatch(/\S/);
    }
  });

  it('knows what a layout string is', () => {
    expect(isLayout('split')).toBe(true);
    expect(isLayout('modal')).toBe(true);
    expect(isLayout('popout')).toBe(false);
    expect(isLayout('sidebar')).toBe(false);
    expect(isLayout(null)).toBe(false);
  });

  /** Which panels each mode puts on screen — the whole point of the feature. */
  const table: [Layout, boolean, boolean, boolean, boolean][] = [
    // layout,    editor, preview inline, console, single column
    ['split', true, true, true, false],
    ['editor', true, false, false, true],
    ['preview', false, true, true, true],
    ['modal', true, false, true, true],
  ];

  for (const [layout, editor, preview, console_, single] of table) {
    it(`${layout}: editor=${editor} preview=${preview} console=${console_}`, () => {
      expect(showsEditor(layout)).toBe(editor);
      expect(showsPreview(layout)).toBe(preview);
      expect(hasConsole(layout)).toBe(console_);
      expect(isSingleColumn(layout)).toBe(single);
    });
  }

  it('never hides both panels at once', () => {
    for (const { id } of LAYOUTS) {
      expect(showsEditor(id) || showsPreview(id), id).toBe(true);
    }
  });

  /**
   * `modal` renders no preview in the page FLOW, but the document is still
   * built — it is shown over the page. Only `editor` genuinely has no preview
   * running anywhere, which is why it is the only mode without a console.
   */
  it('tells "somewhere else" apart from "nowhere"', () => {
    expect(isDetached('modal')).toBe(true);
    expect(showsPreview('modal')).toBe(false);
    expect(hasConsole('modal')).toBe(true);
    for (const layout of ['split', 'editor', 'preview'] as const) {
      expect(isDetached(layout), layout).toBe(false);
    }
    // The one mode with no preview anywhere is the one with no console.
    expect(hasConsole('editor')).toBe(false);
  });

  it('shows the preview in exactly one place at a time', () => {
    for (const { id } of LAYOUTS) {
      expect(showsPreview(id) && isDetached(id), id).toBe(false);
    }
  });
});

