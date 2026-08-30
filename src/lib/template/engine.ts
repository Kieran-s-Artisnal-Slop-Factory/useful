/**
 * The `{{placeholder}}` engine (0.4.0 plan, decision 1). Hand-rolled rather
 * than nunjucks: the requirement is *lookup*, not logic. There are no tags, no
 * filters, no inheritance and no autoescaping — a request body is not a place
 * for `{% for %}`. The `{{ }}` syntax is nunjucks-compatible, so swapping in a
 * real engine later stays possible if templating demand ever appears.
 *
 * Two entry points:
 *
 *  - `render(template, scopes)` resolves every placeholder against an ordered
 *    scope chain (first hit wins) and returns the text, or every reason it
 *    could not. The caller passes step -> environment -> global; the engine
 *    stays ignorant of what a scope *means*.
 *  - `lint(template)` reads the placeholders WITHOUT scopes, so a UI can say
 *    "this request needs `token`, `base_url`" and mark which are missing
 *    before anything is sent.
 *
 * An unresolved placeholder is an ERROR, never an empty string (decision 2).
 * Sending `Authorization: Bearer` because `{{token}}` quietly resolved to
 * nothing is the classic client bug, and it is silent at exactly the moment it
 * matters. Every failure carries the offset of the placeholder that caused it
 * and the placeholder text as written, so the caller can point at it.
 *
 * Syntax:
 *
 *     {{name}} {{obj.field}} {{list[0]}} {{obj.list[2].name}}
 *     {{ spaces inside the braces are fine }}      (around dots and brackets too)
 *     \{{name}}                                    a literal "{{name}}"
 *
 * Names start with a letter, `_` or `$` and may then contain letters, digits,
 * `_`, `$` and `-` (so `x-api-key` is one name — there is no arithmetic here to
 * confuse it with). Indexes are whole numbers only.
 *
 * The escape is a backslash directly before the braces, and only an ODD run of
 * backslashes escapes: `\{{x}}` is the literal text `{{x}}`, while `\\{{x}}`
 * is a real backslash followed by a placeholder that still resolves. That rule
 * exists so a JSON body can carry `"C:\\{{dir}}"` and mean it — `\{` is not a
 * legal JSON escape, so a lone backslash before `{{` was never JSON anyway.
 */

const OPEN = '{{';
const CLOSE = '}}';

const NAME_START = /[A-Za-z_$]/;
const NAME_CHAR = /[A-Za-z0-9_$-]/;

export type TemplateErrorCode =
  /** `{{` with no `}}` after it. */
  | 'unclosed'
  /** `{{}}` or `{{   }}`. */
  | 'empty'
  /** The path itself is malformed (`{{a b}}`, `{{a.}}`, `{{a[]}}`). */
  | 'syntax'
  /** No scope carries the root name. */
  | 'unresolved'
  /** The root resolved but a later segment does not exist. */
  | 'missing'
  /** `.field` applied to something that is not an object. */
  | 'not-an-object'
  /** `[0]` applied to something that is not a list. */
  | 'not-a-list'
  /** Resolved to an object, a list, null, or a number that is not finite. */
  | 'not-scalar';

export interface TemplateError {
  code: TemplateErrorCode;
  /** Absolute offset into the template of the `{{` that opened the placeholder. */
  offset: number;
  /** Length of the placeholder including its braces, so a caller can underline it. */
  length: number;
  /** The placeholder exactly as written, braces included. */
  text: string;
  /** The canonical path that failed, when one parsed (`obj.list[2].name`). */
  path?: string;
  /** The root name the path starts with — what a scope would have to provide. */
  name?: string;
  /** One sentence, written to be shown to a person. */
  message: string;
}

export interface Placeholder {
  /** Canonical dotted path, whitespace normalised away (`obj.list[2].name`). */
  path: string;
  /** The root name — what a scope must provide for this to resolve. */
  name: string;
  /** Absolute offset into the template of the `{{`. */
  offset: number;
  /** Length including the braces. */
  length: number;
  /** The placeholder exactly as written. */
  text: string;
}

/**
 * One link in the lookup chain. `name` is only ever used to *report* where a
 * value came from ("resolved from: environment"), which is what lets a caller
 * mask secrets in a preview without the engine knowing what a secret is.
 */
