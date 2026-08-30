import { describe, expect, it } from 'vitest';
import { lint, missingNames, render, type Scope, type TemplateErrorCode } from './engine';

/** The scope chain the HTTP playground will pass: step -> environment -> global. */
function chain(
  step: Record<string, unknown> = {},
  environment: Record<string, unknown> = {},
  global: Record<string, unknown> = {}
): Scope[] {
  return [
    { name: 'step', values: step },
    { name: 'environment', values: environment },
    { name: 'Global', values: global },
  ];
}

function one(scope: Record<string, unknown>): Scope[] {
  return [{ name: 'environment', values: scope }];
}

/** Render and insist it worked, so a failing case reports WHY, not `null`. */
function text(template: string, scopes: Scope[] = []): string {
  const result = render(template, scopes);
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join(' / '));
  return result.text;
}

describe('render — syntax forms', () => {
  const values = {
    name: 'Ada',
    empty: '',
    obj: { field: 'inner', nested: { deep: 'bottom' } },
    arr: ['zero', 'one', 'two'],
    mixed: { list: [{ name: 'first' }, { name: 'second' }, { name: 'third' }] },
    'x-api-key': 'k-123',
    $dollar: 'dollars',
    _under: 'score',
  };

  const cases: [string, string][] = [
    ['{{name}}', 'Ada'],
    ['hello {{name}}!', 'hello Ada!'],
    ['{{name}}{{name}}', 'AdaAda'],
    ['{{obj.field}}', 'inner'],
    ['{{obj.nested.deep}}', 'bottom'],
    ['{{arr[0]}}', 'zero'],
    ['{{arr[2]}}', 'two'],
    ['{{mixed.list[1].name}}', 'second'],
    ['{{empty}}', ''],
    ['{{x-api-key}}', 'k-123'],
    ['{{$dollar}}', 'dollars'],
    ['{{_under}}', 'score'],
    // Whitespace is tolerated anywhere inside the braces.
    ['{{ name }}', 'Ada'],
    ['{{\tname\n}}', 'Ada'],
    ['{{ obj . field }}', 'inner'],
    ['{{ mixed . list [ 1 ] . name }}', 'second'],
    // No placeholders at all.
    ['', ''],
    ['plain text', 'plain text'],
    // A lone brace pair is not a placeholder opener.
    ['{ name }', '{ name }'],
    ['}}', '}}'],
    // JSON bodies keep their shape.
    ['{"user": "{{name}}", "key": "{{obj.field}}"}', '{"user": "Ada", "key": "inner"}'],
  ];

  for (const [template, expected] of cases) {
    it(`renders ${JSON.stringify(template)}`, () => {
      expect(text(template, one(values))).toBe(expected);
    });
  }

  it('reports the canonical path and scope for every substitution', () => {
    const result = render('{{ mixed . list [ 1 ] . name }}', one(values));
    expect(result.ok).toBe(true);
    expect(result.resolutions).toEqual([
      {
        path: 'mixed.list[1].name',
        name: 'mixed',
        scope: 'environment',
        value: 'second',
        offset: 0,
        length: 31,
      },
    ]);
  });
});

describe('render — the escape', () => {
  const values = { x: 'VALUE', dir: 'tmp' };

  const cases: [string, string][] = [
    // One backslash escapes: the braces come out literally, the backslash does not.
    ['\\{{x}}', '{{x}}'],
    ['a \\{{x}} b', 'a {{x}} b'],
    ['\\{{x}} {{x}}', '{{x}} VALUE'],
    ['{{x}} \\{{x}}', 'VALUE {{x}}'],
    ['\\{{x}}\\{{x}}', '{{x}}{{x}}'],
    // Two backslashes are a real backslash: the placeholder still resolves and
    // the JSON escape survives untouched. This is the case the odd/even rule exists for.
    ['C:\\\\{{dir}}', 'C:\\\\tmp'],
    ['\\\\{{x}}', '\\\\VALUE'],
    // Three: one is consumed by the escape, two remain.
    ['\\\\\\{{x}}', '\\\\{{x}}'],
    // A backslash that is not before braces is ordinary text.
    ['a\\b {{x}}', 'a\\b VALUE'],
    ['\\', '\\'],
  ];

  for (const [template, expected] of cases) {
    it(`renders ${JSON.stringify(template)}`, () => {
      expect(text(template, one(values))).toBe(expected);
    });
  }

  it('an escaped placeholder is not reported as a name to supply', () => {
    expect(lint('\\{{x}} {{y}}').names).toEqual(['y']);
  });
});

