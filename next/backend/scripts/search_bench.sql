-- Extend the common read-model fixture to a catalog large enough to exercise
-- trigram candidate selection. This file is intentionally destructive and
-- independently refuses every database except zig_bench.
DO $$
BEGIN
    IF current_database() <> 'zig_bench' THEN
        RAISE EXCEPTION 'search benchmark only permits zig_bench';
    END IF;
END
$$;

INSERT INTO plyr_index.track_records
SELECT
    format('at://did:plc:bench/fm.plyr.dev.track/search-%s', n),
    'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
    'did:plc:bench', 'fm.plyr.dev.track', format('search-%s', n),
    CASE WHEN n = 20000 THEN 'Distinctive Search Needle'
         ELSE format('Catalog Recording %s', n) END,
    'Authored Credit', 'audio/flac',
    to_char(TIMESTAMPTZ '2026-08-08 12:00:00+00' + n * INTERVAL '1 second',
        'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    format('https://pds.example/search-%s.flac', n),
    'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
    'audio/flac', 4096, NULL, 180, '{}', NULL, NULL,
    format('Search benchmark description %s', n), '{}', false,
    'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
    '3jqfcqzm3fo2j', 1786208400000000 + n
FROM generate_series(101, 20000) AS n;

INSERT INTO plyr_index.track_policies (
    record_uri, visibility, space_uri,
    access_write_source, access_observed_at_us
)
SELECT
    format('at://did:plc:bench/fm.plyr.dev.track/search-%s', n),
    'public', NULL, 'legacy_import', 1786208400000000 + n
FROM generate_series(101, 20000) AS n;

ANALYZE plyr_index.track_records;
ANALYZE plyr_index.list_records;
ANALYZE artists;
