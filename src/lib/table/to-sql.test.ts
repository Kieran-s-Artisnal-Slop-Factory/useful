import { describe, expect, it } from 'vitest';
import {
  andClauses,
  escapeLike,
  quoteIdent,
  toKeysetOrderBy,
  toKeysetWhere,
  toSqlOrderBy,
  toSqlSearch,
  toSqlWhere,
} from './to-sql';
import type { Condition, FilterGroup, OperatorId } from './filter';
import { columnMap, normalizeSchema, type TableSchema } from './types';

const SCHEMA: TableSchema = {
  name: 'str',
  age: 'int',
  premium: 'boolean',
  joined: 'date',
  plan: { type: 'enum', options: ['free', 'pro'] },
};
const columns = normalizeSchema(SCHEMA);
const map = columnMap(columns);

const cond = (column: string, op: OperatorId, value?: unknown, value2?: unknown): Condition => ({
  kind: 'condition',
  id: `c-${column}-${op}`,
  column,
  op,
  value,
  value2,
});

const group = (combinator: 'and' | 'or', ...children: FilterGroup['children']): FilterGroup => ({
  kind: 'group',
  id: `g-${combinator}`,
  combinator,
  children,
});

const pg = (filter: FilterGroup) => toSqlWhere(filter, map, { dialect: 'postgres' });
const lite = (filter: FilterGroup) => toSqlWhere(filter, map, { dialect: 'sqlite' });

describe('quoteIdent', () => {
  it('quotes and doubles embedded quotes', () => {
    expect(quoteIdent('age')).toBe('"age"');
    expect(quoteIdent('we"ird')).toBe('"we""ird"');
  });

  it('neutralises an injection attempt in a column name', () => {
    expect(quoteIdent('x"; DROP TABLE t; --')).toBe('"x""; DROP TABLE t; --"');
  });
});

describe('escapeLike', () => {
  it('escapes wildcards and the escape character', () => {
    expect(escapeLike('100%')).toBe('100\\%');
    expect(escapeLike('a_b')).toBe('a\\_b');
    expect(escapeLike('back\\slash')).toBe('back\\\\slash');
  });
});

describe('toSqlWhere — parameterization', () => {
  it('never interpolates a value into the SQL', () => {
    const { where, params } = pg(group('and', cond('name', 'contains', "'; DROP TABLE users; --")));
    expect(where).not.toContain('DROP TABLE');
    expect(params[0]).toContain('DROP TABLE');
  });

  it('numbers placeholders for Postgres', () => {
    const { where, params } = pg(
      group('and', cond('age', 'gte', 30), cond('name', 'contains', 'ada'))
    );
    expect(where).toContain('$1');
    expect(where).toContain('$2');
    expect(params).toHaveLength(2);
  });

  it('uses positional placeholders for SQLite', () => {
    const { where, params } = lite(
      group('and', cond('age', 'gte', 30), cond('name', 'contains', 'ada'))
    );
    expect(where).not.toContain('$1');
    expect(where.match(/\?/g)).toHaveLength(2);
    expect(params).toHaveLength(2);
  });

  it('can start numbering part-way through, for stitched clauses', () => {
    const { where } = toSqlWhere(group('and', cond('age', 'gte', 30)), map, {
      dialect: 'postgres',
      startIndex: 3,
    });
    expect(where).toContain('$4');
  });

  it('coerces a typed value rather than binding the raw input string', () => {
    // An input always hands over a string; the column says it's a number.
    expect(pg(group('and', cond('age', 'gte', '30'))).params).toEqual([30]);
  });

  it('binds booleans per dialect', () => {
    expect(pg(group('and', cond('plan', 'eq', 'pro'))).params).toEqual(['pro']);
    expect(lite(group('and', cond('age', 'eq', '7'))).params).toEqual([7]);
  });
});