describe('render — scope precedence', () => {
  it('takes the first scope that has the name', () => {
    const scopes = chain({ token: 'from-step' }, { token: 'from-env' }, { token: 'from-global' });
    const result = render('{{token}}', scopes);
    expect(result.text).toBe('from-step');
    expect(result.resolutions[0]?.scope).toBe('step');
  });

  it('falls through to the environment, then to Global', () => {
    expect(text('{{token}}', chain({}, { token: 'env' }, { token: 'glob' }))).toBe('env');
    expect(text('{{token}}', chain({}, {}, { token: 'glob' }))).toBe('glob');
  });

  it('resolves each name in its own scope within one render', () => {
    const scopes = chain({ a: '1' }, { b: '2' }, { c: '3' });
    const result = render('{{a}}{{b}}{{c}}', scopes);
    expect(result.text).toBe('123');
    expect(result.resolutions.map((r) => r.scope)).toEqual(['step', 'environment', 'Global']);
  });

  it('a scope that HOLDS the name wins even when the value is unusable', () => {
    // Shadowing is about presence, not usability: an earlier scope holding
    // null must not silently fall through to a later one that would have worked.
    const result = render('{{token}}', chain({ token: null }, { token: 'env' }));
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.code).toBe('not-scalar');
  });

  it('an inherited property is not a value', () => {
    const values = Object.create({ inherited: 'nope' }) as Record<string, unknown>;
    values.own = 'yes';
    expect(text('{{own}}', one(values))).toBe('yes');
    expect(render('{{inherited}}', one(values)).ok).toBe(false);
    // Nor is one on a nested object.
    const nested = { obj: Object.create({ proto: 'nope' }) as Record<string, unknown> };
    expect(render('{{obj.proto}}', one(nested)).ok).toBe(false);
    expect(render('{{obj.constructor}}', one({ obj: {} })).ok).toBe(false);
  });

  it('names the scopes it looked in', () => {
    const result = render('{{token}}', chain());
    expect(result.errors[0]?.message).toBe(
      'No value named `token` (looked in step, environment, Global).'
    );
    expect(render('{{token}}').errors[0]?.message).toBe(
      'No value named `token` (no scopes were given).'
    );
  });
});

describe('render — value types', () => {
  it('interpolates strings verbatim, including ones that look like markup', () => {
    expect(text('{{x}}', one({ x: '<b>&</b> "quoted" \\ {{not-a-placeholder}}' }))).toBe(
      '<b>&</b> "quoted" \\ {{not-a-placeholder}}'
    );
  });

  it('renders numbers and booleans through String()', () => {
    expect(text('{{x}}', one({ x: 0 }))).toBe('0');
    expect(text('{{x}}', one({ x: -12.5 }))).toBe('-12.5');
    expect(text('{{x}}', one({ x: 1e21 }))).toBe('1e+21');
    expect(text('{{x}}', one({ x: true }))).toBe('true');
    expect(text('{{x}}', one({ x: false }))).toBe('false');
  });

  const refused: [string, unknown, TemplateErrorCode][] = [
    ['an object', { a: 1 }, 'not-scalar'],
    ['a list', [1, 2], 'not-scalar'],
    ['null', null, 'not-scalar'],
    ['undefined', undefined, 'not-scalar'],
    ['NaN', Number.NaN, 'not-scalar'],
    ['Infinity', Number.POSITIVE_INFINITY, 'not-scalar'],
    ['a bigint', 1n, 'not-scalar'],
  ];

  for (const [label, value, code] of refused) {
    it(`refuses ${label} with a reason`, () => {
      const result = render('{{x}}', one({ x: value }));
      expect(result.ok).toBe(false);
      expect(result.text).toBeNull();
      expect(result.errors[0]?.code).toBe(code);
      expect(result.errors[0]?.message.length).toBeGreaterThan(0);
    });
  }

  it('says what an object is instead of writing [object Object]', () => {
    expect(render('{{user}}', one({ user: { id: 1 } })).errors[0]?.message).toBe(
      '`user` is an object — a placeholder can only insert text, numbers and true/false.'
    );
    expect(render('{{user}}', one({ user: [1, 2, 3] })).errors[0]?.message).toBe(
      '`user` is a list of 3 — a placeholder can only insert text, numbers and true/false.'
    );
  });
});

