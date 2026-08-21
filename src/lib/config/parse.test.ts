import { describe, expect, it } from 'vitest';
import { parseConfigText, prettifyConfigText, sniffFormat } from './parse';
import type { ParseIssue } from './parse';

const errors = (issues: ParseIssue[]): ParseIssue[] => issues.filter((i) => i.severity === 'error');
const warnings = (issues: ParseIssue[]): ParseIssue[] =>
  issues.filter((i) => i.severity === 'warning');

/** Every issue must be a sane CodeMirror diagnostic on its text. */
function expectSanePositions(issues: ParseIssue[], text: string): void {
  for (const issue of issues) {
    expect(issue.from).toBeGreaterThanOrEqual(0);
    expect(issue.to).toBeGreaterThanOrEqual(issue.from);
    expect(issue.to).toBeLessThanOrEqual(Math.max(text.length, 1));
  }
}

describe('sniffFormat', () => {
  it('reads a leading { or [ as JSON, whitespace included', () => {
    expect(sniffFormat('{"a": 1}')).toBe('json');
    expect(sniffFormat('[1, 2]')).toBe('json');
    expect(sniffFormat('  \n\t {"a": 1}')).toBe('json');
    expect(sniffFormat('\n  [\n]')).toBe('json');
  });

  it('defaults empty and whitespace-only text to JSON, the mode the UI opens with', () => {
    expect(sniffFormat('')).toBe('json');
    expect(sniffFormat('   \n\t  ')).toBe('json');
  });

  it('reads anything else as YAML', () => {
    expect(sniffFormat('key: value')).toBe('yaml');
    expect(sniffFormat('- a\n- b')).toBe('yaml');
    expect(sniffFormat('# just a comment')).toBe('yaml');
    expect(sniffFormat('plain prose, no structure at all')).toBe('yaml');
    expect(sniffFormat('"a": 1')).toBe('yaml');
  });
});

describe('parseConfigText (json)', () => {
  it('parses a document and returns its value with no issues', () => {
    const out = parseConfigText('{"a": [1, 2], "b": null}', 'json');
    expect(out.ok).toBe(true);
    expect(out.value).toEqual({ a: [1, 2], b: null });
    expect(out.issues).toEqual([]);
  });

  it('reports a syntax error with a position pointing at the problem', () => {
    const text = '{"a": 1,}';
    const out = parseConfigText(text, 'json');
    expect(out.ok).toBe(false);
    expect(out.value).toBeUndefined();
    expect(errors(out.issues)).toHaveLength(1);
    expectSanePositions(out.issues, text);
    // V8 reports 'at position 8' for the stray closing brace.
    expect(out.issues[0]!.from).toBe(8);
  });

  it('positions trailing-garbage errors after the document', () => {
    const text = '{"a": 1} x';
    const out = parseConfigText(text, 'json');
    expect(out.ok).toBe(false);
    expect(out.issues[0]!.from).toBeGreaterThan(7);
    expectSanePositions(out.issues, text);
  });

  it('survives an error message with no position at all', () => {
    // V8's "Unexpected token 'b', ... is not valid JSON" carries no offset.
    const out = parseConfigText('{"a": b}', 'json');
    expect(out.ok).toBe(false);
    expect(out.issues[0]!.from).toBe(0);
    expectSanePositions(out.issues, '{"a": b}');
  });

  it('rejects empty text as an error, not a crash', () => {
    const out = parseConfigText('', 'json');
    expect(out.ok).toBe(false);
    expect(errors(out.issues).length).toBeGreaterThan(0);
    expectSanePositions(out.issues, '');
  });

  it('warns on an integer beyond 2^53-1, positioned at the literal', () => {
    const text = '{"id": 9007199254740993}';
    const out = parseConfigText(text, 'json');
    expect(out.ok).toBe(true);
    const warns = warnings(out.issues);
    expect(warns).toHaveLength(1);
    expect(warns[0]!.message).toMatch(/loses precision/);
    expect(text.slice(warns[0]!.from, warns[0]!.to)).toBe('9007199254740993');
  });

  it('warns on a large negative integer too', () => {
    const out = parseConfigText('{"id": -9007199254740993}', 'json');
    expect(warnings(out.issues)).toHaveLength(1);
  });

  it('does not warn on big digit runs inside strings', () => {
    const out = parseConfigText('{"id": "9007199254740993"}', 'json');
    expect(out.ok).toBe(true);
    expect(out.issues).toEqual([]);
  });

  it('is not fooled by escaped quotes ahead of a big string digit run', () => {
    const out = parseConfigText('{"a": "he said \\"hi\\" 9007199254740993", "b": 1}', 'json');
    expect(out.ok).toBe(true);
    expect(out.issues).toEqual([]);
  });

  it('does not warn on MAX_SAFE_INTEGER itself, or on floats and exponents', () => {
    const out = parseConfigText('{"a": 9007199254740991, "b": 1.5e30, "c": 90071992547409.93}', 'json');
    expect(out.ok).toBe(true);
    expect(out.issues).toEqual([]);
  });

  it('flags every unsafe integer, not just the first', () => {
    const out = parseConfigText('[9007199254740993, 1, 9007199254740995]', 'json');
    expect(warnings(out.issues)).toHaveLength(2);
  });
});