describe('toSqlWhere — operators', () => {
  const sqlFor = (op: OperatorId, value?: unknown, value2?: unknown, column = 'age') =>
    pg(group('and', cond(column, op, value, value2))).where;

  it('renders the comparisons', () => {
    expect(sqlFor('eq', 5)).toBe('"age" = $1');
    expect(sqlFor('gt', 5)).toBe('"age" > $1');
    expect(sqlFor('gte', 5)).toBe('"age" >= $1');
    expect(sqlFor('lt', 5)).toBe('"age" < $1');
    expect(sqlFor('lte', 5)).toBe('"age" <= $1');
  });

  it('matches NULL on "is not", as the client does', () => {
    expect(sqlFor('ne', 5)).toBe('("age" <> $1 OR "age" IS NULL)');
  });

  it('folds case for text comparisons', () => {
    expect(sqlFor('eq', 'Ada', undefined, 'name')).toBe('lower("name") = lower($1)');
  });

  it('orders between bounds given the wrong way round', () => {
    const { where, params } = pg(group('and', cond('age', 'between', 40, 20)));
    expect(where).toBe('"age" BETWEEN $1 AND $2');
    expect(params).toEqual([20, 40]);
  });

  it('keeps between bounds that are already in order', () => {
    expect(pg(group('and', cond('age', 'between', 20, 40))).params).toEqual([20, 40]);
  });

  it('orders date bounds chronologically, not lexically', () => {
    const { params } = pg(group('and', cond('joined', 'between', '2022-01-01', '2021-01-01')));
    expect(params).toEqual(['2021-01-01', '2022-01-01']);
  });

  it('builds LIKE patterns with the right wildcards', () => {
    const contains = pg(group('and', cond('name', 'contains', 'ada')));
    expect(contains.where).toContain('ILIKE');
    expect(contains.params).toEqual(['%ada%']);
    expect(pg(group('and', cond('name', 'startsWith', 'ada'))).params).toEqual(['ada%']);
    expect(pg(group('and', cond('name', 'endsWith', 'ada'))).params).toEqual(['%ada']);
  });

  it('escapes wildcards inside a search value', () => {
    expect(pg(group('and', cond('name', 'contains', '50%'))).params).toEqual(['%50\\%%']);
  });

  it('uses LIKE on SQLite, which is already case-insensitive', () => {
    expect(lite(group('and', cond('name', 'contains', 'ada'))).where).toContain('LIKE');
    expect(lite(group('and', cond('name', 'contains', 'ada'))).where).not.toContain('ILIKE');
  });

  it('matches NULL on "does not contain", as the client does', () => {
    expect(pg(group('and', cond('name', 'notContains', 'ada'))).where).toContain('IS NULL');
  });

  it('renders booleans per dialect', () => {
    expect(pg(group('and', cond('premium', 'isTrue'))).where).toBe('"premium" IS TRUE');
    expect(pg(group('and', cond('premium', 'isFalse'))).where).toBe('"premium" IS FALSE');
    expect(lite(group('and', cond('premium', 'isTrue'))).where).toBe('"premium" = 1');
    expect(lite(group('and', cond('premium', 'isFalse'))).where).toBe('"premium" = 0');
  });

  it('renders set membership', () => {
    const any = pg(group('and', cond('plan', 'anyOf', 'free, pro')));
    // `plan` is an enum, so Postgres needs the ::text cast before lower().
    expect(any.where).toBe('lower("plan"::text) IN (lower($1), lower($2))');
    expect(any.params).toEqual(['free', 'pro']);
    expect(pg(group('and', cond('plan', 'noneOf', 'free'))).where).toContain('NOT IN');
  });

  it('skips a set filter with nothing in it', () => {
    expect(pg(group('and', cond('plan', 'anyOf', ' , '))).where).toBe('');
  });

  it('treats an empty text column as empty, not just NULL', () => {
    expect(pg(group('and', cond('name', 'isEmpty'))).where).toBe(
      '("name" IS NULL OR trim("name") = \'\')'
    );
    expect(pg(group('and', cond('age', 'isEmpty'))).where).toBe('"age" IS NULL');
  });

  it('renders is-not-empty as the exact inverse', () => {
    expect(pg(group('and', cond('name', 'isNotEmpty'))).where).toBe(
      '("name" IS NOT NULL AND trim("name") <> \'\')'
    );
  });

  it('renders a regex on Postgres', () => {
    expect(pg(group('and', cond('name', 'matches', '^a'))).where).toBe('"name" ~* $1');
  });

  it('reports a regex unsupported on a SQLite with no REGEXP function', () => {
    // The default: a vanilla SQLite parses `X REGEXP Y` and then fails at run
    // time, so emitting it would error rather than merely match nothing.
    const sqlite = lite(group('and', cond('name', 'matches', '^a')));
    expect(sqlite.where).toBe('');
    expect(sqlite.unsupported[0]).toMatch(/REGEXP/);
  });

  it('renders a regex on SQLite once the connection registers regexp()', () => {
    const enabled = toSqlWhere(group('and', cond('name', 'matches', '^a')), map, {
      dialect: 'sqlite',
      regex: true,
    });
    expect(enabled.where).toBe('"name" REGEXP ?');
    expect(enabled.params).toEqual(['^a']);
    expect(enabled.unsupported).toEqual([]);
  });

  it('lets a caller declare Postgres without regex, since it is a connection fact', () => {
    const off = toSqlWhere(group('and', cond('name', 'matches', '^a')), map, {
      dialect: 'postgres',
      regex: false,
    });
    expect(off.where).toBe('');
    expect(off.unsupported).toHaveLength(1);
  });
});

