// Test the ollama.com/settings HTML parser. Imports the parser from
// the shared usage core (../../cli/usage.js — the single source of
// truth also used at runtime by gnome/scraper.js and the CLI), so the
// test exercises exactly the code both surfaces run. usage.js imports
// gi://Soup at module load, which is fine under plain gjs — libsoup3
// is a system library, not part of GNOME Shell.

import {parseUsageHtml} from '../../cli/usage.js';

const html = `
<div class="quota">
  <div class="session" aria-label="Session usage 34.2%" data-time="2026-07-17T05:00:00Z">34.2%</div>
  <div class="weekly" aria-label="Weekly usage 45.8%" data-time="2026-07-20T12:00:00Z">45.8%</div>
</div>
`;

const result = parseUsageHtml(html, 'test');
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
const r2 = parseUsageHtml(html2, 'test');
if (!r2 || r2.weekly_pct !== 45.8)
    throw new Error(`fallback weekly_pct: ${r2?.weekly_pct}`);

print('OK: HTML parser (shared core) extracts percentages and reset timestamps');