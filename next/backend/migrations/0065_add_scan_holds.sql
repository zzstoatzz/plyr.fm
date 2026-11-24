-- Tracks the Osprey rules worker (next/services/osprey) could not fingerprint
-- yet because their account (or everyone together) is out of scan budget for
-- the day (plyr_quota meter 'scan_seconds'). A held track still plays from its
-- artist's page and its own link; feeds, search, radio and charts leave it out
-- until it is scanned and the hold is gone. The worker comes back to a hold
-- once retry_at_us passes. Like the rest of plyr_moderation, it cannot be
-- rebuilt from the network.
CREATE TABLE IF NOT EXISTS plyr_moderation.scan_holds (
    record_uri TEXT PRIMARY KEY CHECK (record_uri LIKE 'at://%'),
    owner_did TEXT NOT NULL CHECK (owner_did LIKE 'did:%'),
    held_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    retry_at_us BIGINT NOT NULL CHECK (retry_at_us >= 0),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0)
);

CREATE INDEX IF NOT EXISTS scan_holds_retry_idx ON plyr_moderation.scan_holds (retry_at_us, held_at);

DO $grants$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plyr_zig_canary') THEN
        GRANT SELECT ON plyr_moderation.scan_holds TO plyr_zig_canary;
    END IF;
END
$grants$;
