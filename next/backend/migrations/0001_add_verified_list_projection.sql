-- converted from alembic revision 6d43f59bca12 (add_verified_list_projection) on codex/zig-backend

CREATE SCHEMA IF NOT EXISTS plyr_index;

CREATE TABLE plyr_index.list_records (
    record_uri TEXT NOT NULL, 
    record_cid TEXT, 
    owner_did TEXT NOT NULL, 
    collection TEXT NOT NULL, 
    rkey TEXT NOT NULL, 
    list_type TEXT, 
    name TEXT, 
    record_created_at TEXT, 
    record_updated_at TEXT, 
    deleted BOOLEAN NOT NULL, 
    commit_cid TEXT NOT NULL, 
    commit_rev TEXT NOT NULL, 
    indexed_at_us BIGINT NOT NULL, 
    PRIMARY KEY (record_uri), 
    CONSTRAINT ck_list_records_canonical_uri CHECK (record_uri = 'at://' || owner_did || '/' || collection || '/' || rkey), 
    CONSTRAINT ck_list_records_tombstone_shape CHECK ((deleted AND record_cid IS NULL AND list_type IS NULL AND record_created_at IS NULL AND record_updated_at IS NULL) OR (NOT deleted AND record_cid IS NOT NULL AND list_type IS NOT NULL AND record_created_at IS NOT NULL)), 
    CONSTRAINT ck_list_records_type CHECK (deleted OR list_type IN ('album', 'playlist', 'liked')), 
    CONSTRAINT ck_list_records_indexed_at CHECK (indexed_at_us >= 0), 
    CONSTRAINT uq_list_records_repo_path UNIQUE (owner_did, collection, rkey)
);

CREATE INDEX ix_list_records_owner_type ON plyr_index.list_records (owner_did, list_type) WHERE NOT deleted;

CREATE TABLE plyr_index.list_members (
    list_uri TEXT NOT NULL, 
    position SMALLINT NOT NULL, 
    track_uri TEXT NOT NULL, 
    track_cid TEXT NOT NULL, 
    CONSTRAINT pk_list_members PRIMARY KEY (list_uri, position), 
    CONSTRAINT ck_list_members_position CHECK (position >= 0), 
    CONSTRAINT fk_list_members_record FOREIGN KEY(list_uri) REFERENCES plyr_index.list_records (record_uri) ON DELETE CASCADE
);

CREATE INDEX ix_list_members_track_uri ON plyr_index.list_members (track_uri);
