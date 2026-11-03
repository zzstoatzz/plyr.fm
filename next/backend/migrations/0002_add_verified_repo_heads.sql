-- converted from alembic revision 7f1f760c57c1 (add_verified_repo_heads) on codex/zig-backend

CREATE TABLE plyr_index.repo_heads (
    repo_did TEXT NOT NULL, 
    commit_rev TEXT NOT NULL, 
    commit_cid TEXT NOT NULL, 
    data_cid TEXT NOT NULL, 
    indexed_at_us BIGINT NOT NULL, 
    PRIMARY KEY (repo_did), 
    CONSTRAINT ck_repo_heads_did CHECK (repo_did ~ '^did:[a-z0-9]+:.+$'), 
    CONSTRAINT ck_repo_heads_tid CHECK (commit_rev ~ '^[234567abcdefghijklmnopqrstuvwxyz]{13}$'), 
    CONSTRAINT ck_repo_heads_cids CHECK (commit_cid ~ '^b[a-z2-7]+$' AND data_cid ~ '^b[a-z2-7]+$'), 
    CONSTRAINT ck_repo_heads_indexed_at CHECK (indexed_at_us >= 0)
);
