-- Actor presentation owned by the zig appview instead of python's public.artists.
-- handle: DID document alsoKnownAs, kept only when the handle resolves back to
-- the DID ('handle.invalid' otherwise, per the atproto handle spec).
-- display_name / avatar_url: the actor's own app.bsky.actor.profile/self record,
-- falling back to the handle. Rows are disposable: the identity refresher in
-- the ingester rebuilds them from DID documents and PDSes.
CREATE TABLE plyr_index.actor_identities (
    did TEXT NOT NULL,
    handle TEXT NOT NULL,
    display_name TEXT NOT NULL,
    avatar_url TEXT,
    pds_origin TEXT,
    refreshed_at_us BIGINT NOT NULL,
    next_refresh_us BIGINT NOT NULL,
    failures INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (did),
    CONSTRAINT ck_actor_identities_values CHECK (
        did LIKE 'did:%' AND handle = lower(handle) AND length(handle) BETWEEN 1 AND 253
        AND length(display_name) BETWEEN 1 AND 640
        AND refreshed_at_us >= 0 AND next_refresh_us >= 0 AND failures >= 0
    )
);

CREATE INDEX ix_actor_identities_handle ON plyr_index.actor_identities (handle);
CREATE INDEX ix_actor_identities_due ON plyr_index.actor_identities (next_refresh_us);
CREATE INDEX ix_actor_identities_handle_trgm
    ON plyr_index.actor_identities USING gin (handle gin_trgm_ops);
CREATE INDEX ix_actor_identities_display_name_trgm
    ON plyr_index.actor_identities USING gin (display_name gin_trgm_ops);

-- One-time seed from python's artists table where it exists (the next branch
-- was forked from staging), so presentation is there before the refresher's
-- first pass. Every seeded row is due immediately and gets re-verified.
DO $seed$
BEGIN
    IF to_regclass('public.artists') IS NOT NULL THEN
        EXECUTE $sql$
            INSERT INTO plyr_index.actor_identities (
                did, handle, display_name, avatar_url, pds_origin,
                refreshed_at_us, next_refresh_us, failures
            )
            SELECT did, lower(handle),
                left(COALESCE(NULLIF(btrim(display_name), ''), lower(handle)), 640),
                avatar_url, pds_url, 0, 0, 0
            FROM public.artists
            WHERE did LIKE 'did:%' AND length(handle) BETWEEN 1 AND 253
            ON CONFLICT (did) DO NOTHING
        $sql$;
    END IF;
END
$seed$;

-- The zig api no longer reads or writes python's public tables.
DO $revoke$
DECLARE
    legacy TEXT;
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plyr_zig_canary') THEN
        FOREACH legacy IN ARRAY ARRAY[
            'public.tracks', 'public.artists', 'public.albums', 'public.user_preferences',
            'public.share_links', 'public.share_link_events'
        ] LOOP
            IF to_regclass(legacy) IS NOT NULL THEN
                EXECUTE format('REVOKE ALL ON %s FROM plyr_zig_canary', legacy);
            END IF;
        END LOOP;
        IF to_regclass('public.share_link_events_id_seq') IS NOT NULL THEN
            EXECUTE 'REVOKE ALL ON public.share_link_events_id_seq FROM plyr_zig_canary';
        END IF;
    END IF;
END
$revoke$;
