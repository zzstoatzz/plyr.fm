const std = @import("std");
const config = @import("config.zig");
const server = @import("server.zig");
const postgres = @import("internal/index/postgres_track_store.zig");
const postgres_composed_tracks = @import("internal/index/postgres_composed_track_store.zig");
const postgres_track_charts = @import("internal/index/postgres_track_chart_store.zig");
const postgres_playback = @import("internal/index/postgres_playback_store.zig");
const postgres_search = @import("internal/index/postgres_search_store.zig");
const postgres_artists = @import("internal/index/postgres_artist_store.zig");
const postgres_verified_lists = @import("internal/index/postgres_verified_list_store.zig");
const postgres_play_metrics = @import("internal/metrics/postgres_play_metric_store.zig");
const postgres_artist_metrics = @import("internal/metrics/postgres_artist_metric_store.zig");
const redis_play_dedup = @import("internal/metrics/redis_play_dedup_store.zig");
const repair_runner = @import("internal/ingest/repair_runner.zig");
const continuous_runner = @import("internal/ingest/continuous_runner.zig");
const catalog_reconcile_runner = @import("internal/ingest/catalog_reconcile_runner.zig");
const account_reconciler = @import("internal/account/reconciler.zig");
const postgres_auth = @import("internal/auth/postgres_store.zig");

var threaded_io: std.Io.Threaded = undefined;
pub const std_options_debug_threaded_io: ?*std.Io.Threaded = &threaded_io;

pub fn main() !void {
    const allocator = std.heap.smp_allocator;
    threaded_io = std.Io.Threaded.init(allocator, .{});
    const io = threaded_io.io();

    const settings = config.Config.fromEnvironment() catch |err| {
        std.log.err("invalid configuration: {}", .{err});
        return err;
    };

    var postgres_store: ?postgres.PostgresTrackStore = if (settings.database_url) |url|
        try postgres.PostgresTrackStore.init(allocator, io, url, settings.database_pool_size)
    else
        null;
    defer if (postgres_store) |*store| store.deinit();
    if (settings.database_role) |expected_role| {
        const store = if (postgres_store) |*value| value else return error.DatabaseRoleWithoutDatabase;
        try store.requireRole(expected_role);
    }

    var postgres_composed_track_store: ?postgres_composed_tracks.PostgresComposedTrackStore = if (postgres_store) |*store|
        .{ .pool = store.pool, .profile_collection = settings.profile_collection }
    else
        null;
    const track_store = if (postgres_composed_track_store) |*store| store.store() else null;
    var postgres_track_chart_store: ?postgres_track_charts.PostgresTrackChartStore = if (postgres_store) |*store|
        .{ .pool = store.pool }
    else
        null;
    const track_chart_store = if (postgres_track_chart_store) |*store| store.store() else null;
    var postgres_playback_store: ?postgres_playback.PostgresPlaybackStore = if (postgres_store) |*store|
        .{ .pool = store.pool }
    else
        null;
    const playback_store = if (postgres_playback_store) |*store| store.store() else null;
    var postgres_artist_store: ?postgres_artists.PostgresArtistStore = if (postgres_store) |*store|
        .{ .pool = store.pool, .profile_collection = settings.profile_collection }
    else
        null;
    const artist_store = if (postgres_artist_store) |*store| store.store() else null;
    var postgres_verified_list_store: ?postgres_verified_lists.PostgresVerifiedListStore = if (postgres_store) |*store|
        .{ .pool = store.pool }
    else
        null;
    const verified_list_store = if (postgres_verified_list_store) |*store| store.store() else null;
    var postgres_search_store: ?postgres_search.PostgresSearchStore = if (postgres_store) |*store|
        .{ .pool = store.pool }
    else
        null;
    const search_store = if (postgres_search_store) |*store| store.store() else null;
    var postgres_play_metric_store: ?postgres_play_metrics.PostgresPlayMetricStore = if (postgres_store) |*store|
        .{ .pool = store.pool }
    else
        null;
    const play_metric_store = if (postgres_play_metric_store) |*store| store.store() else null;
    var postgres_artist_metric_store: ?postgres_artist_metrics.PostgresArtistMetricStore = if (postgres_store) |*store|
        .{ .pool = store.pool }
    else
        null;
    const artist_metric_store = if (postgres_artist_metric_store) |*store| store.store() else null;
    switch (settings.role) {
        .account_reconciler => {
            const store = if (postgres_store) |*value| value else return error.AccountReconcilerDatabaseRequired;
            try account_reconciler.run(io, allocator, store.pool, .{
                .normal_interval_us = settings.account_check_interval_us,
                .retry_interval_us = settings.account_check_retry_us,
                .lease_duration_us = settings.account_check_lease_us,
                .seed_interval_us = settings.account_check_seed_us,
                .idle_sleep_ms = settings.account_check_idle_ms,
            });
        },
        .api => {
            var redis_play_dedup_store: ?redis_play_dedup.RedisPlayDedupStore = if (settings.redis_url) |url|
                try redis_play_dedup.RedisPlayDedupStore.init(allocator, io, url)
            else
                null;
            defer if (redis_play_dedup_store) |*store| store.deinit();
            const play_dedup_store = if (redis_play_dedup_store) |*store| store.store() else null;
            const auth_store: ?postgres_auth.PostgresAuthStore = if (settings.auth != null)
                if (postgres_store) |*store| .{ .pool = store.pool } else null
            else
                null;
            try server.run(io, settings.port, settings.max_connections, .{
                .io = io,
                .track_store = track_store,
                .track_chart_store = track_chart_store,
                .playback_store = playback_store,
                .artist_store = artist_store,
                .artist_metric_store = artist_metric_store,
                .verified_list_store = verified_list_store,
                .search_store = search_store,
                .play_metric_store = play_metric_store,
                .play_dedup_store = play_dedup_store,
                .track_collection = settings.track_collection,
                .list_collection = settings.list_collection,
                .profile_collection = settings.profile_collection,
                .cors = .{ .allowed_origins = settings.cors_allowed_origins },
                .auth = settings.auth,
                .auth_store = auth_store,
            });
        },
        .catalog_reconciler => {
            const store = if (postgres_store) |*value| value else return error.CatalogReconcilerDatabaseRequired;
            const report = try catalog_reconcile_runner.run(
                io,
                allocator,
                store.pool,
                settings.list_collection,
                settings.track_collection,
                settings.profile_collection,
                settings.like_collection,
            );
            std.log.info(
                "catalog reconciliation: {d} candidates, {d} verified, {d} absent, {d} retryable, {d} rejected",
                .{ report.candidates, report.verified, report.absent, report.retryable, report.rejected },
            );
            if (!report.complete()) return error.CatalogReconciliationIncomplete;
        },
        .repair => {
            const store = if (postgres_store) |*value| value else return error.RepairDatabaseRequired;
            const did = settings.repair_did orelse return error.RepairDidRequired;
            const outcome = try repair_runner.run(
                io,
                allocator,
                store.pool,
                did,
                settings.list_collection,
                settings.track_collection,
                settings.profile_collection,
                settings.like_collection,
            );
            std.log.info("verified repository repair for {s}: {s}", .{ did, @tagName(outcome) });
            if (!repair_runner.succeeded(outcome)) return error.RepairNotApplied;
        },
        .ingester => {
            const store = if (postgres_store) |*value| value else return error.IngesterDatabaseRequired;
            try continuous_runner.run(
                io,
                allocator,
                store.pool,
                settings.relay_hosts,
                settings.relay_name,
                settings.list_collection,
                settings.track_collection,
                settings.profile_collection,
                settings.like_collection,
            );
        },
    }
}

