-- converted from alembic revision c7b913f2a6ed (add_zig_command_keys) on codex/zig-backend

CREATE SCHEMA plyr_command;

CREATE TABLE plyr_command.record_keys (
    actor_did TEXT NOT NULL, 
    collection TEXT NOT NULL, 
    operation_digest BYTEA NOT NULL, 
    rkey TEXT NOT NULL, 
    created_at TEXT NOT NULL, 
    allocated_at TIMESTAMP WITH TIME ZONE DEFAULT clock_timestamp() NOT NULL, 
    CONSTRAINT pk_record_keys PRIMARY KEY (actor_did, collection, operation_digest), 
    CONSTRAINT uq_record_keys_rkey UNIQUE (actor_did, collection, rkey), 
    CONSTRAINT ck_record_keys_actor_did CHECK (actor_did LIKE 'did:%'), 
    CONSTRAINT ck_record_keys_operation_digest CHECK (octet_length(operation_digest) = 32)
);

DO $grants$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plyr_zig_canary') THEN
        EXECUTE 'GRANT USAGE ON SCHEMA plyr_command TO plyr_zig_canary';
        EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON plyr_command.record_keys TO plyr_zig_canary';
    END IF;
END
$grants$;
