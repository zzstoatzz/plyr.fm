CREATE TABLE plyr_index.legacy_track_tags (
    record_uri text NOT NULL,
    observed_record_cid text NOT NULL,
    tag text NOT NULL,
    source text NOT NULL DEFAULT 'legacy-plyr',
    source_track_id bigint NOT NULL,
    source_observed_at timestamptz NOT NULL,
    imported_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (record_uri, observed_record_cid, tag),
    CONSTRAINT ck_legacy_track_tags_source CHECK (source = 'legacy-plyr'),
    CONSTRAINT ck_legacy_track_tags_tag CHECK (octet_length(tag) BETWEEN 1 AND 50),
    CONSTRAINT ck_legacy_track_tags_source_track CHECK (source_track_id > 0)
);
CREATE INDEX ix_legacy_track_tags_tag ON plyr_index.legacy_track_tags(tag, record_uri, observed_record_cid);
