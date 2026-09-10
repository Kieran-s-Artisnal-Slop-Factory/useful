# useful — Version 0.5.0 plan (phased)

What 0.5.0 adds, split into phases that can each cut a release on their own,
with **checkpoints** — points where the full suite is run and must be green
before the next phase starts. The feature list comes from the
[TODO](TODO) as it read on 2026-09-09; this file is the reviewed version of
it — the same features with the technology chosen, the parts that cannot ship
as written named, and the order they can be built in. Where the two disagree,
this file is the later thought.

Written 2026-09-09 against the shipped 0.4.0 code: schema **v16**,
`CACHE_NAME` **`useful-cache-v38`**, 40 registered tools across nine
categories, `VERSION` and `package.json` both reading `0.4.0`, and no
unreleased stanza in `CHANGELOG.md` — opening one is Phase 0 work.

This is a small release by weight: three features, none of them touching the
network, at most one of them touching the data model. The largest single
piece is the colour extractor, and most of *that* is a UI over pure
functions. After 0.4.0's playgrounds this is a deliberately quiet one.

> **Progress:** phases are marked DONE in the overview table and on their own
> heading as they land; checkpoints record the run they passed on. Everything
> else is still plan. **If you are taking over:** find the first phase not
> marked DONE, re-read its checklist, check `git log` for partial work under
> another commit message before starting, and keep the [TODO](TODO) boxes
> ticked as you go.

---

## Standing checklist — applies to EVERY phase

Inherited from [version-4-phased.md](version-4-phased.md), unchanged in
substance and repeated here so a phase can be worked from this file alone:

1. **If the data model changed:**
    1. All three schema files move in lockstep: [types.ts](../../../src/lib/db/types.ts),
       an **appended, `contains()`-guarded** migration in
       [db.ts](../../../src/lib/db/db.ts), and the `TABLES` mirror in
       [schema.ts](../../../tests/local/helpers/schema.ts) (plus the Tables
       section of [README.md](../../../README.md)). A new **preference key**
       is a data-model change too: it needs no migration, but it needs the
       `preferences` column list in the mirror and a UI + unit test proving
       it round-trips.
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
   digging.
3. **CHANGELOG.md:** entries under `0.5.0 (unreleased)` → `Features` /
   `Bug Fixes` / `Other`. 2–4 sentences per change.
4. **PWA:** new pages added to `SHELL` in [sw.js](../../../public/sw.js) +
   `CACHE_NAME` bumped; new tools registered in
   [registry.ts](../../../src/lib/registry.ts) with an icon in
   [icons.ts](../../../src/lib/icons.ts); links built with `href()`. Lazy
   chunks a feature depends on offline join the precache;
   `tools/audit-precache.mjs` stays green.
5. **Usability first, accessibility second — but not zero.** Per the TODO:
   this is a personal app, and where the two collide usability wins. What
   is still non-negotiable because it costs nothing: every control has a
   name (the registry-driven [a11y.spec.ts](../../../tests/local/a11y.spec.ts)
   sweep enrols every new route automatically and fails on unlabelled
   inputs), and new text colours pass the existing token contrast check in
   both themes. What is *not* required this release: colour-blind-safe
   swatch encodings, hand-driven keyboard passes over every new grid, or
   any change that makes a tool slower or clumsier for a sighted mouse user.
6. **Docs:** every user-visible feature gets its page under [docs/dev/](../)
   and [docs/user/](../../user/). The dev page carries a **mermaid diagram**
   for anything with more than one moving part and **code references**
   (`[file.ts](path)` links, function names) so a reader can find the code
   from the prose. After any docs pass, validate the mermaid blocks and
   links mechanically — a `;` inside a sequence-diagram message breaks the
   whole diagram, and it has happened before.
7. **The app still never calls out on its own.** None of the three features
   has a reason to touch the network; [payload.spec.ts](../../../tests/local/payload.spec.ts)
   keeps proving it.

---

## Decisions taken up front

Settled; the phases below assume them. Each records why.

1. **The colour extractor is stateless.** Like Themes, it holds pure view
   state and writes nothing to IndexedDB: an image comes in, a palette comes
   out, the outputs are copy/download. Saving palettes would mean a v17
   migration, a library sidebar, and a backup-file footprint for something
   whose whole output fits on the clipboard. If "save this palette" is
   wanted later it is a store away; nothing here forecloses it.
