const std = @import("std");
const get_track = @import("../internal/application/get_track.zig");
const TrackStore = @import("../internal/index/track_store.zig").TrackStore;
const response = @import("response.zig");

pub fn get(
    request: *std.http.Server.Request,
    allocator: std.mem.Allocator,
    store: ?TrackStore,
    collection: []const u8,
    cors: response.CorsPolicy,
    id: []const u8,
    request_id: []const u8,
) !void {
    switch (get_track.execute(allocator, store, collection, id)) {
        .found => |value| {
            const body = try std.json.Stringify.valueAlloc(allocator, value, .{});
            try response.json(request, .ok, body, request_id, cors);
        },
        .invalid_id => try response.apiError(request, .invalid_request, request_id, cors),
        .not_found => try response.apiError(request, .not_found, request_id, cors),
        .internal_error => try response.apiError(request, .internal_error, request_id, cors),
        .unavailable => try response.apiError(request, .service_unavailable, request_id, cors),
    }
}

test "v1 track JSON keeps authority and projections separate" {
    const domain = @import("../internal/domain/track.zig");
    const allocator = std.testing.allocator;
    const value: domain.Track = .{
        .id = "trk_example",
        .record = .{
            .uri = "at://did:plc:abc/fm.plyr.dev.track/3m123abc",
            .cid = "bafyreexample",
            .revision = "3m123rev",
            .collection = "fm.plyr.dev.track",
            .rkey = "3m123abc",
        },
        .metadata = .{
            .title = "No Local IDs",
            .description = null,
            .album = null,
            .duration_seconds = 180,
            .created_at = "2026-08-08 12:00:00+00",
        },
        .artist = .{
            .did = "did:plc:abc",
            .profile = .{
                .handle = "artist.example",
                .display_name = "Artist",
                .avatar_url = null,
            },
        },
        .media = .{ .artifacts = &.{}, .origins = &.{} },
        .access = .{
            .visibility = .public,
            .in_discovery = true,
            .gate = null,
            .space_uri = null,
        },
        .moderation = .{
            .self_labels = &.{},
            .operator_labels = &.{},
            .override = null,
        },
        .metrics = .{ .play_count = 0 },
        .projection = .{ .indexed_at = null, .verification = .legacy_unverified },
    };

    const json = try std.json.Stringify.valueAlloc(allocator, value, .{});
    defer allocator.free(json);
    const parsed = try std.json.parseFromSlice(std.json.Value, allocator, json, .{});
    defer parsed.deinit();
    const root = parsed.value.object;
    try std.testing.expectEqualStrings("track", root.get("object").?.string);
    try std.testing.expect(root.get("record") != null);
    try std.testing.expect(root.get("media") != null);
    try std.testing.expect(root.get("metrics") != null);
    try std.testing.expect(root.get("projection") != null);
    try std.testing.expect(root.get("file_id") == null);
    try std.testing.expect(root.get("r2_url") == null);
}
