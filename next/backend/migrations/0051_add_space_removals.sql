-- Readers an artist removed from every gated space they own. The access core
-- (internal/space/access.zig) asks this before any of the artist's policies,
-- so a removed reader passes none of them, bought or not. This is the artist's
-- own private list: it is not published, and it cannot be rebuilt from the
-- network, so it lives with other account state.

CREATE SCHEMA IF NOT EXISTS plyr_account;

CREATE TABLE IF NOT EXISTS plyr_account.space_removals (
    authority_did TEXT NOT NULL CHECK (authority_did LIKE 'did:%' AND length(authority_did) <= 512),
    reader_did TEXT NOT NULL CHECK (reader_did LIKE 'did:%' AND length(reader_did) <= 512),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (authority_did, reader_did),
    CHECK (reader_did <> authority_did)
);

-- the access check also asks whether moderation took down audio in a space;
-- it looks tracks up by owner, then by the space their audio lives in
CREATE INDEX IF NOT EXISTS ix_track_records_owner_audio_space
    ON plyr_index.track_records (owner_did, audio_space)
    WHERE audio_space IS NOT NULL;

DO $grants$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plyr_zig_canary') THEN
        GRANT USAGE ON SCHEMA plyr_account TO plyr_zig_canary;
        GRANT SELECT, INSERT, DELETE ON plyr_account.space_removals TO plyr_zig_canary;
    END IF;
END
$grants$;