2. **Quantisation is hand-rolled k-means in Oklab, no new dependency.** The
   requirement is "the major colours, and let me pick how many". The image
   is downsampled to ≤ 192 px on the long side before sampling (≤ ~37 k
   pixels), pixels are converted to Oklab (the existing colour maths in
   [color.ts](../../../src/lib/gen/color.ts) is the starting point — reuse
   what is there before adding), seeded with k-means++ and run to
   convergence or 24 iterations, and clusters are reported ranked by
   population. Oklab because Euclidean distance there roughly matches
   perceived difference, so near-duplicate blues merge and a small accent
   survives. That is ~15 M cheap operations at k = 12 — under 100 ms on the
   main thread, so **no worker**; the bcrypt-worker pattern is there if a
   later profile disagrees. Median-cut was the alternative; it is faster
   but boxes colours by axis, which splits a gradient sky into three
   near-identical entries. Seeded through [random.ts](../../../src/lib/random.ts)
   so the same image and k give the same palette every time, which is what
   makes it unit-testable.
3. **Theme export goes through `buildTheme()` unchanged.** The Themes tool's
   [theme.ts](../../../src/lib/gen/theme.ts) already takes five role colours
   (`primary`, `secondary`, `accent`, `neutral`, `base`), derives any blank
   slot, and emits the `:root { --primary: light-dark(…) … }` block the TODO
   asks for. The extractor maps its palette onto those five roles — default
   assignment by population and chroma, every slot re-pickable from the
   palette — feeds `light` and leaves `dark` null so the derivation does the
   dark side, and shows the result. One theme format in the app, one
   function producing it.
4. **The Themes preview becomes a shared component.** The component preview
   is inline markup in `ThemesApp.svelte` today (the card, accordion, table
   and form under `data-testid="th-preview"`). It is lifted into
   `src/components/ThemePreview.svelte` taking `vars` and mounted by both
   tools, so "same preview as Themes" is literally true and stays true.
   Existing Themes testids are preserved so its spec does not move.
5. **Paste lands as a shared ingest helper, not a one-off.** No page in the
   app handles clipboard paste today. `src/lib/img/ingest.ts` gives one
   function for "get me an image from a paste event, a file input, or a
   drop" and returns an `ImageBitmap` plus the source name and byte size,
   with the same decode path the converter uses. The extractor is its first
   consumer; the resizer, compressor and editor can adopt it later without
   this release growing.
6. **Napkin Math's image export renders with MathLive, not MathJax.** The
   TODO says "the mathjax representation"; the app has never shipped MathJax.
   Formulas are rendered by MathLive (`convertLatexToMarkup`), which is
   already loaded on the page, and [formulaMarkup.ts](../../../src/lib/codegen/formulaMarkup.ts)
   already produces self-contained markup + CSS with the KaTeX faces inlined
   as data URIs for the web-component export. The image is that markup
   inside an SVG `<foreignObject>`. Adding MathJax would be ~1 MB of new
   payload to draw the same glyphs from the same font family. If "MathJax"
   was shorthand for "the typeset formula", this is it; if it was literal,
   it is an open question below with this as the default.
7. **Substituted values come from the engine, not string replacement.**
   [engine.ts](../../../src/lib/napkin/engine.ts) already substitutes via
   `expr.subs()` on a boxed expression; the substituted expression's
   `.latex` is the "variables replaced by their values" form. Text-replacing
   `x` inside `\text{max}` or `\exp` is the bug string replacement always
   ships. Number formatting (precision, thousands, scientific) is the one
   place the output is post-processed, and only on numeric leaves. The
   exported image shows **formula → substituted formula → result** as three
   rows, with the middle row omittable.
