CREATE TABLE plyr_index.play_receipts (
    occurrence UUID PRIMARY KEY,
    record_uri TEXT NOT NULL,
    accepted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    counted BOOLEAN NOT NULL,
    play_count BIGINT NOT NULL CHECK (play_count >= 0),
    window_seconds INTEGER NOT NULL CHECK (window_seconds BETWEEN 30 AND 3600)
);

CREATE INDEX play_receipts_counted_time
    ON plyr_index.play_receipts (accepted_at) WHERE counted;

CREATE TABLE plyr_index.play_cooldowns (
    listener_hash BYTEA NOT NULL CHECK (octet_length(listener_hash) = 32),
    record_uri TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (listener_hash, record_uri)
);

CREATE INDEX play_cooldowns_expiry ON plyr_index.play_cooldowns (expires_at);

CREATE FUNCTION plyr_index.record_play(
    requested_occurrence UUID,
    requested_record TEXT,
    requested_listener BYTEA
) RETURNS TABLE (status TEXT, total BIGINT, counted BOOLEAN, window_seconds INTEGER)
LANGUAGE plpgsql
SET search_path = pg_catalog, plyr_index
AS $function$
DECLARE
    existing plyr_index.play_receipts%ROWTYPE;
    duration BIGINT;
    current_total BIGINT;
    cooldown_seconds INTEGER;
    admitted BOOLEAN;
    observed_at TIMESTAMPTZ;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(requested_occurrence::TEXT, 71934));
    SELECT * INTO existing FROM plyr_index.play_receipts
        WHERE occurrence = requested_occurrence;
    IF FOUND THEN
        IF existing.record_uri <> requested_record THEN
            RETURN QUERY SELECT 'conflict'::TEXT, NULL::BIGINT, FALSE, 0;
        ELSE
            RETURN QUERY SELECT 'duplicate'::TEXT, existing.play_count,
                existing.counted, existing.window_seconds;
        END IF;
        RETURN;
    END IF;

    SELECT v.duration_seconds, COALESCE(m.play_count, 0)
        INTO duration, current_total
        FROM plyr_index.track_records AS v
        JOIN plyr_index.account_availability AS aa
          ON aa.repo_did = v.owner_did AND aa.available
        LEFT JOIN plyr_index.track_policies AS pol ON pol.record_uri = v.record_uri
        LEFT JOIN plyr_index.track_metrics AS m ON m.record_uri = v.record_uri
        WHERE v.record_uri = requested_record
          AND NOT v.deleted
          AND COALESCE(pol.visibility, 'public') <> 'private'
          AND pol.moderation_decision IS DISTINCT FROM 'exclude'
          AND (
            pol.moderation_decision IS NOT DISTINCT FROM 'allow'
            OR NOT (
              v.self_labels && ARRAY['copyright-violation']::TEXT[]
              OR COALESCE(pol.operator_labels, '[]'::JSONB) ?| ARRAY['copyright-violation']
            )
          );
    IF NOT FOUND THEN
        RETURN QUERY SELECT 'not_found'::TEXT, NULL::BIGINT, FALSE, 0;
        RETURN;
    END IF;
    IF current_total < 0 OR duration < 0 THEN
        RAISE EXCEPTION 'corrupt play metrics';
    END IF;
    cooldown_seconds := GREATEST(30, LEAST(COALESCE(duration, 300), 3600))::INTEGER;
    observed_at := clock_timestamp();

    INSERT INTO plyr_index.play_cooldowns AS c (listener_hash, record_uri, expires_at)
        VALUES (requested_listener, requested_record,
            observed_at + make_interval(secs => cooldown_seconds))
        ON CONFLICT (listener_hash, record_uri) DO UPDATE
            SET expires_at = EXCLUDED.expires_at
            WHERE c.expires_at <= observed_at
        RETURNING TRUE INTO admitted;
    admitted := COALESCE(admitted, FALSE);

    IF admitted THEN
        INSERT INTO plyr_index.track_metrics AS m
            (record_uri, play_count, write_source, observed_at_us)
            VALUES (requested_record, 1, 'http_play',
                (extract(epoch FROM observed_at) * 1000000)::BIGINT)
            ON CONFLICT (record_uri) DO UPDATE
                SET play_count = m.play_count + 1,
                    write_source = EXCLUDED.write_source,
                    observed_at_us = EXCLUDED.observed_at_us
            RETURNING play_count INTO current_total;
    ELSE
        SELECT m.play_count INTO current_total FROM plyr_index.track_metrics AS m
            WHERE m.record_uri = requested_record;
        current_total := COALESCE(current_total, 0);
    END IF;

    INSERT INTO plyr_index.play_receipts
        (occurrence, record_uri, accepted_at, counted, play_count, window_seconds)
        VALUES (requested_occurrence, requested_record, observed_at,
            admitted, current_total, cooldown_seconds);
    DELETE FROM plyr_index.play_cooldowns WHERE (listener_hash, record_uri) IN (
        SELECT c.listener_hash, c.record_uri FROM plyr_index.play_cooldowns AS c
        WHERE c.expires_at <= observed_at ORDER BY c.expires_at
        LIMIT 32 FOR UPDATE SKIP LOCKED
    );

    RETURN QUERY SELECT CASE WHEN admitted THEN 'claimed' ELSE 'suppressed' END,
        current_total, admitted, cooldown_seconds;
END
$function$;

REVOKE ALL ON FUNCTION plyr_index.record_play(UUID, TEXT, BYTEA) FROM PUBLIC;

DO $grants$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plyr_zig_canary') THEN
        GRANT SELECT, INSERT ON plyr_index.play_receipts TO plyr_zig_canary;
        GRANT SELECT, INSERT, UPDATE, DELETE ON plyr_index.play_cooldowns TO plyr_zig_canary;
        GRANT EXECUTE ON FUNCTION plyr_index.record_play(UUID, TEXT, BYTEA) TO plyr_zig_canary;
    END IF;
END
$grants$;
