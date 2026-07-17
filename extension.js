// SPDX-License-Identifier: MIT
//
// Ollama Cloud Usage Tracker — top-panel indicator + popup menu.
//
// Reads usage percentages from ollama.com/settings using cookies lifted
// from a local browser (Chrome / Chromium / Zen / Firefox) via libsecret
// and the appropriate cookie-store reader (PBKDF2 + AES for Chromium
// variants, raw SQLite for Firefox/Zen).
//
// The popup menu shows both session (5h) and weekly (7d) quota bars with
// exact percentages, reset countdowns, and a refresh button. The top-bar
// label shows a compact summary: `session% / weekly%` (or just
// `session%` when the weekly bar is hidden in prefs).

import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Scraper} from './scraper.js';
import {Bar} from './bar.js';

// ---------------------------------------------------------------------------
// Indicator
// ---------------------------------------------------------------------------

const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    constructor(extension) {
        super(0.5, _('Ollama Cloud Usage'), false);

        this._extension = extension;
        this._settings = extension.getSettings();
        this._scraper = new Scraper(extension);

        // Top bar: icon + compact label
        const box = new St.BoxLayout({
            style_class: 'panel-status-menu-box',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(box);

        this._icon = new St.Icon({
            icon_name: 'dialog-face-smile-symbolic',
            style_class: 'system-status-icon',
        });
        box.add_child(this._icon);

        this._label = new St.Label({
            text: '—',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'panel-status-indicators-keyboard',
            x_expand: true,
        });
        box.add_child(this._label);

        this._buildMenu();

        this._scraper.connect('updated', () => this._refresh());
        this._scraper.connect('error', (_s, err) => this._showError(err));

        this._settingsChangedId = this._settings.connect('changed', (_s, key) => {
            if (key === 'refresh-interval-minutes')
                this._scraper.reschedule();
            else if (key === 'preferred-browser')
                this._scraper.invalidate();
            else if (key === 'show-weekly-bar')
                this._refresh();
        });
    }

    _buildMenu() {
        this._headerItem = new PopupMenu.PopupMenuItem(_('Ollama Cloud Usage'), {
            reactive: false,
            can_focus: false,
        });
        this._headerBin = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_expand: false,
        });
        this._headerItem.add_child(this._headerBin);
        this.menu.addMenuItem(this._headerItem);

        this._sessionItem = new PopupMenu.PopupMenuItem('', {
            reactive: false,
            can_focus: false,
        });
        this._sessionBin = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_expand: false,
        });
        this._sessionItem.add_child(this._sessionBin);
        this.menu.addMenuItem(this._sessionItem);

        this._weeklyItem = new PopupMenu.PopupMenuItem('', {
            reactive: false,
            can_focus: false,
        });
        this._weeklyBin = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_expand: false,
        });
        this._weeklyItem.add_child(this._weeklyBin);
        this.menu.addMenuItem(this._weeklyItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._statusItem = new PopupMenu.PopupMenuItem('', {
            reactive: false,
            can_focus: false,
        });
        this._statusLabel = new St.Label({
            text: '',
            x_expand: true,
        });
        this._statusItem.add_child(this._statusLabel);
        this.menu.addMenuItem(this._statusItem);

        this.menu.addAction(_('Refresh now'),
            () => this._scraper.refreshNow());
        this.menu.addAction(_('Open ollama.com/settings'),
            () => Gio.AppInfo.launch_default_for_uri(
                'https://ollama.com/settings', null));

        this.menu.connect('open-state-changed', (_m, isOpen) => {
            if (isOpen)
                this._scraper.refreshNow();
        });
    }

    _clearBin(bin) {
        bin.get_children().forEach(c => c.destroy());
    }

    _populateQuota(bin, title, bar, detailText) {
        this._clearBin(bin);
        const row = new St.BoxLayout({x_expand: true});
        const label = new St.Label({text: title, x_expand: true});
        const right = new St.Label({text: detailText});
        row.add_child(label);
        row.add_child(right);
        bin.add_child(row);
        bin.add_child(bar.actor);
    }

    _refresh() {
        const data = this._scraper.data;
        this._icon.icon_name = 'dialog-face-smile-symbolic';

        if (!data) {
            this._label.set_text('—');
            this._clearBin(this._headerBin);
            this._headerBin.add_child(new St.Label({
                text: _('Loading usage…'),
            }));
            return;
        }

        const showWeekly = this._settings.get_boolean('show-weekly-bar');
        const sessionPct = data.session_pct ?? 0;
        const weeklyPct = data.weekly_pct;

        // Top-bar label
        if (showWeekly && weeklyPct != null) {
            this._label.set_text(
                `${Math.round(sessionPct)}% / ${Math.round(weeklyPct)}%`);
        } else {
            this._label.set_text(`${Math.round(sessionPct)}%`);
        }

        // Header
        this._clearBin(this._headerBin);
        const fetched = data.fetched_at
            ? _('Last updated ') + formatRelativeTime(data.fetched_at)
            : '';
        this._headerBin.add_child(new St.Label({text: fetched}));

        // Session row
        const sessionBar = new Bar({
            width: 28,
            pct: sessionPct,
            color: paceColor(sessionPct, data.session_resets_at, 5 * 3600),
        });
        const sessionDetail = `${sessionPct.toFixed(1)}%` +
            (data.session_resets_at ? `  ⟳  ${formatCountdown(data.session_resets_at)}` : '');
        this._populateQuota(this._sessionBin, _('Session (5h)'), sessionBar, sessionDetail);

        // Weekly row
        const weeklyBar = new Bar({
            width: 28,
            pct: weeklyPct ?? 0,
            color: paceColor(weeklyPct ?? 0, data.weekly_resets_at, 7 * 86400),
        });
        const weeklyDetail = weeklyPct != null
            ? `${weeklyPct.toFixed(1)}%` +
              (data.weekly_resets_at ? `  ⟳  ${formatCountdown(data.weekly_resets_at)}` : '')
            : '—';
        this._populateQuota(this._weeklyBin, _('Weekly (7d)'), weeklyBar, weeklyDetail);

        this._statusLabel.set_text(data.browser ? _('Source: ') + data.browser : '');
    }

    _showError(err) {
        const message = err?.error ?? _('Unknown error');
        const hint = err?.hint ? `\n${err.hint}` : '';
        this._clearBin(this._headerBin);
        this._headerBin.add_child(new St.Label({
            text: message + hint,
            x_expand: true,
        }));
        this._label.set_text('!');
        this._icon.icon_name = 'dialog-warning-symbolic';
        this._statusLabel.set_text(_('Open the menu for details'));
    }

    destroy() {
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }
        this._scraper.destroy();
        super.destroy();
    }
});

