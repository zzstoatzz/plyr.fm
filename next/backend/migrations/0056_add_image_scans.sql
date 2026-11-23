-- every cover the Osprey rules worker (next/services/osprey) checked against
-- plyr's image policy, flagged or not, so an edit that keeps the cover isn't
-- paid for twice and a clean result is on record. like plyr_moderation.scans
-- (audio), none of it can be rebuilt from the network.
CREATE TABLE IF NOT EXISTS plyr_moderation.image_scans (
    record_uri TEXT NOT NULL CHECK (record_uri LIKE 'at://%'),
    image_url TEXT NOT NULL CHECK (length(image_url) BETWEEN 1 AND 4096),
    record_cid TEXT NOT NULL,
    violations INTEGER NOT NULL CHECK (violations >= 0),
    scanned_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (record_uri, image_url)
);
