-- A moderator's decision on an album or playlist (most often its cover, which
-- the rules worker checks), projected from plyr_moderation.events the way
-- track decisions land on plyr_index.track_policies. `exclude` drops the
-- list from every read; `allow` records that it was looked at and is fine.
CREATE TABLE IF NOT EXISTS plyr_index.list_policies (
    record_uri TEXT PRIMARY KEY CHECK (record_uri LIKE 'at://%'),
    moderation_decision TEXT NOT NULL CHECK (moderation_decision IN ('allow', 'exclude')),
    moderation_write_source TEXT NOT NULL CHECK (moderation_write_source = 'moderation_log'),
    moderation_observed_at_us BIGINT NOT NULL CHECK (moderation_observed_at_us >= 0)
);

DO $grants$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plyr_zig_canary') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON plyr_index.list_policies TO plyr_zig_canary;
    END IF;
END
$grants$;
