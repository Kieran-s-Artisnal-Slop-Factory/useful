# Documentation

Two audiences, two trees. [`dev/`](dev/) explains how the app is built and what
must not break; [`user/`](user/) explains how to use it and what will surprise
you. Both describe the code as it is — when a page and the source disagree, the
source is right and the page is a bug.

_Describes the code as of v0.2.0 (unreleased; schema v7) — verify against source when in doubt._

## For maintainers — [`dev/`](dev/)

Start with [architecture.md](dev/architecture.md): the stack, the runtime
picture, the directory map, and the invariants everything else assumes.

| Page | Covers |
| --- | --- |
| [architecture.md](dev/architecture.md) | The mental model: stack, runtime flow, directory map, non-negotiable invariants, adding a tool |
| [data-layer.md](dev/data-layer.md) | IndexedDB as the source of truth — store map, migrations, `repo` semantics, tombstones, backup export/import |
| [preferences.md](dev/preferences.md) | The preferences singleton: every field, who writes it, the auto-remember rule |
| [app-shell-navigation.md](dev/app-shell-navigation.md) | Layout, sidebar, command palette, the tool registry, view transitions, shared components |
| [design-system.md](dev/design-system.md) | The blueprint tokens, light/dark mechanics, utility classes, icons, contrast rules |
| [service-worker-and-offline.md](dev/service-worker-and-offline.md) | Precache vs runtime cache vs lazy bundles, cache versioning, "download everything" |
| [notification-engine.md](dev/notification-engine.md) | The always-mounted alarm island, what can and cannot fire, missed completions |
| [testing.md](dev/testing.md) | The two suites, the oracle, the trust gate, the test hook, per-spec coverage |
| [build-and-tooling.md](dev/build-and-tooling.md) | Commands, the `tools/*.mjs` generators, dependency policy, deployment, release checklist |

Per tool, under [`dev/tools/`](dev/tools/):
[time](dev/tools/time.md) ·
[scheduler](dev/tools/scheduler.md) ·
[calculators](dev/tools/calculators.md) ·
[generators](dev/tools/generators.md) ·
[image tools](dev/tools/image-tools.md) ·
[background remover](dev/tools/background-remover.md) ·
[SVG editor](dev/tools/svg-editor.md) ·
[image editor](dev/tools/image-editor.md) ·
[sprite editor](dev/tools/sprite-editor.md) ·
[secrets](dev/tools/secrets.md) ·
[logo generator](dev/tools/logo-generator.md) ·
[SQL playground](dev/tools/sql-playground.md)

## For users — [`user/`](user/)

Every page ends in **Gotchas** — the surprising behaviour and the data-safety
facts. [Getting started](user/getting-started.md) first if you have never opened
the app.

| Page | Covers |
| --- | --- |
| [getting-started.md](user/getting-started.md) | What the app is, getting around, light/dark, where your data lives |
| [install-and-offline.md](user/install-and-offline.md) | Installing it, what works offline, the one-time downloads |
| [settings-backup-preferences.md](user/settings-backup-preferences.md) | Backups (the only copy of your data), and what the app remembers |
| [time.md](user/time.md) | Timers, stopwatch, timezone conversion |
| [scheduler.md](user/scheduler.md) | Events and TODOs across list, board and calendar |
| [calculators.md](user/calculators.md) | Number bases, photography equivalence, file-transfer times |
| [generators.md](user/generators.md) | Themes and colours, gradients, glassmorphism, regex, QR |
| [secrets.md](user/secrets.md) | Passwords, keys, tokens and identifiers |
| [logo-generator.md](user/logo-generator.md) | Seeded avatars, identicons, and icon or emoji badges |
| [images.md](user/images.md) | Converter, resizer, compressor, background remover |
| [svg-editor.md](user/svg-editor.md) | The layered vector editor |
| [image-editor.md](user/image-editor.md) | The layered raster editor (session-only — read the gotchas) |
| [sprite-editor.md](user/sprite-editor.md) | Pixel art on a character grid |
| [sql-playground.md](user/sql-playground.md) | Real SQLite and Postgres in the tab |

## Plans

[`dev/plans/`](dev/plans/) holds the planning documents rather than descriptions
of the code: [plan.md](dev/plans/plan.md) and
[plan-phases.md](dev/plans/plan-phases.md) are the 0.1.0 product plan and its
phase list, [version-2.md](dev/plans/version-2.md) is the 0.2.0 plan, and
[TODO](dev/plans/TODO) is the raw wish list they came from. They record intent at
a point in time and are not maintained against the code.

## Keeping these honest

A change is not finished while its documentation describes the old behaviour —
new tools get a page in each tree, changed tools edit the existing pages, and
schema changes update [data-layer.md](dev/data-layer.md) along with the README's
Tables section. The standing checklist in
[version-2.md](dev/plans/version-2.md) states it as a release gate.
