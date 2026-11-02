const std = @import("std");
const get_artist = @import("get_artist.zig");
const artist_metrics = @import("../domain/artist_metrics.zig");
const ArtistStore = @import("../index/artist_store.zig").ArtistStore;
const ArtistMetricStore = @import("../metrics/artist_metric_store.zig").ArtistMetricStore;

pub const Result = union(enum) {
    found: artist_metrics.ArtistMetrics,
    invalid_identifier,
    not_found,
    internal_error,
    unavailable,
};

pub fn execute(
    allocator: std.mem.Allocator,
    artist_store: ?ArtistStore,
    metric_store: ?ArtistMetricStore,
    track_collection: []const u8,
    raw_identifier: []const u8,
) Result {
    const public_artist = switch (get_artist.execute(allocator, artist_store, raw_identifier)) {
        .found => |value| value,
        .invalid_identifier => return .invalid_identifier,
        .not_found => return .not_found,
        .internal_error => return .internal_error,
        .unavailable => return .unavailable,
    };
    const configured_store = metric_store orelse return .unavailable;
    const value = configured_store.get(
        allocator,
        public_artist.did,
        track_collection,
    ) catch |err| return switch (err) {
        error.CorruptMetrics => .internal_error,
        error.MetricsUnavailable, error.OutOfMemory => .unavailable,
    };
    if (!std.mem.eql(u8, value.artist_did, public_artist.did)) return .internal_error;
    return .{ .found = value };
}

test "metrics resolve a public handle to its canonical DID before aggregation" {
    const domain_artist = @import("../domain/artist.zig");
    const artist_index = @import("../index/artist_store.zig");

    const FakeArtist = struct {
        fn get(
            _: *anyopaque,
            _: std.mem.Allocator,
            identifier: artist_index.Identifier,
        ) ArtistStore.Error!?domain_artist.Artist {
            const handle = switch (identifier) {
                .handle => |value| value,
                .did => return error.CorruptProjection,
            };
            if (!std.mem.eql(u8, handle, "artist.example")) return null;
            return .{
                .did = "did:plc:artist",
                .handle = "artist.example",
                .display_name = "Artist",
                .bio = null,
                .avatar_url = null,
                .show_liked_on_profile = false,
                .support_url = null,
                .created_at = "2026-08-09T00:00:00Z",
                .updated_at = "2026-08-09T00:00:00Z",
                .record = .{
                    .uri = "at://did:plc:artist/fm.plyr.dev.actor.profile/self",
                    .cid = "bafyprofile",
                    .revision = "3mrevision",
                    .collection = "fm.plyr.dev.actor.profile",
                    .rkey = "self",
                },
                .sources = .{
                    .did = .verified_repo,
                    .handle = .legacy_projection,
                    .display_name = .legacy_local,
                    .profile = .verified_repo,
                    .public_preferences = .legacy_local,
                    .account_availability = .current_pds,
                },
                .projection = .{
                    .indexed_at = "2026-08-09T00:00:00Z",
                    .verification = .verified_repo,
                },
            };
        }
    };
    const FakeMetrics = struct {
        fn get(
            _: *anyopaque,
            _: std.mem.Allocator,
            did: []const u8,
            collection: []const u8,
        ) ArtistMetricStore.Error!artist_metrics.ArtistMetrics {
            if (!std.mem.eql(u8, did, "did:plc:artist")) return error.CorruptMetrics;
            if (!std.mem.eql(u8, collection, "fm.plyr.dev.track")) return error.CorruptMetrics;
            return .{
                .artist_did = did,
                .totals = .{ .plays = 7, .tracks = 2, .duration_seconds = 180 },
                .top_track = null,
            };
        }
    };

    var artist_context: u8 = 0;
    var metric_context: u8 = 0;
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const artist_store: ArtistStore = .{ .context = &artist_context, .get_fn = FakeArtist.get };
    const metric_store: ArtistMetricStore = .{ .context = &metric_context, .get_fn = FakeMetrics.get };
    const result = execute(
        arena.allocator(),
        artist_store,
        metric_store,
        "fm.plyr.dev.track",
        "Artist.Example",
    );
    try std.testing.expectEqual(@as(i64, 7), result.found.totals.plays);
    try std.testing.expectEqualStrings("did:plc:artist", result.found.artist_did);
}

test "artist absence wins before metric availability" {
    const artist_index = @import("../index/artist_store.zig");
    const FakeArtist = struct {
        fn get(
            _: *anyopaque,
            _: std.mem.Allocator,
            _: artist_index.Identifier,
        ) ArtistStore.Error!?@import("../domain/artist.zig").Artist {
            return null;
        }
    };
    var context: u8 = 0;
    const store: ArtistStore = .{ .context = &context, .get_fn = FakeArtist.get };
    try std.testing.expectEqual(
        Result.not_found,
        execute(std.testing.allocator, store, null, "fm.plyr.dev.track", "did:plc:absent"),
    );
}
