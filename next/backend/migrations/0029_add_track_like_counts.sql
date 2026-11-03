-- Every track response counted its likes with a per-row subquery, and the
-- chart aggregated the whole like table on each request. Keep the count
-- instead: distinct available accounts with a live like of the subject,
-- per like collection. Triggers recompute one subject at a time under an
-- advisory lock, so any writer (stream projector, snapshot reconciler,
-- repair, account reconciler) keeps it exact without coordinating.

CREATE TABLE plyr_index.track_like_counts (
    collection TEXT NOT NULL,
    subject_uri TEXT NOT NULL,
    subject_cid TEXT NOT NULL,
    like_count BIGINT NOT NULL,
    PRIMARY KEY (collection, subject_uri, subject_cid),
    CONSTRAINT ck_track_like_counts_positive CHECK (like_count > 0)
);

CREATE FUNCTION plyr_index.refresh_like_count(
    target_collection TEXT, target_uri TEXT, target_cid TEXT
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, plyr_index AS $$
DECLARE
    counted BIGINT;
BEGIN
    -- serializes writers of one subject; under READ COMMITTED the count below
    -- then sees every like committed before the lock was granted
    PERFORM pg_advisory_xact_lock(
        hashtextextended(target_collection || ' ' || target_uri || ' ' || target_cid, 0)
    );
    SELECT count(DISTINCT likes.owner_did) INTO counted
    FROM like_records AS likes
    JOIN account_availability AS liker
      ON liker.repo_did = likes.owner_did AND liker.available
    WHERE likes.collection = target_collection
      AND likes.subject_uri = target_uri AND likes.subject_cid = target_cid
      AND NOT likes.deleted;
    IF counted = 0 THEN
        DELETE FROM track_like_counts
        WHERE collection = target_collection
          AND subject_uri = target_uri AND subject_cid = target_cid;
    ELSE
        INSERT INTO track_like_counts (collection, subject_uri, subject_cid, like_count)
        VALUES (target_collection, target_uri, target_cid, counted)
        ON CONFLICT (collection, subject_uri, subject_cid)
        DO UPDATE SET like_count = EXCLUDED.like_count;
    END IF;
END
$$;

CREATE FUNCTION plyr_index.like_records_refresh_count() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, plyr_index AS $$
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.subject_uri IS NOT NULL THEN
        PERFORM refresh_like_count(OLD.collection, OLD.subject_uri, OLD.subject_cid);
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.subject_uri IS NOT NULL
        AND (TG_OP = 'INSERT' OR NEW.collection IS DISTINCT FROM OLD.collection
            OR NEW.subject_uri IS DISTINCT FROM OLD.subject_uri
            OR NEW.subject_cid IS DISTINCT FROM OLD.subject_cid) THEN
        PERFORM refresh_like_count(NEW.collection, NEW.subject_uri, NEW.subject_cid);
    END IF;
    RETURN NULL;
END
$$;

CREATE FUNCTION plyr_index.account_availability_refresh_counts() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, plyr_index AS $$
DECLARE
    did TEXT;
    subject RECORD;
BEGIN
    did := CASE WHEN TG_OP = 'DELETE' THEN OLD.repo_did ELSE NEW.repo_did END;
    FOR subject IN
        SELECT DISTINCT likes.collection, likes.subject_uri, likes.subject_cid
        FROM like_records AS likes
        WHERE likes.owner_did = did AND NOT likes.deleted
    LOOP
        PERFORM refresh_like_count(subject.collection, subject.subject_uri, subject.subject_cid);
    END LOOP;
    RETURN NULL;
END
$$;

CREATE FUNCTION plyr_index.track_like_counts_reset() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, plyr_index AS $$
BEGIN
    TRUNCATE track_like_counts;
    INSERT INTO track_like_counts (collection, subject_uri, subject_cid, like_count)
    SELECT likes.collection, likes.subject_uri, likes.subject_cid, count(DISTINCT likes.owner_did)
    FROM like_records AS likes
    JOIN account_availability AS liker
      ON liker.repo_did = likes.owner_did AND liker.available
    WHERE NOT likes.deleted
    GROUP BY likes.collection, likes.subject_uri, likes.subject_cid;
    RETURN NULL;
END
$$;

CREATE TRIGGER like_records_refresh_count
    AFTER INSERT OR UPDATE OR DELETE ON plyr_index.like_records
    FOR EACH ROW EXECUTE FUNCTION plyr_index.like_records_refresh_count();
CREATE TRIGGER account_availability_refresh_counts
    AFTER INSERT OR DELETE OR UPDATE OF available ON plyr_index.account_availability
    FOR EACH ROW EXECUTE FUNCTION plyr_index.account_availability_refresh_counts();
CREATE TRIGGER like_records_reset_counts
    AFTER TRUNCATE ON plyr_index.like_records
    FOR EACH STATEMENT EXECUTE FUNCTION plyr_index.track_like_counts_reset();
CREATE TRIGGER account_availability_reset_counts
    AFTER TRUNCATE ON plyr_index.account_availability
    FOR EACH STATEMENT EXECUTE FUNCTION plyr_index.track_like_counts_reset();

INSERT INTO plyr_index.track_like_counts (collection, subject_uri, subject_cid, like_count)
SELECT likes.collection, likes.subject_uri, likes.subject_cid, count(DISTINCT likes.owner_did)
FROM plyr_index.like_records AS likes
JOIN plyr_index.account_availability AS liker
  ON liker.repo_did = likes.owner_did AND liker.available
WHERE NOT likes.deleted
GROUP BY likes.collection, likes.subject_uri, likes.subject_cid;

-- the period chart counts likes in a recent window
CREATE INDEX ix_like_records_collection_created_us
    ON plyr_index.like_records (collection, record_created_at_us)
    WHERE NOT deleted AND record_created_at_us IS NOT NULL;
