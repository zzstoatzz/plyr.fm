-- The legacy production catalog's dated plays (public.track_plays), counted
-- per track per UTC day, as last imported by scripts/import_legacy_plays.
-- The stats page draws plays over time from these plus next's own counted
-- play_receipts; the two never overlap, since each play was counted by one
-- service. Legacy counted many early plays without a date, so these sum to
-- less than legacy_play_counts. Each import replaces the table whole.
CREATE TABLE plyr_index.legacy_play_days (
    record_uri TEXT NOT NULL,
    day DATE NOT NULL,
    plays BIGINT NOT NULL CHECK (plays > 0),
    PRIMARY KEY (record_uri, day)
);

CREATE INDEX legacy_play_days_day ON plyr_index.legacy_play_days (day);

DO $grants$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plyr_zig_canary') THEN
        GRANT SELECT ON plyr_index.legacy_play_days TO plyr_zig_canary;
    END IF;
END
$grants$;
