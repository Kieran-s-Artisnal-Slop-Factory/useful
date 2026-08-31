# Getting started

useful is a set of small tools — timers, a scheduler, image editors, calculators, generators and a SQL playground — that run entirely inside your browser. There is no account to create and no server behind it: what you make is stored in this browser, nothing is uploaded, and once a page has loaded it keeps working without a network.

_Describes the code as of v0.4.0 (unreleased; schema v16) — verify against source when in doubt._

## Getting around

Three routes to the same tools:

- **The sidebar**, grouped by category — Time, Scheduler, Images, Calculators, Generators, Playgrounds, and App (Home, Preferences, Settings). The page you are on is highlighted.
- **The home screen**, which lays the same tools out as tiles with a one-line description each.
- **Search**: press Ctrl+K (Cmd+K on a Mac), or click **Search** in the top bar.

### The search palette

Type a few letters — they do not have to be consecutive, so "tz" finds Timezones and "remove bg" finds the background remover. It matches each tool's name, its alternative names, its category and its one-line description, and shows up to ten results, best match first. Up and Down move through them (wrapping at the ends), Enter opens the highlighted one, Escape closes and puts the keyboard back where it was. Ctrl+K closes it again too. It searches tools, never the contents of a tool.

### The sidebar and the drawer

On a wide window the sidebar sits down the left and the button at the top-left collapses it; that choice is remembered in this browser. On a narrow window (narrower than about 1024 px) the same button slides the sidebar over the page instead — tap the dimmed page or press Escape to close it, and it closes by itself when you open a tool.

## Light and dark

Settings → Appearance offers **auto**, **light** and **dark**. Auto follows whatever your system is set to. The change applies immediately and is remembered by this browser.

## Settings and Preferences

Two separate pages, both under **App**:

- **Settings** — appearance; storage (ask the browser to protect your data from eviction); offline downloads; backup export and import; and a Developer card, locked until you type a warning phrase, whose only option wipes all local data.
- **Preferences** — per-tool defaults and remembered values: what new timers start with (sound, vibrate, notification, delete-when-finished), how long a finished timer is allowed to ring, a switch for whether saving a timer updates those defaults, and a read-only table of everything the tools have remembered for you — the last timezone pair, the scheduler's last view, the last photography sensor format, and so on. Loading either page changes nothing; only the controls write.

## Gotchas

- **Your data lives in this browser and nowhere else.** Another browser, another device, or a second profile in the same browser shows an empty app. Nothing syncs, and there is no copy on a server to fall back on.
- **Back it up.** Settings → Backup → Export JSON writes one file containing every table. Do it regularly, and before anything drastic.
- **Restore replaces, Merge folds.** Restore swaps this device's data for the file's; Merge keeps whichever copy of each item is newer. Both ask for confirmation first, and the app reloads after a successful import.
- **A broken backup file changes nothing.** The whole file is checked before a single row is written, so a truncated or hand-edited file fails cleanly. A backup written by a newer version of useful is refused outright.
- **Storage is evictable.** Browsers may clear an unused site's data on their own (iOS is the strictest), and clearing site data yourself removes everything, offline downloads included. Settings → Storage → Request persistent storage asks the browser not to; it can say no.
- **Theme, sidebar collapse and the developer unlock are not part of a backup.** They are kept separately, per browser profile, and the developer unlock resets when you close the browser.
- **Clear all data cannot be undone.** It is behind the Developer card, behind a typed phrase, for that reason — export first.
- **Private or incognito windows forget everything when closed**, including anything you downloaded for offline use.
