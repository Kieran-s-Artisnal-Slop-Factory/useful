# Logo generator

Make a square logo, app icon or avatar: a picture generated from a word, or an icon on a coloured tile. Everything happens in your browser, and nothing is saved.

_Describes the code as of v0.3.0 (unreleased; schema v13) — verify against source when in doubt._

## Two ways to make one

**Generators** turn text into a picture. Type a name, an email, a project — the same text always gives the same result, and a different text gives something unrelated. Two engines:

- **DiceBear** — 31 illustrated styles, from friendly faces to abstract shapes. Pick a style from the grid.
- **Jdenticon** — the geometric identicon you have seen next to usernames. It has its own controls: which hues are allowed, how strong and how light the colours are, the background, and the padding.

**Badge** composes one instead: a rounded tile with either an **icon** (about 2,000 to pick from — use the filter box) or an **emoji** on it. Set the tile colour, the icon colour, and how round the corners are.

The **Name / seed** box at the top feeds whichever generator is open, and also names your download.

## Getting it out

- **Download SVG** — a real vector file, sharp at any size.
- **Download PNG** — a picture at the size in the **PNG size** box, up to 4096.
- **Copy markup** puts the SVG source on the clipboard; **Copy PNG** puts the picture there, ready to paste into a chat or a document.
- **Open in SVG editor** hands the logo to this app's [SVG editor](svg-editor.md) as a new document, so you can take it apart, recolour pieces, or build something around it.

## Credit, and when you owe it

The tool tells you, under the seed box, what the style you picked expects. In short:

- **14 of the 31 DiceBear styles are MIT** — use them anywhere, credit nobody.
- **13 have CC BY 4.0 artwork** — you must credit the original artist wherever the logo appears. That includes a favicon on a site you charge for.
- **4 — avataaars and bottts, in both variants — carry their own terms**: free for personal and commercial use, but not an open-source licence. Read it before you ship.

Jdenticon and the icon set ask for nothing.

## Gotchas

- **Nothing is saved.** Leave the page and your settings are gone — there is no history and no "my logos" list. Download or copy before you go. (The one exception is **Open in SVG editor**, which deliberately creates a document there.)
- **Seeds are not secret.** Anyone who types the same word gets the same picture. That is the point, but it means a generated avatar identifies the text behind it to anyone who guesses it.
- **Emoji look different on every device.** An emoji badge saved as SVG stores the character, not a picture of it, so it will render in the viewer's own emoji font — a rocket on your machine may be a different rocket on someone else's. Save it as **PNG** if it has to look identical everywhere.
- **There are no company logos** in the icon picker. Brand marks are trademarks and the icon set deliberately excludes them.
- **The first visit downloads the drawing engine** — a bit under a megabyte for the avatar styles, and more if you open the Badge tab or switch to Jdenticon. After that it is cached and works offline like everything else.
- **The clipboard can be blocked.** If a copy button says so, use the matching download instead — some browsers only allow copying immediately after a click.
- **Square only, 256 across.** The PNG export scales it up to whatever you ask for; the shape does not change.
