// Verifies that the cookies.js module loads and the public API
// returns the expected error shape when no browser is installed.

import {getCookiesForOllama} from '../../cli/cookies.js';

// Force a real attempt by passing 'auto' — with no browser profile
// present, we should get a friendly error object.
const r = await getCookiesForOllama('auto');
print('result:', JSON.stringify(r));

if (r && r.error && r.hint) {
    print('OK: returns { error, hint } shape on no-browser');
} else if (r && r.header) {
    print('OK: returns { header, source } on success (real browser installed)');
    print('   source:', r.source);
} else {
    throw new Error('unexpected shape: ' + JSON.stringify(r));
}
