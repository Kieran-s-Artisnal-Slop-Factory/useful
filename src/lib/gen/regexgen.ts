/**
 * Regex → language snippets (plan §5.2). One pattern + flags in, idiomatic
 * compile / match / find-all snippets for Go, Rust, JS and Python out, with
 * per-language escaping and flag mapping. A construct scanner detects
 * features RE2-family engines (Go's regexp, Rust's regex crate) don't
 * support — lookahead/lookbehind and backreferences — and turns them into
 * warnings instead of silently emitting broken code.
 */

export interface RegexInput {
  pattern: string;
  ignoreCase: boolean;
  multiline: boolean;
  dotAll: boolean;
}

export interface Incompat {
  /** 'lookahead' | 'lookbehind' | 'backreference' */
  construct: string;
  index: number;
  text: string;
}

/**
 * Scan for RE2-incompatible constructs. Walks the pattern tracking escapes
 * and character classes so `\(?=` or `[(?=]` never false-positive, and a
 * named group `(?<name>` is NOT confused with lookbehind `(?<=` / `(?<!`.
 */
export function scanIncompatible(pattern: string): Incompat[] {
  const found: Incompat[] = [];
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === '\\') {
      const next = pattern[i + 1] ?? '';
      if (!inClass && next >= '1' && next <= '9') {
        found.push({ construct: 'backreference', index: i, text: '\\' + next });
      } else if (!inClass && next === 'k' && pattern[i + 2] === '<') {
        const end = pattern.indexOf('>', i + 2);
        found.push({
          construct: 'backreference',
          index: i,
          text: pattern.slice(i, end === -1 ? i + 3 : end + 1),
        });
      }
      i++; // the escaped char is consumed either way
      continue;
    }
    if (inClass) {
      if (ch === ']') inClass = false;
      continue;
    }
    if (ch === '[') {
      inClass = true;
      continue;
    }
    if (ch === '(' && pattern[i + 1] === '?') {
      const c2 = pattern[i + 2];
      if (c2 === '=' || c2 === '!') {
        found.push({ construct: 'lookahead', index: i, text: pattern.slice(i, i + 3) });
      } else if (c2 === '<') {
        const c3 = pattern[i + 3];
        if (c3 === '=' || c3 === '!') {
          found.push({ construct: 'lookbehind', index: i, text: pattern.slice(i, i + 4) });
        }
        // (?<name> is a named group — fine everywhere.
      }
    }
  }
  return found;
}

/** null when the pattern compiles (as a JS regex), else the syntax error. */
export function validatePattern(pattern: string): string | null {
  try {
    new RegExp(pattern);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/* ------------------------------------------------------------ escaping --- */

/** Rewrite (?<name> → (?P<name> and \k<name> → (?P=name) for Python. */
export function toPythonPattern(pattern: string): string {
  let out = '';
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === '\\') {
      if (!inClass && pattern[i + 1] === 'k' && pattern[i + 2] === '<') {
        const end = pattern.indexOf('>', i + 3);
        if (end !== -1) {
          out += `(?P=${pattern.slice(i + 3, end)})`;
          i = end;
          continue;
        }
      }
      out += ch + (pattern[i + 1] ?? '');
      i++;
      continue;
    }
    if (inClass) {
      if (ch === ']') inClass = false;
      out += ch;
      continue;
    }
    if (ch === '[') {
      inClass = true;
      out += ch;
      continue;
    }
    if (
      ch === '(' &&
      pattern[i + 1] === '?' &&
      pattern[i + 2] === '<' &&
      pattern[i + 3] !== '=' &&
      pattern[i + 3] !== '!'
    ) {
      out += '(?P<';
      i += 2;
      continue;
    }
    out += ch;
  }
  return out;
}

