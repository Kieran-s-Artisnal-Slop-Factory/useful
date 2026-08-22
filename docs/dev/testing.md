# Testing

Two suites. `npm test` is a Playwright suite that builds the production site, serves `dist/` on a local port, drives the real UI in Chromium and audits every IndexedDB write through a typed oracle exposed by a test-only hook (`window.__useful`); a reporter fails the run unless the oracle was shown to catch injected faults. `npm run test:unit` is Vitest over the pure modules under `src/lib/`. There is no server, so the two things worth guarding are a backup that does not round-trip and a write that changes more than it claimed to — both suites exist to catch those.

_Describes the code as of v0.2.1 (unreleased; schema v12) — verify against source when in doubt._

## Suites at a glance

| Command | Runner | Runs | Config |
|---|---|---|---|
| `npm test` (identical to `npm run test:data`) | Playwright | `tests/local/*.spec.ts` against a production build on `http://127.0.0.1:4330` | [playwright.config.ts](../../playwright.config.ts) |
| `npm run test:data:ui` | Playwright `--ui` | same suite, interactive | same |
| `npm run test:unit` | Vitest (`vitest run`) | `src/**/*.test.ts`, Node environment, no DOM | [vitest.config.ts](../../vitest.config.ts) |

Playwright needs its Chromium download once (`npx playwright install chromium`); the config declares no `projects`, so it runs the default browser (Chromium) only.

## What `npm test` really does

[playwright.config.ts](../../playwright.config.ts):

- `testDir: './tests/local'`, `retries: 0` ("a flaky data test is an untrustworthy data test"), `timeout: 60_000` per test. Suites that boot wasm or download bundles call `test.slow()` (triples the timeout).
- `webServer.command`: `npm run build && node tools/preview-server.mjs --port 4330 --dir dist`. A **production build**, because the service worker only registers in production ([Layout.astro](../../src/layouts/Layout.astro) gates it on `import.meta.env.PROD`) and a suite that never loads it tests a path no user runs. **Not** `astro preview`: Astro 7's preview daemonizes itself under a non-TTY stdin, Playwright sees the process exit and aborts. [preview-server.mjs](../../tools/preview-server.mjs) is a foreground static server bound to `127.0.0.1` with static-host trailing-slash semantics (`/x/` → `x/index.html`, `/x` → 301 to `/x/`).
- `reuseExistingServer: !process.env.CI` — locally, if something already answers on 4330 the build step is **skipped** and that server is used as-is.
- `use: { baseURL, trace: 'retain-on-failure' }` — traces land in `test-results/` (gitignored).
- `reporter: [['list'], ['./tests/local/trust-gate.ts']]`.

**Do not pass `--reporter=list` (or any `--reporter`) on the command line.** A CLI reporter replaces the config's reporter list, which drops the trust gate; the run then cannot fail for a missing sabotage group. This is why [docs/dev/plans/TODO](plans/TODO) calls it out.

Every test gets its own browser context (fresh origin storage, fresh IndexedDB, fresh service-worker registration) from the `app` fixture, so specs never share state and can run in parallel workers.

## The oracle model

Three helper files under [tests/local/helpers/](../../tests/local/helpers/):

**[app.ts](../../tests/local/helpers/app.ts)** — the `test` fixture that every spec imports. It creates a context, runs `context.addInitScript` to set `localStorage['useful-test-mode'] = '1'` *before the first navigation*, collects `console.error` and `pageerror` into `errors`, and exposes:

| Member | What it does |
|---|---|
| `goto(path = '/')` | `page.goto`, then waits up to 15 s for `window.__useful` |
| `call(method, ...args)` | `page.evaluate` of `window.__useful[method](...args)` |
| `dumpAll()` / `dump(store)` / `get(store, id)` | `rawDumpAll` / `rawDump` / `rawGet` — raw rows, tombstones and `server_seq` included |
| `errors` | at teardown the fixture asserts `errors` is `[]`, so any console error or uncaught exception fails the test |

