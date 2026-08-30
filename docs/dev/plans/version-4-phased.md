# useful — Version 0.4.0 plan (phased)

What 0.4.0 adds, split into phases that can each cut a release on their own.
The feature list comes from [version-4.md](version-4.md), which stays as the
raw wish-list; this file is the reviewed version of it — the same features with
the technology chosen, the impossible parts named, and the order they can be
built in. Where the two disagree, this file is the later thought.

Written 2026-08-29 against the shipped 0.3.0 code: schema **v13**, `CACHE_NAME`
**`useful-cache-v33`**, 37 registered tools across nine categories, `VERSION`
and `package.json` both reading `0.3.0`, and no unreleased stanza in
`CHANGELOG.md` — opening one is Phase 0 work this time, not a leftover from
planning.

This is a small list with one very large item in it. The HTTP playground is
most of the release by weight, and it is also the first tool in this app that
*talks to the network on purpose* — which is why the decisions section below
is longer than the feature list deserves at first glance.

> **Progress:** phases are marked DONE in the overview table and on their own
> heading as they land. Everything else is still plan.

---

## Standing checklist — applies to EVERY phase

Inherited from [version-3-phased.md](version-3-phased.md), unchanged in
substance and repeated here so a phase can be worked from this file alone:

1. **If the data model changed:**
    1. All three schema files move in lockstep: [types.ts](../../../src/lib/db/types.ts),
       an **appended, `contains()`-guarded** migration in
       [db.ts](../../../src/lib/db/db.ts), and the `TABLES` mirror in
       [schema.ts](../../../tests/local/helpers/schema.ts) (plus the Tables
       section of [README.md](../../../README.md)).
    2. No sync regressions: every write goes through
       [repo.ts](../../../src/lib/db/repo.ts) (`patch()` for edits,
       `putSingleton` for singletons), rows stay JSON-native, page load writes
       nothing. `npm test` green **including the trust gate**.
    3. The new store rides backup export/import automatically — verify the
       round-trip suite in [data.spec.ts](../../../tests/local/data.spec.ts)
       picked it up through the `TABLES` mirror.
2. **Tests:** pure logic gets Vitest; anything touching UI + data layer gets a
   Playwright spec driving the real UI and asserting isolated deltas through the
   oracle. Both suites pass.
3. **CHANGELOG.md:** entries under the current unreleased version's `Features` /
   `Bug Fixes` / `Other` headings. Note the DB version whenever a migration
   ships.
4. **PWA:** new pages added to `SHELL` in [sw.js](../../../public/sw.js) +
   `CACHE_NAME` bumped; new tools registered in
   [registry.ts](../../../src/lib/registry.ts) with an icon in
   [icons.ts](../../../src/lib/icons.ts); links built with `href()`. Lazy
   chunks a feature depends on offline join the precache or an offline bundle.
5. **Accessibility:** keyboard operability and AA contrast for anything new.
   Registering the tool enrols it in the registry-driven
   [a11y.spec.ts](../../../tests/local/a11y.spec.ts) sweep.
6. **Docs:** every user-visible feature gets its page under [docs/dev/](../)
   and [docs/user/](../../user/). The dev page carries a mermaid diagram for
   anything with more than one moving part; the user page leads with the
   gotchas.

Two additions for this release, because 0.4.0 is the first one where a tool
holds secrets **as a feature** and the first where one calls the network:

7. **Secrets never reach a backup.** The HTTP playground stores secret values
   in a local-only store that is excluded from the export set (the
   `sync_outbox` precedent), saved requests keep their `{{placeholders}}`
   unresolved, and a spec exports a backup while secrets exist and asserts none
   of their bytes appear in it. A backup is one plain JSON file in a downloads
   folder; an API key that reached it would live there forever.
8. **The app still never calls out on its own.** The HTTP playground and the
   opt-in model download send exactly what the user explicitly asked to send,
   when they ask, and nothing else — no telemetry, no proxy, no background
   fetch. Every other page keeps the zero-network property, and
   [payload.spec.ts](../../../tests/local/payload.spec.ts) keeps proving it.

---

## Decisions taken up front

Settled; the phases below assume them. Each records why, because the reasons
are the part that ages.

