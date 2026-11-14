-- plyr's copy of records that live in plyr-managed spaces, fed by the
-- space-stream consumer. Both tables are derived: replaying a space from
-- cursor 0 rebuilds them.

CREATE TABLE plyr_index.space_cursors (
    space TEXT PRIMARY KEY CHECK (space LIKE 'at://%/space/%' AND length(space) <= 1024),
    time_us BIGINT NOT NULL CHECK (time_us >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE plyr_index.space_records (
    space TEXT NOT NULL,
    repo_did TEXT NOT NULL CHECK (repo_did LIKE 'did:%' AND length(repo_did) <= 512),
    collection TEXT NOT NULL,
    rkey TEXT NOT NULL,
    rev TEXT NOT NULL,
    cid TEXT NOT NULL,
    value JSONB NOT NULL,
    PRIMARY KEY (space, repo_did, collection, rkey)
);
