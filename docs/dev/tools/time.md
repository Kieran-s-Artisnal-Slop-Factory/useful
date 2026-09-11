# Time tools

Four tools under the Time category: countdown **timers** (rows in the `timers` store, driven by the [notification engine](../notification-engine.md)), a **stopwatch** (the `stopwatch` singleton), a **Pomodoro** cycle (the `pomodoro` singleton, also driven by the engine), and a **timezone converter** built on the browser's Intl database with a lazily-loaded GeoNames city dataset. Timers, the stopwatch and the pomodoro derive their display from stored absolute instants, so nothing is written per tick and reload cannot drift them; the converter stores nothing but the zone pair.

_Describes the code as of v0.6.0 (schema v17) — verify against source when in doubt._

## Where it lives

| File | Role |
| --- | --- |
| [timers.astro](../../../src/pages/tools/timers.astro), [stopwatch.astro](../../../src/pages/tools/stopwatch.astro), [pomodoro.astro](../../../src/pages/tools/pomodoro.astro), [timezones.astro](../../../src/pages/tools/timezones.astro) | Routes `/tools/timers/`, `/tools/stopwatch/`, `/tools/pomodoro/`, `/tools/timezones/`. |
| [TimersApp.svelte](../../../src/components/apps/TimersApp.svelte) | Timer list, form, start/pause/reset/edit/delete, defaults remembering. |
| [StopwatchApp.svelte](../../../src/components/apps/StopwatchApp.svelte) | The stopwatch and its lap table. |
| [PomodoroApp.svelte](../../../src/components/apps/PomodoroApp.svelte) | The pomodoro readout, ring, round dots, Start/Pause/Resume/Skip/Reset and the settings card. |
| [pomodoro.ts](../../../src/lib/time/pomodoro.ts) | Pure transitions: `nextPhase`, `startPhase`, `pausePatch`, `resumePatch`, `resetPatch`, `durationFor`, `completionLabel`, `completedToday`, `localDate`, `POMODORO_DEFAULTS`. |
| [TimezonesApp.svelte](../../../src/components/apps/TimezonesApp.svelte) | Converter page; remembers the zone pair. |
| [ZonePicker.svelte](../../../src/components/apps/ZonePicker.svelte) | Combobox merging IANA-zone hits and city hits. |
| [engine.svelte.ts](../../../src/lib/time/engine.svelte.ts) | Owns `engineState.timers` / `engineState.pomodoro` / `engineState.now`; completes timers and pomodoro phases. See [notification-engine.md](../notification-engine.md). |
| [duration.ts](../../../src/lib/time/duration.ts) | `hmsToMs`, `msToHms`, `formatCountdown`, `formatElapsed`, `remainingMs`. |
| [timezone.ts](../../../src/lib/time/timezone.ts) | `zoneOffsetMinutes`, `wallTimeToInstant`, `instantInZone`, `offsetLabel`, `allZones`, `isValidZone`, `currentZone`, `zoneDisplayName`. |
| [cities.ts](../../../src/lib/time/cities.ts), [cities.json](../../../src/lib/time/cities.json) | `loadCities`, `citiesLoaded`, `searchCities`; the ~1.4 MB dataset. |
| [build-city-dataset.mjs](../../../tools/build-city-dataset.mjs) | Regenerates `cities.json` from a GeoNames dump. |
| [types.ts](../../../src/lib/db/types.ts) | `Timer`, `Stopwatch`, the timer/tz fields on `Preferences`. |
| [registry.ts](../../../src/lib/registry.ts) | `timers`, `stopwatch`, `timezones` entries (sidebar, home tiles, palette). |

## Timers

### Data model

`Timer` (store `timers`, created by DB migration v3, plain rows — no `fieldMerge`):

