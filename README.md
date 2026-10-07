# Ollama Cloud Usage Tracker

Track your Ollama Cloud quota (session 5h / weekly 7d) on Linux. This
monorepo ships two surfaces built on **one shared implementation**:

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

```
┌─────────────────────────────────────────────────────────┐
│ cli/                        (source of truth)           │
│   usage.js        fetch + parse pipeline                │
│   cookies.js      cookie extraction (libsecret/sqlite)  │
│   crypto.js       Chromium AES decrypt (openssl)        │
│   pbkdf2.js       pure-JS PBKDF2                        │
│   ollama-usage.js CLI entry (args + rendering)          │
└────────────────────────┬────────────────────────────────┘
                         │ import (gnome/cli -> ../cli)
┌────────────────────────▼────────────────────────────────┐
│ gnome/   GNOME Shell extension                          │
│   scraper.js      thin lifecycle wrapper -> cli/usage.js│
│   extension.js    panel indicator + popup menu          │
│   bar.js, prefs.js, schemas/                            │
└─────────────────────────────────────────────────────────┘
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
- The repo wires the import through a checked-in symlink
  `gnome/cli → ../cli`; `make zip` replaces it with a real copy inside
  the bundle. In other words: source is shared, build artefacts are
  legitimately duplicated.
- Before committing a change to `cli/usage.js` (or its cookie/crypto
  siblings), re-verify both consumers: `make test` in the repo root,
  then a manual `./cli/ollama-usage.js` run.

## Testing

```sh
make test    # gjs test suite in gnome/tests/, including tests that
             # exercise the shared cli/ modules through the symlink
```

## Version history

This project used to be a single GNOME Shell extension. The repo is now
a monorepo; `gnome/` holds that extension. Older versions (if any) get
their own folder next to `gnome/`/`cli/`.

## License

MIT — see [gnome/LICENSE](gnome/LICENSE). Parser strategy and
pace-colour heuristic derived from
[pi-ollama-cloud-usage-tracker](https://github.com/Entelligentsia/pi-ollama-cloud-usage-tracker)
by Entelligentsia (also MIT).