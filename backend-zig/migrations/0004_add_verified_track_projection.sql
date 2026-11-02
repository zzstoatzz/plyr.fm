-- converted from alembic revision b2e74a19c5d0 (add_verified_track_projection) on codex/zig-backend

CREATE TABLE plyr_index.track_records (
    record_uri TEXT NOT NULL, 
    record_cid TEXT, 
    owner_did TEXT NOT NULL, 
    collection TEXT NOT NULL, 
    rkey TEXT NOT NULL, 
    title TEXT, 
    artist_name TEXT, 
    file_type TEXT, 
    record_created_at TEXT, 
    audio_url TEXT, 
    audio_blob_cid TEXT, 
    audio_blob_media_type TEXT, 
    audio_blob_size BIGINT, 
    album TEXT, 
    duration_seconds BIGINT, 
    featured_dids TEXT[] DEFAULT '{}'::text[] NOT NULL, 
    image_url TEXT, 
    support_gate_type TEXT, 
    description TEXT, 
    self_labels TEXT[] DEFAULT '{}'::text[] NOT NULL, 
    deleted BOOLEAN NOT NULL, 
    commit_cid TEXT NOT NULL, 
    commit_rev TEXT NOT NULL, 
    indexed_at_us BIGINT NOT NULL, 
    PRIMARY KEY (record_uri), 
    CONSTRAINT ck_track_records_canonical_uri CHECK (record_uri = 'at://' || owner_did || '/' || collection || '/' || rkey), 
    CONSTRAINT ck_track_records_tombstone_shape CHECK ((deleted AND record_cid IS NULL AND title IS NULL AND artist_name IS NULL AND file_type IS NULL AND record_created_at IS NULL AND audio_url IS NULL AND audio_blob_cid IS NULL AND cardinality(featured_dids) = 0 AND cardinality(self_labels) = 0) OR (NOT deleted AND record_cid IS NOT NULL AND title IS NOT NULL AND artist_name IS NOT NULL AND file_type IS NOT NULL AND record_created_at IS NOT NULL AND (audio_url IS NOT NULL OR audio_blob_cid IS NOT NULL))), 
    CONSTRAINT ck_track_records_blob_shape CHECK ((audio_blob_cid IS NULL AND audio_blob_media_type IS NULL AND audio_blob_size IS NULL) OR (audio_blob_cid IS NOT NULL AND audio_blob_media_type IS NOT NULL AND audio_blob_size BETWEEN 0 AND 104857600)), 
    CONSTRAINT ck_track_records_duration CHECK (duration_seconds IS NULL OR duration_seconds >= 0), 
    CONSTRAINT ck_track_records_features CHECK (cardinality(featured_dids) <= 10), 
    CONSTRAINT ck_track_records_labels CHECK (cardinality(self_labels) <= 10), 
    CONSTRAINT ck_track_records_indexed_at CHECK (indexed_at_us >= 0), 
    CONSTRAINT uq_track_records_repo_path UNIQUE (owner_did, collection, rkey)
);

CREATE INDEX ix_track_records_owner_created ON plyr_index.track_records (owner_did, record_created_at, record_uri) WHERE NOT deleted;