8. **SVG is the source of truth; PNG is a rasterisation of it.** The SVG
   file is written directly (a hand-built string on the
   [sprite/export.ts](../../../src/lib/sprite/export.ts) precedent, with
   [svg/build.ts](../../../src/lib/svg/build.ts)'s `escapeXml`); PNG is that
   SVG loaded into an `Image` from a blob URL, drawn to a canvas at 1×/2×/3×
   and encoded through the existing `encodeCanvas()` in
   [img/convert.ts](../../../src/lib/img/convert.ts). The rasteriser lives in
   `src/lib/raster/svgToPng.ts` because it is generic. Known trade: a
   `<foreignObject>` SVG rasterises in Chromium and Firefox when every
   resource is inline (which the embedded fonts guarantee); **Safari is
   unreliable** at drawing `<foreignObject>` to canvas. The PNG button says
   so when the UA is WebKit and offers the SVG instead; this is a personal
   app used from Chromium, and a Safari-specific canvas pipeline is not
   worth building blind.
9. **The calorie calculator uses Mifflin–St Jeor by default.** It is the
   equation the dietetics literature has preferred since the 2005
   comparison; Harris–Benedict (revised 1984) and Katch–McArdle (needs body
   fat %) are selectable, and the page says in one sentence what each
   assumes. Activity multipliers are the standard five (1.2 → 1.9). Goal
   pacing converts a target rate (kg or lb per week) to a daily
   deficit/surplus at ~7 700 kcal per kg, and the page states plainly that
   this is a planning estimate, not a prescription — with a warning, not a
   block, when the target drops below the resting rate or below the
   commonly cited floors. Units (metric/imperial) are remembered in the
   `preferences` singleton; the calculation itself is stateless.
10. **Existing plumbing is reused, not re-grown.** Downloads and clipboard
    through [exportFile.ts](../../../src/lib/exportFile.ts) (`downloadBlob`,
    `downloadText`, `copyText`, `copyPng`), colour formatting through
    [color.ts](../../../src/lib/gen/color.ts) and
    [ColorField.svelte](../../../src/components/ColorField.svelte), cards and
    explainers through the shared components, numeric rows in the
    `ThemesApp.svelte` shape.

---

## Open questions

Answers change what gets built. Each has a default the phase can proceed on if
nobody answers.

| # | Question | Needed by | Default if unanswered |
|---|----------|-----------|-----------------------|
| Q1 | "MathJax representation" in the TODO — literal MathJax, or "the typeset formula"? | Phase 3 | **Typeset via MathLive** (decision 6). No new dependency; same glyphs |
| Q2 | Should the exported formula image include the result row, or only the formula with values substituted? | Phase 3 | **Three rows** (formula, substituted, result), each toggleable in the preview dialog; the substituted row alone is one toggle away |
| Q3 | Colour extractor: should the theme mapping also offer the *harmony* generator (`harmony.ts`) to fill missing roles from one extracted colour? | Phase 1 | **ANSWERED: no, as defaulted.** `buildTheme()`'s own derivation fills blanks. Harmony stays a Themes feature, reached by the hand-off: the extractor writes the five roles into the query string and ThemesApp seeds its builder from them in `onMount` |
| Q4 | Calorie calculator: remember the last *inputs* (weight, height, age) as well as the unit system? | Phase 2 | **ANSWERED: units only, as defaulted.** Body measurements in a backup file is a privacy line the app has not crossed for a calculator; the form is eight fields and takes ten seconds |
| Q5 | Dependency updates: majors too (Vitest, Playwright, Astro, Svelte if any), or minors/patches only? | Phase 0 | **ANSWERED: minors and patches only; every major listed with a verdict and none applied** — a narrower answer than this row originally defaulted to. Fifteen packages moved within their ranges; the six majors and the reasons for holding each are in [version-5.md](version-5.md)'s Appendix A. The `react` 18 / `@types/react` 19 mismatch is therefore **recorded rather than corrected**: it is inside the deferred set, it affects nothing this app compiles, and the appendix says so. A patch to vitest turned out to be blocked outright by an npm bug rather than declined |

---

## Phase overview

| Phase | Goal | New deps | DB | Notes |
|-------|------|----------|----|-------|
| 0 | Groundwork: version bump, dependency audit, shared preview + ingest + rasteriser | — | — | **DONE.** Unblocks 1 and 3 |
| 1 | Images › Colour extractor | — | — | **DONE.** Stateless; largest phase |
| 2 | Calculators › Daily calorie calculator | — | pref key | **DONE.** `calorie_units` in `preferences`, no migration |
| **A** | **Checkpoint** — full suite green | | | **PASSED** 2026-09-09 |
| 3 | Napkin Math › export calculation as image | — | — | Extends an existing tool |
| 4 | Hardening + release | — | — | Docs sweep, payload, offline, cut 0.5.0 |
| **B** | **Checkpoint** — full suite green, release | | | after 3–4 |

Two new tool pages (one under **Images**, one under **Calculators**), one
extended tool, zero migrations. Schema stays **v16** unless Q4 is answered
"yes", in which case it is still a preference key and still no migration.

---

## Checkpoints — how they run

A checkpoint is the only time the *whole* suite runs; phases run the specs
they touched plus the unit suite. At a checkpoint:

1. `npm run build` first — the Playwright suite and `payload.spec.ts` read
   `dist/`. Never rebuild `dist` or start the dev server while `npm test` is
   running; they share the port and the directory.
2. `npm run test:unit` — fast, run first, fails fast.
3. `npm test` — the full Playwright suite including the trust gate
   (`self-verification N/N injected faults detected`).
4. **Subagents, in parallel with step 3, for the passes that do not touch
   `dist/` or the port:** one validating every mermaid block and relative
   link in the docs touched this release; one reading the CHANGELOG stanza
   against the TODO boxes and reporting unticked-but-done or ticked-but-not;
   one re-reading the new specs for isolated-delta assertions that are
   really just "no crash". Their findings are fixed before the checkpoint
   is called passed. What they must **not** do: run any test that builds or
   serves, or edit files under test while the suite runs.
5. A shifting failure set between two runs is flakiness — re-run the failing
   file alone before treating it as a regression.
6. Record the pass on the checkpoint heading below: date, commit, and the
   trust-gate line.

### Checkpoint A — after Phases 0–2 — PASSED 2026-09-09

Gate for Phase 3. Exit criteria: unit + Playwright green; the two new routes
present in `SHELL`, the registry, `a11y.spec.ts`'s route list and the
precache audit; `payload.spec.ts` unchanged in its heavy-chunk assertions
(nothing in 0–2 adds a heavy chunk). All met.

| What | Result |
| --- | --- |
| `npm test` | 513 passed, 0 failed |
| Trust gate | `self-verification 5/5 injected faults detected` |
| `npm run test:unit` | 2,402 passed across 96 files (2,221 before this release) |
| `tools/audit-precache.mjs` | green — 504 files, 22.59 MB, cap 600; 43 HTML routes reached |
| Docs validation | 1,351 relative links resolve, 64 mermaid diagrams parse |

> **What the parallel passes found.** Three of the four were worth the run:
>
> 1. **The Playwright suite caught a crash the browser check missed.** A
>    number-typed `bind:value` hands Svelte a `number`, not a `string`, the
>    moment a field is edited — so the calorie page's parser threw
>    `e.trim is not a function` on the first keystroke. Driving the page by
>    hand never found it because the defaults are seeded as strings and
>    nothing had been typed into.
> 2. **The adversarial review found three real bugs and three risks**, each
>    with a verified failing input: a `\b` boundary that let `stroke-width`
>    answer a lookup for `width` (so an SVG rasterised two pixels wide); a
>    case-insensitive `Edg` test that cleared Edge-on-iOS, the exact WebKit
>    engine the check exists to refuse; a weeks-to-goal estimate that gave a
>    losing plan aimed at a heavier target a confident arrival date; palette
>    entries reporting the lightness and chroma of an out-of-gamut centroid
>    rather than of the clipped colour actually delivered, which flipped
>    colours across the near-grey threshold that decides theme roles; a
>    one-sided extreme-input guard; and a finite input able to produce an
>    infinite plan. All fixed, with regression tests for the two rasteriser
>    bugs.
> 3. **The spec-quality pass found three assertions that proved less than
>    their comments claimed** — a palette test that compared the page to its
>    own earlier output rather than to a literal, a paste test whose only
>    value check was a share both colours happened to have, and a
>    `toBeVisible()` standing where the number itself was the point. All
>    three now assert values derived independently, and the derivation was
>    checked against a control case the suite already passed — which caught
>    a mistake in my own first attempt at it, because `getImageData` returns
>    pixels row-major and seeding k-means from a differently ordered point
>    set lands on different clusters.
> 4. **The registry a11y sweep audits a route's front door, not its rooms.**
>    Both new tools keep most of their controls behind a gate, so the sweep
>    never saw them. Nothing was actually unlabelled, but the guarantee did
>    not hold; both specs now check their own revealed UI, and the limit is
>    written into `a11y.spec.ts`'s own header.
> 5. **Mechanical beats judgement for docs.** Link and mermaid validation is
>    decidable, so it is a script rather than a reviewer — and the first
>    version of that script was itself wrong, flagging every `classDiagram`
>    and `erDiagram` because per-line brace balance only makes sense in a
>    flowchart.

> **Owed to Phase 4, found here:** the documentation for a feature has to be
> written *after* its review lands, or reconciled when it does. Three doc
> passages described the pre-review calorie code — including a paragraph
> explaining a behaviour that had just been fixed as a bug — because the
> writing and the fixing ran concurrently.

### Checkpoint B — after Phases 3–4 — *pending*

Gate for the release. Exit criteria as A, plus: Napkin Math's page weight
unchanged at first paint (the export code is behind a click, and the
rasteriser is a lazy import), the offline walk covering all three features,
and `VERSION` / `package.json` / CHANGELOG dated.

---

## Phase 0 — Groundwork — DONE

**Goal:** the release bookkeeping, the maintenance item, and the three
shared pieces Phases 1 and 3 mount. Little user-visible.

**Scope:**

1. **Open the release.** `VERSION` and [package.json](../../../package.json)
   move to `0.5.0`; a `0.5.0 (unreleased)` stanza opens in
   [CHANGELOG.md](../../../CHANGELOG.md) with the three headings; doc
   banners that name the version move to `v0.5.0 (unreleased; schema v16)`.
2. **Dependency audit** (the TODO's Maintenance item, Q5). `npm outdated`
   captured into the commit message; minors and patches applied in one
   commit with the suite run once after; each available major listed in
   `docs/dev/plans/version-5.md`'s appendix with *applied* / *deferred and
   why*. The `react` 18 / `@types/react` 19 mismatch resolved. Lockfile
   regenerated once, not per package. This is its own commit so a bad
   update is one revert.
3. **`src/components/ThemePreview.svelte`** (decision 4) — the preview
   markup and its styles lifted out of
   [ThemesApp.svelte](../../../src/components/apps/ThemesApp.svelte) into a
   component taking `vars: [string, string][]` and rendering under the same
   `data-testid="th-preview"`. Themes mounts it; its spec must pass
   unchanged, which is the proof the lift was faithful.
4. **`src/lib/img/ingest.ts`** (decision 5) — `imageFromPaste(event)`,
   `imageFromFiles(list)`, `imageFromDrop(event)`, each resolving to
   `{ bitmap: ImageBitmap; name: string; bytes: number; type: string }` or a
   typed refusal (`not-an-image`, `undecodable`, `too-large` above a stated
   cap). Decoding goes through the converter's existing path so SVG, AVIF
   and TIFF work wherever they work today.
5. **`src/lib/raster/svgToPng.ts`** (decision 8) — `svgToPngBlob(svg, {
   scale, background })`: blob URL → `Image` → canvas → `encodeCanvas()`.
   Lazy-imported by consumers; detects WebKit and returns a typed
   `unsupported` result rather than a blank image.

**Data model:** none.

**Tests:** unit — `ingest.ts` refusals table-driven over synthetic
`DataTransfer`-shaped inputs (the decode itself is exercised by Phase 1's
spec against the fixture images); `svgToPng` cannot run under Vitest's Node
env, so its correctness is a Phase 3 Playwright assertion (the PNG decodes,
has the requested dimensions, and is not uniformly one colour). Playwright —
`generators.spec.ts` green on the lifted preview.

**Docs:** [architecture.md](../architecture.md) rows for the three modules;
[testing.md](../testing.md) row for the new unit file; a
`docs/dev/plans/version-5.md` opened as the raw wish-list copy of the TODO
plus the dependency appendix.

**CHANGELOG:** Other (dependency updates; preview extraction).

---

## Phase 1 — Images › Colour extractor — DONE

**Goal:** drop in an image, get its palette, take it out as colours or as a
theme.

**Scope:**

1. **`src/lib/img/palette.ts`** (decision 2) — pure:
    - `samplePixels(bitmap, maxSide)` → `Float32Array` of Oklab triples
      (alpha < 50 % skipped, so a transparent PNG does not report its
      transparency as black);
    - `kmeans(points, k, seed)` → clusters `{ lab, count }` sorted by
      count, k-means++ seeding, converged or capped;
    - `toPalette(clusters)` → `PaletteEntry[]` with `hex`, `rgb`, `hsl`,
      `oklch` strings (the formatters already in `color.ts`), `share` as a
      0–1 fraction, and `onColor` (black/white) for the swatch label;
    - `suggestRoles(palette)` → a `ThemeInput` (decision 3): most-populous
      low-chroma colour → `base`, highest-chroma → `accent`, most-populous
      chromatic → `primary`, next → `secondary`, mid-lightness neutral →
      `neutral`; ties broken deterministically.
2. **UI** — `src/components/apps/ColorExtractorApp.svelte`, route
   `/tools/color-extractor/`:
    - **input:** file picker, drop zone, and paste anywhere on the page
      (`window` `paste` listener mounted while the page is open, removed on
      destroy), all through `ingest.ts`; the image shown scaled with its
      name and dimensions;
    - **count:** a number input 2–16 (default 6) with the palette recomputed
      on change; recompute is synchronous and fast enough not to need a
      spinner, but the last palette stays visible until the new one lands;
    - **palette strip:** one swatch per colour, width proportional to
      `share`, each with its hex on the swatch and a per-colour copy
      button offering hex / rgb / hsl / oklch (the `col-copy-*` shape from
      Themes), plus "copy all" as a newline list and as a CSS custom-property
      block (`--color-1 … --color-n`);
    - **theme export:** a "Use as theme" section with the five role
      pickers pre-filled by `suggestRoles`, each a select over the palette,
      feeding `buildTheme()`; the shared `ThemePreview` below it; copy and
      download of the CSS exactly as Themes offers; an "Open in Themes"
      link carrying the five hex values as URL params so the harmony and
      spacing controls are one click away (Q3);
    - warnings from `buildTheme()` (contrast) surfaced as Themes surfaces
      them.
3. **Registry:** `color-extractor` under **Images**, aliases `palette`,
   `colours`, `colors from image`, `dominant color`; icon in `icons.ts`;
   route in `SHELL`; cache bump.

**Data model:** none (decision 1).

**Tests:** unit — `kmeans` on synthetic point sets (three well-separated
blobs → three clusters with the right centroids and counts; k larger than
distinct colours → empty clusters dropped, not reported as black; same seed
→ identical result; alpha skipping); `suggestRoles` on hand-built palettes
(a photo-like set, a two-colour logo, an all-grey image where `accent`
falls back to the least-grey entry). Playwright — upload a fixture PNG and
assert the swatch count equals the requested k, change k and assert the
strip re-renders, per-swatch copy reads back the hex through the clipboard
helper, the theme CSS contains `--primary:` and the preview mounts, **zero
IndexedDB writes across the whole flow**; the registry sweep in
`a11y.spec.ts` picks the route up and every control is named.

**Docs:** `docs/dev/tools/color-extractor.md` — mermaid flowchart *image →
ingest → sample → k-means → palette → (copy | buildTheme → preview/CSS)*
with each node linked to the function that implements it; the "why Oklab,
why k-means" paragraph from decision 2; Known limits (stateless, k ≤ 16,
transparent pixels skipped). `docs/user/color-extractor.md` — leads with:
paste works anywhere on the page, the counts are a request not a promise
(a two-colour logo asked for eight gives you eight shades of two), and the
theme export is the same file Themes makes.

**CHANGELOG:** Features.

---

## Phase 2 — Calculators › Daily calorie calculator — DONE

**Goal:** plan a daily intake from body measurements, activity, and a
gain/lose/maintain goal, with the arithmetic shown.

**Scope:**

1. **`src/lib/calc/calories.ts`** (decision 9) — pure:
    - `bmr(input, equation)` for Mifflin–St Jeor, revised Harris–Benedict,
      Katch–McArdle (the last requires `bodyFatPct` and is refused without
      it, with the reason);
    - `tdee(bmr, activity)` over the five standard multipliers, each with
      its one-line description;
    - `plan(tdee, goal)` → daily target, weekly change in the chosen units,
      the deficit/surplus per day, and an estimated weeks-to-goal when a
      target weight is given; `warnings[]` for below-BMR, below the common
      floors, or a rate above ~1 % of body weight per week — worded as
      cautions, never blocking (usability first);
    - unit conversion helpers (kg⇄lb, cm⇄ft/in) kept here so the UI holds
      only one internal representation (metric) and converts at the edge;
    - a `steps[]` explanation array — each step a label, the formula with
      values substituted, and the intermediate result — so the page can
      show its working the way the programming calculator shows a trace.
2. **UI** — `src/components/apps/CalorieCalculatorApp.svelte`, route
   `/tools/calories/`: units toggle (persisted), sex / age / height / weight
   (feet-and-inches as two fields in imperial), body-fat % optional,
   activity as a labelled select, equation as a select with the sentence,
   goal as maintain / lose / gain with a rate slider in the chosen units
   and an optional target weight; results card with BMR, TDEE, daily
   target, and the working expanded below; warnings styled with the
   existing warning token.
3. **Preference:** `calorie_units: 'metric' | 'imperial'` in the
   `preferences` singleton via `putSingleton`, written **only when the
   toggle is changed**, never on load; added to the `TABLES` mirror and the
   README Tables section.
4. **Registry:** `calories` under **Calculators**, aliases `tdee`, `bmr`,
   `diet`, `calorie`; icon; `SHELL`; cache bump.

**Data model:** one preference key, no migration (standing checklist 1.1).

**Tests:** unit — each equation against published worked examples (a
70 kg / 175 cm / 30 y male and female under Mifflin–St Jeor land on the
textbook figures ± 1 kcal), unit round-trips (`lb → kg → lb` stable to
0.01), every warning trigger, `plan()` arithmetic including the weeks
estimate, Katch–McArdle refused without body fat. Playwright — the page
loads with **zero writes**; filling the form produces the expected TDEE;
flipping units writes **exactly one** `preferences` patch (isolated delta
through the oracle) and reload restores the toggle without writing; the
warning appears when the rate is pushed past the caution line; the backup
round trip in `data.spec.ts` carries the key.

**Docs:** `docs/dev/tools/calculators.md` gains a section with a mermaid
flowchart *inputs → BMR (equation) → TDEE (activity) → plan (goal) →
warnings* linked to the functions, and a table of the three equations with
their formulas. `docs/user/calculators.md` gains the page, leading with: it
is an estimate from population equations, the warnings are cautions not
rules, and which equation to pick when.

**CHANGELOG:** Features.

---

## Checkpoint A runs here. See *Checkpoints — how they run*.

---

## Phase 3 — Napkin Math › export the calculation as an image

**Goal:** a saved calculation becomes a picture — the formula, the formula
with the values in, and the result — as SVG or PNG, previewed before saving.

**Scope:**

1. **`src/lib/napkin/substitute.ts`** (decision 7) —
   `substitutedLatex(parsed, values, format)`: the boxed expression from
   `parseFormula` with `subs()` applied and `.latex` read back, on a
   non-canonical parse so the author's layout survives (a canonical form
   reorders terms, which is not what "my formula with numbers in" means);
   numeric leaves formatted through the page's existing precision setting.
   Unit-tested against the engine, which is already lazily loaded in tests
   that need it.
