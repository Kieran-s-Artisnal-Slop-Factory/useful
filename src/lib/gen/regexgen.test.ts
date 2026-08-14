import { describe, expect, it } from 'vitest';
import {
  buildSnippets,
  goLiteral,
  jsLiteralBody,
  pythonLiteral,
  rustLiteral,
  scanIncompatible,
  toPythonPattern,
  validatePattern,
  type RegexInput,
} from './regexgen';

const input = (pattern: string, over: Partial<RegexInput> = {}): RegexInput => ({
  pattern,
  ignoreCase: false,
  multiline: false,
  dotAll: false,
  ...over,
});

describe('scanIncompatible', () => {
  it('detects lookahead, lookbehind, and backreferences', () => {
    expect(scanIncompatible('foo(?=bar)').map((f) => f.construct)).toEqual(['lookahead']);
    expect(scanIncompatible('foo(?!bar)').map((f) => f.construct)).toEqual(['lookahead']);
    expect(scanIncompatible('(?<=a)b').map((f) => f.construct)).toEqual(['lookbehind']);
    expect(scanIncompatible('(?<!a)b').map((f) => f.construct)).toEqual(['lookbehind']);
    expect(scanIncompatible('(a)\\1').map((f) => f.construct)).toEqual(['backreference']);
    expect(scanIncompatible('(?<w>a)\\k<w>').map((f) => f.construct)).toEqual(['backreference']);
  });

  it('does not confuse named groups with lookbehind', () => {
    expect(scanIncompatible('(?<year>\\d{4})')).toEqual([]);
  });

  it('ignores escaped parens and character-class contents', () => {
    expect(scanIncompatible('\\(?=x')).toEqual([]); // literal ( then optional =x? no group
    expect(scanIncompatible('[(?=]')).toEqual([]);
    expect(scanIncompatible('[\\]a]b(?=c)').map((f) => f.construct)).toEqual(['lookahead']);
    expect(scanIncompatible('a\\\\(?=b)').map((f) => f.construct)).toEqual(['lookahead']);
  });

  it('does not flag digits inside character classes as backreferences', () => {
    expect(scanIncompatible('[\\1]')).toEqual([]);
  });
});

describe('validatePattern', () => {
  it('accepts valid and rejects broken patterns', () => {
    expect(validatePattern('a+b')).toBeNull();
    expect(validatePattern('a(')).toMatch(/./);
    expect(validatePattern('[')).toMatch(/./);
  });
});

describe('per-language literals', () => {
  it('python: raw string, quote fallback, trailing-backslash fallback', () => {
    expect(pythonLiteral('\\d+')).toBe('r"\\d+"');
    expect(pythonLiteral('say "hi"')).toBe('r\'say "hi"\'');
    expect(pythonLiteral('both "and" \'quotes\'')).toBe('r"""both "and" \'quotes\'"""');
    expect(pythonLiteral('end\\')).toBe('"end\\\\"'); // raw strings can't end in odd backslashes
    expect(pythonLiteral('ok\\\\')).toBe('r"ok\\\\"');
  });

  it('python: named groups and backrefs rewritten', () => {
    expect(toPythonPattern('(?<year>\\d{4})-\\k<year>')).toBe('(?P<year>\\d{4})-(?P=year)');
    expect(toPythonPattern('(?<=a)b')).toBe('(?<=a)b'); // lookbehind untouched
    expect(toPythonPattern('[(?<a>]')).toBe('[(?<a>]'); // class contents untouched
  });

  it('go: backticks with interpreted-string fallback', () => {
    expect(goLiteral('\\d+')).toBe('`\\d+`');
    expect(goLiteral('a`b')).toBe('"a`b"');
    expect(goLiteral('a"b\\c')).toBe('`a"b\\c`');
  });

  it('rust: raw string with hash escalation', () => {
    expect(rustLiteral('\\d+')).toBe('r"\\d+"');
    expect(rustLiteral('say "hi"')).toBe('r#"say "hi""#');
    expect(rustLiteral('tricky "# case')).toBe('r##"tricky "# case"##');
  });

  it('js: unescaped slashes escaped, empty pattern spelled (?:)', () => {
    expect(jsLiteralBody('a/b')).toBe('a\\/b');
    expect(jsLiteralBody('a\\/b')).toBe('a\\/b');
    expect(jsLiteralBody('')).toBe('(?:)');
  });
});

describe('buildSnippets', () => {
  it('maps flags per language', () => {
    const snippets = buildSnippets(input('\\d+', { ignoreCase: true, multiline: true }));
    const by = Object.fromEntries(snippets.map((s) => [s.lang, s]));
    expect(by.js!.code).toContain('/\\d+/im;');
    expect(by.js!.code).toContain('/\\d+/img)');
    expect(by.python!.code).toContain('re.compile(r"\\d+", re.IGNORECASE | re.MULTILINE)');
    expect(by.go!.code).toContain('regexp.MustCompile(`(?im)\\d+`)');
    expect(by.rust!.code).toContain('Regex::new(r"(?im)\\d+")');
  });

  it('omits flag plumbing when no flags are set', () => {
    const by = Object.fromEntries(buildSnippets(input('a+')).map((s) => [s.lang, s]));
    expect(by.js!.code).toContain('/a+/;');
    expect(by.python!.code).toContain('re.compile(r"a+")');
    expect(by.go!.code).toContain('regexp.MustCompile(`a+`)');
  });

  it('warns Go and Rust — and only them — about RE2-incompatible constructs', () => {
    const by = Object.fromEntries(
      buildSnippets(input('(?<=a)(b)\\1')).map((s) => [s.lang, s])
    );
    expect(by.go!.warnings.length).toBeGreaterThan(0);
    expect(by.rust!.warnings.length).toBeGreaterThan(0);
    expect(by.js!.warnings).toEqual([]);
    expect(by.python!.warnings).toEqual([]);
    expect(by.go!.warnings.join(' ')).toMatch(/lookbehind/);
    expect(by.go!.warnings.join(' ')).toMatch(/backreference/);
  });

  it('python snippet uses the rewritten pattern', () => {
    const by = Object.fromEntries(
      buildSnippets(input('(?<y>\\d{4})')).map((s) => [s.lang, s])
    );
    expect(by.python!.code).toContain('(?P<y>');
    expect(by.go!.code).toContain('(?<y>'); // Go/Rust keep the original spelling
  });
});
