#!/usr/bin/env -S gjs -m
// SPDX-License-Identifier: MIT
//
// Ollama Cloud Usage CLI — reports Ollama Cloud quota usage on demand.
//
// Thin entry point: argument parsing + terminal rendering. The
// fetch/parse pipeline lives in ./usage.js — the shared source of
// truth also consumed by the GNOME Shell extension (gnome/scraper.js).
//
// Reads ollama.com session cookies from a local browser (Chrome /
// Chromium / Brave / Edge / Zen / Firefox) exactly like the extension —
// see cli/cookies.js — by lifting them via libsecret and the
// appropriate cookie-store reader (PBKDF2 + AES for Chromium variants,
// raw SQLite for Firefox/Zen).
//
// Usage: ./ollama-usage.js [--json] [--browser NAME] [--cookies]
//                          [--color | --no-color] [-h]

import GLib from 'gi://GLib';
import System from 'system';

import {fetchUsage} from './usage.js';

const VERSION = '0.1.2';
const BROWSER_CHOICES = ['auto', 'chrome', 'chromium', 'brave', 'edge', 'zen', 'firefox'];

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const HELP = `Ollama Cloud Usage CLI — report Ollama Cloud quota usage on demand.

Reads the ollama.com session from a local browser's cookies (like the
companion GNOME Shell extension) and prints session (5h) and weekly (7d)
quota bars.

Usage: ollama-usage [options]

Options:
  --browser NAME   Preferred browser source: auto, chrome, chromium, brave,
                   edge, zen, firefox (default: auto)
  --json           Print the usage report as a single JSON line. On error,
                   prints {"error":…, "hint":…} and exits 1.
  --cookies        Also report which cookie source was used (names only —
                   cookie values are never printed).
  --color          Force ANSI colours.
  --no-color       Disable ANSI colours (default: colours on for terminals,
                   off when piped; NO_COLOR honours standard behaviour).
  -h, --help       Show this help.
  --version        Print version.

Examples:
  ollama-usage                     # human-readable quota bars
  ollama-usage --browser firefox   # force Firefox cookies
  ollama-usage --json | jq .       # machine-readable output

Dependencies: gjs, libsecret (keyring), python3 (sqlite), openssl.`;

function parseArgs(argv) {
    const opts = {
        json: false,
        cookieInfo: false,
        help: false,
        version: false,
        browser: 'auto',
        color: undefined, // undefined = auto
    };

    const die = (msg) => {
        printerr(`${msg}\n\n${HELP}`);
        System.exit(2);
    };

    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--json') opts.json = true;
        else if (a === '--cookies') opts.cookieInfo = true;
        else if (a === '--help' || a === '-h') opts.help = true;
        else if (a === '--version') opts.version = true;
        else if (a === '--no-color') opts.color = false;
        else if (a === '--color') opts.color = true;
        else if (a === '--browser') opts.browser = argv[++i] ?? '';
        else if (a.startsWith('--browser=')) opts.browser = a.slice('--browser='.length);
        else die(`Unknown option: ${a}`);
    }
    if (!BROWSER_CHOICES.includes(opts.browser))
        die(`Invalid --browser '${opts.browser}'. Choose: ${BROWSER_CHOICES.join(', ')}`);
    return opts;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

// ANSI helpers. Colour is auto-detected from stdout (/proc readlink works on
// the Linux targets this tool is built for); NO_COLOR and --no-color win.
function stdoutIsTty() {
    try {
        return /\/dev\/(pts\/\d+|tty|console)/.test(GLib.file_read_link('/proc/self/fd/1'));
    } catch (e) {
        return false;
    }
}

function paint(opts) {
    const on = opts.color !== undefined ? opts.color
        : !GLib.getenv('NO_COLOR') && stdoutIsTty();
    const wrap = (code) => (s) => on ? `\x1b[${code}m${s}\x1b[0m` : String(s);
    return {
        bold: wrap('1'),
        dim: wrap('2'),
        red: wrap('31'),
        yellow: wrap('33'),
        green: wrap('32'),
        blue: wrap('34'),
        on,
    };
}

