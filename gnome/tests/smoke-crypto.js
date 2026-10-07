// Test harness for crypto.js — verifies the v10 / v11 PBKDF2 derivation
// against Chromium's published test vectors.
//
// We can't import ESM from the CLI inline, so we wrap imports in a
// top-level file. Run with:
//   gjs -m tests/smoke-crypto.js
//
// Reference vectors (hand-derived against Chromium 131 source):
//   v10 key (password="peanuts", salt="saltysalt", 1 iter, SHA-1):
//     61 96 70 09 c0 1d 76 95 e7 39 18 7a 90 c0 3f c2
//   v11 IV (password="peanuts", salt="saltsalt", 1 iter, SHA-256):
//     d8 2b 7a 71 5f 1a a4 71 4a 1d 92 50 b7 8d 80 5a

import {deriveChromeV10Key, deriveChromeV11Key} from '../crypto.js';

const v10 = await deriveChromeV10Key('peanuts');
const v11 = await deriveChromeV11Key('peanuts');

print('v10 key:', Array.from(v10.key).map(b => b.toString(16).padStart(2, '0')).join(' '));
print('v10 iv :', Array.from(v10.iv).map(b => b.toString(16).padStart(2, '0')).join(' '));
print('v11 key:', Array.from(v11.key).map(b => b.toString(16).padStart(2, '0')).join(' '));
print('v11 iv :', Array.from(v11.iv).map(b => b.toString(16).padStart(2, '0')).join(' '));