describe('toSqlWhere — tree structure', () => {
  it('joins an AND group', () => {
    expect(pg(group('and', cond('age', 'gte', 30), cond('premium', 'isTrue'))).where).toBe(
      '("age" >= $1 AND "premium" IS TRUE)'
    );
  });

  it('joins an OR group', () => {
    expect(pg(group('or', cond('age', 'gte', 30), cond('premium', 'isTrue'))).where).toBe(
      '("age" >= $1 OR "premium" IS TRUE)'
    );
  });

  it('parenthesises a nested group so precedence survives', () => {
    const filter = group(
      'and',
      cond('premium', 'isTrue'),
      group('or', cond('plan', 'eq', 'free'), cond('age', 'gt', 40))
    );
    expect(pg(filter).where).toBe(
      '("premium" IS TRUE AND (lower("plan"::text) = lower($1) OR "age" > $2))'
    );
  });

  it('does not wrap a single condition in pointless brackets', () => {
    expect(pg(group('and', cond('age', 'gte', 30))).where).toBe('"age" >= $1');
  });

  it('skips incomplete conditions instead of emitting them', () => {
    const filter = group('and', cond('age', 'gte', 30), cond('name', 'contains', ''));
    const { where, params } = pg(filter);
    expect(where).toBe('"age" >= $1');
    expect(params).toEqual([30]);
  });

  it('returns nothing at all for a filter that is entirely incomplete', () => {
    const { where, params } = pg(group('and', cond('age', 'gte', ''), cond('name', 'contains', '')));
    expect(where).toBe('');
    expect(params).toEqual([]);
  });

  it('returns nothing for an empty group or a null filter', () => {
    expect(pg(group('and')).where).toBe('');
    expect(toSqlWhere(null, map).where).toBe('');
  });

  it('drops a group left empty by skipped children', () => {
    const filter = group(
      'and',
      cond('age', 'gte', 30),
      group('or', cond('name', 'contains', ''), cond('plan', 'eq', ''))
    );
    expect(pg(filter).where).toBe('"age" >= $1');
  });

  it('ignores a column that is not in the schema', () => {
    expect(pg(group('and', cond('nope', 'eq', 1))).where).toBe('');
  });
});