| Field | Meaning |
| --- | --- |
| `label` | Required (trimmed, non-empty). |
| `description_md` | Markdown, rendered through `renderMarkdown` (sanitized) inside a `<details>`. |
| `duration_ms` | Full budget; must be `> 0`. |
| `end_at` | UTC ISO deadline. Non-null **only** while `state === 'running'`. |
| `paused_remaining_ms` | Banked budget. Non-null **only** while `state === 'paused'`. |
| `state` | `'idle' \| 'running' \| 'paused' \| 'done'`. |
| `sound`, `vibrate`, `notify` | Completion actions. |
| `delete_on_complete` | One-shot: the engine soft-deletes the row after it fires. |

### State machine

```mermaid
stateDiagram-v2
  [*] --> idle: Save (put, state=idle)
  idle --> running: Start / Save & start
  running --> paused: Pause
  paused --> running: Resume
  running --> idle: Reset
  paused --> idle: Reset
  running --> done: engine complete (end_at <= now)
  done --> running: Run again
  done --> idle: Reset
  done --> [*]: delete_on_complete (softDelete)
```

Who writes what — every transition is one `patch` (or `put` for create), all in `TimersApp` except completion:

| Transition | Function | Write |
| --- | --- | --- |
| create | `doSave` | `put(withSyncFields({...fields, end_at: null, paused_remaining_ms: null, state: 'idle'}))` |
| edit | `doSave` | `patch(id, fields)` — label, description, duration, the four flags. **Never** touches `state`, `end_at` or `paused_remaining_ms`, so editing the duration of a running timer does not move its deadline; the new duration applies on the next run. |
| start / resume / run again | `start` | `patch(id, { state: 'running', end_at: now + budget, paused_remaining_ms: null })` where `budget = paused_remaining_ms` if paused, else `duration_ms`. Also calls `dismissNotice(id)`, `unlockAudio()`, and requests notification permission when `notify` and permission is `default`. |
| pause | `pause` | `patch(id, { state: 'paused', paused_remaining_ms: remainingMs(end_at, now), end_at: null })` |
| reset | `reset` | `patch(id, { state: 'idle', end_at: null, paused_remaining_ms: null })`; also `dismissNotice(id)`. |
| complete | engine `complete` | `patch(id, { state: 'done', end_at: null, paused_remaining_ms: null })`, then `softDelete` if `delete_on_complete`. |
| delete | `del` | `confirm()` then `softDelete('timers', id)`. |

Invariants: `end_at` iff running; `paused_remaining_ms` iff paused; `done` is set only by the engine; nothing is written while a timer runs.

### Display and list

- The engine owns the list. `TimersApp` derives `timers` from `engineState.timers`, sorted `running`, `paused`, `idle`, `done` (`STATE_ORDER`) then `label.localeCompare`.
- `display(t)`: running → `formatCountdown(remainingMs(end_at, engineState.now))`; paused → `formatCountdown(paused_remaining_ms)`; done → `0:00`; idle → the full duration. `formatCountdown` rounds **up** so a running timer never shows `0:00` before it fires; `H:MM:SS` above an hour, `M:SS` below.
- Buttons per state: running → Pause, Reset; paused → Resume, Reset; done → Run again, Reset; idle → Start. Edit and Delete always.

### Form

- `blankDraft()`: 5 minutes, sound on, vibrate/notify/delete-on-complete off. `startCreate` overlays the remembered defaults (`timer_default_*`), masking vibrate/notify by `canVibrate` / `canNotify`.
- Inputs: hours 0–99, minutes 0–59, seconds 0–59 (HTML `min`/`max`); `hmsToMs` clamps negatives to 0. Validation in `doSave`: label required, duration `> 0`. Vibrate and notify checkboxes render only when the platform has `navigator.vibrate` / `Notification`.
- **Save** submits the form; **Save & start** runs `doSave` then `start`.
- `rememberDefaults()` runs after every successful save: if `auto_remember_based_on_last_value` is not `false` and any of the four flags differs from the stored default, one `putSingleton('preferences', { timer_default_sound, timer_default_vibrate, timer_default_notify, timer_default_delete_on_complete })`. Unchanged flags → no preferences write.

## Stopwatch

