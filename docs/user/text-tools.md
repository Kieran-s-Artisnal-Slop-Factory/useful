# Text tools

Tools for working on text itself, under **Calculators** in the sidebar (or Ctrl/Cmd+K and type their name). **Diff** compares two texts and shows exactly what changed; **Similarity** scores one word against as many others as you like and shows how each score was reached; **Text analysis** counts a text, scores how hard it is to read, lists what it repeats, and changes its case. Nothing you paste into any of them is saved — close the tab and it is gone.

_Describes the code as of v0.4.0 (unreleased; schema v16) — verify against source when in doubt._

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

## Similarity

1. Type a **Word**, then the words to compare it against — **one per line** — in the box beside it.
2. The **Scores** table gives every word a percentage under each of five algorithms, with the raw reading underneath (edits for the distance measures, the score itself for Jaro). Click a column heading to sort by that algorithm; the line above the table names the closest word under whichever column you sorted by.
3. **Working** on any row opens the third card for that pair. Pick an algorithm and the page shows how the score was reached:
   - **Levenshtein**, **Damerau** and **Indel** draw the full cost table with the cheapest route highlighted. **Back** and **Next** walk that route one move at a time, in words: keep this letter, substitute that one, insert, delete, swap.
   - **Jaro** and **Jaro-Winkler** show both words with their matched characters marked, then the window, the number of matches, the transpositions and the shared prefix — and the formula with those numbers filled in.

Which one to use, in short: **Jaro-Winkler** for names and identifiers (it is the fastest and it rewards a shared start), **Levenshtein** for a general "how far apart is this", **Damerau** when the difference is likely a typo (it charges one edit for a swap, so `teh` is one away from `the`), and **Indel** when you care how much of the two words is shared rather than how many keystrokes separate them.

## Text analysis

Paste text into the box at the top; everything below updates as you type.

- **Counts** — words (and how many are unique), characters with and without spaces, sentences, paragraphs and lines, the size in UTF-8 bytes, and how long the text takes to read silently or aloud.
- **Difficulty** — four scores. **Flesch reading ease** runs from about 0 to 100 and higher is easier, with the band it falls in underneath. **Flesch-Kincaid** and the **Automated Readability Index** are US grade levels. **SMOG** is a fourth grade level that only appears once the text has thirty sentences — until then the page says how many more it needs, rather than printing a number that means nothing. Open "The formulas, with this text's numbers in them" to see exactly how each was worked out.
- **What it repeats** — the fifteen commonest words, pairs or triples, with a tick-box to ignore filler words like *the* and *and*.
- **Transform** — seven buttons: sentence case, Capitalize Each Word, lower case, UPPER CASE, s̶t̶r̶i̶k̶e̶t̶h̶r̶o̶u̶g̶h̶, W I D E, and sPoNgEbOb. The result appears in its own box with **Copy** and **Download**; your original text is never changed.

## Gotchas

- **The readability scores are heuristics, not measurements.** Syllables are counted by rule rather than by dictionary, sentence boundaries are guessed, numerals and non-English text are not handled, and the formulas were fitted to English prose decades ago. Two texts one grade apart are not reliably different. The **Automated Readability Index** is the most trustworthy of the four for technical writing, because it counts characters instead of guessing syllables.
- **SMOG stays blank until thirty sentences.** That is the sample size it was built for; below it the number would be noise.
- **The four "lengths" disagree on purpose.** Characters counts what you would count, code points counts Unicode values, UTF-16 units is what most programming languages call `.length`, and bytes is what the text weighs in a file. A family emoji is 1, 7, 11 and 25 of those respectively.
- **Sentence case knows about titles but not about names.** `dr. smith arrived.` becomes `Dr. smith arrived.` — the tool knows `Dr.` is not the end of a sentence, and has no way to know `smith` is a surname.
- **Strikethrough is a text effect, not markup.** It is a combining stroke after each character, so it survives copy and paste into most places — but a font that does not carry the mark will show the text plain.
- **The five algorithms disagree, and that is the point.** The same pair can be 83% alike under one and 60% under another, because they are answering different questions. Sorting by a column sorts by that algorithm only.
- **A percentage is not a probability.** The distance measures are turned into percentages by dividing by the longest word (Levenshtein, Damerau) or by both words added together (Indel), which is what makes them comparable at all — it does not make them a confidence.
- **"Damerau" here means optimal string alignment**, the usual variant: it never edits the same stretch twice. That is why `CA` and `ABC` are three edits apart here rather than two.
- **The cost table is only drawn for words up to 40 characters.** The scores are exact either way; the grid just stops being readable.
- **Two texts that differ only in their line endings are called out by name.** A file that has been through Windows uses CRLF where a file from macOS or Linux uses LF, and nothing on screen can show that difference — without the note, every single line would read as rewritten for no visible reason. The note can only appear for text you **loaded from a file**: a text box on a web page rewrites every line ending to LF as you type, so a pasted or typed comparison never has the difference to find.
- **A diff of two completely unrelated texts gives up on purpose.** Past a few thousand edits the tool stops looking for the shortest set of changes and reports the middle as one wholesale replacement, and says that it did. It is not the best possible diff of those two texts; it is the honest one, produced instead of freezing the tab.
- **Only the first 2000 rows are drawn.** The Patch card still contains the whole comparison, so copy or download it if you need everything.
- **Binary files are refused by name.** Dropping a PNG or a zip gets you a message rather than a screen of replacement characters. This tool compares text.
- **The percentage is not a plagiarism score.** It is how much of the two texts is shared, counted in whatever unit you are comparing by — so the same pair can be 60% alike by line and 95% alike by character.
- **Nothing is saved.** The page keeps no history, and reloading it starts empty. If a comparison matters, download the patch.
