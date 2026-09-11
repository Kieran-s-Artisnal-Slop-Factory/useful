# useful — Version 0.6.0 plan (phased)

What 0.6.0 adds, split into phases that can each cut a release on their own,
with **checkpoints** — points where the full suite is run and must be green
before the next phase starts. The feature list comes from the
[TODO](TODO) as it read on 2026-09-10; this file is the reviewed version of
it — the same features with the technology chosen, the parts that cannot ship
as written named, and the order they can be built in. Where the two disagree,
this file is the later thought.

Written 2026-09-10 against the shipped 0.5.0 code: schema **v16** (per the
0.5.0 changelog — Phase 0 confirms `DB_VERSION`), `CACHE_NAME`
**`useful-cache-v39`**, 42 registered tools, `VERSION` and `package.json`
both reading `0.5.0`, no unreleased stanza in `CHANGELOG.md`, and one
uncommitted change in the working tree (`--page-max-width` 75rem → 81rem in
[theme.css](../../../src/styles/theme.css)) that Phase 0 adopts.

This is a wider release than 0.5.0: two new tools (Pomodoro, Clip path), two
new placeholder generators, a batch-variation system for placeholders, an
EXIF comparison for the photography calculator, and two small polish items.
One phase touches the data model (Pomodoro), one adds a preference key
(calories). Nothing touches the network.

> **Progress:** phases are marked DONE in the overview table and on their own
> heading as they land; checkpoints record the run they passed on. Everything
> else is still plan. **If you are taking over:** find the first phase not
> marked DONE, re-read its checklist, check `git log` for partial work under
> another commit message before starting, and keep the [TODO](TODO) boxes
> ticked as you go.

---

## Standing checklist — applies to EVERY phase

Inherited from [version-5-phased.md](version-5-phased.md), unchanged in
substance and repeated here so a phase can be worked from this file alone:

1. **If the data model changed:**
    1. All three schema files move in lockstep: [types.ts](../../../src/lib/db/types.ts),
       an **appended, `contains()`-guarded** migration in
       [db.ts](../../../src/lib/db/db.ts), and the `TABLES` mirror in
       [tests/local/helpers/schema.ts](../../../tests/local/helpers/schema.ts).
       A new **preference key** is a data-model change too: no migration, but
       the `preferences` column list in the mirror and a UI + unit test
       proving it round-trips.
    2. No sync regressions: every write goes through
       [repo.ts](../../../src/lib/db/repo.ts) (`patch()` for edits,
       `putSingleton` for singletons), rows stay JSON-native, page load writes
       nothing. `npm test` green **including the trust gate**.
    3. Anything new rides backup export/import automatically — verify
       [data.spec.ts](../../../tests/local/data.spec.ts) picked it up.
2. **Tests:** pure logic gets Vitest (`src/**/*.test.ts`, colocated);
   anything touching UI + data layer gets a Playwright spec driving the real
   UI and asserting isolated deltas through the oracle. Stateless tools
   assert **zero writes**. Budget ~40 s per Playwright UI test; a failure set
   that shifts between runs is flakiness, not a regression — re-run before
   digging. Never rebuild `dist` or run the dev server mid-`npm test`.
3. **CHANGELOG.md:** entries under `0.6.0 (unreleased)` → `Features` /
   `Bug Fixes` / `Other`. 2–4 sentences per change.
4. **PWA:** new pages added to `SHELL` in [sw.js](../../../public/sw.js) +
   `CACHE_NAME` bumped; new tools registered in
   [registry.ts](../../../src/lib/registry.ts) with an icon in
   [icons.ts](../../../src/lib/icons.ts); links built with `href()`. Lazy
   chunks a feature depends on offline join the precache;
   `tools/audit-precache.mjs` stays green.
5. **Usability first, accessibility second — but not zero.** Every control
   has a name (the registry-driven [a11y.spec.ts](../../../tests/local/a11y.spec.ts)
   sweep enrols every new route automatically), new text colours pass the
   token contrast check in both themes. Nothing that makes a tool slower or
   clumsier for a sighted mouse user.
6. **Docs:** every user-visible feature gets its page under [docs/dev/](../)
   and [docs/user/](../../user/). The dev page carries a **mermaid diagram**
   for anything with more than one moving part and **code references**
   (`[file.ts](path)` links, function names). After any docs pass, validate
   the mermaid blocks and links mechanically — a `;` inside a
   sequence-diagram message breaks the whole diagram.
7. **The app still never calls out on its own.**
   [payload.spec.ts](../../../tests/local/payload.spec.ts) keeps proving it;
   any heavy dependency a new page loads lazily joins its `HEAVY` matchers.
