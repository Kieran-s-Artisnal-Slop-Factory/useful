# Timers, stopwatch and timezones

Three tools under **Time**: countdown **Timers** that ring, buzz and notify when they finish; a **Stopwatch** with laps; and a **Timezones** converter with city search. Timers and the stopwatch remember the moment they were started or due rather than counting ticks, so reloading the page, switching to another tool or leaving the tab in the background never makes them drift.

_Describes the code as of v0.3.0 (schema v13) — verify against source when in doubt._

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
- **Only the Timers page ever asks for notification permission**, and only when you start a timer with "Show notification" ticked. Do that once and the Scheduler's due notifications become possible too. If you have blocked notifications for the site a note says so, and sound plus the in-app banner still work.
- **Each tab rings on its own.** With useful open twice, whichever tab notices the deadline first finishes the timer and rings; the other simply sees it as done.

### Timers

- **Editing a running timer does not move its deadline.** A new duration applies the next time you start it.
- **Nothing is written while a timer runs**, which is why reloading, navigating and background tabs cannot make it drift.
- **Deleted timers still appear in backups.** Deleting one — by hand or through "Delete when finished" — removes it from the list and marks it deleted, but a backup file still carries the record.

### Stopwatch

- **There is only one.** No second stopwatch, no naming, no history — Reset clears the laps for good, and it is offered only while paused.
- **Laps cannot be edited or removed individually.**

### Timezones

- **The city list downloads once**, the first time you search for a city, and shows "Loading city database…" while it does. That needs a network the first time unless you have already fetched "The app itself" from Settings → Offline. It covers cities of about 15,000 people and up, matches on the city name only (not the country), and puts the biggest cities first.
- **DST comes from your browser.** Conversions use the browser's own timezone database, so out-of-date browser, out-of-date rules — there is nothing to update inside useful.
- **Awkward local times resolve without asking.** A time that happens twice on a clocks-go-back night picks one of the two readings, and a time that does not exist on a clocks-go-forward night lands after the jump.
- **The time you type is a wall clock in the from-zone**, not in your own zone.
- **Only the zone pair is remembered.** The date and time reset to now whenever you open the page.
