# 0.4.0 (unreleased)

**Schema v14.** This release migrates the browser database from v13 to v14
(the `web_playgrounds` store for the web playground). Your data is carried
across in place; a backup exported from 0.4.0 will not import into an older
build, so export one before downgrading.

## Features

- **A web playground** (Phase 2). HTML, CSS and JavaScript in three editor
  tabs under **Playgrounds**, with the page rendering beside them as you type,
  a console strip, and a library of saved sessions. Ported from
  learn-anywhere's web exercise — same author, MIT — onto this app's own
  editor, cards, theme and data layer, so there is one editor chassis here
  rather than two.
  - **The preview has no origin of its own.** It runs in a frame with
    `sandbox="allow-scripts"` and nothing else — never `allow-same-origin`,
    which alongside scripts would let the framed document remove its own
    sandbox. That is what stops the code you are writing from reading this
    app's stored data, and it is also why `fetch` to another site fails in
    there: a page with no origin is refused by every server. The spec proves
    it from the inside rather than by inspection.
  - **The console strip catches what the preview says**, including uncaught
    errors and unhandled rejections, capped at the last 50 messages and with
    very long lines truncated. Its messages are identified by the window that
    sent them plus a channel tag — an opaque origin arrives as the string
    `"null"`, so comparing origins would prove nothing.
  - **Emmet on the HTML and CSS tabs**, and all three editors stay mounted, so
    each tab keeps its own undo history across a switch.
  - **TypeScript is stripped, not checked.** Types are removed and the rest
    runs as written, so `const n: number = "hello"` is not an error — it runs.
    The page says so plainly, and a test pins the claim so it cannot quietly
    become untrue. The stripper is fetched only when the language is switched.
    A syntax error leaves the last working preview up rather than blanking it.
  - **Nothing is written until Save names a session.** Typing, running and
    exporting write nothing at all; Save is exactly one row and the remembered
    id, and reopening on a later visit writes nothing either.
  - **Export** writes the three buffers as a `.zip` whose `index.html` links
    its siblings, so the unzipped folder opens in a browser on its own. A
    TypeScript session ships its `.ts` original beside the compiled script.
  - **Four places to put the preview.** **Split** is how it starts;
    **Editor** hides the preview and gives the code the whole page;
    **Preview** does the reverse; and **Popout** moves the preview into its
    own window so the editor gets all of this one — drag it to a second
    screen if you have one. Closing that window, or picking another layout,
    brings the preview back. The popped-out window is only a viewport: your
    code still runs in the same sealed frame it does inline, with no access
    to this app's data, and what it logs still appears in the Console beside
    the code that wrote it. **Popouts do not work on most phones and
    tablets** — mobile browsers have no separate windows — so the page says
    so when the mode is picked, and a window the browser refuses to open
    falls back to Split with an explanation rather than an empty pane.

- **The programming calculator shows its working** (Phase 1). A new
  **Operation visualizer** under the existing Operations table takes a second
  number and walks an operation through it one step at a time: add, subtract,
  multiply, divide, modulo, AND, OR, XOR, and the three shifts. Operand **a**
  is the value at the top of the page; operand **b** gets its own set of the
  same four synchronised base boxes, so both operands are entered the same way
  and both truncate together when the bit width shrinks. **Back** and **Next**
  step the trace from the mouse or the keyboard, the answer is echoed in all
  four bases with its signed reading, and every step is a full sentence — the
  highlight is decoration, and the sentence is what a screen reader gets.
  - **Carry and signed overflow are shown separately, because they are
    different questions.** Carry asks whether the answer fit read as unsigned;
    overflow asks whether it fit read as two's complement. At 8 bits
    `0xFF + 1` carries without overflowing and `0x7F + 1` overflows without
    carrying, and the page says which, in words, every time.
  - **Multiply is drawn as shift-and-add**, one partial product per set bit,
    with the bits that shift past the top of the width drawn falling off it in
    their own dashed columns.
  - **Divide and modulo are restoring long division**, one quotient bit per
    step. Signed operands are divided as magnitudes and the sign goes back on
    as its own visible step — which is what makes truncation toward zero
    obvious: −7 / 2 is −3, not −4, and the remainder takes the sign of the
    dividend so `(a / b) * b + a % b` still equals `a`. The one division that
    overflows (the most negative value by −1) is named. **Dividing by zero is
    refused in words** rather than answered with an infinity, because integers
    do not have one.
  - **The two right shifts are separate operations**, not one with a switch:
    logical feeds in zeros, arithmetic copies the sign bit, and the page says
    which bit left and what filled in at every place. Shifting by the width or
    more is answered with the mathematical result and a note that C calls it
    undefined and that x86 and ARM disagree about it.
  - **Signed changes the answer's bits for division and modulo only.**
    Everywhere else it changes how the result is read, and the page says so
    rather than leaving you to wonder why the checkbox did nothing.
  - The trace is checked, not just drawn: every operation is tested at every
    width against BigInt's own arithmetic, and every trace has to replay into
    its own answer — the bits the steps claim to have decided are OR-ed
    together and compared with the result, and multiplication's partial
    products are read back out of the drawn rows and summed.

## Other

- **The test suite is trustworthy again.** A full `npm test` had been failing
  three to seven tests per run, a *different* set every time, and every one of
  them passed when its spec was run alone — which is exactly the state
  `retries: 0` exists to prevent. Seven separate causes, each reproduced before
  it was fixed:
  - **The fixture drove pages that were not listening yet.** `app.goto()`
    waited for the test hook, which is its own lazy chunk and regularly lands
    *before* the islands hydrate. Astro server-renders `client:load` islands,
    so the sidebar and the palette button are in the HTML from the first paint
    and look ready while nothing is bound — a `Control+k` on the next line was
    a coin flip. The fixture now also waits for every `astro-island` to have
    dropped its `ssr` attribute, which is the moment hydration finishes.
  - **`app.call()` ran on whatever document was current**, so `app.dump()`
    straight after a *click* navigation could hit a new page whose hook had not
    arrived. It waits for the hook now, which fixes the whole class rather than
    one spec.
  - **The v6 migration test raced the clock.** The notification engine ticks
    every second and every tick reopens the database through `repo.ts`, so
    `deleteDatabase` was blocked by the tab itself; the test then opened at v5
    against a live v13. The test hook gained `stopEngine()`, and a blocked
    delete now fails loudly instead of carrying on.
  - **Three one-shot actions were fired at things that were not ready** — and
    a control that is not ready does *nothing*, so no retrying assertion could
    ever recover. `MathField.insert()` returns silently unless the field has
    loaded; the image editor's opacity and blend controls edit whatever is
    selected *right now*; the logo generator's badge preview was read while the
    previous tab's avatar was still on screen, which satisfied one assertion on
    the wrong picture and failed the next. Each now waits for the app's own
    statement that it is ready.
  - **Chromium's view-transition aborts were counted as app errors.** Under
    load the browser abandons a transition whose DOM update overruns and
    reports it as an uncaught error; `<ClientRouter />` starts one on every
    client-side navigation. The navigation still completes and the page is
    correct, so it is now matched by name and ignored. Nothing else is.
  - **Sixteen workers against one static server was itself a cause.**
    Playwright defaults to half the cores, and sixteen browsers installing a
    service worker and precaching the shell at once ran the machine out of
    sockets (`net::ERR_NO_BUFFER_SPACE`) and left the worker more than 30
    seconds to claim its page. Capped at eight — which turned out to be
    **faster as well as steadier**, 106 s against 114–132 s, because the
    single-threaded server was the bottleneck all along.

  Along the way this turned up a **real ordering bug in the image editor**: the
  first image sets the canvas and then reads its EXIF — a lazy import — *before*
  its layer is added and selected, so a second image picked in that window ends
  up underneath the first and loses the selection. The tests no longer hide it;
  the fix is filed separately rather than smuggled in here.

- **Groundwork for the rest of 0.4.0** (Phase 0). Nothing on screen changes;
  two modules land that the tools coming after this one mount rather than
  each growing their own.
  - **A `{{placeholder}}` engine** (`src/lib/template/engine.ts`). `render()`
    resolves `{{name}}`, `{{obj.field}}`, `{{arr[0]}}` and combinations of
    them against an ordered chain of scopes, first hit wins, and `lint()`
    reads the names a template needs without resolving anything — which is
    what lets a page say "this needs `token`, `base_url`" and mark the missing
    ones *before* anything is sent. Hand-rolled rather than nunjucks on
    purpose: the requirement is lookup, and a request body is not a place for
    `{% for %}`. **An unresolved name is an error, not an empty string** —
    sending `Authorization: Bearer` because `{{token}}` quietly resolved to
    nothing is the classic client bug, and it is silent exactly when it
    matters. Every failure carries the offset of the placeholder that caused
    it and the text as written; objects and lists are refused by name rather
    than interpolated as `[object Object]`. `\{{` writes a literal `{{`, and
    only an odd run of backslashes escapes, so a JSON body can still carry
    `"C:\\{{dir}}"` and mean it.
  - **One sandboxed previewer** (`src/components/SandboxedPreview.svelte`),
    ported from learn-anywhere's web exercise (same author, MIT) onto this
    app's own chassis. The frame gets `sandbox="allow-scripts"` and nothing
    else — never `allow-same-origin`, which together with scripts would let
    the framed document drop its own sandbox. What it frames is either user
    code or a stranger's HTML, so it runs with no origin and no way to reach
    this app's IndexedDB. Its console shim forwards output, uncaught errors
    and unhandled rejections to the host page over `postMessage`, identified
    by the sending window and a channel tag rather than by an origin string
    (an opaque origin arrives as `"null"`, which proves nothing), capped at
    the last 50 messages; unmounting navigates the frame away so its scripts
    and timers actually stop.

- **Documentation drift swept.** Sixty-two pages carried an "as of v0.3.0"
  banner and now read `v0.4.0 (unreleased; schema v13)`. Three pages named a
  service-worker cache several releases stale against a shipped
  `useful-cache-v33`: the config playground page said `useful-cache-v16`, the
  notebook page said `v17` in two places, and the architecture page's data
  table said `v18`.

# 0.3.0 (2026-08-22)

**Schema v13.** This release migrates the browser database from v12 to v13
(the `compose_projects` store for Docker Compose). Your data is carried
across in place; a backup exported from 0.3.0 will not import into an older
build, so export one before downgrading. Fifteen stores in all — see the
README's Tables section.

## Features

- **The sidebar is a rail and a flyout** (Phase 14, Q2 — variant G of the
  eight in `docs/dev/plans/sketches/sidebar-variants.html`). The left edge is
  a narrow rail of category icons; the chosen category's tools are listed
  beside it, and the list follows the page you land on. Collapsing the
  sidebar now keeps the rail — the collapsed state is useful instead of an
  empty strip — and a rail click brings the list back on that category. The
  categories changed with it: **Productivity** (Scheduler, Notebook) replaces
  two one-tool categories; **Security** (Hashing, JWT, Encryption, Secrets)
  and **DevOps** (Docker Compose, Crontab, File tree) leave Generators, which
  keeps the eight that really make things. Home is no longer a sidebar row —
  the brand in the top bar is its link — and **Preferences folded into
  Settings**: one page for everything about the app itself, reached by the
  gear pinned to the foot of the rail. `/preferences/` redirects there, and
  "prefs" / "preferences" still find it in the palette.

- **Notebook: drawings.** **✏ Draw** on the editor toolbar opens an Excalidraw
  canvas (the port from retoken that Phase 10 deferred). **Insert drawing**
  saves the scene as a PNG image in the note — with the scene embedded in the
  PNG, so the picture reopens for editing: the ✏ beside the image in the rich
  view, or select it (or stand inside its `![Drawing](…)` in Source) and press
  Draw again; **Update drawing** replaces the bytes under the same asset, so
  every reference to it updates at once. A drawing is an ordinary image to the
  exports, the backup and the 2 MB cap, and the file opens on excalidraw.com.
  - **Nothing arrives until the button is pressed.** React, Excalidraw and its
    stylesheet are one lazy import (a megabyte, named `excalidraw.*.js` in the
    build so the payload guard can see it), and the notebook spec asserts they
    are absent before the click and present after.
  - **The fonts it writes with are served from this origin.** Excalidraw
    fetches its faces at run time, by default from unpkg; eight families
    (430 KB) are vendored under `public/excalidraw/` by
    `tools/build-excalidraw-assets.mjs`, `window.EXCALIDRAW_ASSET_PATH`
    points there, the service worker keeps them in the font bucket, and
    **Drawing fonts** joined the Offline panel. The one family left out is the
    13 MB CJK one, which falls back to the CDN rather than to a blank.
  - `AssetStore` gained an optional `nameOf(src)`: the notebook's refs are
    `asset:<id>` and carry no filename, and the filename is what says an
    image is a drawing.

- **Placeholders: every generator in the picker shows an example.** Each
  option carries a small picture of that generator's default look, so the
  nine can be told apart before one is chosen. The pictures are rendered
  once by `tools/build-placeholder-thumbs.mjs` (through the real generator
  code, bundled with esbuild) and committed as data — a first cut redrew all
  nine from the live settings on every change and the page felt slow for
  pictures whose only job is to say what a flow field looks like.

- **Docker Compose: the generated `compose.yaml` is syntax-highlighted**, on
  the same Prism path every other generated-source block uses.

- **Docker Compose** (`/tools/docker-compose/`, **schema v13**): build a
  `compose.yaml` through controls that know what each field does, start from
  one of nine stack templates, add one of ten service snippets, or read an
  existing file back in. The largest piece of this release.
  - **The model is the source of truth and the YAML is a projection of it.**
    Nothing stores text: a builder that keeps YAML has to re-parse on every
    keystroke, and the first time either side changes independently the two
    disagree. There is no code path that reads the output back.
  - **Keys come out in Compose-spec order, not insertion order**, so
    re-emitting an unchanged project is byte-identical and a file kept in
    version control does not produce a diff every time the editor is
    rearranged. Only what was set is written — an empty field is absent, not
    `""`, because Compose reads an empty `command` as "run nothing".
  - **The warnings sit beside the field that causes them**, and each is
    something Compose itself will not tell you: `network_mode: host` makes
    published ports do nothing (the ports editor disables itself and says
    why); a bare word as a bind source is a NAMED VOLUME, not a folder, so
    your edits appear to vanish; `service_healthy` on a service with no
    healthcheck waits forever; two services with one name silently replace
    each other; ipvlan and macvlan need a real parent interface and do not
    work inside Docker Desktop's VM. Duplicate host ports are caught with
    ranges **expanded** — `8000-8010` and `8005` collide, and no string
    comparison notices.
  - **Nine stacks and ten snippets, every one of them table-tested.** A
    template must build a project that validates, emit a document that
    parses, pin a tag on every image it uses, and survive a store round trip
    — a template is content, content is where typos live, and a broken one is
    a compose file someone pastes into a terminal and watches fail. Each
    stack also downloads as a runnable `.zip` with a README that states its
    pins and says that tags move.
  - **Injecting a snippet is not a splice.** It renames on a name collision,
    declares any volume it mounts, and moves the host port when something
    already publishes it — only the host side, since the container port is
    the image's contract. Each of the three is a stack that would not start
    otherwise, and the receipt says what happened.
  - **Import lists what it cannot represent rather than dropping it.**
    `build:`, `labels:`, Swarm settings and the rest come back as a report
    with their paths, before anything is replaced. One bug the round-trip
    test found and reading would not have: an argv list has to be re-quoted
    on the way in, or `["sh", "-c", "a && b"]` returns as five arguments and
    the container runs something else.
  - **New store `compose_projects` (migration v13)**, one JSON column holding
    the whole model. **A compose file can contain secrets** — environment
    variables, database passwords, inline config content — and this store
    rides the plain-JSON backup like every other, which the page says where
    someone can act on it rather than burying in a doc.

