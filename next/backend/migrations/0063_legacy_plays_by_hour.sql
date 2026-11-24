-- Legacy production's dated plays (public.track_plays), now counted per
-- track per UTC hour so the stats page can draw 3- and 6-hour bars. Replaces
-- legacy_play_days; scripts/import_legacy_plays fills it whole on each run.
-- next's own counted play_receipts never overlap these: each play was
-- counted by one service.
CREATE TABLE plyr_index.legacy_play_hours (
    record_uri TEXT NOT NULL,
    hour TIMESTAMPTZ NOT NULL CHECK (hour = date_trunc('hour', hour)),
    plays BIGINT NOT NULL CHECK (plays > 0),
    PRIMARY KEY (record_uri, hour)
);

CREATE INDEX legacy_play_hours_hour ON plyr_index.legacy_play_hours (hour);

DROP TABLE plyr_index.legacy_play_days;

DO $grants$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plyr_zig_canary') THEN
        GRANT SELECT ON plyr_index.legacy_play_hours TO plyr_zig_canary;
    END IF;
END
$grants$;