1. **Hand-roll the template engine; skip nunjucks.** The TODO says "nunjucks
   or better alternative" — the better alternative is ~200 lines of our own.
   The requirement is *lookup*: `{{name}}`, `{{obj.field}}`, `{{arr[0]}}`,
   nested combinations, resolved against an ordered scope chain. Nunjucks
   brings logic tags, filters, inheritance and autoescaping — power we would
   have to document, sandbox and explain, in ~25 KB, to deliver a feature we
   don't want (a request body is not a place for `{% for %}`). A hand-rolled
   resolver with published error offsets is testable the way the cron parser
   was. If real templating demand appears later, the `{{ }}` syntax is
   nunjucks-compatible, so the swap stays open.
2. **An unresolved variable is an error, not an empty string.** Sending
   `Authorization: Bearer` because `{{token}}` silently resolved to nothing is
   the classic client bug. Rendering names every placeholder it could not
   resolve, with offsets, and the UI blocks send until they exist or the user
   overrides knowingly.
3. **The web playground ports onto this app's plumbing, not alongside it.**
   learn-anywhere's `WebExercise` (713 lines) is the same author, same stack
   (Astro 7 + Svelte 5 runes + CodeMirror 6), MIT, no vendored third-party
   code, no CDNs. The port keeps its logic — srcdoc assembly, console shim,
   tab model — but rides `useful`'s own
   [CodeEditor.svelte](../../../src/components/CodeEditor.svelte), `Card`,
   theme tokens, [zip.ts](../../../src/lib/zip.ts) (not fflate) and
   [repo.ts](../../../src/lib/db/repo.ts) persistence. One editor chassis in
   the app, not two.
4. **The preview iframe gets `sandbox="allow-scripts"` and nothing else.** No
   `allow-same-origin`, ever — the frame runs user code (web playground) or a
   *server's* HTML (HTTP playground), and either one reaching this app's
   IndexedDB would be a real vulnerability, not a theoretical one. The console
   shim talks to the parent over `postMessage` with the source checked. Both
   playgrounds share this one previewer component.
5. **Received files are sniffed, not trusted.** The HTTP response viewer names
   a body's type from its magic bytes through the existing
   [sniff.ts](../../../src/lib/encode/sniff.ts), exactly like the base64 tool
   — a `Content-Type` header is a claim; the bytes are the evidence. Binary
   bodies prompt to download with the sniffed extension and get no viewer, as
   the TODO says.
6. **CORS gets honesty, not a workaround.** There is no desktop build of this
   app, and installing the PWA does not change fetch's rules — an installed
   PWA is still a browser page. So the TODO's "push someone towards
   downloading the app version" cannot ship as written (Q3). What ships: a
   likely-CORS diagnosis when fetch fails opaquely (the browser deliberately
   hides the reason from the page), a plain explanation of what CORS is and
   that the *server* opts in, the mixed-content case (an `https:` app cannot
   call an `http:` API) named separately because it looks identical, and the
   forbidden-header list surfaced at crafting time instead of at failure time.
7. **Response bodies are capped in storage, never in transit.** Multi-step
   flows record every request and response; a 200 MB download recorded into
   IndexedDB would take the backup file with it. Stored bodies are capped
   (default 256 KB) with the truncation stated on the record; the live view
   streams the full body regardless.
8. **The LLM download is opt-in, uncached-by-default, and deletable.** Every
   plausible model is over the TODO's 10 MB line, so the opt-in is
   unconditional: nothing is fetched until an explicit click on a button that
   states the size, the model is stored in its own Cache Storage bucket
   (never in `SHELL`), and the Offline panel lists it with a delete button,
   the same way the font bundles are listed today.
9. **Existing plumbing is reused, not re-grown.** Downloads through
   [exportFile.ts](../../../src/lib/exportFile.ts), archives through
   [zip.ts](../../../src/lib/zip.ts), JSON/highlighting through the CodeMirror
   setup the config playground already carries, tables through
   [DataTable.svelte](../../../src/components/DataTable.svelte), seeded
   randomness through [random.ts](../../../src/lib/random.ts), workers on the
   [bcrypt-worker](../../../src/lib/crypto/bcrypt-worker.ts) request/response
   pattern.

---

## Open questions

Answers change what gets built. Each has a default the phase can proceed on if
nobody answers.

