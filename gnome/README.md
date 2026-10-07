# Ollama Cloud Usage Tracker (GNOME Shell extension)

Live Ollama Cloud usage in the top panel, with detailed quota breakdown
in a popup menu. Inspired by
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

### From source

```bash
git clone https://github.com/aquelehugo/ollama-cloud-tracker-gnome
cd ollama-cloud-tracker-gnome
glib-compile-schemas schemas/
cp -r . ~/.local/share/gnome-shell/extensions/ollama-cloud-usage-tracker@aquelehugo.github.io/
```

Then log out / log in (or restart GNOME Shell with `Alt+F2` → `r`),
open *Extensions*, and toggle **Ollama Cloud Usage Tracker** on.

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

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  scraper.js  │───▶│  cookies.js  │───▶│   crypto.js  │───▶│   Soup 3     │
│  (GJS)       │    │  (browser    │    │  (PBKDF2 +   │    │   GET        │
│  scrape HTML │    │   discovery) │    │   AES-CBC)   │    │ /settings    │
└──────┬───────┘    └──────────────┘    └──────────────┘    └──────┬───────┘
       │                                                             │
       ▼                                                             ▼
  ┌──────────────┐                                          ┌──────────────┐
  │  bar.js      │  ◀──── percentage ──── panel + popup ────│  ollama.com  │
  │  pace colour │                                          │  dashboard   │
  └──────────────┘                                          └──────────────┘
```

1. **scraper.js** asks **cookies.js** for a Cookie header.
2. **cookies.js** finds the browser's `Cookies` SQLite DB, copies it to
   `/tmp` (the browser holds a write lock), and feeds the encrypted
   blobs to **crypto.js**.
3. **crypto.js** looks up the Safe Storage password in libsecret,
   derives the AES key with PBKDF2 (`saltysalt` / `saltsalt`, 1
   iteration, SHA1 / SHA256), and shells out to `openssl enc` for the
   AES-CBC step.
4. **scraper.js** GETs `https://ollama.com/settings` and parses
   `aria-label="(Session|Weekly) usage N%"` + `data-time="..."` from the
   rendered dashboard.
5. **bar.js** draws the percentage into a Cairo-painted `St.DrawingArea`
   with a pace-derived colour.

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
scraper.js                Soup fetch + HTML parser
cookies.js                Browser discovery + cookie extraction
crypto.js                 AES-CBC decrypt (calls openssl)
pbkdf2.js                 Pure-JS PBKDF2 (HMAC-SHA1 / SHA-256)
```

## License

MIT — see [LICENSE](LICENSE). Parser strategy and pace-colour
heuristic derived from
[pi-ollama-cloud-usage-tracker](https://github.com/Entelligentsia/pi-ollama-cloud-usage-tracker)
by Entelligentsia (also MIT).
