// SPDX-License-Identifier: MIT
//
// Cookie extraction for ollama.com from a local browser.
//
// Strategy:
//   Chromium-based (chrome, chromium, zen, brave, edge, …):
//     1. Find the cookie database (Cookies under
//        ~/.config/<vendor>/<profile>/).
//     2. Get the Safe Storage password from libsecret using
//        schema `chrome_libsecret_os_crypt_password_v2` (or v1). If
//        the schema is missing, fall back to "peanuts" — the default
//        v10 password on most Linux systems.
//     3. Hand the encrypted value blobs to ./crypto.js for AES-CBC
//        decryption (PBKDF2 in pure JS, AES via `openssl enc`).
//
//   Firefox / Zen (Firefox core):
//     1. Cookies are stored unencrypted in cookies.sqlite on Linux
//        (the Mozilla default is an empty master password), so no NSS
//        unwrapping is required. The browser holds a write lock on
//        the file, so we work from a temp copy.
//
// The source is selected by the `preferred-browser` GSettings value
// ("auto" tries Chrome → Zen → Firefox) or a hard override.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Secret from 'gi://Secret';

import {decryptChromeCookie} from './crypto.js';

const BROWSER_PATHS = {
    chrome: ['google-chrome', 'chromium', 'BraveSoftware/Brave-Browser', 'microsoft-edge'],
    // Zen is a Firefox-based browser that lives in `~/.zen/` on Linux
    // (not `~/.config/zen/` like the upstream Firefox profile layout).
    // It stores its cookies in `cookies.sqlite` inside each profile.
    zen: ['zen', 'zen/Profiles'],
    firefox: ['firefox'],
};

