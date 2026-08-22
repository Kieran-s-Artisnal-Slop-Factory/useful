# Text tools

Tools for working on text itself, under **Calculators** in the sidebar (or Ctrl/Cmd+K and type their name). **Diff** compares two texts and shows exactly what changed. Nothing you paste into any of them is saved — close the tab and it is gone.

_Describes the code as of v0.3.0 (unreleased; schema v12) — verify against source when in doubt._

## Diff

1. Paste the **Original** text on the left and the **Changed** text on the right. You can also drop a text file onto either box, or use **Load a file…** under it.
2. The **Differences** card fills in as you type: a summary line (`+3`, `−1`, how many lines changed, and how alike the two texts are as a percentage), then the comparison itself.
3. **Compare by** picks the unit:
   - **Line** — the usual diff. Side by side, or **Inline** with `+` and `−` markers. When a line was rewritten rather than added or removed, the changed **words inside it** are marked, so a one-word edit reads as one word.
   - **Word** — the whole text as one flowing paragraph with the changed words marked. Best for prose.
   - **Character** — the same, down to individual characters. Capped at 40 000 characters across both boxes, because every character becomes a unit of comparison.
4. **Whitespace** and **Ignore case** change what counts as a difference. They never change what is displayed: your original spacing and capitalisation stay on screen.
5. The **Patch** card holds the same comparison as a standard unified diff — the format `git apply` and code review tools expect. **Context** sets how many unchanged lines surround each change. **Copy** puts it on the clipboard; **Download** saves it as `changes.diff`.

**Swap** exchanges the two boxes. **Clear** empties both.

## Gotchas

- **Two texts that differ only in their line endings are called out by name.** A file that has been through Windows uses CRLF where a file from macOS or Linux uses LF, and nothing on screen can show that difference — without the note, every single line would read as rewritten for no visible reason. The note can only appear for text you **loaded from a file**: a text box on a web page rewrites every line ending to LF as you type, so a pasted or typed comparison never has the difference to find.
- **A diff of two completely unrelated texts gives up on purpose.** Past a few thousand edits the tool stops looking for the shortest set of changes and reports the middle as one wholesale replacement, and says that it did. It is not the best possible diff of those two texts; it is the honest one, produced instead of freezing the tab.
- **Only the first 2000 rows are drawn.** The Patch card still contains the whole comparison, so copy or download it if you need everything.
- **Binary files are refused by name.** Dropping a PNG or a zip gets you a message rather than a screen of replacement characters. This tool compares text.
- **The percentage is not a plagiarism score.** It is how much of the two texts is shared, counted in whatever unit you are comparing by — so the same pair can be 60% alike by line and 95% alike by character.
- **Nothing is saved.** The page keeps no history, and reloading it starts empty. If a comparison matters, download the patch.
