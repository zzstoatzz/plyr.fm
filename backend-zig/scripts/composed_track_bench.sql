-- Deterministic fixture for the composed read-model benchmarks.
-- This script is intentionally destructive and refuses every database except zig_bench.

DO $$
BEGIN
    IF current_database() <> 'zig_bench' THEN
        RAISE EXCEPTION 'composed track benchmark only permits zig_bench';
    END IF;
END
$$;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

DROP SCHEMA IF EXISTS plyr_index CASCADE;
DROP TABLE IF EXISTS tracks CASCADE;
DROP TABLE IF EXISTS user_preferences CASCADE;
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
CREATE TABLE plyr_index.track_policies (
    record_uri text PRIMARY KEY,
    visibility text,
    space_uri text,
    access_write_source text,
    access_observed_at_us bigint,
    operator_labels jsonb NOT NULL DEFAULT '[]',
    moderation_decision text,
    moderation_write_source text,
    moderation_observed_at_us bigint
);
CREATE TABLE plyr_index.track_metrics (
    record_uri text PRIMARY KEY,
    play_count bigint NOT NULL,
    write_source text NOT NULL,
    observed_at_us bigint NOT NULL
);
CREATE TABLE plyr_index.like_records (
    record_uri text PRIMARY KEY,
    record_cid text,
    owner_did text NOT NULL,
    collection text NOT NULL,
    rkey text NOT NULL,
    subject_uri text,
    subject_cid text,
    record_created_at text,
    deleted boolean NOT NULL,
    commit_cid text NOT NULL,
    commit_rev text NOT NULL,
    indexed_at_us bigint NOT NULL
);
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
    list_uri text NOT NULL,
    position smallint NOT NULL,
    track_uri text NOT NULL,
    track_cid text NOT NULL,
    PRIMARY KEY (list_uri, position)
);
CREATE TABLE artists (
    did text PRIMARY KEY,
    handle text NOT NULL,
    display_name text NOT NULL,
    bio text,
    avatar_url text,
    deactivated boolean NOT NULL DEFAULT false
);
CREATE TABLE user_preferences (
    did text PRIMARY KEY,
    show_liked_on_profile boolean NOT NULL DEFAULT false,
    support_url text
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
INSERT INTO user_preferences VALUES ('did:plc:bench', true, 'atprotofans');
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
INSERT INTO plyr_index.account_availability
SELECT
    format('did:plc:liker%s', n), true, NULL, 'verified_repository', '3jqfcqzm3fo2j',
    'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
    NULL, 1786208400000000 + n
FROM generate_series(1, 100) AS n;

INSERT INTO plyr_index.account_availability (
    repo_did, available, unavailable_reason, evidence_source, pds_origin,
    observed_at_us
)
VALUES (
    'did:plc:unavailable-liker', false, 'account_event',
    'account_event', 'https://pds.example', 1786320000000000
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

INSERT INTO plyr_index.track_policies (
    record_uri, visibility, space_uri,
    access_write_source, access_observed_at_us
)
SELECT
    format('at://did:plc:bench/fm.plyr.dev.track/track-%s', n),
    'public', NULL, 'legacy_import', 1786208400000000 + n
FROM generate_series(1, 100) AS n;

INSERT INTO plyr_index.track_metrics
SELECT
    format('at://did:plc:bench/fm.plyr.dev.track/track-%s', n),
    n, 'legacy_import', 1786208400000000 + n
FROM generate_series(1, 100) AS n;

INSERT INTO plyr_index.like_records
SELECT
    format('at://did:plc:liker%s/fm.plyr.dev.like/track-%s', liker, track),
    'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
    format('did:plc:liker%s', liker), 'fm.plyr.dev.like', format('track-%s', track),
    format('at://did:plc:bench/fm.plyr.dev.track/track-%s', track),
    'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
    to_char(TIMESTAMPTZ '2026-08-09 12:00:00+00' - liker * INTERVAL '1 hour',
        'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    false,
    'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
    '3jqfcqzm3fo2j', 1786294800000000 + liker
FROM generate_series(1, 100) AS track
CROSS JOIN LATERAL generate_series(1, track) AS liker;

-- A URI identifies the record slot, not one immutable record. Likes name a
-- strong reference, so votes for an earlier CID must not transfer to the
-- current track revision. Without the subject-CID join below, these stale
-- votes would incorrectly make track-1 tie track-100 at the top of the chart.
INSERT INTO plyr_index.like_records
SELECT
    format('at://did:plc:liker%s/fm.plyr.dev.like/stale-track-1', liker),
    'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
    format('did:plc:liker%s', liker), 'fm.plyr.dev.like', 'stale-track-1',
    'at://did:plc:bench/fm.plyr.dev.track/track-1',
    'bafyreic3c7wk5dvep4f6q7bceo7xix4nzf34z2akxro3kjm5xckd7xxf2m',
    '2026-08-09T12:00:00Z', false,
    'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
    '3jqfcqzm3fo2j', 1786320000000000 + liker
FROM generate_series(1, 100) AS liker;

-- Neither a second record from one actor nor an unavailable actor creates a
-- second vote for the same subject.
INSERT INTO plyr_index.like_records (
    record_uri, record_cid, owner_did, collection, rkey, subject_uri,
    subject_cid, record_created_at, commit_cid, commit_rev, indexed_at_us,
    deleted
)
VALUES
    (
        'at://did:plc:liker100/fm.plyr.dev.like/duplicate-track-100',
        'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
        'did:plc:liker100', 'fm.plyr.dev.like', 'duplicate-track-100',
        'at://did:plc:bench/fm.plyr.dev.track/track-100',
        'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
        '2026-08-09T11:00:00Z',
        'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
        '3jqfcqzm3fo2j', 1786320000000000, false
    ),
    (
        'at://did:plc:unavailable-liker/fm.plyr.dev.like/track-100',
        'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
        'did:plc:unavailable-liker', 'fm.plyr.dev.like', 'track-100',
        'at://did:plc:bench/fm.plyr.dev.track/track-100',
        'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
        '2026-08-09T11:00:00Z',
        'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
        '3jqfcqzm3fo2j', 1786320000000000, false
    );

-- A projection may temporarily hold more than one configured namespace while
-- an environment is reconciled. Even exact-CID records from another NSID are
-- not plyr likes and must not change either aggregate counts or chart rank.
INSERT INTO plyr_index.like_records
SELECT
    format('at://did:plc:liker%s/com.example.like/wrong-track-1', liker),
    'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
    format('did:plc:liker%s', liker), 'com.example.like', 'wrong-track-1',
    'at://did:plc:bench/fm.plyr.dev.track/track-1',
    'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
    '2026-08-09T11:00:00Z', false,
    'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
    '3jqfcqzm3fo2j', 1786320000000000 + liker
FROM generate_series(1, 100) AS liker;

INSERT INTO plyr_index.list_records VALUES (
    'at://did:plc:bench/fm.plyr.dev.list/playlist',
    'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
    'did:plc:bench', 'fm.plyr.dev.list', 'playlist', 'playlist',
    'Benchmark Playlist', '2026-08-09T12:00:00Z', NULL, false,
    'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
    '3jqfcqzm3fo2j', 1786294800000000
), (
    'at://did:plc:bench/fm.plyr.dev.list/album',
    'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
    'did:plc:bench', 'fm.plyr.dev.list', 'album', 'album',
    'Benchmark Album', '2026-08-08T12:00:00Z', NULL, false,
    'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
    '3jqfcqzm3fo2j', 1786208400000000
);
INSERT INTO plyr_index.list_members
SELECT
    'at://did:plc:bench/fm.plyr.dev.list/playlist',
    n - 1,
    format('at://did:plc:bench/fm.plyr.dev.track/track-%s', n),
    'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku'
FROM generate_series(1, 20) AS n;
INSERT INTO plyr_index.list_members
SELECT
    'at://did:plc:bench/fm.plyr.dev.list/album',
    n - 1,
    format('at://did:plc:bench/fm.plyr.dev.track/track-%s', n),
    'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku'
FROM generate_series(1, 20) AS n;

INSERT INTO tracks
SELECT
    format('at://did:plc:bench/fm.plyr.dev.track/track-%s', n),
    TIMESTAMPTZ '2026-08-08 12:00:00+00' + n * INTERVAL '1 second',
    format('https://r2.example/audio-%s.flac', n), 'audio/flac', 'public',
    NULL, '[]', NULL, 10000 + n, 'published'
FROM generate_series(1, 100) AS n;

CREATE INDEX track_records_owner_created_bench
    ON plyr_index.track_records (owner_did, record_created_at, record_uri)
    WHERE NOT deleted;
CREATE INDEX tracks_created_uri_bench
    ON tracks (created_at DESC, atproto_record_uri DESC);
CREATE INDEX list_records_owner_type_bench
    ON plyr_index.list_records (owner_did, list_type, record_created_at, record_uri)
    WHERE NOT deleted;
CREATE INDEX like_records_subject_bench
    ON plyr_index.like_records (subject_uri, subject_cid)
    WHERE NOT deleted;
CREATE INDEX ix_plyr_index_track_records_title_trgm
    ON plyr_index.track_records USING gin (title gin_trgm_ops)
    WHERE NOT deleted;
CREATE INDEX ix_plyr_index_list_records_name_trgm
    ON plyr_index.list_records USING gin (name gin_trgm_ops)
    WHERE NOT deleted AND name IS NOT NULL;

ANALYZE;
