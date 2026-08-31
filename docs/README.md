# Documentation

Two audiences, two trees. [`dev/`](dev/) explains how the app is built and what
must not break; [`user/`](user/) explains how to use it and what will surprise
you. Both describe the code as it is — when a page and the source disagree, the
source is right and the page is a bug.

_Describes the code as of v0.4.0 (unreleased; schema v14) — verify against source when in doubt._

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
[text tools](dev/tools/text-tools.md) ·
[generators](dev/tools/generators.md) ·
[image tools](dev/tools/image-tools.md) ·
[base64](dev/tools/base64.md) ·
[background remover](dev/tools/background-remover.md) ·
[SVG editor](dev/tools/svg-editor.md) ·
[image editor](dev/tools/image-editor.md) ·
[sprite editor](dev/tools/sprite-editor.md) ·
[secrets](dev/tools/secrets.md) ·
[hashing](dev/tools/hashing.md) ·
[encryption](dev/tools/encryption.md) ·
[JWT](dev/tools/jwt.md) ·
[ASCII art](dev/tools/ascii-art.md) ·
[file tree](dev/tools/file-tree.md) ·
[crontab](dev/tools/crontab.md) ·
[placeholders](dev/tools/placeholders.md) ·
[Docker Compose](dev/tools/docker-compose.md) ·
[logo generator](dev/tools/logo-generator.md) ·
[napkin math](dev/tools/napkin-math.md) ·
[SQL playground](dev/tools/sql-playground.md) ·
[config playground](dev/tools/config-playground.md) ·
[web playground](dev/tools/web-playground.md) ·
[HTTP playground](dev/tools/http-playground.md) ·
[notebook](dev/tools/notebook.md)

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
| [text-tools.md](user/text-tools.md) | Diff, Similarity and Text analysis — compare, score and count text |
| [generators.md](user/generators.md) | Themes and colours, gradients, glassmorphism, regex, QR |
| [secrets.md](user/secrets.md) | Passwords, keys, tokens and identifiers |
| [hashing.md](user/hashing.md) | MD5, SHA-1, SHA-2, SHA-3, SHAKE, HMAC, salt and pepper |
| [encryption.md](user/encryption.md) | AES with a password, RSA keys, key agreement, bcrypt, one-time pad |
| [jwt.md](user/jwt.md) | Decode, verify and sign JSON Web Tokens |
| [ascii-art.md](user/ascii-art.md) | A picture as characters, or words as a FIGlet banner |
| [file-tree.md](user/file-tree.md) | Draw a directory tree, or read one back from a listing |
| [crontab.md](user/crontab.md) | Read and build cron expressions, and where the line goes |
| [placeholders.md](user/placeholders.md) | Filler text and seeded filler images, drawn on your device |
| [docker-compose.md](user/docker-compose.md) | Build a compose.yaml, with templates and the warnings that matter |
| [logo-generator.md](user/logo-generator.md) | Seeded avatars, identicons, and icon or emoji badges |
| [napkin-math.md](user/napkin-math.md) | Formulas that document themselves, with code you can take away |
| [images.md](user/images.md) | Converter, resizer, compressor, background remover |
| [base64.md](user/base64.md) | Text and images in and out of base64, and data URLs |
| [svg-editor.md](user/svg-editor.md) | The layered vector editor |
| [image-editor.md](user/image-editor.md) | The layered raster editor (session-only — read the gotchas) |
| [sprite-editor.md](user/sprite-editor.md) | Pixel art on a character grid |
| [sql-playground.md](user/sql-playground.md) | Real SQLite and Postgres in the tab |
| [config-playground.md](user/config-playground.md) | JSON and YAML: validate, prettify, extract a schema, convert between formats, generate samples and code |
| [web-playground.md](user/web-playground.md) | HTML, CSS and JavaScript with a live preview, a console, and saved sessions |
| [http-playground.md](user/http-playground.md) | Build a request, send it, read the answer — and why CORS will refuse most of them |
| [notebook.md](user/notebook.md) | Linked markdown notes — WYSIWYG or source, footnotes, diagrams, drawings, export to Markdown, HTML and PDF |

## Plans

[`dev/plans/`](dev/plans/) holds the planning documents rather than descriptions
of the code: [plan.md](dev/plans/plan.md) and
[plan-phases.md](dev/plans/plan-phases.md) are the 0.1.0 product plan and its
phase list, [version-2.md](dev/plans/version-2.md) is the 0.2.0 plan,
[version-3.md](dev/plans/version-3.md) is the raw 0.3.0 wish list and
[version-3-phased.md](dev/plans/version-3-phased.md) the reviewed, phased
version of it, [version-4.md](dev/plans/version-4.md) and
[version-4-phased.md](dev/plans/version-4-phased.md) the same pair for 0.4.0,
and [TODO](dev/plans/TODO) is the running work list they all came from. They record intent at a point in time and are not maintained against
the code.

## Keeping these honest

A change is not finished while its documentation describes the old behaviour —
new tools get a page in each tree, changed tools edit the existing pages, and
schema changes update [data-layer.md](dev/data-layer.md) along with the README's
Tables section. The standing checklist in
[version-2.md](dev/plans/version-2.md) states it as a release gate.