2. **`src/lib/napkin/exportImage.ts`** — `buildCalculationSvg(rows, opts)`
   (decision 8): three rows rendered via `renderFormula(latex, { embedFonts:
   true })` from [formulaMarkup.ts](../../../src/lib/codegen/formulaMarkup.ts),
   the merged CSS and the embedded faces placed once in a `<style>`, each
   row a `<foreignObject>` sized from a measurement pass in a detached
   shadow root (the probe `collectFaces` already uses); options: which rows
   (Q2), theme (light / dark using the app's tokens, resolved to literal
   colours because an SVG file has no `:root`), padding, title (the
   template name) on or off. Output is a self-contained SVG string with no
   external references — which is the property that lets it rasterise.
3. **UI** in [NapkinMathApp.svelte](../../../src/components/apps/NapkinMathApp.svelte):
   an **Export image** button beside the existing export targets that opens
   a dialog with the options above and a **live preview** (the SVG mounted
   inline, re-rendered on option change), and two actions: **Download SVG**
   (`downloadText`, `image/svg+xml`) and **Download PNG** at 1×/2×/3× via
   the lazy `svgToPng` (`downloadBlob`), plus **Copy PNG** through the
   existing `copyPng`. On WebKit the PNG actions are replaced by one line
   saying why and pointing at the SVG.
