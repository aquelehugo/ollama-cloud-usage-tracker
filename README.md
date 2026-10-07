# Ollama Cloud Usage Tracker

[![CI](https://github.com/aquelehugo/ollama-cloud-usage-tracker/actions/workflows/ci.yml/badge.svg)](https://github.com/aquelehugo/ollama-cloud-usage-tracker/actions/workflows/ci.yml)

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
- **`plasma/`** — a standalone Plasma 5.27 **panel widget** with the
  GNOME-format `34% / 45%` label, an icon toggle and a click popup
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

> Prebuilt packages (GNOME extension zip + Plasma plasmoid) are attached
> to [v0.1.0](https://github.com/aquelehugo/ollama-cloud-usage-tracker/releases/tag/v0.1.0)
> and every future release; `sha256sums.txt` comes with each one. The
> CLI itself ships via the checkout (it needs the repo's `cli/` folder).

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
make install-plasma   # checks deps, installs CLI wrapper + package + baked cli/ core
make panel-add        # idempotent, places it on the first panel
```

A **standalone panel widget**: ollama icon + `34% / 45%` on the panel,
click opens the popup (quota bars, countdowns, refresh, settings
link). It degrades to a compact badge inside the system tray — that
tray structurally cannot show wide text. Missing dependencies abort
the install with per-item hints (gjs, libsecret, python3, openssl),
and the CLI core is installed alongside the package, so discovery
works on a clean PATH. Re-run `make install-plasma` after QML edits.
See [plasma/README.md](plasma/README.md) for details.

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

## Releases

CI builds and attaches all packages automatically whenever a `v*` tag
is pushed (after the test suite passes). To cut a release: bump the
three version spots (`cli/ollama-usage.js` VERSION, `gnome/metadata.json`,
`plasma/metadata.json`), commit, then `git tag vX.Y.Z && git push
origin vX.Y.Z`. The tag's release gets the GNOME zip, the Plasma
plasmoid and `sha256sums.txt`, plus generated notes.

## Version history

This project used to be a single GNOME Shell extension, grew a CLI, and
now ships a Plasma widget too. `gnome/`, `cli/` and `plasma/` live
side by side; older versions (if any) get their own folder.

## License

MIT — see the repository root [LICENSE](LICENSE). Parser strategy and
pace-colour heuristic derived from
[pi-ollama-cloud-usage-tracker](https://github.com/Entelligentsia/pi-ollama-cloud-usage-tracker)
by Entelligentsia (also MIT).