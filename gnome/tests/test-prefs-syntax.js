// Smoke test for prefs.js syntax.
//
// The prefs.js module imports a resource URI that only exists
// inside the running GNOME Shell. We can't fully load it here,
// but we *can* check that the file parses (i.e. that the brace
// and paren counts are balanced and the module body has no
// stray tokens). The GJS module loader throws SyntaxError on
// import if the body is malformed.

import GLib from 'gi://GLib';

// Resolve prefs.js relative to this test file so the test works
// from any checkout location.
const dir = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);
const path = GLib.build_filenamev([dir, '..', 'prefs.js']);
const r = GLib.file_get_contents(path);
if (!r[0])
    throw new Error('Cannot read prefs.js');
const src = new TextDecoder('utf-8').decode(r[1]);

let p = 0, b = 0, s = 0;
for (const c of src) {
    if (c === '(') p++;
    else if (c === ')') p--;
    else if (c === '{') b++;
    else if (c === '}') b--;
    else if (c === '[') s++;
    else if (c === ']') s--;
}
print('parens:', p, ' braces:', b, ' brackets:', s);
if (p !== 0 || b !== 0 || s !== 0)
    throw new Error('Brace/paren/bracket imbalance');
if (!src.includes('export default class OllamaCloudUsagePrefs'))
    throw new Error('Missing exported class');
if (src.trimEnd().endsWith('})'))
    throw new Error('File still ends with `})` — looks like a stray close');

print('OK: prefs.js has balanced syntax and exports the right class');
