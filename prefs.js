// SPDX-License-Identifier: MIT
//
// prefs.js — preferences window for the Ollama Cloud Usage Tracker.
//
// Three GSettings keys are surfaced:
//   - refresh interval (minutes)
//   - preferred browser (auto / chrome / zen / firefox)
//   - show weekly bar in the top panel
//
// We use Adw 1.0 widgets (Adwaita) which is the same libadwaita GNOME
// Shell itself uses for its own preferences; this gives native styling
// with no extra runtime dependencies.

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const BROWSER_LABELS = {
    auto: 'Auto-detect (Chrome → Zen → Firefox)',
    chrome: 'Chrome / Chromium',
    zen: 'Zen',
    firefox: 'Firefox',
};

const BROWSER_KEYS = Object.keys(BROWSER_LABELS);

export default class OllamaCloudUsagePrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window.set_title('Ollama Cloud Usage Tracker');
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: 'General',
            icon_name: 'dialog-face-smile-symbolic',
        });
        window.add(page);

        // Refresh interval
        const refreshGroup = new Adw.PreferencesGroup({
            title: 'Refresh',
            description: 'How often the extension polls ollama.com/settings',
        });
        page.add(refreshGroup);
        const refreshRow = new Adw.SpinRow({
            title: 'Interval (minutes)',
            subtitle: 'Minimum 1',
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 60,
                step_increment: 1,
                page_increment: 5,
                value: settings.get_int('refresh-interval-minutes'),
            }),
        });
        settings.bind('refresh-interval-minutes', refreshRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        refreshGroup.add(refreshRow);

        // Preferred browser
        const browserGroup = new Adw.PreferencesGroup({
            title: 'Browser cookies',
            description: 'Which browser profile to read ollama.com session cookies from',
        });
        page.add(browserGroup);
        const browserList = new Gtk.StringList();
        for (const key of BROWSER_KEYS)
            browserList.append(BROWSER_LABELS[key]);
        const browserRow = new Adw.ComboRow({
            title: 'Preferred browser',
            subtitle: 'Auto tries Chrome, Zen, then Firefox',
            model: browserList,
        });
        // Bind: the row exposes a 0..N-1 selected index; the GSettings key
        // is a string (the browser id). We sync both directions explicitly.
        const setRowFromSettings = () => {
            const v = settings.get_string('preferred-browser');
            const idx = BROWSER_KEYS.indexOf(v);
            browserRow.set_selected(idx >= 0 ? idx : 0);
        };
        setRowFromSettings();
        browserRow.connect('notify::selected', () => {
            const idx = browserRow.get_selected();
            const value = BROWSER_KEYS[idx] ?? 'auto';
            if (settings.get_string('preferred-browser') !== value)
                settings.set_string('preferred-browser', value);
        });
        settings.connect('changed::preferred-browser', setRowFromSettings);
        browserGroup.add(browserRow);

        // Panel layout
        const layoutGroup = new Adw.PreferencesGroup({
            title: 'Top-panel display',
        });
        page.add(layoutGroup);
        const weeklySwitch = new Adw.SwitchRow({
            title: 'Show weekly (7d) bar',
            subtitle: 'Top-panel label becomes "session% / weekly%"',
        });
        settings.bind('show-weekly-bar', weeklySwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        layoutGroup.add(weeklySwitch);

        // Help
        const helpGroup = new Adw.PreferencesGroup({
            title: 'Help',
        });
        page.add(helpGroup);
        helpGroup.add(new Adw.ActionRow({
            title: 'Log in to ollama.com in your browser',
            subtitle: 'The extension reads session cookies from a local browser to fetch your usage.',
        }));
    }
}