8. **Concurrent sessions:** another session may be committing in this repo.
   Stage by explicit path, re-check `git log` after any pause, and put new
   work in new files where possible.

---

## Decisions taken up front

Settled; the phases below assume them. Each records why.

1. **Napkin export captions live beside the row toggles, and blank means
   none.** [exportImage.ts](../../../src/lib/napkin/exportImage.ts)'s
   `CalculationRow.label` is already documented as "omitted when blank", so
   the renderer needs no change. The dialog's per-row state grows from one
   boolean to `{ show, caption, captionOn }`, with the three literals in
   `rebuildImage()` ([NapkinMathApp.svelte:262–275](../../../src/components/apps/NapkinMathApp.svelte))
   becoming the defaults. Like the other export options (theme, decimals,
   scale) the captions are **not persisted** — Q1 below asks whether they
   should ride the template.
2. **The calorie warning is a one-time acknowledgement, on the pattern the
   app already has.** [OfflineSetup.svelte](../../../src/components/chrome/OfflineSetup.svelte)
   shows a native `<dialog>` once and records `offline_prompt_seen`. The
   calorie page does the same with a new `calorie_risk_acknowledged_at`
   (ISO string, not a boolean — when it was accepted is the useful fact).
   It is stored in `preferences` because that is where the tool's only other
   memory (`calorie_units`) already lives; body measurements still never
   persist. Until accepted, the inputs are behind the dialog; Escape closes
   the dialog and leaves the tool disabled with a button to re-open it — no
   nagging, no silent bypass. The copy says it is not medical advice and to
   talk to a doctor; the button reads exactly `I have read and understand the
   risks`.
3. **The photo comparison is stops, not lux.** EXIF has no absolute light
   measurement; what it has is aperture, shutter, ISO and focal length. The
   comparison shows **EV100** for each photo (`EV = log2(N² / t) −
   log2(ISO / 100)`) and the difference decomposed into the three existing
   stop functions in [photography.ts](../../../src/lib/calc/photography.ts)
   (`apertureStops`, `shutterStops`, `isoStops`), each with the equation and
   the substituted values shown the way the calorie tool shows its steps.
   Parsing goes through `exifr` with a `pick` of the four tags — the library
   is already shipped for the image editor ([raster/exif.ts](../../../src/lib/raster/exif.ts))
   and loads lazily on this page too, so it joins the `HEAVY` payload
   matchers. A photo without the tags says which tag is missing rather than
   computing nonsense. Stateless: zero writes.
4. **Pomodoro is its own singleton store, and the engine drives it.** The
   Timers tool cannot express "work, break, work, break, long break" without
   a script on top, and the tick + notification machinery is already in
   [engine.svelte.ts](../../../src/lib/time/engine.svelte.ts). So: a
   `pomodoro` singleton (migration **v17**, the `stopwatch` singleton is the
   template) holding the schedule (`work_ms`, `short_break_ms`,
   `long_break_ms`, `rounds_before_long`), the live phase (`phase`,
   `round`, `end_at`, `paused_remaining_ms`, `state`), an `auto_advance`
   flag and the completion actions (`sound`, `vibrate`, `notify`). The engine
   gains a `pomodoro` branch next to the timer one: when `end_at` passes it
   raises a `CompletionNotice` ("Focus round 2 of 4 done — break time") and
   either starts the next phase (auto) or parks the row in `done` until the
   user hits Start. Writes only on user actions and phase transitions; a
   render never writes. Defaults 25/5/15 and 4 rounds, all editable on the
   page, with a session count for the day derived from `completed_today`
   + `completed_today_date` so a new day resets it without a scheduler.
5. **Clip path is stateless and emits three CSS functions.** Point shapes
   (all presets + free dragging) emit `polygon()`; circle and ellipse emit
   their own functions; **blinds and waves emit `path()`** — a `polygon()`
   cannot hold disjoint rectangles and `shape()` is too new to rely on.
   Everything is a pure function in `src/lib/gen/clipPath.ts` returning the
   CSS string plus the points for the preview; the page draws an SVG overlay
   with draggable handles on top of a sample image and shows the `clip-path:`
   line with a copy button. Percent units so the output is
   resolution-independent. The preset list is copied from the two reference
   sites at implementation time (Q3).
