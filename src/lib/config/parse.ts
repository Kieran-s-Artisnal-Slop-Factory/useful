/**
 * Document parsing for the config playground: JSON via JSON.parse, YAML via
 * the eemeli `yaml` package (js-yaml is deliberately absent — it discards
 * comments and stops at the first error, and both properties matter here:
 * prettify must round-trip comments, and the editor wants every error at
 * once, each with a position CodeMirror can underline).
 *
 * Beyond plain errors, the YAML path audits for YAML 1.1 / JSON fidelity
 * traps — the Norway problem, sexagesimals, leading-zero octals, unsafe
 * integers, .inf/.nan, aliases, non-string keys — as positioned warnings.
 */
import { isScalar, parseDocument, Scalar, visit } from 'yaml';
import type { Alias, Document, Pair, YAMLMap, YAMLSeq } from 'yaml';

export type ConfigFormat = 'json' | 'yaml';

/**
 * Guess the format of pasted text. A leading `{` or `[` is JSON; empty or
 * whitespace-only text is 'json' too (the neutral default the UI opens
 * with); everything else is YAML. YAML is a superset of JSON, so a wrong
 * guess on JSON-ish YAML still parses — this only picks the mode toggle.
 */
export function sniffFormat(text: string): ConfigFormat {
  const trimmed = text.trim();
  if (trimmed === '') return 'json';
  return trimmed.startsWith('{') || trimmed.startsWith('[') ? 'json' : 'yaml';
}

/** Character offsets into the parsed text, from <= to — the shape a
 * CodeMirror diagnostic wants. */
export interface ParseIssue {
  from: number;
  to: number;
  message: string;
  severity: 'error' | 'warning';
}

/** ok=false -> value is undefined and at least one issue is an error;
 * ok=true may still carry warnings (the fidelity audits). */
export interface ParseOutcome {
  ok: boolean;
  value: unknown;
  issues: ParseIssue[];
}

export function parseConfigText(text: string, format: ConfigFormat): ParseOutcome {
  return format === 'json' ? parseJson(text) : parseYaml(text);
}

/**
 * Reformat a document without changing what it says. JSON is renormalized
 * to two-space indentation; YAML goes through parseDocument + toString,
 * which keeps comments, anchors, and key order — the reason the eemeli
 * package was chosen (js-yaml would silently delete every comment).
 * Broken input is refused rather than half-formatted.
 */
