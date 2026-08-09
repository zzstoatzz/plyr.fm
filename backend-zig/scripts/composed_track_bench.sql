-- Deterministic fixture for `just zig bench-composed-tracks`.
-- This script is intentionally destructive and refuses every database except zig_bench.

DO $$
BEGIN
    IF current_database() <> 'zig_bench' THEN
        RAISE EXCEPTION 'composed track benchmark only permits zig_bench';
    END IF;
END
$$;

DROP SCHEMA IF EXISTS plyr_index CASCADE;
DROP TABLE IF EXISTS tracks CASCADE;
DROP TABLE IF EXISTS artists CASCADE;

CREATE SCHEMA plyr_index;
CREATE TABLE plyr_index.track_records (
    record_uri text PRIMARY KEY,
    record_cid text NOT NULL,
    owner_did text NOT NULL,
    collection text NOT NULL,
    rkey text NOT NULL,
    title text NOT NULL,
    artist_name text,
    file_type text NOT NULL,
    record_created_at text NOT NULL,
    audio_url text,
    audio_blob_cid text,
    audio_blob_media_type text,
    audio_blob_size bigint,
    album text,
    duration_seconds bigint,
    featured_dids text[] NOT NULL DEFAULT '{}',
    image_url text,
    support_gate_type text,
    description text,
    self_labels text[] NOT NULL DEFAULT '{}',
    deleted boolean NOT NULL,
    commit_cid text NOT NULL,
    commit_rev text NOT NULL,
    indexed_at_us bigint NOT NULL
);
CREATE TABLE plyr_index.profile_records (
    record_uri text PRIMARY KEY,
    record_cid text,
    owner_did text NOT NULL,
    collection text NOT NULL,
    rkey text NOT NULL,
    avatar text,
    bio text,
    record_created_at text,
    record_updated_at text,
    deleted boolean NOT NULL,
    commit_cid text NOT NULL,
    commit_rev text NOT NULL,
    indexed_at_us bigint NOT NULL
);
CREATE TABLE plyr_index.account_availability (
    repo_did text PRIMARY KEY,
    available boolean NOT NULL,
    unavailable_reason text,
    evidence_source text NOT NULL,
    repository_rev text,
    commit_cid text,
    pds_origin text,
    observed_at_us bigint NOT NULL
);
CREATE TABLE plyr_index.track_delivery_origins (
    record_uri text NOT NULL,
    service text NOT NULL,
    record_cid text NOT NULL,
    origin_url text NOT NULL,
    media_type text NOT NULL,
    artifact_cid text NOT NULL,
    verification text NOT NULL,
    observed_at_us bigint NOT NULL,
    PRIMARY KEY (record_uri, service)
);
CREATE TABLE artists (
    did text PRIMARY KEY,
    handle text NOT NULL,
    display_name text NOT NULL,
    bio text,
    avatar_url text
);
CREATE TABLE tracks (
    atproto_record_uri text PRIMARY KEY,
    created_at timestamptz NOT NULL,
    r2_url text,
    file_type text NOT NULL,
    visibility text NOT NULL,
    space_uri text,
    operator_labels jsonb NOT NULL DEFAULT '[]',
    moderation_override text,
    play_count integer NOT NULL DEFAULT 0,
    publish_state text
);

INSERT INTO artists VALUES (
    'did:plc:bench', 'benchmark.test', 'Benchmark Artist',
    'legacy fallback bio', 'https://legacy.example/avatar.jpg'
);
INSERT INTO plyr_index.profile_records VALUES (
    'at://did:plc:bench/fm.plyr.dev.actor.profile/self',
    'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
    'did:plc:bench', 'fm.plyr.dev.actor.profile', 'self',
    'https://pds.example/avatar.jpg', 'authored profile bio',
    '2026-08-08T12:00:00Z', NULL, false,
    'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
    '3jqfcqzm3fo2j', 1786208400000000
);
INSERT INTO plyr_index.account_availability VALUES (
    'did:plc:bench', true, NULL, 'verified_repository', '3jqfcqzm3fo2j',
    'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
    NULL, 1786208400000000
);

INSERT INTO plyr_index.track_records
SELECT
    format('at://did:plc:bench/fm.plyr.dev.track/track-%s', n),
    'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
    'did:plc:bench', 'fm.plyr.dev.track', format('track-%s', n),
    format('Verified Track %s', n), 'Authored Credit', 'audio/flac',
    to_char(TIMESTAMPTZ '2026-08-08 12:00:00+00' + n * INTERVAL '1 second',
        'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    format('https://pds.example/audio-%s.flac', n),
    'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
    'audio/flac', 4096, 'Benchmark Album', 180, '{}', NULL, NULL,
    format('Benchmark description %s', n), '{}', false,
    'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
    '3jqfcqzm3fo2j', 1786208400000000 + n
FROM generate_series(1, 100) AS n;

INSERT INTO plyr_index.track_delivery_origins
SELECT
    format('at://did:plc:bench/fm.plyr.dev.track/track-%s', n),
    'r2',
    'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
    format('https://r2.example/audio-%s.flac', n),
    'audio/flac',
    'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
    'verified_blob_cid',
    1786208400000000 + n
FROM generate_series(1, 100) AS n;

INSERT INTO tracks
SELECT
    format('at://did:plc:bench/fm.plyr.dev.track/track-%s', n),
    TIMESTAMPTZ '2026-08-08 12:00:00+00' + n * INTERVAL '1 second',
    format('https://r2.example/audio-%s.flac', n), 'audio/flac', 'public',
    NULL, '[]', NULL, n, 'published'
FROM generate_series(1, 100) AS n;

CREATE INDEX track_records_owner_created_bench
    ON plyr_index.track_records (owner_did, record_created_at, record_uri)
    WHERE NOT deleted;
CREATE INDEX tracks_created_uri_bench
    ON tracks (created_at DESC, atproto_record_uri DESC);