| # | Question | Needed by | Default if unanswered |
|---|----------|-----------|-----------------------|
| Q1 | Secrets: persist values in a local-only store (survives reload, never exported), or keep them in memory only (re-enter every session)? | Phase 4 | **Local-only store** (`http_secrets`, excluded from `STORES` like `sync_outbox`), values masked in the UI, with the storage location stated on the page. Memory-only sounds safer but in practice pushes people to paste keys into the *variables* table, which DOES ride backups — the worse outcome |
| Q2 | Multi-step variable extraction: free-form template paths into recorded responses (`{{steps.auth.response.json.token}}`), or explicit extraction rules (pick a value, name it)? | Phase 5 | **Explicit rules.** A rule is visible, testable, and names its source; a deep template path into a response body couples every later step to a payload shape nobody wrote down |
| Q3 | The TODO's CORS "push towards the app version" — there is no app version. Build a desktop wrapper this release? | Phase 3 | **No.** Ship the honest explainer (decision 6); a Tauri wrapper whose webview fetches without CORS is real work with its own release train, filed under out-of-scope for 0.4.0 |
| Q4 | Which model and runtime for placeholder LLM text? `onnxruntime-web` is already a dependency, but the smallest coherent English generators are ~80 MB+ quantized; below that, output quality drops under what the seeded corpora already produce | Phase 6 | **Prototype first, gate on quality.** Try a distilgpt2-class ONNX model, self-hosted next to the app; if nothing at a tolerable size beats the corpora, the phase ships as a documented "no" — 0.3.0's Q11 already reached that verdict once, and the burden of proof is on the model |
| Q5 | Web playground PNG screenshot export — learn-anywhere does it via a second, *non-sandboxed* iframe plus a new dependency (`modern-screenshot`) | Phase 2 | **Defer.** The zip export covers "get my work out"; a deliberate sandbox exception plus a dependency is a poor trade for a screenshot. Revisit on request |
| Q6 | Web playground Emmet support (`@emmetio/codemirror6-plugin`, MIT, small) | Phase 2 | **Include.** It is the single highest-value editor affordance for HTML/CSS scratch work, and it is already proven in the source being ported |
| Q7 | Saved HTTP requests: one store shared with flows, or separate `http_requests` / `http_flows`? | Phase 4 | **Separate stores.** A request is a reusable atom; a flow references requests by id or inlines a copy. Two small stores beat one polymorphic one — same reasoning as `napkin_templates` / `napkin_calculations` |
| Q8 | Programming calculator: division visualization — restoring long division is the honest algorithm but the step table gets long. Include division, or ship add/sub/mul/shifts first? | Phase 1 | **Include division** (and modulo — they are the same trace). The TODO names it, the trace is capped by bit width, and truncation-toward-zero on signed division is exactly the trap worth visualizing |

---

## Phase overview

| Phase | Goal | New deps | DB | Notes |
|-------|------|----------|----|-------|
| 0 | Groundwork: version bump, template engine, shared previewer | — | — | **DONE.** Unblocks 2, 3, 4 |
| 1 | Programming calculator operation visualizer | — | — | **DONE.** Independent |
| 2 | Web playground (port from learn-anywhere) | `@codemirror/lang-html`, `-css`, `-javascript`, `@emmetio/codemirror6-plugin`; lazy `sucrase` | **v14** | `web_playgrounds` |
| 3 | HTTP playground — request/response core | — | — | Stateless; largest single phase |
| 4 | HTTP playground — environments, variables, secrets | — | **v15** | `http_requests`, `http_environments`, `http_secrets` (local-only) |
| 5 | HTTP playground — multi-step flows | — | **v16** | `http_flows` |
| 6 | Placeholder text via in-browser LLM (opt-in) | TBD per Q4 | — | Severable; may ship as a documented "no" |
| 7 | Hardening + release | — | — | Last |

Two new tool pages (both under the existing **Playgrounds** category), one
extended tool, up to three migrations. Migration numbers assume this order;
the migration list is append-only, so whoever lands a store first takes v14.

---

## Phase 0 — Groundwork — DONE

**Goal:** the release bookkeeping, the template engine Phases 4–5 need, and
the shared previewer Phases 2–3 both mount. Nothing user-visible.

**Scope:**

1. **Open the release.** `VERSION` and [package.json](../../../package.json)
   move to `0.4.0`; a `0.4.0 (unreleased)` stanza opens in
   [CHANGELOG.md](../../../CHANGELOG.md) so every phase has somewhere to
   write; doc banners move to `v0.4.0 (unreleased; schema v13)` and advance as
   migrations land.
2. **Doc drift found while planning:**
   [config-playground.md](../tools/config-playground.md) still names
   `useful-cache-v16`; the shipped cache is v33. Sweep the docs for stale
   cache/schema literals while the number is in hand.
