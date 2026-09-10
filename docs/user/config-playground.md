# Config playground

Paste a JSON or YAML file and find out what is in it: whether it parses, which lines will surprise an older YAML reader, and the shape of the data — every key, its type, whether it is always there and whether it is ever null — as a table you can keep. Or start from the table, build the shape by hand, and get example files and real code out of it: a parser that checks documents the way this page does, or a generator that invents sample ones, in Python, JavaScript, Go, Rust or as a single-file web component.

_Describes the code as of v0.5.0 (unreleased; schema v16) — verify against source when in doubt._

## Checking a document

The page opens in **Parse** mode. Paste into the **Document** box — it is a proper code editor, with highlighting and a gutter that underlines problems — and the format is guessed from the text: something starting with `{` or `[` is JSON, anything else is YAML. The **Format** dropdown shows the guess (`Auto — JSON` or `Auto — YAML`) and lets you force either one, which matters for the ambiguous cases — a YAML file that happens to begin with a flow mapping, say.

As you type, one of three things sits beside the dropdown:

- **Valid JSON** / **Valid YAML** — it parses.
- **N errors** — it does not, and a list under the editor says where: `Ln 4, Col 12 — …`. YAML reports every error it finds, not only the first, and each one is underlined in the gutter too.
- Nothing yet, if the box is empty.

Valid documents can still carry **warnings**, listed separately. These are the things that are *technically fine* and *will bite you anyway*: a bare `NO` or `on` that an older YAML 1.1 reader turns into a boolean, `12:30` that it turns into the number 750, `0123` that it reads as octal, an integer too big for JavaScript to hold exactly, `.nan` and `.inf` that JSON cannot spell, anchors and aliases that expand into copies the moment the file becomes JSON, and mapping keys that are not strings. Each one points at its own line. Quoting the value clears the first three — the page checks the spelling, not the meaning, so `"NO"` is fine.

**Prettify** reformats in place: two-space JSON, or YAML tidied by a parser that keeps your comments, anchors and key order. Broken input is refused with the error rather than half-formatted.

**Convert** opens a window that rewrites the document in another format: pick what it is (**From**) and what you want (**To**) — **JSON**, **YAML**, **TOML** or **CSV**, in any direction — and the result appears below, syntax-highlighted, with **Copy** and a **Download** button that names the file after the format. It converts as you change either dropdown; nothing is written and the document in the editor is never touched, so an experiment costs you Escape.

Four things do not survive a conversion, and the window says so under the result rather than letting you find out later:

- **Comments belong to the text, not the data.** Converting a commented YAML or TOML file loses every comment. Prettify is the tool that keeps them.
- **YAML anchors and aliases expand.** Shared structure becomes a copy in each place it was used.
- **TOML dates become ISO-8601 strings**, because no other format here has a date type.
- **CSV is a table, not a tree.** A list of records converts cleanly (one row each, nested keys as dotted columns like `address.city`, arrays kept as JSON text in one cell); a settings-style object converts to the `path` / `type` / `value` view instead, the same one the Data card draws. Going the other way, CSV has no types at all: a cell becomes a number or a boolean only when the text round-trips exactly, so `007`, `1.0` and `+1` stay strings and a zip code survives.

Two shapes are refused outright rather than approximated: TOML cannot spell a document whose top level is an array or a single value (wrap it in a key first), and CSV needs rows to make.

## Reading the schema it found

The **Schema** card fills itself from the document. Every key gets a row: its **Field** path (`address.city`, `workplaces[].name` — nested objects and arrays of objects are indented under their parent, with a ▾ to collapse a branch), its **Type**, **Required** (`yes`, or `optional` if the key was missing from some records), and **Nullable** (`yes` if it was ever null).

Types are inferred from what is actually there, and they are more specific than "string" when the values let them be: `integer` versus `number`, `email`, `phone`, `uri`, `date` and `date-time` when every value fits, `enum(dev | staging | prod)` when a few values repeat, `Array[string]`, `object`, and `a | b` unions when a key holds mixed shapes. Give it a list of records — an array of objects — and it pools the evidence across all of them, which is how it knows a key is optional.

Two things to know about the table:

- **It follows the document until you take it over.** Typing rewrites it; a half-broken paste leaves the last good version up rather than blanking it. Once you open a saved schema, edit a row, or come back from Create mode, the table stops following and instead the document is **checked against it**: `Document matches the schema.`, or a list of what does not fit, one line per problem (`port — port must be an integer, got "eighty"`). A key the schema does not know is a warning, not an error. **Extract from document** hands the table back to the document whenever you want that.
- **It needs an object.** A document whose top level is a number, a string, or a mixed list has no keys to make fields from, and the card says so. A list of objects is fine.

Name it in **Schema name** and press **Save schema**. Nothing is saved until you do — looking at a document writes nothing.

## Browsing the data

Under the schema, the **Data** card turns the document itself into a table — the same grid the SQL playground shows its results in, with a search box, an AND/OR filter tree, sortable headers, paging and a CSV download. A document that is an array becomes one row per record, with nested objects spread into dotted columns (`address.city`) and arrays kept as JSON text in one cell; a document that is an object becomes one row per key — **path**, **type**, **value** — which is the readable view of a config file.

It does nothing until you press **Extract from document**. That is deliberate: a large document would otherwise stall the page on every keystroke. If you edit the document after extracting, the card shows a **Stale — the document changed** badge and keeps the old rows until you press **Extract again**; it never re-runs on its own. Very large documents are cut at 20,000 rows, and the count line says so.

