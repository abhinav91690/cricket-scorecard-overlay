-- One row per client-side event. No personal data: `visitor` is a salted hash of
-- IP + user agent + day, so it only counts distinct viewers within a single day.
CREATE TABLE IF NOT EXISTS events (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    ts             TEXT NOT NULL,   -- ISO-8601 UTC
    day            TEXT NOT NULL,   -- YYYY-MM-DD, for cheap grouping
    event          TEXT NOT NULL,   -- overlay_start | home_view | link_stream_submit

    -- overlay context
    club_id        TEXT,
    match_id       TEXT,
    theme          TEXT,
    logo           TEXT,

    -- client
    client         TEXT,            -- obs | vmix | streamlabs | prism | browser
    client_version TEXT,
    os             TEXT,
    screen         TEXT,

    -- link_stream_submit
    video_id       TEXT,
    outcome        TEXT,            -- submitted | invalid_url | popup_blocked | error

    -- request metadata from Cloudflare
    country        TEXT,
    city           TEXT,
    colo           TEXT,
    visitor        TEXT,
    ua             TEXT,
    referer        TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_day        ON events (day);
CREATE INDEX IF NOT EXISTS idx_events_event_day  ON events (event, day);
CREATE INDEX IF NOT EXISTS idx_events_match      ON events (club_id, match_id);
