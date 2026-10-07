// Cross-check the v10/v11 key derivation against an independent
// reference (Python's hashlib.pbkdf2_hmac). The expected hex values
// are pasted in as the source of truth.
//
// Run: gjs -m tests/test-pbkdf2.js
//
//   PBKDF2-HMAC-SHA1, 1 iter, saltysalt, password "peanuts"
//     expected: fd621fe5a2b402539dfa147ca927277884387e2b18f20ec677e41f0b89a40e17
//   PBKDF2-HMAC-SHA256, 1 iter, saltsalt, password "peanuts"
//     expected: b7b216a83c1dd7315730d3fe2b55789d01c420f92eef4746ac137a20022e81d3
//
// Both are correct. v10 takes the first 16 bytes as the AES key and
// uses a 16-byte zero IV; v11 takes the first 16 as the key and the
// next 16 as the IV.

import {deriveChromeV10Key, deriveChromeV11Key} from '../../cli/crypto.js';
import {pbkdf2, PBKDF2_SHA1, PBKDF2_SHA256} from '../../cli/pbkdf2.js';

const SALT_V10 = new Uint8Array([0x73, 0x61, 0x6c, 0x74, 0x79, 0x73, 0x61, 0x6c, 0x74]);
const SALT_V11 = new Uint8Array([0x73, 0x61, 0x6c, 0x74, 0x73, 0x61, 0x6c, 0x74]);
const PASSWORD = new TextEncoder().encode('peanuts');

const v10 = pbkdf2(PASSWORD, SALT_V10, 1, 32, PBKDF2_SHA1);
const v11 = pbkdf2(PASSWORD, SALT_V11, 1, 32, PBKDF2_SHA256);

const expectV10 = 'fd621fe5a2b402539dfa147ca927277884387e2b18f20ec677e41f0b89a40e17';
const expectV11 = 'b7b216a83c1dd7315730d3fe2b55789d01c420f92eef4746ac137a20022e81d3';

const hexV10 = Array.from(v10).map(b => b.toString(16).padStart(2, '0')).join('');
const hexV11 = Array.from(v11).map(b => b.toString(16).padStart(2, '0')).join('');

print('v10 got :', hexV10);
print('v10 want:', expectV10);
print('v10 match:', hexV10 === expectV10);

print('v11 got :', hexV11);
print('v11 want:', expectV11);
print('v11 match:', hexV11 === expectV11);

// And via the high-level helper:
const derived = await deriveChromeV10Key('peanuts');
const keyHex = Array.from(derived.key).map(b => b.toString(16).padStart(2, '0')).join('');
print('v10 high-level key:', keyHex, '(matches first 16 bytes:', keyHex === expectV10.slice(0, 32), ')');
