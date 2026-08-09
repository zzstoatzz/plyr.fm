-- Deterministic fixture for `just zig bench-album-detail`.
-- This script is intentionally destructive and refuses every database except zig_bench.

DO $$
BEGIN
    IF current_database() <> 'zig_bench' THEN
        RAISE EXCEPTION 'album detail benchmark only permits zig_bench';
    END IF;
END
$$;

DROP SCHEMA IF EXISTS plyr_index CASCADE;
DROP TABLE IF EXISTS tracks;
DROP TABLE IF EXISTS artists CASCADE;

CREATE SCHEMA plyr_index;
CREATE TABLE plyr_index.list_records (
    record_uri text PRIMARY KEY,
    record_cid text NOT NULL,
    owner_did text NOT NULL,
    collection text NOT NULL,
    rkey text NOT NULL,
    list_type text NOT NULL,
    name text,
    record_created_at text NOT NULL,
    record_updated_at text,
    deleted boolean NOT NULL,
    commit_cid text NOT NULL,
    commit_rev text NOT NULL,
    indexed_at_us bigint NOT NULL
);
CREATE TABLE plyr_index.list_members (
    list_uri text NOT NULL REFERENCES plyr_index.list_records(record_uri) ON DELETE CASCADE,
    position smallint NOT NULL,
    track_uri text NOT NULL,
    track_cid text NOT NULL,
    PRIMARY KEY (list_uri, position)
);
CREATE TABLE artists (
    did text PRIMARY KEY,
    handle text NOT NULL,
    display_name text NOT NULL,
    avatar_url text,
    deactivated boolean NOT NULL DEFAULT false
);
CREATE TABLE tracks (
    atproto_record_uri text PRIMARY KEY,
    atproto_record_cid text,
    atproto_record_rev text,
    title text NOT NULL,
    description text,
    extra jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL,
    artist_did text NOT NULL,
    pds_blob_cid text,
    pds_blob_size integer,
    r2_url text,
    file_type text NOT NULL,
    visibility text NOT NULL,
    support_gate jsonb,
    space_uri text,
    self_labels jsonb NOT NULL DEFAULT '[]',
    operator_labels jsonb NOT NULL DEFAULT '[]',
    moderation_override text,
    play_count integer NOT NULL DEFAULT 0,
    publish_state text
);

INSERT INTO artists (did, handle, display_name)
VALUES ('did:plc:bench', 'benchmark.test', 'Benchmark Artist');

INSERT INTO tracks (
    atproto_record_uri,
    atproto_record_cid,
    atproto_record_rev,
    title,
    created_at,
    artist_did,
    file_type,
    visibility,
    play_count,
    publish_state
)
SELECT
    format('at://did:plc:bench/fm.plyr.dev.track/track-%s', n),
    'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
    '3jqfcqzm3fo2j',
    format('Track %s', n),
    TIMESTAMPTZ '2026-08-08 12:00:00+00' + n * INTERVAL '1 second',
    'did:plc:bench',
    'audio/mpeg',
    'public',
    n,
    'published'
FROM generate_series(1, 20) AS n;

INSERT INTO plyr_index.list_records VALUES (
    'at://did:plc:bench/fm.plyr.dev.list/album',
    'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
    'did:plc:bench',
    'fm.plyr.dev.list',
    'album',
    'album',
    'Benchmark Album',
    '2026-08-08T12:00:00Z',
    NULL,
    false,
    'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
    '3jqfcqzm3fo2j',
    1786208400000000
);

INSERT INTO plyr_index.list_members (list_uri, position, track_uri, track_cid)
SELECT
    'at://did:plc:bench/fm.plyr.dev.list/album',
    n - 1,
    format('at://did:plc:bench/fm.plyr.dev.track/track-%s', n),
    'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku'
FROM generate_series(1, 20) AS n;