describe('parseConfigText (yaml)', () => {
  it('parses a document and returns its value', () => {
    // Note 'y' would trip the 1.1 boolean audit — a real footgun, not a bug.
    const out = parseConfigText('a: 1\nb:\n  - p\n  - q\n', 'yaml');
    expect(out.ok).toBe(true);
    expect(out.value).toEqual({ a: 1, b: ['p', 'q'] });
    expect(out.issues).toEqual([]);
  });

  it('treats empty text as a valid null document', () => {
    const out = parseConfigText('', 'yaml');
    expect(out.ok).toBe(true);
    expect(out.value).toBeNull();
  });

  it('reports multiple errors in one document, each positioned', () => {
    // The reason js-yaml was rejected: it throws on the first problem.
    const text = 'a: 1\na: 2\nb: 3\nb: 4\n';
    const out = parseConfigText(text, 'yaml');
    expect(out.ok).toBe(false);
    expect(out.value).toBeUndefined();
    const errs = errors(out.issues);
    expect(errs.length).toBeGreaterThanOrEqual(2);
    expectSanePositions(out.issues, text);
    expect(new Set(errs.map((e) => e.from)).size).toBeGreaterThanOrEqual(2);
  });

  it('reports a duplicate key as an error naming the key', () => {
    const out = parseConfigText('port: 80\nport: 443\n', 'yaml');
    expect(out.ok).toBe(false);
    expect(errors(out.issues)[0]!.message).toMatch(/unique|repeated/i);
  });

  it('surfaces tab indentation as a positioned error', () => {
    const text = 'a:\n\tb: 1\n';
    const out = parseConfigText(text, 'yaml');
    expect(out.ok).toBe(false);
    const errs = errors(out.issues);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]!.message).toMatch(/tab/i);
    expect(errs[0]!.from).toBeGreaterThan(0);
    expectSanePositions(out.issues, text);
  });

  it('rejects an alias bomb without hanging', () => {
    // Billion laughs, scaled down: anchors doubling 12 levels deep, then a
    // sequence of aliases. maxAliasCount must kill it during toJS.
    const lines = ['a0: &a0 [x, x]'];
    for (let i = 1; i <= 12; i += 1) {
      lines.push(`a${i}: &a${i} [*a${i - 1}, *a${i - 1}]`);
    }
    lines.push('bomb: [*a12, *a12, *a12, *a12]');
    const started = Date.now();
    const out = parseConfigText(lines.join('\n'), 'yaml');
    expect(Date.now() - started).toBeLessThan(2000);
    expect(out.ok).toBe(false);
    expect(out.value).toBeUndefined();
    expect(errors(out.issues).length).toBeGreaterThan(0);
  });

  it('handles hostile junk without throwing', () => {
    for (const text of ['\u0000\u0001', ': : :', '- {a: [}', '!!binary "*"', '%YAML 9.9\n---\na: 1']) {
      const out = parseConfigText(text, 'yaml');
      expect(typeof out.ok).toBe('boolean');
      expectSanePositions(out.issues, text);
    }
  });
});

