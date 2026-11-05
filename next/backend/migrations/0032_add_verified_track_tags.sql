CREATE FUNCTION plyr_index.normalize_track_tags(values_ text[])
RETURNS text[] LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
    SELECT COALESCE(array_agg(tag ORDER BY tag), '{}'::text[])
    FROM (
        SELECT DISTINCT btrim(regexp_replace(lower(btrim(value)), '\s+', ' ', 'g'), '-') AS tag
        FROM unnest(values_) AS value
    ) normalized
    WHERE tag <> ''
$$;

CREATE TABLE plyr_index.track_tag_records (
    record_uri text PRIMARY KEY REFERENCES plyr_index.track_records(record_uri) ON DELETE CASCADE,
    record_cid text NOT NULL,
    tags text[] NOT NULL,
    tags_present boolean NOT NULL DEFAULT false,
    CONSTRAINT ck_track_tag_records_bound CHECK (cardinality(tags) <= 20 AND array_position(tags, NULL) IS NULL
        AND (tags_present OR cardinality(tags) = 0))
);
CREATE INDEX ix_track_tag_records_tags ON plyr_index.track_tag_records USING gin(tags);