6. **Batch variation is a second argument to `buildBatch`, never a new code
   path.** `buildBatch(options, count, variation?)` derives item `i`'s
   `ImageOptions` from the base via a pure `varyOptions(base, i, n,
   variation, rng)` in [placeholder/images.ts](../../../src/lib/placeholder/images.ts),
   then calls the same `buildImage`. The RNG is `mulberry32(seedFrom(seed))`
   so a batch is reproducible, and item `i` is still "what these options
   produce" — the invariant the placeholders doc promises stays true. The
   `BatchVariation` type mirrors the TODO one-to-one: `sizes[]`,
   `background`, and a per-generator block (`ink`, `angleOffset`, `stop1`,
   `stop2`, `cycleKind`, `grainDelta`, `blurDelta`, `randomSeed`,
   `lineDelta`, `opacityDelta`, `sizeDelta`, `randomIcon`, `scenes[]`).
   Deltas wrap exactly as the TODO specifies (lines at 400, icon size at
   95 %, angle at 360). Controls are shown only for the generator selected,
   the way the existing option panel already gates itself. Random icons
   need the Lucide list the page already fetches lazily; the batch picks
   names with the seeded RNG and fetches only those.
7. **Mosaic and swirl are two more `GeneratorId`s, hand-drawn SVG like the
   rest.** Mosaic: a grid of blocks, each either painted from a palette of
   up to four colours (`palette: string[]`) or cut out to the background,
   with block size and cut-out ratio as options. Swirl: concentric
   logarithmic-spiral arms in two colours with turn count and arm width.
   Both seeded, both ride batch variation for free (palette shuffle and
   seed). The reference images in the TODO are the look to aim at; the
   human review list gets a line asking whether they land.
8. **Dependency policy for this release.** `npm outdated` on 2026-09-10:
   minor/patch → `lucide-static` 1.44. Majors → `@cortex-js/compute-engine`
   0.128, `@dicebear/core` 10, `@sqlite.org/sqlite-wasm` 3.53.4, `mermaid`
   12, `react`/`react-dom` 19, `typescript` 7, `vitest` 5. Each major is
   tried **on its own** with the unit suite plus the affected Playwright
   spec; one that fails is reverted and listed in the changelog with the
   reason. `react` 19 is skipped unless `@excalidraw/excalidraw` has moved
   past 0.18 with React 19 support. `vitest` 5 is the one expected to
   collide with the `@emnapi/core` override (the "For human" item); if it
   does, the override stays and the pin is noted. CI: bump
   `actions/checkout`, `setup-node`, `configure-pages`,
   `upload-pages-artifact`, `deploy-pages` to their current majors and keep
   Node at the current LTS line (verify `engines`).
9. **Existing plumbing is reused, not re-grown.** Downloads and clipboard
   through [exportFile.ts](../../../src/lib/exportFile.ts), zips through
   [zip.ts](../../../src/lib/zip.ts), notices through the engine, dialogs
   native `<dialog>`, colours through [ColorField.svelte](../../../src/components/ColorField.svelte),
   explainers through [Explainer.svelte](../../../src/components/Explainer.svelte).

---

## Open questions

Answers change what gets built. Each has a default the phase can proceed on if
nobody answers.

| # | Question | Needed by | Default if unanswered |
|---|----------|-----------|-----------------------|
| Q1 | Should custom export captions be saved on the napkin template (new optional `export_captions` field, mirror update) or stay per-session like theme/scale? | Phase 1 | **Per-session.** Consistent with the other export options; a field is cheap to add later |
| Q2 | Calorie acknowledgement: once per browser (preference) or once per visit? | Phase 2 | **Once per browser**, remembered in `preferences` |
| Q3 | Clip path presets: exactly the cssportal polygon list + design.dev's chevron and message, or a curated subset? | Phase 5 | **All of them**, fetched from the two pages at implementation time and recorded in the dev doc |
| Q4 | Pomodoro: auto-start the next phase, or wait for the user? | Phase 4 | **Wait**, with an `auto_advance` toggle |
| Q5 | Should mosaic's "cut-out" blocks be transparent (PNG/SVG alpha) or the background colour? | Phase 7 | **Background colour**, with a transparent toggle if cheap |

---

## Phase overview