- One row: `getSingleton('stopwatch')` / `putSingleton('stopwatch', fields)`. Domain fields (`Fields` in the component): `started_at` (UTC ISO, non-null only while running), `elapsed_before_pause_ms`, `laps: number[]` (total elapsed at each press, oldest first), `state: 'idle' | 'running' | 'paused'`.
- `elapsed = elapsed_before_pause_ms + (running ? max(0, now - Date.parse(started_at)) : 0)` — a `$derived` off a 100 ms display interval that writes nothing.
- Every action goes through `write(fields)`, which sets local state and calls `putSingleton` with the whole `Fields` object:
  - Start/Resume: `started_at = now`, `state = 'running'`.
  - Pause: `elapsed_before_pause_ms = elapsed`, `started_at = null`, `state = 'paused'`.
  - Lap: `laps = [...laps, elapsed]`.
  - Reset: `ZERO` (`{ started_at: null, elapsed_before_pause_ms: 0, laps: [], state: 'idle' }`).
- Lap is offered only while running; Reset only while paused. The lap table is newest-first with `split = total - previous total`.
- `formatElapsed` shows tenths, rounding **down** (`H:MM:SS.t` / `M:SS.t`).
- Reload restores from the row; a running stopwatch keeps counting because `started_at` is absolute.

## Pomodoro

One `pomodoro` singleton (store created by DB migration **v17**, plain row — no `fieldMerge`) holds the schedule, the live phase, the completion actions and today's tally. The engine drives it the way it drives a timer: an absolute `end_at`, nothing written per tick, one write per transition. The arithmetic is pure and lives in [pomodoro.ts](../../../src/lib/time/pomodoro.ts); the page and the engine only choose which patch to write.

### Data model

`Pomodoro` in [types.ts](../../../src/lib/db/types.ts):

| Field | Meaning |
| --- | --- |
| `work_ms`, `short_break_ms`, `long_break_ms` | Phase lengths. Defaults 25 / 5 / 15 minutes (`POMODORO_DEFAULTS`); at least `MIN_PHASE_MS` (1 s). |
| `rounds_before_long` | Work rounds per cycle; default 4. The round whose number divides by it (`isLastRound`) is followed by the long break. |
| `phase` | `'work' \| 'short_break' \| 'long_break'`. |
| `round` | 1-based work round within the cycle. Unchanged by work → break; +1 by short break → work; back to 1 by long break → work. |
| `state` | `'idle' \| 'running' \| 'paused' \| 'done'`. `done` = a phase just completed and the *next* one (already set in `phase`) waits for Start. |
| `end_at` | UTC ISO deadline. Non-null **only** while running. |
| `paused_remaining_ms` | Banked budget. Non-null **only** while paused. |
| `auto_advance` | Start the next phase by itself on a live completion (Q4: default off). |
| `sound`, `vibrate`, `notify` | Completion actions, same meaning as a timer's. |
| `completed_today`, `completed_today_date` | Work rounds finished on that local date. `completedToday(row, today)` reads 0 when the date is not today, so a new day resets the count with no scheduler; the date is stamped on every `nextPhase`. |

### State machine

```mermaid
stateDiagram-v2
  [*] --> idle: first Start creates the row (or a settings change)
  idle --> running: Start (startPhase)
  running --> paused: Pause (pausePatch)
  paused --> running: Resume (resumePatch)
  running --> done: engine, end_at <= now, auto_advance off
  running --> running: engine, end_at <= now, auto_advance on (nextPhase + startPhase)
  done --> running: Start (startPhase, next phase)
  idle --> idle: Skip (nextPhase, not counted)
  running --> idle: Skip / Reset
  paused --> idle: Skip / Reset
  done --> idle: Skip / Reset
```

The phase cycle (`nextPhase`), with `N = rounds_before_long`:

```mermaid
stateDiagram-v2
  direction LR
  work --> short_break: round % N != 0 (round kept)
  work --> long_break: round % N == 0 (round kept)
  short_break --> work: round + 1
  long_break --> work: round = 1
```

Who writes what — every transition is one `putSingleton('pomodoro', patch)` (`write` in `PomodoroApp`, `completePomodoro` in the engine). `putSingleton` merges into the existing row, so a patch carries only the fields that move; the very first write of all carries `POMODORO_DEFAULTS` overlaid with the settings draft so the row is complete from the moment it exists.