**[schema.ts](../../tests/local/helpers/schema.ts)** — `TABLES`, the harness's own mirror of the app schema (`name`, `fieldMerge`, `singleton`, `columns[]` with `type` / `nullable` / `references`), plus `STORE_NAMES`, `tableOf`, `sampleValue` (values chosen to break naive code: quotes, backslash, newline, non-ASCII, `-2147483649`, `62.4999`, both booleans, `[]`) and `buildRow` (a full row with `id`, `updated_at`, `deleted_at: null`, `server_seq: null`, `field_updated_at: {}` for field-merged tables, and every column filled). This mirror is hand-maintained; a store that is not in it is not covered by the generic round-trip loop.

**[oracle.ts](../../tests/local/helpers/oracle.ts)** — the comparators:

- `diffValues(expected, actual)` — typed, recursive. `1` ≠ `"1"`, `true` ≠ `1`, `null` ≠ `undefined` ≠ absent key, `[]` ≠ `null`, floats compare with `Object.is`. Returns `Diff[]` with `path`, both values and both type names.
- `diffDb(expected, actual)` — pairs rows by `String(r.id)` per store and reports missing rows and per-field diffs.
- `assertSameDb(before, after, label)` — zero diffs or fail with `formatDiffs` output.
- `assertIsolatedDelta(before, after, allowed)` — the collateral-damage detector: after a UI action, every diff must fall on an `{ store, id }` in `allowed`. Most real data loss shows up here, not in the targeted assertion.
- `assertInvariants(db, label, tables = TABLES)` — unique ids per store, at most one live row in a `singleton` table, and every non-null `references` column on a live row pointing at an existing parent. Tombstones (`deleted_at` set) are excluded from the singleton and FK checks.

**The sabotage group** — `data.spec.ts` ends with `test.describe('sabotage: the oracle can go red')`: a restamped row, an unrelated write, a hard delete, an orphaned child (against a synthetic two-table schema, so the FK proof runs even though the real schema only has `todos.recurrence_parent_id` and `todo_comments.todo_id`), and the type separations. Each asserts the oracle **throws**.

**[trust-gate.ts](../../tests/local/trust-gate.ts)** — a Playwright `Reporter`. `onTestEnd` counts every test whose title path contains `sabotage:` and how many of those passed. `onEnd` writes `tests/local/.results/results.json` (`sabotage`, `trustworthy`, per-test results; gitignored), prints `self-verification N/N injected faults detected` or `NOT TRUSTWORTHY — the sabotage cases did not run`, and if the run otherwise passed but `trustworthy` is false it returns `{ status: 'failed' }`. A filtered run (`-g something`) that skips the sabotage group therefore fails, by design.

### A spec run, end to end

```mermaid
sequenceDiagram
    participant PW as Playwright runner
    participant WS as webServer
    participant B as Chromium context
    participant App as App page
    participant O as oracle.ts
    participant TG as trust-gate.ts

    PW->>WS: npm run build, then preview-server.mjs on 127.0.0.1:4330
    Note over PW,WS: skipped locally if 4330 already answers
    PW->>B: newContext, addInitScript sets useful-test-mode=1
    B->>App: goto path
    App->>App: Layout script imports testMode.ts, isTestMode() true
    App->>App: dynamic import testHook chunk, installTestHook()
    App-->>B: window.__useful, event useful-test-hook-ready
    PW->>App: call rawDumpAll (before)
    PW->>B: drive the UI by data-testid
    B->>App: repo.ts writes IndexedDB
    PW->>App: call rawDumpAll (after)
    PW->>O: assertIsolatedDelta(before, after, allowed)
    O-->>PW: pass, or formatted typed diffs
    PW->>B: teardown, expect errors == [], context.close()
    PW->>TG: onTestEnd(title, status)
    TG-->>PW: onEnd, fail run if no sabotage case ran or one did not detect
```

## The test-mode hook

[src/lib/testMode.ts](../../src/lib/testMode.ts):

- `TEST_MODE_KEY = 'useful-test-mode'`; `isTestMode()` is true only when `localStorage[TEST_MODE_KEY] === '1'` (storage errors → false).
- `installTestHookIfEnabled()` — if the flag is set, `await import('./testHook')` then `installTestHook()`. The dynamic import keeps the hook in its **own chunk** (`dist/_astro/testHook.*.js`), so a real user downloads only this loader. It is called from a bundled `<script>` in [Layout.astro](../../src/layouts/Layout.astro); an unbundled inline `import('../lib/testHook.ts')` would resolve against the page URL and 404 in the production build.