test {
    _ = @import("internal/auth/bearer_token.zig");
    _ = @import("internal/auth/sealed_secret.zig");
    _ = @import("internal/auth/postgres_store.zig");
    _ = @import("internal/account/availability.zig");
    _ = @import("internal/account/current_pds_status_source.zig");
    _ = @import("internal/account/check_schedule.zig");
    _ = @import("internal/account/postgres_availability_store.zig");
    _ = @import("internal/account/postgres_check_schedule.zig");
    _ = @import("internal/account/reconciler.zig");
    _ = @import("internal/account/repo_status.zig");
    _ = @import("api/response.zig");
    _ = @import("api/auth.zig");
    _ = @import("api/router.zig");
    _ = @import("api/artists.zig");
    _ = @import("api/charts.zig");
    _ = @import("api/albums.zig");
    _ = @import("api/tracks.zig");
    _ = @import("api/playlists.zig");
    _ = @import("api/search.zig");
    _ = @import("config.zig");
    _ = @import("internal/application/get_artist.zig");
    _ = @import("internal/application/get_artist_metrics.zig");
    _ = @import("internal/http/path_segment.zig");
    _ = @import("internal/application/get_album.zig");
    _ = @import("internal/application/list_albums.zig");
    _ = @import("internal/application/get_track.zig");
    _ = @import("internal/application/get_playback.zig");
    _ = @import("internal/application/list_tracks.zig");
    _ = @import("internal/application/list_track_chart.zig");
    _ = @import("internal/application/get_playlist.zig");
    _ = @import("internal/application/list_playlists.zig");
    _ = @import("internal/application/search_catalog.zig");
    _ = @import("internal/application/record_play.zig");
    _ = @import("internal/domain/artist.zig");
    _ = @import("internal/domain/track_chart.zig");
    _ = @import("internal/domain/artist_metrics.zig");
    _ = @import("internal/domain/playback.zig");
    _ = @import("internal/domain/verified_list.zig");
    _ = @import("internal/domain/search.zig");
    _ = @import("internal/atproto/list_record.zig");
    _ = @import("internal/atproto/lexicon_value.zig");
    _ = @import("internal/atproto/profile_record.zig");
    _ = @import("internal/atproto/like_record.zig");
    _ = @import("internal/atproto/track_record.zig");
    _ = @import("internal/index/artist_store.zig");
    _ = @import("internal/index/postgres_artist_store.zig");
    _ = @import("internal/identity/track_id.zig");
    _ = @import("internal/identity/track_cursor.zig");
    _ = @import("internal/identity/record_id.zig");
    _ = @import("internal/identity/record_cursor.zig");
    _ = @import("internal/identity/album_id.zig");
    _ = @import("internal/http/query.zig");
    _ = @import("internal/index/postgres_track_store.zig");
    _ = @import("internal/index/postgres_composed_track_store.zig");
    _ = @import("internal/index/playback_store.zig");
    _ = @import("internal/index/postgres_playback_store.zig");
    _ = @import("internal/index/verified_list_store.zig");
    _ = @import("internal/index/search_store.zig");
    _ = @import("internal/index/postgres_search_store.zig");
    _ = @import("internal/index/postgres_verified_list_store.zig");
    _ = @import("internal/metrics/play_dedup_store.zig");
    _ = @import("internal/metrics/play_metric_store.zig");
    _ = @import("internal/metrics/artist_metric_store.zig");
    _ = @import("internal/metrics/postgres_play_metric_store.zig");
    _ = @import("internal/metrics/postgres_artist_metric_store.zig");
    _ = @import("internal/metrics/redis_play_dedup_store.zig");
    _ = @import("internal/identity/playlist_id.zig");
    _ = @import("internal/identity/scoped_record_cursor.zig");
    _ = @import("internal/cache/lru.zig");
    _ = @import("internal/ingest/cached_signing_key_resolver.zig");
    _ = @import("internal/ingest/catalog_reconciler.zig");
    _ = @import("internal/ingest/catalog_reconcile_runner.zig");
    _ = @import("internal/ingest/continuous_runner.zig");
    _ = @import("internal/ingest/postgres_relay_cursor.zig");
    _ = @import("internal/ingest/postgres_repository_candidates.zig");
    _ = @import("internal/ingest/pinned_tls.zig");
    _ = @import("internal/ingest/relay_cursor.zig");
    _ = @import("internal/ingest/repository_source.zig");
    _ = @import("internal/ingest/repository_candidates.zig");
    _ = @import("internal/ingest/repair_runner.zig");
    _ = @import("internal/ingest/safe_endpoint.zig");
    _ = @import("internal/ingest/projector.zig");
    _ = @import("internal/ingest/signing_key.zig");
    _ = @import("internal/ingest/zat_repository_source.zig");
    _ = @import("internal/ingest/zat_pds_repository_source.zig");
    _ = @import("internal/ingest/zat_signing_key_resolver.zig");
    _ = @import("internal/ingest/watched_repositories.zig");
    _ = @import("internal/projection/list_change.zig");
    _ = @import("internal/projection/profile_change.zig");
    _ = @import("internal/projection/like_change.zig");
    _ = @import("internal/projection/track_change.zig");
    _ = @import("internal/projection/commit_verifier.zig");
    _ = @import("internal/projection/snapshot_verifier.zig");
    _ = @import("internal/projection/list_store.zig");
    _ = @import("internal/projection/postgres_list_store.zig");
    _ = @import("internal/projection/track_store.zig");
    _ = @import("internal/projection/postgres_track_store.zig");
    _ = @import("internal/projection/profile_store.zig");
    _ = @import("internal/projection/postgres_profile_store.zig");
    _ = @import("internal/projection/like_store.zig");
    _ = @import("internal/projection/postgres_like_store.zig");
    _ = @import("internal/projection/postgres_record_rejection_store.zig");
    _ = @import("internal/projection/postgres_verified_commit_store.zig");
    _ = @import("internal/projection/postgres_verified_snapshot_store.zig");
    _ = @import("internal/projection/repository_head.zig");
    _ = @import("internal/projection/record_rejection.zig");
    _ = @import("internal/projection/verified_commit.zig");
    _ = @import("internal/projection/verified_snapshot.zig");
    _ = @import("server.zig");
}