3. **`src/lib/template/engine.ts`** (decision 1) — `render(template, scopes)`
   and `lint(template)`:
    - `{{name}}`, `{{obj.field}}`, `{{arr[0]}}`, `{{obj.list[2].name}}`, with
      whitespace tolerated inside the braces;
    - scopes are an ordered array, first hit wins — the caller passes
      step → environment → global and the engine stays ignorant of what a
      scope *is*;
    - non-string values: strings interpolate verbatim, numbers/booleans via
      `String()`, objects/arrays refused with the reason (a request URL is not
      a place for `[object Object]`);
    - every failure carries the character offset and the placeholder text —
      unclosed `{{`, empty `{{}}`, an unresolvable name, an index into a
      non-array (decision 2);
    - `lint()` returns the referenced names without rendering, which is what
      lets the UI show "this request needs `token`, `base_url`" and mark which
      are missing *before* send;
    - `\{{` escapes a literal `{{`, documented, because JSON bodies about
      templating engines exist.
4. **`src/components/SandboxedPreview.svelte`** (decision 4) — the one iframe
   previewer both playgrounds mount: `sandbox="allow-scripts"`, `srcdoc`
   assembly with the close-tag escape guard, the console shim
   (`postMessage`, source-checked, capped at the last 50 messages), and a
   destroy path that actually drops the frame. Ported from learn-anywhere's
   `WebExercise` internals; the two consumers configure it rather than fork
   it.

**Data model:** none.

**Tests:** unit — the engine table-driven over every syntax form, every error
with its offset, scope precedence (the same name in two scopes), the escape,
non-string values, and `lint()` on a template that also fails to render.
Previewer logic that is pure (document assembly, shim string, escape guard)
unit-tested now; the mounted behaviour is exercised by Phases 2–3's specs.
Playwright — existing suites stay green unchanged.

**Docs:** [architecture.md](../architecture.md) rows for the new modules;
[testing.md](../testing.md) rows for the new unit files.

**CHANGELOG:** Other.

---

## Phase 1 — Programming calculator operation visualizer — DONE

**Goal:** the TODO's one improvement to an existing system — see *how* two
binary numbers combine, step by step, at a fixed bit width.

**Scope:**

1. **`src/lib/calc/binaryOps.ts`** — pure functions over the bigint plumbing
   already in [numberBase.ts](../../../src/lib/calc/numberBase.ts)
   (`mask`/`toSigned`/`parseInBase` and friends), each returning the result
   **and a step trace**:
    - **add / subtract** — per-bit ripple with the carry/borrow row drawn,
      final carry-out and signed-overflow flags shown and told apart (the
      distinction is the whole lesson);
    - **multiply** — shift-and-add: one partial product per set bit, shifted
      into place, summed, with bits that fall off the width shown falling;
    - **divide / modulo** (Q8) — restoring long division, quotient bit by
      quotient bit; division by zero refused with words, not `Infinity`;
      signed division truncates toward zero and the trace says so;
    - **AND / OR / XOR** — columnar, one row per operand and the result row;
    - **shifts** — `<<`, logical `>>`, arithmetic `>>` as three distinct
      operations, showing which bits drop off and what fills in, with the
      sign-bit behaviour of arithmetic shift called out;
    - everything honours the selected `BitWidth` (8/16/32/64) and wraps the
      way the hardware wraps, saying when it did.
2. **UI** — a new "Operations" section in
   [NumberBaseApp.svelte](../../../src/components/apps/NumberBaseApp.svelte):
   two operands (entered in any base, reusing the synchronised-input
   pattern), operation picker, result echoed in all four bases, and the step
   table — keyboard-steppable like the similarity tool's DP matrix, with the
   current step described in a sentence, not colour alone.
3. ~~The existing NOT / one's / two's complement entries fold into the same
   trace presentation, so the page has one way of showing work.~~ **Not
   done, deliberately.** They are unary and instantaneous — there is no
   working to step through — and folding them would have meant rewriting a
   shipped, passing spec to move three rows. The Operations table stays as
   it is, testids included, and the visualizer is a card of its own below
   it. Recorded in the calculators dev page's Known limits.

**Data model:** none. Stateless, like the rest of the page.

