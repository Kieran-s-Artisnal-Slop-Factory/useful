# Web playground

A scratchpad for a web page: **HTML**, **CSS** and **JavaScript** (or TypeScript) in three tabs, with the result rendering beside them as you type. Find it under **Playgrounds** in the sidebar, or search for it with Ctrl/Cmd+K. Nothing is saved until you name a session and press Save, and everything runs in your browser — nothing you type is sent anywhere.

_Describes the code as of v0.5.0 (unreleased; schema v16) — verify against source when in doubt._

## Using it

1. Type in any of the three tabs — **index.html**, **style.css**, **script.js**. The preview catches up about half a second after you stop typing. Each tab keeps its own undo history, so switching tabs never costs you an undo.
2. On the HTML and CSS tabs, **Emmet** is on: type an abbreviation like `div.card>h2+p` and press <kbd>Tab</kbd> to expand it.
3. The **Console** strip below the preview shows anything your code logs, plus any error it throws and any promise it fails to handle. **Clear** empties it; it also clears itself whenever the preview rebuilds.
4. **Layout** decides where the preview goes:
   - **Split** — editor and preview side by side. This is how it starts.
   - **Editor** — the code fills the page and the preview is hidden. For when you know what you are writing and want the room.
   - **Preview** — the preview fills the page and the editor is collapsed. For looking at the result properly.
   - **Modal** — the preview opens over the page, almost fullscreen. Close it with the × in the corner, with <kbd>Esc</kbd>, or by clicking outside it; any of them puts the preview back beside the editor.
5. **Full / Tablet / Mobile** set the preview's width, and you can drag its right-hand edge to any width in between. Picking a preset resets the drag.
6. **Script language** switches the script tab between JavaScript and TypeScript.
7. **Copy this tab** puts the current tab on the clipboard. **Export .zip** downloads the whole thing as `index.html`, `style.css` and `script.js` — a folder that opens in a browser on its own.
8. **Clear all tabs** empties all three (it asks first, unless they are already empty). **New** starts again from the example.

## Saving your work

Type a **Name** and press **Save**. The session appears in the list below, and the page reopens it the next time you come back. Saving again updates the same session rather than making a second one; **New** starts a fresh unsaved one; **Delete** removes a saved session.

Saved sessions are part of your backup, so your code travels with the rest of your data (Settings → Backup). Until you press Save, a session exists only in the page — reloading loses it.

## Gotchas

- **While the modal is open, the rest of the page is out of reach.** That is what makes it a modal — close it with the ×, <kbd>Esc</kbd> or a click outside before doing anything else. Your code keeps running in it, and whatever it logs is waiting in the Console when you close it.
- **Your layout choice is not remembered.** Reloading goes back to Split, like everything else on this page.
- **The preview cannot reach the internet.** It runs in a frame with no origin of its own, which is exactly what stops your code reading this app's stored data — and it is also why `fetch` to another site fails there. A page with no origin is refused by every server. This is not something a setting can turn off; use the HTTP playground if you need to call an API.
- **TypeScript here is stripped, not checked.** The types are removed and the rest runs as written. `const n: number = "hello"` is not an error — it runs, and `n` is the string. You get TypeScript's syntax, not its safety. A genuine *syntax* error does stop the rebuild, and the message appears under the editor while the last working preview stays on screen.
- **Nothing is saved until you press Save.** Typing, running and exporting all write nothing. That is deliberate — an idle scratchpad should not fill your storage — but it does mean a reload without saving loses the buffers.
- **The preview restarts completely on every change.** Anything your page had built up — a counter, a game state, text someone typed into it — goes back to the beginning each time you edit. That is the cost of it always matching the code.
- **`alert`, `confirm` and `prompt` do nothing**, along with forms, pop-ups and anything that would navigate the page away. The sandbox blocks them. Use `console.log` instead — it goes to the strip.
- **The console shows the last 50 messages.** A loop that logs thousands will not grow the page; you will see the tail.
- **Very long log lines are cut short** at around 2,000 characters, with a note. Logging a whole DOM tree gets you the beginning of it.
- **Your code is in your backup.** That is the point — it travels with your notes and everything else — but it does mean an exported backup file contains whatever you wrote here. If that matters, delete the session before exporting.
