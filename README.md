# Ollama Cloud Usage Tracker

Track your Ollama Cloud quota (session 5h / weekly 7d) on Linux. This
monorepo ships three surfaces built on **one shared implementation**:

- **`cli/`** — standalone terminal tool, usable on demand and
  scriptable (`--json`). **This is the source of truth** for all usage
  logic: browser cookie extraction (Chrome / Chromium / Brave / Edge /
  Zen / Firefox), Chromium Safe Storage decryption (libsecret + PBKDF2
  + AES), the HTTP fetch of `ollama.com/settings`, and the HTML usage
  parser.
- **`gnome/`** — a GNOME Shell 45–47 extension that puts live quota
  bars in the top panel with a detailed popup, pace colouring and
  preferences. It **depends on the CLI's modules** and must not carry
  its own copy of the logic.
- **`plasma/`** — a Plasma 5.27 system-tray widget with the same
  status-bar format (`34% / 45%`), an icon toggle and a click popup
  mirroring the GNOME menu. Plasma applets run in their own process,
  so it **depends on the CLI executable**: it runs
  `ollama-usage.js --json` and renders the JSON contract.

```
┌─────────────────────────────────────────────────────────┐
│ cli/                        (source of truth)           │
│   usage.js        fetch + parse pipeline                │
│   cookies.js      cookie extraction (libsecret/sqlite)  │
│   crypto.js       Chromium AES decrypt (openssl)        │
│   pbkdf2.js       pure-JS PBKDF2                        │
│   ollama-usage.js CLI entry (args + rendering, --json)  │
└───────────────┬─────────────────────────┬───────────────┘
                │ import (gnome/cli → ../cli)             │ exec `--json` (JSON contract)
┌───────────────▼──────────────────────┐  ┌───────────────▼──────────────┐
│ gnome/   GNOME Shell extension       │  │ plasma/   Plasma 5.27 widget │
│   scraper.js  thin wrapper → usage.js│  │   main.qml runs the CLI via  │
│   extension.js  panel + popup        │  │   the executable dataengine; │
│   bar.js, prefs.js, schemas/         │  │   tray item + click popup    │
└──────────────────────────────────────┘  └──────────────────────────────┘
```

## Install

Requirements: GNOME 45+ (for the extension), `gjs`, `libsoup 3`,
`libsecret`, `python3`, `openssl` — everything pre-installed on a
current GNOME desktop except sometimes gjs (`gjs` package).

### CLI

Nothing to install: run it from a checkout.

```sh
./cli/ollama-usage.js                       # quota bars
./cli/ollama-usage.js --json | jq .         # scriptable
```

See [cli/README.md](cli/README.md) for all flags.
### GNOME extension

From the repo root:

```sh
make install      # symlink ~/.local/share/gnome-shell/extensions/<uuid> -> gnome/
make enable       # enable it, then restart the shell
```

Restart GNOME Shell: Wayland = log out/in; X11 = `Alt+F2` → `r`.
Because the install is a symlink, `git pull` + shell reload is all you
need to update — the extension imports the shared modules through the
`gnome/cli → ../cli` symlink, so the CLI and panel always use the same
code.

To build a self-contained zip (bakes the `cli/` modules into the
package):

```sh
make zip          # -> dist/<uuid>.zip
```

### Plasma widget

```sh
make bin                                            # put CLI on ~/.local/bin (widget discovery)
make install-plasma                                 # kpackagetool5 copy-install + hicolor icon
systemctl --user restart plasma-plasmashell.service  # register + load
```

The status bar shows `34% / 45%` with an optional ollama icon; a click
opens the popup (quota bars, countdowns, refresh, settings link). If
the tray does not pick it up automatically, add it via *Configure
System Tray → Items*. The widget runs the CLI with `--json`; discovery
order is the CLI-path setting → `$PATH` (~/.local/bin via `make bin`).
Note: re-run `make install-plasma` after QML edits — Plasma's
KPackage discovery cannot see symlinked plasmoid dirs (unlike GNOME
Shell), so the dev install is a refreshed copy. See
[plasma/README.md](plasma/README.md) for details.

## Usage

**CLI** — full details in [cli/README.md](cli/README.md):

```sh
./cli/ollama-usage.js --browser firefox # force a cookie source
./cli/ollama-usage.js --cookies         # also show cookie source + names
./cli/ollama-usage.js --help
```

**GNOME extension** — the indicator sits in the top panel:

```
  ~  34% / 45%
```

Click it for exact percentages, pace-coloured quota bars, reset
countdowns and a manual refresh. Preferences (interval, browser, weekly
bar toggle) live in *Extensions → Ollama Cloud Usage Tracker*.
Full details in [gnome/README.md](gnome/README.md).

**JSON contract** (CLI `--json`, shared by both surfaces):

```json
{"fetched_at":"2026-07-17T00:00:00.000Z","browser":"Zen/…","session_pct":2.9,
 "weekly_pct":2.4,"session_resets_at":"2026-07-17T03:00:00Z",
 "weekly_resets_at":"2026-07-12T00:00:00Z","cookie_names":["aid"]}
```

## Rule: the CLI is the source of truth

- Every fetch/parse/cookie change goes into `cli/*.js` — never fork it.
- `gnome/scraper.js` is a thin adapter (signals, timers, GSettings) and
  delegates fetching to `cli/usage.js`.
- `plasma/main.qml` never reimplements the pipeline; it invokes the CLI
  with `--json` and renders the JSON contract
  (`{fetched_at, browser, session_pct?, weekly_pct?,
  session_resets_at?, weekly_resets_at?, cookie_names}` or
  `{error, hint}`). Changing that shape is a breaking change for BOTH
  consumers.
- The repo wires the gnome import through a checked-in symlink
  `gnome/cli → ../cli`; `make zip` replaces it with a real copy inside
  the bundle. In other words: source is shared, build artefacts are
  legitimately duplicated.
- Before committing a change to `cli/usage.js` (or its cookie/crypto
  siblings), re-verify all consumers: `make test` + `make test-plasma`,
  then a manual `./cli/ollama-usage.js` run, plus a panel/popup visual
  check on each live surface.

## Testing

```sh
make test          # gjs test suite in gnome/tests/, including tests
                   # that exercise the shared cli/ modules via the symlink
make test-plasma   # node parity tests for the Plasma widget helpers
```

## Version history

This project used to be a single GNOME Shell extension, grew a CLI, and
now ships a Plasma widget too. `gnome/`, `cli/` and `plasma/` live
side by side; older versions (if any) get their own folder.

## License

MIT — see [gnome/LICENSE](gnome/LICENSE). Parser strategy and
pace-colour heuristic derived from
[pi-ollama-cloud-usage-tracker](https://github.com/Entelligentsia/pi-ollama-cloud-usage-tracker)
by Entelligentsia (also MIT).