- **ASCII art now ships thirty-seven FIGlet fonts**, up from fourteen — the
  Big Money set, ANSI Regular/Compact/Shadow, Bloody, Blocks, Broadway,
  Caligraphy, Classy, Coder Mini, Cyberlarge, Cybermedium, Delta Corps Priest
  1, Electronic, Epic, Fraktur, Reverse, Slant Relief, Terrace, 3D-ASCII and
  more, grouped by what they are made of (a new **Script** group joins Stroke,
  Shadow, 3-D, Blocks and Decorative).
  - **The licence gate grew a second route rather than being loosened.** Only
    twenty of the thirty-seven state redistribution terms in their own header;
    the rest state nothing at all, because most of the FIGlet library predates
    anyone thinking about licences and the 1990s fonts were posted to
    alt.ascii-art with a name, an email address and no terms. Refusing all of
    those means shipping eight fonts, so a font may now ship on a recorded
    **package basis** — marked one font at a time in the build catalogue,
    saying that a maintainer read the header and found the file inside the
    MIT-licensed `figlet` package with its author named. `PROVENANCE.txt` says
    in those words that this is weaker than a per-font grant, and quotes what
    each header does say underneath. A font with neither still fails the
    build, and the refusal names what to do about it.
  - Four unit cases hold the gate's shape: the default is still a refusal, the
    second route has to be asked for per font, a font marked `package` whose
    header *does* state terms is still reported as `header` (the basis is read
    from the file, never from the catalogue), and a majority must still stand
    on their own terms.

- **File tree: two clear buttons.** **Clear** empties the tree down to its
  root — the example folders included — so a tree can be typed from nothing;
  the root itself survives, because a tree without one is not a tree.
  **Clear all** in the emoji rules removes every rule including the shipped
  dozen, after which every file falls back to 📄 and every folder to 📂.

- **Placeholders: the generators got their knobs.**
  - **Flow field** takes a line count (10–400). Past that the lines stop
    reading as lines and the file stops being small, so it clamps.
  - **Layered geometry** takes a shape opacity — the *centre* of the range
    each shape draws from rather than a flat value, because shapes all at one
    opacity stop looking layered and start looking like a single stencil.
  - **Cut planes**, a new generator beside it and its opposite: four to six
    big quadrilateral slabs on one jittered angle, each long enough to run off
    both edges, under a shared drop shadow. Its palette is built from the
    chosen background — two neighbouring hues plus a dark and a light — because
    a few big slabs in unrelated colours look like a mistake where a dozen
    small ones look playful, and because it gives the Background picker
    something to do beyond filling the gaps.
  - **The icon** takes a size, 10–95% of the shorter side.
  - **Six more drawn scenes**, taking the set to fifteen — five each of nature
    (a desert, a dusk coastline), sport (a tennis court, a bicycle on a road)
    and city (a subway platform, rooftops in the rain).
  - **The Ink picker is gone where it painted nothing.** It now appears only
    for the four generators that actually use it; the same rule hides the seed
    where nothing is random. An inert control is worse than a missing one.

- **Placeholders** (`/tools/placeholders/`): filler text and filler images,
  both seeded, both drawn on the device. Nothing is fetched — the only thing
  on the page that leaves this machine is a card of links to photo sites, and
  it says so.
  - **Two text corpora, and the licence question is why there are two.**
    Lorem ipsum from the standard public-domain word list, and **office speak
    written for this repository** as a small grammar rather than a bag of
    buzzwords — meeting-speak is recognisable by its shape, and a shuffled
    word list just reads as noise. Nothing in the output is a phrase lifted
    from an existing site. The traditional opening is only offered for the
    corpus it belongs to.
  - **Eight image generators, all SVG-first.** Plain colour, a fitted caption,
    gradients, tinted fractal noise, a flow field, layered translucent
    geometry, any Lucide icon, and nine hand-drawn scenes. SVG because a
    placeholder is flat colour and geometry: it stays a couple of kilobytes at
    any size, where a 4000-pixel PNG of a grey rectangle is megabytes of
    nothing — and the PNG and JPG downloads then rasterize that same document
    through the image tools' own converter, so they cannot disagree with the
    preview.
  - **Nine scenes, drawn in this repository** — three nature, three sport,
    three city. Each is authored in a 160×90 box and placed with
    `preserveAspectRatio="xMidYMid slice"`, which is what lets one drawing
    fill any frame: the proportions hold and the frame crops, like
    `object-fit: cover`. Hand-drawn because provenance for art we drew is one
    sentence and provenance for art scraped off the web is a research project.
  - **The seed is the whole contract.** The same seed and settings always draw
    the same picture, so a placeholder regenerates identically on another
    machine — and a batch is simply the seed varied per item, so image 3 of a
    batch is exactly what typing that seed produces on its own. Batches zip
    with names padded to the batch size, so a file listing sorts in order.
  - **SVG has no conic gradient**, so the gradient tool's third option is
    missing here and says why, rather than being quietly drawn as something
    else. And the 2 MB icon set arrives only when the icon generator is
    picked — `payload.spec.ts` watches the network to keep it that way.
  - **One PRNG for the whole app.** `mulberry32` moved from the config
    playground to `src/lib/random.ts` on its second caller: two copies would
    be two answers to "what does seed 42 produce".

- **Crontab** (`/tools/crontab/`): a cron expression read back in English, with
  its next five runs, a builder that works in both directions, the same
  schedule as a systemd timer, and — the part crontab.guru leaves out — where
  the line actually goes and what will bite you. Nothing is written anywhere.
  - **The day-of-month / day-of-week trap is printed in red.** `0 0 13 * 5` is
    not "Friday the 13th": when both day fields are set to something other
    than `*`, cron runs the job when **either** matches, so that line runs on
    every 13th *and* every Friday. The parser detects the shape, the sentence
    says so, the next-run list proves it, and the systemd translation refuses
    rather than quietly ANDing it.
  - **Two parser details that are wrong everywhere else.** Sunday is both 0
    and 7, and the 7 is folded onto 0 only *after* ranges expand — otherwise
    `5-7` (Friday, Saturday, Sunday) looks like a range running backwards and
    gets refused. And "restricted", the thing the OR rule turns on, means
    "does not begin with a star" — exactly the test Vixie cron makes — not
    "matches fewer than every value", so `0-6` in day-of-week is restricted
    even though it matches every day.
  - **Six-field expressions are refused by name.** Quartz and Spring put
    seconds in front; a five-field parser handed one reads every field one
    place to the left and produces a schedule that looks plausible and is
    wrong. The check is narrow enough that `0 0 12 * * who` is still five
    fields and a command called `who`.
  - **The next runs skip rather than tick**, which is how the page can say
    that `0 0 30 2 *` never runs instead of spinning: a month that does not
    match advances a whole month. They are computed in the browser's timezone,
    which the page names, with the daylight-saving behaviour stated —
    a daily job at a time that does not exist is skipped, and one at a time
    that happens twice runs once.
  - **The builder is derived from the text, not mirrored into its own state**,
    so the two cannot drift; a field written in a shape the controls cannot
    draw (`1-5/2,30`) is reported as such and left exactly as typed rather
    than flattened into something they can.
  - **Where the line goes, as a real section.** `crontab -e` takes no user
    column and `/etc/cron.d` does — the mistake that eats an afternoon —
    `run-parts` ignores anything with a file extension, and cron's `PATH` is
    nearly empty while `%` means a newline.

- **File tree** (`/tools/file-tree/`): the `├── └──` tree every README has,
  built by clicking or read back from a real directory listing. Nothing is
  written anywhere; a tree worth keeping leaves as a JSON file that re-imports
  exactly.
  - **Six listing formats go in, and the page works out which one it is.**
    `ls`, `ls -1`, `ls -R`, `dir`, `dir /b /s` and `tree`'s own output (both
    the Unix shape and Windows `tree /f`, where files are indented with no
    connector at all), plus a tree typed by hand with indentation. Depth comes
    from the COLUMN a name starts at rather than from counting connectors,
    which is what lets one parser read all the drawn formats — including this
    app's own pure-ASCII output.
  - **A line that could not be read is listed, not dropped.** Every parser
    reports the line number, the text and the reason, and the page shows them
    under the result — a listing that half-worked says which half. The noise
    every listing carries (`total 24`, the volume banner, `2 directories, 3
    files`, `.` and `..`) is recognised and skipped silently, so the warnings
    mean something.
  - **The listing's own root name survives.** `Directory of C:\myapp` gives a
    tree called `myapp`, and `dir /b /s` output is rooted at the common prefix
    of its paths — stopping one segment short, so the project directory is the
    root rather than five empty levels under `C:`. A first line that only says
    "here" (`.`, `C:.`) falls back to the default, and a first line is only
    treated as the root when it is the *only* line at the outer level:
    otherwise those are siblings, and eating the first would silently reparent
    the rest.
  - **A folder cannot be dropped inside itself.** Every edit is a pure
    function returning a new tree, and `move()` refuses a move into itself,
    into one of its own descendants, or onto its current parent — the
    alternative is a subtree that quietly leaves the tree with no way back.
    The drag is pointer-based, so it works with a finger as well as a mouse.
  - **Text, SVG, PNG or JSON out**, with a pure-ASCII drawing for terminals
    that mangle box characters, emoji by kind or by an editable extension
    table, and the root shown, hidden, dotted or renamed. The SVG turns OFF
    the grid-fitting the ASCII-art tool needs: an emoji is two cells wide, and
    stretching a row that holds one to a single-width grid bends the branch
    columns out of line with the rows above.

- **ASCII art** (`/tools/ascii-art/`): a picture rendered as characters, or
  your words as a banner in one of fourteen FIGlet fonts. Both halves run on
  this device, and nothing — not the image, not your words, not the font you
  picked — is written anywhere.
  - **A character cell is not square, and that is the whole conversion.**
    Monospace cells are about twice as tall as they are wide, so the row count
    folds that ratio in; without it every picture arrives at double height.
    The SVG and PNG renderers lay out on exactly the same grid, so the
    downloads reproduce what the text block shows.
  - **Each character is an average, not a sample.** Every output cell owns a
    rectangle of source pixels — computed from exact fractions, so nothing is
    dropped or double-counted when the image does not divide evenly — and
    averages it. A unit test converts a one-pixel checkerboard and asserts
    mid-grey; a point sampler would return pure black or pure white and the
    picture would shimmer as the width changed. Transparency is composited
    onto the chosen background *before* averaging, so a transparent PNG is not
    read as a rectangle of `@`.
  - **Ten steps or seventy**, invertible for light-on-dark terminals, with an
    optional per-character colour that survives into the HTML and SVG copies
    and is honestly absent from the plain text. Output as text, `.txt`, HTML,
    SVG or PNG — the PNG is the SVG through the same converter the image tools
    use, so the two can never disagree.
  - **Fourteen fonts ship, and the build refuses any it cannot account for.**
    New dependency: `figlet` (MIT, ~50 KB, lazily imported and imported
    nowhere else). `tools/build-figlet-fonts.mjs` vendors the fonts, quotes
    each one's licence sentence out of its own `.flf` header into
    `public/figlet/PROVENANCE.txt` with a SHA-256, and **exits 1 rather than
    ship a font whose header states no licence** — which is why some
    well-known ones are absent (`ANSI Shadow` names no author at all). The
    refusal path has its own unit test, and the checksums are re-verified on
    every run of the suite.
  - **The picker draws every font in your own words**, each row rendered as it
    scrolls into view, so a list nobody looked at costs nothing. The `figlet`
    chunk and the fonts are both lazy, and `payload.spec.ts` watches the
    network to keep them that way.

- **JWT** (`/tools/jwt/`): decode, verify and sign JSON Web Tokens across
  HS/RS/PS/ES256-512 and EdDSA. Stateless — no token, secret or key is written
  anywhere.
  - **The page is built around one distinction: decoding is not verifying.**
    The decoded card is headed *Decoded — not verified* and says plainly that a
    payload is base64url rather than encryption, because every JWT incident
    starts with someone trusting a claim nobody checked. The claims table
    renders `exp`, `nbf` and `iat` as both a date and an age, and a token with
    no `exp` is called out as one that never expires on its own.
  - **Two attacks are refused by name.** `alg: none` — the unsigned token the
    original specification allowed — is reported before a key is even looked
    at. And handing an HS* algorithm a PEM is refused as the
    algorithm-confusion attack: a verifier holding an RSA public key that
    trusts the token's own `alg` will use that PUBLIC key as an HMAC secret,
    and anyone can forge tokens with a public key.
  - **EdDSA is feature-detected**, listed and disabled with the reason where
    the browser has no Ed25519, rather than silently missing.