4. **Payload:** `exportImage.ts` and `svgToPng.ts` are behind the button's
   click (`import()`), and `payload.spec.ts` asserts Napkin Math's first
   paint does not grow. The embedded fonts make a single SVG ~100–300 KB
   (only the faces used are embedded); the user page says so.

**Data model:** none. The export reads the current calculation and writes
nothing.

**Tests:** unit — `substitutedLatex` on formulas with a variable inside
`\text{}` and `\sqrt{}` (the string-replacement traps), a formula where a
value is negative (parenthesised, not `a--b`), number formatting; SVG
builder produces well-formed XML (parsed back with `DOMParser` in the
Playwright run, `escapeXml` cases in Vitest), no `http`/`url(` references
survive in the output. Playwright — open a seeded calculation, open the
dialog, the preview contains three `<foreignObject>`s, toggle the middle
row off and it contains two, Download SVG yields a file whose text contains
the template name and a `@font-face`, Download PNG yields a blob that
decodes to the expected width × scale and is not a single colour; **zero
writes** for the whole flow.

**Docs:** [napkin-math.md](../tools/napkin-math.md) (dev) gains a section
with a mermaid sequence diagram *App → substitute → renderFormula →
buildCalculationSvg → (download | svgToPng → encodeCanvas → download)* (no
semicolons in messages) and links to every function; Known limits: WebKit
PNG. [napkin-math.md](../../user/napkin-math.md) gains the page, leading
with: the SVG is the faithful file, the PNG is a picture of it, and the
file is bigger than you expect because the fonts travel inside it.

