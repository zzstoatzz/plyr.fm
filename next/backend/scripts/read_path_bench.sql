-- Catalog-sized fixture for read-path benchmarks: 500 artists, 20k tracks,
-- 2k likers and 100k likes skewed toward a few tracks. Apply on top of
-- `scripts/migrate` (over the Python schema, as CI does). Destructive by
-- design and guarded to a dedicated disposable database.

DO $$
BEGIN
    IF current_database() <> 'plyr_bench' THEN
        RAISE EXCEPTION 'read path benchmark only permits plyr_bench';
    END IF;
END
$$;

TRUNCATE TABLE
    plyr_index.like_records,
    plyr_index.list_members,
    plyr_index.list_records,
    plyr_index.track_delivery_origins,
    plyr_index.track_metrics,
    plyr_index.track_policies,
    plyr_index.track_records,
    plyr_index.profile_records,
    plyr_index.account_availability,
    plyr_index.actor_identities
CASCADE;

INSERT INTO plyr_index.actor_identities (
    did, handle, display_name, avatar_url, pds_origin, refreshed_at_us,
    next_refresh_us
)
SELECT
    format('did:plc:bench%s', n), format('artist%s.bench.test', n),
    format('Bench Artist %s', n), NULL, 'https://pds.example',
    1786208400000000, 1886208400000000
FROM generate_series(1, 500) AS n;

INSERT INTO plyr_index.profile_records (
    record_uri, record_cid, owner_did, collection, rkey, avatar, bio,
    record_created_at, deleted, commit_cid, commit_rev, indexed_at_us
)
SELECT
    format('at://did:plc:bench%s/fm.plyr.dev.actor.profile/self', n),
    'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
    format('did:plc:bench%s', n), 'fm.plyr.dev.actor.profile', 'self',
    NULL, format('bench artist %s', n), '2026-08-08T12:00:00Z', false,
    'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
    '3jqfcqzm3fo2j', 1786208400000000
FROM generate_series(1, 500) AS n;

INSERT INTO plyr_index.account_availability (
    repo_did, available, evidence_source, repository_rev, commit_cid,
    observed_at_us
)
SELECT
    format('did:plc:bench%s', n), true, 'verified_repository', '3jqfcqzm3fo2j',
    'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
    1786208400000000
FROM generate_series(1, 500) AS n;

INSERT INTO plyr_index.track_records (
    record_uri, record_cid, owner_did, collection, rkey, title, artist_name,
    file_type, record_created_at, audio_url, audio_blob_cid,
    audio_blob_media_type, audio_blob_size, album, duration_seconds,
    featured_dids, image_url, description, self_labels, deleted, commit_cid,
    commit_rev, indexed_at_us
)
SELECT
    format('at://did:plc:bench%s/fm.plyr.dev.track/track-%s', n % 500 + 1, n),
    'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
    format('did:plc:bench%s', n % 500 + 1), 'fm.plyr.dev.track', format('track-%s', n),
    format('Bench Track %s', n), format('Bench Artist %s', n % 500 + 1), 'audio/flac',
    to_char(
        TIMESTAMPTZ '2026-08-08 12:00:00+00' + n * INTERVAL '1 minute',
        'YYYY-MM-DD"T"HH24:MI:SS"Z"'
    ),
    format('https://pds.example/audio-%s.flac', n),
    'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
    'audio/flac', 4096, NULL, 180, '{}', NULL,
    format('bench description %s', n), '{}', false,
    'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
    '3jqfcqzm3fo2j', 1786208400000000 + n
FROM generate_series(1, 20000) AS n;

INSERT INTO plyr_index.track_policies (
    record_uri, visibility, access_write_source, access_observed_at_us,
    operator_labels
)
SELECT record_uri, 'public', 'legacy_import', indexed_at_us, '[]'::jsonb
FROM plyr_index.track_records;

INSERT INTO plyr_index.track_metrics (
    record_uri, play_count, write_source, observed_at_us
)
SELECT record_uri, (hashtext(record_uri) & 1023), 'legacy_import', indexed_at_us
FROM plyr_index.track_records;

-- 100k likes: liker l likes 50 tracks, concentrated on low track numbers.
INSERT INTO plyr_index.like_records (
    record_uri, record_cid, owner_did, collection, rkey, subject_uri,
    subject_cid, record_created_at, deleted, commit_cid, commit_rev,
    indexed_at_us
)
SELECT
    format('at://did:plc:liker%s/fm.plyr.dev.like/like-%s', liker, k),
    'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
    format('did:plc:liker%s', liker), 'fm.plyr.dev.like', format('like-%s', k),
    format('at://did:plc:bench%s/fm.plyr.dev.track/track-%s', track % 500 + 1, track),
    'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
    to_char(TIMESTAMPTZ '2026-11-01 12:00:00+00' - (liker * 50 + k) * INTERVAL '1 minute',
        'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    false,
    'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
    '3jqfcqzm3fo2j', 1786294800000000 + liker * 50 + k
FROM generate_series(1, 2000) AS liker
CROSS JOIN LATERAL generate_series(1, 50) AS k
CROSS JOIN LATERAL (
    SELECT 1 + floor(power(((liker * 7919 + k * 104729) % 10007) / 10007.0, 3) * 19999)::int AS track
) AS pick;

ANALYZE;