[src/lib/testHook.ts](../../src/lib/testHook.ts) — `installTestHook()` puts a `TestHook` object on `window.__useful` and dispatches `useful-test-hook-ready`:

| Method | Path | Purpose |
|---|---|---|
| `rawDump(store)`, `rawDumpAll()`, `rawGet(store, id)` | `getDB()` directly | Reads that **bypass** [repo.ts](../../src/lib/db/repo.ts): tombstones and `server_seq` visible. `rawDumpAll` reads every store in one readonly transaction so the snapshot is consistent. |
| `rawPut(store, row)`, `rawDelete(store, id)` | `getDB()` directly | Fixtures and deliberate corruption (sabotage, migration tests) |
| `repoPut`, `repoPatch`, `repoReconcile`, `repoSoftDelete` | `put` / `patch` / `putReconciled` / `softDelete` from repo.ts | Writes through the **real** repo, so tests exercise shipped behaviour |
| `outbox()`, `enqueue(store, id, updatedAt)` | [outbox.ts](../../src/lib/db/outbox.ts) | `drainOutbox` / `enqueue` for the local change queue |
| `exportData()`, `importData(envelope, mode?)` | [export.ts](../../src/lib/db/export.ts) | The backup pipeline |
| `stores()` | `Object.keys(STORES)` | Store names as the app sees them |
| `closeDb()` | `closeDB()` in [db.ts](../../src/lib/db/db.ts) | Drops the tab's connection so a test can `indexedDB.deleteDatabase('useful')` and rebuild it at an older version — an open connection blocks `deleteDatabase` forever |

Invariants and facts worth knowing:

- The flag must be set **before** the first navigation; the layout script runs once per page load. `addInitScript` in the fixture is what guarantees this.
- The install path is not gated on `PROD`, so setting the flag by hand in the dev server also installs the hook — but the suite never runs against dev (see pitfalls).
- As of this version nothing other than `installTestHookIfEnabled` / `installTestHook` reads `isTestMode()`. The comment at the top of `testMode.ts` describes the contract the flag was created for (no automatic writes so snapshots are attributable); the "loading a page writes nothing" guarantee is enforced by the specs themselves (`dumpAll()` before and after navigation), not by branching on the flag.

## Per-spec coverage

All specs import `test` from `helpers/app` and select by `data-testid`. "Zero writes" below means `expect(await app.dumpAll()).toEqual(before)`; "isolated" means `assertIsolatedDelta`.

