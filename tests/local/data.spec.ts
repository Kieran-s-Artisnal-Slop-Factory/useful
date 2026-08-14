import { test, expect, STORE_NAMES, TABLES } from './helpers/app';
import { assertInvariants, assertIsolatedDelta, assertSameDb, diffValues } from './helpers/oracle';
import { buildRow, sampleValue, tableOf } from './helpers/schema';

const T = 'preferences';

test('loading a page writes nothing', async ({ app }) => {
  const before = await app.dumpAll();
  await app.goto('/settings/');
  await app.goto('/');
  // A page that mutates data as a side effect of rendering makes every
  // snapshot in this suite meaningless — and quietly rewrites the user's data.
  expect(await app.dumpAll()).toEqual(before);
});

test('a backup covers every store', async ({ app }) => {
  const envelope = await app.call<{ data: Record<string, unknown[]> }>('exportData');
  expect(Object.keys(envelope.data).sort()).toEqual([...STORE_NAMES].sort());
});

test.describe('every column survives a backup round trip', () => {
  for (const table of TABLES) {
    test(table.name, async ({ app }) => {
      const parents: Record<string, string> = {};
      for (const col of table.columns) {
        if (!col.references || parents[col.references]) continue;
        const parent = tableOf(col.references);
        const id = 'rt-' + parent.name;
        await app.call('rawPut', parent.name, buildRow(parent, id, {}, 1));
        parents[col.references] = id;
      }
      const row = buildRow(table, 'rt-' + table.name, parents, 1);
      await app.call('repoPut', table.name, row);

      const envelope = await app.call<{ data: Record<string, unknown[]> }>('exportData');
      const before = await app.dumpAll();
      await app.call('importData', envelope, 'replace');
      const after = await app.dumpAll();

      // Exact, typed comparison: a boolean that comes back as 0, a float that
      // comes back rounded, or a key the export dropped all fail here.
      assertSameDb(before, after, table.name + ' did not survive export/import');
      assertInvariants(after, 'after restore');
    });
  }
});

test('patch changes only the field it names', async ({ app }) => {
  const table = tableOf(T);
  const col = table.columns.find((c) => !c.references);
  test.skip(!col, 'no plain column on ' + T);
  await app.call('repoPut', T, buildRow(table, 'p1', {}, 1));
  await app.call('repoPut', T, buildRow(table, 'p2', {}, 1));
  const before = await app.dumpAll();

  await app.call('repoPatch', T, 'p1', { [col!.name]: sampleValue(col!, 0) });
  const after = await app.dumpAll();

  // p2 (and every other store) must be byte-identical.
  assertIsolatedDelta(before, after, [{ store: T, id: 'p1' }]);
});

test('delete is a tombstone, not a hole', async ({ app }) => {
  await app.call('repoPut', T, buildRow(tableOf(T), 'd1', {}, 1));
  await app.call('repoSoftDelete', T, 'd1');

  const row = await app.get(T, 'd1');
  // Hard-deleting a row loses the fact that it was deleted, which is what a
  // backup restore (or a future sync backend) needs in order to agree.
  expect(row, 'the row was hard-deleted').toBeTruthy();
  expect(row!.deleted_at).toBeTruthy();
  expect((await app.call<unknown[]>('rawDump', T)).length).toBe(1);
});

test('a corrupt backup is rejected without changing anything', async ({ app }) => {
  await app.call('repoPut', T, buildRow(tableOf(T), 'c1', {}, 1));
  const before = await app.dumpAll();
  const broken = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    data: { [T]: [{ nope: 1 }] },
  };
  await expect(app.call('importData', broken, 'replace')).rejects.toThrow();
  expect(await app.dumpAll(), 'a failed import half-applied').toEqual(before);
});

test('merge import never regresses a newer local row', async ({ app }) => {
  const table = tableOf(T);
  await app.call('rawPut', T, {
    ...buildRow(table, 'm1', {}, 1),
    updated_at: '2020-01-01T00:00:00.000Z',
  });
  const envelope = await app.call<{ data: Record<string, unknown[]> }>('exportData');

  await app.call('repoPut', T, buildRow(table, 'm1', {}, 0));
  const newer = await app.get(T, 'm1');

  const result = await app.call<{ skipped: number }>('importData', envelope, 'merge');
  expect(result.skipped).toBeGreaterThan(0);
  expect((await app.get(T, 'm1'))!.updated_at).toBe(newer!.updated_at);
});