export interface Scope {
  name: string;
  values: Readonly<Record<string, unknown>>;
}

/** Where one placeholder's text came from. */
export interface Resolution {
  path: string;
  name: string;
  /** The `Scope.name` that won. */
  scope: string;
  /** The text that was substituted in. */
  value: string;
  offset: number;
  length: number;
}

export type RenderResult =
  /** `errors` is always empty here; it is present so callers can read it unconditionally. */
  | { ok: true; text: string; errors: TemplateError[]; resolutions: Resolution[] }
  | { ok: false; text: null; errors: TemplateError[]; resolutions: Resolution[] };

export interface LintResult {
  /** Every well-formed placeholder, in source order. */
  placeholders: Placeholder[];
  /** Distinct root names in first-seen order — the "this needs …" list. */
  names: string[];
  /** Syntax problems only. Resolution needs scopes, so `lint` cannot judge it. */
  errors: TemplateError[];
}

// --- paths ----------------------------------------------------------------

type PathSegment = { kind: 'key'; key: string } | { kind: 'index'; index: number };

interface ParsedPath {
  segments: PathSegment[];
  /** Canonical rendering of `segments`. */
  text: string;
  /** `segments[0]`, which is always a key. */
  name: string;
}

type ParsedPathResult = { ok: true; path: ParsedPath } | { ok: false; message: string };

/** Rebuild a path canonically, so `{{ a . b [ 0 ] }}` reports as `a.b[0]`. */
function pathText(segments: PathSegment[]): string {
  let out = '';
  for (const segment of segments) {
    if (segment.kind === 'index') out += `[${segment.index}]`;
    else out += out === '' ? segment.key : `.${segment.key}`;
  }
  return out;
}

/**
 * Parse the inside of one `{{ }}`. Whitespace is allowed anywhere; everything
 * else must be a name, a `.field` or an `[index]`.
 */
function parsePath(raw: string): ParsedPathResult {
  let i = 0;

  const skipSpace = () => {
    while (i < raw.length && /\s/.test(raw[i]!)) i++;
  };

  const readName = (): string | null => {
    if (i >= raw.length || !NAME_START.test(raw[i]!)) return null;
    const start = i;
    i++;
    while (i < raw.length && NAME_CHAR.test(raw[i]!)) i++;
    return raw.slice(start, i);
  };

  skipSpace();
  const root = readName();
  if (root === null) {
    return {
      ok: false,
      message:
        'a placeholder starts with a name — `{{name}}`, `{{obj.field}}` or `{{list[0]}}`.',
    };
  }

  const segments: PathSegment[] = [{ kind: 'key', key: root }];

  for (;;) {
    skipSpace();
    if (i >= raw.length) break;
    const char = raw[i]!;

    if (char === '.') {
      i++;
      skipSpace();
      const key = readName();
      if (key === null) return { ok: false, message: 'a field name has to follow the `.`.' };
      segments.push({ kind: 'key', key });
      continue;
    }

    if (char === '[') {
      i++;
      skipSpace();
      const start = i;
      while (i < raw.length && raw[i]! >= '0' && raw[i]! <= '9') i++;
      if (i === start) {
        return { ok: false, message: '`[` has to hold a whole number, like `[0]`.' };
      }
      const index = Number(raw.slice(start, i));
      skipSpace();
      if (raw[i] !== ']') return { ok: false, message: '`[` was never closed — add `]`.' };
      i++;
      segments.push({ kind: 'index', index });
      continue;
    }

    return { ok: false, message: `unexpected \`${char}\`.` };
  }

  return { ok: true, path: { segments, text: pathText(segments), name: root } };
}

// --- scanning -------------------------------------------------------------

interface ScannedPlaceholder extends Placeholder {
  segments: PathSegment[];
}

type Token =
  | { kind: 'text'; text: string }
  | { kind: 'placeholder'; placeholder: ScannedPlaceholder }
  | { kind: 'error'; error: TemplateError };

/**
 * One pass over the template producing literal text, well-formed placeholders
 * and syntax errors, in source order. Both `render` and `lint` walk this, so
 * they can never disagree about what a template says.
 */