## Your library

Saved schemas appear in the sidebar on the left, with a search box; each shows its name and whether it is JSON or YAML. Click one to open it — the document you saved with it comes back too — **New** starts blank, and the × deletes after asking. The page remembers which schema you had open and reopens it next time.

## Building one by hand

**Switch to Create**. The table is the same, but now it is yours to edit: **+ field** adds a row, the name box names it, the **type** dropdown sets it (`string`, `integer`, `number`, `boolean`, the five formats, `object`, `array`, `any`), **Required** and **Nullable** are checkboxes, and × removes a row. An `array` row gets a second dropdown for the element type; an `object` row, or an array of objects, gets **+ child** to add fields beneath it. A type the dropdown does not offer — an `enum` or a union that came from a document — stays on its row as an extra option, so you keep it unless you change it.

**Output format** picks JSON or YAML for the examples and the code. A schema brought across from Parse mode arrives with the format it was read in.

The schema you build survives **Switch to Parse** — that is the point. Paste a real document and the page tells you whether it fits.

## Making examples

In Create mode the **Examples** card takes an **Amount** (1 to 100) and **Generate** produces that many documents in your schema, in the output format — YAML documents separated by `---`, JSON as one object or an array. They look plausible and point at nobody: names and words from a short curated list, email and web addresses on reserved domains like `example.org` that can never resolve, phone numbers in the `555-01xx` block that is set aside for fiction, dates in the 2020s. Optional fields are left out some of the time and nullable ones are null some of the time, so the sample set exercises the schema. Every press makes a fresh batch. **Copy** and **Download** (`<name>-examples.json` or `.yaml`) take them away.

## Getting code out

The **Code generator** card is on both sides of the switch. Choose what to **Export a** — a **Parser** or a **Generator** — pick a **Language**, press **Generate**, and **Copy text** or **Download** the file (`<name>.py`, `.js`, `.go`, `.rs`, or `.js` for the component).

- A **parser** reads a document and checks what this page checks — every field's presence, type, format and allowed values — reporting every problem it finds in one go rather than stopping at the first, unknown keys included. In **Python**, **JavaScript**, **Go** and **Rust** it is a plain function with a docstring listing the fields, using only the standard library — with one honest exception: the Rust version uses `serde_json`, because Rust ships no JSON parser. If your schema's format is YAML, the parser takes the *already decoded* document (from `yaml.safe_load`, `gopkg.in/yaml.v3`, `serde_yaml`, or whatever you use) rather than text, because a dependency-free file cannot read YAML and pretending otherwise would be worse.
- A **generator** makes sample documents from a count and a seed, and the same seed always makes the same documents — which is what you want in a test fixture. It carries its own small word list so the file stays self-contained.
- The **Web component** is one `.js` file with no dependencies: the parser is a textarea that validates as you type and lists each field's value, firing a `config-valid` event; the generator is a count box and a button, firing `config-generated`. Neither has styling of its own — every piece has a `part` name, and the file opens with an example of styling it from the page. The parser component accepts **JSON only**, and says so on its face if the schema is YAML.

Change the schema, its name or its format and the generated code disappears — it described something that no longer exists, and a fresh press brings it back.

## Gotchas

- **Schemas live in this browser only.** They ride along in Settings → Backup, but nowhere else until you download something. Clearing site data deletes them.
- **Nothing saves itself.** Pasting, editing the table and generating write nothing; **Save schema** is the only thing that stores a schema. The mode switch and opening a saved schema write only the page's memory of where you were.
- **`NO` is a string here and `false` somewhere else.** This page reads YAML 1.2. Older readers — including some still in wide use — read `NO`, `on`, `12:30` and `0123` as a boolean, a boolean, the number 750 and octal 83. The warnings exist for exactly this, and quoting the value cures every one.
- **Big integers lose precision.** Past about 9 quadrillion (2⁵³), JavaScript — and any JSON step in a pipeline — rounds them. The page warns at the literal; it cannot fix it.
- **Prettify keeps comments** because the YAML parser was chosen for that. JSON has none to keep.
- **Convert does not keep comments** — and cannot. Prettify edits the text you have; Convert reads the document into values and writes those values out again, which is exactly the step a comment does not survive. If you need the comments, convert a copy.
- **The web component reads JSON only.** Decode YAML first, or use the generated Python or Go.
- **The Rust parser needs `serde_json`**, and a YAML-schema parser in any language wants the decoded data, not the text — see above.
- **The sample data is fake on purpose.** Reserved domains, `555-01xx` numbers, common names from a short list. It will never match a real person or reach a real server.
- **A generated parser is stricter than the page about unknown keys.** The page only warns about a key the schema does not know; a generated parser counts it as a problem and refuses the document. The format checks are the page's own in Python, JavaScript, Go and the web component; Rust's are hand-rolled approximations, lenient rather than strict. Read the file before you trust it with production input.
- **The Data card only runs when you press it.** Edit the document and the rows stay as they were, flagged stale, until you extract again — by design, so a big file never freezes the editor.
- **The clipboard can be blocked.** If **Copy** says so, use **Download**.
- **The first visit downloads the editor.** CodeMirror, the JSON and YAML language packages and the YAML parser — roughly 600 KB of script, about 200 KB compressed — after which it is cached and works offline like the rest of the app.
- **Switching modes is remembered**, and so is the open schema. Reopening the page puts you back where you were, without writing anything.
