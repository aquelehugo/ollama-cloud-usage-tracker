// SPDX-License-Identifier: MIT
//
// Crypto helpers — Chromium Safe Storage NSS key derivation + AES-CBC
// decrypt of cookie values.
//
// Chromium's os_crypt_linux.cc uses PBKDF2-HMAC-SHA1 (v10) or
// PBKDF2-HMAC-SHA256 (v11) to expand the Safe Storage password into
// 16 bytes of key + 16 bytes of IV. Both versions then run AES-128-CBC
// with PKCS#7 padding. v11 prepends an ASCII length header
// ("NNN:") + 12 random bytes inside the encrypted block.
//
// We do:
//   1. PBKDF2 in pure GJS — see ./pbkdf2.js. (WebCrypto is *not* always
//      available in GJS 1.72+ at the time of writing, depending on
//      distribution.)
//   2. AES-CBC via `openssl enc -d -aes-128-cbc`. openssl is essentially
//      universal on GNOME desktops.

import GLib from 'gi://GLib';

import {pbkdf2, PBKDF2_SHA1, PBKDF2_SHA256} from './pbkdf2.js';

// "saltysalt" / "saltsalt" — the salts Chromium uses, defined in
// os_crypt_linux.cc
const SALT_V10 = new Uint8Array([0x73, 0x61, 0x6c, 0x74, 0x79, 0x73, 0x61, 0x6c, 0x74]);
const SALT_V11 = new Uint8Array([0x73, 0x61, 0x6c, 0x74, 0x73, 0x61, 0x6c, 0x74]);
const V10_PREFIX = new Uint8Array([0x76, 0x31, 0x30]);
const V11_PREFIX = new Uint8Array([0x76, 0x31, 0x31]);

export function matchPrefix(buf, prefix) {
    if (buf.length < prefix.length)
        return false;
    for (let i = 0; i < prefix.length; i++)
        if (buf[i] !== prefix[i])
            return false;
    return true;
}

export function isEncryptedCookie(cipher) {
    return matchPrefix(cipher, V10_PREFIX) || matchPrefix(cipher, V11_PREFIX);
}

export async function deriveChromeV10Key(password) {
    const full = pbkdf2(new TextEncoder().encode(password), SALT_V10, 1, 32, PBKDF2_SHA1);
    return {key: full.slice(0, 16), iv: new Uint8Array(16)};
}

export async function deriveChromeV11Key(password) {
    const full = pbkdf2(new TextEncoder().encode(password), SALT_V11, 1, 32, PBKDF2_SHA256);
    return {key: full.slice(0, 16), iv: full.slice(16, 32)};
}

function bytesToHex(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i++) {
        const h = bytes[i].toString(16);
        out += h.length === 1 ? '0' + h : h;
    }
    return out;
}

function unpadPKCS7(buf) {
    if (buf.length === 0)
        return null;
    // AES-CBC with no padding produces output whose last byte is anything
    // 0..255. If it doesn't look like a valid pad (1..16), return the
    // buffer unchanged — Chromium's v10 cookies are stored without
    // PKCS#7 padding, so we just return the raw plaintext.
    const pad = buf[buf.length - 1];
    if (pad < 1 || pad > 16)
        return buf;
    for (let i = 0; i < pad; i++)
        if (buf[buf.length - 1 - i] !== pad)
            return buf;
    return buf.slice(0, buf.length - pad);
}

/** Decrypt AES-128-CBC with PKCS#7 padding via openssl. */
function aesCbcDecrypt(cipherBuf, key, iv) {
    const keyHex = bytesToHex(key);
    const ivHex = bytesToHex(iv);

    const tmpIn = `${GLib.get_tmp_dir()}/ollama-usage-in-${GLib.get_monotonic_time()}.bin`;
    const tmpOut = `${GLib.get_tmp_dir()}/ollama-usage-out-${GLib.get_monotonic_time()}.bin`;
    if (!GLib.file_set_contents(tmpIn, cipherBuf))
        return Promise.reject(new Error('Failed to write tmp file'));

    return new Promise((resolve, reject) => {
        const r = GLib.spawn_sync(
            null,
            ['openssl', 'enc', '-d', '-aes-128-cbc', '-nopad',
                '-K', keyHex, '-iv', ivHex,
                '-in', tmpIn,
                '-out', tmpOut],
            null,
            GLib.SpawnFlags.SEARCH_PATH,
            null,
        );
        // GJS bind of GLib.spawn_sync returns [ok, stdout, stderr, status].
        // OpenSSL writes binary output via -out and the stdout pipe from
        // the parent process — capturing it as a separate pipe is fragile
        // (it occasionally returns 0 bytes). We use -out to a temp file.
        try { GLib.unlink(tmpIn); } catch (e) { /* ignore */ }
        if (!r[0] || r[3] !== 0) {
            try { GLib.unlink(tmpOut); } catch (e) { /* ignore */ }
            return reject(new Error((r[2] ? new TextDecoder('utf-8').decode(r[2]) : '') || 'openssl failed'));
        }
        const out = GLib.file_get_contents(tmpOut);
        try { GLib.unlink(tmpOut); } catch (e) { /* ignore */ }
        if (!out[0])
            return reject(new Error('openssl output missing'));
        resolve(out[1]);
    });
}

/**
 * Decrypt a Chromium cookie value blob. Returns the plaintext bytes
 * (UTF-8) or null on failure.
 */
export async function decryptChromeCookie(cipher, password) {
    if (cipher.length < 3)
        return new TextDecoder('utf-8').decode(cipher);
    if (!isEncryptedCookie(cipher))
        return new TextDecoder('utf-8').decode(cipher);

    try {
        if (matchPrefix(cipher, V10_PREFIX)) {
            const {key, iv} = await deriveChromeV10Key(password);
            const enc = cipher.slice(3);
            const dec = await aesCbcDecrypt(enc, key, iv);
            return unpadPKCS7(dec);
        }
        if (matchPrefix(cipher, V11_PREFIX)) {
            const {key, iv} = await deriveChromeV11Key(password);
            const enc = cipher.slice(3);
            // v11 layout: AES-CBC(plaintext) → "NNN:" (ASCII length) + 12
            // random bytes + the actual ciphertext (PKCS#7 padded).
            // Decrypt the full block, then strip the prefix.
            const dec = await aesCbcDecrypt(enc, key, iv);
            const unpadded = unpadPKCS7(dec);
            if (!unpadded)
                return null;
            const ascii = new TextDecoder('latin1').decode(unpadded);
            const colon = ascii.indexOf(':');
            if (colon === -1)
                return null;
            const len = parseInt(ascii.slice(0, colon), 10);
            if (!Number.isFinite(len) || len < 0)
                return null;
            return unpadded.slice(colon + 1 + 12);
        }
    } catch (e) {
        return null;
    }
    return null;
}