describe('toSqlOrderBy', () => {
  it('orders ascending and descending with NULLs last', () => {
    expect(toSqlOrderBy({ key: 'age', direction: 'asc' }, map, { dialect: 'postgres' })).toBe(
      '"age" ASC NULLS LAST'
    );
    expect(toSqlOrderBy({ key: 'age', direction: 'desc' }, map, { dialect: 'postgres' })).toBe(
      '"age" DESC NULLS LAST'
    );
  });

  it('emulates NULLS LAST on SQLite', () => {
    expect(toSqlOrderBy({ key: 'age', direction: 'asc' }, map, { dialect: 'sqlite' })).toBe(
      '("age" IS NULL), "age" ASC'
    );
  });

  it('is empty for no sort or an unknown column', () => {
    expect(toSqlOrderBy(null, map)).toBe('');
    expect(toSqlOrderBy({ key: 'nope', direction: 'asc' }, map)).toBe('');
  });

  it('refuses to order by a column marked unsortable', () => {
    const locked = columnMap(normalizeSchema({ id: { type: 'int', sortable: false } }));
    expect(toSqlOrderBy({ key: 'id', direction: 'asc' }, locked)).toBe('');
  });
});

describe('toSqlSearch', () => {
  it('ORs a cast LIKE across every column', () => {
    const { where, params } = toSqlSearch('ada', columns, { dialect: 'postgres' });
    expect(where).toContain('"name"::text ILIKE $1');
    expect(where).toContain(' OR ');
    expect(params).toHaveLength(columns.length);
    expect(params[0]).toBe('%ada%');
  });

  it('casts differently on SQLite', () => {
    expect(toSqlSearch('ada', columns, { dialect: 'sqlite' }).where).toContain(
      'CAST("name" AS TEXT) LIKE ?'
    );
  });

  it('is empty for a blank term', () => {
    expect(toSqlSearch('   ', columns).where).toBe('');
    expect(toSqlSearch('   ', columns).params).toEqual([]);
  });

  it('escapes wildcards in the term', () => {
    expect(toSqlSearch('50%', columns).params[0]).toBe('%50\\%%');
  });

  it('skips hidden columns', () => {
    const withHidden = normalizeSchema({ a: 'str', b: { type: 'str', hidden: true } });
    expect(toSqlSearch('x', withHidden).params).toHaveLength(1);
  });
});

describe('toKeysetOrderBy', () => {
  const opts = { dialect: 'sqlite' as const };

  it('orders by the key alone when nothing else is sorted', () => {
    expect(toKeysetOrderBy(null, 'age', map, opts)).toBe('"age" ASC');
  });

  it('appends the key as a tiebreaker, so the order is total', () => {
    expect(toKeysetOrderBy({ key: 'name', direction: 'asc' }, 'age', map, opts)).toBe(
      '("name" IS NULL), "name" ASC, "age" ASC'
    );
  });

  it('does not repeat the key when it is what you sorted by', () => {
    expect(toKeysetOrderBy({ key: 'age', direction: 'desc' }, 'age', map, opts)).toBe('"age" DESC');
  });

  it('runs the tiebreaker the same way as the sort it breaks ties for', () => {
    // The seek compares both with one operator, so an ASC key under a DESC
    // sort would disagree with the order and skip rows sharing a value.
    const order = toKeysetOrderBy({ key: 'name', direction: 'desc' }, 'age', map, opts);
    expect(order).toBe('("name" IS NULL), "name" DESC, "age" DESC');

    const seek = toKeysetWhere(
      { name: 'Ada', age: 36 },
      { key: 'name', direction: 'desc' },
      'age',
      map,
      opts
    );
    // Both comparisons point the same way as the order above.
    expect(seek.where).toBe('("name" < ? OR ("name" = ? AND "age" < ?))');
  });

  it('reverses everything when walking back a page', () => {
    expect(toKeysetOrderBy({ key: 'name', direction: 'asc' }, 'age', map, { ...opts, back: true }))
      .toBe('("name" IS NULL), "name" DESC, "age" DESC');
    expect(toKeysetOrderBy(null, 'age', map, { ...opts, back: true })).toBe('"age" DESC');
  });

  it('is empty when the key is not a column', () => {
    expect(toKeysetOrderBy(null, 'nope', map, opts)).toBe('');
  });
});

