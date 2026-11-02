-- converted from alembic revision c69d4e8a217f (grant_zig_canary_play_writes) on codex/zig-backend


DO $grants$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plyr_zig_canary') THEN
        EXECUTE 'GRANT INSERT, UPDATE ON plyr_index.track_metrics TO plyr_zig_canary';
        EXECUTE 'GRANT UPDATE (play_count) ON public.tracks TO plyr_zig_canary';
        EXECUTE 'GRANT SELECT ON public.share_links TO plyr_zig_canary';
        EXECUTE 'GRANT INSERT ON public.share_link_events TO plyr_zig_canary';
        EXECUTE 'GRANT USAGE ON SEQUENCE public.share_link_events_id_seq TO plyr_zig_canary';
    END IF;
END
$grants$;
