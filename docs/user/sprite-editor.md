# Sprite editor

Draw pixel art on a grid of characters. Each character in the grid stands for a colour, and the legend says which — so a sprite is really a little picture written as text.

_Describes the code as of v0.4.0 (unreleased; schema v16) — verify against source when in doubt._

## Drawing

Give a sprite a name and **Create**. You get a 16×16 grid and a starter legend of six colours.

- **Pick a colour** by clicking its character in the legend — that becomes your brush.
- **Paint** by dragging across the grid, or type a character straight into a cell. Arrow keys move between cells, so a sprite can be drawn without a mouse at all.
- **Erase** with the Erase button (it paints the transparent character), or clear a cell by emptying it.
- **Size** changes the grid between 4 and 48 a side. Making it smaller crops from the right and bottom; making it bigger adds transparent space.
- **Undo** and **Redo** cover everything — painting, resizing, legend changes, importing. One drag is one undo, however many pixels it crossed. `Ctrl+Z` and `Ctrl+Y` work too.

**Preview** swaps the grid for the finished sprite and offers eight animations to try. They are only a preview; the sprite you export is a still image. Animations stop by themselves if your system is set to reduce motion.

## The legend

Each row maps one character to one colour. Add a mapping with a character and a colour, recolour one by editing its value, or remove it — removing a mapping leaves those pixels in place but unpainted, so putting it back brings them back.

Colours can be hex (`#ff8800`), `rgb(…)`, `hsl(…)` or a plain name like `red`. Anything else is refused with a message rather than saved.

`.` and a space always mean "nothing here" and cannot be reassigned.

## Examples

Fifteen creatures at four growth stages each, to pull apart and learn from. Picking one **replaces** what is currently open — undo brings your work back.

## Saving and sharing

Sprites save themselves as you draw, and the one you had open comes back next time. **All sprites** lists them; delete from there.

Export gives you:

- **TXT** — just the grid, one row per line.
- **JSON** — grid and legend together. This is the shareable format: paste one back into the Import box to load it.
- **SVG** — a real vector file, crisp at any size.
- **PNG** — a picture at the size in the **Image size** box.

TXT, JSON and PNG can also go straight to the clipboard.

## Gotchas

- **Sprites live in this browser only.** They are in your backups (Settings → Backup), but they are not in a file anywhere until you export one. Clearing site data deletes them.
- **Loading an example replaces the open sprite** — grid, legend and size. Undo restores it, but only until you close the tab.
- **Grids are square**, between 4 and 48 a side. A smaller sprite imported from elsewhere is grown to 4×4; type a bigger number than 48 and it becomes 48.
- **Shrinking crops.** Going from 32 to 16 keeps the top-left quarter and drops the rest; undo puts it back, so check before you leave.
- **The clipboard can be blocked.** If a copy button says so, use the matching download instead — some browsers only allow copying in response to a very recent click.
- **A sprite is one frame.** There is no animation timeline and no sprite-sheet export; the animations in Preview are just a way to see how it would move.
- **Sprites from [retoken](https://github.com/Descent098/retoken) import fine** — its files say `retoken-sprite` and are read as-is. Files exported here say `useful-sprite`, which older retoken builds will not accept.
