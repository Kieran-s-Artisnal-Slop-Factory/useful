# Web playground

HTML, CSS and JavaScript (or TypeScript) in three editor tabs, with a live preview in a sandboxed iframe, a console strip fed from inside it, and a library of saved sessions in `web_playgrounds`. Ported from learn-anywhere's `WebExercise` — same author, MIT, no vendored third-party code — onto this app's own `CodeEditor`, `Card`, theme tokens, `zip.ts` and `repo.ts`, so there is one editor chassis in the app rather than two.

_Describes the code as of v0.4.0 (unreleased; schema v14) — verify against source when in doubt._

## File map

| Path | Role |
| --- | --- |
| [model.ts](../../../src/lib/playground/model.ts) | `Buffers`, `ScriptLang`, the starter and blank documents, `normalizeSession` (nothing is trusted on read) and `scriptName` |
| [compile.ts](../../../src/lib/playground/compile.ts) | `compileScript` — Sucrase's `typescript` transform, lazily imported, returning a syntax error rather than throwing |
| [export.ts](../../../src/lib/playground/export.ts) | `exportIndexHtml`, `exportFiles` and `archiveName` — the standalone folder the zip holds |
| [popout.ts](../../../src/lib/playground/popout.ts) | The message protocol between the editor window and the popped-out preview, and the window-sizing rule |
| [PreviewWindowApp.svelte](../../../src/components/apps/PreviewWindowApp.svelte) | `/tools/web-playground/preview/` — the popped-out window, which hosts the same sandboxed frame and relays its console back |
| [WebPlaygroundApp.svelte](../../../src/components/apps/WebPlaygroundApp.svelte) | `/tools/web-playground/` — the three tabs, the preview, the console, the library |
| [SandboxedPreview.svelte](../../../src/components/SandboxedPreview.svelte) | The app's one iframe previewer, shared with the HTTP playground |
| [preview/document.ts](../../../src/lib/preview/document.ts) | Document assembly, the close-tag guard, the console shim and its channel check |
| [types.ts](../../../src/lib/db/types.ts), [db.ts](../../../src/lib/db/db.ts) | `WebPlayground`, the `web_playgrounds` store, migration v14 |
| [registry.ts](../../../src/lib/registry.ts) | `web-playground` under **Playgrounds**, icon `code-xml` |

## The sandbox

The preview frame gets `sandbox="allow-scripts"` and nothing else. **Never `allow-same-origin`:** the two flags together let a framed document remove its own sandbox, and what this frames is code somebody is in the middle of writing. Without `allow-same-origin` the frame has an *opaque origin*, so it cannot read this app's IndexedDB, localStorage or cookies. The spec proves it from the inside rather than by inspection — the framed code prints `location.origin` and it reads `null`.

Two consequences worth knowing before they surprise anyone:

- **The preview cannot fetch across origins.** A page with no origin is refused by every server's CORS rules. The user page leads with this, because it is the first thing someone tries.
- **Messages from the frame arrive with `event.origin === 'null'`.** An origin comparison would prove nothing, so the console shim's messages are identified by `event.source === frame.contentWindow` — which no other window can forge — *plus* a channel tag. Both halves are checked; neither is sufficient alone.

```mermaid
flowchart TD
  E["Three CodeEditor instances, all kept mounted"] --> D["onEdit: buffer updated, 500 ms debounce"]
  D --> C["compileScript: JS passes through, TS goes through lazy Sucrase"]
  C -->|"syntax error"| K["tsError shown, the LAST GOOD preview stays up"]
  C -->|"ok"| B["buildPreviewDocument: css into style, html into body, script into a module"]
  B --> I["injectConsoleShim, after head so it installs before anything logs"]
  I --> F["srcdoc on an iframe with sandbox allow-scripts"]
  F -->|"postMessage, source-checked and channel-tagged"| S["Console strip, capped at the last 50"]
  L["Library: web_playgrounds through repo.ts"] --> E
```

## Layout

The **Layout** control above the workspace decides where the preview lives.
`model.ts` owns the four modes and the three questions the markup asks about
them, so the panel logic is pure and table-tested rather than a pile of
conditionals in the component:

