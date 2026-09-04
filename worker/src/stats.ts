/** Server-rendered stats page backed by a handful of aggregate queries. */
import type { Env } from './env';

type Row = Record<string, string | number | null>;

const QUERIES = {
    summary: `
        SELECT
            SUM(event = 'overlay_start')                                   AS loads,
            COUNT(DISTINCT CASE WHEN event = 'overlay_start' THEN club_id || '/' || match_id END) AS matches,
            COUNT(DISTINCT CASE WHEN event = 'overlay_start' THEN club_id END) AS clubs,
            COUNT(DISTINCT CASE WHEN event = 'overlay_start' THEN visitor END) AS visitors,
            SUM(event = 'home_view')                                       AS home_views,
            SUM(event = 'link_stream_submit')                              AS link_submits,
            SUM(event = 'link_stream_submit' AND outcome = 'submitted')    AS link_ok
        FROM events WHERE day >= ?1`,
    daily: `
        SELECT day, SUM(event = 'overlay_start') AS loads,
               COUNT(DISTINCT CASE WHEN event = 'overlay_start' THEN club_id || '/' || match_id END) AS matches,
               COUNT(DISTINCT CASE WHEN event = 'overlay_start' THEN visitor END) AS visitors
        FROM events WHERE day >= ?1 GROUP BY day ORDER BY day DESC`,
    matches: `
        SELECT club_id, match_id, COUNT(*) AS loads, COUNT(DISTINCT visitor) AS visitors,
               MIN(ts) AS first_seen, MAX(ts) AS last_seen,
               GROUP_CONCAT(DISTINCT theme) AS themes, GROUP_CONCAT(DISTINCT client) AS clients,
               GROUP_CONCAT(DISTINCT country) AS countries
        FROM events WHERE event = 'overlay_start' AND day >= ?1
        GROUP BY club_id, match_id ORDER BY last_seen DESC LIMIT 100`,
    themes: `
        SELECT COALESCE(theme, '(default)') AS theme, COUNT(*) AS loads
        FROM events WHERE event = 'overlay_start' AND day >= ?1 GROUP BY theme ORDER BY loads DESC`,
    clients: `
        SELECT COALESCE(client, '?') AS client, COALESCE(client_version, '') AS version,
               COALESCE(os, '?') AS os, COALESCE(screen, '?') AS screen, COUNT(*) AS loads
        FROM events WHERE event IN ('overlay_start', 'home_view') AND day >= ?1
        GROUP BY client, client_version, os, screen ORDER BY loads DESC LIMIT 50`,
    countries: `
        SELECT COALESCE(country, '?') AS country, COUNT(*) AS loads, COUNT(DISTINCT visitor) AS visitors
        FROM events WHERE event = 'overlay_start' AND day >= ?1 GROUP BY country ORDER BY loads DESC`,
    links: `
        SELECT ts, club_id, match_id, video_id, outcome, country, client
        FROM events WHERE event = 'link_stream_submit' AND day >= ?1 ORDER BY ts DESC LIMIT 100`,
};

export async function renderStats(env: Env, days: number): Promise<string> {
    const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const names = Object.keys(QUERIES) as (keyof typeof QUERIES)[];
    const results = await env.DB.batch(names.map(n => env.DB.prepare(QUERIES[n]).bind(since)));
    const data = Object.fromEntries(names.map((n, i) => [n, (results[i].results ?? []) as Row[]])) as Record<keyof typeof QUERIES, Row[]>;
    return page(days, data);
}

