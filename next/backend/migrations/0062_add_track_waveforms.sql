-- How loud each part of a track is over time, measured from its public audio
-- by internal/delivery/waveform_probe.zig, the only writer. Clients draw the
-- playing bars from it. `levels` holds `bands` bytes per frame at `fps`
-- frames a second, frame after frame, 0 silent to 255 the band's loudest.
--
-- Derived from public audio, not from records, so replay doesn't rebuild it.
-- Recovery: none needed. A lost row is measured again on the next sweep.
CREATE TABLE IF NOT EXISTS plyr_index.track_waveforms (
    record_uri TEXT PRIMARY KEY,
    record_cid TEXT NOT NULL,
    -- null until a measurement succeeds
    fps SMALLINT,
    bands SMALLINT,
    levels BYTEA,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_us BIGINT NOT NULL DEFAULT 0,
    last_error TEXT,
    observed_at_us BIGINT NOT NULL,
    CONSTRAINT ck_track_waveforms_values CHECK (
        ((fps IS NULL AND bands IS NULL AND levels IS NULL)
            OR (fps BETWEEN 1 AND 60 AND bands BETWEEN 1 AND 16
                AND length(levels) BETWEEN 1 AND 1048576 AND length(levels) % bands = 0))
        AND attempts >= 0 AND next_attempt_us >= 0 AND observed_at_us >= 0
        AND (last_error IS NULL OR length(last_error) BETWEEN 1 AND 255)
    )
);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plyr_zig_canary') THEN
        GRANT SELECT ON plyr_index.track_waveforms TO plyr_zig_canary;
    END IF;
END
$$;
