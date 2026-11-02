-- converted from alembic revision 91d8c4e7a2b6 (add_zig_relay_cursors) on codex/zig-backend

CREATE TABLE plyr_index.relay_cursors (
    source TEXT NOT NULL, 
    seq BIGINT NOT NULL, 
    updated_at_us BIGINT NOT NULL, 
    PRIMARY KEY (source), 
    CONSTRAINT ck_relay_cursors_source CHECK (length(source) BETWEEN 1 AND 255), 
    CONSTRAINT ck_relay_cursors_seq CHECK (seq >= 0), 
    CONSTRAINT ck_relay_cursors_updated_at CHECK (updated_at_us >= 0)
);
