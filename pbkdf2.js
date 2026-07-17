// SPDX-License-Identifier: MIT
//
// PBKDF2 (RFC 2898) — pure JavaScript, no OpenSSL, no WebCrypto.
//
// Chromium's `os_crypt_linux.cc` derives its AES key with PBKDF2 using
// `saltysalt` (v10) or `saltsalt` (v11) and exactly 1 iteration, then
// takes the first 16 bytes as the key and (for v11) the next 16 as the
// IV. WebCrypto.subtle.deriveBits is the obvious tool but GJS's
// availability of globalThis.crypto varies across distributions; this
// pure-JS implementation works everywhere.
//
// We delegate the SHA-1 and SHA-256 inner hash to GLib.compute_checksum_for_data,
// which is exposed in every GLib since GNOME Shell runs against it. The
// HMAC construction is RFC 2104.

import GLib from 'gi://GLib';

export const PBKDF2_SHA1 = 1;
export const PBKDF2_SHA256 = 2;

const SHA1_BLOCK = 64;
const SHA256_BLOCK = 64;

function hash(buf, variant) {
    const type = variant === PBKDF2_SHA256
        ? GLib.ChecksumType.SHA256
        : GLib.ChecksumType.SHA1;
    // GJS binds GLib.compute_checksum_for_data to (type, data) and
    // returns a hex-encoded string. We convert back to bytes so the
    // rest of the module can operate uniformly.
    const hex = GLib.compute_checksum_for_data(type, buf);
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++)
        out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
}

function hmac(key, msg, variant) {
    const blockSize = variant === PBKDF2_SHA256 ? SHA256_BLOCK : SHA1_BLOCK;
    let k = key;
    if (k.length > blockSize)
        k = hash(k, variant);
    if (k.length < blockSize) {
        const padded = new Uint8Array(blockSize);
        padded.set(k, 0);
        k = padded;
    }
    const opad = new Uint8Array(blockSize);
    const ipad = new Uint8Array(blockSize);
    for (let i = 0; i < blockSize; i++) {
        opad[i] = k[i] ^ 0x5c;
        ipad[i] = k[i] ^ 0x36;
    }
    const inner = hash(concat(ipad, msg), variant);
    return hash(concat(opad, inner), variant);
}

function concat(a, b) {
    const out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
}

/**
 * PBKDF2 key derivation.
 * @param {Uint8Array} password
 * @param {Uint8Array} salt
 * @param {number} iterations
 * @param {number} dkLen  desired key length in bytes
 * @param {number} variant PBKDF2_SHA1 or PBKDF2_SHA256
 * @returns {Uint8Array}
 */
export function pbkdf2(password, salt, iterations, dkLen, variant) {
    const hashLen = variant === PBKDF2_SHA256 ? 32 : 20;
    const blocks = Math.ceil(dkLen / hashLen);
    const out = new Uint8Array(blocks * hashLen);

    for (let i = 1; i <= blocks; i++) {
        const saltI = new Uint8Array(salt.length + 4);
        saltI.set(salt, 0);
        saltI[salt.length] = (i >>> 24) & 0xff;
        saltI[salt.length + 1] = (i >>> 16) & 0xff;
        saltI[salt.length + 2] = (i >>> 8) & 0xff;
        saltI[salt.length + 3] = i & 0xff;

        let u = hmac(password, saltI, variant);
        const t = new Uint8Array(u);
        for (let j = 1; j < iterations; j++) {
            u = hmac(password, u, variant);
            for (let k = 0; k < t.length; k++)
                t[k] ^= u[k];
        }
        out.set(t, (i - 1) * hashLen);
    }
    return out.slice(0, dkLen);
}