/** Python string literal for a pattern — raw when possible. */
export function pythonLiteral(pattern: string): string {
  // A raw string cannot end in an odd number of backslashes.
  const trailing = pattern.match(/\\+$/)?.[0].length ?? 0;
  if (trailing % 2 === 0) {
    if (!pattern.includes('"')) return `r"${pattern}"`;
    if (!pattern.includes("'")) return `r'${pattern}'`;
    if (!pattern.includes('"""')) return `r"""${pattern}"""`;
  }
  // Fall back to a normal string with explicit escapes.
  return `"${pattern.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

/** Go string literal — backtick raw string unless the pattern contains one. */
export function goLiteral(pattern: string): string {
  if (!pattern.includes('`')) return '`' + pattern + '`';
  return `"${pattern.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

/** Rust raw string, escalating `#` fencing as needed. */
export function rustLiteral(pattern: string): string {
  if (!pattern.includes('"')) return `r"${pattern}"`;
  let hashes = '#';
  while (pattern.includes('"' + hashes)) hashes += '#';
  return `r${hashes}"${pattern}"${hashes}`;
}

/** JS regex literal body — escape unescaped slashes. */
export function jsLiteralBody(pattern: string): string {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === '\\') {
      out += ch + (pattern[i + 1] ?? '');
      i++;
      continue;
    }
    out += ch === '/' ? '\\/' : ch;
  }
  // An empty pattern would read as a line comment (//): JS spells it (?:).
  return out.length === 0 ? '(?:)' : out;
}

/* ------------------------------------------------------------ snippets --- */

export interface LangSnippet {
  lang: 'js' | 'python' | 'go' | 'rust';
  label: string;
  /** Prism language key for highlighting. */
  prism: string;
  code: string;
  warnings: string[];
}

const RE2_WARNING: Record<string, string> = {
  lookahead: 'lookahead is not supported by this engine',
  lookbehind: 'lookbehind is not supported by this engine',
  backreference: 'backreferences are not supported by this engine',
};

/** "(?im)" style inline-flag prefix for Go/Rust. */
function inlineFlags(input: RegexInput): string {
  const flags =
    (input.ignoreCase ? 'i' : '') + (input.multiline ? 'm' : '') + (input.dotAll ? 's' : '');
  return flags.length > 0 ? `(?${flags})` : '';
}

export function buildSnippets(input: RegexInput): LangSnippet[] {
  const incompatible = scanIncompatible(input.pattern);
  const byConstruct = new Map<string, Set<string>>();
  for (const f of incompatible) {
    if (!byConstruct.has(f.construct)) byConstruct.set(f.construct, new Set());
    byConstruct.get(f.construct)!.add(f.text);
  }
  const re2Warnings = [...byConstruct.entries()].map(
    ([construct, texts]) => `${RE2_WARNING[construct]!} (${[...texts].join(', ')})`
  );

  const jsFlags =
    (input.ignoreCase ? 'i' : '') + (input.multiline ? 'm' : '') + (input.dotAll ? 's' : '');
  const jsBody = jsLiteralBody(input.pattern);
  const js = `const re = /${jsBody}/${jsFlags};

// match
if (re.test(text)) {
  // ...
}

// find all
const matches = [...text.matchAll(/${jsBody}/${jsFlags}g)];`;

  const pyFlags = [
    input.ignoreCase ? 're.IGNORECASE' : null,
    input.multiline ? 're.MULTILINE' : null,
    input.dotAll ? 're.DOTALL' : null,
  ].filter((f): f is string => f !== null);
  const pyArgs = pyFlags.length > 0 ? ', ' + pyFlags.join(' | ') : '';
  const python = `import re

pat = re.compile(${pythonLiteral(toPythonPattern(input.pattern))}${pyArgs})

# match
if pat.search(text):
    ...

# find all
matches = pat.findall(text)`;

  const goPattern = inlineFlags(input) + input.pattern;
  const go = `re := regexp.MustCompile(${goLiteral(goPattern)})

// match
if re.MatchString(text) {
    // ...
}

// find all
matches := re.FindAllString(text, -1)`;

  const rust = `use regex::Regex;

let re = Regex::new(${rustLiteral(goPattern)}).unwrap();

// match
if re.is_match(text) {
    // ...
}

// find all
let matches: Vec<&str> = re.find_iter(text).map(|m| m.as_str()).collect();`;

  return [
    { lang: 'js', label: 'JavaScript', prism: 'javascript', code: js, warnings: [] },
    { lang: 'python', label: 'Python', prism: 'python', code: python, warnings: [] },
    { lang: 'go', label: 'Go', prism: 'go', code: go, warnings: re2Warnings },
    { lang: 'rust', label: 'Rust', prism: 'rust', code: rust, warnings: re2Warnings },
  ];
}