export function prettifyConfigText(
  text: string,
  format: ConfigFormat,
): { ok: true; text: string } | { ok: false; message: string } {
  if (format === 'json') {
    try {
      return { ok: true, text: JSON.stringify(JSON.parse(text), null, 2) };
    } catch (error) {
      return { ok: false, message: messageOf(error) };
    }
  }
  try {
    const doc = parseDocument(text);
    if (doc.errors.length > 0) return { ok: false, message: doc.errors[0]!.message };
    return { ok: true, text: doc.toString() };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

// --- JSON ------------------------------------------------------------------

function parseJson(text: string): ParseOutcome {
  try {
    const value: unknown = JSON.parse(text);
    return { ok: true, value, issues: scanJsonUnsafeIntegers(text) };
  } catch (error) {
    const at = jsonErrorOffset(messageOf(error), text);
    return {
      ok: false,
      value: undefined,
      issues: [
        {
          from: at,
          to: Math.min(at + 1, Math.max(text.length, at)),
          message: messageOf(error),
          severity: 'error',
        },
      ],
    };
  }
}

/**
 * Pull a character offset out of a JSON.parse error message. V8 says
 * 'at position N' (newer V8 appends '(line L column C)'); Firefox says
 * 'at line L column C of the JSON data'. Neither is guaranteed — some V8
 * messages carry no position at all — so 0 is the fallback.
 */
function jsonErrorOffset(message: string, text: string): number {
  const position = /at position (\d+)/.exec(message);
  if (position) return clampOffset(Number(position[1]), text);
  const lineCol = /line (\d+) column (\d+)/.exec(message);
  if (lineCol) {
    const line = Number(lineCol[1]);
    const column = Number(lineCol[2]);
    let offset = 0;
    for (let i = 1; i < line; i += 1) {
      const nl = text.indexOf('\n', offset);
      if (nl === -1) return clampOffset(offset, text);
      offset = nl + 1;
    }
    return clampOffset(offset + column - 1, text);
  }
  return 0;
}

function clampOffset(offset: number, text: string): number {
  if (!Number.isFinite(offset) || offset < 0) return 0;
  return Math.min(offset, Math.max(0, text.length - 1));
}

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Warn, with a position, on every integer literal outside ±2^53-1: parsed
 * JSON has already rounded them, so only the source text still knows.
 *
 * This is a string-skipping scan, not a JSON tokenizer: it steps over
 * double-quoted strings (honouring backslash escapes) and reads digit runs
 * everywhere else. On valid JSON — the only input it runs on — every digit
 * run outside a string belongs to a number literal, so it cannot misfire;
 * it makes no such promise about arbitrary text. Fractions and exponents
 * are skipped: floats are approximate by construction and warning on them
 * would be noise.
 */
function scanJsonUnsafeIntegers(text: string): ParseIssue[] {
  const issues: ParseIssue[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '"') {
      i += 1;
      while (i < text.length) {
        if (text[i] === '\\') i += 2;
        else if (text[i] === '"') {
          i += 1;
          break;
        } else i += 1;
      }
      continue;
    }
    if (ch === '-' || (ch >= '0' && ch <= '9')) {
      const start = i;
      if (ch === '-') i += 1;
      const digitsStart = i;
      while (i < text.length && text[i]! >= '0' && text[i]! <= '9') i += 1;
      const digitsEnd = i;
      let isInteger = digitsEnd > digitsStart;
      if (i < text.length && (text[i] === '.' || text[i] === 'e' || text[i] === 'E')) {
        isInteger = false;
        if (text[i] === '.') {
          i += 1;
          while (i < text.length && text[i]! >= '0' && text[i]! <= '9') i += 1;
        }
        if (i < text.length && (text[i] === 'e' || text[i] === 'E')) {
          i += 1;
          if (text[i] === '+' || text[i] === '-') i += 1;
          while (i < text.length && text[i]! >= '0' && text[i]! <= '9') i += 1;
        }
      }
      if (isInteger) {
        try {
          const value = BigInt(text.slice(start, digitsEnd));
          const magnitude = value < 0n ? -value : value;
          if (magnitude > MAX_SAFE) {
            issues.push({
              from: start,
              to: digitsEnd,
              message: 'This integer is outside ±2^53-1 — it loses precision in JavaScript',
              severity: 'warning',
            });
          }
        } catch {
          // A digit run BigInt refuses is not an integer literal; nothing to warn about.
        }
      }
      continue;
    }
    i += 1;
  }
  return issues;
}

// --- YAML ------------------------------------------------------------------

/** The YAML 1.1 boolean set minus true/false (which 1.2 parses as booleans,
 * so they never reach the string audit). Exact case variants only — that is
 * what the 1.1 spec resolves, `yES` was always a string. */
const YAML_11_BOOLEANS =
  /^(?:y|Y|n|N|yes|Yes|YES|no|No|NO|on|On|ON|off|Off|OFF)$/;

/** `12:30`, `1:2:3` — YAML 1.1 sexagesimal integers. */
const YAML_11_SEXAGESIMAL = /^[-+]?\d+(:\d+)+$/;

/** `0123` — octal in 1.1, decimal in 1.2 core. */
const YAML_11_OCTAL = /^-?0\d+$/;

function parseYaml(text: string): ParseOutcome {
  let doc: Document;
  try {
    // parseDocument never expands aliases, so an alias bomb parses instantly
    // and harmlessly; maxAliasCount belongs to toJS, where expansion happens.
    doc = parseDocument(text);
  } catch (error) {
    return {
      ok: false,
      value: undefined,
      issues: [{ from: 0, to: 1, message: messageOf(error), severity: 'error' }],
    };
  }

  const issues: ParseIssue[] = [];
  for (const error of doc.errors) issues.push(yamlIssue(error, 'error', text));
  for (const warning of doc.warnings) issues.push(yamlIssue(warning, 'warning', text));
  auditYamlFidelity(doc, issues, text);

  if (doc.errors.length > 0) return { ok: false, value: undefined, issues };

  try {
    // maxAliasCount is enforced here: an alias bomb parses instantly and
    // only explodes on materialization, which this converts to an error.
    const value: unknown = doc.toJS({ maxAliasCount: 100 });
    return { ok: true, value, issues };
  } catch (error) {
    issues.push({ from: 0, to: Math.min(1, text.length), message: messageOf(error), severity: 'error' });
    return { ok: false, value: undefined, issues };
  }
}

function yamlIssue(
  error: { message: string; pos?: [number, number] },
  severity: 'error' | 'warning',
  text: string,
): ParseIssue {
  const [from, to] = error.pos ?? [0, 1];
  const safeFrom = clampOffset(from, text);
  return {
    from: safeFrom,
    to: Math.max(safeFrom, Math.min(to, Math.max(text.length, safeFrom))),
    message: error.message,
    severity,
  };
}

/**
 * The YAML 1.1 / JSON fidelity audits, one warning per occurrence at the
 * node's own range. These are warnings, never errors: the document is valid
 * 1.2 YAML — the point is that a 1.1 parser (PyYAML, old libyaml bindings)
 * or a JSON round-trip will read it differently than the author sees here.
 */
function auditYamlFidelity(doc: Document, issues: ParseIssue[], text: string): void {
  const warn = (node: { range?: [number, number, number] | null }, message: string): void => {
    const [from, to] = node.range ?? [0, 1, 1];
    const safeFrom = clampOffset(from, text);
    issues.push({
      from: safeFrom,
      to: Math.max(safeFrom, Math.min(to, Math.max(text.length, safeFrom))),
      message,
      severity: 'warning',
    });
  };

  // Only specific visitor keys, never the generic `Node`: yaml's visit falls
  // through `Alias?.() ?? Node?.()` when the specific visitor returns
  // undefined, so mixing the two would fire twice per node.
  visit(doc, {
    Scalar(_key, node: Scalar) {
      auditScalar(node, warn);
    },
    Collection(_key, node: YAMLMap | YAMLSeq) {
      if (node.anchor !== undefined) {
        warn(node, 'aliases expand when this becomes JSON — shared structure is lost');
      }
    },
    Alias(_key, node: Alias) {
      warn(node, 'aliases expand when this becomes JSON — shared structure is lost');
    },
    Pair(_key, pair: Pair) {
      const key = pair.key;
      if (key == null) return;
      if (!isScalar(key) || typeof key.value !== 'string') {
        warn(
          key as { range?: [number, number, number] | null },
          'JSON object keys are strings — this key will be stringified',
        );
      }
    },
  });
}

function auditScalar(
  node: Scalar,
  warn: (node: { range?: [number, number, number] | null }, message: string) => void,
): void {
  if (node.anchor !== undefined) {
    warn(node, 'aliases expand when this becomes JSON — shared structure is lost');
  }
  const value = node.value;
  const plain = node.type === Scalar.PLAIN;
  const source = typeof node.source === 'string' ? node.source : String(value);

  if (typeof value === 'number' || typeof value === 'bigint') {
    const asNumber = Number(value);
    if (!Number.isFinite(asNumber)) {
      warn(node, 'JSON cannot represent this');
    } else if (Math.abs(asNumber) > Number.MAX_SAFE_INTEGER) {
      warn(node, 'This number is outside ±2^53-1 — it loses precision in JavaScript');
    }
  }

  if (!plain) return;

  // The octal check runs on the source, whatever 1.2 resolved it to — the
  // 1.1 misread (0123 as octal 83) is about the spelling, not the value.
  if (YAML_11_OCTAL.test(source)) {
    warn(node, "1.1 parsers read this as octal — quote it (or drop the leading zero) to be safe");
    return;
  }
  if (typeof value !== 'string') return;
  if (YAML_11_BOOLEANS.test(source)) {
    warn(node, 'YAML 1.1 parsers read this as a boolean — quote it to keep it a string');
  } else if (YAML_11_SEXAGESIMAL.test(source)) {
    warn(node, "1.1 parsers read 12:30 as the number 750 — quote it to keep it a string");
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
