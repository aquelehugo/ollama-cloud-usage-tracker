# Ollama Cloud Usage Tracker (GNOME Shell extension)

Live Ollama Cloud usage in the top panel, with detailed quota breakdown
in a popup menu.

> This folder is part of a monorepo. All fetching logic (cookies,
> decryption, HTTP, HTML parsing) lives in [`../cli/`](../cli/README.md)
> — the single source of truth shared with the CLI — and is imported
> here through the checked-in `cli → ../cli` symlink. This README covers
> the extension itself; see the top-level README for the overall layout.

Inspired by
[pi-ollama-cloud-usage-tracker](https://github.com/Entelligentsia/pi-ollama-cloud-usage-tracker)
by Entelligentsia.

```
  ~  34% / 45%                       ⌨  12:34  ⏏  ▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮
```

Click the icon to open a popup with two quota bars (session / weekly),
exact percentages, reset countdowns, and a "Refresh now" action.

## Features

- **Top-panel indicator**: ollama icon + compact `session% / weekly%`
  label, or `session%` if you've hidden the weekly bar in prefs.
- **Popup menu**: side-by-side session (5h) and weekly (7d) quota bars
  with exact float percentages, reset countdowns, last-update time, and
  the cookie source (e.g. `Chrome/Default`).
- **Pace colour**: each bar is coloured by how its current usage compares
  to the elapsed time in the window — green when under budget, yellow
  when slightly over, red when burning fast.
- **Multi-browser cookie source**: reads `ollama.com` session cookies
  from Chrome / Chromium / Brave / Edge / Zen / Firefox, with libsecret
  used to unlock Chromium's Safe Storage password.

## Install

Requires a checkout of this monorepo (the extension imports shared
modules from `../cli` — see *How it works* below), GNOME Shell 45–47,
and a browser with an ollama.com session.

### Recommended: `make install` (symlinked dev install)

From the repo root:

```bash
make install    # symlink ~/.local/share/gnome-shell/extensions/<uuid> -> gnome/
make enable     # gnome-extensions enable <uuid>
```

Then restart GNOME Shell — Wayland: log out/in; X11: `Alt+F2` → `r` —
and toggle **Ollama Cloud Usage Tracker** on in *Extensions* if it is
not auto-enabled. Because the install is a symlink, updates are just
`git pull` + a shell reload; no re-copying. The runtime resolves
`./cli/usage.js` through `gnome/cli → ../cli` inside the checkout, so
the panel always runs the same core as the CLI.

### Packaged zip

```bash
make zip        # -> dist/<uuid>.zip, cli/ modules baked in
```

The zip is self-contained: `make zip` copies the shared `cli/` modules
into the bundle at `<extdir>/cli/`, which is exactly the path the
imports use.

## Requirements

- **GNOME Shell** 45, 46, or 47
- **libsoup 3**, **libadwaita**, **libsecret** (all pre-installed on any
  current GNOME desktop)
- **`openssl`** (for AES-CBC decryption — pre-installed on every
  mainstream distro)
- **Python 3** (pre-installed on every mainstream distro) — used only
  to read the SQLite cookie database while the browser holds the
  write lock
- **A Chromium / Firefox / Zen browser** with an active `ollama.com`
  session

## How it works

All fetching logic is shared with the CLI and lives in `../cli/` (the
single source of truth — see the top-level README). This folder only
adds GNOME Shell plumbing.

```
┌─────────────────────────────┐
│ gnome/scraper.js   (thin)   │  GObject 'updated'/'error' signals,
│  ── imports ─▶ ./cli/usage.js   refresh timer, GSettings hooks
└──────────────┬─────────────┘
               │ imports via checked-in symlink: cli → ../cli
┌──────────────▼──────────────────────────────────────────┐
│ ../cli/   (source of truth)                             │
│                                                         │
│  usage.js ───▶ cookies.js ───▶ crypto.js ───▶ pbkdf2.js │
│   Soup 3 GET    browser         Safe Storage    AES key │
│   /settings     discovery        + AES decrypt  derive  │
└──────────────┬──────────────────────────────────────────┘
               │
               ▼
        ollama.com/settings HTML
               │   aria-label="(Session|Weekly) usage N%"
               ▼
  ┌─────────────────────────────┐
  │ extension.js + bar.js       │ panel `session% / weekly%`,
  │ Cairo St.DrawingArea bars   │ popup rows, pace colour, menu
  └─────────────────────────────┘
```

1. **scraper.js** (thin adapter) calls **cli/usage.js** with the
   preferred browser from GSettings.
2. **cli/cookies.js** finds the browser's `Cookies` SQLite DB, copies
   it to `/tmp` (the browser holds a write lock), and feeds the
   encrypted blobs to **cli/crypto.js**.
3. **cli/crypto.js** looks up the Safe Storage password in libsecret,
   derives the AES key with **cli/pbkdf2.js** (`saltysalt` / `saltsalt`,
   1 iteration, SHA1 / SHA256), and shells out to `openssl enc` for the
   AES-CBC step.
4. **cli/usage.js** GETs `https://ollama.com/settings` and parses
   `aria-label="(Session|Weekly) usage N%"` + `data-time="..."` from
   the rendered dashboard.
5. **scraper.js** turns the result into GObject signals; **extension.js**
   renders it — **bar.js** draws the percentage into a Cairo-painted
   `St.DrawingArea` with a pace-derived colour.

Import hygiene: GNOME code refers to shared modules as `./cli/…`,
resolved through the checked-in `cli → ../cli` symlink. In the repo and
in symlinked dev installs it resolves on disk; in zip bundles
(`make zip`) a real `cli/` copy sits at the same relative path.

## Preferences

Open *Extensions* → **Ollama Cloud Usage Tracker** → **Preferences**:

- **Refresh interval** (1–60 min, default 5)
- **Preferred browser** (Auto / Chrome / Zen / Firefox)
- **Show weekly (7d) bar** in top panel

## Files

```
extension.js              Entry point — top-panel indicator + menu
prefs.js                  Adwaita preferences window
metadata.json             Extension metadata (UUID, shell versions)
schemas/                  GSettings schema (compiled)
bar.js                    Painted quota bar widget
scraper.js                Thin lifecycle wrapper around cli/usage.js
cli -> ../cli             Symlink to the shared usage core (source of truth)
tests/                    gjs test suite (imports shared modules via cli/)
```

The fetching logic itself lives in `../cli/` — `usage.js` (fetch +
parse), `cookies.js`, `crypto.js`, `pbkdf2.js`. See
[../cli/README.md](../cli/README.md). Don't add fetch code here.

## Testing

```bash
make test    # from the repo root
# or directly:
bash tests/run-all.sh
```

The suite imports cookies/crypto/pbkdf2/usage from `../cli/` through
the symlink, so it exercises the same code the runtime loads.

## License

MIT — see [LICENSE](LICENSE). Parser strategy and pace-colour
heuristic derived from
[pi-ollama-cloud-usage-tracker](https://github.com/Entelligentsia/pi-ollama-cloud-usage-tracker)
by Entelligentsia (also MIT).
