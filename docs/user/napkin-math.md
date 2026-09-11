# Napkin math

Write a formula once, and get a little calculator for it: named inputs, a live answer, a history of the numbers you have run through it, and code in four languages when you want to take it somewhere else.

_Describes the code as of v0.6.0 (schema v17) — verify against source when in doubt._

## Writing a formula

Type into the **Formula** box. It is a proper maths editor: `/` makes a fraction, `^` makes an exponent, `sqrt` typed with a backslash (`\sqrt`) makes a root.

Type a whole word — `revenue`, `count`, `rate` — and it becomes **one variable**, not a row of letters multiplied together. That is the point of the tool: a formula you can read six months later.

Under the box are buttons for the things nobody types from memory — **Σ Sum**, **Π Product**, **∫ Integral**, **÷ Fraction**, **√ Root**. Each drops a working example at the cursor, bounds and all, so you edit something that already parses rather than building it up from nothing.

As soon as the formula has variables, they appear in **Fields**, one row each. For every one you can set:

- a **label**, which is what the input is called;
- a **description** of what it means, which shows up beside the input *and* in every bit of code you generate;
- **No decimals**, for a whole number;
- **Positive or negative**, or **Positive only**;
- **No zero**, which is separate from the sign — "positive" and "not zero" are two different rules, and you may want either, both, or neither;
- **Required**.

Editing the formula keeps everything you have set for the variables that are still in it. A variable you remove loses its field, and the page says which.

## Doing the sums

Fill in the inputs under **Calculations** and the result updates as you type. If an input breaks one of its own rules, the page says so and refuses to answer rather than showing a number computed from a value you were warned about.

Give a calculation a name and **Save** it, and it joins the list on the right. Click any saved one to load its numbers back in, then **Update** to change it or **New** to start another.

You do not have to save the template first — saving a calculation saves the formula with it, under **Untitled** if you have not named it yet.

## Your library

Templates you save appear in the sidebar, with a search box. Click one to open it; the × deletes it, along with every calculation saved against it.

## Getting it out

**Code** turns the template into a real function:

- **Python**, **JavaScript**, **Go** or **Rust** — a plain function with a docstring in that language's own convention (NumPy sections for Python, `# Parameters` blocks for Go, `///` lines for Rust, JSDoc for JavaScript), typed parameters, your field descriptions, and a check for each field rule, so it refuses what this page refuses.
  The formula appears in the comment as Markdown maths — `$\(costPerMonth*12\)*years$` rather than the editor's `\left(\mathrm{...}\right)` — so it reads as a formula wherever the comment ends up.
- **Web component** — a single `.js` file with no dependencies. Drop it in a page, use its tag, and you have the same calculator with the same rules — including the formula, **properly typeset**, exactly as it looks here. The maths fonts it needs are built into the file, so it looks right on a page that has never heard of this app and never asks the network for anything. Expect roughly 50–80 KB depending on the formula. The file opens with a worked example of how to style it from the host page, and lists every part you can reach.

  **Putting several on one page?** Untick **Include the maths fonts** before generating — a component drops to about 15 KB — then use **Download the shared fonts stylesheet** for one file with every face in it, and link that in the page's `<head>`. All the components on the page will find the fonts there. Without the stylesheet they still work and still lay out properly; the formula is just drawn in the page's ordinary serif.

**Export & import** handles the JSON:

- The box shows the current template's JSON as you type, syntax-highlighted, with **Copy JSON** beside it. The generated code is highlighted too, and so is the import box as you paste into it.
- **Download this template**, **Download all templates**, and **Download all calculations** as three separate files.
- Paste JSON into the import box, or **Choose a file…**, and it loads. Templates and calculation files are told apart automatically.

A shared template carries the **formula only**. The numbers you have run through it are a separate download, so handing someone a formula does not hand them your figures.

## The calculation as a picture

**Export image**, under Save in the **Calculations** card, draws the calculation as a picture: the formula, the same formula with your numbers written into it, and the answer. It is for a document or a message, where a link to this page is no use to anyone. It can also put a saved calculation next to the current one — option 1 against option 2 — under the one formula (see **Compare with** below).

Four things to know before you send one:

