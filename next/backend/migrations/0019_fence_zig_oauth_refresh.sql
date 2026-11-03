-- converted from alembic revision b6a82c5140de (fence_zig_oauth_refresh) on codex/zig-backend

ALTER TABLE plyr_auth.sessions ADD COLUMN credentials_generation BIGINT DEFAULT 1 NOT NULL;

ALTER TABLE plyr_auth.sessions ADD COLUMN refresh_owner UUID;

ALTER TABLE plyr_auth.sessions ADD COLUMN refresh_lease_until TIMESTAMP WITH TIME ZONE;

ALTER TABLE plyr_auth.sessions ADD CONSTRAINT ck_sessions_refresh_lease_pair CHECK ((refresh_owner IS NULL) = (refresh_lease_until IS NULL));

DO $grants$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plyr_zig_canary') THEN
        EXECUTE 'GRANT UPDATE (sealed_credentials, scope, credentials_generation, refresh_owner, refresh_lease_until) ON plyr_auth.sessions TO plyr_zig_canary';
    END IF;
END
$grants$;
