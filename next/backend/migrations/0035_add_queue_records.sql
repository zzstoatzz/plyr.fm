CREATE SCHEMA plyr_playback;

CREATE TABLE plyr_playback.queue_records (
    owner_did TEXT PRIMARY KEY CHECK (owner_did LIKE 'did:%' AND length(owner_did) <= 512),
    epoch TEXT NOT NULL CHECK (length(epoch) BETWEEN 1 AND 128),
    revision BIGINT NOT NULL CHECK (revision >= 0),
    state JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