- **The fonts are inside the file.** Maths is typeset with fonts your reader almost certainly does not have, so they travel in the picture. That is why it looks right wherever you paste it, and why it is bigger than something this small has any right to be — a few tens of kilobytes for three short rows. The dialog tells you how much of that is font.
- **The middle row is not the answer.** It is your formula with the numbers dropped into their places — `12500 - 4750`, not `7750`. The answer is the row underneath. Showing both is the whole point: someone can see what you worked out *and* how.
- **SVG for a document, PNG for a chat.** SVG is the drawing itself, so it stays sharp at any size and prints properly — that is what a word processor, a slide or a report wants. PNG is a photograph of that drawing at a fixed size, and it is what a chat window, an issue tracker or an email will actually accept. If you have the choice, choose SVG.
- **Nothing is saved.** The picture is built when you open the dialog and gone when you close it. Downloading or copying it is the only way to keep it.

You need a formula before the button does anything, and the **Result** row only appears once there is an answer to put in it.

What the dialog offers:

- **Rows** — tick **Formula**, **With your values**, **Result** and **Title** (the template's name, so an untitled one has nothing to show) in any combination. The preview redraws each time you change one.
- **Captions** — each row has a small caption above it, and each is yours to change. Untick **caption** beside a row to draw that row without one, or type a new one in the box beside it: "With your values" can become "At current market rate" for this picture. An empty box means no caption. **Reset captions** puts the three originals back. Captions are an export setting, not part of the template: they are not saved with it, and the next visit starts with the defaults.
- **Compare with** — draw a saved calculation alongside the one on the page. The menu lists every calculation you have saved against this formula (from this template, or from another template with exactly the same formula, shown as *Template › Calculation*); pick one and press **Add**. The picture then has the formula once across the top and one column per calculation underneath, side by side in the order you added them: each column carries its caption, its values, and its result captioned `Result — <name>`, so the two answers cannot be confused. A saved calculation is captioned with its saved name, which you can change in the box beside it, and each entry lists the values it draws. **Title for this calculation** captions the one on the page — "Option 2", say — and its result; leave it empty and the row keeps its ordinary caption. The **×** beside an entry takes it out again. Save a calculation first if you want to compare against it: only saved calculations have values to draw, and a template alone does not. Comparisons are not saved; if the menu says "No stored calculation uses this formula", nothing has been saved against it yet.
- **Theme** — light or dark. The colours are written into the file rather than taken from your theme here, so it looks the same on someone else's screen as it does on yours.
- **Transparent background** — leaves the paper out, so the picture sits on whatever colour you paste it onto. Choose the theme to match: dark text on a dark slide disappears.
- **Decimals in the result** — the number as this page shows it, or rounded to 0–4 places. This changes the picture only. Your calculation and the number on the page are untouched.
- **PNG size** — 1x, 2x or 3x. Pick 2x or 3x for anything that will be read on a good screen or printed. It does not affect the SVG, which has no fixed size to choose.
- **Download SVG**, **Download PNG**, **Copy PNG** — the last one puts the picture straight on the clipboard, ready to paste. If your browser blocks the clipboard, download instead.

Some formulas cannot have their values written into them cleanly. When that happens the middle row is left out rather than drawn wrong, and the dialog says why underneath the preview.

## Gotchas

- **Only numbers.** Fields are whole numbers or ordinary ones; there is no text or date input, because a formula could not do arithmetic with one.
- **Typing `pi` no longer makes π.** The editor's built-in text shortcuts are switched off, because they fire in the middle of variable names — a variable called `sqrtish` would silently turn into a square root and stop working. Type `\pi` with a backslash, or use the on-screen keyboard.
- **Templates live in this browser only.** They are in your backups (Settings → Backup), but not in a file anywhere until you export one. Clearing site data deletes them.
- **Deleting a template deletes its calculations**, and it says so before it does.
- **The generated code is a starting point.** It has no tests and no packaging, and it does exactly what the formula says — including any rounding surprise the formula already had.
- **Some formulas cannot become code.** A factorial, for instance: the generator names what it could not write rather than producing something that looks right and is not. Sums, products and integrals *do* become code — a real loop in every language.
- **A generated integral is approximate.** It uses Simpson's rule, which is exact for simple polynomials and close for everything else. This page works the same way, so the two agree. A generated sum or product rounds its bounds to whole numbers.
- **Rounding is not the same everywhere**, and the generated code accounts for it. This page rounds a half away from zero; Python and JavaScript each do something different with `-2.5`. Where they disagree, the generated file carries a small helper so the answer matches what you saw here.
- **The first visit downloads the formula editor and its maths engine** — a bit under a megabyte of gzipped code between them, plus a quarter of a megabyte of fonts. After that it is cached and works offline like everything else; the fonts have their own entry in Settings → Offline.
- **The clipboard can be blocked.** If a copy button says so, use the matching download instead.
