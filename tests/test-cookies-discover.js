// End-to-end test for the SQLite plumbing in cookies.js. We can't
// import the private readSqliteQuery helper (it's not exported), so
// we inline a Python-driven query that mirrors the production path
// and verify the encrypted blob comes back as a base16 string.

import GLib from 'gi://GLib';

const SAMPLE = '/tmp/test-cookies-e2e.db';
GLib.spawn_sync(null, ['rm', '-f', SAMPLE], null, GLib.SpawnFlags.SEARCH_PATH, null);
GLib.spawn_sync(null, ['sh', '-c', `python3 -c "
import sqlite3
c = sqlite3.connect('${SAMPLE}')
c.execute('CREATE TABLE cookies (name TEXT, host_key TEXT, encrypted_value BLOB)')
c.executemany('INSERT INTO cookies VALUES (?, ?, ?)', [
    ('session', 'ollama.com', b'\\x76\\x31\\x30abc'),
    ('_other', 'example.com', b'\\x00\\x01\\x02'),
])
c.commit()
"`], null, GLib.SpawnFlags.SEARCH_PATH, null);

const script = [
    'import sqlite3, json, sys',
    `p = ${JSON.stringify(SAMPLE)}`,
    'try:',
    '  c = sqlite3.connect(f"file:{p}?mode=ro", uri=True)',
    '  cur = c.cursor()',
    "  cur.execute(\"SELECT name, host_key, encrypted_value FROM cookies WHERE host_key IN ('ollama.com', '.ollama.com')\")",
    '  rows = cur.fetchall()',
    '  cols = [d[0] for d in cur.description]',
    '  out = []',
    '  for row in rows:',
    '    out.append({col: (bytes(x).hex() if isinstance(x, (bytes, bytearray, memoryview)) else x) for col, x in zip(cols, row)})',
    '  print(json.dumps(out))',
    'except Exception as e:',
    '  print("ERROR:", e, file=sys.stderr)',
    '  sys.exit(1)',
].join('\n');

const r = GLib.spawn_sync(null, ['python3', '-c', script], null, GLib.SpawnFlags.SEARCH_PATH, null);
if (r[3] !== 0)
    throw new Error('python sqlite read failed: ' + new TextDecoder().decode(r[2]));
const rows = JSON.parse(new TextDecoder('utf-8').decode(r[1]));

if (rows.length !== 1)
    throw new Error(`expected 1 row, got ${rows.length}`);
if (rows[0].name !== 'session')
    throw new Error(`expected session, got ${rows[0].name}`);

// The production code uses the same .hex() approach to serialise bytes.
if (rows[0].encrypted_value !== '763130616263')
    throw new Error(`cipher mismatch: ${rows[0].encrypted_value}`);

GLib.unlink(SAMPLE);
print('OK: sqlite read returns encrypted cookies with correct host filter');
