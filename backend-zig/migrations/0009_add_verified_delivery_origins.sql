-- converted from alembic revision c31e7b4a902d (add_verified_delivery_origins) on codex/zig-backend

CREATE TABLE plyr_index.track_delivery_origins (
    record_uri TEXT NOT NULL, 
    service TEXT NOT NULL, 
    record_cid TEXT NOT NULL, 
    origin_url TEXT NOT NULL, 
    media_type TEXT NOT NULL, 
    artifact_cid TEXT NOT NULL, 
    verification TEXT NOT NULL, 
    observed_at_us BIGINT NOT NULL, 
    PRIMARY KEY (record_uri, service), 
    CONSTRAINT ck_track_delivery_origins_evidence CHECK (service = 'r2' AND verification = 'verified_blob_cid'), 
    CONSTRAINT ck_track_delivery_origins_values CHECK (length(origin_url) BETWEEN 1 AND 4096 AND length(media_type) BETWEEN 1 AND 255 AND observed_at_us >= 0)
);