describe('YAML 1.1 fidelity audits', () => {
  it('warns that a plain NO is a 1.1 boolean (the Norway problem), positioned at the scalar', () => {
    const text = 'country: NO\n';
    const out = parseConfigText(text, 'yaml');
    expect(out.ok).toBe(true);
    expect(out.value).toEqual({ country: 'NO' });
    const warns = warnings(out.issues);
    expect(warns).toHaveLength(1);
    expect(warns[0]!.message).toMatch(/1\.1.*boolean.*quote/);
    expect(text.slice(warns[0]!.from, warns[0]!.to)).toBe('NO');
  });

  it('warns on every member of the 1.1 boolean set, keys included', () => {
    for (const word of ['y', 'Y', 'n', 'N', 'yes', 'Yes', 'YES', 'no', 'No', 'on', 'On', 'ON', 'off', 'Off', 'OFF']) {
      const out = parseConfigText(`a: ${word}\n`, 'yaml');
      expect(warnings(out.issues), word).toHaveLength(1);
    }
    // A bare `no:` key is the same trap — 1.1 reads the key as false.
    expect(warnings(parseConfigText('no: 1\n', 'yaml').issues)).toHaveLength(1);
  });

  it('does not warn on a quoted "NO"', () => {
    expect(parseConfigText('country: "NO"\n', 'yaml').issues).toEqual([]);
    expect(parseConfigText("country: 'NO'\n", 'yaml').issues).toEqual([]);
  });

  it('does not warn on true/false — 1.2 already parses them as booleans', () => {
    const out = parseConfigText('a: true\nb: false\nc: True\nd: FALSE\n', 'yaml');
    expect(out.ok).toBe(true);
    expect(out.issues).toEqual([]);
  });

  it('does not warn on ordinary strings that merely contain the words', () => {
    const out = parseConfigText('a: yes we can\nb: nothing\nc: onwards\n', 'yaml');
    expect(out.issues).toEqual([]);
  });

  it('warns that 12:30 is a 1.1 sexagesimal', () => {
    const text = 'meeting: 12:30\n';
    const out = parseConfigText(text, 'yaml');
    expect(out.ok).toBe(true);
    expect(out.value).toEqual({ meeting: '12:30' });
    const warns = warnings(out.issues);
    expect(warns).toHaveLength(1);
    expect(warns[0]!.message).toMatch(/750/);
    expect(text.slice(warns[0]!.from, warns[0]!.to)).toBe('12:30');
  });

  it('warns that a leading-zero integer is octal to a 1.1 parser', () => {
    const text = 'mode: 0123\n';
    const out = parseConfigText(text, 'yaml');
    expect(out.ok).toBe(true);
    const warns = warnings(out.issues);
    expect(warns).toHaveLength(1);
    expect(warns[0]!.message).toMatch(/octal/);
    expect(text.slice(warns[0]!.from, warns[0]!.to)).toBe('0123');
  });

  it('does not read a quoted "0123" or a plain 0 as octal', () => {
    expect(parseConfigText('a: "0123"\n', 'yaml').issues).toEqual([]);
    expect(parseConfigText('a: 0\nb: 10\n', 'yaml').issues).toEqual([]);
  });

  it('warns on an unsafe integer in YAML too', () => {
    const out = parseConfigText('id: 9007199254740993\n', 'yaml');
    expect(out.ok).toBe(true);
    const warns = warnings(out.issues);
    expect(warns).toHaveLength(1);
    expect(warns[0]!.message).toMatch(/loses precision/);
  });

  it('warns that .nan and .inf have no JSON form', () => {
    const text = 'p: .nan\nq: .inf\nr: -.inf\n';
    const out = parseConfigText(text, 'yaml');
    expect(out.ok).toBe(true);
    const warns = warnings(out.issues);
    expect(warns).toHaveLength(3);
    for (const w of warns) expect(w.message).toMatch(/JSON cannot represent/);
    expectSanePositions(warns, text);
  });

  it('warns on anchors and aliases — JSON loses the shared structure', () => {
    const text = 'base: &defaults\n  retries: 3\nprod: *defaults\n';
    const out = parseConfigText(text, 'yaml');
    expect(out.ok).toBe(true);
    const warns = warnings(out.issues).filter((w) => /aliases expand/.test(w.message));
    expect(warns.length).toBeGreaterThanOrEqual(2);
    expectSanePositions(warns, text);
  });

  it('warns once per alias occurrence, at distinct positions', () => {
    const text = 'a: &x 1\nb: *x\nc: *x\n';
    const out = parseConfigText(text, 'yaml');
    const warns = warnings(out.issues).filter((w) => /aliases expand/.test(w.message));
    expect(warns).toHaveLength(3);
    expect(new Set(warns.map((w) => w.from)).size).toBe(3);
  });

  it('warns on a non-string mapping key', () => {
    const text = '{1: x}';
    const out = parseConfigText(text, 'yaml');
    expect(out.ok).toBe(true);
    expect(out.value).toEqual({ 1: 'x' });
    const warns = warnings(out.issues);
    expect(warns).toHaveLength(1);
    expect(warns[0]!.message).toMatch(/keys are strings.*stringified/);
    expect(text.slice(warns[0]!.from, warns[0]!.to)).toBe('1');
  });

  it('warns on boolean and null keys too, but not on quoted-number keys', () => {
    expect(warnings(parseConfigText('true: x\n', 'yaml').issues)).toHaveLength(1);
    expect(warnings(parseConfigText('~: x\n', 'yaml').issues)).toHaveLength(1);
    expect(parseConfigText('"1": x\n', 'yaml').issues).toEqual([]);
  });

  it('audits keep flowing when the document also has errors', () => {
    const out = parseConfigText('a: NO\na: 2\n', 'yaml');
    expect(out.ok).toBe(false);
    expect(errors(out.issues).length).toBeGreaterThan(0);
    expect(warnings(out.issues).some((w) => /boolean/.test(w.message))).toBe(true);
  });
});

