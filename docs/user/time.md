# Timers, stopwatch, pomodoro and timezones

Four tools under **Time**: countdown **Timers** that ring, buzz and notify when they finish; a **Stopwatch** with laps; a **Pomodoro** timer that cycles focus rounds and breaks; and a **Timezones** converter with city search. Timers, the stopwatch and the pomodoro remember the moment they were started or due rather than counting ticks, so reloading the page, switching to another tool or leaving the tab in the background never makes them drift.

_Describes the code as of v0.6.0 (schema v17) — verify against source when in doubt._

## Timers

**+ New timer** opens the form:

- **Label** — required.
- **Duration** — hours (up to 99), minutes and seconds; it has to add up to more than zero.
- **Description** — optional markdown, shown behind a "Description" toggle on the timer's card.
- **Play sound** — three short beeps.
- **Vibrate** — only offered where the browser claims the device can.
- **Show notification** — a system notification. Only offered where the browser supports notifications; the first time you start such a timer, useful asks for permission.
- **Delete when finished** — the timer removes itself once it has fired. Its banner stays.

**Save** stores the timer; **Save & start** stores it and starts it in one go.

Each timer is a card with its remaining time and the buttons that make sense for it: Start when idle; Pause and Reset while running; Resume and Reset while paused; Run again and Reset once it is done. Edit and Delete are always there, and deleting asks first. Nothing disappears when it fires, so every timer doubles as a reusable preset. Running timers sort to the top, then paused, then idle, then done, alphabetically within each group.

New timers are pre-filled from the remembered completion actions, and saving a timer makes its actions the new defaults. Both the defaults and the switch that controls that behaviour are on the **Preferences** page, alongside the alarm duration.

### When a timer finishes

A banner appears in the bottom-right corner tagged DONE, with the timer's label and an × to dismiss it. If you asked for sound or vibration it repeats every second until one of three things happens: you dismiss the banner, you use that timer again (Run again or Reset), or the alarm duration runs out — Preferences → Alarm, 1 to 25 seconds, 25 by default. The banner itself stays until dismissed.

## Stopwatch

One stopwatch for the whole app, always where you left it. Start, then Pause and Resume; **Lap** is offered only while it is running and **Reset** only while it is paused. Laps are listed newest first with the split (time since the previous lap) and the running total, to a tenth of a second. It keeps counting while you are on another page and across reloads.

## Pomodoro

One cycle for the whole app: a run of **focus** rounds, each followed by a **short break**, and a **long break** after the last round. Out of the box that is 25 minutes of focus, 5 off, four times over, then 15 off — and the next cycle starts again at round 1.

The big readout shows the current phase, the time left and a ring that fills as the phase runs. Under it: which round you are on, one dot per round in the cycle (filled once the round is done), and how many focus rounds you have completed today.

- **Start** begins the phase shown. While it runs the button becomes **Pause**; paused, it becomes **Resume**, and the time left is kept exactly.
- **Skip** moves to the next phase without finishing this one. A skipped focus round does not count towards today's total.
- **Reset** goes back to focus round 1 and clears the deadline. Today's count stays.

When a phase ends a banner appears, tagged DONE, saying what finished — "Focus round 2 of 4 done — break time" or "Break over — back to work" — and the next phase is lined up ready for **Start** (the button says which: "Start short break", "Start focus"). Sound, vibration and notification work exactly as they do for timers, including the alarm that keeps ringing until you dismiss the banner or press Start, and the alarm duration from Preferences.

**Settings** on the same page: the three phase lengths in minutes (decimals are fine — 0.5 is thirty seconds; anything under a second is refused), how many focus rounds make a cycle, **Start the next phase automatically** (off by default: the app waits for you between phases; on, a live completion rolls straight into the next phase and the banner just tells you), and the three completion actions. A change applies from the next phase — the one running now keeps the deadline it started with.

## Timezones

Pick a zone to convert **from** and a zone to convert **to**, set the time, and the result shows both sides written out with each zone's UTC offset and the difference between them.

Each picker searches two things at once: IANA zone names (type "edmonton", "america/ed" or "new salem") and city names from a bundled list (type at least two letters — "osaka", "red deer"). Cities show their country, and picking one selects that city's zone. **⇄** between the pickers swaps the two zones, and below them two buttons set either side to your own zone. The pair you end on is remembered for next time; it is listed on the Preferences page.

## Gotchas

### Alarms and notifications

- **Nothing fires while useful is fully closed.** There is no server behind it, so there is no push. Alarms only happen while the app is open in a tab or an installed window.
- **You get MISSED banners on your return.** A timer whose deadline passed while the app was shut is finished on the next visit and shown as MISSED — silently, with no sound, vibration or ringing. Anything more than about five seconds overdue counts as missed, so a laptop that slept with the tab open produces MISSED too, not a live alarm.
- **The alarm keeps ringing until you stop it**, up to the alarm duration in Preferences. Dismissing the banner, or pressing Run again or Reset on that timer, silences it immediately.
- **Sound needs a start in the page you are looking at.** Browsers only allow audio after a click, so a timer that was started before a reload — or in another tab — fires with its banner, vibration and notification, but no beep. Starting or resuming any timer on the Timers page arms the sound again for that page.
- **Vibration is an Android phenomenon in practice.** Some desktop browsers offer the checkbox and then do nothing; iPhones do not vibrate from a web page at all.
- **Only the Timers and Pomodoro pages ever ask for notification permission**, and only when you start something with "Show notification" ticked. Do that once and the Scheduler's due notifications become possible too. If you have blocked notifications for the site a note says so, and sound plus the in-app banner still work.
- **Each tab rings on its own.** With useful open twice, whichever tab notices the deadline first finishes the timer and rings; the other simply sees it as done.

### Timers

- **Editing a running timer does not move its deadline.** A new duration applies the next time you start it.
- **Nothing is written while a timer runs**, which is why reloading, navigating and background tabs cannot make it drift.
- **Deleted timers still appear in backups.** Deleting one — by hand or through "Delete when finished" — removes it from the list and marks it deleted, but a backup file still carries the record.

### Stopwatch

- **There is only one.** No second stopwatch, no naming, no history — Reset clears the laps for good, and it is offered only while paused.
- **Laps cannot be edited or removed individually.**

### Pomodoro

- **There is only one cycle**, shared by every page, like the stopwatch. No named sessions, no history beyond today's count.
- **A phase that ends while the app is closed shows as MISSED** and never starts the next phase by itself, even with auto-advance on — you were not there, so the break waits for Start.
- **Today's count is today on your clock.** It rolls over at local midnight the next time a phase finishes; it is not merged between devices.
- **Only the Timers and Pomodoro pages ever ask for notification permission**, and only when you start with "Show notification" ticked.
- **Changing the round count mid-cycle does not move you.** If you are on round 3 and drop the cycle to 2 rounds, the long break comes at the next multiple — round 4.

### Timezones

- **The city list downloads once**, the first time you search for a city, and shows "Loading city database…" while it does. That needs a network the first time unless you have already fetched "The app itself" from Settings → Offline. It covers cities of about 15,000 people and up, matches on the city name only (not the country), and puts the biggest cities first.
- **DST comes from your browser.** Conversions use the browser's own timezone database, so out-of-date browser, out-of-date rules — there is nothing to update inside useful.
- **Awkward local times resolve without asking.** A time that happens twice on a clocks-go-back night picks one of the two readings, and a time that does not exist on a clocks-go-forward night lands after the jump.
- **The time you type is a wall clock in the from-zone**, not in your own zone.
- **Only the zone pair is remembered.** The date and time reset to now whenever you open the page.
