CREATE SCHEMA plyr_account;

CREATE TABLE plyr_account.preferences (
    owner_did TEXT PRIMARY KEY CHECK (owner_did LIKE 'did:%' AND length(owner_did) <= 512),
    value JSONB NOT NULL CHECK (jsonb_typeof(value) = 'object'),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