| # | Phase | Migration | Pref keys | Notes |
|---|-------|-----------|-----------|-------|
| 0 | Groundwork: version bump, adopt the theme.css change, dependency + CI updates | — | — | **DONE.** dicebear 10 + TS 7 held back; vitest 5 landed |
| 1 | Napkin Math › toggle + edit export captions | — | — | **DONE.** Per-session (Q1); `captionText` in exportImage.ts |
| 2 | Daily Calories › risk acknowledgement | — | `calorie_risk_acknowledged_at` | **DONE.** Once per browser (Q2); only accepting writes |
| 3 | Photography › compare two photos by EXIF | — | — | **DONE.** Stateless; `exifr` joined HEAVY; two generated JPEG fixtures (the Unsplash one has no exposure tags) |
| **A** | **Checkpoint** — full suite green | | | **PASSED** 2026-09-10 |
| 4 | Time › Pomodoro | **v17** `pomodoro` singleton | — | **DONE.** Wait between phases (Q4) with `auto_advance`; pure transitions in `pomodoro.ts`; engine `completePomodoro` shares `announce` with timers |
| 5 | Generators › Clip path | — | — | **DONE.** Stateless; 25 presets (23 cssportal + 2 design.dev, Q3); blinds and waves emit percent `polygon()` (seam trick), `path()` only as the wave's secondary copy — see [clip-path.md](../tools/clip-path.md) |
| **B** | **Checkpoint** — full suite green | | | **PASSED** 2026-09-10 |
| 6 | Placeholders › batch variation | — | — | `varyOptions`; per-generator controls |
| 7 | Placeholders › mosaic + swirl generators | — | — | Two `GeneratorId`s |
| 8 | Hardening + release | — | — | Docs sweep, payload, offline, cut 0.6.0 |
| **C** | **Checkpoint** — full suite green, release | | | |

Phases 1–3 are independent of each other and small: run them as **three
subagents in parallel** (separate files: one component each, one spec each;
Phase 2's mirror edit is a one-line addition and the only shared file — do it
in the parent before spawning). Phases 4 and 5 are independent (different
stores, different pages) and can also run in parallel; Phase 4 owns
`db.ts`/`types.ts`/`schema.ts`/`engine.svelte.ts`, Phase 5 owns nothing
shared. Phases 6 and 7 both edit `images.ts` and `PlaceholdersApp.svelte` —
**sequential**, 7 after 6 so the new generators get variation for free.

---

## Checkpoints — how they run

A checkpoint is the full suite, no filters:

```bash
npm run test:unit
```

```bash
npm test
```

Both green, including the trust gate and the a11y sweep. If a failure set
shifts between two runs it is flakiness — re-run once before digging. A
checkpoint records its date in the overview table and on its heading. No
phase past a checkpoint starts before it passes. Workflow verifier agents can
die on the spend limit — if one does, the parent runs the suite itself.

### Checkpoint A — after Phases 0–3 — PASSED 2026-09-10 (526 pass; one background-remover flake green on rerun; exifr payload matcher resolved from the built chunk name)

Adds to the baseline: napkin spec's new caption test, calculators spec's new
acknowledgement + EXIF tests, payload spec with `exifr` on the photography
page, data spec with the new preference column.

### Checkpoint B — after Phases 4–5 — PASSED 2026-09-10 (539 pass; the clip-path drag spec needed the handle scrolled into view first)

Adds: migration v17 round-trip in the data spec, the pomodoro and clip-path
specs, a11y sweep over two new routes, offline spec over two new SHELL
entries, `tools/audit-precache.mjs`.

### Checkpoint C — after Phases 6–8 — the release gate

Everything above plus the placeholders spec's batch and generator tests. Then
the release steps in Phase 8.

---

## Phase 0 — Groundwork — DONE

**Goal:** the repo says 0.6.0, the changelog has somewhere to write, the
dependencies are current where they safely can be, and the working tree is
clean.

1. `VERSION` and `package.json` → `0.6.0`. Open `# 0.6.0 (unreleased)` at
   the top of [CHANGELOG.md](../../../CHANGELOG.md) with the three
   sub-headings.
