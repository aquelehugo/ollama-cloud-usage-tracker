// SPDX-License-Identifier: MIT
//
// Scraper — GNOME Shell lifecycle wrapper around the shared usage core.
//
// The actual fetching/parsing logic does NOT live here. This module is
// a thin adapter: it keeps the GObject signals ('updated'/'error'),
// the GSettings-driven refresh timer and invalidation hooks that the
// panel indicator (extension.js) binds to, and delegates the real work
// to cli/usage.js — the single source of truth also used by the CLI.
//
// Do not copy fetch/parser logic back into this file; change it in
// ../cli/usage.js and re-verify both surfaces (gnome/tests + CLI).
//
// Cookie extraction stays in cli/cookies.js (keyring + browser
// discovery). Everything outside GNOME Shell is imported through the
// ./cli symlink → ../cli, so code reads `./cli/usage.js`. When the
// extension is bundled (`make zip` from the repo root), the cli/ files
// are baked into the package at that same relative path.

import GObject from 'gi://GObject';
import GLib from 'gi://GLib';

import {fetchUsage, createUsageSession} from './cli/usage.js';

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

        // One shared Soup.Session for all refreshes of this instance.
        this._soup = createUsageSession();

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
        return fetchUsage(preferred, {session: this._soup});
    }

    destroy() {
        if (this._scheduledId) {
            GLib.source_remove(this._scheduledId);
            this._scheduledId = 0;
        }
    }
});