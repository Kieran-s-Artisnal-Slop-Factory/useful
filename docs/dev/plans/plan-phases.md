# useful — Implementation Phases

This file splits [plan.md](plan.md) into independently shippable phases. Section references (§) point at plan.md. Phases are ordered so foundations land first and each phase can cut a release on its own; within that constraint, later phases are largely independent of each other.

## Standing checklist — applies to EVERY phase

From `docs/dev/plans/TODO`; a phase is not done until all of these hold:

1. **If the data model changed:**
    1. All three schema files moved in lockstep: `src/lib/db/types.ts`, an **appended, `contains()`-guarded** migration in `src/lib/db/db.ts`, and the `TABLES` mirror in `tests/local/helpers/schema.ts` (plus the Tables section of `README.md`).
    2. No sync regressions: every write goes through `repo.ts` (`patch()` for edits, `putSingleton` for singletons), rows stay JSON-native, page load writes nothing. The generic data-integrity suite (`npm test`) is green including the trust gate.
    3. The new store is covered by backup export/import automatically (verify the round-trip test picked it up).
2. **Tests:** pure logic has Vitest unit tests; anything touching UI + data layer has Playwright specs driving the real UI and asserting isolated deltas via the oracle. Both suites pass.
3. **CHANGELOG.md:** entries added under the current unreleased version's `Features` / `Bug Fixes` / `Other` headings. If the newest version already has a release date, bump `VERSION` (schema change ⇒ at least minor) and open a new `x.y.z (unreleased)` heading. Note the DB version whenever a migration ships.
4. **PWA:** new pages added to `SHELL` in `public/sw.js` + `CACHE_NAME` bumped; new tools registered in the tool registry (sidebar + ctrl+k pick them up automatically); links built with `href()` from `src/lib/paths.ts`.
5. **Accessibility:** keyboard operability and AA contrast for anything new; permission/capability fallbacks per plan §Notifications & permissions.

---

## Phase 0 — Foundation & app shell

**Goal:** the navigation/search/transition skeleton every tool plugs into, plus the data-layer groundwork that later migrations depend on.

**Scope (plan §6, §Technical details 3–5, §Data model, §Testing):**

1. Tool registry module (`src/lib/registry.ts`): name, aliases, category, route, icon — single source of truth for sidebar + palette.
2. Collapsible sidebar layout (replaces the flat navbar): categories from the registry, collapse state persisted, off-canvas drawer + hamburger below the breakpoint, Settings and Preferences pages retained (Backup stays a section of Settings, not its own route). Usable at 360px.
3. Quick-action panel: `ctrl+k` / `cmd+k` + header search button, fuzzy matching over the registry, full keyboard navigation + focus management.
4. View transitions: Astro `<ClientRouter />` in the shared layout; verify the SW-registration and theme scripts still behave under `astro:page-load`.
5. Data-layer groundwork (migration hygiene, **before** any new store ships):
    1. Adopt the `contains()`-guard convention for all future migrations (the shipped v1 iterates the live `STORES` map — unguarded later `createObjectStore` calls crash fresh installs).
    2. Flag `preferences` as `singleton: true` + `fieldMerge: true` in `types.ts` and the `TABLES` mirror, and route its writes through `getSingleton`/`putSingleton`.
6. Tooling: add Vitest + `npm run test:unit`; sync `package.json` version to `VERSION` (0.1.0).

**Data model:** no new stores; `preferences` flag change only (mirrored in both schema files).

**Tests:** unit — registry fuzzy matcher; Playwright — sidebar/palette navigation smoke (open palette, type, navigate), palette focus trap, page loads write nothing (generic suite must stay green after the layout swap).

**CHANGELOG:** Features (sidebar, quick-action panel), Other (view transitions, Vitest, migration-guard convention, version sync).

---

## Phase 1 — Time

**Goal:** timers, stopwatch, timezone conversion — and the notification engine every later phase reuses.

**Scope (plan §1, §Notifications & permissions):**