describe('toKeysetWhere', () => {
  const opts = { dialect: 'sqlite' as const };

  it('is empty on the first page, where there is no cursor', () => {
    expect(toKeysetWhere(null, null, 'age', map, opts).where).toBe('');
  });

  it('seeks past the cursor when sorting by the key itself', () => {
    const result = toKeysetWhere({ age: 36 }, null, 'age', map, opts);
    expect(result.where).toBe('"age" > ?');
    expect(result.params).toEqual([36]);
  });

  it('flips the comparison for a descending sort', () => {
    expect(toKeysetWhere({ age: 36 }, { key: 'age', direction: 'desc' }, 'age', map, opts).where)
      .toBe('"age" < ?');
  });

  it('flips again when walking back, which is how Prev works', () => {
    expect(toKeysetWhere({ age: 36 }, null, 'age', map, { ...opts, back: true }).where).toBe(
      '"age" < ?'
    );
    expect(
      toKeysetWhere({ age: 36 }, { key: 'age', direction: 'desc' }, 'age', map, {
        ...opts,
        back: true,
      }).where
    ).toBe('"age" > ?');
  });

  it('expands to the two-column form when sorting by something else', () => {
    const result = toKeysetWhere({ name: 'Ada', age: 36 }, { key: 'name', direction: 'asc' }, 'age', map, opts);
    expect(result.where).toBe('("name" > ? OR ("name" = ? AND "age" > ?))');
    expect(result.params).toEqual(['Ada', 'Ada', 36]);
  });

  it('numbers Postgres placeholders across the whole clause', () => {
    const result = toKeysetWhere(
      { name: 'Ada', age: 36 },
      { key: 'name', direction: 'asc' },
      'age',
      map,
      { dialect: 'postgres', startIndex: 2 }
    );
    expect(result.where).toBe('("name" > $3 OR ("name" = $4 AND "age" > $5))');
  });

  it('refuses to seek past a NULL sort value rather than skipping rows', () => {
    const result = toKeysetWhere(
      { name: null, age: 36 },
      { key: 'name', direction: 'asc' },
      'age',
      map,
      opts
    );
    expect(result.where).toBe('');
    expect(result.unsupported[0]).toMatch(/cursor paging/);
  });

  it('is empty when the cursor carries no key value', () => {
    expect(toKeysetWhere({ name: 'Ada' }, null, 'age', map, opts).where).toBe('');
  });

  it('is empty when the key is not a column', () => {
    expect(toKeysetWhere({ nope: 1 }, null, 'nope', map, opts).where).toBe('');
  });

  it('coerces the cursor value through the column type', () => {
    // The cursor came back from JSON, so the number arrived as a string.
    expect(toKeysetWhere({ age: '36' }, null, 'age', map, opts).params).toEqual([36]);
  });
});

describe('andClauses', () => {
  it('joins the non-empty clauses', () => {
    expect(andClauses('a = 1', '', 'b = 2')).toBe('a = 1 AND b = 2');
    expect(andClauses('', '')).toBe('');
    expect(andClauses('a = 1')).toBe('a = 1');
  });
});