function scan(template: string): Token[] {
  const tokens: Token[] = [];
  let pending = '';
  let i = 0;

  const flush = () => {
    if (pending !== '') {
      tokens.push({ kind: 'text', text: pending });
      pending = '';
    }
  };

  while (i < template.length) {
    const open = template.indexOf(OPEN, i);
    if (open < 0) {
      pending += template.slice(i);
      break;
    }

    // Only an odd run of backslashes escapes, and only backslashes we have not
    // already emitted count — see the escape rule in the file header.
    let slashes = 0;
    while (open - 1 - slashes >= i && template[open - 1 - slashes] === '\\') slashes++;
    if (slashes % 2 === 1) {
      pending += template.slice(i, open - 1) + OPEN;
      i = open + OPEN.length;
      continue;
    }

    pending += template.slice(i, open);

    const close = template.indexOf(CLOSE, open + OPEN.length);
    if (close < 0) {
      flush();
      const text = template.slice(open);
      tokens.push({
        kind: 'error',
        error: {
          code: 'unclosed',
          offset: open,
          length: text.length,
          text,
          message: '`{{` was never closed — add `}}`.',
        },
      });
      i = template.length;
      break;
    }

    const raw = template.slice(open + OPEN.length, close);
    const text = template.slice(open, close + CLOSE.length);
    flush();

    if (raw.trim() === '') {
      tokens.push({
        kind: 'error',
        error: {
          code: 'empty',
          offset: open,
          length: text.length,
          text,
          message: 'this placeholder is empty — put a name between the braces.',
        },
      });
    } else {
      const parsed = parsePath(raw);
      if (parsed.ok) {
        tokens.push({
          kind: 'placeholder',
          placeholder: {
            path: parsed.path.text,
            name: parsed.path.name,
            offset: open,
            length: text.length,
            text,
            segments: parsed.path.segments,
          },
        });
      } else {
        tokens.push({
          kind: 'error',
          error: {
            code: 'syntax',
            offset: open,
            length: text.length,
            text,
            message: `\`${text}\` is not a placeholder: ${parsed.message}`,
          },
        });
      }
    }

    i = close + CLOSE.length;
  }

  flush();
  return tokens;
}

// --- resolution -----------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** How to name a value's type in a message aimed at a person. */
function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `a list of ${value.length}`;
  switch (typeof value) {
    case 'string':
      return 'text';
    case 'number':
      return 'a number';
    case 'boolean':
      return 'true or false';
    case 'object':
      return 'an object';
    default:
      return `a ${typeof value}`;
  }
}

const has = (object: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(object, key);

type ResolveFailure = { ok: false; code: TemplateErrorCode; message: string };
type ResolveResult = { ok: true; scope: string; value: string } | ResolveFailure;

/**
 * Turn a resolved value into text. Strings go verbatim; numbers and booleans
 * through `String()`. Everything else is refused with the reason — a request
 * URL is not a place for `[object Object]`, and the string "null" in a header
 * is never what anyone meant.
 */
function asText(value: unknown, path: string): { ok: true; value: string } | ResolveFailure {
  if (typeof value === 'string') return { ok: true, value };
  if (typeof value === 'boolean') return { ok: true, value: String(value) };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return {
        ok: false,
        code: 'not-scalar',
        message: `\`${path}\` is ${String(value)}, which is not something that can be sent.`,
      };
    }
    return { ok: true, value: String(value) };
  }
  if (value === null) {
    return {
      ok: false,
      code: 'not-scalar',
      message: `\`${path}\` is null — inserting the text "null" is never what was meant.`,
    };
  }
  if (value === undefined) {
    return { ok: false, code: 'not-scalar', message: `\`${path}\` is not set.` };
  }
  return {
    ok: false,
    code: 'not-scalar',
    message: `\`${path}\` is ${describeType(value)} — a placeholder can only insert text, numbers and true/false.`,
  };
}

