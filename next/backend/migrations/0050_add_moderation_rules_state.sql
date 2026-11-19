-- State for the Osprey rules worker (next/services/osprey), which reads newly
-- indexed tracks and writes flags into plyr_moderation.events. Like the event
-- log, none of this can be rebuilt from the network, so it lives with it.

-- where the worker's walk over plyr_index.track_records has got to, in
-- (indexed_at_us, record_uri) order; attempts counts failed runs on the next
-- track, which is passed over after a few so one bad file can't stall it
CREATE TABLE IF NOT EXISTS plyr_moderation.rule_cursors (
    name TEXT PRIMARY KEY CHECK (length(name) BETWEEN 1 AND 64),
    indexed_at_us BIGINT NOT NULL CHECK (indexed_at_us >= 0),
    record_uri TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- every audio file fingerprinted, flagged or not, so an edit that keeps the
-- audio isn't paid for twice and a clean result is on record
CREATE TABLE IF NOT EXISTS plyr_moderation.scans (
    record_uri TEXT NOT NULL CHECK (record_uri LIKE 'at://%'),
    audio_url TEXT NOT NULL CHECK (length(audio_url) BETWEEN 1 AND 4096),
    record_cid TEXT NOT NULL,
    recordings_found INTEGER NOT NULL CHECK (recordings_found >= 0),
    scanned_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (record_uri, audio_url)
);

-- Osprey's own entity labels (what its rules remember about an account or a
-- track between events); not the signed atproto labels in plyr_moderation.labels
CREATE TABLE IF NOT EXISTS plyr_moderation.osprey_entity_labels (
    entity_key TEXT PRIMARY KEY CHECK (length(entity_key) BETWEEN 1 AND 1024),
    labels JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
