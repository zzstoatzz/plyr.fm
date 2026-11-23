-- The atlas: a 2D map of the public catalog from CLAP audio embeddings.
-- next/scripts/build-atlas.py (next-build-atlas.yml, daily) is the only
-- writer of both tables; the API only reads the snapshot (getAtlas).
--
-- Derived from public audio, not from records, so replay doesn't rebuild
-- them. Recovery: a lost embedding is computed again on the next build (the
-- Modal CLAP endpoint); a lost snapshot is rebuilt by the next run.
CREATE EXTENSION IF NOT EXISTS vector;

-- one vector per track, for the audio it was computed from (`audio_ref`: the
-- blob cid, else the audio url). a new record version is checked again and
-- re-embedded only if its audio changed.
CREATE TABLE IF NOT EXISTS plyr_index.track_embeddings (
    record_uri TEXT PRIMARY KEY CHECK (record_uri LIKE 'at://%'),
    record_cid TEXT NOT NULL,
    audio_ref TEXT NOT NULL CHECK (length(audio_ref) BETWEEN 1 AND 4096),
    model TEXT NOT NULL CHECK (length(model) BETWEEN 1 AND 255),
    embedding vector(512) NOT NULL,
    embedded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- the latest built map, served as is
CREATE TABLE IF NOT EXISTS plyr_index.atlas_snapshots (
    id SMALLINT PRIMARY KEY CHECK (id = 1),
    body JSONB NOT NULL,
    built_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plyr_zig_canary') THEN
        GRANT SELECT ON plyr_index.atlas_snapshots TO plyr_zig_canary;
    END IF;
END
$$;