1. Timers (§1.1): CRUD with label + markdown description (rendered through a shared `marked`+`DOMPurify` module built in this phase, per plan Technical details 8), multiple concurrent, absolute `end_at` model, pause/resume, finished-as-preset, completion actions (sound/vibrate/notify) with defaults auto-filled from `preferences`.
2. Notification engine: always-mounted island in the layout with `transition:persist`; fires sound/vibration/`registration.showNotification()` while any app window is open; missed-completion surfacing on load; in-context permission request; vibration feature-detection; AudioContext resumed from the enabling gesture.
3. Stopwatch (§1.3): singleton, laps, persisted across reload/navigation, action-only writes.
4. Timezone conversion (§1.2): two-zone converter via `Intl`, fuzzy IANA zone search, bundled GeoNames city→timezone dataset as a lazy chunk with a "download for offline" affordance, "use my current timezone", last-used pair remembered in preferences.
5. Per-field merge folding: this phase puts the first real fields on the field-merged `preferences` store, so backup merge-import (`src/lib/db/export.ts`) must learn to fold `FIELD_MERGED_STORES` rows per field (compare `field_updated_at` per key, keep the newer value, union the stamp maps) instead of whole-row LWW — the stamps are written since Phase 0 but nothing consumes them yet (see the note in `src/lib/db/types.ts`). Add merge tests covering two "devices" editing different preference fields.

**Data model:** migration v3 — `timers` (multi-row) + `stopwatch` (singleton), shapes per plan §Data model; `preferences` gains timer-default + last-zone-pair fields.

**Tests:** unit — duration/format helpers, timezone conversion logic, city-lookup search ranking. Playwright — create timer ⇒ exactly one row; "remember defaults" touches only the `preferences` singleton; reload mid-run resumes from `end_at` (no drift, no writes on load); stopwatch lap/pause round-trip; completion fires the configured actions (fake timers/clock).

**CHANGELOG:** Features; note DB v3.

---

## Phase 2 — Scheduler

**Goal:** events + TODOs with calendar/list/kanban views, recurrence, and notifications.

**Scope (plan §2):**

