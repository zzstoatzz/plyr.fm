-- Running times the duration prober measured from a track's audio file, for
-- records that leave `duration` out (prod's early uploads never wrote it).
-- internal/delivery/duration_probe.zig is the only writer. Reads use the
-- record's own duration first and this one only when the record has none,
-- and only while it was measured for the record's current CID.
--
-- Derived from public audio, not from records, so replay doesn't rebuild it.
-- Recovery: none needed. A lost row is measured again on the next sweep.
CREATE TABLE IF NOT EXISTS plyr_index.track_measured_durations (
    record_uri TEXT PRIMARY KEY,
    record_cid TEXT NOT NULL,
    -- null until a measurement succeeds
    duration_seconds BIGINT,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_us BIGINT NOT NULL DEFAULT 0,
    last_error TEXT,
    observed_at_us BIGINT NOT NULL,
    CONSTRAINT ck_track_measured_durations_values CHECK (
        (duration_seconds IS NULL OR duration_seconds BETWEEN 1 AND 172800)
        AND attempts >= 0 AND next_attempt_us >= 0 AND observed_at_us >= 0
        AND (last_error IS NULL OR length(last_error) BETWEEN 1 AND 255)
    )
);
