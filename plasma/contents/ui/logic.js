// SPDX-License-Identifier: MIT
//
// Plasma-side data helpers for the Ollama Cloud Usage plasmoid.
//
// Pure JS: no Qt objects, no QML imports — everything takes plain data
// in and returns plain values, so this file is both a `.pragma library`
// for the QML package and unit-testable outside Qt (node, via the
// tests/ harness that strips the pragma line).
//
// Ported from the GNOME extension's bar/label logic (gnome/extension.js)
// so both surfaces behave identically. Percentages/quota data come from
// the CLI core (../../cli/usage.js) via the `ollama-usage --json`
// contract.
//
// NOTE: the `.pragma library` line must stay the FIRST non-comment line;
// the node test harness filters it out.

.pragma library

var SESSION_WINDOW_SEC = 5 * 3600;
var WEEKLY_WINDOW_SEC = 7 * 86400;

// Compact/top-panel label. Format identical to the GNOME extension's
// top-bar label: "34% / 45%", or "34%" when the weekly bar is missing.
function compactLabel(data) {
    if (!data)
        return "\u2014"; // em dash
    var session = (data.session_pct != null) ? data.session_pct : 0;
    var weekly = data.weekly_pct;
    if (weekly != null)
        return Math.round(session) + "% / " + Math.round(weekly) + "%";
    return Math.round(session) + "%";
}

// Pace colouring, same thresholds as the GNOME indicator's paceColor.
// Returns a short token; the QML side maps it to a Kirigami.Theme colour
// with declared (non-dynamic) property access:
//   negative  (red)   = burning much faster than pace
//   neutral   (amber) = slightly faster
//   positive  (green) = slower than pace, under budget
//   highlight (accent) = on pace / too early to judge / no reset time
function paceRole(pct, resetsAt, windowSec) {
    if (!resetsAt)
        return "highlight";
    var now = Date.now();
    var reset = new Date(resetsAt).getTime();
    if (isNaN(reset))
        return "highlight";
    var elapsed = Math.min(Math.max(now - (reset - windowSec * 1000), 0),
                           windowSec * 1000);
    if (elapsed < 60000)
        return "highlight"; // too early to judge
    var elapsedPct = (elapsed / (windowSec * 1000)) * 100;
    var delta = pct - elapsedPct;
    if (delta > 5)
        return "negative";
    if (delta > 2)
        return "neutral";
    if (delta < -2)
        return "positive";
    return "highlight";
}

// "2h13m" / "42m" / "4d2h" / "resetting" — same formatting as GNOME.
function formatCountdown(iso) {
    var t = new Date(iso).getTime();
    if (isNaN(t))
        return "";
    var secs = Math.max(0, Math.round((t - Date.now()) / 1000));
    if (secs === 0)
        return "resetting";
    if (secs < 3600) {
        var m = Math.floor(secs / 60);
        return m + "m";
    }
    if (secs < 86400) {
        var h = Math.floor(secs / 3600);
        var m2 = Math.floor((secs % 3600) / 60);
        return m2 > 0 ? h + "h" + m2 + "m" : h + "h";
    }
    var d = Math.floor(secs / 86400);
    var h3 = Math.floor((secs % 86400) / 3600);
    return h3 > 0 ? d + "d" + h3 + "h" : d + "d";
}

// "just now" / "5s ago" / "3m ago" / "2h ago" — same as GNOME's header.
function formatRelativeTime(iso) {
    var t = new Date(iso).getTime();
    if (isNaN(t))
        return "";
    var secs = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (secs < 5)
        return "just now";
    if (secs < 60)
        return secs + "s ago";
    if (secs < 3600)
        return Math.floor(secs / 60) + "m ago";
    return Math.floor(secs / 3600) + "h ago";
}