# Data-integrity tests

```sh
npm run test:data      # builds, serves, and runs the suite
npm run test:data:ui   # same, in Playwright's UI mode
```

There is no server here, so the two things that can silently destroy a user's
data are a backup that does not round-trip and a write that changes more than
it claimed to. This suite covers both, against a **production build** (the
service worker only exists in one).

- **Typed comparison.** `1` is not `"1"`, `true` is not `1`, an absent key is
  not a null one, floats compare exactly. A boolean that comes back from a
  backup as `0`, or a key the export quietly dropped, fails here.
- **Every column, both directions.** Each table is written with values chosen to
  break naive code — empty arrays, unicode, embedded quotes and newlines, large
  integers, high-precision floats, both boolean values — then exported,
  restored, and compared byte-for-byte.
- **The isolation diff.** After a `patch` changes one field of one row, the
  delta across every store must be exactly that change. This is what catches a
  save that rewrites unrelated rows.
- **Structural invariants.** Unique ids, one row per single-row table, and every
  foreign key pointing at a row that exists.
- **A sabotage group.** Faults injected on purpose that the oracle must catch;
  `trust-gate.ts` fails the run if that group did not execute, because a suite
  that has never been shown to fail is unverified, not passing.

If you later add a sync backend, these invariants are exactly what it will
depend on — and the tombstone/backup behaviour tested here is already the
protocol it will speak.