1. Events (§2.1) and TODOs (§2.2) CRUD; markdown via `marked`+`DOMPurify`; priority; fixed three-state workflow; comments as child records.
2. Recurrence (§2.2.7): rule on the todo; completing creates exactly one successor inside the complete action, idempotently; never materialized on render.
3. Views (§2.3): month calendar (events + dated todos), list + kanban toggle, fractional `rank` drag-reorder. Week/day calendar views (plan's nice-to-haves) are deliberately deferred past v1.
4. Notifications (§2.4): reuse the Phase 1 engine; due-time/event-start scheduling; global defaults + per-item toggle.

**Data model:** migration v4 — `events`, `todos` (fieldMerge), `todo_comments` (FK → todos), indexes per plan §Data model; `preferences` gains board-view prefs.

**Tests:** unit — recurrence next-occurrence math (incl. month-end/DST edges), rank-key generation. Playwright — status transition writes only `status`(+`completed_at`) on one row; kanban drag writes only the moved card's `rank`; completing a recurring todo spawns exactly one successor (double-fire idempotent); deleting a todo tombstones it and its comments (FK invariant stays green); comment add/edit isolated; calendar renders without writes.

**CHANGELOG:** Features; note DB v4.

---

## Phase 3 — Calculators

**Goal:** all §4 tools — pure logic, no stores, heavy unit coverage.

**Scope (plan §4):** number conversion (binary/hex/octal/decimal, bit-width selector, two's/one's complement, NOT, explainer drop-downs); photography equivalent-settings + light-stop calculators (total-light equivalence, 1/3-stop snapping, Canon 1.6 option, explainers); file transfer calculator (unit selectors, bits-vs-bytes explicit, optional overhead %).

**Data model:** none (optionally remember last-used sensor format in `preferences`).

**Tests:** unit — conversion/bit-op tables, equivalence and stop math against hand-computed cases (m4/3 vs APS-C ≈ 0.83 stop by crop), transfer-time cases across unit combinations. Playwright — each page renders and computes with zero DB writes; explainer drop-downs accessible by keyboard.

**CHANGELOG:** Features.

---

## Phase 4 — Generators

**Goal:** all §5 tools — stateless.

**Scope (plan §5):** CSS color conversion + picker (any CSS standard format: hex/RGBA/HSL/HWB/Lab/LCH/OKLab/OKLCH/named), gradient generator, glassmorphism generator (live previews, copyable CSS); regex → Go/Rust/JS/Python snippets (escaping, flag mapping, `(?P<name>)` rewrite, RE2-incompatibility warnings); QR creator (text/URL, size + EC level, PNG/SVG export) and reader (upload + camera via `qr-scanner`, in-context permission, upload fallback, decoded links clickable but never auto-opened).

**Data model:** none.

**Tests:** unit — color conversions round-trip (incl. OKLCH), regex construct scanner + per-language escaping, QR payload generation. Playwright — copy/download flows; QR reader decodes a fixture image upload; camera path feature-detected (skip gracefully headless); zero DB writes.

**CHANGELOG:** Features.

---

## Phase 5 — Image converters, resizer, compressor

**Goal:** the stateless file-in/file-out image tools (§3.3, §3.5, §3.6).

**Scope:** conversion matrix exactly as written (SVG/AVIF/WebP/TIFF → PNG/JPG; PNG↔JPG; no WebP/AVIF outputs); `utif2` for TIFF with graceful failure; SVG rasterization size input; JPG quality slider; resizer (dimensions/percent, aspect lock); compressor (quality/dimension cap, before/after sizes); shared download/copy pipeline (clipboard always PNG, labeled).

**Data model:** `preferences` gains converter-quality default fields (mirrored per standing checklist); no new stores.

**Tests:** unit — dimension/quality math, filename/mime mapping. Playwright — convert fixture files of each input type and assert output blob type/dimensions; TIFF failure shows a friendly error; zero DB writes.

**CHANGELOG:** Features.

---

## Phase 6 — SVG editor

**Goal:** the layer-based SVG editor with persistent documents (§3.1).

**Scope:** port + generalize the `local-sync-template` icon-editor seed (`SvgPanel.svelte`, `lib/icon/model.ts`, `lib/icon/build.ts`): arbitrary canvas size, per-layer width/height, on-canvas selection/drag handles, undo/redo; layer kinds incl. pasted SVG, bezier line segments, editable free-form polygons; fill/stroke options; named documents in `svg_documents`; export SVG (download + copy-as-text) and PNG/JPG at chosen size (download + copy-as-PNG).

**Data model:** migration v5 — `svg_documents` (layers as JSON-native structures only).

**Tests:** unit — geometry/path builders (bezier, polygon), SVG composition functions (extend the seed's pure-function pattern), undo/redo stack. Playwright — create → save → reload → layer JSON byte-identical (typed comparator); export performs zero writes; document survives backup round trip (generic suite, once mirrored).

**CHANGELOG:** Features; note DB v5.

---

## Phase 7 — Raster image editor

**Goal:** the session-only layer-based raster editor (§3.2).

**Scope:** import; crop, rotate, eraser, paintbrush, arrows, text layers, darken, lighten, region blur; EXIF view / strip-all / common-JPEG-tag editing (`exifr` read, `piexifjs` write on JPEG export); PNG/JPG export with quality slider; download + copy-as-PNG; explicit UI copy about session-only and which exports carry metadata.

**Data model:** none (session-only by decision — nothing may write to IndexedDB).

**Tests:** unit — transform math (crop/rotate rects), metadata field mapping. Playwright — import fixture → edit → export produces expected dimensions; exported JPEG's edited EXIF verified by re-parsing the blob; strip-all verified; the entire editor session performs **zero DB writes**.

**CHANGELOG:** Features.

---

## Phase 8 — Background remover

**Goal:** client-side ML background removal with the lazy-download model pattern (§3.4).

**Scope:** pick and license-verify a permissively licensed segmentation model; self-host model + runtime; "Download model (~30MB) for offline use" state with progress; SW runtime-caching of model assets (excluded from precache); removal pipeline with preview + export via the shared pipeline; manual-eraser fallback link.

**Data model:** none.

**Tests:** unit — pipeline glue with a mocked runtime (pre/post-processing, mask application on a tiny fixture). Playwright — tool communicates the not-yet-downloaded state; after (stubbed or real small) model load, produces an output image; offline behavior of the cached state.

**CHANGELOG:** Features.

---

## Phase 9 — Hardening & release

**Goal:** cross-cutting quality gates and a cut release.

**Scope:** accessibility sweep (AA contrast both themes, keyboard paths incl. kanban + palette, live regions); offline audit (fresh install → airplane mode → everything works except undownloaded lazy assets); performance pass (lazy chunks verified for heavy tools, precache size sanity); docs (README Tables + feature overview refresh); verify VERSION/CHANGELOG per the standing checklist and cut the release (date the CHANGELOG heading).

**Data model:** none.

**Tests:** full suites green (`npm test`, `npm run test:unit`); trust gate green; manual offline + install checklist recorded in the PR/commit.

**CHANGELOG:** Other (plus the release itself).

---

## Dependency notes

- Phase 0 blocks everything (registry/sidebar/palette/Vitest/migration hygiene).
- Phase 2 depends on Phase 1's notification engine.
- Phases 3, 4, 5 are mutually independent and can happen in any order after Phase 0.
- The sanitized-markdown renderer (`marked`+`DOMPurify`) is built in Phase 1 and reused by Phase 2.
- Phase 7's export/copy pipeline is shared with Phase 5 and 6 — build it once (first phase to need it) in `src/lib/`.
- Phase 8's manual-eraser fallback links to Phase 7's editor — land it after Phase 7 (also the heaviest asset, least-core feature).
- Phase 9 is last.
