-- Radio's pinned rotations (internal/radio/postgres_store.zig is the only
-- writer). The first rotation drawn for a (station, size, period) is the one
-- every listener hears for that period, and anchor_us is the instant its loop
-- started, normally when the previous period's last track ended. Pinning in
-- the database rather than in process memory means a deploy or a second api
-- machine can't reshuffle the loop and jump the playhead mid-song.
--
-- Not derived from records and not rebuilt by replay. Recovery: none needed.
-- A lost pin is redrawn on the next request; at worst the playhead jumps once.
-- Rows older than two periods are pruned as new ones are written.

CREATE TABLE plyr_playback.radio_rotations (
    station TEXT NOT NULL CHECK (length(station) BETWEEN 1 AND 64),
    size INTEGER NOT NULL CHECK (size BETWEEN 1 AND 200),
    period BIGINT NOT NULL,
    entries JSONB NOT NULL CHECK (jsonb_typeof(entries) = 'array'),
    anchor_us BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (station, size, period)
);

DO $grants$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plyr_zig_canary') THEN
        GRANT USAGE ON SCHEMA plyr_playback TO plyr_zig_canary;
        GRANT SELECT, INSERT, DELETE ON plyr_playback.radio_rotations TO plyr_zig_canary;
        GRANT UPDATE (anchor_us) ON plyr_playback.radio_rotations TO plyr_zig_canary;
    END IF;
END
$grants$;