describe('render — errors carry their offset and the placeholder text', () => {
  interface Case {
    label: string;
    template: string;
    scopes?: Scope[];
    code: TemplateErrorCode;
    offset: number;
    length: number;
    text: string;
  }

  const values = one({ known: 'ok', obj: { a: 'a' }, arr: ['zero'], str: 'text' });

  const cases: Case[] = [
    {
      label: 'unclosed braces',
      template: 'GET /x/{{id',
      code: 'unclosed',
      offset: 7,
      length: 4,
      text: '{{id',
    },
    {
      label: 'unclosed after a good placeholder',
      template: '{{known}} and {{oops',
      scopes: values,
      code: 'unclosed',
      offset: 14,
      length: 6,
      text: '{{oops',
    },
    {
      label: 'empty braces',
      template: 'a {{}} b',
      code: 'empty',
      offset: 2,
      length: 4,
      text: '{{}}',
    },
    {
      label: 'whitespace-only braces',
      template: '{{   }}',
      code: 'empty',
      offset: 0,
      length: 7,
      text: '{{   }}',
    },
    {
      label: 'two names side by side',
      template: 'x {{a b}}',
      code: 'syntax',
      offset: 2,
      length: 7,
      text: '{{a b}}',
    },
    {
      label: 'a trailing dot',
      template: '{{a.}}',
      code: 'syntax',
      offset: 0,
      length: 6,
      text: '{{a.}}',
    },
    {
      label: 'a name that starts with a digit',
      template: '{{1a}}',
      code: 'syntax',
      offset: 0,
      length: 6,
      text: '{{1a}}',
    },
    {
      label: 'an empty index',
      template: '{{a[]}}',
      code: 'syntax',
      offset: 0,
      length: 7,
      text: '{{a[]}}',
    },
    {
      label: 'an unclosed index',
      template: '{{a[0}}',
      code: 'syntax',
      offset: 0,
      length: 7,
      text: '{{a[0}}',
    },
    {
      label: 'a negative index',
      template: '{{a[-1]}}',
      code: 'syntax',
      offset: 0,
      length: 9,
      text: '{{a[-1]}}',
    },
    {
      label: 'an unknown name',
      template: 'Bearer {{token}}',
      scopes: values,
      code: 'unresolved',
      offset: 7,
      length: 9,
      text: '{{token}}',
    },
    {
      label: 'a field that does not exist',
      template: '{{obj.nope}}',
      scopes: values,
      code: 'missing',
      offset: 0,
      length: 12,
      text: '{{obj.nope}}',
    },
    {
      label: 'an index past the end',
      template: '{{arr[5]}}',
      scopes: values,
      code: 'missing',
      offset: 0,
      length: 10,
      text: '{{arr[5]}}',
    },
    {
      label: 'a field on a string',
      template: '{{str.length}}',
      scopes: values,
      code: 'not-an-object',
      offset: 0,
      length: 14,
      text: '{{str.length}}',
    },
    {
      label: 'a field on a list',
      template: '{{arr.length}}',
      scopes: values,
      code: 'not-an-object',
      offset: 0,
      length: 14,
      text: '{{arr.length}}',
    },
    {
      label: 'an index into a non-list',
      template: '{{obj[0]}}',
      scopes: values,
      code: 'not-a-list',
      offset: 0,
      length: 10,
      text: '{{obj[0]}}',
    },
    {
      label: 'a value that is not text',
      template: '{{obj}}',
      scopes: values,
      code: 'not-scalar',
      offset: 0,
      length: 7,
      text: '{{obj}}',
    },
  ];

  for (const c of cases) {
    it(c.label, () => {
      const result = render(c.template, c.scopes ?? []);
      expect(result.ok).toBe(false);
      expect(result.text).toBeNull();
      expect(result.errors).toHaveLength(1);
      const error = result.errors[0]!;
      expect(error.code).toBe(c.code);
      expect(error.offset).toBe(c.offset);
      expect(error.length).toBe(c.length);
      expect(error.text).toBe(c.text);
      expect(c.template.slice(error.offset, error.offset + error.length)).toBe(c.text);
      expect(error.message).toMatch(/\S/);
    });
  }

  it('reports EVERY failure, not just the first', () => {
    const result = render('{{a}} {{b}} {{c.d}} {{}}', one({ c: {} }));
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toEqual([
      'unresolved',
      'unresolved',
      'missing',
      'empty',
    ]);
    expect(result.errors.map((e) => e.offset)).toEqual([0, 6, 12, 20]);
  });

  it('keeps the resolutions it did manage even when the render is blocked', () => {
    const result = render('{{good}} {{bad}}', one({ good: 'yes' }));
    expect(result.ok).toBe(false);
    expect(result.text).toBeNull();
    expect(result.resolutions.map((r) => r.path)).toEqual(['good']);
    expect(result.errors.map((e) => e.name)).toEqual(['bad']);
  });

  it('carries the path and root name on resolution failures', () => {
    const error = render('{{obj.list[2].name}}', one({ obj: { list: [] } })).errors[0]!;
    expect(error.path).toBe('obj.list[2].name');
    expect(error.name).toBe('obj');
    expect(error.message).toBe('`obj.list` has 0 items, so there is no `[2]`.');
  });
});