// Pace colouring, same thresholds as the panel indicator (gnome/extension.js)
// but with ANSI palette names instead of GNOME style classes.
function paceColor(pct, resetsAt, windowSec) {
    if (!resetsAt)
        return 'blue';
    const now = Date.now();
    const reset = new Date(resetsAt).getTime();
    const elapsed = Math.min(Math.max(now - (reset - windowSec * 1000), 0), windowSec * 1000);
    if (elapsed < 60_000)
        return 'blue'; // too early to judge
    const elapsedPct = (elapsed / (windowSec * 1000)) * 100;
    const delta = pct - elapsedPct;
    if (delta > 5)
        return 'red';
    if (delta > 2)
        return 'yellow';
    if (delta < -2)
        return 'green';
    return 'blue';
}

function formatCountdown(iso) {
    const secs = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 1000));
    if (secs === 0)
        return 'resetting';
    if (secs < 3600) {
        const m = Math.floor(secs / 60);
        return `${m}m`;
    }
    if (secs < 86400) {
        const h = Math.floor(secs / 3600);
        const m = Math.floor((secs % 3600) / 60);
        return m > 0 ? `${h}h${m}m` : `${h}h`;
    }
    const d = Math.floor(secs / 86400);
    const h = Math.floor((secs % 86400) / 3600);
    return h > 0 ? `${d}d${h}h` : `${d}d`;
}

function renderQuotaRow(c, title, pct, resetsAt, windowSec) {
    const width = 26;
    const clamped = Math.max(0, Math.min(100, pct ?? 0));
    const filled = Math.round((clamped / 100) * width);
    const bar = c[paceColor(pct ?? 0, resetsAt, windowSec)](
        '█'.repeat(filled) + '░'.repeat(width - filled));
    const pctText = pct == null ? c.dim('—') : c[paceColor(pct, resetsAt, windowSec)](
        `${pct.toFixed(1)}%`.padStart(6));
    const reset = resetsAt ? c.dim(`  ⟳ resets in ${formatCountdown(resetsAt)}`) : '';
    return `${title.padEnd(13)} ${bar} ${pctText}${reset}`;
}

function renderHuman(data, opts) {
    const c = paint(opts);

    print(c.bold('Ollama Cloud Usage') + c.dim(`  (via ${data.browser ?? 'unknown'})`));

    if (opts.cookieInfo) {
        const names = (opts.cookieNames ?? []).length
            ? opts.cookieNames.join(', ')
            : '(none visible)';
        print(c.dim(`cookies: ${names}`));
    }

    print(renderQuotaRow(c, 'Session (5h)', data.session_pct,
        data.session_resets_at, 5 * 3600));
    print(renderQuotaRow(c, 'Weekly  (7d)', data.weekly_pct ?? null,
        data.weekly_resets_at, 7 * 86400));
}

function renderError(err, json) {
    const error = err.error ?? 'Unknown error';
    const hint = err.hint;
    if (json) {
        print(JSON.stringify(hint ? {error, hint} : {error}));
        return;
    }
    const c = paint({color: undefined});
    printerr(`${c.red('✗ ' + error)}`);
    if (hint)
        printerr(`  ${c.dim(hint)}`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
    const opts = parseArgs(ARGV);

    if (opts.help) {
        print(HELP);
        return 0;
    }
    if (opts.version) {
        print(VERSION);
        return 0;
    }

    if (!opts.json && opts.cookieInfo)
        print(paint(opts).dim('Reading browser cookies…'));

    const data = await fetchUsage(opts.browser);

    if (data.error) {
        renderError(data, opts.json);
        return 1;
    }

    if (opts.json) {
        print(JSON.stringify(data));
    } else {
        opts.cookieNames = data.cookie_names ?? [];
        renderHuman(data, opts);
    }
    return 0;
}

try {
    System.exit(await main());
} catch (e) {
    renderError({error: 'Unexpected error', hint: String(e?.message ?? e)}, ARGV.includes('--json'));
    System.exit(1);
}