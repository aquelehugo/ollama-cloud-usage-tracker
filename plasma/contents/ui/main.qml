/*
    SPDX-License-Identifier: MIT

    Ollama Cloud Usage Tracker — Plasma system tray widget (Plasma 5.27).

    Thin UI wrapper. The actual usage pipeline (browser cookie
    extraction, Chrome Safe Storage decryption, HTTP fetch, HTML
    parsing) deliberately does NOT live here: it is the CLI core in
    ../../cli/ (single source of truth), executed as
    `ollama-usage.js --json` and consumed through its JSON contract —

        {"fetched_at":…,"browser":"Chrome/Default","session_pct":2.9,
         "weekly_pct":2.4,"session_resets_at":"…","weekly_resets_at":"…",
         "cookie_names":["…"]}
     or  {"error":"…","hint":"…"}

    Compact representation: GNOME-format status bar label
    "34% / 45%" (+ optional ollama icon, toggled in settings).
    Full representation: the popup that appears on click, mirroring
    the GNOME extension's menu (quota bars, percentages, reset
    countdowns, refresh, link to ollama.com/settings).
*/

import QtQuick 2.15
import QtQuick.Layouts 1.15

import org.kde.plasma.core 2.1 as PlasmaCore
import org.kde.plasma.plasmoid 2.0

import "logic.js" as Logic