describe('lint', () => {
  it('lists the placeholders and the distinct names in source order', () => {
    const result = lint('{{b}} {{a.x}} {{b}} {{c[0]}}');
    expect(result.names).toEqual(['b', 'a', 'c']);
    expect(result.placeholders.map((p) => p.path)).toEqual(['b', 'a.x', 'b', 'c[0]']);
    expect(result.placeholders.map((p) => p.offset)).toEqual([0, 6, 14, 20]);
    expect(result.errors).toEqual([]);
  });

  it('normalises whitespace out of the reported path but keeps the source text', () => {
    const result = lint('{{ obj . list [ 0 ] }}');
    expect(result.placeholders[0]!.path).toBe('obj.list[0]');
    expect(result.placeholders[0]!.text).toBe('{{ obj . list [ 0 ] }}');
    expect(result.placeholders[0]!.length).toBe(22);
  });

  it('reads names from a template that cannot render — that is the point', () => {
    const template = 'Bearer {{token}} for {{base_url}}/{{path}}';
    expect(lint(template).names).toEqual(['token', 'base_url', 'path']);
    expect(lint(template).errors).toEqual([]);
    // Nothing resolves, so rendering fails; linting still told the UI what to ask for.
    expect(render(template, chain()).ok).toBe(false);
  });

  it('reports syntax errors but never resolution ones, since it has no scopes', () => {
    const result = lint('{{ok}} {{a b}} {{');
    expect(result.names).toEqual(['ok']);
    expect(result.errors.map((e) => e.code)).toEqual(['syntax', 'unclosed']);
  });

  it('finds nothing in a template without placeholders', () => {
    expect(lint('nothing here { } }} to see')).toEqual({
      placeholders: [],
      names: [],
      errors: [],
    });
  });
});

describe('missingNames', () => {
  it('names only what no scope can supply, in first-seen order', () => {
    const scopes = chain({ token: 't' }, { base_url: 'u' });
    expect(missingNames('{{base_url}}/{{path}}?k={{token}}&j={{path}}', scopes)).toEqual(['path']);
    expect(missingNames('{{token}}', scopes)).toEqual([]);
    expect(missingNames('{{a}} {{b}}', scopes)).toEqual(['a', 'b']);
  });

  it('counts a name a scope holds as present even if its value is unusable', () => {
    // `missingNames` answers "is it defined anywhere"; `render` judges the value.
    expect(missingNames('{{token}}', chain({ token: null }))).toEqual([]);
  });
});