| Transition | Function | Patch |
| --- | --- | --- |
| start (idle or done) | `start` → `startPhase(row, now)` | `{ state: 'running', end_at: now + durationFor(phase), paused_remaining_ms: null }`. Also `dismissNotice(POMODORO_NOTICE_ID)`, `unlockAudio()`, and the notification-permission request when `notify`. |
| pause | `pause` → `pausePatch(row, now)` | `{ state: 'paused', end_at: null, paused_remaining_ms: remainingMs(end_at, now) }` |
| resume | `resume` → `resumePatch(row, now)` | `{ state: 'running', end_at: now + paused_remaining_ms, paused_remaining_ms: null }` |
| skip | `skip` → `nextPhase(row, today, false)` | next phase, `state: 'idle'`, deadline cleared, tally re-stamped **without** +1. |
| reset | `reset` → `resetPatch()` | `{ phase: 'work', round: 1, state: 'idle', end_at: null, paused_remaining_ms: null }`. No row yet → no write. |
| complete | engine `completePomodoro(missed)` | `nextPhase(row, today)` (+1 when the finished phase was work) then either `startPhase` on the new phase (`auto_advance` and not missed) or `state: 'done'`. One write. |
| settings | `commit` / `commitDuration` / `commitRounds` | `{ [field]: value }` — only when it differs from the stored value. A duration under `MIN_PHASE_MS` or a round count under 1 is refused with `pom-settings-error` and nothing is written. |

Invariants: `end_at` iff running; `paused_remaining_ms` iff paused; `done` is set only by the engine; a settings change never touches `state`/`end_at`, so the phase running now keeps the deadline it started with.

### Display

- `row = engineState.pomodoro ?? POMODORO_DEFAULTS` — the page renders whatever the engine last loaded; with no row it shows the defaults and writes nothing.
- `remaining`: running → `remainingMs(end_at, engineState.now)`; paused → `paused_remaining_ms`; idle/done → `durationFor(row, phase)`. Formatted with `formatCountdown` (rounds up, like a timer).
- The ring is a `conic-gradient` driven by `--pct = 1 - remaining / phase length` (0 while idle). The dots are one per round: `done` for rounds before the current one (or the current one once its break has begun), `current` for the running work round, `todo` otherwise.
- Buttons per state: running → Pause; paused → Resume; idle/done → Start (labelled `Start short break` / `Start long break` / `Start focus` when done). Skip and Reset always.
- `pom-today` shows `completedToday(row, localDate(engineState.now))`.

### Settings card

Four number inputs (minutes, `step="any"` so a 30 s break is `0.5`; displayed to two decimals via `msToMin`) and the round count, each committed on `change`; the three completion checkboxes and auto-advance committed on toggle. Vibrate and notify render only where the platform offers them, as on the timers page. A change applies from the next phase.

## Timezones

### Conversion (Intl only, no tz data shipped)

- `zoneOffsetMinutes(zone, atMs)`: format the instant in `zone` with `Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', ... }).formatToParts`, rebuild it with `Date.UTC`, and the difference to `atMs` is the offset (east positive, rounded to minutes).
- `wallTimeToInstant(wall, zone)`: Intl only formats instants, so guess `asUtc − offset(asUtc)`, then re-measure the offset at the guess and correct once more. Two passes settle DST boundaries. A wall time skipped by spring-forward resolves to the post-transition interpretation; the code does not special-case ambiguous fall-back times — the result is whichever offset the second pass measures.
- `instantInZone` (`dateStyle: 'medium', timeStyle: 'short'`, user locale) and `offsetLabel` (`UTC±HH:MM`) format for display.
- `allZones()` is `Intl.supportedValuesOf('timeZone')`. `isValidZone(zone)` tries to construct a `DateTimeFormat` — deliberately **not** list membership, because the city dataset and remembered preferences can carry aliases like `Europe/Kyiv` that Intl accepts but the canonical list spells differently. `currentZone()` reads `resolvedOptions().timeZone`. `zoneDisplayName('America/North_Dakota/New_Salem')` → `New Salem, North Dakota (America)`.

