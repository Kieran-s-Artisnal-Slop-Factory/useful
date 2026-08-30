# File tree

**File tree** (under Generators, or Ctrl/Cmd+K) draws the `├── └──` tree you see in READMEs. Build one by clicking, or paste a real directory listing and let the page read it. Nothing is uploaded, and nothing is saved.

_Describes the code as of v0.4.0 (unreleased; schema v13) — verify against source when in doubt._

## Building one

The tree starts with an example. Click a row to select it, then **+ Folder** or **+ File** to add inside it. Type in a row to rename it, use ↑ and ↓ to move it among its neighbours, and × to delete it and everything under it.

**Drag the ⠿ handle** to move a row into a folder. On a touchscreen the handle is the only place a drag starts — a finger on the row itself has to stay a scroll.

**Sort** puts folders first and then sorts by name, the way `ls` does. **Reset** brings the example back; **Clear** empties the tree down to its root, so you can type your own from nothing.

## Pasting a listing

Open **Paste a listing** and paste the output of any of these:

- `ls`, `ls -1`, `ls -R`
- `dir`, `dir /b /s`
- `tree` (Linux/macOS) or `tree /f` (Windows)
- a tree you typed yourself with indentation

The page works out which one it is. If the guess is wrong, pick the format yourself under **Read it as** and press **Read it** again.

Lines it could not make sense of are **listed under the result** rather than dropped, with their line numbers — so a listing that half-worked tells you which half.

## Getting it out

- **Copy text** / **Download .txt** — the tree as characters.
- **Copy SVG** / **Download .svg** — the same tree as a picture.
- **Download .png** — the picture, flattened. The safest thing to send someone.
- **Download .json** — the tree itself, which you can load back later with **Load a tree you exported earlier**. This is the only way to keep one.

## Options

- **Drawing** — box characters (`├── └──`) or plain ASCII (`|--`, `` `-- ``).
- **Root** — show its name, hide it entirely, show it as `.`, or call it something else.
- **Emoji** — off, a folder/file split (📂 / 📄), or by file extension with a table you can edit. **Restore defaults** brings the shipped dozen back; **Clear all** removes every rule, including those, so every file falls back to 📄.
- **Trailing / on folders** and **Full paths instead of names**.

## Gotchas

- **Box-drawing characters need a font that has them.** Most terminals do; some CI logs, some editors and some fonts do not, and there your tree becomes question marks. **Plain ASCII** says the same thing with characters every font has had since 1963 — use it when you do not know where the text is going.
- **Emoji in an SVG render in the reader's font, not yours.** An exported SVG carries no font with it, so on a machine without an emoji font your labelled tree is a column of empty rectangles. Send the PNG if that matters.
- **Nothing is saved.** Closing the tab loses the tree. Download the `.json` if you want it back — that file re-imports exactly.
- **The page guesses folder or file from the name.** A listing rarely says which is which, so anything with an extension is read as a file and anything without as a folder. `Makefile` comes back as a folder; fix it by putting something in it, or just rename around it.
- **A tree cannot go inside itself.** Dragging a folder onto something inside it is refused and says so — the alternative is a subtree that quietly leaves the tree.
- **`dir /b /s` and `find` lose the top.** Full paths share a prefix, and the page uses that shared prefix as the root, so `C:\Users\you\projects\myapp\…` comes back as `myapp` rather than five empty levels.
