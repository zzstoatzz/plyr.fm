-- converted from alembic revision f7c19e4a3b82 (add_account_status_check_schedule) on codex/zig-backend

CREATE TABLE plyr_index.account_status_checks (
    repo_did TEXT NOT NULL, 
    next_attempt_at_us BIGINT NOT NULL, 
    hinted_at_us BIGINT NOT NULL, 
    lease_until_us BIGINT, 
    attempt_count BIGINT NOT NULL, 
    consecutive_failures INTEGER NOT NULL, 
    last_attempt_at_us BIGINT, 
    last_completed_at_us BIGINT, 
    last_success_at_us BIGINT, 
    last_response_authoritative BOOLEAN, 
    last_outcome TEXT, 
    PRIMARY KEY (repo_did), 
    CONSTRAINT ck_account_status_checks_counters CHECK (next_attempt_at_us >= 0 AND hinted_at_us >= 0 AND (lease_until_us IS NULL OR lease_until_us >= 0) AND attempt_count >= 0 AND consecutive_failures >= 0), 
    CONSTRAINT ck_account_status_checks_timestamps CHECK ((last_attempt_at_us IS NULL OR last_attempt_at_us >= 0) AND (last_completed_at_us IS NULL OR last_completed_at_us >= 0) AND (last_success_at_us IS NULL OR last_success_at_us >= 0)), 
    CONSTRAINT ck_account_status_checks_outcome CHECK (last_outcome IS NULL OR length(last_outcome) BETWEEN 1 AND 64)
);

CREATE INDEX ix_account_status_checks_due ON plyr_index.account_status_checks (next_attempt_at_us, repo_did);
