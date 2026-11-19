-- Moderation is operational state the API owns (next/AGENTS.md "where state
-- lives"): an append-only log of what was reported, flagged and decided.
-- The review queue and operator overrides are derived from it, the same way
-- prod's moderation_events works (docs/internal/moderation/event-log.md).
-- A replay of the network cannot bring this back, so it is never truncated;
-- track_policies.moderation_decision is a projection of it.

CREATE SCHEMA IF NOT EXISTS plyr_moderation;

CREATE TABLE IF NOT EXISTS plyr_moderation.events (
    id BIGSERIAL PRIMARY KEY,
    -- an AT URI (a track, a comment) or an account DID
    subject_uri TEXT NOT NULL CHECK (
        (subject_uri LIKE 'at://%' OR subject_uri LIKE 'did:%') AND length(subject_uri) <= 512
    ),
    action TEXT NOT NULL CHECK (action IN (
        'reported', 'flagged_by_scan', 'flagged_by_rule',
        'acknowledged', 'override_allow', 'override_exclude', 'override_clear'
    )),
    -- who: an authenticated DID (operator or reporter), or 'rule:<name>' /
    -- 'scan:<name>' for automated flags
    actor TEXT NOT NULL CHECK (length(actor) BETWEEN 1 AND 512),
    -- reports: the reporter's category (com.atproto.moderation.defs style)
    reason_type TEXT CHECK (reason_type IS NULL OR reason_type IN (
        'copyright', 'sexual', 'spam', 'harassment', 'impersonation', 'other'
    )),
    reason TEXT CHECK (reason IS NULL OR length(reason) <= 2000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS ix_moderation_events_subject
    ON plyr_moderation.events (subject_uri, id);

-- one report per reporter per subject per day is enough signal
CREATE INDEX IF NOT EXISTS ix_moderation_events_reporter
    ON plyr_moderation.events (actor, subject_uri, created_at)
    WHERE action = 'reported';

-- the log is the third writer of a track's moderation policy, beside the
-- legacy import and the labeler sync
ALTER TABLE plyr_index.track_policies
    DROP CONSTRAINT IF EXISTS ck_track_policies_moderation_shape;
ALTER TABLE plyr_index.track_policies
    ADD CONSTRAINT ck_track_policies_moderation_shape CHECK (
        (jsonb_array_length(operator_labels) = 0 AND moderation_decision IS NULL
            AND moderation_write_source IS NULL AND moderation_observed_at_us IS NULL)
        OR ((jsonb_array_length(operator_labels) > 0 OR moderation_decision IS NOT NULL)
            AND moderation_write_source IN ('legacy_import', 'labeler_sync', 'moderation_log')
            AND moderation_observed_at_us >= 0)
    );

DO $grants$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plyr_zig_canary') THEN
        GRANT USAGE ON SCHEMA plyr_moderation TO plyr_zig_canary;
        GRANT SELECT, INSERT ON plyr_moderation.events TO plyr_zig_canary;
        GRANT USAGE ON SEQUENCE plyr_moderation.events_id_seq TO plyr_zig_canary;
        -- only the moderation columns: visibility and access gating stay
        -- out of the public API's reach (as in 0015/0019)
        GRANT INSERT (record_uri, moderation_decision, moderation_write_source, moderation_observed_at_us)
            ON plyr_index.track_policies TO plyr_zig_canary;
        GRANT UPDATE (moderation_decision, moderation_write_source, moderation_observed_at_us)
            ON plyr_index.track_policies TO plyr_zig_canary;
        GRANT DELETE ON plyr_index.track_policies TO plyr_zig_canary;
    END IF;
END
$grants$;