| Mode | Editor | Preview | Console | Columns |
| --- | --- | --- | --- | --- |
| `split` (default) | yes | inline | yes | two |
| `editor` | yes | — | — | one |
| `preview` | — | inline | yes | one |
| `popout` | yes | another window | yes | one |

Two invariants fall out of that table and are asserted: **no mode hides both
panels**, and `popout` is the only one where `showsPreview` is false while
`hasConsole` stays true — the preview is somewhere else, not nowhere, so the
document is still built and the log still has a home. Switching back to an
inline mode rebuilds, because the frame remounts empty and would otherwise sit
blank until the next keystroke.

Layout is session state, not a preference. Everything else on this page is
forgotten on reload, and a remembered layout would be the only thing that was
not — changing it therefore writes nothing, which the spec asserts.

### The popped-out preview

`window.open` returns a window that **inherits this app's origin**. That is the
whole hazard: writing the previewed document into it would hand user code this
app's IndexedDB. It does not happen. The popup is a page of ours
([PreviewWindowApp.svelte](../../../src/components/apps/PreviewWindowApp.svelte))
whose only job is to host the same `SandboxedPreview`, so the code still runs
in a frame with `sandbox="allow-scripts"` and no origin of its own. **The
popout moves the frame to another window; it does not move the code out of the
box.** The spec checks the sandbox attribute on the frame inside the popup for
exactly that reason.

Because both windows are ours, messages between them are checked by real
origin as well as by channel tag — the opposite of the shim's situation,
where the sender has no origin and only `event.source` identifies it.

```mermaid
sequenceDiagram
    participant E as Editor window
    participant P as Popup page (our origin)
    participant F as Sandboxed frame (no origin)
    E->>P: window.open, then wait
    P->>E: ready
    E->>P: document, on every rebuild
    P->>F: srcdoc, with the console shim injected
    F->>P: console line, source-checked
    P->>E: console, so the log sits beside the code
    E->>P: close, when the mode is switched off
```

The page renders through `Layout`'s **`bare`** mode, which drops the sidebar,
the notification engine and the install offer. The engine especially: a second
copy ticking in a second window would raise every notification twice.

Three ways the popout ends, all handled: the reader closes the window (a
one-second poll notices `popout.closed` and the mode falls back to `split`);
the reader switches modes (a `close` message, then `window.close()`); or the
editor window goes away first (the popup polls its opener and says the
playground is no longer open). Opening `/tools/web-playground/preview/`
directly lands in that same orphaned state rather than showing a blank frame.

**A console message crossing that boundary must be plain.** `postMessage`
structured-clones, and the previewer's list is a Svelte `$state` array — a
Proxy, which structured clone refuses with `DataCloneError`. `consoleMessage`
copies to plain objects for that reason, and a unit test clones every message
the protocol builds. This bit once already: a defensive `try/catch` around the
send swallowed the error and the strip simply stayed empty with nothing to
explain it. It is the same hazard that makes `repo.ts` JSON-round-trip every
row.

## Editors

All three `CodeEditor` instances stay mounted and are hidden by tab rather than swapped out, so each keeps its buffer, its cursor and — the part people notice — its **undo history** across a tab switch. The buffers themselves are a plain object, not `$state`: the editors own the text and report it through `onDocChange`, and mirroring it into reactive state would only invite a second source of truth.

Emmet is on the HTML and CSS tabs (`Tab` and `Ctrl-E` expand an abbreviation), which is the single highest-value editor affordance for scratch markup and is already proven in the source this was ported from. The script tab loads `@codemirror/lang-javascript` with `typescript: true` so the grammar covers both languages and switching does not reconfigure the editor.

## TypeScript

`compileScript` runs Sucrase's `typescript` transform, which **strips types and nothing else**. There is no checking, no inference and no error for a wrong type: `const n: number = 'not a number'` compiles to `const n = 'not a number'` and runs. The page says so in a note under the language picker, and a unit test pins the claim so it cannot quietly become untrue.

Sucrase is imported inside `compileScript`, so a JavaScript session never fetches it; `payload.spec.ts` has a `sucrase` matcher in `HEAVY`, and the tool's own spec watches the network to prove it arrives only after the language is switched. A syntax error is **returned, not thrown**, and the caller keeps the last preview that worked — a preview that blanks on every half-typed generic is unusable.

## Sessions