**CHANGELOG:** Features. Note that this is MathLive typesetting (Q1).

---

## Phase 4 — Hardening and release

**Goal:** the cross-cutting passes, then cut 0.5.0.

**Scope:**

1. **Payload pass:** `payload.spec.ts` re-run with the real chunk names for
   anything new; `exportImage`/`svgToPng` confirmed lazy; `palette.ts` and
   `calories.ts` confirmed small enough to be eager.
2. **Offline audit:** fresh install → airplane mode → all three features
   work end to end (the extractor and calculator are pure; Napkin Math's
   export needs MathLive and the font bucket, both already precached — the
   spec in `offline.spec.ts` gains the three cases); `tools/audit-precache.mjs`
   green.
3. **Accessibility, at the level checklist item 5 sets:** the registry sweep
   green on the two new routes and the extended one; new text-on-colour
   (swatch labels via `onColor`, the calorie warnings) pass the token
   contrast check in both themes. No further hand pass required.
4. **Docs:** README "What's in it" and Tables sections (the preference key),
   the docs map, `architecture.md` cache/schema literals (`v38` → whatever
   the bumps landed on; schema stays v16), the three new/extended tool pages
   re-read as a set; mermaid and links validated mechanically.
5. **TODO hygiene:** every box in [TODO](TODO) ticked or explicitly moved to
   *Deliberately out of scope* below, and the *For human* section filled
   with what needs eyes: the Safari PNG behaviour if a Safari device is to
   hand, the calorie figures sanity-checked against one external calculator,
   and one real photo through the extractor at k = 4, 8, 16.
