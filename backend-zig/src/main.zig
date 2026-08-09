const std = @import("std");
const config = @import("config.zig");
const server = @import("server.zig");
const postgres = @import("internal/index/postgres_track_store.zig");
const postgres_composed_tracks = @import("internal/index/postgres_composed_track_store.zig");
const postgres_artists = @import("internal/index/postgres_artist_store.zig");
const postgres_albums = @import("internal/index/postgres_album_store.zig");
const postgres_album_detail = @import("internal/index/postgres_album_detail_store.zig");
const repair_runner = @import("internal/ingest/repair_runner.zig");
const continuous_runner = @import("internal/ingest/continuous_runner.zig");
const catalog_reconcile_runner = @import("internal/ingest/catalog_reconcile_runner.zig");
const account_reconciler = @import("internal/account/reconciler.zig");

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
        try postgres.PostgresTrackStore.init(allocator, io, url)
    else
        null;
    defer if (postgres_store) |*store| store.deinit();

    var postgres_composed_track_store: ?postgres_composed_tracks.PostgresComposedTrackStore = if (postgres_store) |*store|
        .{ .pool = store.pool, .profile_collection = settings.profile_collection }
    else
        null;
    const track_store = if (postgres_composed_track_store) |*store| store.store() else null;
    var postgres_artist_store: ?postgres_artists.PostgresArtistStore = if (postgres_store) |*store|
        .{ .pool = store.pool }
    else
        null;
    const artist_store = if (postgres_artist_store) |*store| store.store() else null;
    var postgres_album_store: ?postgres_albums.PostgresAlbumStore = if (postgres_store) |*store|
        .{ .pool = store.pool }
    else
        null;
    const album_store = if (postgres_album_store) |*store| store.store() else null;
    var postgres_album_detail_store: ?postgres_album_detail.PostgresAlbumDetailStore = if (postgres_store) |*store|
        .{ .pool = store.pool }
    else
        null;
    const album_detail_store = if (postgres_album_detail_store) |*store| store.store() else null;
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
        .api => try server.run(io, settings.port, settings.max_connections, .{
            .track_store = track_store,
            .artist_store = artist_store,
            .album_store = album_store,
            .album_detail_store = album_detail_store,
            .track_collection = settings.track_collection,
            .list_collection = settings.list_collection,
            .cors = .{ .allowed_origins = settings.cors_allowed_origins },
        }),
        .catalog_reconciler => {
            const store = if (postgres_store) |*value| value else return error.CatalogReconcilerDatabaseRequired;
            const report = try catalog_reconcile_runner.run(
                io,
                allocator,
                store.pool,
                settings.list_collection,
                settings.track_collection,
                settings.profile_collection,
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
            );
        },
    }
}

test {
    _ = @import("internal/account/availability.zig");
    _ = @import("internal/account/current_pds_status_source.zig");
    _ = @import("internal/account/check_schedule.zig");
    _ = @import("internal/account/postgres_availability_store.zig");
    _ = @import("internal/account/postgres_check_schedule.zig");
    _ = @import("internal/account/reconciler.zig");
    _ = @import("internal/account/repo_status.zig");
    _ = @import("api/response.zig");
    _ = @import("api/router.zig");
    _ = @import("api/artists.zig");
    _ = @import("api/albums.zig");
    _ = @import("api/tracks.zig");
    _ = @import("config.zig");
    _ = @import("internal/application/get_artist.zig");
    _ = @import("internal/application/get_album.zig");
    _ = @import("internal/application/list_albums.zig");
    _ = @import("internal/application/get_track.zig");
    _ = @import("internal/application/list_tracks.zig");
    _ = @import("internal/domain/artist.zig");
    _ = @import("internal/domain/album_detail.zig");
    _ = @import("internal/domain/album.zig");
    _ = @import("internal/domain/album_list.zig");
    _ = @import("internal/atproto/list_record.zig");
    _ = @import("internal/atproto/lexicon_value.zig");
    _ = @import("internal/atproto/profile_record.zig");
    _ = @import("internal/atproto/track_record.zig");
    _ = @import("internal/index/artist_store.zig");
    _ = @import("internal/index/album_detail_store.zig");
    _ = @import("internal/index/album_store.zig");
    _ = @import("internal/index/postgres_album_store.zig");
    _ = @import("internal/index/postgres_artist_store.zig");
    _ = @import("internal/index/postgres_album_detail_store.zig");
    _ = @import("internal/identity/track_id.zig");
    _ = @import("internal/identity/track_cursor.zig");
    _ = @import("internal/identity/record_id.zig");
    _ = @import("internal/identity/record_cursor.zig");
    _ = @import("internal/identity/album_id.zig");
    _ = @import("internal/http/query.zig");
    _ = @import("internal/index/postgres_track_store.zig");
    _ = @import("internal/index/postgres_composed_track_store.zig");
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
    _ = @import("internal/projection/track_change.zig");
    _ = @import("internal/projection/commit_verifier.zig");
    _ = @import("internal/projection/snapshot_verifier.zig");
    _ = @import("internal/projection/list_store.zig");
    _ = @import("internal/projection/postgres_list_store.zig");
    _ = @import("internal/projection/track_store.zig");
    _ = @import("internal/projection/postgres_track_store.zig");
    _ = @import("internal/projection/profile_store.zig");
    _ = @import("internal/projection/postgres_profile_store.zig");
    _ = @import("internal/projection/postgres_record_rejection_store.zig");
    _ = @import("internal/projection/postgres_verified_commit_store.zig");
    _ = @import("internal/projection/postgres_verified_snapshot_store.zig");
    _ = @import("internal/projection/repository_head.zig");
    _ = @import("internal/projection/record_rejection.zig");
    _ = @import("internal/projection/verified_commit.zig");
    _ = @import("internal/projection/verified_snapshot.zig");
    _ = @import("server.zig");
}
