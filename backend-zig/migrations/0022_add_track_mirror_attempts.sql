-- Retry bookkeeping for the blob mirror worker, which copies a track record's
-- audio blob from the owner's PDS into the delivery bucket after verifying it
-- against the record's blob CID. One row per record version that failed; a
-- successful mirror lands in track_delivery_origins instead.
CREATE TABLE plyr_index.track_mirror_attempts (
    record_uri TEXT NOT NULL,
    record_cid TEXT NOT NULL,
    attempts INTEGER NOT NULL,
    next_attempt_us BIGINT NOT NULL,
    last_error TEXT NOT NULL,
    PRIMARY KEY (record_uri),
    CONSTRAINT ck_track_mirror_attempts_values CHECK (
        attempts > 0 AND next_attempt_us >= 0 AND length(last_error) BETWEEN 1 AND 255
    )
);