| Spec | Covers | Key invariants |
|---|---|---|
| [data.spec.ts](../../tests/local/data.spec.ts) | The data layer itself | Page loads write nothing; a backup covers every `STORE_NAMES` entry; **every table in `TABLES`** survives export → `importData(..., 'replace')` byte-for-byte (`assertSameDb`, then `assertInvariants`); `patch` changes only its row; delete is a tombstone that keeps **no payload** (only `id`, `updated_at`, `deleted_at`, `server_seq`, `field_updated_at`), in the DB and in the export; the v6 migration strips old fat tombstones without restamping clocks (rebuilds the DB at v5 via `closeDb`); a corrupt envelope is rejected without half-applying; merge import never regresses a newer local row or resurrects a newer tombstone; an older backup does not wipe stores it never mentioned; per-field folding for field-merged stores (both devices keep their newer field, row clock is the max, `server_seq` reset to null); the sabotage group |
| [nav.spec.ts](../../tests/local/nav.spec.ts) | Sidebar, mobile drawer, ctrl+k palette | Client-side navigation writes nothing; `aria-current` tracks the page; palette fuzzy search, arrow keys, focus trap and focus restore; sidebar collapse and pinned theme survive both a full reload (pre-paint script) and client-side navigation (`astro:after-swap` re-apply); Escape closes only the topmost layer; closed drawer links are out of the tab order |
| [a11y.spec.ts](../../tests/local/a11y.spec.ts) | Every route in the registry — `ROUTES` is derived from `REGISTRY`, so registering a tool audits it | No visible control without an accessible name, no visible field without a label, no `<img>` without `alt`, exactly one `h1` inside `main`, no skipped heading level; token contrast (`--text-color`, `--text-muted-color`, `--color-danger`, `--color-success` ≥ 4.5 on `--surface-color`; `--border-strong-color` ≥ 3) in both light and dark; keyboard path through the palette and explainer disclosures |
| [payload.spec.ts](../../tests/local/payload.spec.ts) | Payload discipline, by watching real network requests | Home and a light tool page load none of the `HEAVY` bundles (ONNX runtime, model, SQLite, PGlite, cities, CodeMirror); opening the background remover fetches no model/wasm; the SQL playground loads SQLite only; the `useful-cache-*` precache holds nothing under `/models/` or `/ort/` |
| [offline.spec.ts](../../tests/local/offline.spec.ts) | Settings → Offline and the install offer | Downloading the light bundles writes only `preferences.offline_ready_at`; the `appinstalled` dialog appears once and `offline_prompt_seen` is remembered; after the download, with `context.setOffline(true)`, a **never-visited** page still renders |
| [time.spec.ts](../../tests/local/time.spec.ts) | Timers, timer options, alarm loop, preferences panel, stopwatch, timezones | Creating a timer writes the timer row plus the preferences singleton (defaults) and nothing else; a running timer survives reload from `end_at` with zero writes; pause banks `paused_remaining_ms`; expiry → `done` + banner; a long-past deadline surfaces as MISSED; delete-on-complete tombstones; alarm rings until dismissed, capped by `timer_alarm_seconds`; auto-remember off leaves defaults alone; stopwatch writes only its singleton and keeps counting across reload; timezone conversion is exact (Edmonton → Tokyo) and remembers the pair; a non-IANA city (Osaka) resolves through the lazily loaded GeoNames chunk |
| [scheduler.spec.ts](../../tests/local/scheduler.spec.ts) | Todos, events, comments, board, calendar, recurrence, drag | Every create/status/reorder/drop writes exactly one row; a same-position drop writes nothing; completing a recurring todo spawns exactly one successor and reload spawns none; delete tombstones the todo **and** its comments with FKs intact; the due scan raises a DUE banner with zero writes; drags are real pointer drags (`pointerDrag`) and CDP touch drags (`touchDrag`) for list, board and calendar |
| [calculators.spec.ts](../../tests/local/calculators.spec.ts) | Number conversion, photography, file transfer | All computation is zero-write; hand-computed expected values (bit ops for 5, m4/3 → FF equivalents, stop deltas, 1 GB @ 100 Mbps = 1 min 20 s); picking a sensor format writes only `preferences.photo_last_format`; explainers toggle from the keyboard |
| [generators.spec.ts](../../tests/local/generators.spec.ts) | Colors, harmonies, theme builder, gradients, glassmorphism, regex, QR | All zero-write; copy buttons verified against the real clipboard (`grantPermissions`); QR round-trip: download the PNG through the export pipeline, upload it to the reader, decode back; camera affordance is feature-detected without prompting for permission |
| [images.spec.ts](../../tests/local/images.spec.ts) | Converter, resizer, compressor | Pixels never touch IndexedDB; the one write is `preferences.convert_jpg_quality`; downloads verified by magic bytes; TIFF via bundled decoder, broken TIFF fails gracefully; AVIF fixture decodes and previews at its own aspect; target-percent/size search reports honestly |
| [background-remover.spec.ts](../../tests/local/background-remover.spec.ts) | The real u2netp model through ONNX Runtime | Whole session zero-write (snapshot **before** `goto`); model state "Not downloaded" → "Ready"; subject centre alpha 255, corner alpha 0 in preview and exported PNG; cutoff/mask/solid-colour re-tune without re-running; JPG + transparent warns; after an explicit download, inference works with `setOffline(true)` (Cache Storage only) and the download can be removed; touch-up brushes survive the sliders and reach the export |
| [svg-editor.spec.ts](../../tests/local/svg-editor.spec.ts) | `svg_documents` | Create/edit writes the document row plus `preferences.svg_last_doc_id` only; reload resumes byte-identically with zero writes; canvas drag persists only that document; undo/redo save the reverted state; colour commit is one undo step and a stray quote is escaped in the export; cleared numeric fields never persist null; per-vertex curves and control-handle drags; boolean subtract proven by exported pixels; SVG/PNG export is zero-write; delete is a tombstone |
| [image-editor.spec.ts](../../tests/local/image-editor.spec.ts) | The session-only raster editor | An entire import → edit → export session leaves the DB byte-identical; first image sets the canvas; effects nest under the selected image; crop/eraser/fill scoping; opacity and blend modes by pixel probe; groups by drag-to-nest; scale handles; EXIF stripped by default and edited fields embedded in JPG while GPS never survives (re-parsed with `exifr`, fixture built with `piexifjs`); remove-background mask layer; undo/redo by button and keyboard; restore brush |
| [sql-playground.spec.ts](../../tests/local/sql-playground.spec.ts) | Real SQLite (sqlite-wasm) and Postgres (PGlite) in workers | Opening writes nothing; running saves one `sql_playgrounds` row keyed by engine id; snapshot save/restore/forget; wipe keeps the snapshot; `.sql` export; Postgres is a separate workspace and remembered in `preferences.sql_last_engine`; a syntax error keeps the database |
| [sprite-editor.spec.ts](../../tests/local/sprite-editor.spec.ts) | `sprites` | A sprite is one row through create / paint / reload; autosave is one row and opening writes only the remembered id; loading, resuming and looking around write nothing; one drag is one undo step; the legend refuses a colour that could escape into the export; import replaces the grid and filters a hostile legend; exports are the right files and write nothing; resize squares and clamps; delete is a tombstone that leaves the store consistent |
| [secrets.spec.ts](../../tests/local/secrets.spec.ts) | Passwords, keys, tokens, identifiers | Every card fills itself on load and nothing is written; categories are `<details>` — the first open, the rest closed but still generating, independent of each other, toggled by click or Enter and never remembered across a reload; each generator's documented shape; regenerate in place vs regenerate-all; the length option moves both the value and the claimed entropy; identifiers are labelled as identifiers; copy reaches the clipboard; the page says nothing is kept and explains WEP |
| [logo-generator.spec.ts](../../tests/local/logo-generator.spec.ts) | DiceBear, Jdenticon, the badge tab | Opening draws and writes nothing; picking a style swaps artwork and licence; Jdenticon reacts to its own knobs; icon and emoji badges; downloads carry the right filename and type; an engine is not downloaded until asked for, and no engine rides along with any other page; "Open in SVG editor" hands over one pasted-SVG layer |
| [napkin-math.spec.ts](../../tests/local/napkin-math.spec.ts) | `napkin_templates`, `napkin_calculations`, the generated code and web component | A formula becomes typed fields with nothing written until Save; a template is one row, a reload restores it; saving a calculation saves the unsaved template with it and the calculation is never inside the template file; export / import round-trip, a bad import refused with a reason; the generated web component computes what the app computed in a real page, carries a typeset formula and its fonts (or leaves them to the page), defines the helper a sum calls; the generated Python carries the page's guards; insert buttons start a formula that parses; sum / product / integral reach code; the Code card forgets on a new formula; an unsupported operator is refused by name; descriptions reach inputs and code; highlighting; no sound is ever fetched and MathLive stays off every other route |
| [config-playground.spec.ts](../../tests/local/config-playground.spec.ts) | `config_schemas`, parse / create modes, generated parsers and generators | Pasting extracts a schema with nothing written; saving is one row and a reload restores it; invalid JSON is flagged in place and the last good schema stays; the YAML 1.1 traps are named and quoting cures them; prettify keeps YAML comments; a hand-built schema survives the switch and checks a real document; examples generate to the schema and download; no fields → nothing to generate; every language's parser names the fields; the parser and generator web components work in a real page; the Data card tabulates on demand and goes stale honestly; delete is a tombstone and the library empties |
| [notebook.spec.ts](../../tests/local/notebook.spec.ts) | `notes`, `note_assets`, the Crepe / CodeMirror editor, exports, the sidebar's bulk operations | Loading writes nothing, a new note is one row and autosave one patch, a reload restores without writing; `[[links]]` resolve, create on click and come back as backlinks; footnotes survive WYSIWYG → source → WYSIWYG; renaming keeps old links working and offers the rewrite; nesting, and deleting a parent moves children up; a deep link to a missing note offers to create it; the HTML export is one self-contained file; the print stylesheet hides the app; ticking rows in the library reveals the bulk panel without remounting the editor, and it tags (isolated to the selected rows), exports `.zip`s read back with `zipEntries`, moves (no cycle offered, the open note's field follows) and deletes (survivors reparented, the open note stays open, the receipt outlives the panel); a row's × deletes that note and folding the library drops the selection; the editor stays off every other route |

