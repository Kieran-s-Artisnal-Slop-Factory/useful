# Notebook

Keep your notes here, in markdown, linked to each other. Write in a rich editor or in the raw text, whichever you prefer at the moment; drop footnotes in with one key; draw a diagram from a template and see it as you type; paste a screenshot; write `$x^2$` and get real maths. Link one note to another by writing its title in double brackets, and the notebook tells you who links back. When a note has to leave the browser it goes as Markdown, as one HTML file that needs nothing else, or as a PDF through the print dialog.

_Describes the code as of v0.3.0 (unreleased; schema v12) — verify against source when in doubt._

## Your notes

The left-hand column is the tree. **New note** makes one at the top level and puts the caret straight in its title with `Untitled` selected, so you can name it by typing; the **+** beside any note makes one *inside* it, so a note is also a folder — there is no separate folder thing to create, and the **×** beside it deletes that note. The ▾ / ▸ arrow collapses a branch, and the tick-box takes the note into a [bulk operation](#many-notes-at-once). Click a note to open it; the one you have open is remembered and reopened next time, and the **‹ Notes** button folds the column away when you want the width.

Type in the search box and the tree becomes a flat list of every note whose title, tags or old titles contain what you typed.

Above the editor, the note's **title is the card's header** — click it and type; it is the same field the tree and every `[[link]]` read. Under it sits the note's place — a breadcrumb of the notes it sits inside, each a link — and two fields: **Inside** (a dropdown to move the note under another one, or `— top level —`) and **Tags**, comma-separated. Everything you type is saved on its own a moment after you stop; `Saving…` and `Saved` sit in the card's corner. **Close** puts the note away without deleting it; **Delete** asks first.

## Writing

The editor has three faces, and the buttons on its toolbar switch between them. The note is the same text underneath all three.

- **Edit** is the rich view: headings, lists, tables, code blocks with a language picker, images, and a `$maths$` popup, all rendered as you type. A `mermaid` code block shows its diagram right there in the canvas.
- **Source** is the markdown itself in a code editor, with light highlighting. Use it when you want to see exactly what will be saved, or when the rich view has tidied something you did not want tidied — markdown that goes through the rich editor comes back slightly normalised, and the source view never touches it.
- **Preview** shows the note the way it renders elsewhere in the app: links resolved, footnotes numbered at the foot, maths typeset, diagrams drawn.

The face you leave the editor in is remembered.

**Footnotes.** Press **Alt+0** with the cursor in ordinary text and you get a numbered citation at the cursor and a dialog open on its note, ready to write. Press it on an existing citation and the dialog opens on *that* note; press it again in the dialog and you are back at the citation. The **⁋ Footnotes** button (with a count) opens the same dialog for all of them: rename a label and every citation renames with it, delete a note and its citations go too, **+ New footnote** adds one, and nothing changes until **Save footnotes**. In the rich view the notes themselves stay out of the canvas on purpose — they are not prose — and live in that dialog; in Source they sit at the foot of the text, with a marker in the margin beside every line that cites or defines one, which jumps to the other half. A line under the toolbar warns about a citation with no note, a note nobody cites, or a label defined twice.

**Diagrams.** **◇ Diagram** opens the mermaid workbench: eight starter templates (**Flowchart**, **Sequence**, **State**, **Class**, **ER**, **Mindmap**, **Pie**, **Gantt**), a code editor that completes diagram types on the first line and the right keywords below it, and a live picture that keeps the last good drawing while it tells you what is wrong with the current text. Ctrl/Cmd+Enter saves, Escape cancels. In Source, opening it with the cursor inside an existing `mermaid` block edits that block instead of adding another.

**Images.** Paste or drop an image into the rich view and it is stored with the note and shown in place. Each image may be at most **2 MB**; a bigger one is refused with a line under the toolbar naming its size and the limit, and the image slot is left for you to try another. The **Export** card keeps a count: `3 images, 412 KB`.

**Maths.** Write `$…$` for inline maths and `$$…$$` on its own lines (or a `math` code block) for display maths. A price — `$5 and $10` — is left alone, because maths may not start or end with a space or be followed by a digit. Preview, the HTML export and the print all typeset it; the rich view shows it in place and opens a small editor when you click it.

## Linking notes

Write `[[Title]]` anywhere and it becomes a link to the note with that title, matched without caring about case or extra spaces. `[[Title|what to show]]` shows different words. This works everywhere the app renders markdown — in timer, TODO and event descriptions too — and lands you on the notebook with that note open.

A link to a note that does not exist yet is drawn differently. Click it in Preview, or in the **Links to** list, and the note is created on the spot, inside the note you were reading. Follow such a link from somewhere else in the app and the notebook says `No note called “…”` with a **Create it** button — it never creates anything just because you arrived.

Rename a note and old links keep working: the old title is kept as an alias, listed under the title as `Also answers to: …`. If other notes still link by the old name the card says so — `2 notes still link to “Old title”` — with one button, **Update them to “New title”**, that rewrites those links. Nothing is rewritten unless you press it.

Under the editor, the **Links** card shows both directions: **Linked from** lists every note that links here, with a count, and **Links to** lists every title this note links to, marking the ones that are not notes yet. Both are read straight off the notes each time, so they are never stale — even after restoring a backup.

## Exporting

The **Export** card, under the links:

- **Download Markdown** gives you the note's own text as a `.md` file named after the title, with a `# Title` line added if the note does not already open with one, and any pasted images inlined as `data:` URLs so the file stands alone.
- **Download HTML** gives you one `.html` file, named the same way, with everything inside it: a stylesheet, your images, the maths typeset with only the maths fonts that note actually uses, and diagrams already drawn as SVG. It never fetches anything and never points at this app or any server; if the note itself links to an outside web page, a line under the buttons counts those links so you know they are there.
- **Print / Save as PDF** opens the browser's print dialog with the note alone on the page — the app around it is hidden, light colours are forced, code keeps its background, and tables and figures are kept whole across pages. The note's title is offered as the filename; choose *Save as PDF* in the dialog.

## Many notes at once

Every note in the left-hand column has a tick-box. Tick one and a **bulk operations** panel appears at the top of that column, above the search box, saying how many are ticked, with **Clear** beside it and two ways to take more: **All** (every note — or, while you are searching, every note the search found) and **+ Nested**, which adds everything nested inside what you have already ticked. Ticking a note never takes the notes inside it on its own; that is one deliberate press, because a folder here is a note like any other.

The note you have open stays open and editable the whole time — there is no separate mode to leave. Then four actions, each on the ticked notes only and none of them until you press it:

- **Export** — pick **Markdown** (source with images inlined) or **HTML** (the same self-contained file the single export makes) and press **.zip**: one archive with a file per note, named after its title (`Parent.md`, `Child.md`, and `-2` when two titles clash). If any note links to an outside web page, the line underneath counts those links.
- **Tags** — type tags, comma-separated, then **Add** or **Remove**. Adding keeps each note's own tags and skips ones it already has; removing does not care about case.
- **Move under** — pick a destination (or `— top level —`) and press **Move**. Ticked notes and the notes inside them are not offered as destinations, because a note cannot go inside itself.
- **Delete** — asks first. Nested notes that are not themselves ticked move up to the nearest note that stays; the deleted notes' images go with them.

What happened is reported under the panel — `Added 2 tags on 2 notes.` — and stays there after the panel itself goes, so a delete still leaves a receipt. If a bulk action moved or retagged the note you have open, its **Inside** and **Tags** fields show the new values straight away.

Each row also carries its own two buttons: **+** starts a new note inside that one, and **×** deletes that one note (it asks first).

## Gotchas

- **Notes live in this browser only.** They ride along in Settings → Backup, and nowhere else until you download something. Clearing site data deletes them.
- **Images count against the backup.** A backup is one JSON file with everything in it, pictures included, which is why each image is capped at 2 MB. Settings → Storage shows what the browser says you are using.
- **Deleting a note moves its nested notes up a level** — to wherever the deleted note was — and deletes the images pasted into it. It does not delete the notes inside it. A bulk delete follows the same rule for every note it deletes at once: a nested note that is not ticked climbs to the nearest note that survives.
- **A bulk export is one `.zip`, uncompressed.** The files inside already carry their images as base64, so there is little to squeeze; what matters is that every unzip, including the browser's own, opens it. Titles are made filename-safe the same way the single export does it, so `My note: draft?` becomes `My-note-draft.md`.
- **Switching faces loses undo history.** Edit, Source and Preview each start fresh; the text carries over, the undo stack does not.
- **The rich view hides footnote definitions on purpose.** They are in the markdown (see Source) and in the **⁋ Footnotes** dialog; if you type a `[^label]: …` line into the rich view by hand it is filed away into the dialog when you move off it.
- **Links from timers and events open the notebook.** A link to a note that does not exist offers to create it; it never creates one on its own.
- **Saving is automatic, a moment after you stop typing** — and it writes the fields of the note you have open. There is no Save button to forget.
- **The HTML file is self-contained; the PDF is not a file the app makes.** PDF goes through the browser's own print dialog, so page size, margins beyond the defaults and the final filename are the browser's to decide.
- **The first visit downloads the editor.** About 1.3 MB of editor (the rich view, with the maths renderer inside it) plus a shared code-editor chunk; diagrams fetch their engine the first time one is shown, and each diagram type a little more. Roughly 550 KB over the wire, then cached, then it works offline like the rest of the app.
- **There is no Copy button.** Every export is a download, so a browser that blocks the clipboard does not get in the way here; copy text out of the Source view yourself if that is what you want.
- **Mermaid's error messages are mermaid's.** A diagram that will not parse stays as its text with the first line of the message above it; the workbench keeps the last good picture while you fix it.