const ERROR = {
    noLogin: () => ({error: 'No ollama.com session',
        hint: 'Log in to ollama.com in your browser, then refresh'}),
    noProfile: () => ({error: 'No browser profile found',
        hint: 'Open a browser and log in to ollama.com, then try again'}),
    locked: () => ({error: 'Keyring locked',
        hint: 'Unlock your keyring (e.g. open Chrome once) and try again'}),
    failed: (m) => ({error: 'Cookie extraction failed',
        hint: m ?? 'See GNOME Shell logs for details'}),
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get cookies for ollama.com as a Cookie header.
 *
 * @param {'auto'|'chrome'|'firefox'|'zen'} preferred
 * @returns {Promise<{header: string, source: string} | {error: string, hint: string}>}
 */
export async function getCookiesForOllama(preferred = 'auto') {
    const order = preferred === 'auto'
        ? ['chrome', 'zen', 'firefox']
        : [preferred, ...['chrome', 'zen', 'firefox'].filter(b => b !== preferred)];

    let lastErr = null;
    for (const name of order) {
        try {
            const r = await loadFromBrowser(name);
            if (r && r.header)
                return r;
            if (r && r.error)
                lastErr = r;
        } catch (e) {
            lastErr = ERROR.failed(e?.message ?? String(e));
        }
    }
    return lastErr ?? ERROR.noProfile();
}

export const CookieError = ERROR;

// ---------------------------------------------------------------------------
// Browser discovery
// ---------------------------------------------------------------------------

function configHome() {
    return GLib.getenv('XDG_CONFIG_HOME') || `${GLib.get_home_dir()}/.config`;
}

function findCookieDbs(prefixes) {
    const base = configHome();
    const out = [];
    for (const p of prefixes) {
        const root = `${base}/${p}`;
        for (const profile of listProfileDirs(root)) {
            out.push(`${root}/${profile}/Cookies`);
        }
    }
    return out.filter(p => GLib.file_test(p, GLib.FileTest.EXISTS));
}

function listProfileDirs(root) {
    const out = ['Default'];
    try {
        const dir = Gio.File.new_for_path(root);
        const en = dir.enumerate_children('standard::name',
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        let info;
        while ((info = en.next_file(null)) != null) {
            const name = info.get_name();
            if (name === 'Default' || /^Profile( \d+)?$/.test(name))
                out.push(name);
        }
        en.close(null);
    } catch (e) {
        // No profiles dir — Default only.
    }
    return Array.from(new Set(out));
}

function findFirefoxCookieDb(name) {
    // Zen (a Firefox-based browser) keeps its profile at `~/.zen/` on
    // Linux rather than under `~/.config/`. Firefox itself is at
    // `~/.config/firefox/`. For Zen we look at the application root
    // first, then the `<root>/Profiles/<name>` subdir; the latter is
    // what the Flatpak layout uses.
    const isZen = name === 'zen';
    const home = GLib.get_home_dir();
    const candidateRoots = isZen
        ? [`${home}/.zen`, ...BROWSER_PATHS.zen.map(p => `${configHome()}/${p}`)]
        : BROWSER_PATHS.firefox.map(p => `${configHome()}/${p}`);

    const collect = (root) => {
        if (!GLib.file_test(root, GLib.FileTest.EXISTS))
            return [];
        const candidates = [];
        const profilesDir = `${root}/Profiles`;
        if (GLib.file_test(profilesDir, GLib.FileTest.EXISTS)) {
            try {
                const profiles = Gio.File.new_for_path(profilesDir);
                const en = profiles.enumerate_children('standard::name',
                    Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
                let info;
                while ((info = en.next_file(null)) != null)
                    candidates.push(`${profilesDir}/${info.get_name()}`);
                en.close(null);
            } catch (e) { /* ignore */ }
        } else {
            // Zen-native: walk the root for profile-like subdirs
            // (anything whose name doesn't match a known config file).
            try {
                const dir = Gio.File.new_for_path(root);
                const en = dir.enumerate_children('standard::name',
                    Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
                const skip = new Set(['Profiles', 'Profile Groups',
                    'Crash Reports', 'Pending Pings',
                    'installs.ini', 'profiles.ini']);
                let info;
                while ((info = en.next_file(null)) != null) {
                    const n = info.get_name();
                    if (skip.has(n))
                        continue;
                    candidates.push(`${root}/${n}`);
                }
                en.close(null);
            } catch (e) { /* ignore */ }
        }
        return candidates
            .map(c => `${c}/cookies.sqlite`)
            .filter(p => GLib.file_test(p, GLib.FileTest.EXISTS));
    };

    for (const root of candidateRoots) {
        const found = collect(root);
        if (found.length > 0)
            return found[0];
    }
    return null;
}

// ---------------------------------------------------------------------------
// Chromium Safe Storage password
// ---------------------------------------------------------------------------

const CHROME_SCHEMAS = [
    'chrome_libsecret_os_crypt_password_v2',
    'chrome_libsecret_os_crypt_password_v1',
    'chrome_libsecret_os_crypt_password',
];

async function getChromeSafeStoragePassword() {
    for (const schemaName of CHROME_SCHEMAS) {
        const schema = new Secret.Schema(schemaName,
            Secret.SchemaFlags.NONE,
            {application: Secret.SchemaAttributeType.STRING});
        try {
            const pw = await Secret.password_lookup(schema,
                {application: 'chrome'}, null);
            if (pw)
                return pw;
        } catch (e) {
            // Schema not registered with this secret service — try the next.
        }
    }
    return 'peanuts';
}

// ---------------------------------------------------------------------------
// SQLite helper — synchronous read of a snapshot copy via Python
// ---------------------------------------------------------------------------

function copyToTemp(path) {
    const source = Gio.File.new_for_path(path);
    if (!source.query_exists(null))
        return null;
    const tmp = `${GLib.get_tmp_dir()}/ollama-usage-cookies-${GLib.get_monotonic_time()}.sqlite`;
    try {
        source.copy(Gio.File.new_for_path(tmp),
            Gio.FileCopyFlags.OVERWRITE, null, null);
        return tmp;
    } catch (e) {
        return null;
    }
}

function readSqliteQuery(dbPath, sql) {
    const script = [
        'import sqlite3, json, sys',
        `p = ${JSON.stringify(dbPath)}`,
        'try:',
        '  c = sqlite3.connect(f"file:{p}?mode=ro", uri=True)',
        '  cur = c.cursor()',
        `  cur.execute(${JSON.stringify(sql)})`,
        '  rows = cur.fetchall()',
        '  cols = [d[0] for d in cur.description] if cur.description else []',
        '  out = []',
        '  for row in rows:',
        '    out.append({col: (bytes(x) if isinstance(x, (bytes, bytearray, memoryview)) else x) for col, x in zip(cols, row)})',
        '  print(json.dumps(out))',
        'except Exception as e:',
        '  print("ERROR:", e, file=sys.stderr)',
        '  sys.exit(1)',
    ].join('\n');

    const r = GLib.spawn_sync(
        null,
        ['python3', '-c', script],
        null,
        GLib.SpawnFlags.SEARCH_PATH,
        null,
    );
    // GJS bind of GLib.spawn_sync returns [ok, stdout, stderr, status]
    // (NOT the C 5-tuple). The first element is a boolean.
    if (!r[0] || r[3] !== 0)
        return null;
    const out = r[1] ? new TextDecoder('utf-8').decode(r[1]).trim() : '';
    if (!out)
        return [];
    try {
        return JSON.parse(out);
    } catch (e) {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Chrome / Chromium / Zen / Edge / Brave loader
// ---------------------------------------------------------------------------

async function loadFromBrowser(name) {
    const isFirefox = name === 'firefox' || name === 'zen';
    if (isFirefox)
        return loadFromFirefox(name);

    const prefixes = BROWSER_PATHS[name] ?? BROWSER_PATHS.chrome;
    const cookieFiles = findCookieDbs(prefixes);
    if (cookieFiles.length === 0)
        return ERROR.noProfile();

    const password = await getChromeSafeStoragePassword();
    if (!password)
        return ERROR.locked();

    for (const cookiePath of cookieFiles) {
        const tmpPath = copyToTemp(cookiePath);
        if (!tmpPath)
            continue;
        try {
            const rows = readSqliteQuery(tmpPath,
                "SELECT name, encrypted_value FROM cookies " +
                "WHERE host_key IN ('ollama.com', '.ollama.com')");
            if (!rows)
                continue;
            const cookies = {};
            for (const row of rows) {
                const cookieName = row.name;
                const cipher = row.encrypted_value;
                if (!cookieName || !cipher)
                    continue;
                const plain = await decryptChromeCookie(toUint8(cipher), password);
                if (plain == null)
                    continue;
                cookies[cookieName] = new TextDecoder('utf-8').decode(plain);
            }
            if (Object.keys(cookies).length > 0) {
                return {
                    header: Object.entries(cookies)
                        .map(([k, v]) => `${k}=${v}`).join('; '),
                    source: friendlyName(name, cookiePath),
                };
            }
        } finally {
            try { GLib.unlink(tmpPath); } catch (e) { /* ignore */ }
        }
    }
    return ERROR.noLogin();
}

function toUint8(value) {
    if (value == null)
        return new Uint8Array(0);
    if (value instanceof Uint8Array)
        return value;
    if (Array.isArray(value))
        return new Uint8Array(value);
    if (typeof value === 'string') {
        const out = new Uint8Array(value.length);
        for (let i = 0; i < value.length; i++)
            out[i] = value.charCodeAt(i) & 0xff;
        return out;
    }
    return new Uint8Array(0);
}

function profileFromPath(cookiePath) {
    // "/home/user/.zen/abc123.def/cookies.sqlite" → "abc123.def"
    // "/home/user/.zen/Profiles/default-release/cookies.sqlite" → "default-release"
    const m = cookiePath.match(/\/([^/]+)\/cookies\.sqlite$/);
    return m ? m[1] : 'profile';
}

function friendlyName(name, path) {
    const m = path.match(/\/([\w-]+)\/(Profile [^/]+|Default|Profile 1)\/Cookies/);
    const profile = m ? m[2] : 'profile';
    if (name === 'chrome') {
        if (path.includes('BraveSoftware'))
            return `Brave/${profile}`;
        if (path.includes('microsoft-edge'))
            return `Edge/${profile}`;
        if (path.includes('chromium'))
            return `Chromium/${profile}`;
        return `Chrome/${profile}`;
    }
    return `${name}/${profile}`;
}

// ---------------------------------------------------------------------------
// Firefox / Zen loader
// ---------------------------------------------------------------------------
//
// Zen is a Firefox-based browser. Both store cookies unencrypted in
// cookies.sqlite on Linux (NSS only encrypts cookie values when the
// user has set a master password — the empty-password default keeps
// them in the clear). The browser holds a write lock on the file, so
// we work from a temp copy.

async function loadFromFirefox(name) {
    // Collect cookies from every Firefox/Zen profile.  A user with
    // Multi-Account Containers (or simply multiple profiles) may have
    // ollama.com session cookies spread across several profiles /
    // containers, so we merge them all.
    const candidates = findAllFirefoxCookieDbs(name);
    const merged = {};
    const sources = [];
    for (const path of candidates) {
        const dbCookies = await readFirefoxCookieDb(path);
        if (dbCookies) {
            Object.assign(merged, dbCookies);
            sources.push(profileFromPath(path));
        }
    }
    if (Object.keys(merged).length === 0)
        return ERROR.noLogin();
    return {
        header: Object.entries(merged)
            .map(([k, v]) => `${k}=${v}`).join('; '),
        source: name === 'zen'
            ? `Zen/${sources.join(',')}`
            : `Firefox/${sources.join(',')}`,
    };
}

/** Find every cookies.sqlite under all Zen/Firefox roots. */
function findAllFirefoxCookieDbs(name) {
    const isZen = name === 'zen';
    const home = GLib.get_home_dir();
    const candidateRoots = isZen
        ? [`${home}/.zen`, ...BROWSER_PATHS.zen.map(p => `${configHome()}/${p}`)]
        : BROWSER_PATHS.firefox.map(p => `${configHome()}/${p}`);
    const out = [];
    const seen = new Set();
    for (const root of candidateRoots) {
        if (!GLib.file_test(root, GLib.FileTest.EXISTS))
            continue;
        const profilesDir = `${root}/Profiles`;
        if (GLib.file_test(profilesDir, GLib.FileTest.EXISTS)) {
            try {
                const profiles = Gio.File.new_for_path(profilesDir);
                const en = profiles.enumerate_children('standard::name',
                    Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
                let info;
                while ((info = en.next_file(null)) != null) {
                    const p = `${profilesDir}/${info.get_name()}/cookies.sqlite`;
                    if (GLib.file_test(p, GLib.FileTest.EXISTS) && !seen.has(p)) {
                        out.push(p);
                        seen.add(p);
                    }
                }
                en.close(null);
            } catch (e) { /* ignore */ }
        } else {
            try {
                const dir = Gio.File.new_for_path(root);
                const en = dir.enumerate_children('standard::name',
                    Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
                const skip = new Set(['Profiles', 'Profile Groups',
                    'Crash Reports', 'Pending Pings',
                    'installs.ini', 'profiles.ini']);
                let info;
                while ((info = en.next_file(null)) != null) {
                    const n = info.get_name();
                    if (skip.has(n))
                        continue;
                    const p = `${root}/${n}/cookies.sqlite`;
                    if (GLib.file_test(p, GLib.FileTest.EXISTS) && !seen.has(p)) {
                        out.push(p);
                        seen.add(p);
                    }
                }
                en.close(null);
            } catch (e) { /* ignore */ }
        }
    }
    return out;
}

/** Read ollama.com cookies from one cookies.sqlite; returns a dict or null. */
async function readFirefoxCookieDb(cookiePath) {
    const tmpPath = copyToTemp(cookiePath);
    if (!tmpPath)
        return null;
    try {
        const rows = readSqliteQuery(tmpPath,
            "SELECT name, value FROM moz_cookies " +
            "WHERE host IN ('ollama.com', '.ollama.com')");
        if (!rows || rows.length === 0)
            return null;
        const cookies = {};
        for (const row of rows) {
            if (row.name && row.value != null)
                cookies[row.name] = String(row.value);
        }
        return Object.keys(cookies).length > 0 ? cookies : null;
    } finally {
        try { GLib.unlink(tmpPath); } catch (e) { /* ignore */ }
    }
}

/** Try one profile; return the {header, source} on success, null on no cookies. */
async function tryFirefoxCookieDb(cookiePath, name) {
    const cookies = await readFirefoxCookieDb(cookiePath);
    if (!cookies)
        return null;
    return {
        header: Object.entries(cookies)
            .map(([k, v]) => `${k}=${v}`).join('; '),
        source: name === 'zen'
            ? `Zen/${profileFromPath(cookiePath)}`
            : `Firefox/${profileFromPath(cookiePath)}`,
    };
}
