CREATE TABLE plyr_index.account_label_policies (
    owner_did TEXT PRIMARY KEY CHECK (owner_did LIKE 'did:%' AND length(owner_did) <= 512),
    operator_labels JSONB NOT NULL CHECK (operator_labels = '["ai"]'::jsonb),
    observed_at_us BIGINT NOT NULL CHECK (observed_at_us >= 0),
    expires_at_us BIGINT CHECK (expires_at_us >= 0)
);
