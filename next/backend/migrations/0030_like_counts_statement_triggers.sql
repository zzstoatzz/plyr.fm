-- 0029's like-count trigger ran per row and took a transaction-scoped
-- advisory lock per subject. Those locks live in the shared lock table until
-- commit, so one transaction touching more distinct subjects than
-- max_locks_per_transaction allows (about 6,400 by default) failed with
-- "out of shared memory", and every row paid its own recount. Recount per
-- statement instead, from transition tables, serializing writers of a
-- subject with row locks on its count, which take no lock-table space.
-- Counts now stay as rows at zero, so there is always a row to lock.

ALTER TABLE plyr_index.track_like_counts DROP CONSTRAINT ck_track_like_counts_positive;
ALTER TABLE plyr_index.track_like_counts
    ADD CONSTRAINT ck_track_like_counts_nonnegative CHECK (like_count >= 0);

DROP TRIGGER like_records_refresh_count ON plyr_index.like_records;
DROP TRIGGER account_availability_refresh_counts ON plyr_index.account_availability;
DROP FUNCTION plyr_index.like_records_refresh_count();
DROP FUNCTION plyr_index.account_availability_refresh_counts();
DROP FUNCTION plyr_index.refresh_like_count(TEXT, TEXT, TEXT);

CREATE FUNCTION plyr_index.refresh_like_counts(
    collections TEXT[], uris TEXT[], cids TEXT[]
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, plyr_index AS $$
BEGIN
    INSERT INTO track_like_counts (collection, subject_uri, subject_cid, like_count)
    SELECT DISTINCT k.collection, k.subject_uri, k.subject_cid, 0
    FROM unnest(collections, uris, cids) AS k (collection, subject_uri, subject_cid)
    ORDER BY 1, 2, 3
    ON CONFLICT DO NOTHING;
    -- key order, so two statements over overlapping subjects cannot deadlock
    -- here; under READ COMMITTED the recount below then sees every like
    -- committed before the locks were granted
    PERFORM 1
    FROM track_like_counts AS c
    JOIN unnest(collections, uris, cids) AS k (collection, subject_uri, subject_cid)
      ON k.collection = c.collection AND k.subject_uri = c.subject_uri
      AND k.subject_cid = c.subject_cid
    ORDER BY c.collection, c.subject_uri, c.subject_cid
    FOR UPDATE OF c;
    UPDATE track_like_counts AS c
    SET like_count = (
        SELECT count(DISTINCT likes.owner_did)
        FROM like_records AS likes
        JOIN account_availability AS liker
          ON liker.repo_did = likes.owner_did AND liker.available
        WHERE likes.collection = c.collection
          AND likes.subject_uri = c.subject_uri AND likes.subject_cid = c.subject_cid
          AND NOT likes.deleted
    )
    FROM (
        SELECT DISTINCT collection, subject_uri, subject_cid
        FROM unnest(collections, uris, cids) AS k (collection, subject_uri, subject_cid)
    ) AS k
    WHERE k.collection = c.collection AND k.subject_uri = c.subject_uri
      AND k.subject_cid = c.subject_cid;
END
$$;

CREATE FUNCTION plyr_index.like_records_refresh_counts() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, plyr_index AS $$
DECLARE
    collections TEXT[];
    uris TEXT[];
    cids TEXT[];
BEGIN
    IF TG_OP = 'INSERT' THEN
        SELECT array_agg(collection), array_agg(subject_uri), array_agg(subject_cid)
        INTO collections, uris, cids
        FROM (SELECT DISTINCT collection, subject_uri, subject_cid FROM new_rows
              WHERE subject_uri IS NOT NULL) AS changed;
    ELSIF TG_OP = 'DELETE' THEN
        SELECT array_agg(collection), array_agg(subject_uri), array_agg(subject_cid)
        INTO collections, uris, cids
        FROM (SELECT DISTINCT collection, subject_uri, subject_cid FROM old_rows
              WHERE subject_uri IS NOT NULL) AS changed;
    ELSE
        SELECT array_agg(collection), array_agg(subject_uri), array_agg(subject_cid)
        INTO collections, uris, cids
        FROM (SELECT collection, subject_uri, subject_cid FROM old_rows WHERE subject_uri IS NOT NULL
              UNION
              SELECT collection, subject_uri, subject_cid FROM new_rows WHERE subject_uri IS NOT NULL
             ) AS changed;
    END IF;
    IF collections IS NOT NULL THEN
        PERFORM refresh_like_counts(collections, uris, cids);
    END IF;
    RETURN NULL;
END
$$;

CREATE FUNCTION plyr_index.account_availability_refresh_counts() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, plyr_index AS $$
DECLARE
    collections TEXT[];
    uris TEXT[];
    cids TEXT[];
BEGIN
    SELECT array_agg(collection), array_agg(subject_uri), array_agg(subject_cid)
    INTO collections, uris, cids
    FROM (
        SELECT DISTINCT likes.collection, likes.subject_uri, likes.subject_cid
        FROM like_records AS likes
        WHERE likes.owner_did = CASE WHEN TG_OP = 'DELETE' THEN OLD.repo_did ELSE NEW.repo_did END
          AND NOT likes.deleted
    ) AS liked;
    IF collections IS NOT NULL THEN
        PERFORM refresh_like_counts(collections, uris, cids);
    END IF;
    RETURN NULL;
END
$$;

CREATE TRIGGER like_records_inserted_counts
    AFTER INSERT ON plyr_index.like_records
    REFERENCING NEW TABLE AS new_rows
    FOR EACH STATEMENT EXECUTE FUNCTION plyr_index.like_records_refresh_counts();
CREATE TRIGGER like_records_updated_counts
    AFTER UPDATE ON plyr_index.like_records
    REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
    FOR EACH STATEMENT EXECUTE FUNCTION plyr_index.like_records_refresh_counts();
CREATE TRIGGER like_records_deleted_counts
    AFTER DELETE ON plyr_index.like_records
    REFERENCING OLD TABLE AS old_rows
    FOR EACH STATEMENT EXECUTE FUNCTION plyr_index.like_records_refresh_counts();
CREATE TRIGGER account_availability_refresh_counts
    AFTER INSERT OR DELETE OR UPDATE OF available ON plyr_index.account_availability
    FOR EACH ROW EXECUTE FUNCTION plyr_index.account_availability_refresh_counts();
