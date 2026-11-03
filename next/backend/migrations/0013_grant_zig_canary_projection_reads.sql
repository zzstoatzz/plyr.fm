-- converted from alembic revision a47e19c83b20 (grant_zig_canary_projection_reads) on codex/zig-backend


DO $grants$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plyr_zig_canary') THEN
        EXECUTE 'GRANT USAGE ON SCHEMA plyr_index TO plyr_zig_canary';
        EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA plyr_index TO plyr_zig_canary';
        EXECUTE 'GRANT SELECT ON public.tracks, public.artists, public.albums, public.user_preferences TO plyr_zig_canary';
        EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA plyr_index GRANT SELECT ON TABLES TO plyr_zig_canary';
    END IF;
END
$grants$;