function esc(value: unknown): string {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function table(rows: Row[], columns: { key: string; label: string; format?: (v: unknown, row: Row) => string }[]): string {
    if (!rows.length) return '<p class="empty">Nothing yet.</p>';
    const head = columns.map(c => `<th>${esc(c.label)}</th>`).join('');
    const body = rows.map(r => `<tr>${columns.map(c => `<td>${c.format ? c.format(r[c.key], r) : esc(r[c.key])}</td>`).join('')}</tr>`).join('');
    return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

const when = (v: unknown) => esc(String(v ?? '').replace('T', ' ').slice(0, 16));
const cricclubs = (_: unknown, r: Row) =>
    `<a href="https://cricclubs.com/CricClubsLiveCP.do?clubId=${esc(r.club_id)}&amp;matchId=${esc(r.match_id)}" target="_blank" rel="noopener">${esc(r.match_id)}</a>`;
const youtube = (v: unknown) => v ? `<a href="https://youtu.be/${esc(v)}" target="_blank" rel="noopener">${esc(v)}</a>` : '';

function page(days: number, d: Record<keyof typeof QUERIES, Row[]>): string {
    const s = d.summary[0] ?? {};
    const stat = (label: string, value: unknown) => `<div class="stat"><div class="n">${esc(value ?? 0)}</div><div class="l">${esc(label)}</div></div>`;
    const range = [7, 30, 90, 365].map(n => n === days ? `<b>${n}d</b>` : `<a href="?days=${n}">${n}d</a>`).join(' · ');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Overlay stats</title>
<style>
 body{margin:0;padding:24px;font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0f1218;color:#e6e8ee}
 h1{margin:0 0 4px;font-size:20px} h2{margin:32px 0 8px;font-size:15px;color:#9aa3b5;text-transform:uppercase;letter-spacing:.06em}
 .range{color:#9aa3b5;margin-bottom:20px} .range a{color:#7aa2ff;text-decoration:none}
 .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px}
 .stat{background:#171c26;border:1px solid #232a38;border-radius:8px;padding:12px 14px}
 .stat .n{font-size:24px;font-weight:600} .stat .l{color:#9aa3b5;font-size:12px}
 table{width:100%;border-collapse:collapse;background:#171c26;border:1px solid #232a38;border-radius:8px;overflow:hidden}
 th,td{padding:7px 10px;text-align:left;border-bottom:1px solid #232a38;white-space:nowrap} th{color:#9aa3b5;font-weight:500;font-size:12px}
 tr:last-child td{border-bottom:0} td:first-child{font-variant-numeric:tabular-nums} a{color:#7aa2ff}
 .wrap{overflow-x:auto} .empty{color:#9aa3b5} .grid2{display:grid;grid-template-columns:1fr 1fr;gap:20px} @media(max-width:800px){.grid2{grid-template-columns:1fr}}
</style></head><body>
<h1>Cricket Scorecard Overlay · usage</h1>
<div class="range">Last ${range}</div>
<div class="stats">
 ${stat('overlay loads', s.loads)} ${stat('matches', s.matches)} ${stat('clubs', s.clubs)} ${stat('viewers (approx)', s.visitors)}
 ${stat('home views', s.home_views)} ${stat('stream links', `${s.link_ok ?? 0} / ${s.link_submits ?? 0}`)}
</div>

<h2>Matches</h2><div class="wrap">${table(d.matches, [
    { key: 'last_seen', label: 'Last seen', format: when }, { key: 'club_id', label: 'Club' }, { key: 'match_id', label: 'Match', format: cricclubs },
    { key: 'loads', label: 'Loads' }, { key: 'visitors', label: 'Viewers' }, { key: 'themes', label: 'Themes' }, { key: 'clients', label: 'Clients' }, { key: 'countries', label: 'Countries' },
])}</div>

<h2>Link Live Stream submissions</h2><div class="wrap">${table(d.links, [
    { key: 'ts', label: 'When', format: when }, { key: 'club_id', label: 'Club' }, { key: 'match_id', label: 'Match', format: cricclubs },
    { key: 'video_id', label: 'YouTube', format: youtube }, { key: 'outcome', label: 'Outcome' }, { key: 'client', label: 'Client' }, { key: 'country', label: 'Country' },
])}</div>

<div class="grid2">
 <div><h2>Clients</h2><div class="wrap">${table(d.clients, [
    { key: 'client', label: 'Client' }, { key: 'version', label: 'Version' }, { key: 'os', label: 'OS' }, { key: 'screen', label: 'Screen' }, { key: 'loads', label: 'Loads' },
 ])}</div></div>
 <div><h2>Themes</h2><div class="wrap">${table(d.themes, [{ key: 'theme', label: 'Theme' }, { key: 'loads', label: 'Loads' }])}</div>
      <h2>Countries</h2><div class="wrap">${table(d.countries, [{ key: 'country', label: 'Country' }, { key: 'loads', label: 'Loads' }, { key: 'visitors', label: 'Viewers' }])}</div></div>
</div>

<h2>By day</h2><div class="wrap">${table(d.daily, [
    { key: 'day', label: 'Day' }, { key: 'loads', label: 'Loads' }, { key: 'matches', label: 'Matches' }, { key: 'visitors', label: 'Viewers' },
])}</div>
</body></html>`;
}
