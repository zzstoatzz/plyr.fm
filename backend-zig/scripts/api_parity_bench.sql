-- Equivalent public catalogue fixtures for Python /tracks/ and Zig /v1/tracks.
-- Destructive by design and guarded to a dedicated disposable database.

DO $$
BEGIN
    IF current_database() <> 'plyr_bench' THEN
        RAISE EXCEPTION 'API parity benchmark only permits plyr_bench';
    END IF;
END
$$;

TRUNCATE TABLE
    track_likes,
    track_comments,
    track_tags,
    tracks,
    user_preferences,
    artists
RESTART IDENTITY CASCADE;

TRUNCATE TABLE
    plyr_index.like_records,
    plyr_index.list_members,
    plyr_index.list_records,
    plyr_index.track_delivery_origins,
    plyr_index.track_metrics,
    plyr_index.track_policies,
    plyr_index.track_records,
    plyr_index.profile_records,
    plyr_index.account_availability
CASCADE;

INSERT INTO artists (
    did, handle, display_name, bio, avatar_url, pds_url,
    deactivated, created_at, updated_at
)
VALUES (
    'did:plc:bench', 'benchmark.test', 'Benchmark Artist',
    'Equivalent Python and Zig benchmark fixture',
    'https://pds.example/avatar.jpg', 'https://pds.example',
    false, '2026-08-08T12:00:00Z', '2026-08-08T12:00:00Z'
);

INSERT INTO tracks (
    id, title, file_id, file_type, created_at, artist_did, extra, features,
    r2_url, atproto_record_uri, atproto_record_cid, atproto_record_rev,
    self_labels, operator_labels, audio_storage, publish_state, description,
    play_count, visibility, notification_sent
)
SELECT
    n,
    format('Verified Track %s', n),
    format('benchmark-audio-%s', n),
    'audio/flac',
    TIMESTAMPTZ '2026-08-08 12:00:00+00' + n * INTERVAL '1 second',
    'did:plc:bench',
    jsonb_build_object('duration', 180, 'album', 'Benchmark Album'),
    '[]'::jsonb,
    format('https://r2.example/audio-%s.flac', n),
    format('at://did:plc:bench/fm.plyr.dev.track/track-%s', n),
    'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
    '3jqfcqzm3fo2j',
    '[]'::jsonb,
    '[]'::jsonb,
    'r2',
    'published',
    format('Benchmark description %s', n),
    n,
    'public',
    false
FROM generate_series(1, 100) AS n;

SELECT setval('tracks_id_seq', 100, true);

INSERT INTO plyr_index.profile_records (
    record_uri, record_cid, owner_did, collection, rkey, avatar, bio,
    record_created_at, deleted, commit_cid, commit_rev, indexed_at_us
)
VALUES (
    'at://did:plc:bench/fm.plyr.dev.actor.profile/self',
    'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
    'did:plc:bench', 'fm.plyr.dev.actor.profile', 'self',
    'https://pds.example/avatar.jpg',
    'Equivalent Python and Zig benchmark fixture',
    '2026-08-08T12:00:00Z', false,
    'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
    '3jqfcqzm3fo2j', 1786208400000000
);

INSERT INTO plyr_index.account_availability (
    repo_did, available, evidence_source, repository_rev, commit_cid,
    observed_at_us
)
VALUES (
    'did:plc:bench', true, 'verified_repository', '3jqfcqzm3fo2j',
    'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
    1786208400000000
);

INSERT INTO plyr_index.track_records (
    record_uri, record_cid, owner_did, collection, rkey, title, artist_name,
    file_type, record_created_at, audio_url, audio_blob_cid,
    audio_blob_media_type, audio_blob_size, album, duration_seconds,
    featured_dids, image_url, description, self_labels, deleted, commit_cid,
    commit_rev, indexed_at_us
)
SELECT
    format('at://did:plc:bench/fm.plyr.dev.track/track-%s', n),
    'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
    'did:plc:bench', 'fm.plyr.dev.track', format('track-%s', n),
    format('Verified Track %s', n), 'Benchmark Artist', 'audio/flac',
    to_char(
        TIMESTAMPTZ '2026-08-08 12:00:00+00' + n * INTERVAL '1 second',
        'YYYY-MM-DD"T"HH24:MI:SS"Z"'
    ),
    format('https://pds.example/audio-%s.flac', n),
    'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
    'audio/flac', 4096, 'Benchmark Album', 180, '{}', NULL,
    format('Benchmark description %s', n), '{}', false,
    'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
    '3jqfcqzm3fo2j', 1786208400000000 + n
FROM generate_series(1, 100) AS n;

INSERT INTO plyr_index.track_delivery_origins (
    record_uri, service, record_cid, origin_url, media_type, artifact_cid,
    verification, observed_at_us
)
SELECT
    format('at://did:plc:bench/fm.plyr.dev.track/track-%s', n),
    'r2',
    'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
    format('https://r2.example/audio-%s.flac', n), 'audio/flac',
    'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
    'verified_blob_cid', 1786208400000000 + n
FROM generate_series(1, 100) AS n;

INSERT INTO plyr_index.track_policies (
    record_uri, visibility, access_write_source, access_observed_at_us,
    operator_labels
)
SELECT
    format('at://did:plc:bench/fm.plyr.dev.track/track-%s', n),
    'public', 'legacy_import', 1786208400000000 + n, '[]'::jsonb
FROM generate_series(1, 100) AS n;

INSERT INTO plyr_index.track_metrics (
    record_uri, play_count, write_source, observed_at_us
)
SELECT
    format('at://did:plc:bench/fm.plyr.dev.track/track-%s', n),
    n, 'legacy_import', 1786208400000000 + n
FROM generate_series(1, 100) AS n;
