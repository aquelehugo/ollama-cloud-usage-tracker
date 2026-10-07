#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// Unit tests for the plasmoid's pure-JS helpers (contents/ui/logic.js).
//
// logic.js is a QML `.pragma library`, which plain node cannot parse —
// the harness strips the pragma line and evals the rest, then asserts
// the same behaviour the GNOME extension guarantees (compact label
// format, pace thresholds, countdown formatting).
//
// Run:  node plasma/tests/test-logic.js   (also make test-plasma)

const fs = require('fs');
const path = require('path');

const logicPath = path.join(__dirname, '..', 'contents', 'ui', 'logic.js');
const src = fs
    .readFileSync(logicPath, 'utf8')
    .split('\n')
    .filter(line => !line.trim().startsWith('.pragma'))
    .join('\n');

const Logic = eval(
    '(function(){' + src + '\n; return {' +
    'compactLabel, paceRole, formatCountdown, formatRelativeTime,' +
    'SESSION_WINDOW_SEC, WEEKLY_WINDOW_SEC};})()'
);

let failures = 0;
function check(name, actual, expected) {
    const ok = Object.is(actual, expected);
    console.log((ok ? 'PASS' : 'FAIL') + ': ' + name +
        (ok ? '' : ` (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`));
    if (!ok)
        failures++;
}

// --- compact label: GNOME parity --------------------------------------
check('compactLabel(null) em dash', Logic.compactLabel(null), '\u2014');
check('session+weekly rounding',
    Logic.compactLabel({session_pct: 34.2, weekly_pct: 45.8}), '34% / 46%');
check('session only',
    Logic.compactLabel({session_pct: 5, weekly_pct: null}), '5%');
check('missing session defaults 0',
    Logic.compactLabel({weekly_pct: 12.3}), '0% / 12%');

// --- pace colour thresholds (same numbers as gnome/extension.js) -----
// Return values are Kirigami.Theme property names (see paceRole docs).
const NOW = Date.now();
const win = Logic.SESSION_WINDOW_SEC * 1000;
const resetOf = (elapsedMs) => new Date(NOW + win - elapsedMs).toISOString();

check('no resetsAt -> highlighted', Logic.paceRole(50, null, win / 1000), 'highlight');
check('fresh window (<60s) -> highlighted',
    Logic.paceRole(90, resetOf(10 * 1000), win / 1000), 'highlight');
check('fast burner -> negative', Logic.paceRole(60, resetOf(3600e3), win / 1000), 'negative');
check('slightly ahead -> neutral', Logic.paceRole(24, resetOf(3600e3), win / 1000), 'neutral');
check('on pace -> highlighted', Logic.paceRole(21, resetOf(3600e3), win / 1000), 'highlight');
check('under budget -> positive', Logic.paceRole(10, resetOf(3600e3), win / 1000), 'positive');
check('bad resetsAt -> highlighted', Logic.paceRole(50, 'not-a-date', win / 1000), 'highlight');

// --- countdown formatting (same shapes as GNOME) ----------------------
const inSeconds = (s) => new Date(NOW + s * 1000).toISOString();
check('>=1d', Logic.formatCountdown(inSeconds(4 * 86400 + 2 * 3600)), '4d2h');
check('exact days', Logic.formatCountdown(inSeconds(5 * 86400)), '5d');
check('hours+minutes', Logic.formatCountdown(inSeconds(2 * 3600 + 13 * 60)), '2h13m');
check('hours only', Logic.formatCountdown(inSeconds(3 * 3600)), '3h');
check('minutes', Logic.formatCountdown(inSeconds(42 * 60)), '42m');
check('zero -> resetting', Logic.formatCountdown(new Date(NOW - 60 * 1000).toISOString()), 'resetting');
check('garbage -> empty', Logic.formatCountdown('nope'), '');

// --- relative time (popup header) ------------------------------------
check('just now', Logic.formatRelativeTime(new Date(NOW - 3e3).toISOString()), 'just now');
check('seconds ago', Logic.formatRelativeTime(new Date(NOW - 30e3).toISOString()), '30s ago');
check('minutes ago', Logic.formatRelativeTime(new Date(NOW - 5 * 60e3).toISOString()), '5m ago');
check('hours ago', Logic.formatRelativeTime(new Date(NOW - 3 * 3600e3).toISOString()), '3h ago');
check('garbage -> empty', Logic.formatRelativeTime('nope'), '');

// --- window constants share GNOME values ------------------------------
check('session window 5h', Logic.SESSION_WINDOW_SEC, 5 * 3600);
check('weekly window 7d', Logic.WEEKLY_WINDOW_SEC, 7 * 86400);

if (failures > 0) {
    console.error(failures + ' test(s) failed');
    process.exit(1);
}
console.log('OK: logic.js behaviour matches the GNOME extension parity spec');