**Tests:** unit — table-driven vectors per operation: carry chains that ripple
the full width, `0xFF + 1` at width 8 (carry, no signed overflow) against
`0x7F + 1` (signed overflow, no carry), multiplication overflow dropping high
bits, `-7 / 2` and `-7 % 2` at each width, shifting by ≥ width, arithmetic vs
logical shift on a negative value, and each trace replayed — applying the
steps reproduces the result, which keeps the visualization honest by
construction. Playwright — zero-write cases: stepping a trace, the overflow
flag appearing, division by zero refused in the UI.

**Docs:** the programming-calculator pages gain the operations section; the
user page leads with carry vs overflow.

**CHANGELOG:** Features.

---

## Phase 2 — Web playground

**Goal:** the learn-anywhere web playground, living here — HTML/CSS/JS(/TS)
tabs, live sandboxed preview, console, sessions.

**Scope:**

1. **The port** (decision 3): three-tab editor on this app's
   [CodeEditor.svelte](../../../src/components/CodeEditor.svelte) chassis,
   all instances kept mounted so undo history survives tab switches; edits
   debounce (~500 ms) into a rebuild of the Phase 0 previewer's `srcdoc`.
   Emmet on the HTML/CSS tabs (Q6). TS as an optional fourth mode that
   lazy-imports `sucrase` for type-stripping only — on a compile error the
   last good preview stays up and the error is shown.
2. **Preview extras:** viewport presets (full / tablet 768 / mobile 375) plus
   a free drag handle; the console strip fed by the previewer's shim,
   including uncaught errors and unhandled rejections.
3. **Sessions** — the TODO's "normal playground usage, or storage of prior
   sessions": a scratch buffer that persists nothing until **Save names it**,
   then a library sidebar of saved sessions in the shape the SQL and config
   playgrounds already have. Reset-to-blank with confirmation.
4. **Export:** the three buffers as a `.zip` (`index.html`, `style.css`,
   `script.js`/`.ts`) through [zip.ts](../../../src/lib/zip.ts), plus copy
   per tab. No screenshot export (Q5).
5. **Registry:** `web-playground` under **Playgrounds**; route in `SHELL`;
   the sucrase and CodeMirror language chunks precached or offline-bundled so
   the tool is whole in airplane mode; cache bump.

**Data model:** **migration v14** — `web_playgrounds` (`indexes: []`): id,
name, the three-or-four buffers, timestamps. JSON-native, rides backups
(user code in a backup is the point, not a leak — same stance as `notes`).
`types.ts`, `db.ts`, `TABLES` and the README Tables section move together.

**New dependencies:** `@codemirror/lang-html`, `@codemirror/lang-css`,
`@codemirror/lang-javascript`, `@emmetio/codemirror6-plugin` (static);
`sucrase` (lazy, with a `payload.spec.ts` matcher holding it out of the main
bundle).

**Tests:** unit — document assembly (user HTML/CSS/JS landing in the right
slots, the close-tag escape holding against `</script>` in user code), the
console shim's cap and shapes, TS stripping errors surfaced not swallowed.
Playwright — typing HTML changes the preview; a thrown error and a
`console.log` both reach the strip; **scratch mode writes zero rows**; Save
writes exactly one (isolated-delta assertion); reload reopens the session
without writing; the zip read back with `zipEntries` matches the buffers; the
generic data suite picks `web_playgrounds` up for the backup round trip.

