# Crontab

**Crontab** (under Generators, or Ctrl/Cmd+K) reads a cron expression back to you in English, shows when it will next run, and tells you where the line goes and what will bite you. Nothing is uploaded or saved.

_Describes the code as of v0.3.0 (schema v13) — verify against source when in doubt._

## The two things that catch everyone

**1. Setting both day fields means OR, not AND.**

`0 0 13 * 5` looks like "Friday the 13th". It is not. When both the day-of-month and the day-of-week field are set to something other than `*`, cron runs the job when **either** matches — so that line runs on *every 13th* **and** on *every Friday*. Four or five times a month, not once a year. This page prints that warning in red whenever your expression has that shape.

**2. Cron's environment is almost empty.**

A command that works when you type it often fails under cron, because:

- **`PATH` is nearly empty** — usually just `/usr/bin:/bin`. No `/usr/local/bin`, none of your shell's additions. Use absolute paths, or set `PATH=` at the top of the crontab.
- **`%` means a newline.** An unescaped `%` ends the command and everything after it becomes the command's input. `date +%Y` quietly produces nothing — write `\%`.
- **It is not your login shell.** No `.bashrc`, no `.profile`, and `/bin/sh` unless you say otherwise, so bashisms fail.
- **Output goes to mail.** Whatever the job prints is mailed to the crontab's owner, and on a machine with no mail set up it simply vanishes. Redirect it: `>> /var/log/myjob.log 2>&1`.

## Reading an expression

Type or paste a line — the five fields, a `@macro`, or a whole crontab line with its command. You get:

- **What it means**, in a sentence.
- **The next five runs**, in your browser's timezone, each with how far away it is.
- **A red caret** under the exact character it could not read, when something is wrong.

## Building one

Open **Build it** for a control per field: *Every*, *Every N*, *Range* or *Specific*. They write the expression, and typing an expression writes them back. A field written in a shape the controls cannot draw is left exactly as you typed it.

## As a systemd timer

Open **As a systemd timer** for the same schedule as an `OnCalendar=` line and a complete `.timer` unit. The reason to bother is `Persistent=true`: a timer catches up a run the machine slept through, and cron simply misses it.

## Where the line goes

| Place | User column? |
| --- | --- |
| `crontab -e` | **No** |
| `/etc/crontab` | **Yes** |
| `/etc/cron.d/yourfile` | **Yes** |
| `/etc/cron.hourly` and friends | Not a cron line at all — an executable script with no extension |

## Gotchas

- **The user column is the classic mistake.** Paste a line from your own crontab into `/etc/cron.d` and cron reads the first word of your command as a username, then gives up — usually silently.
- **`run-parts` ignores files with extensions.** A script called `backup.sh` in `/etc/cron.daily` never runs. Call it `backup`, and make it executable.
- **The times shown are your browser's.** Cron reads the *machine's* clock, so a server in another timezone runs the same line at a different moment.
- **Daylight saving bites once a year.** A daily job at a time that does not exist on the morning the clocks go forward is skipped; one at a time that happens twice on the morning they go back runs once on most crons. That is why 02:30 daily is a bad habit and 04:00 is not.
- **Some expressions never run.** `0 0 30 2 *` waits for 30 February. The page says so rather than showing an empty list.
- **Six-field expressions are a different dialect.** Quartz and Spring put seconds first. This page reads the five-field syntax `crond` uses and refuses the other rather than reading every field one place out.
- **`@reboot` does not run when you edit the crontab** — only when cron itself starts at boot.
- **Nothing is saved.** Reloading starts with the example again.
