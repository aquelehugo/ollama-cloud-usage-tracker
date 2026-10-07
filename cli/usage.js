// SPDX-License-Identifier: MIT
//
// Usage core — the single source of truth for fetching Ollama Cloud
// quota usage. Consumed directly by the CLI entry (./ollama-usage.js)
// and by the GNOME Shell extension (gnome/scraper.js imports this
// through the repo's gnome/cli -> ../cli symlink, or via the cli/
// copy the `make zip` bundle bakes in).
//
// The extension must not carry its own copy of this pipeline — keep
// every fetch/parse change here and re-verify both surfaces
// (make test in gnome/ plus a manual ./ollama-usage.js --json run).
//
// Pipeline: browser-cookie session (./cookies.js) → Soup GET of
// ollama.com/settings → HTML usage regexes → percent + reset
// timestamps. The parser scrapes the same
// `aria-label="(Session|Weekly) usage N%"` pattern the pi version
// was built against, with a fallback regex for newer dashboard
// layouts.

import Soup from 'gi://Soup';
import GLib from 'gi://GLib';

import {getCookiesForOllama} from './cookies.js';

const SETTINGS_URL = 'https://ollama.com/settings';
const USER_AGENT =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** One Soup.Session per long-running consumer; the CLI makes a fresh one. */
export function createUsageSession() {
    return new Soup.Session({user_agent: USER_AGENT});
}

/**
 * Fetch the current usage report.
 *
 * @param {string} preferred  'auto' | 'chrome' | 'zen' | 'firefox' | …
 * @param {{session?: Soup.Session}} [opts]  reuse a Soup session
 * @returns {Promise<{fetched_at, browser, session_pct?, weekly_pct?,
 *   session_resets_at?, weekly_resets_at?, cookie_names: string[]}
 *   | {error: string, hint: string}>}
 */
export async function fetchUsage(preferred = 'auto', {session} = {}) {
    const soup = session ?? createUsageSession();

    const cookies = await getCookiesForOllama(preferred);
    if (cookies.error)
        return cookies;
    if (!cookies.header)
        return {error: 'No cookies', hint: 'Internal error'};

    // Cookie names only — values stay out of logs, terminals and JSON.
    const cookieNames = cookies.header.split(';')
        .map(part => part.split('=')[0].trim())
        .filter(n => n.length > 0);

    const msg = Soup.Message.new('GET', SETTINGS_URL);
    if (!msg)
        return {error: 'Bad URL', hint: SETTINGS_URL};
    msg.request_headers.append('Cookie', cookies.header);
    msg.request_headers.append('User-Agent', USER_AGENT);
    msg.request_headers.append('Accept', 'text/html,application/xhtml+xml');

    const html = await new Promise((resolve, reject) => {
        soup.send_and_read_async(
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
// Parser
// ---------------------------------------------------------------------------

const USAGE_REGEX = /aria-label="(Session|Weekly) usage (\d+(?:\.\d+)?)%/g;
const TIME_REGEX = /data-time="([^"]+)"/g;
const TESTID_REGEX = /data-testid="(session|weekly)-usage"[^>]*>\s*(\d+(?:\.\d+)?)\s*%/g;

/**
 * Extract usage percent + reset timestamps from the /settings HTML.
 * @returns {{fetched_at, browser, session_pct?, weekly_pct?,
 *   session_resets_at?, weekly_resets_at?} | null}
 */
export function parseUsageHtml(html, source) {
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