### The page

- `when` is a `datetime-local` value, defaulting to the current local wall clock, and is interpreted as a wall time **in the from-zone** (`parseWhen` → `WallTime`).
- `result` is `$derived.by`: `instant = wallTimeToInstant(wall, from)`; both sides formatted with `instantInZone` and `offsetLabel`; `diffLabel` is the offset difference (`same offset` or `±H:MM vs <from offset>`).
- `remember()` writes `putSingleton('preferences', { tz_last_from, tz_last_to })`. It runs only from explicit picks: `ZonePicker`'s `onpick`, `swap()`, and the two "= my zone" buttons — never as a render effect. `onMount` restores the pair, accepting each value only if `isValidZone`.

### ZonePicker search

```mermaid
sequenceDiagram
  participant U as User
  participant P as ZonePicker
  participant Z as zones (allZones)
  participant C as cities.ts
  participant K as cities.json chunk
  U->>P: types query
  P->>Z: fuzzyScore over zone name and zoneDisplayName (sync)
  Z-->>P: top 6 zone hits
  alt query >= 2 chars
    P->>C: searchCities(q, 6)
    opt first call
      C->>K: import("./cities.json")
      Note over P: shows "Loading city database…"
      K-->>C: CityRow[]
    end
    C-->>P: hits sorted by score, then population
  end
  P->>P: options = zone hits + city hits, capped at 12
  U->>P: Enter / click
  P->>P: value = zone, onpick(zone)
```

- `MAX_ZONES = 6` zone hits (`fuzzyScore` from [fuzzy.ts](../../../src/lib/fuzzy.ts) against both the raw IANA name and the display name, so `edmonton`, `new salem` and `america/ed` all hit), up to `MAX - MAX_ZONES = 6` city hits, `MAX = 12` options total.
- The city `$effect` guards against stale results (`stale` flag in its cleanup) and only sets `loadingCities` when `!citiesLoaded()`.
- Combobox a11y: `role="combobox"`, `aria-activedescendant`, `role="listbox"` / `role="option"`; ArrowUp/Down wrap, Enter picks, Escape closes; options pick on `mousedown` with `preventDefault` so blur does not close the list first. IME composition (`isComposing` / keyCode 229) is ignored.

### City dataset

- `CityRow = [name, countryCode, ianaZone, population]`, population-descending. `searchCities` fuzzy-scores `name`, sorts by score then population (so `tokyo` → Tokyo before Shinjuku), and returns `{ name, country, zone }`. Queries under 2 characters return `[]`.
- `loadCities()` is a memoised `import('./cities.json')` — Vite emits it as its own chunk, so no page pays for it until the first city search. `citiesLoaded()` flips once the import resolves.
- Source: GeoNames `cities15000` (population ≥ 15 000, ~34k rows), **CC BY 4.0**, attribution in the `cities.ts` header. Regenerate with `node tools/build-city-dataset.mjs path/to/cities15000.txt` — it reads TSV columns 1 (name), 8 (country), 14 (population), 17 (timezone), drops rows missing any of name/zone/country, sorts by population, and writes `src/lib/time/cities.json`.
- Offline: the chunk is a fingerprinted `_astro/` asset, so [sw.js](../../../public/sw.js) serves it stale-while-revalidate and caches it on first fetch; the service worker's background crawl also follows dynamic-import specifiers in the built JS, so it is normally precached before anyone searches.
- Zone validity is enforced by test, not at runtime: [cities.test.ts](../../../src/lib/time/cities.test.ts) asserts every zone in the dataset passes `isValidZone`.

## Preferences touched

| Field | Written by | When |
| --- | --- | --- |
| `timer_default_sound`, `timer_default_vibrate`, `timer_default_notify`, `timer_default_delete_on_complete` | `TimersApp.rememberDefaults`; `PreferencesApp` | after a save when auto-remember is on and a flag changed; toggled directly on the Preferences page |
| `timer_alarm_seconds` | `PreferencesApp.saveAlarmSeconds` (1–25) | read by the engine on each completion |
| `auto_remember_based_on_last_value` | `PreferencesApp` | read by `rememberDefaults` (default `true`) |
| `tz_last_from`, `tz_last_to` | `TimezonesApp.remember` | on pick / swap / "= my zone"; shown read-only under "Remembered values" on the Preferences page |

