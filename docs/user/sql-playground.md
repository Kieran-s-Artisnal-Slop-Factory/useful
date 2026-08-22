# SQL playground

A real database running inside the browser tab, under **Playgrounds** in the sidebar (or Ctrl/Cmd+K). Pick SQLite or Postgres, write SQL in the editor, run it, and browse the tables you made. It is a genuine engine, not a simulation, so the error messages and the dialect quirks are the real ones — but the database itself lives in the tab's memory and there is no server anywhere. Your editor text is kept between visits; the data is not, unless you save a snapshot or export a file.

_Describes the code as of v0.3.0 (unreleased; schema v12) — verify against source when in doubt._

## Picking an engine

Two buttons at the top: **SQLite** and **Postgres**. Whichever you pick is remembered and comes back next visit; SQLite is the default because it starts far faster.

Each engine is downloaded the first time you choose it — SQLite is around a megabyte, Postgres around twelve — and cached afterwards, so later visits and offline use need no network. You can also fetch either one ahead of time from Settings → Offline, where they are listed as "SQLite engine" and "Postgres engine". While an engine is starting up the Run button reads "Starting SQLite…" and the controls are disabled.

Switching engines is a clean break: each has its own editor text, its own saved snapshot and its own database. Nothing crosses over.

## Writing and running SQL

The editor highlights the dialect of whichever engine is active and offers keyword completion. Run the whole buffer with the **Run** button or with Ctrl+Enter (Cmd+Enter on a Mac).

- **Rows come back in a Results table**, with a count in the card header. The table pages rather than truncating, and it has a search box, a filter builder, sortable headers and an **Export CSV** button — all of it working on the rows your query already returned, so none of it runs anything again.

A query that matches nothing still shows its columns, so an empty result reads as "nothing matched" rather than as a broken query.
- **Statements that return nothing** — CREATE, INSERT, UPDATE and friends — say so instead of showing an empty table.
- **Errors** appear under the editor in full, including Postgres's detail, hint and character position. The database is left exactly as it was; an error never wipes anything.

**Wipe database** empties every table (it asks first if there is anything to lose). Your saved snapshot is not affected by it.

Your editor text autosaves shortly after you stop typing, and is flushed immediately when you run or switch engines.

## Browsing tables

The **Database** card lists every table in the current database as a button; click one to see it. Underneath is a page of the table's contents, fetched from the database itself — so a table with a million rows opens as fast as one with ten.

The same search box, filter builder, sortable headers and CSV button are here too, but they work differently: the database answers them. Filtering narrows what is fetched rather than what is drawn, and the row count under the table is the real number of rows in it.

The list refreshes after every run, keeping you on the same table if it still exists — though a run resets the browser's filter and puts you back on the first page, because the data underneath may have changed.

## Keeping a database

The live database is in memory. Two things survive:

**Save snapshot** takes the SQL needed to rebuild the current database — schema and data — and stores it in this browser. Every later visit to that engine replays it automatically and shows "Restored your saved snapshot". **Clear saved snapshot** removes it again.

If the snapshot comes out over a megabyte, the tool stops and warns first, because that text has to be re-run every time the page loads. **Save anyway** accepts it; Cancel leaves the old snapshot in place.

**Exporting** is the other way out, and the better one for anything you actually care about — see below.

## Importing

**Import…** takes either a `.sql` script or a database file the engine itself wrote: a SQLite database (`.sqlite`, `.sqlite3`, `.db`) or a Postgres data directory (`.tar.gz`, `.tgz`, `.tar`). The tool looks inside the file to decide which it is, so a wrong or missing extension does not matter.

Importing replaces the current database, and asks first if there is anything in it. A `.sql` script that fails part-way is rolled back — the database you had is put back and the error is shown. Your saved snapshot is never touched by an import.

## Exporting

The **Transfer** card has a **Schema + data** / **Schema only** switch and an **Export…** menu:

| Option | What you get |
| --- | --- |
| Copy SQL to clipboard | The whole rebuild script as text |
| SQL file (.sql) | The same script as a download |
| SQLite file / PGlite data directory | The engine's own binary format — the exact file the Import above takes back |
| CSV (.csv) | Not from this menu — the **Export CSV** button on either table, for the rows it is showing |
| JSON (.json) | With data, every table as an array of rows; schema only, every table as its column list |

## Gotchas

- **The database lives in the tab's memory.** Reloading the page, switching engines, closing the tab or navigating away all destroy it. Save a snapshot or export a file if you want it back. The editor text survives on its own; the data does not.
- **The snapshot does not update itself.** It is whatever the database looked like the last time you pressed **Save snapshot**. Later queries, imports and wipes leave it exactly as it was, so a snapshot can quietly go stale — press Save again after changes worth keeping.
- **A large snapshot is re-run on every single page load,** which is what the warning above a megabyte is about. An export is a better home for a big database.
- **A Postgres snapshot cannot be loaded into SQLite,** or the other way round. Each engine keeps a separate workspace, keyed to itself, and a snapshot is only ever replayed into the engine that made it. The same applies to the binary export files.
- **Only the editor text and an explicit snapshot are stored**, plus which engine you last used. They ride Settings → Backup like everything else. The live database never touches storage.
- **Each engine downloads once**, but that download is cached with the rest of the app, so a future app update can cause it to be fetched again. (The background remover's model is kept apart and does not behave this way.)
- **Snapshots and SQL exports do not cover everything.** For SQLite: tables, data, indexes, triggers and views. For Postgres: schemas, tables, data, sequences, constraints, indexes and views — but not functions, triggers, custom types, enums or extensions, which are dropped silently. If you rely on those, export the binary database file instead.
- **Export CSV means different things in the two tables.** In **Results** it writes every row your filters left. In the **Database** browser it writes the page on screen — the rest of the table was never fetched. The button's tooltip says which.
- **The two engines report rows differently.** Run several statements at once and SQLite shows the results of the first one that returns columns, while Postgres shows every statement's rows together.
- **There is no stop button.** A query that never finishes cannot be cancelled from the page; leaving or reloading ends it, and takes the database with it.
- If a saved snapshot fails to replay, you get whatever ran before the failure plus an error banner explaining why — not an empty database and not a silent success. **Wipe database** and start over if that leaves things half-built.
- **Filters and page size are not saved.** They reset when you switch tables, switch engines, run a statement, or reload. Nothing about how you were looking at a table is written down.

**Sorting a column that is empty on some rows** puts the empty ones last, whichever direction you sort. When a page happens to end inside a run of empty values the browser counts rows to skip instead of jumping straight to them, and says so in a note — the results are the same, it is just slower.