Item {
    id: root

    // ------------------------------------------------------------------
    // Config (contents/config/main.xml)
    // ------------------------------------------------------------------
    readonly property bool cfgShowIcon: Plasmoid.configuration.showIcon
    readonly property string cfgCliPath: Plasmoid.configuration.cliPath
    readonly property int cfgRefreshInterval: Plasmoid.configuration.refreshInterval

    // ------------------------------------------------------------------
    // Runtime state
    // ------------------------------------------------------------------
    property var usageData: null          // parsed CLI JSON, or null
    property string errorMessage: ""
    property string errorHint: ""
    property bool busy: false

    // Compact label — identical format to the GNOME top-bar label.
    readonly property string compactLabel: Logic.compactLabel(root.usageData)

    readonly property url packageRoot: Qt.resolvedUrl("../..")

    // ------------------------------------------------------------------
    // Plasmoid wiring
    // ------------------------------------------------------------------
    Plasmoid.switchWidth: PlasmaCore.Units.gridUnit * 10
    Plasmoid.switchHeight: PlasmaCore.Units.gridUnit * 10
    Plasmoid.title: "Ollama Cloud Usage"
    Plasmoid.icon: "ollama-cloud-usage"

    Plasmoid.status: root.errorMessage !== ""
        ? PlasmaCore.Types.NeedsAttentionStatus
        : PlasmaCore.Types.PassiveStatus

    Plasmoid.toolTipMainText: "Ollama Cloud Usage"
    Plasmoid.toolTipSubText: root.errorMessage !== ""
        ? root.errorMessage
        : (root.usageData != null
           ? root.compactLabel
              + (root.usageData.session_resets_at != null
                 ? "  ⟳ " + Logic.formatCountdown(root.usageData.session_resets_at)
                 : "")
           : "—")

    Plasmoid.compactRepresentation: CompactRepresentation { applet: root }
    Plasmoid.fullRepresentation: FullRepresentation { applet: root }
    Plasmoid.preferredRepresentation: Plasmoid.compactRepresentation

    // (Config pages are registered in contents/config/config.qml — that
    // file runs inside the config dialog, where the
    // org.kde.plasma.configuration module is installed.)

    // ------------------------------------------------------------------
    // CLI invocation — the "executable" dataengine runs each source as a
    // shell command and delivers stdout + exit code when it finishes.
    // ------------------------------------------------------------------
    PlasmaCore.DataSource {
        id: executer
        engine: "executable"
        connectedSources: []
        property var callbacks: ({})

        onNewData: {
            var cb = callbacks[sourceName];
            if (cb) {
                delete callbacks[sourceName];
                cb(data["exit code"], data["stdout"] !== undefined ? data["stdout"] : "",
                   data["stderr"] !== undefined ? data["stderr"] : "");
            }
            disconnectSource(sourceName);
        }

        function exec(command, cb) {
            // The dataengine treats the source string as the command; a
            // trailing "#<id>" is a shell comment that keeps every run a
            // distinct source, so reconnects always re-execute instead of
            // replaying cached output.
            var source = command + " #" + Date.now() + "-" + Math.round(Math.random() * 1e6);
            callbacks[source] = cb;
            connectSource(source);
        }
    }

    function shellQuote(s) {
        return "'" + s.replace(/'/g, "'\\''") + "'";
    }

    // Ordered auto-detection for the CLI. Config wins. In the dev
    // checkout the package root is <repo>/plasma, so the shared core is
    // one level up: <repo>/cli/ollama-usage.js (exactly the same code the
    // GNOME extension imports through its gnome/cli symlink).
    function candidates() {
        var list = [];
        if (root.cfgCliPath !== "")
            list.push(root.cfgCliPath + " --json");
        var ru = root.packageRoot.toString();
        if (ru.indexOf("file://") === 0) {
            var pkgPath = decodeURIComponent(ru.slice("file://".length));
            var cliPath = pkgPath.replace(/\/+$/, "") + "/../cli/ollama-usage.js";
            list.push(root.shellQuote(cliPath) + " --json");
        }
        list.push("ollama-usage --json");
        list.push("~/.local/bin/ollama-usage --json");
        return list;
    }

    function refreshNow() {
        if (root.busy)
            return; // GNOME parity: refreshNow() is a no-op while busy
        root.busy = true;
        var cands = root.candidates();
        var idx = 0;

        function succeed(obj) {
            root.busy = false;
            root.usageData = obj;
            root.errorMessage = "";
            root.errorHint = "";
        }
        function fail(message, hint) {
            root.busy = false;
            root.usageData = null;
            root.errorMessage = message;
            root.errorHint = hint;
        }
        function tryNext(lastStderr) {
            if (idx >= cands.length) {
                fail("Ollama usage CLI not found",
                     "Set the CLI path in the widget settings or install the CLI on your PATH (see plasma/README.md)"
                     + (lastStderr !== "" ? "\n\n" + lastStderr : ""));
                return;
            }
            var cmd = cands[idx++];
            executer.exec(cmd, function (exitCode, stdout, stderr) {
                var obj = null;
                try {
                    obj = JSON.parse(stdout.trim());
                } catch (e) {
                    obj = null;
                }
                if (exitCode === 0 && obj && !obj.error) {
                    succeed(obj);
                    return;
                }
                if (obj && obj.error) {
                    // The CLI ran and reported a domain error (cookies,
                    // login, network…) — trust it, don't probe further.
                    fail(obj.error, obj.hint ? obj.hint : "");
                    return;
                }
                tryNext(stderr.trim());
            });
        }
        tryNext("");
    }

    // ------------------------------------------------------------------
    // Refresh timers & popup-open behaviour (GNOME parity: the menu
    // refreshes every time it opens)
    // ------------------------------------------------------------------
    Timer {
        id: refreshTimer
        interval: Math.max(1, root.cfgRefreshInterval) * 60 * 1000
        running: true
        repeat: true
        triggeredOnStart: false
        onTriggered: root.refreshNow()
    }

    onCfgRefreshIntervalChanged: refreshTimer.restart()

    Plasmoid.onExpandedChanged: {
        if (Plasmoid.expanded)
            root.refreshNow();
    }

    // Context-menu actions (right-click / tray menu) — the click popup is
    // the full representation.
    Component.onCompleted: {
        refreshNow();

        Plasmoid.setAction("refresh", "Refresh now", "view-refresh");
        var refreshAction = Plasmoid.action("refresh");
        if (refreshAction)
            refreshAction.triggered.connect(root.refreshNow);

        Plasmoid.setAction("toggleIcon", "Show icon in status bar", "configure");
        var toggleAction = Plasmoid.action("toggleIcon");
        if (toggleAction) {
            toggleAction.checkable = true;
            toggleAction.checked = Qt.binding(function () { return root.cfgShowIcon });
            toggleAction.triggered.connect(function () {
                Plasmoid.configuration.showIcon = toggleAction.checked;
            });
        }

        Plasmoid.setAction("openSettings", "Open ollama.com/settings", "internet-web-browser");
        var openAction = Plasmoid.action("openSettings");
        if (openAction)
            openAction.triggered.connect(function () {
                Qt.openUrlExternally("https://ollama.com/settings");
            });
    }

    function openSettings() {
        Qt.openUrlExternally("https://ollama.com/settings");
    }
}