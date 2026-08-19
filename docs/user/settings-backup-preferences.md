# Settings, backups and preferences

Two pages in the sidebar look after the app itself. **Settings** holds appearance, storage, the offline download, backup export/import, and a locked developer section. **Preferences** holds the defaults the tools fill in for you, and shows every value the app has remembered. Everything the app knows lives in this browser on this device — the backup file is the only way to copy it anywhere else.

_Describes the code as of v0.2.0 (unreleased; schema v7) — verify against source when in doubt._

## Settings

### Appearance

Three buttons: **auto**, **light**, **dark**. Auto follows the operating system. The choice is stored in this browser and applies immediately; it is not part of a backup.

### Storage

A short reminder that this device holds the only copy, and a **Request persistent storage** button. It asks the browser to protect the app's data from being evicted when disk space runs low. The browser answers "granted", "denied", or "unsupported", and that answer appears next to the button. Nothing asks on your behalf — the button is the only trigger.

### Offline

The same panel the app offers once after you install it: a checklist of downloadable bundles — the app itself (every page and chunk, including tools you have never opened), the background remover's model, and each SQL engine — with sizes for the heavy ones, and a button that downloads the ones you tick. Each bundle reports its own progress and its own failure, so a problem names itself. When every bundle you picked finishes, the panel records the time and shows "Last downloaded …" from then on. You can run it again whenever you like.

### Backup

**Export JSON** downloads one file named for today's date containing everything the app stores:

- Timers, the stopwatch, calendar events, TODOs and their comments
- SVG editor documents
- SQL playground editor text and any saved database snapshots
- Your preferences and remembered values
- Markers for anything you have deleted (see the Gotchas)

It does not contain the theme, the sidebar's collapsed state, the developer unlock, or anything you downloaded for offline use. Images are never stored by the app, so they are never in a backup either. The SQL playground's live database is not in the file — only the text needed to rebuild it, if you saved a snapshot.

**Import JSON** loads a backup back in. Before picking the file, choose how it should be applied:

| Mode | What happens |
|---|---|
| **Restore** | The file replaces what is on this device. Every kind of item the file covers is emptied first, then filled from the file. Kinds of item the file does not mention are left untouched, so an old backup cannot wipe something added by a later version of the app. |
| **Merge** | The file is folded into what is already here. For each item, whichever copy was changed more recently wins. For TODOs and for preferences the comparison is per field, so a change you made here and a different change in the backup both survive. |

You are asked to confirm, with a warning that says which of the two you are about to do. If the file is not a valid backup — truncated, hand-edited, from a newer version of the app — the import is refused and **nothing on the device is changed**; the message says so. On success the page reports how many items were loaded, how many were skipped because the local copy was newer, and reloads itself a moment later.

### Developer

Locked by default. Unlocking asks you to type one long sentence exactly, and the unlock lasts only until you close the browser tab. Behind it sits **Clear all data**, which wipes everything on this device after one more confirmation. There is no undo — export a backup first.

## Preferences

The Preferences page has two halves: settings you can change, and a list of things the app has remembered on its own.

**Timer defaults** — Play sound, Vibrate, Show notification, Delete when finished. These are pre-filled into every new timer. Changes save the moment you tick a box; there is no save button.

**Alarm** — how long a finished timer keeps ringing or vibrating, from 1 to 25 seconds (25 by default). The banner itself stays until you dismiss it or use the timer again; this only caps the noise.

**Auto-remember defaults from the last saved timer** — on by default. While it is on, saving a timer makes its completion settings the new defaults above. Turn it off and the defaults only ever change on this page.

**Remembered values** — a read-only table of everything else the app has stored for you, by its internal name and value. Today that is the scheduler view you last used, the last timezone pair, the last photography sensor format, the JPG quality shared by the image converter, resizer and compressor, the SVG document you last opened, the SQL engine you last picked, and whether the offline offer has been made and when the last offline download finished. The table is built by subtraction — anything the app starts remembering appears here automatically, so nothing is stored about you invisibly.

Every one of those values is written only when you do something: pick a zone, move a slider, switch a view, open a document. Opening a page never writes anything.

## Gotchas

- **This browser profile is the only copy.** There is no account and no server. A different browser, a different profile, a private window, or another device is a different, empty copy of the app. Nothing syncs between them — moving data means exporting a backup and importing it on the other side.
- **Clearing site data erases everything.** "Clear browsing data", "Remove site data" and similar cleanup tools take the whole database with them. Persistent storage protects against the browser evicting data on its own when disk space runs low; it does not protect against a deliberate clear, and the browser can refuse the request.
- **Import defaults to Restore, not Merge.** The Restore button is preselected, and Restore *replaces* the data on this device for everything the file covers. If you meant to fold two devices together, click **Merge** before choosing the file. The confirmation dialog spells out which one you are about to run — read it.
- **A backup from a newer version of the app will not import into an older build.** It is refused outright with a message naming both versions, even if the difference would not have mattered. Backups from *older* versions import fine. If you keep an old copy of the app on another device, export from the old one and import into the new one, not the other way round.
- **Deleted items leave a marker behind.** Deleting a timer, TODO or document strips its contents immediately but keeps a small record that it existed and when it went. That record rides along in backups. It is what stops a merge from resurrecting something you deleted afterwards — and it means the number of items an import reports can be larger than the number of things you can see.
- **Merge keeps the newer copy, and a tie keeps what is already here.** If the same item was edited on both sides at the same instant, the local copy wins. If nothing in the file is newer, the import reports everything as skipped and changes nothing.
- **Restoring an old backup does not undo a version upgrade.** It brings back the items the file covers; anything the app has learned to store since then is simply left alone.
- **The theme, the sidebar's collapsed state and the developer unlock are not backed up.** They live in this browser separately and have to be set again on a new device.
- **Offline downloads are not backed up either.** After restoring onto a new device, run the Offline panel again there if you want everything available without a network.
- **Auto-remember only covers timers.** The other remembered values — the timezone pair, the sensor format, the JPG quality, the last SVG document, the SQL engine — are always remembered, whether or not that switch is on.
- **Remembered values are not tidied up.** The last-opened SVG document is still listed after you delete that document; it simply is not reopened. A remembered value the app cannot use any more is ignored rather than cleared.
- **Preferences and TODOs merge field by field; everything else merges whole.** Change the alarm duration here and the timer defaults on another device, and a merge keeps both. Edit the same *timer* on two devices and one of the two edits is lost.
- **A failed import is a clean failure.** The whole file is checked before a single item is written, so a corrupt or truncated backup leaves the device exactly as it was.
