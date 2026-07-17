// Test the ollama.com/settings HTML parser. The regexes here mirror
// the ones inside scraper.js so we can exercise the parser without
// pulling in the rest of the GObject/GLib/Soup machinery.

const USAGE_REGEX = /aria-label="(Session|Weekly) usage (\d+(?:\.\d+)?)%/g;
const TIME_REGEX = /data-time="([^"]+)"/g;
const TESTID_REGEX = /data-testid="(session|weekly)-usage"[^>]*>\s*(\d+(?:\.\d+)?)\s*%/g;

function parse(html) {
    const result = {fetched_at: new Date().toISOString(), browser: 'test'};
    let m;
    while ((m = USAGE_REGEX.exec(html)) !== null) {
        const window = m[1].toLowerCase();
        const pct = parseFloat(m[2]);
        if (window === 'session')
            result.session_pct = pct;
        else if (window === 'weekly')
            result.weekly_pct = pct;
    }
    if (result.session_pct == null && result.weekly_pct == null) {
        while ((m = TESTID_REGEX.exec(html)) !== null) {
            const window = m[1].toLowerCase();
            const pct = parseFloat(m[2]);
            if (window === 'session')
                result.session_pct = pct;
            else if (window === 'weekly')
                result.weekly_pct = pct;
        }
    }
    const timestamps = [];
    while ((m = TIME_REGEX.exec(html)) !== null)
        timestamps.push(m[1]);
    if (timestamps[0] && result.session_pct != null)
        result.session_resets_at = timestamps[0];
    if (timestamps[1] && result.weekly_pct != null)
        result.weekly_resets_at = timestamps[1];
    if (timestamps.length === 1 && result.session_pct == null && result.weekly_pct != null)
        result.weekly_resets_at = timestamps[0];
    if (result.session_pct == null && result.weekly_pct == null)
        return null;
    return result;
}

const html = `
<div class="quota">
  <div class="session" aria-label="Session usage 34.2%" data-time="2026-07-17T05:00:00Z">34.2%</div>
  <div class="weekly" aria-label="Weekly usage 45.8%" data-time="2026-07-20T12:00:00Z">45.8%</div>
</div>
`;

const result = parse(html);
if (result.session_pct !== 34.2)
    throw new Error(`session_pct: ${result.session_pct}`);
if (result.weekly_pct !== 45.8)
    throw new Error(`weekly_pct: ${result.weekly_pct}`);
if (result.session_resets_at !== '2026-07-17T05:00:00Z')
    throw new Error(`session_resets_at: ${result.session_resets_at}`);
if (result.weekly_resets_at !== '2026-07-20T12:00:00Z')
    throw new Error(`weekly_resets_at: ${result.weekly_resets_at}`);

// Fallback layout: only one timestamp, only weekly percentage
const html2 = `
<div class="quota">
  <div data-testid="weekly-usage">45.8%</div>
  <span data-time="2026-07-20T12:00:00Z"></span>
</div>
`;
const r2 = parse(html2);
if (!r2 || r2.weekly_pct !== 45.8)
    throw new Error(`fallback weekly_pct: ${r2?.weekly_pct}`);

print('OK: HTML parser extracts percentages and reset timestamps');
