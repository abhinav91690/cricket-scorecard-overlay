-- One row per page load that reached a live match, updated in place by a 5-minute ping, so
-- session length becomes `last_seen - first_seen`.
--
-- 🛑 Why a separate table and an UPSERT, not rows in `events`. A ping every 5 minutes for a
-- 3-hour stream is 36 events; across a weekend of 57 loads that is ~2,000 rows whose only
-- purpose is to move one timestamp forward. Updating one row per session keeps the table at
-- one row per load (57 a weekend, ~0.7 MB a year) and makes the duration query trivial.
--
-- ⚠ `session_id` is generated fresh on every page load and is never persisted client-side.
-- It groups the pings of ONE load and nothing more: it cannot join two loads, the same
-- operator across days, or anything to a person. That keeps the property the `visitor` hash
-- in 0001 was designed for — see analytics.md §5.
--
-- `events` is untouched: `overlay_start` still inserts there exactly as before, so every
-- existing query and the whole load-count history keep working.
CREATE TABLE IF NOT EXISTS sessions (
    session_id     TEXT PRIMARY KEY,
    first_seen     TEXT NOT NULL,   -- ISO-8601 UTC, set on the first event of the load
    last_seen      TEXT NOT NULL,   -- ISO-8601 UTC, moved forward by each ping
    day            TEXT NOT NULL,   -- YYYY-MM-DD of first_seen, for cheap grouping
    pings          INTEGER NOT NULL DEFAULT 0,

    -- overlay context, copied from the load so a session needs no join to be useful
    club_id        TEXT,
    match_id       TEXT,
    theme          TEXT,

    -- client
    client         TEXT,
    client_version TEXT,
    os             TEXT,
    screen         TEXT,

    -- request metadata from Cloudflare
    country        TEXT,
    city           TEXT,
    visitor        TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_day    ON sessions (day);
CREATE INDEX IF NOT EXISTS idx_sessions_match  ON sessions (club_id, match_id);
