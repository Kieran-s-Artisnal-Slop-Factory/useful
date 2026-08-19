# Scheduler

The Scheduler holds two kinds of thing — **events**, which happen at a time, and **TODOs**, which have a status, a priority and an optional due date — and shows them three ways: a list, a three-column board and a month calendar. TODOs can repeat, carry comments, and raise a banner when they fall due while the app is open.

_Describes the code as of v0.2.0 (unreleased; schema v7) — verify against source when in doubt._

## Events and TODOs

**+ TODO** and **+ Event** at the top open the same panel with different fields.

A **TODO** has a title, a markdown description, an optional due date with an optional time, a priority (low, medium, high, urgent), a repeat rule, a "Notify when due" switch, and a comment thread. It moves through three fixed states: TODO → In progress → Completed.

An **event** has a title, a markdown description, a date and time (or All day), an optional end date and time, and a "Notify at start" switch. Events have no status and cannot repeat.

## The three views

The List / Board / Calendar buttons switch between them, and the one you leave it on is remembered.

**List** — every TODO in your own order, with completed ones sunk to the bottom. Each row has a status drop-down, the title (click it to open), the due date, the priority, and Edit and Delete. Drag a row by the ⠿ handle to reorder: drop it on another row to sit above it, or on the strip below the table to send it to the end. Events do not appear here.

**Board** — the three statuses as columns, with a count each. Cards show the title, due date and priority. ← and → move a card between columns, ↑ and ↓ move it within one, and dragging by the grip does both. Dropping on a column adds the card to the bottom of it; dropping on another card in the same column inserts above that card.

**Calendar** — a month grid. Events sit on their start day, dated TODOs on their due date, completed ones struck through. Click a day number to create an event on that day, click an entry to open it, and hover an entry for a moment to get a preview with its rendered description. Drag an entry onto another day to reschedule it: a TODO's due date moves, an event keeps its time of day and shifts its end by the same amount. ← Today → move between months.

## Opening, editing and deleting

Clicking a title, a card or a calendar entry opens it in a read view: its attributes, its description, and — for a TODO — its comments. The pencil switches to editing, Delete asks for confirmation, and Close or Escape leaves it. Creating something opens the same panel straight into editing.

## Comments

TODOs only, in the read view. Type into the box and press Comment; each comment is markdown, stamped with its time, oldest first, with its own Delete button.

## Priorities

Four levels. Urgent and high are coloured, an overdue due date turns red, and that is the whole story — priority sorts nothing. Order is whatever you dragged it into.

## Recurrence

TODOs only. Two kinds of rule: **every N** days, weeks or months, or **weekly on** a set of ticked weekdays. Completing a recurring TODO immediately creates its successor — exactly one, at the bottom of the TODO column, carrying the same title, description, time of day, priority, notify setting and rule.

The successor's due date is worked out from the completed one's **due date**, not from when you completed it: "every 3 days" means three days after it was due. Monthly rules clamp to the end of a short month, so 31 January plus one month is 28 or 29 February. A weekly rule picks the next ticked weekday within the following seven days.

## Due notifications

Tick "Notify when due" on a TODO or "Notify at start" on an event. While useful is open, a banner appears in the bottom-right corner within a second of the moment — tagged DUE for a TODO, NOW for an event — plus a system notification if you have granted permission.

## Gotchas

### What is not built yet

- **Events cannot repeat.** Only TODOs have a repeat rule.
- **There is no week or day view** — the calendar is month-only.
- **Narrow screens show only day numbers** on the calendar; the entries are hidden because they do not fit. Use the list or the board on a phone.
- **A multi-day event appears only on its start day.** Nothing stretches across cells.
- **Comments cannot be edited.** Delete and re-add is the only way to change one.
- **The list has no keyboard reordering.** The board's arrow buttons are the keyboard route.

### Notifications

- **They only fire while useful is open** in a tab or an installed window. Anything that falls due while it is closed is simply skipped — there is no catch-up, unlike a timer's MISSED banner.
- **A TODO with a due date but no time never notifies.** The time is what it fires on, and the time field only unlocks once a date is set.
- **Scheduler banners are silent.** No sound, no vibration — that is timers only.
- **Permission is only ever requested by the Timers page.** If system notifications never appear, start a timer once with "Show notification" ticked and accept the prompt. The in-app banner needs no permission.
- **Reloading within a minute of a due moment can announce it twice.** Nothing is written when an item falls due, so a fresh page has no memory of having announced it.

### Ordering and dragging

- **The list is your manual order, not due-date order.** There is no sorting anywhere: completed TODOs sink to the bottom and everything else stays where you dragged it. The board columns use the same order, so rearranging one rearranges the other.
- **Dragging a card to a different column always drops it at the bottom**, whichever card you aim at.
- **On a touchscreen, start the drag from the handle** — the ⠿ in the list, the grip on a board card. Anywhere else on a row scrolls the page. On the calendar the entry itself is the handle.
- **A drop that would not change anything changes nothing**, including dropping a calendar entry back on its own day.

### Repeats, deletes and dates

- **Completing a recurring TODO is what creates the next one.** Nothing appears from merely looking at the calendar or reloading.
- **Un-completing and re-completing creates another one.** Moving a completed TODO back to TODO does not remove the successor already made, and completing it again makes a second.
- **Completing an overdue recurring TODO can produce one that is already overdue**, because dates chain from the due date rather than from today.
- **A recurring TODO with no due date makes an undated successor.**
- **"weekly on…" with no weekdays ticked does not repeat at all.** Tick at least one day.
- **Clearing a due date drops the due time with it.**
- **Deleting a TODO deletes its comments too**, in the same confirmation, and neither can be undone from inside the app — recover from a backup file if you need them.
- **The calendar forgets which month you were browsing.** Switch to the list or the board and back and it returns to the current month. That switch is also when it re-checks the date: left open past midnight it keeps marking yesterday.
