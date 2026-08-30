# Docker Compose

**Docker Compose** (under Generators, or Ctrl/Cmd+K) builds a `compose.yaml` through controls that explain what each field does, starting from a template if you want one. It runs entirely on your device.

_Describes the code as of v0.4.0 (unreleased; schema v13) — verify against source when in doubt._

## Read this first

**A compose file can contain secrets.** Database passwords, API keys in environment variables, inline config content — they are part of the project, and **saved projects go into this app's backup file** like everything else you save here. That backup is plain JSON in your downloads folder.

If a value should not live there, use `${VARIABLE}` interpolation (the value comes from your shell or a `.env` file next to the compose file, neither of which this app ever sees) or a `secrets:` entry pointing at a file on your machine.

## The four that catch everyone

1. **Host networking publishes nothing.** With `network_mode: host` the container is already on your machine's network, so there is no address to map a port to — a `ports:` list beside it is silently ignored. This page disables the ports editor and says why, rather than letting you write a file that lies.
2. **A bare word in a volume is a named volume, not a folder.** `- src:/app` does **not** mount your `./src` directory: it creates a volume called `src`, mounts that, and your file changes seem to vanish. A bind mount has to start with `./` or `/`.
3. **`depends_on` waits for *started*, not for *ready*.** A database container is "started" long before it will accept a connection. `condition: service_healthy` is the one that waits — and it only works if the other service actually has a healthcheck, which this page treats as an error rather than a suggestion.
4. **ipvlan and macvlan need a real network interface.** Both put containers directly on your LAN through a named parent (`eth0`, `en0`), and **neither works inside Docker Desktop's virtual machine** on Mac or Windows. Most Wi-Fi access points also drop the extra MAC addresses macvlan needs, so it tends to work over Ethernet and fail over wireless with no useful error.

## Building one

**Services** is the main editor. Each service opens to show its image, command, environment, ports, storage and networking; the rest — healthcheck, CPU and memory limits, `depends_on`, `tty`, `privileged` — is behind **Lifecycle, resources and the rest**.

The `compose.yaml` at the bottom, syntax-highlighted, updates as you type, and above it is a list of anything worth flagging: **Error** for a file that is wrong, **Careful** for one that is valid and will surprise you. A service with findings gets a count beside its name.

## Templates

**Start from a template** has nine whole stacks — WordPress, Flask, FastAPI, Node, MERN, Go, Django, Astro, Next.js. **Load** replaces what is open; **Download .zip** gives you a folder with the compose file, a README and (where it makes sense) a hello-world source, ready to run.

Below them are ten **service snippets** — PostgreSQL, Redis, Valkey and the rest — which are *added to* what is open rather than replacing it. If the name is taken it is renamed, if it needs a volume that volume is declared, and if its host port is already published it is moved to the next free one. The message under the buttons says what happened.

**Every image tag is pinned, and every tag moves.** `postgres:17-alpine` picks up updates under the same name, and one day a major bump becomes something nobody tested. Check them before relying on one.

## Importing an existing file

Paste or drop a `compose.yaml` into **Import an existing compose file**. It reads what it can and **lists everything it could not represent** — `build:`, `labels:`, Swarm settings and so on — before anything is replaced, so you can decide whether to keep editing here. Nothing changes until you press the button.

## Saving

**Save** puts the project in the library on this device. **Export .json** takes it somewhere else, and the file loads straight back.

## Gotchas

- **Saved projects ride the backup.** See the top of this page.
- **This builder does not do `build:`.** It writes files that run published images. Importing a file that builds keeps everything else and tells you the `build:` key was dropped.
- **`network_mode` and `networks` cannot both be set.** Compose refuses that file outright; here the mode wins and the page flags it.
- **A tag-less image means `:latest`**, which is a different image tomorrow. Flagged as a warning, not an error.
- **`tmpfs` is Linux-only** and is ignored on Docker Desktop for Mac and Windows.
- **The library is per browser.** It lives in this browser's storage — clearing site data clears it. Export the ones you care about.
