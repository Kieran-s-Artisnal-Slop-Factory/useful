# Installing and working offline

useful is a website that behaves like an app: your browser can install it to the desktop, dock or home screen, and after the first visit it loads and runs with no network. Pages you have never opened are fetched quietly in the background as you use it, and the heavy optional extras — the background remover's model and the SQL playground's database engines — arrive only when you ask for them.

_Describes the code as of v0.2.1 (unreleased; schema v12) — verify against source when in doubt._

## Installing it

There is no install button inside useful; use your browser's own. On desktop Chrome or Edge that is the install icon in the address bar, or "Install app" in the menu; on Android, "Install app" / "Add to Home screen"; in Safari on iPhone and iPad, Share → Add to Home Screen. Installed, it opens in its own window without a tab strip or address bar, and your data comes with it — it is the same browser storage either way.

Installing is optional. Everything below works in an ordinary tab too, except the one-time offer, which is tied to installing.

## The one-time offer

Installing prompts the question once: **Make it work offline?** — when the browser reports the install, and otherwise the first time useful runs in its installed window (which is how it catches "Add to Home Screen"). The panel lists what can be downloaded, with each item ticked and priced. Untick what you do not want; the button names the total for what is still ticked. "Not now" dismisses it, and it never asks again — the same panel lives at **Settings → Offline** and can be run as many times as you like.

## What downloads

| Item | Size shown | What it is |
| --- | --- | --- |
| The app itself | — | Every page and code chunk, including tools you have not opened |
| Background remover model | 15.8 MB | The cut-out model plus the runtime it needs |
| Maths fonts | 0.3 MB | The twenty faces napkin math and the notebook draw maths with |
| SQLite engine | 1.2 MB | The SQL playground's SQLite database |
| Postgres engine | 12 MB | The SQL playground's Postgres database |

About 29 MB with everything ticked. "The app itself" is code only: the two SQL engines arrive with their own items and never ride along in the background, so leaving "Postgres engine" unticked really does mean 12 MB fewer. Items run one at a time, in that order, each showing Waiting, Downloading, Done or Failed. A failure names itself and the rest still run. Only when every ticked item finishes does the panel record "Last downloaded" with the date and time. The background remover is the only item that can tell you it is "already downloaded" — the others are stored under names that change with each release, so the honest answer is to run it again, which is harmless.

## What works without a network

- Any page you have already opened — always.
- Any other page, once the background caching has reached it. That happens gradually while you use the app; "The app itself" is the deliberate, immediate version of the same job.
- The background remover, once its model is downloaded — either here or from the button on the tool's own page.
- The SQL playground, once the engine you pick has been downloaded. The two engines are separate downloads, and the background caching never fetches them on its own.
- Maths in napkin math and the notebook, once the maths fonts are here — from the "Maths fonts" item, or automatically the first time a page draws a formula.
- City search in the Timezones tool, once its city list has been fetched (part of "the app itself", or automatically the first time you search for a city).

## Gotchas

- **Updates apply on the next load.** When you are online a new version installs itself in the background, but the page you have open keeps running the version it started with. Reload, or close and reopen the app, to get the new one. There is no "an update is available" prompt.
- **A page you have never opened, offline, may show the home screen instead.** That is the fallback when the background caching has not reached that page yet.
- **Browsers can throw all of it away.** Downloaded files and your data are evictable, and clearing site data removes both. Settings → Storage → Request persistent storage asks the browser to protect them; it can refuse.
- **Private and incognito windows keep nothing.** Caching may be unavailable entirely, "already downloaded" never becomes true, and the background remover fetches its model again every session — it still works, but only while you are online.
- **The model download is one-time per browser; the SQL engines are not quite.** The background remover's model survives app updates. The database engines are stored alongside the app's own files, so a new version of useful fetches them again the next time you use them.
- **The sizes are labels, not measurements.** They are fixed estimates. Postgres in particular downloads noticeably more than the 12 MB shown.
- **"The app itself" can finish instantly and do nothing** on a very first load, before the offline machinery has taken control of the page. If it looked too quick, reload and run it again from Settings → Offline.
- **A download is per browser.** Installing on a second device, or using a second browser, starts from nothing again.
- **Nothing is uploaded.** The download only pulls files into this browser; your timers, TODOs and images never leave it.