// ---------------------------------------------------------------------------
// Pace colour, identical in spirit to the pi version
// ---------------------------------------------------------------------------

function paceColor(pct, resetsAt, windowSec) {
    if (!resetsAt)
        return 'accent';
    const now = Date.now();
    const reset = new Date(resetsAt).getTime();
    const elapsed = Math.min(Math.max(now - (reset - windowSec * 1000), 0), windowSec * 1000);
    if (elapsed < 60_000)
        return 'accent'; // too early to judge
    const elapsedPct = (elapsed / (windowSec * 1000)) * 100;
    const delta = pct - elapsedPct;
    if (delta > 5)
        return 'error';
    if (delta > 2)
        return 'warning';
    if (delta < -2)
        return 'success';
    return 'accent';
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

function formatCountdown(iso) {
    const secs = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 1000));
    if (secs === 0)
        return _('resetting');
    if (secs < 3600) {
        const m = Math.floor(secs / 60);
        return _('%dm').format(m);
    }
    if (secs < 86400) {
        const h = Math.floor(secs / 3600);
        const m = Math.floor((secs % 3600) / 60);
        return m > 0 ? _('%dh%dm').format(h, m) : _('%dh').format(h);
    }
    const d = Math.floor(secs / 86400);
    const h = Math.floor((secs % 86400) / 3600);
    return h > 0 ? _('%dd%dh').format(d, h) : _('%dd').format(d);
}

function formatRelativeTime(iso) {
    const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (secs < 5)
        return _('just now');
    if (secs < 60)
        return _('%ds ago').format(secs);
    if (secs < 3600)
        return _('%dm ago').format(Math.floor(secs / 60));
    return _('%dh ago').format(Math.floor(secs / 3600));
}

// ---------------------------------------------------------------------------
// Extension entry
// ---------------------------------------------------------------------------

export default class OllamaCloudUsageExtension extends Extension {
    enable() {
        this._indicator = new Indicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}
