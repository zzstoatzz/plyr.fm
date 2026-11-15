-- Timed comments (fm.plyr.comment): an authored record per comment, anchored
-- to a playback position on an exact track version. Like the other record
-- projections it keeps tombstones, so replays and stale writes classify.

CREATE TABLE plyr_index.comment_records (
    record_uri TEXT NOT NULL,
    record_cid TEXT,
    owner_did TEXT NOT NULL,
    collection TEXT NOT NULL,
    rkey TEXT NOT NULL,
    subject_uri TEXT,
    subject_cid TEXT,
    text TEXT,
    timestamp_ms BIGINT,
    record_created_at TEXT,
    record_updated_at TEXT,
    record_created_at_us BIGINT,
    deleted BOOLEAN NOT NULL,
    commit_cid TEXT,
    commit_rev TEXT NOT NULL,
    indexed_at_us BIGINT NOT NULL,
    PRIMARY KEY (record_uri),
    CONSTRAINT ck_comment_records_identity CHECK (record_uri = 'at://' || owner_did || '/' || collection || '/' || rkey),
    CONSTRAINT ck_comment_records_indexed_at CHECK (indexed_at_us >= 0),
    CONSTRAINT ck_comment_records_timestamp CHECK (timestamp_ms IS NULL OR timestamp_ms >= 0),
    CONSTRAINT ck_comment_records_live_or_tombstone CHECK (
        (deleted AND record_cid IS NULL AND subject_uri IS NULL AND subject_cid IS NULL
            AND text IS NULL AND timestamp_ms IS NULL AND record_created_at IS NULL AND record_updated_at IS NULL)
        OR (NOT deleted AND record_cid IS NOT NULL AND subject_uri IS NOT NULL AND subject_cid IS NOT NULL
            AND text IS NOT NULL AND timestamp_ms IS NOT NULL AND record_created_at IS NOT NULL))
);

CREATE TRIGGER comment_records_created_at_us
    BEFORE INSERT OR UPDATE OF record_created_at ON plyr_index.comment_records
    FOR EACH ROW EXECUTE FUNCTION plyr_index.set_record_created_at_us();

-- a track's comments in playback order
CREATE INDEX ix_comment_records_subject_position
    ON plyr_index.comment_records (subject_uri, timestamp_ms, record_created_at_us, record_uri)
    WHERE NOT deleted;

CREATE INDEX ix_comment_records_owner_created_us
    ON plyr_index.comment_records (owner_did, record_created_at_us DESC, record_uri DESC)
    WHERE NOT deleted;