/** Walk one placeholder's path down the first scope that carries its root. */
function resolve(placeholder: ScannedPlaceholder, scopes: readonly Scope[]): ResolveResult {
  const root = placeholder.name;
  const hit = scopes.find((scope) => has(scope.values, root));
  if (!hit) {
    const where =
      scopes.length === 0
        ? 'no scopes were given'
        : `looked in ${scopes.map((scope) => scope.name).join(', ')}`;
    return {
      ok: false,
      code: 'unresolved',
      message: `No value named \`${root}\` (${where}).`,
    };
  }

  let current: unknown = hit.values[root];
  let walked = root;

  for (const segment of placeholder.segments.slice(1)) {
    if (current === null || current === undefined) {
      return {
        ok: false,
        code: 'missing',
        message: `\`${walked}\` is ${current === null ? 'null' : 'not set'}, so \`${placeholder.path}\` has nothing to read.`,
      };
    }

    if (segment.kind === 'key') {
      if (!isPlainObject(current)) {
        return {
          ok: false,
          code: 'not-an-object',
          message: `\`${walked}\` is ${describeType(current)}, so it has no \`${segment.key}\` field.`,
        };
      }
      if (!has(current, segment.key)) {
        return {
          ok: false,
          code: 'missing',
          message: `\`${walked}\` has no \`${segment.key}\` field.`,
        };
      }
      current = current[segment.key];
      walked += `.${segment.key}`;
    } else {
      if (!Array.isArray(current)) {
        return {
          ok: false,
          code: 'not-a-list',
          message: `\`${walked}\` is ${describeType(current)}, not a list, so \`[${segment.index}]\` cannot pick from it.`,
        };
      }
      if (segment.index >= current.length) {
        return {
          ok: false,
          code: 'missing',
          message: `\`${walked}\` has ${current.length} item${current.length === 1 ? '' : 's'}, so there is no \`[${segment.index}]\`.`,
        };
      }
      current = current[segment.index];
      walked += `[${segment.index}]`;
    }
  }

  const text = asText(current, placeholder.path);
  if (!text.ok) return text;
  return { ok: true, scope: hit.name, value: text.value };
}

// --- public API -----------------------------------------------------------

/**
 * Resolve every placeholder against `scopes`, first hit wins. Returns the
 * rendered text, or `ok: false` with EVERY reason it failed — the pre-send
 * panel lists them all, so stopping at the first would mean fixing one name
 * per attempt. `resolutions` is filled either way, so a caller can show what
 * did resolve and where from even when the render as a whole is blocked.
 */
export function render(template: string, scopes: readonly Scope[] = []): RenderResult {
  const errors: TemplateError[] = [];
  const resolutions: Resolution[] = [];
  let out = '';

  for (const token of scan(template)) {
    if (token.kind === 'text') {
      out += token.text;
      continue;
    }
    if (token.kind === 'error') {
      errors.push(token.error);
      continue;
    }

    const placeholder = token.placeholder;
    const resolved = resolve(placeholder, scopes);
    if (!resolved.ok) {
      errors.push({
        code: resolved.code,
        offset: placeholder.offset,
        length: placeholder.length,
        text: placeholder.text,
        path: placeholder.path,
        name: placeholder.name,
        message: resolved.message,
      });
      continue;
    }

    out += resolved.value;
    resolutions.push({
      path: placeholder.path,
      name: placeholder.name,
      scope: resolved.scope,
      value: resolved.value,
      offset: placeholder.offset,
      length: placeholder.length,
    });
  }

  if (errors.length > 0) return { ok: false, text: null, errors, resolutions };
  return { ok: true, text: out, errors, resolutions };
}

/**
 * Read the placeholders without resolving anything. No scopes are involved, so
 * the only errors this can report are syntax ones — which is the point: a
 * template can be linted while its environment is still being filled in.
 */
export function lint(template: string): LintResult {
  const placeholders: Placeholder[] = [];
  const errors: TemplateError[] = [];
  const names: string[] = [];

  for (const token of scan(template)) {
    if (token.kind === 'error') {
      errors.push(token.error);
      continue;
    }
    if (token.kind !== 'placeholder') continue;

    const { path, name, offset, length, text } = token.placeholder;
    placeholders.push({ path, name, offset, length, text });
    if (!names.includes(name)) names.push(name);
  }

  return { placeholders, names, errors };
}

/**
 * The names in `template` that no scope can supply, in first-seen order. The
 * pre-send panel's "missing" list; `render` reports the same thing per
 * placeholder, but a UI wants the summary before the user presses anything.
 */
export function missingNames(template: string, scopes: readonly Scope[] = []): string[] {
  return lint(template).names.filter(
    (name) => !scopes.some((scope) => has(scope.values, name))
  );
}
