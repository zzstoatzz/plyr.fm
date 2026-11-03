-- converted from alembic revision d71a2c9e4f83 (add_verified_like_projection) on codex/zig-backend

CREATE TABLE plyr_index.like_records (
    record_uri TEXT NOT NULL, 
    record_cid TEXT, 
    owner_did TEXT NOT NULL, 
    collection TEXT NOT NULL, 
    rkey TEXT NOT NULL, 
    subject_uri TEXT, 
    subject_cid TEXT, 
    record_created_at TEXT, 
    deleted BOOLEAN NOT NULL, 
    commit_cid TEXT NOT NULL, 
    commit_rev TEXT NOT NULL, 
    indexed_at_us BIGINT NOT NULL, 
    PRIMARY KEY (record_uri), 
    CONSTRAINT ck_like_records_identity CHECK (record_uri = 'at://' || owner_did || '/' || collection || '/' || rkey), 
    CONSTRAINT ck_like_records_indexed_at CHECK (indexed_at_us >= 0), 
    CONSTRAINT ck_like_records_live_or_tombstone CHECK ((deleted AND record_cid IS NULL AND subject_uri IS NULL AND subject_cid IS NULL AND record_created_at IS NULL) OR (NOT deleted AND record_cid IS NOT NULL AND subject_uri IS NOT NULL AND subject_cid IS NOT NULL AND record_created_at IS NOT NULL))
);

CREATE INDEX ix_like_records_subject_live ON plyr_index.like_records (subject_uri) WHERE NOT deleted;

CREATE INDEX ix_like_records_owner_live ON plyr_index.like_records (owner_did, record_created_at DESC, record_uri DESC) WHERE NOT deleted;