describe('non-character Postgres columns', () => {
  // lower(), trim(), ILIKE and ~* all take text. Postgres raises rather than
  // coercing when handed a uuid, an enum or json, and `id` resolves to uuid —
  // so every table with a non-integer primary key hit this on the first
  // filter anyone built. SQLite has no such types and needs no cast.
  const ODD: TableSchema = {
    id: 'uuid',
    payload: 'json',
    plan: { type: 'enum', options: ['free', 'pro'] },
    name: 'str',
    age: 'int',
  };
  const oddColumns = normalizeSchema(ODD);
  const oddMap = columnMap(oddColumns);
  const oddPg = (filter: FilterGroup) => toSqlWhere(filter, oddMap, { dialect: 'postgres' });
  const oddLite = (filter: FilterGroup) => toSqlWhere(filter, oddMap, { dialect: 'sqlite' });

  it('casts a uuid before folding case', () => {
    expect(oddPg(group('and', cond('id', 'eq', 'abc'))).where).toBe(
      'lower("id"::text) = lower($1)'
    );
  });

  it('casts json before ILIKE', () => {
    expect(oddPg(group('and', cond('payload', 'contains', 'x'))).where).toBe(
      '"payload"::text ILIKE $1 ESCAPE \'\\\''
    );
  });

  it('casts an enum inside trim(), leaving the NULL half bare', () => {
    expect(oddPg(group('and', cond('plan', 'isEmpty'))).where).toBe(
      '("plan" IS NULL OR trim("plan"::text) = \'\')'
    );
    expect(oddPg(group('and', cond('plan', 'isNotEmpty'))).where).toBe(
      '("plan" IS NOT NULL AND trim("plan"::text) <> \'\')'
    );
  });

  it('casts a uuid before the regex operator', () => {
    expect(oddPg(group('and', cond('id', 'matches', '^a'))).where).toBe('"id"::text ~* $1');
  });

  it('casts an enum on both sides of a set membership', () => {
    expect(oddPg(group('and', cond('plan', 'anyOf', 'free, pro'))).where).toBe(
      'lower("plan"::text) IN (lower($1), lower($2))'
    );
  });

  it('keeps the bare identifier where a native comparison is wanted', () => {
    // A cast here would change collation order and stop the index being used.
    expect(oddPg(group('and', cond('age', 'gt', 30))).where).toBe('"age" > $1');
    expect(oddPg(group('and', cond('name', 'eq', 'Ada'))).where).toBe('lower("name") = lower($1)');
  });

  it('never casts the bound placeholder, only the identifier', () => {
    const result = oddPg(group('and', cond('id', 'eq', 'abc')));
    expect(result.where).not.toContain('$1::text');
  });

  it('emits no cast at all on SQLite', () => {
    expect(oddLite(group('and', cond('id', 'eq', 'abc'))).where).not.toContain('::text');
    expect(oddLite(group('and', cond('payload', 'contains', 'x'))).where).not.toContain('::text');
    expect(oddLite(group('and', cond('plan', 'isEmpty'))).where).not.toContain('::text');
  });

  it('leaves a keyset seek on a uuid key uncast, so it still index-seeks', () => {
    const seek = toKeysetWhere({ id: 'abc' }, null, 'id', oddMap, { dialect: 'postgres' });
    expect(seek.where).toBe('"id" > $1');
    expect(seek.where).not.toContain('::text');
  });

  it('skips an operator the column kind never offers', () => {
    // A tree built by hand can pair `gt` with a json column. Emitting it
    // produces SQL that errors, not SQL that merely matches nothing.
    expect(oddPg(group('and', cond('payload', 'gt', 5))).where).toBe('');
  });
});

describe('toKeysetWhere — seekable', () => {
  const opts = { dialect: 'sqlite' as const };

  it('reports page one as seekable — no cursor is not a failure', () => {
    expect(toKeysetWhere(null, null, 'age', map, opts).seekable).toBe(true);
    expect(toKeysetWhere(undefined, null, 'age', map, opts).seekable).toBe(true);
  });

  it('reports a successful seek as seekable', () => {
    expect(toKeysetWhere({ age: 36 }, null, 'age', map, opts).seekable).toBe(true);
    expect(
      toKeysetWhere({ name: 'Ada', age: 36 }, { key: 'name', direction: 'asc' }, 'age', map, opts)
        .seekable
    ).toBe(true);
  });

  it('is NOT seekable when the sort column is empty on the anchor row', () => {
    // This is the case that used to re-serve page one forever: the caller saw
    // an empty clause, ran the page-one query again, and the pager still
    // believed it had advanced.
    const result = toKeysetWhere(
      { name: null, age: 36 },
      { key: 'name', direction: 'asc' },
      'age',
      map,
      opts
    );
    expect(result.seekable).toBe(false);
    expect(result.where).toBe('');
    expect(result.unsupported[0]).toMatch(/cursor paging/);
  });

  it('is NOT seekable when the cursor carries no key value', () => {
    expect(toKeysetWhere({ name: 'Ada' }, null, 'age', map, opts).seekable).toBe(false);
  });

  it('is NOT seekable when the sort column is not in the schema', () => {
    expect(
      toKeysetWhere({ age: 36 }, { key: 'nope', direction: 'asc' }, 'age', map, opts).seekable
    ).toBe(false);
  });
});