A new session is a scratch buffer: it lives in memory and writes nothing. **Save** names it and writes exactly one `web_playgrounds` row plus `preferences.web_last_playground_id`; the spec asserts that delta and no other. Opening the page reads that preference and reopens the session **without writing** — `open()` takes `remember: false` on the load path, the same shape the config playground uses.

Rows are text only (a name, three buffers and a language), so they ride the JSON data layer and a backup byte-identically. Code in a backup is the *point* here, not a leak — the same stance `notes` takes. Nothing is trusted on read: `normalizeSession` replaces any non-string buffer with `''` and falls back on the name and language, because a backup is a text file anyone can edit and the generic data suite writes an array into every column it can.

## Export

`exportFiles` writes `index.html`, `style.css` and `script.js`, plus `script.ts` for a TypeScript session so the export is the work rather than only the result. The `index.html` it writes **links** the siblings instead of inlining them, unlike the preview document — so the unzipped folder opens in a browser and behaves the way the preview did. `archiveName` slugs the session name, which is also what stops a name containing `../` or a path separator from reaching the download.

## Tests

| File | Runner | Covers |
| --- | --- | --- |
| [playground.test.ts](../../../src/lib/playground/playground.test.ts) | vitest | The layout table — every mode's panels, that none hides both, and that `popout` keeps its console; the popout protocol's guards against nine wrong shapes and the structured-clone contract every message has to satisfy; `normalizeSession` against six hostile column values; the language fallback; Sucrase stripping types, dropping interfaces, **not** type-checking, and returning a syntax error instead of throwing; the export file set for both languages and its round trip through `zipEntries`; `archiveName` slugging, its length cap, and that it can never produce a separator or a traversal |
| [document.test.ts](../../../src/lib/preview/document.test.ts) | vitest | The close-tag guard, document assembly, and the console shim EXECUTED against stand-in globals — including the bare-string rejection reason the Playwright spec cannot exercise |
| [web-playground.spec.ts](../../../tests/local/web-playground.spec.ts) | Playwright | Typing reaches the preview and a scratch session writes NOTHING; `console.log`, an uncaught error and an unhandled rejection all reach the strip with their levels; the frame's sandbox attribute and its `null` origin proved from inside; Save is one row plus the preference (isolated delta), reload reopens it writing nothing, re-saving updates rather than adds, delete is a tombstone; the zip read back with `zipEntries`; Sucrase absent for JS and present after the switch, a wrong type compiling anyway, and a syntax error leaving the last good preview up. Layout: each mode showing the panels it should and writing nothing; the popout opening a real window, still carrying the sandbox, following edits, relaying its console back, and falling back to `split` when the window is closed; and the preview address opened directly reporting that it has no playground to listen to |
| [data.spec.ts](../../../tests/local/data.spec.ts) | Playwright | `web_playgrounds` joins the generic backup round trip through the `TABLES` mirror — no line added to the spec |
| [a11y.spec.ts](../../../tests/local/a11y.spec.ts) | Playwright | The route is in the registry-derived sweep |

## Known limits and decisions

- **No PNG screenshot export.** learn-anywhere does it with a second, deliberately *non-sandboxed* iframe plus a dependency; a sandbox exception is a poor trade for a screenshot when the zip already covers "get my work out" (0.4.0 plan, Q5).
- **TypeScript is stripped, not checked** — see above. Type-checking in the browser means shipping the TypeScript compiler, which is an order of magnitude more than this whole page.
- **One session at a time.** The library opens a session into the editors; there are no tabs across sessions, and no autosave — Save is explicit, which is what makes "a scratch session writes nothing" true.
- **A popout cannot be relied on for phones and tablets.** Mobile browsers have no popup windows: they open a tab you have to switch to by hand, or block it outright. The mode says so when it is picked, and a blocked window falls back to `split` with a message rather than leaving an empty pane.
- **The preview reloads wholesale on every rebuild**, so it loses any state the previewed page had built up. Debounced at 500 ms to keep that tolerable while typing.
- **`sandbox="allow-scripts"` also blocks forms, popups, top-level navigation and pointer lock.** That is the default deny working as intended; adding a flag back means re-reading the decision in [SandboxedPreview.svelte](../../../src/components/SandboxedPreview.svelte), not just adding a word.
