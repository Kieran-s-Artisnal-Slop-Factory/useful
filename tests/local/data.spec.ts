import { test, expect, STORE_NAMES, TABLES } from './helpers/app';
import { assertInvariants, assertIsolatedDelta, assertSameDb, diffValues } from './helpers/oracle';
import { buildRow, sampleValue, tableOf } from './helpers/schema';

const T = 'preferences';

/** The bookkeeping a tombstone is allowed to keep (mirrors repo.ts SYNC_META). */
const SYNC_FIELDS = new Set(['id', 'updated_at', 'deleted_at', 'server_seq', 'field_updated_at']);

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

test('a tombstone keeps no payload — deleted content leaves the database', async ({ app }) => {
  const table = tableOf(T);
  await app.call('repoPut', T, buildRow(table, 'd2', {}, 1));
  const before = (await app.call<Record<string, unknown>[]>('rawDump', T)).find((r) => r.id === 'd2')!;
  // The row really did carry domain data before the delete, or this proves nothing.
  expect(Object.keys(before).some((k) => !SYNC_FIELDS.has(k))).toBe(true);

  await app.call('repoSoftDelete', T, 'd2');
  const after = (await app.call<Record<string, unknown>[]>('rawDump', T)).find((r) => r.id === 'd2')!;
  expect(after.deleted_at).toBeTruthy();
  // Sync bookkeeping only: a deleted timer's label must not survive in the
  // database — or in the backup file the user exports next.
  expect(Object.keys(after).filter((k) => !SYNC_FIELDS.has(k))).toEqual([]);

  const envelope = await app.call<{ data: Record<string, unknown[]> }>('exportData');
  const exported = (envelope.data[T] as Record<string, unknown>[]).find((r) => r.id === 'd2')!;
  expect(Object.keys(exported).filter((k) => !SYNC_FIELDS.has(k))).toEqual([]);
});

test('the v6 migration strips payloads from tombstones written by older versions', async ({ app }) => {
  // Rebuild the database as an older version would have left it: a deleted
  // timer whose label and notes are still sitting in the row.
  await app.call('closeDb'); // an open connection blocks deleteDatabase
  const fat = await app.page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('useful');
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('useful', 5);
      open.onupgradeneeded = () => {
        for (const name of ['preferences', 'sync_outbox', 'timers', 'stopwatch', 'events', 'todos', 'todo_comments', 'svg_documents']) {
          if (!open.result.objectStoreNames.contains(name)) {
            open.result.createObjectStore(name, { keyPath: name === 'sync_outbox' ? 'key' : 'id' });
          }
        }
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const tx = db.transaction('timers', 'readwrite');
    tx.objectStore('timers').put({
      id: 'old-tombstone',
      updated_at: '2020-01-01T00:00:00.000Z',
      deleted_at: '2020-01-02T00:00:00.000Z',
      server_seq: null,
      label: 'secret standup timer',
      description: 'private notes',
      duration_ms: 60000,
    });
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
    });
    db.close();
    return true;
  });
  expect(fat).toBe(true);

  // Reloading opens the database at v6, which runs the sweep.
  await app.goto('/tools/timers/');
  const row = (await app.call<Record<string, unknown>[]>('rawDump', 'timers')).find(
    (r) => r.id === 'old-tombstone'
  )!;
  expect(row, 'the migration dropped the tombstone entirely').toBeTruthy();
  expect(Object.keys(row).filter((k) => !SYNC_FIELDS.has(k))).toEqual([]);
  // Clocks are untouched: a cleanup pass must never restamp rows.
  expect(row.updated_at).toBe('2020-01-01T00:00:00.000Z');
  expect(row.deleted_at).toBe('2020-01-02T00:00:00.000Z');
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

test.describe('per-field merge folding (field-merged stores)', () => {
  const T0 = '2024-01-01T00:00:00.000Z';
  const T1 = '2024-03-01T00:00:00.000Z';
  const T2 = '2024-06-01T00:00:00.000Z';
  const base = { id: 'singleton', deleted_at: null as string | null, server_seq: null as number | null };

  test('two devices editing DIFFERENT fields both keep their edit', async ({ app }) => {
    // "This device": changed tz_last_from at T2; tz_last_to untouched since T0.
    await app.call('rawPut', 'preferences', {
      ...base,
      updated_at: T2,
      field_updated_at: { tz_last_from: T2, tz_last_to: T0 },
      tz_last_from: 'local-from',
      tz_last_to: 'stale-to',
    });
    // The backup (other device): changed tz_last_to at T1 — an OLDER row clock
    // than local, which whole-row LWW would discard entirely.
    const envelope = {
      schemaVersion: 1,
      exportedAt: T1,
      data: {
        preferences: [
          {
            ...base,
            server_seq: 7,
            updated_at: T1,
            field_updated_at: { tz_last_from: T0, tz_last_to: T1 },
            tz_last_from: 'stale-from',
            tz_last_to: 'imported-to',
          },
        ],
      },
    };
    await app.call('importData', envelope, 'merge');

    const row = (await app.get('preferences', 'singleton')) as Record<string, unknown>;
    expect(row.tz_last_from, 'the locally-newer field was clobbered').toBe('local-from');
    expect(row.tz_last_to, 'the imported-newer field was discarded').toBe('imported-to');
    expect(row.updated_at, 'row clock must be the max of both').toBe(T2);
    expect(row.server_seq, 'a folded row must be queued to re-push').toBeNull();
    const stamps = row.field_updated_at as Record<string, string>;
    expect(stamps.tz_last_from).toBe(T2);
    expect(stamps.tz_last_to).toBe(T1);
  });

  test('a backup with nothing newer changes nothing and counts as skipped', async ({ app }) => {
    await app.call('rawPut', 'preferences', {
      ...base,
      updated_at: T2,
      field_updated_at: { tz_last_from: T2, tz_last_to: T2 },
      tz_last_from: 'local-from',
      tz_last_to: 'local-to',
    });
    const before = await app.dumpAll();
    const result = await app.call<{ skipped: number }>('importData', {
      schemaVersion: 1,
      exportedAt: T1,
      data: {
        preferences: [
          {
            ...base,
            updated_at: T1,
            field_updated_at: { tz_last_from: T0, tz_last_to: T1 },
            tz_last_from: 'stale',
            tz_last_to: 'stale',
          },
        ],
      },
    }, 'merge');
    expect(result.skipped).toBeGreaterThan(0);
    expect(await app.dumpAll()).toEqual(before);
  });

  test('folding never resurrects a newer tombstone', async ({ app }) => {
    await app.call('rawPut', 'preferences', {
      ...base,
      updated_at: T2,
      deleted_at: T2,
      field_updated_at: { tz_last_from: T0 },
      tz_last_from: 'was-deleted',
    });
    await app.call('importData', {
      schemaVersion: 1,
      exportedAt: T1,
      data: {
        preferences: [
          {
            ...base,
            updated_at: T1,
            field_updated_at: { tz_last_from: T1 },
            tz_last_from: 'zombie',
          },
        ],
      },
    }, 'merge');
    const row = (await app.get('preferences', 'singleton')) as Record<string, unknown>;
    expect(row.deleted_at, 'the fold un-deleted a newer tombstone').toBe(T2);
    expect(row.tz_last_from).toBe('was-deleted');
  });
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
