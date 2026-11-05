LOCK TABLE plyr_index.track_tag_records, plyr_index.legacy_track_tags IN SHARE ROW EXCLUSIVE MODE;

CREATE OR REPLACE FUNCTION plyr_index.normalize_track_tags(values_ text[])
RETURNS text[] LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
    SELECT COALESCE(array_agg(tag ORDER BY tag), '{}'::text[])
    FROM (
        SELECT DISTINCT btrim(regexp_replace(lower(value), '\s+', ' ', 'g'), ' -') AS tag
        FROM unnest(values_) AS value
    ) normalized
    WHERE tag <> ''
$$;

ALTER TABLE plyr_index.legacy_track_tags
    DROP CONSTRAINT ck_legacy_track_tags_tag,
    ADD CONSTRAINT ck_legacy_track_tags_tag CHECK (octet_length(tag) BETWEEN 1 AND 200);

UPDATE plyr_index.track_tag_records
SET tags = plyr_index.normalize_track_tags(tags)
WHERE tags IS DISTINCT FROM plyr_index.normalize_track_tags(tags);

WITH previous AS (
    DELETE FROM plyr_index.legacy_track_tags
    RETURNING record_uri, observed_record_cid, tag, source, source_track_id, source_observed_at, imported_at
), normalized AS (
    SELECT previous.*, canonical.tag AS canonical_tag
    FROM previous
    CROSS JOIN LATERAL unnest(plyr_index.normalize_track_tags(ARRAY[previous.tag])) AS canonical(tag)
)
INSERT INTO plyr_index.legacy_track_tags
    (record_uri, observed_record_cid, tag, source, source_track_id, source_observed_at, imported_at)
SELECT DISTINCT ON (record_uri, observed_record_cid, canonical_tag)
    record_uri, observed_record_cid, canonical_tag, source, source_track_id, source_observed_at, imported_at
FROM normalized
ORDER BY record_uri, observed_record_cid, canonical_tag,
    source_observed_at DESC, imported_at DESC, source_track_id DESC, tag;
