#!/usr/bin/env -S gjs -m
// SPDX-License-Identifier: MIT
//
// Ollama Cloud Usage CLI — reports Ollama Cloud quota usage on demand.
//
// Extracts the fetching logic from the GNOME Shell extension (gnome/)
// into a standalone terminal tool. Reads ollama.com session cookies
// from a local browser (Chrome / Chromium / Brave / Edge / Zen /
// Firefox) exactly like the extension — see cli/cookies.js — by
// lifting them via libsecret and the appropriate cookie-store reader
// (PBKDF2 + AES for Chromium variants, raw SQLite for Firefox/Zen).
//
// The pipeline mirrors gnome/scraper.js: cookies → Soup GET of
// ollama.com/settings → HTML usage regexes → {session, weekly}
// percentages + reset timestamps. Rendering is terminal-side: colored
// quota bars, percentages and reset countdowns, or plain JSON with
// --json for scripts / status bars.
//
// Usage: ./ollama-usage.js [--json] [--browser NAME] [--cookies]
//                          [--color | --no-color] [-h]

import Soup from 'gi://Soup';
import GLib from 'gi://GLib';
import System from 'system';

import {getCookiesForOllama} from './cookies.js';

const SETTINGS_URL = 'https://ollama.com/settings';
const USER_AGENT =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const VERSION = '0.1.0';
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
  ollama-usage --browser firefox   # force reading Firefox cookies
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
// Fetch pipeline — mirrors gnome/scraper.js without GObject signals
// ---------------------------------------------------------------------------

/**
 * @param {string} preferred
 * @returns {Promise<{fetched_at, browser, session_pct?, weekly_pct?,
 *   session_resets_at?, weekly_resets_at?} | {error, hint}>}
 */
async function fetchUsage(preferred) {
    const cookies = await getCookiesForOllama(preferred);
    if (cookies.error)
        return cookies;
    if (!cookies.header)
        return {error: 'No cookies', hint: 'Internal error'};

    // Cookie names only — values stay out of logs, terminals and JSON.
    const cookieNames = cookies.header.split(';')
        .map(part => part.split('=')[0].trim())
        .filter(n => n.length > 0);

    const session = new Soup.Session({user_agent: USER_AGENT});
    const msg = Soup.Message.new('GET', SETTINGS_URL);
    msg.request_headers.append('Cookie', cookies.header);
    msg.request_headers.append('User-Agent', USER_AGENT);
    msg.request_headers.append('Accept', 'text/html,application/xhtml+xml');

    const html = await new Promise((resolve, reject) => {
        session.send_and_read_async(
            msg,
            GLib.PRIORITY_DEFAULT,
            null,
            (s, result) => {
                try {
                    const input = s.send_and_read_finish(result);
                    if (msg.status_code >= 300 && msg.status_code < 400)
                        return reject({error: 'No ollama.com session',
                            hint: 'Log in to ollama.com in your browser, then retry'});
                    if (msg.status_code < 200 || msg.status_code >= 300)
                        return reject({error: `HTTP ${msg.status_code}`,
                            hint: 'Check your network connection'});
                    resolve(new TextDecoder('utf-8').decode(input.get_data()));
                } catch (e) {
                    reject({error: 'Network error', hint: String(e?.message ?? e)});
                }
            },
        );
    });

    const parsed = parseUsageHtml(html, cookies.source);
    if (!parsed)
        return {error: 'No usage data', hint: 'Check your Ollama Cloud subscription'};
    parsed.cookie_names = cookieNames;
    return parsed;
}

// ---------------------------------------------------------------------------
// Parser — identical to gnome/scraper.js
// ---------------------------------------------------------------------------

const USAGE_REGEX = /aria-label="(Session|Weekly) usage (\d+(?:\.\d+)?)%/g;
const TIME_REGEX = /data-time="([^"]+)"/g;
const TESTID_REGEX = /data-testid="(session|weekly)-usage"[^>]*>\s*(\d+(?:\.\d+)?)\s*%/g;

function parseUsageHtml(html, source) {
    const result = {fetched_at: new Date().toISOString(), browser: source ?? null};

    let m;
    const usages = [];
    while ((m = USAGE_REGEX.exec(html)) !== null)
        usages.push({window: m[1].toLowerCase(), pct: parseFloat(m[2])});
    if (usages.length === 0) {
        while ((m = TESTID_REGEX.exec(html)) !== null)
            usages.push({window: m[1].toLowerCase(), pct: parseFloat(m[2])});
    }
    for (const u of usages) {
        if (u.window === 'session')
            result.session_pct = u.pct;
        else if (u.window === 'weekly')
            result.weekly_pct = u.pct;
    }

    const timestamps = [];
    while ((m = TIME_REGEX.exec(html)) !== null)
        timestamps.push(m[1]);
    if (timestamps[0] && result.session_pct != null)
        result.session_resets_at = timestamps[0];
    if (timestamps[1] && result.weekly_pct != null)
        result.weekly_resets_at = timestamps[1];
    if (timestamps.length === 1 && result.session_pct == null && result.weekly_pct != null)
        result.weekly_resets_at = timestamps[0];

    if (result.session_pct == null && result.weekly_pct == null)
        return null;
    return result;
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

    if (!opts.json) {
        // Only print waiting notice for human mode; JSON must stay clean.
        const c = paint(opts);
        if (opts.cookieInfo)
            print(c.dim('Reading browser cookies…'));
    }

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