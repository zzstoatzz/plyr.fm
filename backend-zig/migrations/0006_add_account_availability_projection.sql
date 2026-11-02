-- converted from alembic revision e6b08d3f2a71 (add_account_availability_projection) on codex/zig-backend

CREATE TABLE plyr_index.account_availability (
    repo_did TEXT NOT NULL, 
    available BOOLEAN NOT NULL, 
    unavailable_reason TEXT, 
    evidence_source TEXT NOT NULL, 
    repository_rev TEXT, 
    commit_cid TEXT, 
    pds_origin TEXT, 
    observed_at_us BIGINT NOT NULL, 
    PRIMARY KEY (repo_did), 
    CONSTRAINT ck_account_availability_state_shape CHECK (available = (unavailable_reason IS NULL)), 
    CONSTRAINT ck_account_availability_evidence_source CHECK (evidence_source IN ('verified_repository', 'current_pds')), 
    CONSTRAINT ck_account_availability_reason CHECK (unavailable_reason IS NULL OR unavailable_reason IN ('deactivated', 'deleted', 'takendown', 'suspended')), 
    CONSTRAINT ck_account_availability_evidence_shape CHECK ((evidence_source = 'verified_repository' AND available AND repository_rev IS NOT NULL AND commit_cid IS NOT NULL AND pds_origin IS NULL) OR (evidence_source = 'current_pds' AND commit_cid IS NULL AND pds_origin IS NOT NULL)), 
    CONSTRAINT ck_account_availability_observed_at CHECK (observed_at_us >= 0)
);

CREATE INDEX ix_account_availability_unavailable ON plyr_index.account_availability (unavailable_reason) WHERE NOT available;