6. **Release:** date the `0.5.0` heading, note in the upgrade blockquote
   that **no migration runs** this time (the first release since 0.2 to say
   so — worth saying), and record the fresh-install airplane-mode walk on a
   real device, still owed from 0.4.0.

**Data model:** none.

**Tests:** Checkpoint B — `npm test` and `npm run test:unit` fully green,
trust gate reading `self-verification N/N injected faults detected`.

**CHANGELOG:** Other, plus the release itself.

---

## Checkpoint B runs here, then the release.

---

## Ordering

- **Phase 0 blocks 1** (ThemePreview, ingest) **and 3** (svgToPng).
- **Phases 1 and 2 are independent** of each other and of 3; Phase 2 only
  needs the version bump from Phase 0.
- **Checkpoint A gates Phase 3**, by construction rather than necessity:
  Phase 3 is the one that touches a shipped, persisted tool, and it should
  start from a green tree.
- **Phase 4 is last; Checkpoint B is the release gate.**

Suggested order for one person: 0 → 2 → 1 → A → 3 → 4 → B. Phase 2 before
1 because it is the smaller and the more self-contained — it gets a
releasable feature landed early and exercises the preference-key checklist
path before the larger phase. If two agents are working, Phases 1 and 2 do
not touch the same files and can run in parallel after Phase 0; keep new
work in new files and re-check `git log` after any pause, since a
concurrent session may have committed work-in-progress under its own
message.

---

## Deliberately out of scope for 0.5.0

- **Saved palettes** (decision 1) — a store away if wanted; no migration
  this release.
- **A Safari-specific PNG pipeline** (decision 8) — the SVG is the faithful
  file; the PNG button says why on WebKit.
- **MathJax as a dependency** (Q1) — MathLive already draws the same glyphs.
- **Remembering body measurements** in the calorie calculator (Q4) — a
  privacy line not worth crossing for a ten-second form.
- **Body-composition extras** (macros split, meal planning, BMI charts) —
  the TODO asks for calorie needs by goal; macros are a plausible later
  section on the same page.
- **Adopting `ingest.ts` in the existing image tools** (decision 5) — the
  helper is built to be adopted; the adoption is its own small change per
  tool and none of them is in the TODO.
- **Dependency majors that need code changes** (Q5) — listed with a verdict
  in the version-5 appendix, applied only where free.
