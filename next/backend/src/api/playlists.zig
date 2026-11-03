const std = @import("std");
const get_playlist = @import("../internal/application/get_playlist.zig");
const list_playlists = @import("../internal/application/list_playlists.zig");
const VerifiedListStore = @import("../internal/index/verified_list_store.zig").VerifiedListStore;
const response = @import("response.zig");

pub fn list(
    request: *std.http.Server.Request,
    allocator: std.mem.Allocator,
    store: ?VerifiedListStore,
    list_collection: []const u8,
    profile_collection: []const u8,
    cors: response.CorsPolicy,
    request_id: []const u8,
) !void {
    switch (list_playlists.execute(
        allocator,
        store,
        list_collection,
        profile_collection,
        request.head.target,
    )) {
        .found => |value| {
            const body = try std.json.Stringify.valueAlloc(allocator, value, .{});
            try response.json(request, .ok, body, request_id, cors);
        },
        .invalid_request => try response.apiError(request, .invalid_request, request_id, cors),
        .internal_error => try response.apiError(request, .internal_error, request_id, cors),
        .unavailable => try response.apiError(request, .service_unavailable, request_id, cors),
    }
}

pub fn get(
    request: *std.http.Server.Request,
    allocator: std.mem.Allocator,
    store: ?VerifiedListStore,
    list_collection: []const u8,
    track_collection: []const u8,
    profile_collection: []const u8,
    cors: response.CorsPolicy,
    id: []const u8,
    request_id: []const u8,
) !void {
    switch (get_playlist.execute(
        allocator,
        store,
        list_collection,
        track_collection,
        profile_collection,
        id,
    )) {
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

test "verified playlist JSON preserves ordered unavailable positions" {
    const domain = @import("../internal/domain/verified_list.zig");
    const members = [_]domain.Member{
        .{
            .position = 0,
            .subject = .{
                .uri = "at://did:plc:artist/fm.plyr.dev.track/first",
                .cid = "bafyfirst",
            },
            .availability = .unavailable,
            .track = null,
        },
    };
    const value: domain.Detail = .{
        .object = .playlist,
        .id = "pls_example",
        .record = .{
            .uri = "at://did:plc:owner/fm.plyr.dev.list/playlist",
            .cid = "bafyrecord",
            .collection = "fm.plyr.dev.list",
            .rkey = "playlist",
        },
        .metadata = .{
            .name = "Road mix",
            .created_at = "2026-08-09T12:00:00Z",
            .updated_at = null,
        },
        .owner = .{ .did = "did:plc:owner", .profile = null },
        .members = &members,
        .metrics = .{ .member_count = 1, .available_count = 0, .total_plays = 0 },
        .sources = .{
            .owner_profile = .derived,
            .metrics = .derived,
            .account_availability = .verified_repo,
        },
        .projection = .{
            .commit_cid = "bafycommit",
            .commit_rev = "3jqfcqzm3fo2j",
            .indexed_at_us = 42,
        },
    };

    const json = try std.json.Stringify.valueAlloc(std.testing.allocator, value, .{});
    defer std.testing.allocator.free(json);
    const parsed = try std.json.parseFromSlice(std.json.Value, std.testing.allocator, json, .{});
    defer parsed.deinit();
    const root = parsed.value.object;
    try std.testing.expectEqualStrings("playlist", root.get("object").?.string);
    try std.testing.expectEqualStrings("pls_example", root.get("id").?.string);
    try std.testing.expect(root.get("is_private") == null);
    try std.testing.expect(root.get("atproto_record_uri") == null);
    const serialized = root.get("members").?.array.items;
    try std.testing.expectEqual(@as(usize, 1), serialized.len);
    try std.testing.expectEqualStrings("unavailable", serialized[0].object.get("availability").?.string);
    try std.testing.expect(serialized[0].object.get("track").? == .null);
}
