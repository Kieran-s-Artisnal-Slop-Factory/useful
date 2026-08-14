# 0.1.0 (Unreleased)

- Initial release: data model created (`preferences`) and project generated with [local-sync-template](https://github.com/Descent098/local-sync-template).

## Features

- App shell: collapsible sidebar (grouped by category, collapse state persisted, off-canvas drawer with hamburger below 64rem) replaces the flat navbar; existing Settings and Preferences pages retained.
- Quick-action palette: `ctrl+k` / `cmd+k` (plus a visible header search button for touch) with fuzzy search, full keyboard navigation, focus trap, and focus restore.
- Tool registry (`src/lib/registry.ts`): single source of truth (name, aliases, category, route, icon) driving the sidebar, the home screen tiles, and the palette — adding a tool there is all future phases need for navigation and search.

## Bug Fixes

- The Playwright suite could never run under Astro 7: `astro preview` daemonizes itself when stdin is not a TTY, so Playwright's webServer saw the process exit and aborted every run. Replaced with a dependency-free foreground static server (`tools/preview-server.mjs`).
- The test hook 404'd in production builds: the layout's unbundled inline script dynamically imported `../lib/testHook.ts`, which resolves against the page URL and does not exist in `dist/`. The loader is now a bundled module script (`installTestHookIfEnabled` in `src/lib/testMode.ts`); the hook chunk is still only fetched when test mode is enabled.
- The shipped v1 migration iterated the live `STORES` map, so appending any store-creating migration would have crashed fresh installs (`ConstraintError`: store created twice). v1 is frozen to literals, and every future migration must guard with `objectStoreNames.contains()` (convention documented in `src/lib/db/db.ts`; v2 now guards too).
- Astro's ClientRouter wipes `<html>` attributes on every client-side navigation, silently reverting the pinned theme and the sidebar collapse. The layout's pre-paint script now re-applies both on `astro:after-swap` (regression-tested with a client-side navigation, not just full reloads).
- `put`/`bulkPut` stamped `field_updated_at` entries for sync bookkeeping keys (`updated_at`, `deleted_at`) on field-merged stores; stamps are now limited to domain fields, and `putSingleton` explicitly stamps `deleted_at` when it revives a tombstone.

## Other

- View transitions: Astro `<ClientRouter />` in the shared layout; the chrome island is persisted across navigations and tracks the active page via `astro:page-load`.
- `preferences` is now flagged `singleton` + `fieldMerge` in both `src/lib/db/types.ts` and the test mirror `tests/local/helpers/schema.ts`; the Preferences page is a read-only view of remembered per-tool defaults (writes go through `putSingleton` only). No IndexedDB migration needed (flags are app-level metadata).
- Unit test runner added: Vitest via `npm run test:unit`, with tests for the fuzzy matcher and registry; Playwright specs added for sidebar/drawer/palette navigation (including "client-side navigation writes nothing").
- The orphaned-FK sabotage proof now runs against a synthetic schema, so the trust gate exercises all five oracle proofs even while the real schema has no foreign-key tables.
- `package.json` version synced to `VERSION` (0.1.0); README Tables section updated for the `preferences` flags.
- Accessibility hardening from the phase review: the closed mobile drawer leaves the tab order and accessibility tree (`visibility` rides with the transform); `aria-expanded` reflects the actual per-viewport state; the search button keeps an accessible name when its label is visually hidden; the palette handles IME composition, contains focus against stray clicks, announces result counts via a live region, and scrolls the keyboard selection into view; Escape closes one overlay layer at a time; the page behind an open overlay no longer scrolls; media queries use range syntax (no dead zone at fractional zoom); control boundaries use a new `--border-strong-color` token meeting WCAG 1.4.11 (3:1) in both themes.
- `.gitignore` now covers Playwright's `test-results/` and the trust-gate's `tests/local/.results/`.
- `field_updated_at` docs clarified: stamps are written since this phase but per-field merge folding on backup import lands with Phase 1 (tracked in `plan-phases.md`), which is when `preferences` gains its first real fields.

- Refined `docs/dev/plans/plan.md`: fixed numbering/typos, corrected the SVG-editor reference to the `local-sync-template` icon designer's layer panel, recorded product decisions (lazy-downloaded background-removal model, session-only raster image editor, total-light photography equivalence, bundled city→timezone dataset, app-open-only notifications), and added cross-cutting sections for the data model, notifications/permissions, testing, PWA/offline, and accessibility.
- Added `docs/dev/plans/plan-phases.md`: splits the refined plan into 10 shippable phases (0–9) with per-phase scope, data-model/migration changes, test obligations, and a standing checklist encoding the schema/sync/test/CHANGELOG rules from `docs/dev/plans/TODO`.
