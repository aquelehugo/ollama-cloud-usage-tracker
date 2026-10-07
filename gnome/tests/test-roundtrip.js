// End-to-end smoke test for the AES-CBC decrypt path.
//
// Encrypts a known plaintext with the v10 key (32 bytes; uses -nopad
// which requires the input to be a multiple of the cipher block size),
// prepends the "v10" header, and round-trips through
// decryptChromeCookie. The plaintext should come back unchanged.

import {deriveChromeV10Key, decryptChromeCookie} from '../crypto.js';
import GLib from 'gi://GLib';

const PASSWORD = 'peanuts';
const PLAINTEXT_RAW = 'ollama-session=abc123def456';
// Pad to AES block size (16 bytes). Chromium's v10 cookie value is the
// raw plaintext, not PKCS#7 padded, so we don't apply padding here —
// but the encryption must still be a multiple of 16 because we're
// using -nopad.
const PLAINTEXT = new TextEncoder().encode(PLAINTEXT_RAW.padEnd(32, 'x'));

const {key, iv} = await deriveChromeV10Key(PASSWORD);
const keyHex = Array.from(key).map(b => b.toString(16).padStart(2, '0')).join('');
const ivHex = Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join('');

// Encrypt via openssl, write to disk, read back
const tmp = '/tmp/ollama-usage-test-plain.bin';
const enc = '/tmp/ollama-usage-test-cipher.bin';
GLib.file_set_contents(tmp, PLAINTEXT);
const r = GLib.spawn_sync(null, ['openssl', 'enc', '-aes-128-cbc',
    '-K', keyHex, '-iv', ivHex,
    '-in', tmp, '-out', enc, '-nopad'],
    null, GLib.SpawnFlags.SEARCH_PATH, null);
const status = r[3];
const encErr = r[2];
if (status !== 0)
    throw new Error(`openssl encryption failed: ${encErr ? new TextDecoder('utf-8').decode(encErr) : ''}`);

const cipher = GLib.file_get_contents(enc)[1];
GLib.unlink(tmp);
GLib.unlink(enc);

// Build v10-prefixed blob
const blob = new Uint8Array(3 + cipher.length);
blob[0] = 0x76; blob[1] = 0x31; blob[2] = 0x30;
blob.set(cipher, 3);

const out = await decryptChromeCookie(blob, PASSWORD);
if (!out)
    throw new Error('decrypt returned null');
const text = new TextDecoder('utf-8').decode(out);
if (text !== new TextDecoder('utf-8').decode(PLAINTEXT))
    throw new Error(`mismatch: ${text} !== ${new TextDecoder('utf-8').decode(PLAINTEXT)}`);
print('OK: round-trip v10 decryption matches ("' + text + '")');