test('merge import never resurrects a newer tombstone', async ({ app }) => {
  await app.call('repoPut', T, buildRow(tableOf(T), 'm2', {}, 1));
  const envelope = await app.call<{ data: Record<string, unknown[]> }>('exportData');
  await app.call('repoSoftDelete', T, 'm2');
  await app.call('importData', envelope, 'merge');
  expect((await app.get(T, 'm2'))!.deleted_at, 'the backup un-deleted a row').toBeTruthy();
});

test('restoring an older backup does not wipe stores it never covered', async ({ app }) => {
  test.skip(STORE_NAMES.length < 2, 'needs more than one store');
  const table = tableOf(T);
  const other = STORE_NAMES.find((n) => n !== T)!;
  const otherTable = tableOf(other);
  await app.call('repoPut', T, buildRow(table, 'k1', {}, 1));
  await app.call('rawPut', other, buildRow(otherTable, 'k2', {}, 1));

  const envelope = await app.call<{ data: Record<string, unknown[]> }>('exportData');
  // An older backup, from before `other` existed.
  await app.call('importData', { ...envelope, data: { [T]: envelope.data[T] } }, 'replace');

  expect(
    await app.get(other, 'k2'),
    'restoring an old backup deleted a store the file never mentioned'
  ).toBeTruthy();
});

test.describe('sabotage: the oracle can go red', () => {
  test('sabotage: a changed field is detected', async ({ app }) => {
    const table = tableOf(T);
    await app.call('repoPut', T, buildRow(table, 'sb1', {}, 1));
    const before = await app.dumpAll();
    await app.call('rawPut', T, { ...(await app.get(T, 'sb1')), updated_at: '1999-01-01T00:00:00.000Z' });
    const after = await app.dumpAll();
    expect(() => assertSameDb(before, after, 'x')).toThrow();
  });

  test('sabotage: an unrelated write is detected', async ({ app }) => {
    const table = tableOf(T);
    await app.call('repoPut', T, buildRow(table, 'sb2', {}, 1));
    await app.call('repoPut', T, buildRow(table, 'sb3', {}, 1));
    const before = await app.dumpAll();
    await app.call('repoPut', T, buildRow(table, 'sb3', {}, 0));
    const after = await app.dumpAll();
    expect(() => assertIsolatedDelta(before, after, [{ store: T, id: 'sb2' }])).toThrow();
  });

  test('sabotage: a hard delete is detected', async ({ app }) => {
    await app.call('repoPut', T, buildRow(tableOf(T), 'sb4', {}, 1));
    const before = await app.dumpAll();
    await app.call('rawDelete', T, 'sb4');
    const after = await app.dumpAll();
    expect(() => assertSameDb(before, after, 'x')).toThrow();
  });

  test('sabotage: an orphaned child row is detected', () => {
    // Synthetic schema, so this proof runs even while the app schema has no
    // foreign keys — the oracle's FK check must be shown to catch orphans
    // BEFORE the first real child table ships, not after.
    const parent: (typeof TABLES)[number] = {
      name: 'sb_parents',
      fieldMerge: false,
      singleton: false,
      columns: [{ name: 'title', type: 'text', nullable: false, references: null }],
    };
    const child: (typeof TABLES)[number] = {
      name: 'sb_children',
      fieldMerge: false,
      singleton: false,
      columns: [{ name: 'parent_id', type: 'text', nullable: false, references: 'sb_parents' }],
    };
    const db = {
      sb_parents: [],
      sb_children: [{ ...buildRow(child, 'sb5', {}), parent_id: 'no-such-parent' }],
    };
    expect(() => assertInvariants(db, 'synthetic', [parent, child])).toThrow();
    // And the same snapshot with the parent present passes — the check reacts
    // to the orphan, not to the mere presence of an FK column.
    const okDb = {
      sb_parents: [buildRow(parent, 'no-such-parent', {})],
      sb_children: db.sb_children,
    };
    assertInvariants(okDb, 'synthetic-ok', [parent, child]);
  });

  test('sabotage: the comparator separates types', () => {
    expect(diffValues(1, '1').length).toBeGreaterThan(0);
    expect(diffValues(true, 1).length).toBeGreaterThan(0);
    expect(diffValues([], null).length).toBeGreaterThan(0);
    expect(diffValues(62.4999, 62.5).length).toBeGreaterThan(0);
  });
});