## Unit tests

`vitest run` over `src/**/*.test.ts` — plain Node, no DOM. Modules with browser dependencies pass fakes (e.g. [history.test.ts](../../src/lib/raster/history.test.ts) uses stand-in canvas objects to prove bitmaps are passed by reference, never copied).

| Area | Files |
|---|---|
| Registry / shell | [registry.test.ts](../../src/lib/registry.test.ts) (unique ids, app-absolute routes with trailing slash, known categories, every icon key resolves, `searchRegistry`), [fuzzy.test.ts](../../src/lib/fuzzy.test.ts) |
| Time | [duration.test.ts](../../src/lib/time/duration.test.ts), [timezone.test.ts](../../src/lib/time/timezone.test.ts), [cities.test.ts](../../src/lib/time/cities.test.ts) |
| Scheduler | [rank.test.ts](../../src/lib/scheduler/rank.test.ts), [recurrence.test.ts](../../src/lib/scheduler/recurrence.test.ts) |
| Calculators | [numberBase.test.ts](../../src/lib/calc/numberBase.test.ts), [photography.test.ts](../../src/lib/calc/photography.test.ts), [transfer.test.ts](../../src/lib/calc/transfer.test.ts) |
| Generators | [color.test.ts](../../src/lib/gen/color.test.ts), [harmony.test.ts](../../src/lib/gen/harmony.test.ts), [theme.test.ts](../../src/lib/gen/theme.test.ts), [gradient.test.ts](../../src/lib/gen/gradient.test.ts), [glass.test.ts](../../src/lib/gen/glass.test.ts), [regexgen.test.ts](../../src/lib/gen/regexgen.test.ts), [regexTester.test.ts](../../src/lib/gen/regexTester.test.ts), [qr.test.ts](../../src/lib/gen/qr.test.ts) |
| Images | [convert.test.ts](../../src/lib/img/convert.test.ts), [targetSize.test.ts](../../src/lib/img/targetSize.test.ts), [pipeline.test.ts](../../src/lib/bg/pipeline.test.ts) (pre/post-processing and `applyPaint`), [exif.test.ts](../../src/lib/raster/exif.test.ts), [transform.test.ts](../../src/lib/raster/transform.test.ts), [history.test.ts](../../src/lib/raster/history.test.ts) |
| SVG | [build.test.ts](../../src/lib/svg/build.test.ts), [history.test.ts](../../src/lib/svg/history.test.ts) |
| SQL | [pg-sql.test.ts](../../src/lib/sql/pg-sql.test.ts) |
| Notebook | [markdown.test.ts](../../src/lib/markdown.test.ts), [footnotes.test.ts](../../src/lib/notebook/footnotes.test.ts), [wiki.test.ts](../../src/lib/notebook/wiki.test.ts), [export.test.ts](../../src/lib/notebook/export.test.ts), [assets.test.ts](../../src/lib/notebook/assets.test.ts), [mermaid.test.ts](../../src/lib/notebook/mermaid.test.ts), [model.test.ts](../../src/lib/notebook/model.test.ts), [bulk.test.ts](../../src/lib/notebook/bulk.test.ts) (the bulk operations' selection, move-target, reparent-on-delete and filename rules), [zip.test.ts](../../src/lib/zip.test.ts) (the stored ZIP writer: CRC-32, round trip, signatures, corruption refused) |

The standing rule from [docs/dev/plans/TODO](plans/TODO): a feature that touches both the UI and the data layer needs both a spec and unit tests.

## Adding tests for a new tool

1. **Registry first.** Add the tool to [registry.ts](../../src/lib/registry.ts); `registry.test.ts` will fail on a bad route shape, unknown category or missing icon.
2. **`SHELL` in [public/sw.js](../../public/sw.js)** — the one route list still maintained by hand; miss it and the page is not precached (see [build-and-tooling.md](build-and-tooling.md)). The a11y sweep needs nothing: its `ROUTES` is `REGISTRY`-derived, so a registered tool is audited automatically.
3. **New store?** Append a migration in [db.ts](../../src/lib/db/db.ts), add the entity to [types.ts](../../src/lib/db/types.ts), and mirror it in `TABLES` in [schema.ts](../../tests/local/helpers/schema.ts) with the right `fieldMerge`, `singleton` and `references`. That one entry extends `data.spec.ts`'s round-trip loop, `assertInvariants` and the export-coverage check to the new store for free.
4. **New heavy dependency?** Add a matcher to `HEAVY` in [payload.spec.ts](../../tests/local/payload.spec.ts) and keep the import dynamic.
5. **Write `tests/local/<tool>.spec.ts`** in the house pattern: `import { test, expect } from './helpers/app'`; put `data-testid` attributes on the controls the test needs; `const before = await app.dumpAll()` — *before* `app.goto()` when the page load itself must be zero-write; drive the UI; then either `expect(await app.dumpAll()).toEqual(before)` for stateless tools or `assertIsolatedDelta(before, after, [{ store, id }])` naming exactly the rows the action is allowed to touch. Debounced saves need `expect.poll(...)`, not a fixed wait. Include the "reload writes nothing / restores state" case for anything persisted, and a keyboard-toggle case for explainer disclosures if the page has them.
6. **Pure logic** goes in `src/lib/<area>/*.ts` with a sibling `*.test.ts`.
7. Run `npm test` and `npm run test:unit`; the trust-gate line at the end must read `self-verification N/N injected faults detected`.

## Pitfalls

- **Dev server vs production build.** The suite always builds. In `astro dev` there is no service worker, `onnxruntime-web` is served unbundled (`optimizeDeps.exclude`) and the ORT loader path pin in [runtime.ts](../../src/lib/bg/runtime.ts) is not applied — offline, payload and background-remover behaviour differ from what ships. Reproduce failures against `dist/`, e.g. `npm run build && node tools/preview-server.mjs --port 4330 --dir dist`.
- **A stale server on 4330 is reused.** With `reuseExistingServer` on locally, a preview-server left running from an earlier session serves the *old* `dist/`; kill it (or rebuild first) after changing source.
- **The hook is only there when the flag was set before load.** Opening the site by hand and typing `window.__useful` in the console gives `undefined` until `localStorage.setItem('useful-test-mode','1')` and a reload.
- **Any console error fails the test.** The fixture asserts `errors` is empty at teardown; a `console.error` inside the app (or a 404 in production) fails a spec that otherwise passed.
- **`--reporter` on the CLI disables the trust gate.** See above. Likewise a `-g` filter that excludes every `sabotage:` title ends `NOT TRUSTWORTHY` and fails.
- **Drag tests use pointer events, not `dragTo()`.** The app's drag and drop ([dragdrop.ts](../../src/lib/dragdrop.ts)) is pointer-based; Playwright's `dragTo()` drives the HTML5 drag API, a different pipeline no touchscreen has. `pointerDrag` in [scheduler.spec.ts](../../tests/local/scheduler.spec.ts) does press → several `mouse.move` steps → release (the first move crosses the drag threshold; later moves let the drop target update). Touch drags go through a CDP session: `Input.dispatchTouchEvent` with `touchStart` / `touchMove` / `touchEnd`. Canvas drags in the SVG and raster editors call `scrollIntoViewIfNeeded()` first — an earlier download click may have scrolled the canvas off-screen, and mouse events at off-viewport coordinates hit nothing.
- **Snapshot placement matters.** `before = await app.dumpAll()` taken *after* `goto` cannot see a write the page made while loading; the image-editor and background-remover specs deliberately snapshot first.
- **`retries: 0`.** A test that passes on retry is a bug report, not a pass. Use `expect.poll` for async saves instead of loosening assertions.
- **`test.slow()` suites** (a11y sweep, offline, payload, background remover, SQL playground, the image editor's model-backed cases) take minutes on first run: wasm engines boot from disk and the model is real, not stubbed.
- **Fixtures.** [tests/local/fixtures/](../../tests/local/fixtures/) holds `sample.tiff` and `broken.tiff` (generated by [build-image-fixtures.mjs](../../tools/build-image-fixtures.mjs)) and one AVIF photo used by `images.spec.ts`; PNG/JPG/WebP inputs are encoded in-page with a canvas. The other checked-in files there (`png_sample_file_*.png`, the JPG/WebP/TIFF/SVG samples) are not referenced by any spec as of this version.
- **Environment-dependent case.** `generators.spec.ts`'s camera test accepts either the scan button or the "no camera" note (whichever the machine has) but requires exactly one and that permission state stays `prompt`.