- **Encryption** (`/tools/encryption/`): AES-256-GCM with a password, RSA-OAEP
  key pairs, ECDH key agreement, bcrypt and a one-time pad. Every operation is
  user-triggered, and **nothing is stored** — there is deliberately no "save
  this key pair" button, because a backup of this app is one plain JSON file.
  - **AES-GCM, never CBC**, with a fresh 96-bit IV per operation and a PBKDF2
    key at 600 000 iterations (OWASP's current figure). The ciphertext travels
    as one self-describing line carrying its own salt, IV and iteration count,
    so decrypting needs the password and nothing else remembered. An altered
    bundle fails to decrypt rather than producing plausible rubbish, and a
    test flips one bit to prove it.
  - **RSA states its limit in the refusal.** RSA-OAEP at 2048 bits carries 190
    bytes; past that the error gives the number, the actual length, and says
    that hybrid encryption — a random AES key encrypted with RSA — is the
    answer rather than a bigger key.
  - **Two Diffie-Hellmans, and the difference is the point.** ECDH through
    WebCrypto (P-256/384/521, and X25519 where the browser has it) runs both
    sides and compares the derived secrets; beside it, the same idea over a
    three-digit prime in `bigint` so the four lines of arithmetic can be read
    — labelled **a demonstration, not a cipher**, since at that size the secret
    falls out in a fraction of a second. WebCrypto has no finite-field DH at
    all, which is a decision by the standards bodies rather than an omission.
  - **bcrypt runs in a Web Worker** (new dependency: `bcryptjs`, MIT, imported
    nowhere else), with the cost capped at 12 and the measured time reported —
    a cost-12 hash in pure JavaScript is a frozen tab otherwise. The page says
    when a passphrase went past bcrypt's 72-byte limit, which every
    implementation truncates silently.
  - **The one-time pad enforces the two rules it can** — a key as long as the
    message (a short key is refused, never repeated) and a key from
    `crypto.getRandomValues` — and states the third, which no web page can
    enforce: never reuse it, and send it some other way.

- **Hashing** (`/tools/hashing/`): twelve digests of the same message, computed
  as you type — MD5, SHA-1, SHA-224/256/384/512, SHA3-224/256/384/512 and
  SHAKE128/256 — with HMAC over any of them, salt, pepper and four output
  formats. **Nothing on the page is written anywhere**, and its spec asserts
  the database is byte-identical across the whole session.
  - **Half of them are this app's own code, because no browser has them.**
    WebCrypto does SHA-1 and the SHA-2 family and nothing else, so MD5
    (RFC 1321), SHA-224 (the SHA-256 core with different initial values), SHA-3
    (Keccak-f[1600]) and SHAKE are implemented here. Each is checked twice: against
    the published vectors **and** against OpenSSL across the block boundaries.
  - **`crypto.subtle` needs a secure context**, and the page says so instead of
    throwing at the first click. Opened from a file or over plain `http:`,
    SHA-1/384/512 grey out with the reason while the eight this app implements
    keep working — SHA-256 included, since it exists on both sides.
  - **HMAC works for every algorithm**, not just the platform's: the generic
    construction runs over the local digests using each one's own block size
    (144, 136, 104 and 72 bytes for the SHA-3 family — not 64, which is the
    mistake waiting to be made).
  - **Salt and pepper print the formula they used.** There is no standard order,
    so `H(pepper ‖ salt ‖ message)` is shown and updates with the fields:
    "salted SHA-256" tells nobody how to reproduce a digest.
  - **A card that refuses to be misunderstood.** A salted SHA is not password
    storage — these algorithms are built to be fast, a GPU runs billions of
    guesses a second, and a salt only stops one precomputed table covering
    every account. It names Argon2id, scrypt, bcrypt and PBKDF2 instead, and a
    test asserts the wording is on the page.

- **Base64** (`/tools/base64/`): text and files in and out of base64, in four
  combinations — text or image, encode or decode. Nothing is uploaded and
  nothing is saved.
  - **It exists because `btoa` and `atob` are traps.** `btoa('café')` throws —
    it refuses anything above U+00FF — and `atob` fed something that is not
    base64 returns whatever it could make of the input rather than failing.
    Text here goes through `TextEncoder` (UTF-8, always) and every decode is
    validated first, with **the offending character highlighted in place** and
    the twelve characters either side of it for context.
  - **The type comes from the bytes, not the label.** A new magic-number
    sniffer identifies what an uploaded file or a decoded blob actually is, so
    a `data:image/jpeg` URL containing a PNG is reported as a PNG. Container
    formats are matched by brand (RIFF/WEBP, `ftyp`/avif) rather than by
    wrapper, and SVG — which has no magic number — is checked last, on the
    decoded head.
  - **The cost is stated, not implied**: every encode shows the before and
    after size and the percentage, and a file over a megabyte gets a note about
    what a data URL that size does to a stylesheet, a cache and a clipboard.
  - Four copy shapes for an encoded image — the data URL, the base64 alone, a
    CSS `background-image` line and an `<img>` tag.

- **Text analysis** (`/tools/text-analysis/`): paste text and get its counts,
  how hard it is to read, what it repeats, and seven ways to change its case.
  Nothing is saved and the page writes nothing.
  - **Four lengths, because they disagree.** Characters (what a reader would
    count), code points, UTF-16 units (what most languages call `.length`) and
    UTF-8 bytes — for a family emoji, 1, 7, 11 and 25 respectively. Plus words,
    unique words, sentences, paragraphs, lines, and how long the text takes to
    read silently or aloud.
  - **Four readability scores** — Flesch reading ease with its band,
    Flesch-Kincaid, the Automated Readability Index and SMOG — ported from
    [readn](https://github.com/Descent098/readn) **with its caveats attached**.
    An explainer prints each formula with this text's own numbers substituted
    into it, and the card says plainly that syllable counting is a heuristic,
    that sentence boundaries are guessed, and that a score is a smell rather
    than a measurement.
  - **SMOG stays blank until thirty sentences**, and says how many more it
    needs. That is the sample size the formula was fitted on; below it the
    number would be noise, and printing noise next to three real scores is how
    a page teaches something false.
  - **What it repeats**: the commonest words, pairs or triples, with a
    stop-word toggle. N-grams are built inside a sentence — a phrase that
    straddles a full stop is not a phrase.
  - **Seven transformations** — sentence case, Capitalize Each Word, lower,
    UPPER, s̶t̶r̶i̶k̶e̶t̶h̶r̶o̶u̶g̶h̶, W I D E and sPoNgEbOb — each working on whole
    characters, so an emoji or an accent survives being spaced out or
    alternated. The result appears in its own box: your text is never changed.
    - **Sentence case deliberately disagrees with the sentence counter**, and
      the reason is written down in both places. The Unicode rules refuse to
      break before a lower-case word, which is right for counting and exactly
      wrong for a transformation whose input is normally all lower case — so it
      walks the text itself, while still asking the shared tokenizer whether
      the word before the stop was a title. `dr. smith` becomes `Dr. smith`.

- **Similarity** (`/tools/similarity/`): score one word against as many others
  as you like, five ways at once, and see how each score was reached. A port of
  [speyl](https://github.com/Descent098/speyl) (MIT).
  - **Jaro, Jaro-Winkler, Levenshtein, Damerau-Levenshtein and Indel** in one
    sortable table, each with a percentage and its raw reading. They disagree
    on purpose: Indel forbids substitution, so it measures how much of two
    words is SHARED; Damerau charges one edit for a swap, because that is what
    a typo usually is.
  - **The working is shown, not just the answer.** For the three distance
    metrics the page draws the whole cost table with the cheapest route
    highlighted, and **Back**/**Next** walk that route one move at a time in
    words. For Jaro it draws both words with their matched characters marked,
    then the window, the matches, the transpositions and the prefix — and the
    formula with those numbers filled in.
  - **One table serves all three distance metrics**, because they differ only
    in which moves are legal. Writing them as three functions would have hidden
    the only interesting thing about them.
  - **"Damerau" here is optimal string alignment**, the variant nearly every
    library means, and its test pins the case that distinguishes it: `CA` to
    `ABC` is three edits here and two under the unrestricted definition.
  - **Two limits, both stated on screen**: 200 characters per word (these are
    words, not documents — the table is n×m) and 200 candidates.

- **Diff** (`/tools/diff/`): paste two texts and see exactly what changed.
  Compare by **line** (side by side or inline), by **word**, or by
  **character**; the summary counts insertions, deletions and changed lines and
  scores how alike the two texts are. Nothing is saved and the page writes
  nothing at any point.
  - **A rewritten line shows the rewritten words.** A removal immediately
    followed by an addition is a rewrite, not two unrelated events, so those
    rows are paired and diffed again at word level inside the pair. Otherwise
    changing one word reads as a red line and a green line, and finding the
    difference is left to the reader.
  - **"Ignore case" and the whitespace options change what counts as equal,
    never what is shown.** The comparison sees a normalised key while the page
    keeps your original characters — normalising the text itself would mean
    displaying a document nobody wrote.
  - **Two texts that differ only in their line endings are called out by
    name.** CRLF against LF is invisible on screen and otherwise reads as every
    line having been rewritten.
  - **The Patch card is a real unified diff** — `---`/`+++`, `@@` hunks with
    adjustable context, and `\ No newline at end of file` where git puts it —
    so it can be copied into a review or applied with `git apply`. Prism's
    `diff` grammar joined the one Prism entry point to highlight it.
  - **Both limits are stated on screen when they bite**: character comparison
    is capped at 40 000 characters across both boxes, and the table draws 2000
    rows (the patch still holds everything). Past a few thousand edits the
    algorithm stops looking for the shortest script and reports the middle as
    one wholesale replacement — **and says so**, because a fallback that looks
    like an answer is worse than no answer.
  - The engine is Myers' 1986 algorithm, hand-rolled in
    `src/lib/diff/myers.ts` over any token array, with the classic
    `ABCABBA`/`CBABAC` case and a hundred random reconstructions in its tests.

- **Two shared modules the 0.3.0 text and encoding tools are built on**, landed
  ahead of the tools themselves so every one of them counts and encodes the
  same way.
  - **`src/lib/text/tokenize.ts` is the app's one segmentation layer.**
    Graphemes, words, sentences, paragraphs, lines, syllables and the four
    numbers that all get called "length" — user-perceived characters, code
    points, UTF-16 units and UTF-8 bytes — come from here, so a count, a diff
    and a case transformation can never disagree about where a word starts.
    `Intl.Segmenter` does the work, which is what makes a ZWJ family emoji one
    character rather than eleven and lets text with no spaces in it be
    segmented at all; a regex fallback covers a runtime without it and says so
    through `segmenterAvailable()`.
    - **Sentence breaking is post-processed for abbreviations**, because the
      Unicode rules split `Mr. Smith` in two and a sentence count 30% too high
      drags every readability score with it. Titles and initials never end a
      sentence; the softer class (`etc.`, `p.m.`, dotted acronyms) ends one
      only when the next word starts with a capital — `5 p.m. tomorrow` runs
      on, `5 p.m. They left` does not.
    - **The syllable counter's mistakes are pinned in its tests.** There is no
      exact method without a pronunciation dictionary; the words this heuristic
      gets wrong (`business`, `poem`, `science`) are asserted as wrong, so a
      change to the rules cannot move every score in the app silently.
  - **`src/lib/encode/base64.ts` replaces `btoa`/`atob` for the whole app.**
    `btoa` throws on any character above U+00FF — `btoa('café')` is an
    exception — and `atob` fed something that is not base64 returns whatever it
    could make of the input instead of failing. So text goes through
    `TextEncoder`/`TextDecoder` (UTF-8, always), and every decode is validated
    first and reports **the offset in the original string** where the input
    stopped being base64, which is the one thing needed to fix a pasted token.
    Both alphabets, optional padding, MIME line wrapping, `data:` URL
    parse/build, and size predictions for the +33% everyone forgets.
    `secrets.ts` now re-exports from it rather than carrying its own copy.

## Other

- **Release 0.3.0.** `VERSION` and `package.json` agree at 0.3.0; every doc
  banner reads "as of v0.3.0 (schema v13)". Phase 14's closing audits, all
  against the release build: `npm test` and `npm run test:unit` green with
  the trust gate reporting its injected faults detected; the a11y sweep over
  every registered route plus a hand pass (keyboard and AA in both schemes)
  over the similarity matrix, the diff table, the Compose disclosure tree
  and the ASCII font picker — one finding, the font picker's radios had no
  group name and now carry `role="radiogroup" aria-label="Font"`; the payload
  guard; the offline suite with `math-fonts` and `drawing-fonts`; and
  `tools/audit-precache.mjs` over the build.

- **The service worker no longer holds navigations hostage to its first
  crawl** (cache `v32`; `v33` followed with the sidebar, whose shell lost the
  `preferences/` route). The background asset crawl ran inside `activate`'s
  `waitUntil`, so the worker stayed *activating* until the whole crawl
  finished — and a browser holds navigations and `new Worker()` script loads
  to an activating worker until it is activated. On a fresh install that
  meant sidebar clicks and the bcrypt worker hung for as long as the crawl
  ran: seconds on the 0.2.0 graph, so nobody saw it; minutes once
  Excalidraw's chunk joined the graph and its minified strings fed the crawl
  hundreds of `./fonts/…` and `./locales/…` paths that 404 (each with a 120 ms
  pacing delay), which is when two Playwright specs hung. The crawl now
  starts after activation without being awaited (the fetch handler's own
  `waitUntil` keeps the worker alive for it), and it only enqueues paths that
  look like build assets — one segment, with an extension — so the junk is
  never fetched. `tools/audit-precache.mjs` mirrors the rule.

- **One base64, finally** (Phase 14). The four hand-rolled `btoa`-in-chunks /
  `atob` encoders that Phase 0 left behind — notebook assets, the napkin-math
  web component's inlined fonts, the HTML export's maths faces and
  `dataUrlToBlob` — now call `lib/encode/base64.ts`. Folding them showed the
  shared decoder was 30× slower than `atob` on a 2 MB image (a regex per
  character, three times over), so the module got an ASCII fast path and a
  preallocated output; encode went from 127 ms to 5 on 2 MB (faster than
  `btoa`'s 57), decode from 130 ms to 22. Same bytes out, same 23 unit cases.

- **The service worker's font bucket also holds Excalidraw's faces.**
  `FONT_PREFIXES` gained `excalidraw/` beside `math/`: same cache, same
  cache-first-no-revalidate branch, same reasoning (stable, unfingerprinted,
  fetched by name at run time, so the asset crawl can never reach them).

- **Excalidraw's chunk is named.** Its package entry is `dist/prod/index.js`,
  so rolldown called its output `prod.*.js` and `chunk-XXXX.*.js` — names
  the `/excalidraw/i` payload matcher could not see, which made that guard
  vacuous. The one import of the package now goes through
  `src/lib/vendor/excalidraw.ts`, a bare re-export whose only job is to lend
  the dynamic chunk its name: `excalidraw.*.js`. (A rolldown `codeSplitting`
  group was tried first: with dependencies it dragged shared helpers into the
  chunk and every page imported 4.8 MB of Excalidraw statically; without
  them it is incompatible with Astro's `preserveEntrySignatures`.)

- **The install precache carries fonts** (service worker cache `v30`): the
  thirty-seven `.flf` files are unfingerprinted `public/` files,
  so the background crawl that discovers every other asset cannot see them, and
  a banner tool that only works online would be a strange thing to ship in an
  offline-only app. 596.5 KB for all thirty-seven, which is the largest thing
  in the shell by a distance and a deliberate trade: the alternative is a
  bucket of their own filled on demand, and then a font you have not previewed
  does not render on a plane. `tools/build-figlet-fonts.mjs` fails if a
  vendored font is missing from the shell list, and a unit test checks the
  same thing from the other direction.
  - One footnote for anyone editing `public/sw.js`: **no apostrophes inside the
    `SHELL` array**. `tools/audit-precache.mjs` reads that array by matching
    single-quoted strings, so a contraction in a comment reads as a path.
  - **The repository gained its first `.gitattributes`**, holding one line:
    `*.flf -text`. The fonts are pure text, so git would have autodetected
    them as source and rewritten their line endings on checkout under
    `core.autocrlf` — which would have failed every recorded checksum on a
    fresh clone on Windows, and meant the bytes the app serves were not the
    bytes we vouched for.

- **A bcrypt worker that stops answering now says so.** The full parallel test
  run turned up the one way that button could lie: if the worker's chunk never
  arrives — on a saturated connection, or a network that drops it — the page sat
  on "Working…" forever, which is indistinguishable from the frozen tab the
  worker exists to prevent. It now gives up after a minute, drops the worker,
  and reports that nothing was hashed.

- **`package.json` is back in step with `VERSION`** at `0.3.0`. The same drift
  appeared at the 0.2.0 bump and was closed then too: bumping `VERSION` is the
  memorable half of the pair, so both files are named in the release steps.
- **Forty-two documentation pages were stamped "as of v0.2.1 (unreleased)"**
  after 0.2.1 shipped. They now read v0.3.0 (unreleased; schema v12), and
  `build-and-tooling.md`'s two version paragraphs name the current headings.

- **The 0.3.0 wish list is now a plan.** `docs/dev/plans/version-3.md` stays as
  the raw list of what the release should contain;
  `docs/dev/plans/version-3-phased.md` is that list reviewed — fifteen phases
  that can each cut a release on their own, in the shape 0.2.0 used: the
  standing checklist, the decisions taken up front with their reasons, fourteen
  open questions each carrying a default the phase can proceed on, a phase
  overview table, and then a phase per tool with its scope, data model, tests,
  docs and changelog entries spelled out.
  - **Twelve new tool pages, one migration, two dependencies.** Only the Docker
    Compose builder owns documents (`compose_projects`, schema v13); everything
    else is stateless. `bcryptjs` and `figlet` are the only imports proposed,
    and each is argued at the phase that wants it — the diff, edit-distance,
    readability, MD5/SHA-2/SHA-3, cron and placeholder engines are all
    hand-rolled pure logic with published test vectors, which is the same call
    0.2.0 made about schema inference and validation.
  - **The parts that cannot be built as written are named rather than
    quietly dropped.** WebCrypto has no MD5, SHA-224 or SHA-3 and no
    finite-field Diffie-Hellman; `crypto.subtle` is missing entirely outside a
    secure context; SMOG needs thirty sentences before it means anything; and a
    salted SHA-256 is not password storage. Each has a phase item saying what
    ships instead and what the page must tell the user.
  - **A seventh standing-checklist item for this release:** nothing secret is
    persisted. The hashing, encryption and JWT pages write nothing to IndexedDB
    — not keys, not plaintext, not tokens — and their specs assert the database
    is byte-identical across the whole session, because a backup is one plain
    JSON file and a private key that reached it would stay there.

- **`README.md` and the documentation map caught up with 0.2.1.** The
  Playgrounds line now says the configuration playground tabulates a document
  into the searchable data grid and converts between JSON, YAML, TOML and CSV —
  both shipped, neither mentioned. `docs/README.md` gained the same sentence in
  its user-docs table, and its Plans section now lists `version-3.md`,
  `version-3-phased.md` and `far-fetched.md` alongside the older plans.

# 0.2.1 (2026-08-21)

## Features

- **The configuration playground converts between formats.** A **Convert**
  button beside Prettify opens a window that rewrites the document as
  **JSON**, **YAML**, **TOML** or **CSV**, in any direction: pick From and To,
  and the result appears syntax-highlighted with **Copy** and a **Download**
  named for its format. It converts as either dropdown moves, writes nothing,
  and never touches the document in the editor.
  - **Everything pivots through a plain value**, so no formatting detail can
    travel from the source into the target — and the window says plainly what
    that costs, under the result rather than in a footnote: comments belong to
    the text and do not survive, YAML anchors expand into copies, TOML dates
    become ISO-8601 strings, and CSV is a table rather than a tree.
  - **CSV has no types, so the reader does not invent any.** A cell becomes a
    number or a boolean only when the text round-trips exactly, which is what
    keeps `007`, `1.0` and `+1` as strings and a zip code intact. Writing CSV
    goes through the Data card's own tabulation, so the columns a conversion
    produces are the columns the page already showed you.
  - **Two shapes are refused by name** rather than approximated: TOML cannot
    spell a document whose root is an array or a scalar, and CSV needs rows to
    make.
  - New dependency **`smol-toml`** (MIT), imported inside the conversion so
    the parser never reaches the page until someone picks TOML — with a
    `TOML parser` matcher in `payload.spec.ts` standing over that. Prism's
    `toml` and `csv` grammars joined the one Prism entry point.

- **Pressing New note in the notebook now puts the caret in its title**, with
  `Untitled` selected, so typing names the note. The three shared fields
  (title, tags, Inside) are disabled for the few milliseconds between asking
  for a note and its fields arriving: that snapshot belongs to whichever note
  is open, so a keystroke landing in the gap renamed the note you were leaving
  — which is never what pressing New note meant. The body needed no lock; the
  editor already reports its changes against the note id it was mounted with.

- **The notebook's bulk operations moved into the library.** The **Note** /
  **Bulk** tab strip is gone and the page is always the note: every row of the
  sidebar tree now carries a **checkbox**, and ticking one raises the bulk
  panel at the top of that column, above the search box. It reports how many
  are ticked and offers **Clear**, **All** (every note — or, while a search
  narrows the tree, every note it found) and **+ Nested**, which grows the
  selection through the branches under it. Ticking a note never takes its
  children on its own: a folder here is a note, and "delete this" must not
  quietly mean "delete the twelve under it".
  - The four actions are unchanged in behaviour — export the selection as one
    `.zip` of Markdown or self-contained HTML, add or remove tags, move under
    one parent, delete with unselected children climbing to the nearest
    survivor — but they now act **without leaving the note**. The editor is
    never unmounted, the open note stays open and editable, and if an action
    retags or moves that note its **Tags** and **Inside** fields follow at
    once.
  - The result line is mounted outside the panel it reports on, because
    deleting the selection empties it and unmounts the panel: a receipt that
    vanished in the same tick it was written was no receipt at all, after the
    one action that most needs one.
  - Folding the library away now clears the selection. The checkboxes, the
    count and the actions all live in that column; a tick that outlived it was
    invisible state waiting for whoever opened the column back up.
  - The sidebar is `position: sticky`, so anything past the fold could not be
    scrolled to. With the bulk panel above the tree it now has a height cap and
    scrolls inside itself — and stops being sticky at all in the single-column
    layout under 52rem.

- **A delete button on every row of the notebook's library.** Beside the
  existing **+** (new note inside), an **×** deletes that row's note — the note
  the row names, not whichever one is open — through the same confirm and the
  same reparent-the-children rule as the Note card's Delete.

- **The notebook's note title is the card's header.** The separate **Title**
  field is gone; the header of the Note card is the field, typed in place. It
  is still one `<input>` (`bind:value`, the same 400 ms autosave, the same
  rename-and-alias path) inside an `<h2>`, so the page keeps its heading
  outline and a screen reader announces the note's actual name. The
  breadcrumb dropped its last crumb with it — it was repeating the title
  three inches below itself.

- **The secrets page is five fold-out categories**, with **Passwords** open and
  the rest folded, so twenty-seven generators open as a short contents list.
  Categories are independent — opening one does not close another — and a
  folded category is still generating, so one you open shows a value as fresh
  as the rest and **Regenerate all** reaches every card whether or not it is on
  screen. Nothing about which categories are open is remembered: this page
  writes nothing, and a disclosure is not the exception worth breaking that
  for.

## Other

- **`Card` gained two opt-in modes** rather than being forked twice. `heading`
  replaces the `<h2>` with a snippet, for a header that is a control rather
  than a word — the title-block voice is scoped to Card's own `<h2>`, so a
  snippet cannot inherit the uppercase-and-tiny lettering by accident and must
  bring its own type. `collapsible` renders the card as a native `<details>`
  with the header as its `<summary>`, `open` seeding the initial state, the
  marker drawn as the same ▸ / ▾ the notebook's tree turns, and the header's
  rule dropped while it is closed. Both are additive: every one of the app's
  other cards passes `title` and renders byte-identically.
- **`summary` joined the app's focus ring.** `global.css` stamped
  `input`/`select`/`textarea`/`button`/`a` with `--color-stamp` on
  `:focus-visible` and left `summary` out, so every disclosure in the app — the
  explainers on twenty pages, and now the secrets categories — focused with
  whatever ring the browser happened to draw. One selector; it is the same
  stamp everywhere now.
- **A collapsed `<details>` is not the same as absent.** The secrets accordion
  keeps its content in the DOM on purpose — the values stay generated and text
  assertions keep reading them — but a control inside one keeps a layout box
  while being unclickable, so `secrets.spec.ts` opens a category before
  touching `sec-opt-jwt-secret` or `sec-copy-wifi`. The a11y sweep is
  unaffected: its visibility test is `offsetParent !== null`, which stays true
  inside a closed `<details>`, so all 27 generators are still audited.
- Notebook testids: `notebook-tab-*`, `notebook-panel-*`, `notebook-bulk-count`,
  `notebook-bulk-filter`, `notebook-bulk-list` and `notebook-bulk-subtree-<id>`
  are gone; `notebook-bulk` (the panel), `notebook-bulk-select-nested` and
  `notebook-delete-<id>` (a row's ×) are new. `notebook-bulk-check`,
  `notebook-bulk-selected`, `notebook-title` and `notebook-note` are unchanged,
  and `notebook-note` still names the button that OPENS a note, never the
  checkbox beside it.

# 0.2.0 (2026-08-21)

## Features

- **Notebook** (`/tools/notebook/`): linked markdown notes. Write in a
  **WYSIWYG** canvas (Milkdown Crepe) or in **raw markdown** (CodeMirror) and
  read the rendered note in a third view; the markdown string is the one
  source of truth and the views are faces of it. Notes nest — a note's
  **Inside** picks its parent, **+** on a note starts one under it, and the
  sidebar is one tree with search over titles and tags. Autosave writes one
  patch 400 ms after the last change and flushes when the tab hides or the
  page is left; page load writes nothing.
  - **Links.** `[[Title]]` (or `[[Title|shown text]]`) links to the note with
    that title — in notes, and in timer, TODO and event descriptions too,
    since they share the one markdown renderer. A link to a note that does
    not exist yet is drawn differently, and clicking it creates the note;
    a deep link from outside to a missing note shows a **Create it** button
    rather than creating on load. **Linked from** and **Links to** are
    computed from the notes themselves, never stored, so a restored backup
    cannot leave them stale. Renaming a note keeps the old title as an
    **alias** so old links still resolve, and offers — once, as one button —
    to rewrite the notes that link by the old name.
  - **Footnotes**, ported whole from retoken with its 95 tests: `[^1]` cites,
    **Alt+0** opens the footnote dialog on the note under the caret (or cites
    a new one), the source view marks citation and definition lines in the
    gutter and jumps between them, and a definition that the WYSIWYG canvas
    cannot represent is harvested into the dialog and restored into the
    markdown on every round trip — nothing is lost in either direction.
  - **Diagrams** via a ◇ button: a mermaid workbench with eight templates,
    context-aware completion, and a live preview that keeps the last good
    picture while showing the parse error. **Maths** with `$…$` and `$$…$$`,
    typeset by KaTeX over the faces napkin-math already vendors. Images paste
    straight into the canvas and are stored with the note, capped at 2 MB
    each because a backup is one JSON file.
  - **Export.** **Markdown** is the source with images inlined as `data:`
    URLs. **HTML** is one self-contained file — its stylesheet, images,
    typeset maths with only the faces that page actually uses, and diagrams
    pre-rendered to SVG all inside it; it never references this app or any
    server, and a test checks that. **Print / Save as PDF** is the browser's
    print dialog over the app's first print stylesheet, which hides the
    chrome around the note; the filename comes from the note's title, the
    only thing a page can suggest to that dialog.
  - **Bulk tab.** A **Note** / **Bulk** tab strip above the main column; Bulk
    lists every note as a tree of checkboxes (filter by title or tag, select
    all / none, **all nested** to take a whole branch) and acts on the ticked
    notes only, one patch per row that actually changes: **Export** as one
    uncompressed `.zip` with a Markdown or self-contained HTML file per note,
    named after its title with `-2` on a clash (a small stored-ZIP writer
    with CRC-32 and UTF-8 names, no dependency — `src/lib/zip.ts`); **Tags** add (keeping each
    note's own, skipping duplicates) or remove (case-insensitively); **Move**
    under one parent or to the top level, never offering a selected note or
    anything inside it as a destination; **Delete** after a confirm, moving
    unselected nested notes up to their nearest surviving ancestor and
    tombstoning the deleted notes' images. The editor stays mounted behind
    the Bulk panel, and when the open note is among the selection its
    **Inside** and **Tags** fields follow the change so autosave cannot write
    the old value back.
  - **Editor chrome contrast.** Crepe paints every toolbar, block-handle and
    slash-menu icon (and carets and dividers) with its `--crepe-color-outline`
    token, which the theme had mapped onto the decorative hairline — about
    1.5:1 on paper and 1.4:1 on the blueprint. It is now the annotation ink
    (6.7:1 light, 5.4:1 dark), hover states are a visible primary tint rather
    than white-on-white, the placeholder is the same ink instead of 40 %
    text, and floating chrome gets the theme's ruled edge and square corners
    (the theme's `--shadow-1` is `none`, so a shadowless borderless popover
    was invisible against the sheet).

- **Configuration playground** (`/tools/config-playground/`): understand,
  validate and generate JSON and YAML. **Parse** mode takes a document in a
  syntax-highlighted editor with completion, sniffs the format (a leading `{`
  or `[` is JSON; a manual override covers the rest), lints it as you type — a
  **Valid** badge, or positioned errors in the gutter and under the editor —
  prettifies it, and extracts its schema into a Field/Type table: strings,
  integers, numbers, booleans, email / phone / URI / date / date-time formats
  spotted by pattern, enums when a few values repeat, optional keys, nullable
  values, nested objects, arrays of objects, and unions when a key's type
  varies. **Create** mode builds the same table by hand — add rows, pick types,
  nest objects and arrays — chooses JSON or YAML, and generates *n* sample
  documents from it. One **Switch** control moves between the two and the
  schema in hand survives the switch, so a hand-built schema can be checked
  against a real document: parse mode reports, field by field, how the pasted
  document fits it.
  - **YAML is the eemeli `yaml` package, not `js-yaml`.** `js-yaml` throws on
    the first error and discards comments, so a prettify pass would silently
    delete every comment in the document — data loss, not a formatting nit.
    `yaml` collects every error with character positions (they drop straight
    into the editor's diagnostics) and round-trips comments and anchors through
    prettify.
  - **The YAML 1.1 traps are called out.** A bare `NO` is a string here (YAML
    1.2) and `false` under a 1.1 parser — the Norway problem; `12:30` was the
    number 750 and `0123` was octal. Each is flagged with its line, along with
    integers past 2⁵³, `.nan` / `.inf`, anchors and aliases (shared structure
    is lost on the way to JSON) and non-string keys. Alias expansion is capped,
    so a pasted "billion laughs" document is refused rather than obeyed.
  - **Schema inference and validation are hand-rolled** — a few hundred lines
    of pure logic each. The npm options either do not merge across samples or
    compile schemas with `new Function`, which a hardened CSP blocks.
  - **Generated sample data is seeded and hand-rolled**: a mulberry32 PRNG over
    curated word lists, reserved example domains and 555-01xx phone numbers, so
    nothing generated ever names a real person or a reachable host. The same
    seed reproduces the same documents, and a property test generates a hundred
    and validates every one.
  - **Code generation**, in the same card shape as napkin math: a **parser**
    (validate a document and surface each field, every problem reported at
    once) or a **generator** (seeded samples), in **Python, JavaScript, Go or
    Rust** as plain typed functions whose docstrings list the fields — the
    schema is unrolled into explicit per-field checks, so the file documents
    the format it handles — or as a **dependency-free web component** that
    takes a pasted document, or a count and a button. The emitted files are
    standard library only, with one stated exception (the Rust parser uses
    `serde_json`) and two honest refusals (a YAML-format parser asks for the
    decoded data rather than pretending to parse YAML, and the web component
    accepts JSON input only). Tests load both components in a real page.
  - Schemas save to a searchable **library**, and the page remembers which
    mode and schema were open.
  - A **Data** card tabulates the document into the same data grid the SQL
    playground's results use — search, filter tree, sort, paging, CSV — an
    array as one row per record (nested objects become dotted columns) and an
    object as one row per key. It runs **only when pressed**: a large document
    would otherwise stall the page on every keystroke. Change the document
    after extracting and the card says the rows are stale rather than
    re-running behind your back.

- **Napkin math** (`/tools/napkin-math/`): write a formula and get a little
  calculator for it. Its variables become typed input fields — whole number or
  not, positive-only or not, zero allowed or not, required or not — the result
  updates as you type, and named calculations save beside the formula so you
  can come back to the numbers you ran through it. Templates live in a
  searchable library, and export and import as JSON.
  - **The fields come from the engine, not from a tree walk.** A sum from 1 to
    `n` asks for `n` and not its index; π r² asks for `r` and not π. Walking
    the expression gets both wrong and asks you to supply a value for pi.
  - **Code generation** turns a template into a real function in **Python,
    JavaScript, Go or Rust**, with the description as its docstring, the fields
    as typed parameters, and each field's rules as guard clauses — so the
    generated function refuses what the page refuses. Or into a
    **dependency-free web component**: one `.js` file, no build step, styleable
    from outside with `::part()`. A test loads that generated file in a real
    page and checks it computes the same answer the app did.
  - **An operator the generator has no rule for is refused by name** rather
    than guessed at. An integral is a perfectly good formula with no
    plain-function form, and the tool says so instead of emitting something
    that looks right.
  - **Where a language disagrees with the maths, the generated file carries a
    helper.** This page rounds a half away from zero; Python rounds to even and
    JavaScript rounds upward, so `-2.5` would otherwise come back as three
    different numbers. The remainder of a negative number is the same story in
    three of the four languages.

- **The SQL playground's two tables became real data grids.** retoken's
  `DataTable` is ported, and both the query results and the database browser now
  have a search box, an AND/OR filter tree (so `A AND (B OR C)` is expressible,
  not just a list), sortable headers, paging and CSV export. The **200-row
  results cap and the "add a LIMIT" hint are gone**, and so is the 50-row sample
  the browser used to show.
  - The two run in opposite modes, because of where the rows already are. The
    **results** grid works client-side over rows `exec` already returned, so
    filtering and sorting cost nothing. The **browser** compiles its filter tree
    to a parameterized `WHERE`, its sort to `ORDER BY`, and pages with a keyset
    seek when the table has a single-column primary key — so a million-row table
    pages without ever sending a million rows.
  - **The row count under the browser is now the real one.** It used to report
    the size of the 50-row sample it had fetched.
  - **A query that returns no rows now shows its columns.** A new
    `execDescribed` asks the engine what the result set's shape is, so
    `select id, name from t where 1 = 0` renders an empty grid with two headers
    rather than reading as a broken query.
  - None of it is saved: filters, sort and page reset when you switch tables,
    switch engines or reload. Loading a page and looking around still writes
    nothing at all.

- **Logo generator** (`/tools/logo-generator/`): square logos, app icons and
  avatars, ported from [retoken](https://github.com/Descent098/retoken)'s icon
  designer. **Generators** turn text into a picture — 31 DiceBear avatar styles
  or a Jdenticon identicon with its own hue, saturation, lightness, background
  and padding controls — and **Badge** composes one from a Lucide icon or an
  emoji on a coloured tile. Download SVG or PNG at any size, copy either to the
  clipboard, or hand the result to the SVG editor as a document to take apart.
  Nothing is stored: the output is a pure function of the settings, so the page
  writes to the database only when you press "Open in SVG editor".
  - Retoken's **Upload** and **SVG editor** tabs are not ported. This app already
    has image tools and a far better vector editor — both forks of the same
    lineage — so the logo hands off rather than carrying a second, weaker builder.
  - **The tool tells you what each style's licence asks for.** 14 of the 31
    DiceBear styles are MIT; 13 carry CC BY 4.0 artwork that must be credited
    wherever the logo appears; and 4 (avataaars and bottts, in both variants) ship
    under a bespoke "free for personal and commercial use" notice that is not an
    open-source licence. The map is committed data, because a browser cannot read
    `package.json` — so a unit test reads the installed packages and fails when an
    upgrade relicenses a style, rather than letting an owed attribution disappear.

- **Sprite editor** (`/tools/sprite-editor/`): pixel art on a character grid,
  ported from [retoken](https://github.com/Descent098/retoken). Every character
  in the grid paints one colour and the legend says which, so a sprite is a
  picture written as text — it reads as a diff, rides a backup unchanged, and
  pastes between projects. Drag or type to paint, arrow keys walk the grid, 4-48
  a side, eight animations in the preview, and fifteen creature examples to pull
  apart. Undo/redo covers everything, with one drag counting as one step however
  many pixels it crossed. Export as TXT, JSON, SVG or PNG (rasterized at its
  final size, so the pixels stay hard-edged), and import any sprite JSON —
  including retoken's own files.
- **Secrets** (`/tools/secrets/`): twenty-seven generators for passwords, keys,
  tokens and identifiers — strong and passphrase passwords, API keys, JWT
  signing secrets sized to their algorithm, AES keys, salts and IVs, Django /
  Laravel / Flask / WordPress secrets, UUID v4 and v7, MongoDB ObjectIds, Wi-Fi
  passphrases, TOTP secrets, recovery keys and backup codes. Each card shows how
  much entropy its value actually carries, computed from the alphabet and length
  in use. Nothing is stored, sent, or put in the address bar: values live in the
  tab until you replace them.
  - Characters are drawn by **rejection sampling** over `crypto.getRandomValues`.
    Taking a random byte modulo an 88-character alphabet — the obvious way, and
    what the site this catalogue came from does — makes the first 80 characters
    half again as likely as the last 8.
  - Identifiers are labelled as identifiers rather than given an entropy figure.
    A UUID is unique, not unguessable, and printing "122 bits" beside one invites
    somebody to use it as a session token.
  - **UUID v7** is offered beside v4: its first 48 bits are the timestamp, so ids
    sort by creation time instead of scattering through an index. There is no
    native API for it, so it is built here, counter included so two minted in the
    same millisecond still increase.
  - **No WEP**, and the page says why: it has been breakable in minutes since
    2007. The TODO asked for WEP and 160/504-bit WPA keys because
    randomkeygen.com used to offer them — that site has since been rebuilt and no
    longer does.
- **Week and day calendar views.** The calendar gained Month / Week / Day.
  Week and day lay the hours down the page: timed events sit at their time and
  are as tall as they are long, entries that overlap share the width side by
  side, and all-day events, multi-day spans and TODOs with no time sit in an
  all-day lane above the hours. Dragging onto the hours sets the **time** as well as the
  day — snapped to the quarter hour, with a line showing where it will land, and
  the event keeps its length — while a drop on the month grid still changes only
  the date. Every empty hour is a real button, so creating an event at a time is
  a keyboard path and not only a drag. All three grids share one position, so
  switching from month to week lands where you were looking rather than jumping
  back to today, and the choice is remembered in its own preference.
- **Week starts on Sunday or Monday**, your choice, in Preferences — read by the
  month grid and the week grid alike.
- A multi-day event now appears on every day it covers in the week and day
  grids. The month grid only ever showed it on its start day.
- A TODO with a time of day sits **at that time** in the week and day grids,
  beside the events, rather than in the all-day lane — the lane is for things
  with no time, so a TODO goes there only while it has a date and no time.
  Adding a time moves it out of the lane immediately, clearing one puts it
  back, and dragging one into the lane is a way to remove its time.
- **Events repeat.** A calendar event takes the same repeat rule TODOs have —
  every N days/weeks/months, or chosen weekdays — with an optional end date,
  and every occurrence shows on the calendar marked with a ↻. Only ONE row is
  ever stored: occurrences are computed as the calendar draws them, so a series
  that repeats forever costs the same as a one-off and there is no list of
  future copies to maintain. (A repeating TODO still spawns its successor when
  you complete it; an event has no "done", so it had to work the other way.)
- Changing or deleting one day of a series asks what it applies to — **this
  event**, **this and following**, or **all events** — with Google's semantics:
  a day you changed on its own keeps its own values when the series is edited
  later. Dragging one occurrence to another day is "this event", and costs
  exactly one new row; the series itself is not touched.
- A repeating event keeps its **time of day across daylight saving**: a 09:00
  meeting is at 09:00 on both sides of the change. Occurrences are worked out in
  the device's current timezone, so travelling moves the series to your new
  local time. "Every month" from the 31st gives Feb 28, Mar 31, Apr 30 — the
  step counts from the original date rather than compounding the clamp.
- Notifications understand series: the due scan asks for each event's next
  occurrence and keys its notice per occurrence, so next week's meeting is a
  separate banner and an occurrence you edited is not announced twice.
- TODO recurrence gained the same optional **Until** date, through a repeat
  editor now shared by both.

- **Image editor: colour fills carry transparency.** A fill layer takes any CSS
  colour you can write — `transparent`, `rebeccapurple`, `#ff000080`,
  `rgb(255 0 0 / 50%)`, `oklch(…)` — with an alpha slider, a preview swatch over
  a transparency checkerboard, and Transparent/White/Black shortcuts. The
  canvas always rendered these correctly; what was missing was any way to reach
  them, and a native colour picker that quietly flattened alpha every time you
  used it.
- **Transparent layers**: "+ Transparent layer" adds a fill that paints
  nothing — a hole to draw into, or a tint slot to fill in later. A blank
  canvas started as "Transparent" now gets a real `Background` layer too
  (previously it got no layers at all, which made the background the one thing
  in the document you could not recolour, hide or delete).
- The layer list's colour dots sit on a checkerboard, so a translucent or fully
  transparent fill reads as what it is instead of blending into the row.
- A colour that is not a colour now paints **nothing** instead of solid black.
  Canvas ignores an unassignable `fillStyle` and keeps whatever the context had,
  which in a fresh buffer is opaque black — so one typo in a fill, stroke, arrow
  or text colour used to drop a black rectangle over the picture.
- Exporting as JPG says so when the picture actually contains see-through
  pixels — read from the rendered image, not guessed from the layer list, so it
  is not on permanently for a document whose transparency is covered up.

## Bug Fixes

- **The post-install "make it work offline?" offer could come back after you
  answered it.** It recorded the answer only from the "Not now" button, so
  closing it with Escape left no trace and the next launch asked again — and
  finishing the download inside the dialog did not count as an answer either.
  Every exit from the dialog now records one, exactly once.
- **Importing a backup preselected the destructive option.** "Restore" (which
  empties every table the file covers before loading it) was the mode already
  chosen when you reached the Import button; **Merge** is now the default, and
  `importData()` defaults to merging too — a caller that forgets the argument
  should not be able to wipe a device. Restore is one click away and still
  behind its confirmation.
- Searching for "heic" no longer lands on the image converter, which cannot
  decode HEIC — an alias that takes you to a tool that will refuse your file is
  worse than no result.
- `SyncFields.field_updated_at` carried a comment claiming nothing consumed the
  per-field stamps yet. `foldFieldMerged` has consumed them since 0.1.0, and the
  data suite proves it; the comment now says what the code does.

## Other

- Database schema **v12**: new `notes` (field-merged; title, markdown body,
  aliases, tags with the schema's first multiEntry index, and a
  self-referencing `parent_id` — folders are notes) and `note_assets`
  (images as base64 with their size, keyed to the note and deleted with it),
  plus `preferences.notebook_last_note_id` and `preferences.notebook_mode`.
  JSON-native, so rows ride backup export/import; a stored row is normalised
  on read and a missing, self or cyclic parent reads as root, because the
  generic data suite writes exactly that.
- **The markdown renderer grew hooks** and kept its unconditional sanitizer:
  `[[wiki links]]`, GFM footnotes, `$maths$` placeholders (typeset later by
  KaTeX, lazily), ```` ```mermaid ```` fences (drawn later by mermaid,
  lazily), and an image resolver — behind one `renderMarkdown(md, options)`
  whose defaults leave every existing caller rendering as before, wiki links
  included. retoken's remark/rehype/Shiki renderer was not ported: it has no
  sanitizer, and a backup file is an untrusted input.
- New dependencies for the notebook: `@milkdown/crepe` + `@milkdown/kit`
  (MIT; the WYSIWYG editor, which brings ProseMirror and Vue's runtime — the
  page's editor chunk is 1.3 MB minified, 410 KB gzip, and KaTeX rides inside
  it because Crepe imports it statically), `katex` (MIT), `mermaid` (MIT,
  95 KB core plus a chunk per diagram type, all lazy; its flowchart-maths
  chunk carries a nested KaTeX 0.16 of its own, 259 KB, fetched only when a
  diagram needs it), `@codemirror/lang-markdown`, `@codemirror/language-data`,
  `codemirror-lang-mermaid`, `@codemirror/autocomplete` and
  `@codemirror/commands` (MIT). All sit behind the notebook page's own
  island; the payload suite guards Milkdown/ProseMirror, mermaid, KaTeX and
  Excalidraw (deferred) off every other route.
- **KaTeX shares napkin-math's fonts.** Its twenty faces were already
  vendored byte-identical, so maths costs one more file — `public/math/
  katex.css`, the layout rules of `katex.min.css` with its `@font-face`
  block stripped (19.6 KB), written by the same `tools/build-math-assets.mjs`
  with provenance. It rides the existing `useful-fonts-v1` bucket and the
  existing **Maths fonts** offline bundle (now 22 assets, 282 KB). Crepe's
  own stylesheet is imported part by part, skipping the one that would pull
  KaTeX's full stylesheet and sixty hashed font files into the build.
- **The app's first print stylesheet.** `@media print` hides the topbar,
  sidebar and drawing-sheet marks, drops the grid background, lets `pre`
  wrap, keeps figures and tables whole, and pins exact colours for code —
  which improves printing every page, not only notes.
- Settings → Storage now shows the browser's usage and quota estimate, since
  images in notes are the first feature that grows it.
- Service worker: `tools/notebook/` added to the precached shell, cache
  bumped to **v17**.
- **Release hardening (Phase 11).** The a11y sweep is registry-derived and
  audited all 28 routes, the eight new pages included, with nothing added by
  hand; the payload guard was re-run against the real build — MathLive,
  DiceBear, Lucide, Milkdown / ProseMirror, mermaid and KaTeX stay off every
  page that does not use them; the offline suite passed with the `math-fonts`
  bundle (22 assets, 282 KB) registered and sized; `SHELL` in the service
  worker and the registry were cross-checked and hold the same routes; every
  doc's "describes the code as of" line now names the release and schema v12,
  and the stale claims that the a11y `ROUTES` list is hand-maintained, that
  `package.json` lags `VERSION`, and that the build emits ~73 `_astro/` files
  were corrected.
- **The background crawl no longer pulls the SQL engines' binaries.** A new
  `tools/audit-precache.mjs` replays the service worker's crawl statically
  over `dist/` (reading `SHELL`, the cap and the skip rule out of `sw.js`);
  run against the 0.2.0 build it showed the paced background crawl reaching
  340 files and **33 MB**, 16.8 MB of it Postgres and SQLite wasm / data that
  the engines' worker chunks reference — so every install quietly downloaded
  Postgres, and unticking "Postgres engine" in Settings → Offline stopped
  nothing. `CRAWL_SKIP` (`.wasm` / `.data`) now leaves those four files to
  the engine bundles that own them; the crawl reaches 336 URLs and 16.5 MB of
  code, the build emits 309 files under `_astro/` against a cap of 600. Cache
  bumped to **v18**.
- `package.json` `"version"` is `0.2.0`, in sync with `VERSION`; the release
  checklist now names both.
- Database schema **v11**: new `config_schemas` (name, format, the Field/Type
  tree as JSON, the parse-mode source text), plus
  `preferences.config_last_mode` and `preferences.config_last_schema_id`.
  JSON-native, so rows ride backup export/import; a stored row is normalised on
  read and never trusted.
- New dependencies for the config playground: `yaml` (ISC),
  `@codemirror/lang-json`, `@codemirror/lang-yaml` and `@codemirror/lint` (all
  MIT). The page's own chunk is ~197 KB minified with the YAML parser inside
  it; the two language packages and the linter load lazily into the editor's
  language compartment as one bundle, so no other route pays for any of it.
  All are fingerprinted chunks the service worker's crawl finds, so there is
  no new offline bundle.
- Service worker: `tools/config-playground/` added to the precached shell,
  cache bumped to **v16**.
- New `src/lib/config/` (model, inference, formats, validation, generation,
  parsing) and two new files under `src/lib/codegen/` (`config.ts`,
  `configWebcomponent.ts`) — phase 9 extends the code generator by importing
  from it, not by editing it.
- **Napkin math: saving a calculation no longer refuses silently.** The button
  was live, the template had never been written, and the only clue was a
  transient line at the far end of a long page. Saving a calculation now saves
  the formula with it — under "Untitled" if it has no name yet — and a template
  needs only a formula, not a name.
- Napkin math: fields gained a **description**, shown beside the input and
  carried into every language's generated docstring. `NapkinField` is inside a
  JSON column so this needed no migration, which is exactly why every reader
  normalises a field it loads.
- Napkin math: **whole-number** is a "No decimals" checkbox rather than a
  two-option dropdown, and an untouched required field no longer shows a
  complaint that crowds out its own description.
- Napkin math: the generated code, the live template JSON and the import box
  are **syntax-highlighted**. Prism for the read-only output; the import box
  keeps a real textarea with a highlighted underlay behind it, so selection,
  undo and paste all still work.
- **Generated docstrings follow each language's own convention**: NumPy-style
  sections for Python, the `# Parameters` block form for Go, terse `///` lines
  for Rust that leave the type to the signature, JSDoc for JavaScript. The
  formula is emitted as Markdown maths (`$\(costPerMonth*12\)*years$`) rather
  than the editor's `\left(\mathrm{...}\right)`.
- Two generator bugs found by reading the output: **Go identifiers were
  snake_case** (which `gofmt` will not fix and every linter flags — they are now
  camelCase with an exported function name), and **`toCamel` destroyed an
  existing camelCase name**, turning `costPerMonth` into `costpermonth` in both
  Go and JavaScript. Plus one that would not have compiled at all: **Rust
  cannot compare an `f64` with an integer literal**, so its guards now use
  `0.0`.
- **Sums, products and integrals now generate code.** Each becomes a small
  emitted loop helper taking the bounds and a closure over the bound index —
  `lambda x:` in Python, `(x) =>` in JavaScript, `func(x float64) float64` in
  Go, `|x: f64|` in Rust — so one helper per operation covers every occurrence
  and the closure captures the outer parameters itself. A bound index that
  would shadow a parameter is renamed. An integral is Simpson's rule with 1000
  intervals and the generated code says so: exact for low-order polynomials,
  approximate otherwise, which is also how this page evaluates one.
- The formula box gained **insert buttons** for sum, product, integral,
  fraction and root. Each drops a skeleton that already parses and already has
  bounds, so the field list appears at once — through the mathfield's own
  `insert` command, so it lands at the cursor rather than replacing the value.
- **The Code card forgets a formula when the formula changes.** Generated
  source, and especially a refusal like "this formula uses Sum", describes one
  formula; it used to stay on screen while the reader typed a different one,
  and after starting a new template. It now clears on every formula change, on
  opening another template, and on New.
- **A generated web component using a sum, product or integral threw
  `ReferenceError: _sum is not defined`.** The loop helpers were added to the
  emitter's one table and the web component generator kept its own
  hand-written copy of two others, so a helper added in one place was silently
  missing from the other. There is now a single exported table, and a test
  that walks the generated source asserting every `_name(` it calls has a
  matching `function _name(` — a general guard, so the next helper is covered
  without anyone remembering to cover it.
- **The maths fonts in a web component are now opt-out.** They stay on by
  default, because one file that works anywhere is the right default. Turning
  them off drops a component from about 78 KB to 15 KB and reveals **Download
  the shared fonts stylesheet** — one file with all twenty faces that a page
  links once and every component on it picks up, because `@font-face` belongs
  to the document rather than to a shadow root. Without any faces a component
  still lays out correctly; it just draws in the page's serif. The steps are in
  the tool's own "what the generated code does and does not do" note.
- **The generated web component now shows a typeset formula**, not
  `$\(costPerMonth*12\)*years$` as text. The markup comes from
  `convertLatexToMarkup` in MathLive's main entry — already loaded on that page,
  so it costs nothing extra — and travels with MathLive's layout rules and the
  handful of KaTeX faces the formula actually needs, embedded as `data:` URIs
  inside the component's shadow root. Which faces those are is measured by
  rendering into a throwaway shadow root and reading back the computed
  `font-family`, rather than mapped from class names that would go stale. A
  plain-name formula is one face and about 48 KB; a fraction with single-letter
  variables is two and about 71 KB. A test loads the result on a page that has
  never seen MathLive and asserts it renders and makes no network requests.
- The generated web component **no longer says "x is required" before anyone has
  typed anything** — an empty required box means "no answer yet", the same rule
  the page itself now follows.
- The generated web component's header shows a **worked styling example**
  instead of naming its parts in prose, and a field description becomes the
  `title` on its input.
- Database schema **v10**: new `napkin_templates` (name, description, formula as
  both LaTeX and MathJSON, fields as JSON) and `napkin_calculations`
  (`template_id` FK, name, values, result), plus a
  `preferences.napkin_last_template_id`. Both stores are JSON-native, so they
  ride backup export/import. Deleting a template soft-deletes its calculations
  first — a calculation whose template is gone is unreachable.
- New dependencies for napkin math: `mathlive` (MIT, 801 KB chunk, 217 KB
  gzip) and `@cortex-js/compute-engine` (MIT, 2.53 MB chunk, 695 KB gzip —
  it is a full computer-algebra system, and the larger half of the pair). Both
  are `import()`ed inside the mathfield wrapper's mount, so no other route pays
  for them, and the **offline footprint grows by roughly 3.6 MB** once the
  service worker's crawl has cached both. **The Compute Engine is a
  direct dependency, not a transitive one**: MathLive bundles no import of it
  and looks it up on a global instead, so without importing it explicitly
  `getValue('math-json')` silently returns an empty expression.
- The **20 KaTeX faces** (263 KB) are vendored into `public/math/` by a new
  `tools/build-math-assets.mjs`, with per-file hashes in a provenance file that
  a unit test checks the byte total against. They get their own cache bucket
  (`useful-fonts-v1`) outside the app-cache prefix, so a cache-version bump does
  not evict them, and their own entry in Settings → Offline — the service
  worker's asset crawl walks fingerprinted chunks and cannot find a file
  referenced from a stylesheet's `url()`. Service worker cache bumped to **v15**.
- **MathLive's 259 built-in text shortcuts are switched off.** Any one whose
  trigger appears inside a variable name fires mid-word and corrupts the
  formula: typing `sqrtish` produced `\mathrm{\sqrt{ish}}` and typing
  `count*rate` produced `\mathrm{count\cdot rate}`, neither of which parses.
  Dropping only the offending entry fixed one case and not the other, and a
  shortcut timeout fixed neither. The cost is that `pi` no longer becomes π as
  you type; `\pi` and the virtual keyboard still do.
- The keypress sounds (227 KB of `.wav`) are never fetched, and a Playwright
  check asserts it — including on the "plonk" path an invalid keystroke takes.
- **Two bugs fixed in the port rather than inherited**, both in retoken's
  paging:
  - `SELECT count(*)` ran on every cursor seek. It is the one full scan left in
    that path, it is exactly what keyset paging exists to avoid, and its result
    was dead in that mode. It now runs only when a page number needs it, and the
    footer's row count is a separate, unfiltered count run once per table
    selection rather than once per page.
  - A NULL in the sort column made **Next** serve page one forever. The seek
    builder returned an empty clause for three unrelated situations — page one,
    no key value, and a NULL sort value — and only the first is benign; the
    other two produced a query byte-identical to page one while the pager
    believed it had advanced. It now reports `seekable: false` and the caller
    falls back to `LIMIT/OFFSET` under the *keyset* ordering, so the fallback
    page's boundaries line up with the pages either side of it.
- **Postgres needs `::text` before a text operator.** `lower()`, `trim()`,
  `ILIKE` and `~*` all take text, and Postgres raises rather than coercing when
  handed a `uuid`, an enum or `json` — which every table with a non-integer
  primary key hit on the first filter. The cast is applied to the identifier
  only, never to the bound placeholder (`$1::text` confuses parameter type
  inference) and never in the keyset seek (a bare `"id" > $1` is what
  index-seeks). SQLite emits no cast.
- **`toNumber('100 USD')` used to be `NaN`.** The strip pattern read `+-e` as a
  character range, keeping `A`-`Z` and `a`-`e`, so a number filter against a
  string-money column silently matched nothing. Fixed, with an explicit
  no-digits guard — stripping correctly makes `'abc'` reduce to `''`, and
  `Number('')` is `0`. `'100 EUR'` is still `NaN`, because a trailing `E` is a
  legal exponent marker.
- **Blanks now sort last in both directions**, agreeing with the `NULLS LAST`
  the SQL side emits either way. The comparison function was already right; its
  caller negated it for a descending sort.
- New shared module `src/lib/table/` (`types`, `format`, `filter`, `csv`,
  `to-sql`) with 193 ported Vitest cases, plus `src/lib/sql/table-schema.ts` (8)
  and a new `src/lib/sql/infer-schema.ts` (12). It has exactly one consumer
  today and imports nothing outward, so it stays a self-contained layer.
- Worker protocol gains `execDescribed` and `tableMeta`, both optional on
  `DatabaseSession` so an engine without them degrades to `exec`/`tableData`.
  `tableMeta` is what stops the browser fetching and discarding 50 rows on every
  table switch and after every run.
- New dependencies for the logo generator: `@dicebear/core` + `@dicebear/collection`
  (MIT code; 31 styles as one 2.0 MB lazy chunk, 672 KB gzip), `jdenticon` (MIT,
  328 KB chunk) and `lucide-static` (ISC, ~2,000 icons, 826 KB chunk). All three
  sit behind `import()` and each memo is cleared on failure, so a flaky fetch
  retries instead of wedging the tab; only DiceBear arrives with the page,
  because its avatar is the default view. The service worker's background crawl
  precaches them, so the **offline footprint grows by roughly 2.8 MB**.
- Service worker: `tools/logo-generator/` added to the precached shell, cache
  bumped to **v14**.
- The **EFF Long Wordlist** (7,776 words, CC BY 3.0 US) is vendored for the
  passphrase generator by a new `tools/build-wordlist.mjs`, which refuses to
  write unless it parses exactly 7,776 unique words. It is 78 KB and only one
  card needs it, so it loads separately from the page.
- `dragdrop.ts` hands each drop zone its own element to its `onOver`/`onDrop`
  callbacks. The pointer event they already received is the window-level move,
  so its `currentTarget` is not the zone and cannot be measured — which is what
  a drop that means "08:15 on Thursday" needs.
- Database schema **v9**: new `sprites` store (name, size, rows, legend);
  `preferences` gains `sprite_last_doc_id`. Text-only, so sprites ride backup
  export/import like SVG documents. Nothing read from a stored row is trusted:
  the grid is squared and the legend filtered to single characters mapping to
  colours the strict allowlist accepts, because a backup is hand-editable.
- Database schema **v8**: `events` gains `recurrence`, `exdates`, `series_id`
  and `original_start`, plus an index on `series_id`. Existing rows are read
  with defaults rather than rewritten — a backfill on load would be a write on
  load. Backups from v8 will not import into 0.1.0 builds, as designed.
- **Colour fields can carry alpha.** `ColorField` gained opt-in `alpha` and
  `showSwatch` props: a slider that edits the alpha channel, and a preview
  swatch over a transparency checkerboard. A native `<input type="color">`
  cannot express alpha and used to flatten it away on every pick — it now
  preserves whatever alpha is set. Both props default off, so the six existing
  callers are unchanged.
- `setAlpha()` and `resolveFillStyle()` in the colour library: the first
  replaces a colour's alpha and re-emits it **in the spelling it was written
  in** (hex stays hex, `oklch()` stays `oklch()`, a named colour becomes
  `rgb(… / a)` while translucent and takes its name back at alpha 1); the
  second returns a canvas-safe fill or `null`, so an unparseable colour can be
  skipped rather than silently painted opaque black.
- The accessibility sweep now derives its route list from the tool registry
  instead of a hand-maintained copy beside it. A page forgotten in that list
  used to ship unaudited while the suite stayed green; registering a tool is now
  all it takes to be audited.
- `--font-mono` is defined. Ten files asked for it and nothing declared it: two
  had no fallback and silently inherited. It is an alias of the (monospace)
  body face, so nothing looks different today, and one line changes if that ever
  stops being true.
- A shared `.checkerboard` utility for transparency backdrops, replacing the
  copy-paste gradient that had spread to four components.
- `package.json`'s version had drifted to `0.1.0` while `VERSION` said `0.2.0`;
  they are back in step.

- **The app is documented.** [docs/](docs/README.md) now carries a page per
  system for maintainers and a page per feature for users — 9 `docs/dev`
  overview pages (architecture, data layer, preferences, app shell, design
  system, service worker and offline, notification engine, testing, build and
  tooling), 9 `docs/dev/tools` pages, 11 `docs/user` pages that each end in the
  gotchas that feature carries, and an index. 39 mermaid diagrams cover the
  flows worth drawing (the backup import algorithm, the service worker's fetch
  handler and warm crawl, recurrence and rank ordering, the raster compositor,
  the SQL worker protocol, autosave and its flush paths); every diagram was
  parsed with mermaid itself and every internal link resolved, mechanically.
  Each page was written from the source and then fact-checked against it by a
  second pass, which is where most of the corrections came from.
- **0.2.0 is planned**: [docs/dev/plans/version-2.md](docs/dev/plans/version-2.md)
  splits the TODO's feature list into twelve phases that can each cut a release
  on their own, with the decisions taken up front (self-hosting, lazy engines,
  virtual recurrence expansion, one sanitized markdown path, `window.print()`
  for PDF), sixteen open questions each with a default, and per phase: scope,
  data-model delta, dependencies with their real sizes and licences, tests, docs
  and CHANGELOG lines. The hand-drawn UI sketches for napkin math and the
  configuration playground are kept alongside it in
  [docs/dev/plans/sketches/](docs/dev/plans/sketches/).
- README: added a Documentation section, and corrected "the schema lives in two
  places" to three — the `TABLES` mirror in `tests/local/helpers/schema.ts` is
  what extends the round-trip, isolation and invariant suites to a new store, so
  a store missing there is a store nothing tests.

# 0.1.0 (2026-08-15)

- Initial release: data model created (`preferences`) and project generated with [local-sync-template](https://github.com/Descent098/local-sync-template).

## Features

- App shell: collapsible sidebar (grouped by category, collapse state persisted, off-canvas drawer with hamburger below 64rem) replaces the flat navbar; existing Settings and Preferences pages retained.
- Quick-action palette: `ctrl+k` / `cmd+k` (plus a visible header search button for touch) with fuzzy search, full keyboard navigation, focus trap, and focus restore.
- Tool registry (`src/lib/registry.ts`): single source of truth (name, aliases, category, route, icon) driving the sidebar, the home screen tiles, and the palette — adding a tool there is all future phases need for navigation and search.

- Blueprint design system (plain CSS): light theme is dark-blue ink on white drafting paper, dark theme is chalk-white lines on a cyanotype blue field. Two-scale graph-grid page background, content column framed as a drawing sheet (heavy rule + dashed offset trim mark) that signs off with a title-block footer (`SHEET UF-001 · REV A`), square corners everywhere, letterspaced uppercase drafting annotations, corner registration marks on cards, hatched disabled states, ink-wash overlay scrims, and a single amber "stamp" accent reserved for state and identity (focus rings, active markers, the brand arc). Branding: drafting-compass favicon (plus a dedicated maskable variant that survives circular masks), compass wordmark glyph, `DWG · UF-001` sheet code, and matching PWA manifest colors. Contrast verified numerically in both themes (text ≥ 4.7:1 AA, control boundaries ≥ 3.8:1).
- Stroke-icon system replacing emoji: hand-inlined Lucide glyphs (`src/lib/icons.ts`) rendered by a small `Icon.svelte` in the sidebar, home tiles, and palette; a unit test guards that every registry icon key resolves.
- **Timers** (`/tools/timers/`): multiple concurrent countdown timers with labels and markdown descriptions, per-timer completion actions (sound, vibration where supported, notification with in-context permission), pause/resume, and finished timers kept as re-runnable presets. Running timers store an absolute deadline — no per-tick writes, so they survive reload, navigation, and background-tab throttling without drift. Saving a timer remembers its completion settings as the defaults for the next one.
- **Timer alarm engine**: an always-mounted island (persisted across view transitions) fires sound/vibration/notifications while the app is open in any tab, and surfaces completions that elapsed while the app was closed (or the machine slept) as MISSED banners on the next visit. Documented limit: with no server there is no push, so nothing can fire while the app is fully closed.
- **Stopwatch** (`/tools/stopwatch/`): start/pause/resume/reset with lap list (splits + totals), persisted as a singleton so it keeps counting across reloads; writes happen only on user actions.
- **Timezones** (`/tools/timezones/`): convert a wall-clock time between any two IANA zones using the browser's built-in tz database (DST-correct), with fuzzy zone search, "my zone" shortcuts, swap, and offset labels; the last-used pair is remembered. Arbitrary-city lookup ships via a bundled GeoNames dataset (~34k cities with population ≥ 15k, CC BY 4.0; regenerate with `tools/build-city-dataset.mjs`) loaded lazily as its own ~1.4MB chunk on first city search and cached for offline by the service worker. Zone validity is checked by Intl constructibility, not list membership, so alias zones like `Europe/Kyiv` work end to end.
- Timer options: a **Save & start** button arms the timer in one step; a per-timer **Delete when finished** option makes one-shot timers clean themselves up after firing (soft-delete — the tombstone and the completion banner both survive). Both are remembered in the preferences defaults alongside the completion actions.
- Alarm loop: a finished timer keeps ringing/vibrating until its banner is dismissed or the timer is used again (Run again / Reset interrupt it), capped by a configurable duration (`timer_alarm_seconds`, 1–25s, default 25). The banner itself persists until dismissed and pulses while ringing.
- Editable Preferences panel: timer completion defaults, the alarm duration, and a new `auto_remember_based_on_last_value` switch (on by default) are now set directly on the Preferences page; with auto-remember off, saving a timer no longer overwrites the chosen defaults. Last-used values (timezone pair) display read-only.
- Database schema v3: new `timers` store and `stopwatch` singleton; `preferences` gains timer-default and last-zone-pair fields. Backups from older versions import cleanly; backups from v3 are rejected by older builds as designed.
- **Scheduler** (`/tools/scheduler/`): events and TODOs in one tool with three views — list, kanban board (fixed TODO → In progress → Completed columns), and a month calendar showing events plus dated TODOs. TODOs carry markdown descriptions, due date with optional time, priority, per-TODO due notifications, and threaded timestamped comments (child rows). Recurring TODOs are donetick-style: the rule lives on the TODO, and completing one creates exactly one successor inside that action — never on render (oracle-verified: reloads write nothing). Board ordering uses fractional rank keys, so reordering a card writes exactly one row (arrow buttons; drag is a future refinement). Deleting a TODO tombstones it and its comments. The last-used view is remembered.
- Scheduler notifications ride the persistent engine: a banner (and system notification, where permitted) fires at a TODO's due time and an event's start while the app is open; the due scan keeps its fired-state in memory and never writes.
- Database schema v4: new `events`, `todos` (field-merged, indexed on status/due date), and `todo_comments` (foreign key to `todos`) stores.
- Scheduler detail modal (native `<dialog>`, focus-trapped): creating a TODO/event now opens a modal, and clicking an existing item — a calendar entry, a list title, or a board card title — opens it in READ view (rendered markdown, attributes, and the TODO's comment thread) with a pencil to switch to edit. Calendar entries gained true drag-and-drop rescheduling (events keep their time of day and shift their end by the same delta; TODOs move their due date; one row per drop, same-day drops write nothing) and wiki-style hover previews showing rendered markdown after a short delay.
- Board drag-and-drop: cards drag between columns (running the same complete path as the buttons, so recurrence still spawns) and reorder positionally within a column — one row written per drop, no-op drops write nothing. The arrow buttons remain for keyboard users.
- **Programming** (`/tools/number-conversion/`): binary, octal, decimal and
  hexadecimal kept in sync as you type, with an 8/16/32/64 bit-width selector
  governing padding, ranges and the operations (bitwise NOT, one's complement,
  two's complement — signed and unsigned readings shown side by side; negative
  decimals encode as two's complement). Every conversion and operation has a
  "by hand" explainer drop-down. BigInt throughout, so 64-bit values are exact.
- **Photography** (`/tools/photography/`): total-light equivalent-settings
  calculator across Micro 4/3 (2.0×), APS-C (1.5×), Canon APS-C (1.6×) and full
  frame — focal × crop, f-number × crop, ISO × crop², shutter unchanged, with
  displayed values snapped to the standard 1/3-stop scales — plus a light-stop
  calculator comparing a second set of settings exactly (shutter `log2(t1/t2)`,
  ISO `log2(i1/i2)`, aperture `2·log2(N1/N2)`, sensor `2·log2(crop1/crop2)`)
  with per-component wording and image-brightness vs total-light totals.
  Explainers clarify the equivalence model. The last-used sensor format is
  remembered in preferences (picking it is the only write the tool ever makes).
- **File transfer** (`/tools/file-transfer/`): time estimate from a file size
  (KB/MB/GB/TB) and a network speed with bits-vs-bytes explicit in the unit
  selector (Kbps/Mbps/Gbps vs KB/s / MB/s), decimal units throughout, an
  optional protocol-overhead percentage, and the link speed spelled both ways
  (e.g. "100 Mbps = 12.5 MB/s"). A bits-vs-bytes explainer included.
- Sidebar/palette gained the Calculators category (three tools above); service
  worker shell extended accordingly.
- **Colors** (`/tools/colors/`): convert any CSS color — hex, rgb(a), hsl, hwb,
  lab, lch, oklab, oklch, and the 148 named colors — between every spelling at
  once, with a native color-picker input, per-format copy buttons, exact-name
  detection, and an out-of-sRGB-gamut flag. Conversions implemented per CSS
  Color 4 (Lab/LCH on D50, OKLab via LMS) as dependency-free unit-tested TS,
  with the named-color table verified against the browser.
- **Gradients** (`/tools/gradients/`): linear/radial/conic CSS gradient builder
  with angle/shape controls, repeating variants, multi-stop editing (optional
  positions, add/remove), a live preview and one-click copyable CSS — the
  preview and the copied text come from the same pure builder function.
- **Glassmorphism** (`/tools/glassmorphism/`): frosted-panel generator with
  backdrop blur, tint (any CSS color) + opacity, saturation, border opacity,
  radius and shadow controls, previewed over a busy backdrop and copyable as a
  CSS block (with the `-webkit-` prefix included).
- **Regex snippets** (`/tools/regex/`): paste a regex + flags, get idiomatic
  compile / match / find-all snippets for Go, Rust, JavaScript and Python with
  correct per-language escaping (Python raw strings with quote juggling, Go
  backtick literals, Rust `r#"…"#` fencing, JS literal slash-escaping), flag
  mapping (`/ims`, `re.IGNORECASE | …`, inline `(?ims)`), `(?<name>)` →
  `(?P<name>)` (and `\k<name>` → `(?P=name)`) rewriting for Python, and a
  construct scanner that warns on the Go/Rust snippets when the pattern uses
  lookahead/lookbehind/backreferences their RE2-family engines don't support.
  Snippets are syntax-highlighted with the bundled Prism.
- **QR code** (`/tools/qr/`): creator (text/URL, four sizes, all four
  error-correction levels, live SVG preview) with PNG/SVG download and
  copy-as-PNG / copy-as-SVG-text via a new shared export/copy pipeline
  (`src/lib/exportFile.ts`, reused by the image phases later), plus a reader
  that decodes uploaded images and — where a camera exists — live camera scans
  (`qr-scanner`, fully offline, permission requested in-context on click with
  upload as the graceful fallback). Decoded URLs render as clickable links but
  are never auto-opened.
- Sidebar/palette gained the Generators category (five tools above); service
  worker shell extended and cache bumped.
- **Image converter** (`/tools/image-converter/`): SVG, AVIF, WebP, TIFF, PNG
  or JPG in — PNG or JPG out (deliberately no WebP/AVIF outputs; canvas
  encoding for them isn't broadly supported). PNG↔JPG are constrained to the
  sensible direction, SVG rasterizes at a chosen width (aspect preserved),
  TIFF decodes via the bundled `utif2` (~50KB) and fails gracefully on exotic
  variants, JPG output flattens transparency onto white and has a quality
  control, and everything happens on-device. Download plus copy — clipboard
  images are always PNG and the button says so.
- **Image resizer** (`/tools/image-resizer/`): exact dimensions (with aspect
  lock deriving the other edge) or percentage scaling, PNG/JPG export with the
  shared conventions.
- **Image compressor** (`/tools/image-compressor/`): recompress JPG (quality)
  and PNG (re-encode), optional longest-edge cap, with before/after file sizes
  and the percentage saved.
- The three image tools share a remembered JPG-quality default
  (`convert_jpg_quality` on the preferences singleton — their only database
  write; the images themselves never touch IndexedDB by design).
- Sidebar/palette gained the Images category; service worker shell extended
  and cache bumped to v8.
- QR creator: code and background colors are now customizable (color pickers
  wired through to both the SVG preview and the PNG/SVG exports), with a
  scannability warning when the pair is inverted (light-on-dark) or too low
  contrast for reliable scanning.
- Regex tool grew a live tester (regex101-style): paste sample text and see
  matches highlighted in place with a match table (positions, numbered and
  named groups, lazy-safe zero-length handling, capped at 500 matches), plus a
  filterable symbol reference table — six categories of tokens with plain-word
  meanings and examples.
- Glassmorphism: eight one-click presets (light/medium/strong frosted, dark
  frosted, iOS-style clear-and-refractive, and blue/amber/rose color tints);
  tint and border opacity are now dialed in percent.
- **Colors is now Themes** (same `/tools/colors/` route): on top of the format
  conversions it adds color-theory harmonies on the classic wheel
  (complementary, monochromatic, analogous, tetradic — click a swatch to copy)
  and a CSS theme builder: up to five swatch colors (primary/secondary/accent/
  neutral/base, blanks derived from the primary), padding and border-radius
  knobs, automatic light/dark variants emitted as `:root` custom properties
  with `light-dark()`, WCAG-picked on-colors, and a live preview window
  (card, accordion, table, plaintext, form fields) driven by the exact same
  variable string the Copy button emits — with an auto/light/dark scheme
  toggle.
- Color inputs everywhere gained synced native pickers (a shared `ColorField`:
  free-form CSS color text + a picker swatch that shows the resolved color and
  writes hex back) — gradient stops, the glassmorphism tint, and every theme
  role slot.
- Theme builder: BOTH halves of every `light-dark()` pair are now editable per
  role (blank still means derived — the dark slot derives from the role's
  light value, lifting lightness until it clears 3:1 on the actual dark
  surface), and the builder audits every brand role against the theme's own
  background per scheme, listing WCAG 1.4.11 contrast warnings under the
  swatch.
- Scheduler list view: drag-and-drop reordering (grab the ⠿ handle or the
  row). The list now shows YOUR order — the same fractional rank the board
  columns use, so rearranging either view rearranges both; completed todos
  sink to the bottom, one row written per drop, no-op drops write nothing,
  and a drop strip below the table moves an item to the end. (The list
  previously auto-sorted by due date; the manual order replaces that.)
- Theme builder roles (primary/secondary/accent/neutral/base) each render as
  their own card, so the five color pairs read as separate objects instead of
  a run-together grid.
- Regex tester: capturing groups are color-coded — group N wears the same
  color in the highlighted sample text (sub-spans inside each match, computed
  from real group indices via the `d` flag, lookahead spans clamped) and in
  the match table, where named groups now merge with their number ("year:
  2024" instead of a duplicate "$1" chip) so each group reads as one color.
- Syntax highlighting for fenced code blocks in all rendered markdown (Prism, statically bundled — TypeScript/JavaScript, Python, Go, Rust, Bash, JSON, SQL, YAML, HTML/CSS), colored with the blueprint ink palette in both themes.
- **SVG editor** (`/tools/svg-editor/`): a layer-based vector editor grown from
  the local-sync-template icon designer — arbitrary canvas size (16–4096, any
  aspect), optional transparent background, and eight layer kinds: rect,
  ellipse, triangle, star, text, pasted SVG markup (ids re-homed, root paint
  preserved, scaled to fit), line segments with straight/quadratic/cubic
  bezier options, and free-form polygons (start as a regular n-gon, then drag
  vertices, add/remove points Illustrator-style). Layers have independent
  width/height, rotation, and fill/stroke/stroke-width; the canvas offers
  hit-test selection, drag positioning, rotation-aware corner resize handles,
  and vertex/control-point handles; arrows nudge, Delete removes, and
  undo/redo (buttons or ctrl+z / ctrl+shift+z / ctrl+y, 100 steps) walks
  coalesced snapshots. Documents are named rows in the new `svg_documents`
  store — layers stored as plain JSON, so they reopen fully editable, survive
  backup round-trips byte-identically, and autosave (debounced, exactly one
  row) with the last-open document resumed on return. Export as SVG (download
  or copy-as-text), or PNG/JPG rasterized at a chosen width (aspect-derived
  height, JPG quality slider, clipboard always PNG, labeled).
- **Image editor** (`/tools/image-editor/`): a session-only layer-based raster
  editor (never touches the database by design — binary data cannot
  round-trip the JSON data layer). Start from an image (the first import
  becomes the base layer and sets the canvas size) or from a blank canvas
  (any size, colored or transparent); add further image layers; resize the
  canvas any time; zoom in/out for precise brush work. Layers form a
  two-level tree: every top-level layer has its own opacity and blend mode
  (normal, multiply, overlay, soft light, hard light, color), and effect
  layers — eraser strokes, crops, darken/lighten/blur regions — nest UNDER a
  layer to affect only it (crop one photo without cropping the canvas) or sit
  at top level to affect everything below. Layers drag-and-drop to reorder or
  nest (⤵/⤴ from the keyboard), toggle visibility, and delete non-destructively
  (deleting a crop un-crops). Image layers rotate in 90° steps about their
  own center, carrying their sub-layers. Marks: smoothed brush strokes, arrows
  with sized heads, editable text, and rectangular region adjustments — each
  with numeric fields for keyboard editing. Metadata: an EXIF viewer (exifr)
  for the base image, strip-all-by-default exports, and optional embedding of
  edited artist/copyright/description/date tags into JPG exports via
  piexifjs — GPS and all other original tags can never pass through, and the
  UI states exactly which exports carry metadata. Export with a chosen file
  name as PNG or JPG (quality slider); clipboard copies are always PNG,
  labeled.
- Image editor, round 2: the layer tree is now any depth — **group layers**
  hold anything (images included) and composite as one with their own
  opacity/blend, nest inside each other, and can be created empty ("+ Group")
  or wrapped around the selected layer; **color-fill layers** paint the whole
  canvas at top level and, nested under a layer, tint only that layer (all
  content children are now clipped to their parent — a brush stroke on a photo
  stays on the photo); a blank canvas's background is a real fill layer
  ("Background") that can be recolored, hidden, or removed; **on-canvas scale
  handles** on the selected image layer (Move tool: corners keep the aspect
  ratio, edges stretch one axis; sub-layers scale along); **drag-and-drop
  anywhere in the tree** — drop on a row's top/bottom edge to place above/below
  it, on its middle to nest inside it, with a grip and above/below/into
  highlights (⤵/⤴ remain the keyboard path, now at any depth); and long file
  names truncate with an ellipsis instead of widening the panel.
- SVG editor polygons: each vertex can bend the edge to the next vertex with a
  draggable bezier control ("Curve edge" on the selected point) — the layer
  renders as a closed `<path>` while any edge is curved and stays a plain
  `<polygon>` (byte-identical to before) otherwise.
- SVG editor boolean subtract: "Subtract another layer from this one" cuts the
  chosen cutter's silhouette out of the selected layer — a stroked line splits
  a square into two rectangles, text punches letters, a pasted icon stamps its
  shape — using SVG's own compositing (luminance mask + a flood filter that
  blackens any cutter regardless of its colors), baked into a pasted-SVG layer
  positioned exactly over the original (both originals consumed; one undo).
- Image compressor targets: besides manual quality/cap, aim for a percentage
  of the original size or a max file size in KB. The tool searches for
  settings that meet the budget (JPG: quality first, never below 20, then
  dimensions; PNG: dimensions only, being lossless) and reports the outcome
  honestly — including "target NOT reachable" with the smallest allowed
  encode — with a standing notice that a target may not be possible.

- **Background remover** (`/tools/background-remover/`): cuts the subject out of
  a photo with a segmentation model that runs entirely in the browser — the
  picture is never uploaded. The model (U²-Net small, Apache-2.0) and its
  runtime (ONNX Runtime Web, MIT) are self-hosted and downloaded on an explicit
  "Download model (15.8 MB) for offline use" click with a progress bar, then
  kept in their own cache so the tool works offline afterwards (and can be
  removed again from the same card). Live preview over a transparency
  checkerboard, two cleanup knobs (cut off faint edges, soften edge) that
  re-tune the existing mask without re-running the model, a transparent or
  solid-colour background, a mask view, and PNG/JPG export plus copy-as-PNG
  through the shared pipeline. JPG with a transparent background says so
  instead of silently whitening it.
- Image editor: **Remove background** on any image layer, using the same model.
  The result is a mask layer nested under that image, so it cuts only that
  layer (not the whole canvas), can be inverted to keep the background instead,
  moves/scales/rotates with the image it is stuck to, and deleting it brings
  the background straight back — nothing is baked.

- Image editor **undo/redo**: ↶ / ↷ buttons beside the zoom controls plus
  `ctrl+z` / `ctrl+y` (and `ctrl+shift+z`), covering everything in the session —
  layers, tools, canvas size, background removal. Discrete actions are their own
  step; a brush stroke, a slider drag or a burst of typing collapses into one.
  Snapshots share the decoded bitmaps rather than copying them, so history costs
  geometry, not pixels.
- Image editor **Restore brush** (un-erase): paints the original pixels back
  wherever you brush, undoing part of an eraser stroke or part of a removed
  background without undoing the whole layer. Like every other effect it is a
  layer — it can be nested, reordered, hidden or deleted, and it acts on
  whatever sits below it.
- Background remover **touch-up brushes**: "bring back" and "cut away" paint
  directly on the preview when the model gets an edge wrong. Strokes are kept as
  their own layer on top of the mask, so the cutoff/feather sliders and even
  re-running the model leave your corrections intact; "Clear touch-ups" restores
  the model's own mask.

- **SQL playground** (`/tools/sql-playground/`, new **Playgrounds** category):
  a real database in the browser tab — SQLite (sqlite-wasm) or Postgres
  (PGlite), both running in a Web Worker with nothing uploaded anywhere. A
  CodeMirror editor with the picked engine's dialect and keyword completion
  (Ctrl+Enter runs), a results grid, a table browser with column types and
  primary keys, import (a `.sql` script or the engine's own binary image,
  sniffed by its header, with the current database restored if the script
  fails part-way) and export (SQL to clipboard or file, binary image, JSON —
  schema + data or schema only). Ported from
  [retoken](https://github.com/Descent098/retoken); persistence was rebuilt on
  this app's data layer, so a workspace rides backups like any other row.
- **"Make it work offline?"** — installing the app now offers, once, to
  download everything it can run without a network: the pages you have not
  opened, the background remover's model, and each database engine, each with
  its size and its own progress. The same panel lives in Settings → Offline for
  later, and reports when it last finished.

## Bug Fixes

- Image converter preview squashed tall/wide images to the preview box's own
  ratio: the `<img>` was a stretched flex child (`align-items: stretch`) with a
  `max-height`, so its width came from the container and only the height was
  clipped. It now opts out of the stretch (`align-self: flex-start`) with
  `object-fit: contain` as belt-and-braces; regression-tested with a real
  portrait AVIF fixture and a canvas-generated tall PNG.
- SVG editor: color edits made through the shared color field never
  committed — not saved, not undoable, while the status still read "Saved"
  (`ColorField` gained an `oncommit` hook that fires when an edit is
  finalized). Clearing a numeric layer/canvas field no longer persists `null`
  (an emptied number input): commits revert invalid numerics to the last
  committed value and heal sizes to ≥ 1, load-time normalization coerces
  stored bad numerics too. User-typed colors are attribute-escaped when the
  document is built (a stray quote used to blank the whole preview and could
  inject markup into an exported file), and an emptied background reads as
  transparent instead of rendering black. The debounced autosave now flushes
  on `pagehide`/`visibilitychange` (a hard reload within 400ms of an edit lost
  it), persists the last committed snapshot rather than live bound values,
  ignores results for a document that was closed or swapped while the write
  was in flight, and the keyboard listener is registered synchronously so a
  fast navigation away can no longer leak it. Adding a polygon point after
  undo with a stale vertex index crashed; vertex indices reset on
  undo/redo and are bounds-checked. Line/polygon hit-testing uses the true
  bounding box (points become one-sided after vertex drags; the old
  mirrored box stole clicks from neighbours). Export width tolerates an
  emptied field.
- Image editor: an off-canvas marquee drag committed an inflated region
  (`clampRect` slid the rect inward keeping its size; it now intersects
  edge-by-edge, so a drag past the edge keeps exactly the on-canvas span);
  blur regions bled the sharp original back in near their edges (the
  snapshot now includes surrounding context so the filter has real pixels
  to blur); a second touch pointer no longer hijacks an in-flight stroke
  (gestures are pinned to their pointer id); "New session" asks before
  discarding crop/rotation-only work; the marquee overlay's dash scale is
  driven by a ResizeObserver instead of a layout read inside the render
  effect. Playwright specs tightened: the "GPS never survives" fixture now
  actually carries GPS (the assertion was vacuous), the whole-session
  zero-write window starts before the page loads, and crop dimensions are
  bounded on both sides.
- Prism grammar files are global-dependent side-effect scripts; once two modules
  (markdown rendering and the regex tool) imported them, Rollup could split the
  grammars into a shared chunk that executes before the Prism core, crashing
  hydration with `Prism is not defined`. All Prism imports now flow through a
  single `src/lib/prism.ts` whose import order is guaranteed. (This crash is
  also what briefly broke every scheduler interaction — including calendar
  drag-and-drop — since the scheduler island imports the markdown renderer;
  the drag suite now additionally covers the realistic hover-preview-then-drag
  sequence and true list-reorder interactions as regression guards.)

- The Playwright suite could never run under Astro 7: `astro preview` daemonizes itself when stdin is not a TTY, so Playwright's webServer saw the process exit and aborted every run. Replaced with a dependency-free foreground static server (`tools/preview-server.mjs`).
- The test hook 404'd in production builds: the layout's unbundled inline script dynamically imported `../lib/testHook.ts`, which resolves against the page URL and does not exist in `dist/`. The loader is now a bundled module script (`installTestHookIfEnabled` in `src/lib/testMode.ts`); the hook chunk is still only fetched when test mode is enabled.
- The shipped v1 migration iterated the live `STORES` map, so appending any store-creating migration would have crashed fresh installs (`ConstraintError`: store created twice). v1 is frozen to literals, and every future migration must guard with `objectStoreNames.contains()` (convention documented in `src/lib/db/db.ts`; v2 now guards too).
- Astro's ClientRouter wipes `<html>` attributes on every client-side navigation, silently reverting the pinned theme and the sidebar collapse. The layout's pre-paint script now re-applies both on `astro:after-swap` (regression-tested with a client-side navigation, not just full reloads).
- `put`/`bulkPut` stamped `field_updated_at` entries for sync bookkeeping keys (`updated_at`, `deleted_at`) on field-merged stores; stamps are now limited to domain fields, and `putSingleton` explicitly stamps `deleted_at` when it revives a tombstone.
- Desktop layout gap: the topbar was pushed right by the sidebar's body padding, leaving a dead square above the open sidebar. The topbar is now fixed and full-bleed; the sidebar starts flush beneath it.

- **Deleting a row kept its contents.** A delete tombstoned the row in place
  with every field intact, so a deleted timer's label and notes stayed in
  IndexedDB — and turned up in every exported backup. Tombstones now keep only
  sync bookkeeping (id, clocks, delete stamp, per-field stamps), and database
  **v6** sweeps the ones already stored, leaving their clocks untouched so the
  cleanup can never beat a real edit from another device.
- **Drag and drop did nothing on a touchscreen or pen** — in all three
  scheduler views and in the image editor's layer tree. Those all used the HTML5
  drag-and-drop API, which only ever fires for a mouse; the failure is silent,
  which is how a mouse-driven test suite kept passing over it. Everything now
  runs on pointer events (`src/lib/dragdrop.ts`), so mouse, touch and pen share
  one path: grab handles (⠿ on list rows, board cards and layer rows; calendar
  entries themselves) own the gesture on touch so the page still scrolls, a drag
  only starts after 5px of travel so clicks stay clicks, Escape cancels, and the
  app draws its own drag ghost.

- Dark theme: `--color-danger` sat at 4.0:1 against the card surface, under AA
  for text — every error message in the app was the hardest thing on screen to
  read. Lightened to 4.8:1, with the whole token palette now checked
  numerically in both schemes by the accessibility sweep.
- Heading structure: card titles were `h3` directly under the page's `h1`, and
  the theme builder's preview card injected a stray `h4`, so a screen reader's
  document outline skipped levels on most pages. Card titles are now `h2`, and
  the preview's mock title is styled text rather than a heading.

## Other
- Database schema v7: new `sql_playgrounds` store — one workspace per engine
  (editor buffer + optional SQL snapshot), keyed by the engine id;
  `preferences` gains `sql_last_engine`, `offline_prompt_seen` and
  `offline_ready_at`. Test schema mirror and README Tables updated; the store
  rides backup export/import automatically.
- Service worker: `tools/sql-playground/` added to the precached shell, cache
  bumped to v11, and a new message channel (`useful-warm`) that runs the asset
  crawl on demand, unpaced, reporting progress — the pacing exists to protect a
  host while the app boots, and someone who explicitly asked to download
  everything is waiting for it.
- New dependencies for the playground: `@sqlite.org/sqlite-wasm`,
  `@electric-sql/pglite`, `codemirror` + `@codemirror/lang-sql`. All lazy: the
  home page, and every tool that is not the playground, pull none of them —
  enforced by a new payload-discipline suite that watches the real network.
- Phase 9 hardening suites: an accessibility sweep over EVERY registered page
  (accessible names, form labels, image alt text, one `h1`, no skipped heading
  levels, plus token contrast in both themes and the keyboard path through the
  palette and disclosures), payload discipline (heavy bundles stay lazy, the
  install precache stays shell-only), and an offline audit that downloads the
  app, cuts the network, and loads a page the profile has never visited.
- Undo/redo lives in `src/lib/raster/history.ts`, a snapshot stack that
  deep-copies the layer tree but passes canvases through by reference (the SVG
  editor's JSON-based history would have turned every bitmap into `{}`), with
  structural signatures for coalescing; unit-tested with fake bitmaps.
- The background remover's brush maths (`applyPaint`) is pure and unit-tested
  alongside the rest of the pipeline: keep strokes win over the model, remove
  strokes win over keep strokes, and a paint layer left over from another image
  reads as unpainted rather than as NaN alpha.
- Test hook gains `closeDb()` so a migration test can tear the database down and
  rebuild it at an older version (an open connection blocks `deleteDatabase`
  forever). The v6 sweep is covered end to end: a fat tombstone written against
  a v5 database is stripped on the next load, clocks intact.
- Scheduler and image-editor specs now drive real pointer drags instead of
  Playwright's `dragTo()` (which exercises the HTML5 pipeline no touchscreen
  has), plus three new touch-drag cases — list, board and calendar — driven
  through CDP touch events.

- Background remover assets are vendored, not fetched from a CDN:
  `tools/build-bg-assets.mjs` downloads `public/models/u2netp.onnx` (from the
  rembg release of the Apache-2.0 U²-Net conversion) and copies ONNX Runtime
  Web's wasm + loader out of `node_modules`, then writes
  `public/models/PROVENANCE.txt` with sources, licenses, sizes and SHA-256s.
  BriaAI RMBG and `@imgly/background-removal` were rejected on licensing.
- Service worker: `tools/background-remover/` added to the precached shell,
  cache bumped to v10, and a dedicated cache-first rule for `models/` + `ort/`
  that stores them in `useful-models-v1` — a bucket outside the `useful-cache-`
  prefix, so a version bump never purges 15.8 MB of downloaded model, and
  stale-while-revalidate never re-fetches it in the background. The assets are
  deliberately absent from the install precache. New `scissors` icon and
  Images-category registry entry for the tool.
- New dependency `onnxruntime-web` (MIT), imported lazily so it only loads for
  someone who actually removes a background. Vite's dep optimizer is told to
  leave it alone (`optimizeDeps.exclude`) and the runtime pins ORT's loader
  path, because both the dev server and the production bundle otherwise
  resolve it to a URL nothing serves.
- Pre/post-processing lives in `src/lib/bg/pipeline.ts` as pure typed-array
  maths (bilinear resample both ways, the U²-Net normalization, mask rescale,
  cutoff/feather, alpha application) and is unit-tested in node against a
  mocked runner; `src/lib/bg/runtime.ts` owns asset caching and the session.
  Playwright drives the REAL model end to end: not-downloaded state, cut-out
  pixels in the exported PNG, cleanup knobs re-tuning without a second
  inference pass, an opaque JPG over a chosen colour, a run with the browser
  taken offline, and the editor's nested mask (including invert and delete);
  all of it inside zero-write windows, since the tool has no store of its own.

- Database schema v5: new `svg_documents` store (name, canvas size, background,
  layers as JSON); `preferences` gains `svg_last_doc_id` (last-open SVG-editor
  document, resumed on reopen). Test schema mirror and README Tables updated;
  the store rides backup export/import automatically.
- Service worker: `tools/svg-editor/` and `tools/image-editor/` added to the
  precached shell; cache bumped to v9. Registry gains both tools (Images
  category) with new hand-inlined Lucide `pen-tool` and `brush` icons.
- New dependencies: `exifr` (EXIF read) and `piexifjs` (JPEG EXIF write,
  loaded lazily at export time); pure SVG/raster geometry libs
  (`src/lib/svg/`, `src/lib/raster/`) unit-tested in node, with the seed's
  paste-hardening regression tests ported alongside. The compressor's
  target-size search (`src/lib/img/targetSize.ts`) is pure over an injected
  encoder and unit-tested with synthetic size curves. The raster layer tree
  (`locateLayer`/`moveLayer`/`removeLayer`/`flattenLayers`) and the
  about-center image rotation with children are unit-tested too.
- Test fixtures: real sample files added under `tests/local/fixtures`
  (portrait AVIF, large PNG/JPG/TIFF/WebP/SVG samples) for image-tool specs;
  the AVIF one now exercises the converter's native-decode branch directly.
- Accessibility: image-editor tools have keyboard paths (numeric crop entry,
  coordinate fields for text/arrow/image/region layers, ⤵/⤴ nest buttons);
  layer rows in both editors expose `aria-pressed` for the selection.
- View transitions: Astro `<ClientRouter />` in the shared layout; the chrome island is persisted across navigations and tracks the active page via `astro:page-load`.
- `preferences` is now flagged `singleton` + `fieldMerge` in both `src/lib/db/types.ts` and the test mirror `tests/local/helpers/schema.ts`; the Preferences page is a read-only view of remembered per-tool defaults (writes go through `putSingleton` only). No IndexedDB migration needed (flags are app-level metadata).
- Unit test runner added: Vitest via `npm run test:unit`, with tests for the fuzzy matcher and registry; Playwright specs added for sidebar/drawer/palette navigation (including "client-side navigation writes nothing").
- The orphaned-FK sabotage proof now runs against a synthetic schema, so the trust gate exercises all five oracle proofs even while the real schema has no foreign-key tables.
- `package.json` version synced to `VERSION` (0.1.0); README Tables section updated for the `preferences` flags.
- Accessibility hardening from the phase review: the closed mobile drawer leaves the tab order and accessibility tree (`visibility` rides with the transform); `aria-expanded` reflects the actual per-viewport state; the search button keeps an accessible name when its label is visually hidden; the palette handles IME composition, contains focus against stray clicks, announces result counts via a live region, and scrolls the keyboard selection into view; Escape closes one overlay layer at a time; the page behind an open overlay no longer scrolls; media queries use range syntax (no dead zone at fractional zoom); control boundaries use a new `--border-strong-color` token meeting WCAG 1.4.11 (3:1) in both themes.
- `.gitignore` now covers Playwright's `test-results/` and the trust-gate's `tests/local/.results/`.
- Per-field merge folding on backup merge-import: field-merged stores (currently `preferences`) now fold row-by-row per field — the copy with the newer per-field stamp wins each field, so a backup from one device no longer clobbers the one field this device changed. Tombstone rules unchanged (a fold never resurrects a deletion); folded rows are re-queued for future sync. Covered by three new oracle-audited tests.
- Shared sanitized markdown renderer (`src/lib/markdown.ts`, marked + DOMPurify) — backup-JSON import is an injection vector into rendered HTML, so every markdown field renders through it.
- `field_updated_at` docs clarified: stamps are written since this phase but per-field merge folding on backup import lands with Phase 1 (tracked in `plan-phases.md`), which is when `preferences` gains its first real fields.
- Design-review hardening: the amber stamp demoted from recurring structural labels (sidebar/home section headers, table headers now use pencil ink) so it stays a stamp; the annotation voice consolidated behind shared tokens (`--font-size-eyebrow`, `--tracking-*`); hover reads as a line-weight change instead of a soft glow; dark-theme warning color split from the stamp; palette descriptions hidden below 30rem instead of crushing to ellipsis; dead `Accordion.svelte` template component removed; service worker `CACHE_NAME` bumped to v3 with both favicon variants precached.

- Refined `docs/dev/plans/plan.md`: fixed numbering/typos, corrected the SVG-editor reference to the `local-sync-template` icon designer's layer panel, recorded product decisions (lazy-downloaded background-removal model, session-only raster image editor, total-light photography equivalence, bundled city→timezone dataset, app-open-only notifications), and added cross-cutting sections for the data model, notifications/permissions, testing, PWA/offline, and accessibility.
- Added `docs/dev/plans/plan-phases.md`: splits the refined plan into 10 shippable phases (0–9) with per-phase scope, data-model/migration changes, test obligations, and a standing checklist encoding the schema/sync/test/CHANGELOG rules from `docs/dev/plans/TODO`.
