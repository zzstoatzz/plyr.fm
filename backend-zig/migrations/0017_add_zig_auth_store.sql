-- converted from alembic revision e82b3d0f5a94 (add_zig_auth_store) on codex/zig-backend

CREATE SCHEMA plyr_auth;

CREATE TABLE plyr_auth.oauth_requests (
    state_digest BYTEA NOT NULL, 
    sealed_payload BYTEA NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT clock_timestamp() NOT NULL, 
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    PRIMARY KEY (state_digest), 
    CONSTRAINT ck_oauth_requests_state_digest CHECK (octet_length(state_digest) = 32)
);

CREATE INDEX ix_oauth_requests_expires_at ON plyr_auth.oauth_requests (expires_at);

CREATE TABLE plyr_auth.sessions (
    session_digest BYTEA NOT NULL, 
    group_id UUID NOT NULL, 
    did TEXT NOT NULL, 
    handle TEXT NOT NULL, 
    scope TEXT NOT NULL, 
    sealed_credentials BYTEA NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT clock_timestamp() NOT NULL, 
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    revoked_at TIMESTAMP WITH TIME ZONE, 
    PRIMARY KEY (session_digest), 
    CONSTRAINT ck_sessions_session_digest CHECK (octet_length(session_digest) = 32), 
    CONSTRAINT ck_sessions_did CHECK (did LIKE 'did:%')
);

CREATE INDEX ix_sessions_group_active ON plyr_auth.sessions (group_id, created_at) WHERE revoked_at IS NULL;

CREATE INDEX ix_sessions_did_active ON plyr_auth.sessions (did) WHERE revoked_at IS NULL;

CREATE TABLE plyr_auth.exchange_tokens (
    token_digest BYTEA NOT NULL, 
    session_digest BYTEA NOT NULL, 
    sealed_session_token BYTEA NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT clock_timestamp() NOT NULL, 
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    PRIMARY KEY (token_digest), 
    CONSTRAINT ck_exchange_tokens_token_digest CHECK (octet_length(token_digest) = 32), 
    FOREIGN KEY(session_digest) REFERENCES plyr_auth.sessions (session_digest) ON DELETE CASCADE
);

CREATE INDEX ix_exchange_tokens_expires_at ON plyr_auth.exchange_tokens (expires_at);

DO $grants$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plyr_zig_canary') THEN
        EXECUTE 'GRANT USAGE ON SCHEMA plyr_auth TO plyr_zig_canary';
        EXECUTE 'GRANT SELECT, INSERT, DELETE ON plyr_auth.oauth_requests TO plyr_zig_canary';
        EXECUTE 'GRANT SELECT, INSERT ON plyr_auth.sessions TO plyr_zig_canary';
        EXECUTE 'GRANT UPDATE (revoked_at) ON plyr_auth.sessions TO plyr_zig_canary';
        EXECUTE 'GRANT SELECT, INSERT, DELETE ON plyr_auth.exchange_tokens TO plyr_zig_canary';
    END IF;
END
$grants$;
