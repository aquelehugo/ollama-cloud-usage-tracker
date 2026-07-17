// Round-trip v11 cookie decryption.
//
// v11 layout: 16-byte AES-CBC encrypted block. Inside the encrypted
// block: "NNN:" (ASCII length) + 12 random bytes + the actual
// plaintext (PKCS#7 padded). After decryption we strip the prefix.
//
// We construct a v11 blob by:
//   1. Build plaintext of exactly 16 bytes so a single AES block
//      contains it (with PKCS#7 padding the payload is 16 bytes which
//      makes the AES output 32 bytes).
//   2. Prepend the v11 ASCII length header.
//   3. Pad to 16-byte multiple, encrypt with openssl.
//   4. Prepend "v11" to the ciphertext.

import {deriveChromeV11Key, decryptChromeCookie} from '../crypto.js';
import GLib from 'gi://GLib';

const PASSWORD = 'peanuts';
const PLAINTEXT_RAW = 'sess=ABCD1234';
const PLAINTEXT = new TextEncoder().encode(PLAINTEXT_RAW);

const {key, iv} = await deriveChromeV11Key(PASSWORD);
const keyHex = Array.from(key).map(b => b.toString(16).padStart(2, '0')).join('');
const ivHex = Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join('');

// Build the unencrypted v11 inner block: "NNN:" + 12 random + plaintext
// PKCS#7 padded.
function pkcs7(buf) {
    const padLen = 16 - (buf.length % 16);
    const pad = new Uint8Array(padLen);
    pad.fill(padLen);
    const out = new Uint8Array(buf.length + padLen);
    out.set(buf, 0);
    out.set(pad, buf.length);
    return out;
}

const header = new TextEncoder().encode(`${PLAINTEXT.length}:`);
const random12 = new Uint8Array(12);
for (let i = 0; i < 12; i++) random12[i] = (i * 31 + 7) & 0xff;
const inner = new Uint8Array(header.length + 12 + PLAINTEXT.length);
inner.set(header, 0);
inner.set(random12, header.length);
inner.set(PLAINTEXT, header.length + 12);
const padded = pkcs7(inner);

// Encrypt
const tmp = '/tmp/ollama-usage-test-v11-plain.bin';
const enc = '/tmp/ollama-usage-test-v11-cipher.bin';
GLib.file_set_contents(tmp, padded);
const r = GLib.spawn_sync(null, ['openssl', 'enc', '-aes-128-cbc',
    '-K', keyHex, '-iv', ivHex,
    '-in', tmp, '-out', enc, '-nopad'],
    null, GLib.SpawnFlags.SEARCH_PATH, null);
const status = r[3];
if (status !== 0)
    throw new Error('openssl encryption failed');

const cipher = GLib.file_get_contents(enc)[1];
GLib.unlink(tmp);
GLib.unlink(enc);

// Build v11 blob
const blob = new Uint8Array(3 + cipher.length);
blob[0] = 0x76; blob[1] = 0x31; blob[2] = 0x31;
blob.set(cipher, 3);

const out = await decryptChromeCookie(blob, PASSWORD);
if (!out)
    throw new Error('v11 decrypt returned null');
const text = new TextDecoder('utf-8').decode(out);
if (text !== PLAINTEXT_RAW)
    throw new Error(`v11 mismatch: ${text} !== ${PLAINTEXT_RAW}`);
print('OK: v11 round-trip ("' + text + '")');
