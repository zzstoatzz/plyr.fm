-- Next's own labeler: signed com.atproto.label.defs#label records, served
-- from com.atproto.label.queryLabels in seq order. A label is written in the
-- same transaction as the log entry that decided it (label_applied /
-- label_negated), and projected onto the policy tables feeds already read.
-- Like the log, this is owned state: a network replay cannot rebuild it.

CREATE TABLE IF NOT EXISTS plyr_moderation.labels (
    seq BIGSERIAL PRIMARY KEY,
    src TEXT NOT NULL CHECK (src LIKE 'did:%' AND length(src) <= 512),
    uri TEXT NOT NULL CHECK ((uri LIKE 'at://%' OR uri LIKE 'did:%') AND length(uri) <= 512),
    cid TEXT CHECK (cid IS NULL OR length(cid) <= 128),
    val TEXT NOT NULL CHECK (length(val) BETWEEN 1 AND 128),
    neg BOOLEAN NOT NULL DEFAULT false,
    cts TEXT NOT NULL,
    exp TEXT,
    sig BYTEA NOT NULL CHECK (length(sig) = 64),
    event_id BIGINT REFERENCES plyr_moderation.events (id)
);

CREATE INDEX IF NOT EXISTS ix_moderation_labels_uri ON plyr_moderation.labels (uri, seq);

ALTER TABLE plyr_moderation.events ADD COLUMN IF NOT EXISTS label_value TEXT
    CHECK (label_value IS NULL OR length(label_value) BETWEEN 1 AND 128);

ALTER TABLE plyr_moderation.events DROP CONSTRAINT IF EXISTS events_action_check;
ALTER TABLE plyr_moderation.events ADD CONSTRAINT events_action_check CHECK (action IN (
    'reported', 'flagged_by_scan', 'flagged_by_rule',
    'acknowledged', 'override_allow', 'override_exclude', 'override_clear',
    'label_applied', 'label_negated'
));

ALTER TABLE plyr_moderation.events DROP CONSTRAINT IF EXISTS ck_events_label_value;
ALTER TABLE plyr_moderation.events ADD CONSTRAINT ck_events_label_value CHECK (
    (action IN ('label_applied', 'label_negated')) = (label_value IS NOT NULL)
);

DO $grants$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plyr_zig_canary') THEN
        GRANT SELECT, INSERT ON plyr_moderation.labels TO plyr_zig_canary;
        GRANT USAGE ON SEQUENCE plyr_moderation.labels_seq_seq TO plyr_zig_canary;
        GRANT INSERT, UPDATE, DELETE ON plyr_index.account_label_policies TO plyr_zig_canary;
    END IF;
END
$grants$;
