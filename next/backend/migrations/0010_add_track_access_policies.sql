-- converted from alembic revision d42f8c5b103e (add_track_access_policies) on codex/zig-backend

CREATE TABLE plyr_index.track_policies (
    record_uri TEXT NOT NULL, 
    visibility TEXT, 
    space_uri TEXT, 
    access_write_source TEXT, 
    access_observed_at_us BIGINT, 
    PRIMARY KEY (record_uri), 
    CONSTRAINT ck_track_policies_visibility CHECK (visibility IS NULL OR visibility IN ('public', 'unlisted', 'supporters', 'private')), 
    CONSTRAINT ck_track_policies_access_shape CHECK ((visibility IS NULL AND space_uri IS NULL AND access_write_source IS NULL AND access_observed_at_us IS NULL) OR (visibility IS NOT NULL AND ((visibility = 'private') = (space_uri IS NOT NULL)) AND access_write_source IN ('legacy_import', 'local_command') AND access_observed_at_us >= 0))
);

INSERT INTO plyr_index.track_policies (
            record_uri, visibility, space_uri,
            access_write_source, access_observed_at_us
        )
        SELECT
            atproto_record_uri,
            visibility,
            space_uri,
            'legacy_import',
            (extract(epoch FROM clock_timestamp()) * 1000000)::bigint
        FROM public.tracks
        WHERE atproto_record_uri IS NOT NULL
          AND atproto_record_uri <> ''
        ON CONFLICT (record_uri) DO NOTHING;
