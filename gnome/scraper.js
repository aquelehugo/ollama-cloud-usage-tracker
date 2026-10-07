// SPDX-License-Identifier: MIT
//
// Scraper — fetches ollama.com/settings using browser cookies, parses the
// dashboard, and emits a GObject signal when the data lands.
//
// We use Soup.Session (libsoup 3) for the HTTP request. The browser
// cookies come from ./cookies.js. The parser scrapes the same
// `aria-label="(Session|Weekly) usage N%"` pattern the pi version
// was built against, with a fallback regex for newer dashboard layouts.

import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

import {getCookiesForOllama} from './cookies.js';

const SETTINGS_URL = 'https://ollama.com/settings';
const USER_AGENT =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export const Scraper = GObject.registerClass({
    Signals: {
        updated: {},
        error: {param_types: [GObject.TYPE_STRING, GObject.TYPE_STRING]},
    },
}, class Scraper extends GObject.Object {
    constructor(extension) {
        super();
        this._settings = extension.getSettings();
        this._data = null;
        this._scheduledId = 0;
        this._busy = false;

        this._session = new Soup.Session({user_agent: USER_AGENT});

        this.refreshNow();
        this._schedule();
    }

    get data() {
        return this._data;
    }

    refreshNow() {
        if (this._busy)
            return;
        this._busy = true;
        this._fetch()
            .then(data => {
                this._data = data;
                this.emit('updated');
            })
            .catch(err => {
                log(`[ollama-tracker] fetch error: ${JSON.stringify(err)}`);
                const message = err?.error ?? 'Network error';
                const hint = err?.hint ?? 'Check your network connection';
                this._data = null;
                this.emit('error', message, hint);
            })
            .finally(() => {
                this._busy = false;
            });
    }

    invalidate() {
        this._data = null;
        this.refreshNow();
    }

    reschedule() {
        if (this._scheduledId) {
            GLib.source_remove(this._scheduledId);
            this._scheduledId = 0;
        }
        this._schedule();
    }

    _schedule() {
        const minutes = Math.max(1, this._settings.get_int('refresh-interval-minutes'));
        this._scheduledId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            minutes * 60,
            () => {
                this.refreshNow();
                this._scheduledId = 0;
                this._schedule();
                return GLib.SOURCE_REMOVE;
            },
        );
    }

    async _fetch() {
        const preferred = this._settings.get_string('preferred-browser');
        log(`[ollama-tracker] fetch start, preferred=${preferred}`);
        const cookies = await getCookiesForOllama(preferred);
        log(`[ollama-tracker] cookies result: ${JSON.stringify(cookies).substring(0, 200)}`);
        if (!cookies || cookies.error)
            return Promise.reject(cookies);
        if (!cookies.header)
            return Promise.reject({error: 'No cookies', hint: 'Internal error'});

        const msg = Soup.Message.new('GET', SETTINGS_URL);
        if (!msg)
            return Promise.reject({error: 'Bad URL', hint: SETTINGS_URL});
        msg.request_headers.append('Cookie', cookies.header);
        msg.request_headers.append('User-Agent', USER_AGENT);
        msg.request_headers.append('Accept', 'text/html,application/xhtml+xml');

        const response = await new Promise((resolve, reject) => {
            this._session.send_and_read_async(
                msg,
                GLib.PRIORITY_DEFAULT,
                null,
                (session, result) => {
                    try {
                        const input = session.send_and_read_finish(result);
                        if (msg.status_code >= 300 && msg.status_code < 400)
                            return reject({error: 'No ollama.com session',
                                hint: 'Log in to ollama.com in your browser, then refresh'});
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

        const parsed = parseUsageHtml(response, cookies.source);
        if (!parsed)
            return Promise.reject({error: 'No usage data', hint: 'Check your Ollama Cloud subscription'});
        return parsed;
    }

    destroy() {
        if (this._scheduledId) {
            GLib.source_remove(this._scheduledId);
            this._scheduledId = 0;
        }
    }
});

// ---------------------------------------------------------------------------
// Parser
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
