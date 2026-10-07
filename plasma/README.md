# Ollama Cloud Usage Tracker (Plasma widget)

Live Ollama Cloud quota in the **system tray** (status bar), shaped like
the GNOME extension: an optional ollama icon plus the classic
`34% / 45%` label, a popup "menu" on click with pace-coloured quota
bars, exact percentages and reset countdowns, and Refresh /
ollama.com/settings actions.

> **Thin UI wrapper.** The fetching logic (browser cookie extraction,
> Chromium Safe Storage decryption, HTTP fetch, HTML parsing) is NOT in
> this folder — it is the CLI core in [`../cli/`](../cli/README.md),
> which is the single source of truth. This widget runs the CLI
> executable with `--json` and renders the result; the JSON shape is
> the cross-surface contract (documented in `../cli/README.md`).
> Unlike `gnome/` (which imports the shared modules directly), Plasma
> applets host their own process sandbox, so the dependency goes
> through the CLI's JSON output instead of a symlink import.

Inspired by the GNOME extension in `../gnome/`.

## How to use

After installing (below), the widget appears in the system tray. The
compact item adapts to the space it actually gets — measured at
runtime, so high-DPI/panel changes need no extra config:

- **Panel placement / roomy tray** (e.g. the tray's "Scale icons to
  fit" mode): full GNOME-format label — icon + `34% / 45%`.
- **Standard tray cell** (Plasma 5.27 force-fills every applet into an
  icon-sized box and ignores width requests): battery-parity badge —
  ollama icon with the rounded session percentage in the corner (or a
  small centred `%` figure when the icon is hidden). Full numbers stay
  one click away in the popup.
- `—` = no data yet, `!` = error (details in the popup, warning icon
  instead of the ollama logo).

- Left-click: opens the popup — header ("Last updated … via
  `Zen/…`"), **Session (5h)** and **Weekly (7d)** quota bars
  (pace-coloured: green under budget pace, amber/red ahead), exact
  percentages, reset countdowns, and a footer with **Refresh now** and
  **Open ollama.com/settings** buttons.
- The popup refreshes on every open, like the GNOME menu.
- Right-click: context menu — *Refresh now*, *Show icon in status bar*
  (checkbox), *Open ollama.com/settings*.
- Status bar label semantics: `—` = no data yet, `!` = error (details
  in the popup, warning icon instead of the ollama logo).

## How to install

Requirements: **Plasma 5.27** (target of this package; Plasma 6 port
not started), the CLI dependency set: `gjs`, `libsecret`, `python3`,
`openssl` (the widget shells out to the CLI), and a browser with an
`ollama.com` session.

From the repo root:

```bash
make bin                                            # CLI symlink at ~/.local/bin/ollama-usage
make install-plasma                                 # kpackagetool5 -i/-u copy + hicolor icon
systemctl --user restart plasma-plasmashell.service  # register + load
```

`install-plasma` copies the package via `kpackagetool5`
(**not** a symlink: KPackage discovery does not read symlinked plasmoid
dirs — unlike GNOME Shell extension folders; verified live), installs
the ollama icon into `hicolor`, and the `X-Plasma-NotificationArea`
metadata makes the tray auto-add the widget on the next shell start
(confirmed: the id landed in `extraItems` without manual steps).
If it does not appear: right-click the tray arrow →
*Configure System Tray* → *Items* → add **Ollama Cloud Usage Tracker**.

Dev loop: edit → `make install-plasma` → restart plasmashell.

### CLI discovery

The widget must find `cli/ollama-usage.js` (the source of truth). It
tries, in order:

1. **CLI path** setting (widget settings) — absolute path, e.g.
   `/home/you/projects/…/cli/ollama-usage.js`
2. **Repo checkout copy** — only meaningful if the installed package
   sits next to a `cli/` dir
3. **`ollama-usage` on `$PATH`** — the normal case after `make bin`,
   which installs a wrapper script (`exec gjs -m <repo>/cli/ollama-usage.js`)
   at `~/.local/bin/ollama-usage`. A plain symlink to the script is NOT
   enough: gjs needs the module's real `.js` path to resolve its
   relative imports.
4. (fallback) bare `ollama-usage` lookup — covered by #3 when
   `~/.local/bin` is on `$PATH` (it is, on stock Ubuntu/Plasma)

If nothing resolves, the widget shows `!` with a hint in the popup.

## Config

- **Show the ollama icon in the status bar** (default: on) — requested
  icon toggle; off leaves just the label.
- **Refresh every** 1–60 min (default 5).
- **CLI path** (empty = auto-detect, see above).

Via *widget settings* or the context-menu *Show icon* checkbox.

## What's in here

```
metadata.json                    KPlugin id/keys + ServiceTypes + systray auto-add flags
contents/config/main.xml         KConfigXT schema (showIcon, cliPath, refreshInterval)
contents/config/config.qml       Config-dialog page registration (NOT main.qml)
contents/ui/main.qml             State + CLI invocation (executable dataengine) + wiring
contents/ui/logic.js             Pure-JS helpers (labels, pace colour, countdowns)
contents/ui/CompactRepresentation.qml   Status bar item
contents/ui/FullRepresentation.qml      Click popup (GNOME-menu parity)
contents/ui/config/ConfigGeneral.qml    Settings page
tests/test-logic.js              node unit tests for logic.js
```

*The user-specified URL
`https://ollama.com/public/android-chrome-icon-192x192.png` returns
404; the same artwork is fetched from
`https://ollama.com/public/apple-touch-icon.png` (180×180) instead and
resized to 192 for the hicolor install.

### Plasma-version findings (recorded for the 5.27 target)
- Metadata: json-only works, but `KPlugin.ServiceTypes:
  ["Plasma/Applet"]` is REQUIRED for KPackage discovery; systray
  auto-add keys are `X-Plasma-NotificationArea: "true"` (string!) +
  `X-Plasma-NotificationAreaCategory: ApplicationStatus` (battery
  parity).
- Config pages register via `contents/config/config.qml`
  (ConfigModel/ConfigCategory) — the config dialog context has the
  module installed; `contents/ui/main.qml` must NOT import
  org.kde.plasma.configuration.
- `Kirigami.Theme["role"]` dynamic property access returns undefined
  here — use declared properties (ternary) instead.
- `PlasmaCore.DataSource.onNewData` signal parameter is `sourceName`.

## Testing & building

```bash
node plasma/tests/test-logic.js   # pure-JS helper parity tests (also via make test-plasma)
make zip-plasma                   # dist/ollama.cloud.usage.tracker.plasmoid
```

The QML UI itself has no automated test rig here (Qt5 QML toolchain
not fully installed on this box) — it was verified live on this
machine's Plasma 5.27 session.

## License

MIT — see [../gnome/LICENSE](../gnome/LICENSE).