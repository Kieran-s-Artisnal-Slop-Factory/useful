import { expect } from '@playwright/test';
import { TABLES } from './schema';

/**
 * The typed comparator. Every distinction corresponds to a real round-trip bug:
 * `1` vs `"1"`, `true` vs `1`, `null` vs `undefined` vs an ABSENT key
 * (a field silently dropped by a backup), `[]` vs `null`, float precision.
 */
export interface Diff {
  path: string;
  expected: unknown;
  expectedType: string;
  actual: unknown;
  actualType: string;
}

const typeOf = (v: unknown): string => {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (Array.isArray(v)) return 'array';
  return typeof v;
};

export function diffValues(expected: unknown, actual: unknown, path = ''): Diff[] {
  const et = typeOf(expected);
  const at = typeOf(actual);
  const mismatch = (): Diff[] => [
    { path: path || '(root)', expected, expectedType: et, actual, actualType: at },
  ];
  if (et !== at) return mismatch();
  if (et === 'array') {
    const e = expected as unknown[];
    const a = actual as unknown[];
    if (e.length !== a.length) return mismatch();
    return e.flatMap((v, i) => diffValues(v, a[i], path + '[' + i + ']'));
  }
  if (et === 'object') {
    const e = expected as Record<string, unknown>;
    const a = actual as Record<string, unknown>;
    const out: Diff[] = [];
    for (const key of new Set([...Object.keys(e), ...Object.keys(a)])) {
      const child = path ? path + '.' + key : key;
      if (!(key in e) || !(key in a)) {
        out.push({
          path: child,
          expected: e[key],
          expectedType: key in e ? typeOf(e[key]) : 'absent',
          actual: a[key],
          actualType: key in a ? typeOf(a[key]) : 'absent',
        });
        continue;
      }
      out.push(...diffValues(e[key], a[key], child));
    }
    return out;
  }
  return Object.is(expected, actual) ? [] : mismatch();
}

export type Db = Record<string, Record<string, unknown>[]>;

export function diffDb(expected: Db, actual: Db): Diff[] {
  const stores = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  const out: Diff[] = [];
  for (const store of stores) {
    const byId = (rows: Record<string, unknown>[]) => new Map(rows.map((r) => [String(r.id), r]));
    const e = byId(expected[store] ?? []);
    const a = byId(actual[store] ?? []);
    for (const id of new Set([...e.keys(), ...a.keys()])) {
      const left = e.get(id);
      const right = a.get(id);
      if (!left || !right) {
        out.push({
          path: store + '.id=' + id,
          expected: left,
          expectedType: left ? 'row' : 'missing',
          actual: right,
          actualType: right ? 'row' : 'missing',
        });
        continue;
      }
      out.push(...diffValues(left, right, store + '.id=' + id));
    }
  }
  return out;
}

export function formatDiffs(diffs: Diff[]): string {
  return diffs
    .map(
      (d) =>
        '  ' + d.path + ': expected ' + JSON.stringify(d.expected) + ' (' + d.expectedType +
        ') but got ' + JSON.stringify(d.actual) + ' (' + d.actualType + ')'
    )
    .join('\n');
}

export function assertSameDb(expected: Db, actual: Db, label: string): void {
  const diffs = diffDb(expected, actual);
  expect(diffs.length === 0, label + ':\n' + formatDiffs(diffs)).toBe(true);
}

/**
 * The collateral-damage detector: after a case changes one field of one row,
 * the total delta across every store must be exactly that change. Most real
 * data loss shows up here, not in the targeted assertion.
 */
export function assertIsolatedDelta(
  before: Db,
  after: Db,
  allowed: { store: string; id: string }[]
): void {
  const allow = new Set(allowed.map((x) => x.store + ':' + x.id));
  const unexpected = diffDb(before, after)
    .filter((d) => {
      const [store, rest] = d.path.split('.', 2);
      const id = (rest ?? '').replace(/^id=/, '').split(/[.[]/, 1)[0];
      return !allow.has(store + ':' + id);
    })
    .map((d) => d.path);
  expect(
    unexpected.length === 0,
    'unrelated rows changed:\n  ' + [...new Set(unexpected)].join('\n  ')
  ).toBe(true);
}

/** Structural invariants any healthy database satisfies. */
export function assertInvariants(db: Db, label: string): void {
  const live = (store: string) => (db[store] ?? []).filter((r) => !r.deleted_at);
  for (const table of TABLES) {
    const rows = db[table.name] ?? [];
    const ids = rows.map((r) => String(r.id));
    expect(new Set(ids).size, label + ': duplicate ids in ' + table.name).toBe(ids.length);
    if (table.singleton) {
      expect(
        live(table.name).length,
        label + ': ' + table.name + ' is not a singleton'
      ).toBeLessThanOrEqual(1);
    }
    for (const col of table.columns) {
      if (!col.references) continue;
      const parents = new Set((db[col.references] ?? []).map((r) => String(r.id)));
      for (const row of live(table.name)) {
        if (row[col.name] == null) continue;
        expect(
          parents.has(String(row[col.name])),
          label + ': ' + table.name + '.' + col.name + ' has no ' + col.references
        ).toBe(true);
      }
    }
  }
}