**Docs:** `docs/dev/tools/web-playground.md` (the sandbox model and the
port's provenance — learn-anywhere, same author, MIT),
`docs/user/web-playground.md` (leads with: the preview cannot fetch across
origins, and TS here strips types without checking them).

**CHANGELOG:** Features; DB v14 noted.

---

## Phase 3 — HTTP playground — request/response core

**Goal:** craft a request, send it, and understand what came back — the
httpie/Postman core, stateless, with the browser's rules stated instead of
discovered.

**Scope:**

1. **`src/lib/http/`** — the model and the send path, pure where possible:
    - request: method, URL, header list, body as one of none / JSON /
      urlencoded form / multipart (files) / raw text;
    - `send()` over `fetch` with an `AbortController` (a Cancel button that
      works), wall-clock timing, and response capture: status + text,
      headers, body as bytes;
    - response classification through
      [sniff.ts](../../../src/lib/encode/sniff.ts) (decision 5), with the
      `Content-Type` claim shown *beside* the sniffed truth when they
      disagree.
2. **Crafting — headers:** an editable table with validation as you type:
   name syntax per RFC 9110, and the **forbidden request headers**
   (`Host`, `Cookie`, `Content-Length`, `Origin`, …) flagged at edit time
   with "the browser will not send this" — not silently dropped at send time,
   which is what every browser client actually does and never says.
3. **Crafting — bodies:** JSON in a CodeMirror pane (the `lang-json` setup
   the config playground already has) with parse errors positioned and send
   blocked while invalid; urlencoded as a key/value table with the encoding
   shown; multipart as fields + file pickers, letting `FormData` set its own
   boundary and `Content-Type` (and saying why a hand-set one is wrong).
4. **The response — validation side of the TODO:**
    - headers in a `DataTable`;
    - JSON pretty-printed and foldable, with "claims JSON, does not parse"
      called out at the position it broke;
    - **HTML: see-source is the default mode**, with a lazy "Preview"
      toggle that mounts the Phase 0 sandboxed previewer — a server's HTML
      runs with no origin and no access to this app;
    - text bodies shown; **binary bodies get a download prompt** with the
      sniffed extension **and no viewer**, exactly as the TODO specifies;
    - size, timing, and a stored-truncation note when Phase 5 later records
      it (decision 7).
5. **The CORS card** (decision 6, Q3): an opaque `TypeError` from fetch gets
   the likely-CORS diagnosis, the explanation that the *target server* opts
   in via response headers and the browser hides the details from pages on
   purpose, the mixed-content case (`https:` app → `http:` API) detected and
   named separately since the symptom is identical, and a pointer at the doc
   page for the ways out (CORS headers on the server, a dev proxy). No
   "download the app" push — there is no app to download, and this page does
   not lie.
6. **Registry:** `http-playground` under **Playgrounds**; route in `SHELL`
   (the tool loads and crafts offline; *sending* needs a network and failure
   says so plainly); cache bump.

**Data model:** none in this phase — deliberately, so the request/response
core is provably stateless before persistence complicates it.

**Tests:** unit — header-name validation and the forbidden list, urlencoding
edge cases, JSON gating, the CORS/mixed-content classifier fed synthetic
failures, sniff disagreement reporting. Playwright — the Playwright test
server grows a handful of echo routes (returns your method/headers/body as
JSON; returns HTML; returns bytes with a lying `Content-Type`; delays for the
cancel test), and the specs drive real requests against them: craft → send →
assert the echo, cancel mid-flight, the HTML preview mounting sandboxed, the
binary download prompt, **zero DB writes throughout**.

**Docs:** `docs/dev/tools/http-playground.md` (send path, sandbox, the
classifier), `docs/user/http-playground.md` (leads with CORS: what it is, why
a public API works and your `localhost:3000` does not, and that no client in
a browser can escape it).

**CHANGELOG:** Features.

---

## Phase 4 — HTTP playground — environments, variables, secrets

**Goal:** stop retyping — named requests, environments to group them, and
`{{variables}}` resolved at send time.

**Scope:**

1. **Saved requests** (Q7): name a crafted request into an `http_requests`
   store; a library sidebar in the shape the other playgrounds use; requests
   keep their placeholders **unresolved** — resolution happens at send, so a
   saved request is a template, not a snapshot of one send.
2. **Environments:** `http_environments` — named sets of variables (plain
   JSON values), with one built-in **Global** environment always in scope and
   one active environment selectable in the toolbar. Requests may live in an
   environment for grouping/namespacing, per the TODO.
3. **Variables:** Phase 0's engine over URL, header values, and body, with
   the lookup order the TODO fixes — *(step, from Phase 5) → active
   environment → Global*. `lint()` drives the pre-send panel: every
   placeholder listed with where it resolved from, the missing ones blocking
   send (decision 2), and a resolved preview shown **with secret values
   masked**.
4. **Secrets** (checklist 7, Q1): same lookup order as variables, different
   storage — `http_secrets` is local-only, excluded from `STORES` and
   therefore from every backup, values masked in the UI with a reveal
   button, and the page states in plain words where they live (this
   browser's IndexedDB, this machine) and where they will never go (backups,
   exports).
5. **Export/import** of requests and environments as JSON rides the standard
   backup; a dedicated "export this environment" **omits secrets and says
   so** in the file it writes.

**Data model:** **migration v15** — `http_requests` (`indexes: []`),
`http_environments` (`indexes: []`) in the export set; `http_secrets`
created in the same migration but **local-only** (the `sync_outbox`
precedent): not in `STORES`, not in the backup envelope, mirrored in the test
schema as local-only. All the usual files move together.

**Tests:** unit — scope-chain resolution order proved (the same name in step
/ environment / global resolves in that order), masking in the preview
renderer, the environment export omitting secrets. Playwright — saving a
request writes exactly one row; switching environments changes what a send
actually transmits (asserted through the echo route); a send with a missing
variable is blocked and names it; **the backup assertion: create a secret,
export a backup, assert the secret's value appears nowhere in the file**;
backup round trip covers the two exported stores.

**Docs:** the HTTP playground pages grow the variables/secrets sections; the
user page's secrets paragraph is written first, not last.

**CHANGELOG:** Features; DB v15 noted.

---

## Phase 5 — HTTP playground — multi-step flows

**Goal:** the TODO's multi-step system — auth against one endpoint, use the
token on the next, with everything recorded.

**Scope:**

1. **Flows:** an ordered list of steps, each referencing a saved request or
   carrying an inline one, stored in `http_flows`. Run the whole flow or
   step through it; a failed step halts the run with the failure shown in
   place.
2. **Recording:** each run records, per step, the request *as sent* (post-
   resolution, secrets masked in the record) and the response — status,
   headers, timing, and the body **capped per decision 7** with truncation
   stated on the record. The latest run's records live on the flow row;
   history beyond that is out of scope this release.
3. **Extraction rules** (Q2): a step declares outputs — pick a value from
   its response (a JSON path chosen from the actual response tree, or a named
   header), give it a name, and later steps see it in the **step scope**,
   ahead of environment and Global in the Phase 4 lookup order. The
   auth-then-GET example from the TODO is the first template offered on an
   empty flow.
4. **The step scope is ephemeral by default:** extracted values live for the
   run. A rule can be marked "save to environment" for tokens worth keeping,
   and that write is visible, not implicit.

**Data model:** **migration v16** — `http_flows` (`indexes: []`): steps,
extraction rules, and the capped last-run records, all JSON-native. Rides
backups (secrets were already masked at record time, so a recorded flow is
safe to export by construction — and a unit test proves the masking happens
before the record is built, not at render).

**Tests:** unit — extraction against a fixture response (JSON path, header,
missing path reported not silently empty), scope precedence with a step
value shadowing an environment one, the record cap, masking-before-record.
Playwright — the test server grows a two-step auth scenario (POST returns a
token; GET requires it): build the flow with an extraction rule, run it,
assert the second request carried the token (echo), the records show both
steps, the flow row is the only write, and the backup round trip picks
`http_flows` up.

**Docs:** the HTTP playground dev page gains the flow/scope mermaid diagram;
the user page shows the auth example end to end.

**CHANGELOG:** Features; DB v16 noted.

---

## Phase 6 — Placeholder text via in-browser LLM (opt-in)

**Goal:** the TODO's "in-browser LLM to generate text via a prompt" on the
placeholders page — **gated on Q4's quality bar, and severable**.

0.3.0's Q11 rejected this once ("the smallest usable model is an order of
magnitude larger than the whole app, and a seeded corpus is better
placeholder text anyway"). The TODO asks again, so it gets a real prototype
this time instead of a verdict from the armchair — but the phase is written
so that "still no" is a shippable outcome.

**Scope:**

1. **Prototype first** (Q4): a distilgpt2-class quantized ONNX model through
   the already-shipped `onnxruntime-web`, self-hosted beside the app (no
   third-party CDN at runtime — checklist 8). The bar: at a size someone
   would plausibly download, does prompted output beat the seeded corpora
   for *placeholder* purposes? If not, this phase lands as a paragraph in
   the docs and a line in the CHANGELOG explaining why, and the far-fetched
   idea stays far-fetched with evidence attached.
2. **If it passes — the gate** (decision 8): a third mode on the
   placeholders page, disabled behind a card that states the model's exact
   size and that nothing downloads until the button is pressed (the TODO's
   >10 MB opt-in, unconditional because every candidate exceeds it).
   Download with progress, resumable-or-restartable, into a dedicated Cache
   Storage bucket that `SHELL` never touches.
3. **Generation:** prompt in, text out, running in a worker on the
   established worker pattern so the tab stays alive; a visible
   quality-expectations note (this is a tiny model; it will be weird) and
   the corpora remaining the default mode.
4. **Deletion:** the Offline panel lists the model with its real size and a
   delete that works, alongside the font bundles it already lists.

**Data model:** none. The model lives in Cache Storage, not IndexedDB; a
`preferences` field may remember that opt-in happened. **The model never
rides a backup.**

**Tests:** unit — whatever tokenizer/pre-post-processing lands is pure and
gets vectors. Playwright — the gating is the testable part and gets the
attention: the placeholders page makes **zero model-bucket fetches** before
opt-in (network assertion, same spirit as the payload spec), the card
states the size, and after a (fixture-stubbed) download the mode enables and
delete returns the page to the gated state. Generation quality is not
CI-testable and is not pretended to be.

**Docs:** the placeholders pages gain the mode with its size/quality
honesty; [service-worker / offline docs](../architecture.md) note the new
bucket.

**CHANGELOG:** Features — or Other, if the outcome is the documented "no".

---

## Phase 7 — Hardening and release

**Goal:** the cross-cutting passes, then cut 0.4.0.

**Scope:**

1. **Accessibility sweep** over the new surfaces — the registry sweep covers
   the two new pages automatically, but the operation step-tables (Phase 1),
   the playground tab strip and console, the request/response panes, and the
   flow runner each need the hand-driven keyboard pass and AA check in both
   themes.
2. **Offline audit:** fresh install → airplane mode → the web playground
   fully works (sucrase and language chunks precached), the HTTP playground
   loads and crafts with sending failing *politely*, and
   `tools/audit-precache.mjs` is green. The LLM bucket confirmed absent from
   the precache.
3. **Payload pass:** the new CodeMirror language chunks, `sucrase`, and any
   model plumbing held lazy through `payload.spec.ts`; the template engine
   and `binaryOps` confirmed small enough not to need it.
4. **Security pass on the two request-running surfaces:** re-verify the
   previewer's sandbox attributes and message-source checks, the secrets
   masking paths, and that no recorded flow, saved request, or export can
   contain a resolved secret — the Phase 4/5 specs re-read as a set with
   fresh eyes.
5. **Docs:** README "What's in it" and Tables sections, the docs map, the
   per-tool pages re-read as a set for voice; every stale schema/cache
   literal re-swept.
6. **Release:** `VERSION` / `package.json` / CHANGELOG per the standing
   checklist, date the `0.4.0` heading, and note the migrations (v14–v16)
   prominently since users carry their data in their browser. Also still
   owed from 0.3.0's release notes: the fresh-install → airplane-mode walk
   on a real device — do it this time and record it.

**Data model:** none.

**Tests:** `npm test` and `npm run test:unit` fully green, trust gate
reading `self-verification N/N injected faults detected`; the manual offline
and install checklist recorded in the commit.

**CHANGELOG:** Other, plus the release itself.

---

## Ordering

- **Phase 0 blocks 2, 3 and 4** — the previewer (2, 3) and the template
  engine (4, 5).
- **Phase 3 blocks 4; Phase 4 blocks 5** — the HTTP playground is one tool
  built in three sittings, each leaving it shippable: stateless client →
  client with a memory → client that chains.
- **Phases 1, 2 and 6 are independent** of everything except Phase 0 (and
  Phase 6 only of the release bookkeeping — it touches nothing the others
  build).
- **Phase 7 is last.**

Suggested order if one person is working alone: 0 → 1 → 2 → 3 → 4 → 5 → 6 →
7. That cuts a releasable improvement early (Phase 1 is small), lands the web
playground while the learn-anywhere port is fresh, keeps the three HTTP
phases contiguous while the model is in one head, and leaves the LLM
experiment — the most likely phase to end in a "no" — where its outcome
cannot block anything.

---

## Deliberately out of scope for 0.4.0

- **A desktop wrapper to escape CORS** (Q3) — real work with its own release
  train; the honest explainer ships instead.
- **Request history / response archive** beyond a flow's last run — every
  recorded body is a backup-file liability; revisit with a retention design.
- **Cookies, auth flows, OAuth helpers** — the browser owns the cookie jar
  on cross-origin fetches; pretending otherwise teaches the wrong model.
- **Pre/post-request scripting** (Postman-style JS hooks) — extraction rules
  cover the chaining case without an embedded programming model.
- **Importing Postman/Insomnia collections** — a best-effort importer in the
  Compose mould is plausible later; not this release.
- **WebSockets, SSE, gRPC** — request/response first.
- **More web-playground runtimes** (the SQL playground already exists
  separately; no Python/etc. here) and **PNG screenshot export** (Q5).
- **Precaching the LLM model** — it is opt-in storage, never part of the
  install, by decision 8.
