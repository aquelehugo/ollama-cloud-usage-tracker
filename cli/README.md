# Ollama Cloud Usage CLI

Standalone terminal companion to the GNOME Shell extension (`../gnome/`):
reports Ollama Cloud quota usage on demand. Reads the ollama.com session
from a locally installed browser — Chrome, Chromium, Brave, Edge, Zen or
Firefox — using the same cookie-extraction code as the extension
(libsecret + PBKDF2/AES for Chromium variants, raw SQLite for
Firefox/Zen), then fetches `https://ollama.com/settings` and prints the
session (5h) and weekly (7d) quota.

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
| `ollama-usage.js` | Entry point: arg parsing, HTTP fetch, HTML parsing, rendering |
| `cookies.js` | Cookie extraction (copied verbatim from `../gnome/cookies.js`) |
| `crypto.js`  | Chromium Safe Storage AES decryption (copied verbatim) |
| `pbkdf2.js`  | Pure-JS PBKDF2 (copied verbatim) |

The three shared modules are deliberately **byte-identical copies** so
this folder is fully standalone — diffs against `../gnome/` stay clean,
and you only need to re-copy if the upstream extraction logic changes.

## Dependencies

- `gjs` (GLib/Soup bindings)
- `libsecret` (Chromium keyring access)
- `python3` (SQLite snapshot reads)
- `openssl` (AES decryption)

## Security notes

- Cookie **values** are never printed — `--cookies` shows names only.
- Cookie DBs and decrypt artefacts are processed through temp files that
  are unlinked immediately after use.