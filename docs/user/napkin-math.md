# Napkin math

Write a formula once, and get a little calculator for it: named inputs, a live answer, a history of the numbers you have run through it, and code in four languages when you want to take it somewhere else.

_Describes the code as of v0.2.0 (unreleased; schema v10) — verify against source when in doubt._

## Writing a formula

Type into the **Formula** box. It is a proper maths editor: `/` makes a fraction, `^` makes an exponent, `sqrt` typed with a backslash (`\sqrt`) makes a root.

Type a whole word — `revenue`, `count`, `rate` — and it becomes **one variable**, not a row of letters multiplied together. That is the point of the tool: a formula you can read six months later.

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
- **Web component** — a single `.js` file with no dependencies. Drop it in a page, use its tag, and you have the same calculator with the same rules. The file opens with a worked example of how to style it from the host page, and lists every part you can reach.

**Export & import** handles the JSON:

- The box shows the current template's JSON as you type, syntax-highlighted, with **Copy JSON** beside it. The generated code is highlighted too, and so is the import box as you paste into it.
- **Download this template**, **Download all templates**, and **Download all calculations** as three separate files.
- Paste JSON into the import box, or **Choose a file…**, and it loads. Templates and calculation files are told apart automatically.

A shared template carries the **formula only**. The numbers you have run through it are a separate download, so handing someone a formula does not hand them your figures.

## Gotchas

- **Only numbers.** Fields are whole numbers or ordinary ones; there is no text or date input, because a formula could not do arithmetic with one.
- **Typing `pi` no longer makes π.** The editor's built-in text shortcuts are switched off, because they fire in the middle of variable names — a variable called `sqrtish` would silently turn into a square root and stop working. Type `\pi` with a backslash, or use the on-screen keyboard.
- **Templates live in this browser only.** They are in your backups (Settings → Backup), but not in a file anywhere until you export one. Clearing site data deletes them.
- **Deleting a template deletes its calculations**, and it says so before it does.
- **The generated code is a starting point.** It has no tests and no packaging, and it does exactly what the formula says — including any rounding surprise the formula already had.
- **Some formulas cannot become code.** An integral is a fine thing to write down and has no plain-function form; the generator names what it could not do rather than producing something that looks right and is not.
- **Rounding is not the same everywhere**, and the generated code accounts for it. This page rounds a half away from zero; Python and JavaScript each do something different with `-2.5`. Where they disagree, the generated file carries a small helper so the answer matches what you saw here.
- **The first visit downloads the formula editor and its maths engine** — a bit under a megabyte of gzipped code between them, plus a quarter of a megabyte of fonts. After that it is cached and works offline like everything else; the fonts have their own entry in Settings → Offline.
- **The clipboard can be blocked.** If a copy button says so, use the matching download instead.
