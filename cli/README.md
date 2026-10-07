# Ollama Cloud Usage CLI (+ shared usage core)

Two roles in this monorepo:

1. **Standalone terminal tool** — reports Ollama Cloud quota usage on
   demand. Reads the ollama.com session from a locally installed
   browser (Chrome, Chromium, Brave, Edge, Zen or Firefox) via
   libsecret and the appropriate cookie-store reader (PBKDF2 + AES for
   Chromium variants, raw SQLite for Firefox/Zen), fetches
   `https://ollama.com/settings` and prints the session (5h) and
   weekly (7d) quota.
2. **Source of truth for the shared usage pipeline** — this folder owns
   the fetch/parse/cookie/crypto logic. The GNOME Shell extension
   (`../gnome/`) imports these modules through the checked-in
   `../gnome/cli → ../cli` symlink and must not carry its own copy.
   Keep feature changes here, then re-verify both surfaces:
   `make test` and a manual `./ollama-usage.js` run.

## Usage

```sh
./ollama-usage.js                        # human-readable quota bars
./ollama-usage.js --browser firefox      # force a specific browser source
./ollama-usage.js --json | jq .          # machine-readable, one JSON line
./ollama-usage.js --cookies              # also show which cookies were used
./ollama-usage.js --help                 # all flags
```

Exit codes: `0` on success, `1` on error (with `{"error","hint"}` JSON in
`--json` mode), `2` for usage errors.

Colours are auto-disabled when stdout is not a terminal; `--no-color`,
`--color` and the `NO_COLOR` environment variable control this explicitly.

### Example output

```
Ollama Cloud Usage  (via Chrome/Default)
Session (5h)  ████████████░░░░░░░░░░░░░░ 42.3%  ⟳ resets in 2h13m
Weekly  (7d)  ████░░░░░░░░░░░░░░░░░░░░░░░ 17.9%  ⟳ resets in 4d2h
```

Bars are pace-coloured like the panel indicator: green when you're
behind quota pace, yellow/red when ahead, when data is available to
judge.

## What's in here

| File | Role |
|---|---|
| `ollama-usage.js` | Executable entry: arg parsing + terminal rendering |
| `usage.js` | **Core pipeline**: `fetchUsage()` (cookies → Soup GET → status handling) and `parseUsageHtml()`. Imported by both consumers |
| `cookies.js` | Browser discovery + cookie extraction (libsecret, SQLite) |
| `crypto.js` | Chromium Safe Storage PBKDF2 + AES-CBC decrypt (via openssl) |
| `pbkdf2.js` | Pure-JS PBKDF2 (HMAC-SHA1 / SHA-256) |
| `README.md` | This file |

### How the GNOME extension depends on this folder

- In the repo and in symlinked dev installs, `gnome/scraper.js` loads
  `./cli/usage.js` where `gnome/cli` is a checked-in symlink to this
  directory — the panel runs the exact same files as the CLI.
- For distributable bundles, `make zip` (repo root) copies
  `usage.js cookies.js crypto.js pbkdf2.js` into the package at
  `<extdir>/cli/` — the same relative path the imports use, so the
  source stays deduplicated while the artefact is self-contained.
- The JSON shape produced by `fetchUsage()` (and printed by
  `--json`) is the cross-surface contract:
  `{fetched_at, browser, session_pct?, weekly_pct?,
  session_resets_at?, weekly_resets_at?, cookie_names}` or
  `{error, hint}`. Changing it is a breaking change for both surfaces
  and for any script piping `--json`.

## Dependencies

- `gjs` (GLib/Soup bindings)
- `libsecret` (Chromium keyring access)
- `python3` (SQLite snapshot reads)
- `openssl` (AES decryption)

There is nothing to install: run `./ollama-usage.js` straight from a
checkout. If you want it on your `PATH`:

```sh
ln -s "$(readlink -f ollama-usage.js)" ~/.local/bin/ollama-usage
```

## Security notes

- Cookie **values** are never printed — `--cookies` shows names only.
- Cookie DBs and decrypt artefacts are processed through temp files that
  are unlinked immediately after use.