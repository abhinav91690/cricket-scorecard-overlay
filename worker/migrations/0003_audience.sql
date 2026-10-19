-- Who is behind a load, as far as can be told without identifying anyone. → docs/analytics.md §3
--
-- From Cloudflare's request metadata: `asn` / `asn_org` name the network ("Sri Lanka Telecom",
-- "Hetzner"), which separates a home connection from a server restreaming the overlay.
-- From the page: `timezone` and `language` as the browser reports them, `app` when the user
-- agent names an in-app WebView, `viewport` (the drawn size, not the screen's), and `source`,
-- the HOST ONLY of the page that linked here — never its path or query.
--
-- ⚠ Columns are added, never backfilled: rows before this migration read NULL, and the stats
-- page's audience section filters on these columns so old rows do not show as "unknown".
ALTER TABLE events ADD COLUMN asn      INTEGER;
ALTER TABLE events ADD COLUMN asn_org  TEXT;
ALTER TABLE events ADD COLUMN timezone TEXT;
ALTER TABLE events ADD COLUMN language TEXT;
ALTER TABLE events ADD COLUMN app      TEXT;
ALTER TABLE events ADD COLUMN viewport TEXT;
ALTER TABLE events ADD COLUMN source   TEXT;

ALTER TABLE sessions ADD COLUMN asn_org  TEXT;
ALTER TABLE sessions ADD COLUMN timezone TEXT;
ALTER TABLE sessions ADD COLUMN language TEXT;
ALTER TABLE sessions ADD COLUMN app      TEXT;
ALTER TABLE sessions ADD COLUMN viewport TEXT;