Loading any of the four pages writes nothing. The stopwatch and the pomodoro write only their own singleton (the pomodoro reads `timer_alarm_seconds` through the engine but never writes `preferences`); the timezone page writes only `preferences`.

## Tests

- Unit (`npm run test:unit`, vitest): [duration.test.ts](../../../src/lib/time/duration.test.ts) (round-trip, clamping, round-up countdown, round-down elapsed, `remainingMs` clamp), [pomodoro.test.ts](../../../src/lib/time/pomodoro.test.ts) (`nextPhase` for every edge incl. the long-break boundary, the skip-does-not-count rule and the day rollover; `startPhase` / `pausePatch` / `resumePatch` maths and their round trip; `resetPatch`; `completionLabel`; `localDate`), [timezone.test.ts](../../../src/lib/time/timezone.test.ts) (UTC/DST/half-hour offsets, winter/summer wall→instant, round-trip across zones incl. `Pacific/Chatham`, deterministic DST-skipped time, zone catalog, display names), [cities.test.ts](../../../src/lib/time/cities.test.ts) (osaka/red deer/munich resolve, every zone Intl-valid, metropolis ranks first, short queries ignored).
- Browser (`npm run test:data`, production build, oracle-audited): [time.spec.ts](../../../tests/local/time.spec.ts) — create writes the row plus only the defaults singleton; running timer survives reload with no writes; pause banks / resume restores; expiry, MISSED, Save & start, delete-on-complete, remembered defaults, alarm loop and preference cap, auto-remember off; stopwatch writes only its singleton and survives reload; timezone page load writes nothing, Edmonton→Tokyo conversion and remembered pair, Osaka via the dataset, swap. [pomodoro.spec.ts](../../../tests/local/pomodoro.spec.ts) — fresh page shows defaults and writes nothing; Start writes one running row, Pause moves only `state` / `end_at` / `paused_remaining_ms`, Resume restores the deadline, reload changes nothing; Skip walks a two-round cycle through the long break and back without counting, Reset writes only the singleton; a `rawPut` running row 1.5 s from its deadline raises the DONE banner, counts, parks the break in `done` and Start begins it; the same with `auto_advance` starts the break itself; a row 60 s overdue on round 4 surfaces as MISSED, crosses into the long break and does not auto-start; settings write only the singleton, refuse sub-second phases, and come back on reload. The data spec's "every column survives a backup round trip" group picks the store up from `TABLES`.

## Known limits and decisions

- No per-tick writes anywhere: timers and the pomodoro store `end_at`, the stopwatch stores `started_at`; display is derived from the wall clock. This is what makes reload, navigation and background-tab throttling drift-free.
- The pomodoro is one cycle for the whole app (singleton), like the stopwatch. There is no history beyond today's count, and the count is per browser profile — it rides backups with the row but is not merged across devices.
- A missed pomodoro completion never auto-advances, even with `auto_advance` on: the phase ended while the app was closed, and starting a break now would be a deadline nobody asked for. The row parks in `done` and Start begins the next phase.
- Changing the round count mid-cycle does not clamp `round`; `isLastRound` is modular, so a round past the new count still reaches the long break on the next multiple.
- Editing a running timer does not reschedule it (see the transition table) — the deadline was set by the user's start gesture and stays.
- Timers are never hard-deleted by the UI (`softDelete` tombstones), so a delete-on-complete timer still round-trips backups as a tombstone.
- The stopwatch has no lap-editing and a single global instance by design (singleton row).
- Timezone conversion is only as good as the browser's tz database; there is no shipped tzdata to update independently.
- The city dataset is name-only fuzzy matching (no country/alias search) and ranks by population; ~1.4 MB is the cost of arbitrary-city lookup offline.