describe('prettifyConfigText', () => {
  it('normalizes JSON to two-space indentation', () => {
    const out = prettifyConfigText('{"b":1,"a":[1,2]}', 'json');
    expect(out).toEqual({ ok: true, text: '{\n  "b": 1,\n  "a": [\n    1,\n    2\n  ]\n}' });
  });

  it('refuses broken JSON with the parse message', () => {
    const out = prettifyConfigText('{"a": }', 'json');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message.length).toBeGreaterThan(0);
  });

  it('keeps YAML comments — the reason this yaml package was chosen', () => {
    const text = '# top comment\nb: 1 # trailing\na: 2\n';
    const out = prettifyConfigText(text, 'yaml');
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.text).toContain('# top comment');
      expect(out.text).toContain('# trailing');
      // Key order survives too: prettify reformats, it does not reorder.
      expect(out.text.indexOf('b:')).toBeLessThan(out.text.indexOf('a:'));
    }
  });

  it('keeps anchors and aliases through a YAML round-trip', () => {
    const out = prettifyConfigText('a: &x 1\nb: *x\n', 'yaml');
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.text).toContain('&x');
      expect(out.text).toContain('*x');
    }
  });

  it('reformats sloppy YAML flow spacing', () => {
    const out = prettifyConfigText('a:   {x: 1,    y: 2}', 'yaml');
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.text).toBe('a: { x: 1, y: 2 }\n');
  });

  it('refuses YAML with errors, naming the first one', () => {
    const out = prettifyConfigText('a: 1\na: 2\n', 'yaml');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toMatch(/unique|repeated/i);
  });
});
