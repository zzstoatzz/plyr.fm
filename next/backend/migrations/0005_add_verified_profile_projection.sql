-- converted from alembic revision d5a97c8f1e42 (add_verified_profile_projection) on codex/zig-backend

CREATE TABLE plyr_index.profile_records (
    record_uri TEXT NOT NULL, 
    record_cid TEXT, 
    owner_did TEXT NOT NULL, 
    collection TEXT NOT NULL, 
    rkey TEXT NOT NULL, 
    avatar TEXT, 
    bio TEXT, 
    record_created_at TEXT, 
    record_updated_at TEXT, 
    deleted BOOLEAN NOT NULL, 
    commit_cid TEXT NOT NULL, 
    commit_rev TEXT NOT NULL, 
    indexed_at_us BIGINT NOT NULL, 
    PRIMARY KEY (record_uri), 
    CONSTRAINT ck_profile_records_canonical_uri CHECK (record_uri = 'at://' || owner_did || '/' || collection || '/self'), 
    CONSTRAINT ck_profile_records_literal_key CHECK (rkey = 'self'), 
    CONSTRAINT ck_profile_records_tombstone_shape CHECK ((deleted AND record_cid IS NULL AND avatar IS NULL AND bio IS NULL AND record_created_at IS NULL AND record_updated_at IS NULL) OR (NOT deleted AND record_cid IS NOT NULL AND record_created_at IS NOT NULL)), 
    CONSTRAINT ck_profile_records_indexed_at CHECK (indexed_at_us >= 0), 
    CONSTRAINT uq_profile_records_repo_path UNIQUE (owner_did, collection, rkey)
);

CREATE INDEX ix_profile_records_owner ON plyr_index.profile_records (owner_did) WHERE NOT deleted;
