-- converted from alembic revision a8d20f4bc731 (add_verified_record_rejections) on codex/zig-backend

CREATE TABLE plyr_index.record_rejections (
    record_uri TEXT NOT NULL, 
    record_cid TEXT NOT NULL, 
    owner_did TEXT NOT NULL, 
    collection TEXT NOT NULL, 
    rkey TEXT NOT NULL, 
    reason TEXT NOT NULL, 
    detail TEXT NOT NULL, 
    commit_cid TEXT NOT NULL, 
    commit_rev TEXT NOT NULL, 
    indexed_at_us BIGINT NOT NULL, 
    PRIMARY KEY (record_uri), 
    CONSTRAINT ck_record_rejections_reason CHECK (reason IN ('invalid_dag_cbor', 'invalid_schema')), 
    CONSTRAINT ck_record_rejections_detail_time CHECK (length(detail) BETWEEN 1 AND 128 AND indexed_at_us >= 0), 
    CONSTRAINT uq_record_rejections_repo_path UNIQUE (owner_did, collection, rkey)
);

CREATE INDEX ix_record_rejections_owner_collection ON plyr_index.record_rejections (owner_did, collection);
