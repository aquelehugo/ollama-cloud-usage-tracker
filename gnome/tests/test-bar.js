// Smoke-test bar.js outside of GNOME Shell. With the right
// TYELIB_PATH set, this loads St and Clutter and verifies the
// Bar widget initialises without throwing.

import {Bar} from '../bar.js';

const b = new Bar({width: 16, pct: 50, color: 'success'});
print('Bar created: cells =', b.cells, 'pct =', b.pct, 'color =', b.color_name);
print('actor getter:', b.actor === b);

b.pct = 75;
print('after pct = 75:', b.pct);

b.color_name = 'error';
print('after color = error:', b.color_name);

b.cells = 32;
print('after cells = 32:', b.cells);

print('OK: Bar widget construct and properties work');
