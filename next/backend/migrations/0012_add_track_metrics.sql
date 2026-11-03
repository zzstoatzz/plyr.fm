-- converted from alembic revision f64b0e7d325a (add_track_metrics) on codex/zig-backend

CREATE TABLE plyr_index.track_metrics (
    record_uri TEXT NOT NULL, 
    play_count BIGINT NOT NULL, 
    write_source TEXT NOT NULL, 
    observed_at_us BIGINT NOT NULL, 
    PRIMARY KEY (record_uri), 
    CONSTRAINT ck_track_metrics_play_count CHECK (play_count >= 0), 
    CONSTRAINT ck_track_metrics_write_source CHECK (write_source IN ('legacy_import', 'http_play', 'subsonic_scrobble')), 
    CONSTRAINT ck_track_metrics_observed_at CHECK (observed_at_us >= 0)
);

INSERT INTO plyr_index.track_metrics (
            record_uri, play_count, write_source, observed_at_us
        )
        SELECT
            atproto_record_uri,
            play_count::bigint,
            'legacy_import',
            (extract(epoch FROM clock_timestamp()) * 1000000)::bigint
        FROM public.tracks
        WHERE atproto_record_uri IS NOT NULL
          AND atproto_record_uri <> ''
        ON CONFLICT (record_uri) DO NOTHING;
