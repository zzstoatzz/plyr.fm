-- Track, like and list queries sorted and paged on
-- record_created_at::timestamptz, a cast no index can serve, so each page
-- sorted every visible row. The cast also raises for year 0, which the
-- atproto datetime profile allows: one such record made every list over its
-- table fail. Store the instant once at write time, from a trigger so every
-- writer (stream projector, snapshot reconciler, repair) keeps it, and NULL
-- when Postgres cannot represent the datetime. Queries skip NULL rows.

CREATE FUNCTION plyr_index.set_record_created_at_us() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        NEW.record_created_at_us :=
            (extract(epoch FROM NEW.record_created_at::timestamptz) * 1000000)::bigint;
    EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
        NEW.record_created_at_us := NULL;
    END;
    RETURN NEW;
END
$$;

ALTER TABLE plyr_index.track_records ADD COLUMN record_created_at_us BIGINT;
ALTER TABLE plyr_index.like_records ADD COLUMN record_created_at_us BIGINT;
ALTER TABLE plyr_index.list_records ADD COLUMN record_created_at_us BIGINT;

CREATE TRIGGER track_records_created_at_us
    BEFORE INSERT OR UPDATE OF record_created_at ON plyr_index.track_records
    FOR EACH ROW EXECUTE FUNCTION plyr_index.set_record_created_at_us();
CREATE TRIGGER like_records_created_at_us
    BEFORE INSERT OR UPDATE OF record_created_at ON plyr_index.like_records
    FOR EACH ROW EXECUTE FUNCTION plyr_index.set_record_created_at_us();
CREATE TRIGGER list_records_created_at_us
    BEFORE INSERT OR UPDATE OF record_created_at ON plyr_index.list_records
    FOR EACH ROW EXECUTE FUNCTION plyr_index.set_record_created_at_us();

-- these fire the triggers for existing rows
UPDATE plyr_index.track_records SET record_created_at = record_created_at
WHERE record_created_at IS NOT NULL;
UPDATE plyr_index.like_records SET record_created_at = record_created_at
WHERE record_created_at IS NOT NULL;
UPDATE plyr_index.list_records SET record_created_at = record_created_at
WHERE record_created_at IS NOT NULL;

-- plain CREATE INDEX: scripts/migrate runs each file in one transaction
CREATE INDEX ix_track_records_collection_created_us
    ON plyr_index.track_records (collection, record_created_at_us DESC, record_uri DESC)
    WHERE NOT deleted AND record_created_at_us IS NOT NULL;
CREATE INDEX ix_track_records_owner_created_us
    ON plyr_index.track_records (owner_did, collection, record_created_at_us DESC, record_uri DESC)
    WHERE NOT deleted AND record_created_at_us IS NOT NULL;
CREATE INDEX ix_like_records_subject_created_us
    ON plyr_index.like_records (subject_uri, subject_cid, record_created_at_us DESC, record_uri DESC)
    WHERE NOT deleted AND record_created_at_us IS NOT NULL;
CREATE INDEX ix_like_records_owner_created_us
    ON plyr_index.like_records (owner_did, record_created_at_us DESC, record_uri DESC)
    WHERE NOT deleted AND record_created_at_us IS NOT NULL;
CREATE INDEX ix_list_records_collection_created_us
    ON plyr_index.list_records (collection, list_type, record_created_at_us DESC, record_uri DESC)
    WHERE NOT deleted AND record_created_at_us IS NOT NULL;