2. Commit the pending `--page-max-width: 81rem` change in
   [theme.css](../../../src/styles/theme.css) under **Other** ("wider page
   for the calculators' side-by-side layouts") — verify nothing at 75rem
   depended on it (search for `page-max-width` consumers) and eyeball the
   home tiles and the notebook.
3. Dependencies, per decision 8. Order: `npm update` for the in-range ones,
   then each major on its own branch of work: `lucide-static` (check the
   icon names the placeholders tool fetches still exist), `mermaid` 12
   (notebook + docs previews), `@cortex-js/compute-engine` 0.128 (napkin
   engine — run `engine.test.ts`, `substitute` and `exportImage` tests),
   `@sqlite.org/sqlite-wasm` (SQL playground spec; the wasm is precached —
   re-run `audit-precache`), `@dicebear/core` 10 (logo generator spec),
   `typescript` 7 (`astro check` if it is wired, else `npx tsc --noEmit`),
   `vitest` 5 (expect the `@emnapi/core` collision). Anything reverted goes
   in the changelog under **Other** with a sentence on why.
4. CI: [astro.yml](../../../.github/workflows/astro.yml) action majors per
   decision 8; keep Node on the LTS line the `engines` field allows.
5. Tick the two Maintenance boxes in the TODO.

**Tests:** `npm run test:unit` and the specs named per dependency above.
Payload spec after any dependency that changes a lazy chunk's name.

**Docs:** [build-and-tooling.md](../build-and-tooling.md) dependency
section if a pin or override changed.

---

## Phase 1 — Napkin Math › toggle and edit the export captions — DONE

**Goal:** each of the three rows in the export image can have its caption
turned off individually, and the caption text can be replaced.

1. In [NapkinMathApp.svelte](../../../src/components/apps/NapkinMathApp.svelte)
   replace `showFormulaRow` / `showSubstitutedRow` / `showResultRow` with a
   small `rows` state object `{ formula, substituted, result }` each `{
   show: boolean; captionOn: boolean; caption: string }`, defaults from the
   current literals. The "Title" checkbox is unchanged.
2. Dialog markup: each row line becomes `[x] Formula   [x] caption
   [ Formula        ]` — the row toggle, a caption toggle, and a text input
   that is disabled when either toggle is off. Testids
   `napkin-image-caption-formula` etc. Keep the existing testids for the
   row toggles so the 0.5.0 spec still passes.
3. `rebuildImage()` passes `label: captionOn ? caption.trim() : ''`. The
   renderer already omits blank labels — confirm with the `exportImage`
   unit test rather than assuming.
4. A "Reset captions" link restores the three defaults.
5. If Q1 flips to "save on the template": add `export_captions?: {…}` to
   `NapkinTemplate`, the mirror row in `schema.ts`, load into `rows` on
   template open, write via `patch()` on save only.

**Tests:** Playwright in [napkin-math.spec.ts](../../../tests/local/napkin-math.spec.ts):
uncheck the substituted caption → the downloaded SVG lacks the text `With
your values` but still has the substituted formula; retype the formula
caption to `Given` → the SVG contains `Given`; the export still writes
nothing. Unit: `exportImage.test.ts` gains a blank-label case if one is not
there.

**Docs:** [napkin-math.md](../tools/napkin-math.md) export section; the
user doc's export paragraph.

---

## Phase 2 — Daily Calories › risk acknowledgement — DONE

**Goal:** the calorie calculator is unusable until the user has read a
not-medical-advice warning once, per decision 2.

1. `calorie_risk_acknowledged_at?: string` in `Preferences`
   ([types.ts](../../../src/lib/db/types.ts)) with a doc comment; the
   `preferences` column in [schema.ts](../../../tests/local/helpers/schema.ts).
2. In [CalorieCalculatorApp.svelte](../../../src/components/apps/CalorieCalculatorApp.svelte):
   on mount read the singleton (it already reads `calorie_units`); if the
   key is absent open a `<dialog data-testid="cal-risk-dialog">` via
   `showModal()`. Body: what the tool is, that it is not medical advice, that
   a doctor should be consulted before acting on any figure, and that the
   equations are population estimates. One primary button `I have read and
   understand the risks` → `putSingleton('preferences', {
   calorie_risk_acknowledged_at: new Date().toISOString() })`, close, enable
   the form. A secondary `Not now` / Escape → close, leave the form
   disabled behind an inline notice with a `Read the warning` button that
   reopens it.
3. The form's fieldset carries `disabled` until acknowledged so nothing can
   be typed around the dialog.

**Tests:** Playwright in [calculators.spec.ts](../../../tests/local/calculators.spec.ts):
first visit shows the dialog and page load has written nothing; accepting
writes exactly one preferences field (oracle delta), the form enables;
reload → no dialog. Escape → form stays disabled, zero writes. Data spec
picks the new column up automatically — run it.

**Docs:** [calculators.md](../tools/calculators.md) calorie section (a short
sequence diagram: mount → read prefs → dialog → accept → write);
[preferences.md](../preferences.md) key table; user doc.

---

## Phase 3 — Photography › compare the light in two photos — DONE

**Goal:** upload two photos with EXIF and see how much more light one
received than the other, with the equations shown, per decision 3.

1. Pure maths in [photography.ts](../../../src/lib/calc/photography.ts):
   `exposureValue({ aperture, shutter, iso })` → EV100 and
   `compareExposures(a, b)` → `{ ev: [a, b], apertureStops, shutterStops,
   isoStops, totalStops, ratio: 2 ** totalStops }`, reusing the existing
   stop functions. Sign convention stated in the doc comment (positive =
   photo B received more light).
2. `src/lib/calc/exifExposure.ts`: `readExposure(file: File)` → lazy
   `import('exifr')`, `exifr.parse(file, { pick: ['FNumber',
   'ExposureTime', 'ISO', 'FocalLength', 'Model'] })`, returns the settings
   or a `{ missing: string[] }` naming the absent tags. Kept out of
   `photography.ts` so that module stays dependency-free and unit-testable.
3. In [PhotographyApp.svelte](../../../src/components/apps/PhotographyApp.svelte)
   a third card **Compare two photos**: two file inputs (or drops, via the
   0.5.0 ingest helper if it accepts files), a per-photo readout (model,
   f-number, shutter, ISO, focal, EV), then the comparison: three rows each
   showing the equation, the substituted values and the result in stops,
   a total, and a sentence ("Photo B received about 2.3 stops (≈ 5×) more
   light than photo A"). The existing `formatShutter` / `formatStops` do
   the formatting.
4. `exifr` joins the `HEAVY` list in [payload.spec.ts](../../../tests/local/payload.spec.ts)
   for the photography route, and its chunk joins the precache if
   `audit-precache` asks for it.

**Tests:** Vitest for `exposureValue` (f/2.8 1/250 ISO 100 → EV ≈ 10.9),
`compareExposures` (one-stop changes in each axis; combined; symmetry
`compare(a,b).totalStops === -compare(b,a).totalStops`). Playwright in
[calculators.spec.ts](../../../tests/local/calculators.spec.ts): drop the
Unsplash JPEG fixture in [tests/local/fixtures](../../../tests/local/fixtures)
twice → 0 stops difference; a fixture with no EXIF (the SVG or WebP sample)
→ the missing-tag message; zero writes. If the Unsplash JPEG has no
exposure tags, add one small JPEG with known EXIF to fixtures (write it
with `piexifjs`, which the image editor already uses).

**Docs:** [calculators.md](../tools/calculators.md) photography section
with the EV equation and a small flowchart (file → exifr → settings →
compare); user doc.

---

## Checkpoint A runs here. See *Checkpoints — how they run*.

---

## Phase 4 — Time › Pomodoro — DONE

**Goal:** a Pomodoro timer as its own tool under Time, driven by the
notification engine, per decision 4.

1. **Data model.** `Pomodoro` interface in [types.ts](../../../src/lib/db/types.ts)
   (fields per decision 4), `pomodoro: { indexes: [], singleton: true }` in
   `STORES`, migration **v17** appended to [db.ts](../../../src/lib/db/db.ts)
   (`if (!db.objectStoreNames.contains('pomodoro')) …`), the mirror row in
   [schema.ts](../../../tests/local/helpers/schema.ts). Backup export/import
   picks it up through `STORES`; the data spec's "every store" test proves
   it.
2. **Engine.** [engine.svelte.ts](../../../src/lib/time/engine.svelte.ts):
   load the singleton alongside timers; on tick, when `state === 'running'`
   and `end_at` has passed, raise a `CompletionNotice` with the phase in the
   label, ring/vibrate/notify per the row's flags, and either advance
   (`auto_advance`) or set `state: 'done'`. Advance = compute next phase
   (`work` → `short_break`, or `long_break` when `round %
   rounds_before_long === 0`; any break → `work`, round+1), write once.
   Missed-completion handling reuses `MISSED_THRESHOLD_MS`.
3. **Tool.** `src/components/apps/PomodoroApp.svelte`, page
   `src/pages/tools/pomodoro.astro`, registry entry (`id: 'pomodoro'`,
   category Time, aliases `focus`, `tomato`, `work timer`; move the
   `pomodoro` alias off Timers), icon (a Lucide `timer-reset` or similar
   added to [icons.ts](../../../src/lib/icons.ts)), `SHELL` entry +
   `CACHE_NAME` → `v40`. UI: a big ring/readout for the current phase, Start
   / Pause / Skip / Reset, the round dots (● ● ○ ○), today's completed
   count, and a settings card (four durations, rounds, auto-advance, the
   three completion actions). Pause/resume use the timers' `end_at` /
   `paused_remaining_ms` convention so the maths in
   [duration.ts](../../../src/lib/time/duration.ts) is reused.

**Tests:** Vitest for the phase-advance function (pure: `nextPhase(row)`),
including the long-break boundary and the day rollover of
`completed_today`. Playwright `tests/local/pomodoro.spec.ts`: fresh page
writes nothing; Start writes one row with `state: 'running'`; Pause writes
only `state` + `paused_remaining_ms`; Skip advances the phase; a short
work length (set 1 s via the settings) completes and raises a notice; data
spec covers v17 round-trip.

**Docs:** [time.md](../tools/time.md) Pomodoro section with a mermaid
**state diagram** (idle → running → paused → done, and the phase cycle) and
[notification-engine.md](../notification-engine.md) gains the pomodoro
branch; [data-layer.md](../data-layer.md) migration table; user doc.

---

## Phase 5 — Generators › Clip path — DONE

> Implemented 2026-09-10. Deviation from decision 5: blinds and waves emit
> `polygon()` in percent, not `path()` — `path()` is pixel-bound (no viewBox),
> and one polygon can trace disjoint strips by doubling back along a
> zero-width seam. `path()` remains as the wave's secondary copy. Rationale
> and the preset table: [clip-path.md](../tools/clip-path.md).

**Goal:** a CSS `clip-path` generator with point shapes, circle, ellipse,
blinds and waves, per decision 5.

1. **Pure logic** `src/lib/gen/clipPath.ts`:
   - `PRESETS: { id, label, points: [x, y][] }[]` — every polygon from the
     cssportal generator plus chevron and message from design.dev (Q3).
     Fetch both pages while implementing; record the list in the dev doc so
     it is reviewable without the sites.
   - `polygonCss(points)`, `circleCss(radius, cx, cy)`, `ellipseCss(rx, ry,
     cx, cy)` in percent.
   - `blindsPath({ count, gap, direction })` → `path()` of `count`
     rectangles with `gap` percent between them (horizontal or vertical).
   - `wavePath({ waves, amplitude, phase, edge: 'top' | 'bottom', kind:
     'sine' | 'triangle' | 'square' … })` → `path()` with the wave along
     one edge and the rest of the box filled; mirror the settings the
     wavegenerator page exposes as closely as the offline build allows.
   - `clipPathCss(shape)` — the one entry point the page calls, returning
     `{ css, previewPath }` where `previewPath` is SVG `d` for the overlay.
2. **Tool.** `src/components/apps/ClipPathApp.svelte`, page
   `src/pages/tools/clip-path.astro`, registry entry (Generators, aliases
   `clip`, `mask`, `polygon`), icon, `SHELL` + `CACHE_NAME`. Layout: shape
   picker on the left (presets grid, then circle / ellipse / blinds / wave
   tabs), preview in the middle (a sample gradient or the user's dropped
   image with the clip applied live, plus an SVG overlay of draggable
   handles for point shapes — pointer events, percent maths, one `$state`
   array), the CSS line under it with **Copy**. Add / remove point on
   double-click / right-click. Stateless: zero writes.
3. Each control has a label; sliders show their value.

**Tests:** Vitest for every preset (points in 0–100, at least three
points), `blindsPath` (count × gap fits in 100 %), `wavePath` (starts and
ends at the box edge, `count` peaks), and `clipPathCss` string shapes.
Playwright `tests/local/clip-path.spec.ts`: pick a preset → the preview
element's computed `clip-path` matches the shown CSS; drag a handle → the
CSS changes; copy writes to the clipboard; zero writes.

**Docs:** `docs/dev/tools/clip-path.md` (flowchart: shape state → pure
builder → CSS + overlay) linked from [generators.md](../tools/generators.md);
user doc.

---

## Checkpoint B runs here. See *Checkpoints — how they run*.

---

## Phase 6 — Placeholders › batch variation

**Goal:** a batch can differ per image in the ways the TODO lists, per
decision 6.

1. `BatchVariation` type + `DEFAULT_BATCH_VARIATION` (everything off) +
   `varyOptions(base, i, n, variation, rng)` in
   [images.ts](../../../src/lib/placeholder/images.ts); `buildBatch` gains
   the optional third argument and calls `varyOptions` for every item (item
   0 included, so "sizes[0]" applies to the first image — document this).
   `batchName` uses the varied size.
2. Rules, one per TODO line: `sizes` — a list of exactly `n` `{ width,
   height }` (the UI keeps it in step with the batch count); `background` —
   a seeded random colour per item; `ink` — likewise for `foreground`;
   gradient `angleOffset` (add `i × offset`, wrap 360), `stop1` / `stop2`
   (random, re-rolled until it differs from the other stop), `cycleKind`
   (linear → radial → linear, since SVG has no conic — say so in the note);
   noise `grainDelta` / `blurDelta` (add `i × delta`, clamp to the option's
   bounds); flow `randomSeed` (12 random chars from the rng), `lineDelta`
   (wrap at 400 back to `0 + remainder`); material / planes `randomSeed`,
   `opacityDelta` (clamp 0.05–1); icon `sizeDelta` (wrap at 0.95 to `0 +
   remainder`, floor 0.1), `randomIcon` (a name from the fetched list per
   item — the page resolves names to markup before calling `buildBatch`,
   so `varyOptions` receives `iconSvgs: string[]` rather than fetching);
   scene `scenes` — the allowed `SceneId[]`, chosen by category checkboxes
   (nature / sport / city, from [scenes.ts](../../../src/lib/placeholder/scenes.ts))
   or individually, one picked per item.
3. UI in [PlaceholdersApp.svelte](../../../src/components/apps/PlaceholdersApp.svelte):
   a **Vary across the batch** card under the batch count, showing the
   common controls (sizes, background) always and the per-generator block
   for the selected generator. Sizes is a small table with one row per
   batch item. Each row a checkbox + its parameter.

**Tests:** Vitest: `varyOptions` is deterministic for a seed; each rule in
isolation (angle wraps, stops differ, line count wraps, icon size wraps,
scenes stay within the allowed set, sizes apply per index); `buildBatch`
with everything off equals the pre-existing behaviour byte-for-byte (keep
the current snapshot test if there is one). Playwright in
[placeholders.spec.ts](../../../tests/local/placeholders.spec.ts): enable
background variation → the zip's three SVGs have three different fills;
sizes → three different `viewBox`es; zero writes.

**Docs:** [placeholders.md](../tools/placeholders.md) gains a "Batches"
section with a flowchart (base options → varyOptions × n → buildImage → zip)
and the wrap rules table; user doc.

---

## Phase 7 — Placeholders › mosaic and swirl generators

**Goal:** two new image generators, per decision 7.

1. `GeneratorId` gains `'mosaic' | 'swirl'`; `GENERATORS` two entries;
   `ImageOptions` gains `palette: string[]` (1–4 colours), `blockSize`
   (percent of the short side), `cutRatio` (0–1, the share of blocks cut
   out), `turns` and `armWidth` for swirl; defaults in
   `DEFAULT_IMAGE_OPTIONS`.
2. `drawMosaic` — grid of `blockSize` squares; each block is painted from
   `palette` or, with probability `cutRatio`, left as background (Q5),
   with a seeded jitter so it reads as cut rather than checkered. `drawSwirl`
   — `turns` logarithmic-spiral arms as filled paths alternating two
   colours from `palette`, `armWidth` controlling the ratio.
3. Option panel blocks for both; the palette editor is up to four
   `ColorField`s with add/remove. Batch variation (Phase 6) gets a
   `palette: 'shuffle' | 'random'` rule for both.

**Tests:** Vitest: both generators produce valid SVG, are deterministic per
seed, honour the palette (every `fill` is in the palette or the
background), and a `cutRatio` of 0 cuts nothing. Playwright: pick each
generator → the preview renders and downloads; zero writes.

**Docs:** [placeholders.md](../tools/placeholders.md) generator table;
user doc. Add to the TODO's *For human* list: "look at a mosaic and a swirl
next to the reference images and say whether they land".

---

## Phase 8 — Hardening and release

1. Docs sweep: every page touched above; mermaid and link validation run
   mechanically; the dev docs README index lists `clip-path.md` and the
   pomodoro section.
2. [payload.spec.ts](../../../tests/local/payload.spec.ts) reviewed for the
   two new routes and the photography page's `exifr`;
   [offline.spec.ts](../../../tests/local/offline.spec.ts) covers the two
   new SHELL entries; `tools/audit-precache.mjs` green.
3. Changelog: every phase has its entry; the dependency phase lists what
   moved and what was held back; the migration banner at the top says
   **v17 runs automatically, adds one store, touches no existing data**.
4. TODO: all boxes ticked or moved to the *For human* list with a reason.
5. Cut the release: `CHANGELOG.md` heading gets the date, one commit
   (`git commit -F <file>`, message file in the scratchpad), tag `v0.6.0`
   only if the previous releases were tagged (check `git tag`).

**Tests:** Checkpoint C — `npm test` and `npm run test:unit` fully green.

---

## Checkpoint C runs here, then the release.

---

## Ordering

- **Phase 0 first**, alone: everything else builds on a clean tree and a
  current dependency set, and a dependency bump mid-phase muddies a failure.
- **Phases 1–3 in parallel** (three subagents), then Checkpoint A.
- **Phases 4 and 5 in parallel** (two subagents), then Checkpoint B.
- **Phase 6 then 7**, sequential, same files.
- **Phase 8 last; Checkpoint C is the release gate.**

---

## Deliberately out of scope for 0.6.0

- Saving export captions on napkin templates unless Q1 says so.
- A `shape()`-based clip path output; `path()` covers blinds and waves in
  every current engine.
- Per-user pomodoro history beyond today's count — a `pomodoro_sessions`
  log is a store away if it is ever wanted.
- Conic gradients in placeholder batches: SVG cannot draw them, the same
  limit the single-image tool already states.
- Anything that talks to the network. The reference sites in the TODO are
  read by the developer while building, never by the app.
