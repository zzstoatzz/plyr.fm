-- Notifications are a read over the projection (likes on an account's tracks,
-- tracks that feature the account), so the only state they add is how far
-- each account has read. Everything else stays rebuildable from repositories.

CREATE SCHEMA IF NOT EXISTS plyr_account;

CREATE TABLE plyr_account.notification_seen (
    owner_did TEXT PRIMARY KEY CHECK (owner_did LIKE 'did:%' AND length(owner_did) <= 512),
    seen_at_us BIGINT NOT NULL CHECK (seen_at_us >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- "tracks that feature me": array containment, served by GIN
CREATE INDEX ix_track_records_featured_dids
    ON plyr_index.track_records USING gin (featured_dids)
    WHERE NOT deleted;

DO $grants$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plyr_zig_canary') THEN
        GRANT USAGE ON SCHEMA plyr_account TO plyr_zig_canary;
        GRANT SELECT, INSERT, UPDATE ON plyr_account.notification_seen TO plyr_zig_canary;
    END IF;
END
$grants$;
