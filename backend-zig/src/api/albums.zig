const std = @import("std");
const get_album = @import("../internal/application/get_album.zig");
const list_albums = @import("../internal/application/list_albums.zig");
const VerifiedListStore = @import("../internal/index/verified_list_store.zig").VerifiedListStore;
const response = @import("response.zig");

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
    switch (get_album.execute(
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

pub fn list(
    request: *std.http.Server.Request,
    allocator: std.mem.Allocator,
    store: ?VerifiedListStore,
    collection: []const u8,
    profile_collection: []const u8,
    cors: response.CorsPolicy,
    request_id: []const u8,
) !void {
    switch (list_albums.execute(
        allocator,
        store,
        collection,
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

test "v1 album collection JSON exposes only verified list summaries" {
    const domain = @import("../internal/domain/verified_list.zig");
    const value: domain.Summary = .{
        .object = .album,
        .id = "alb_example",
        .record = .{
            .uri = "at://did:plc:artist/fm.plyr.dev.list/3m123abc",
            .cid = "bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku",
            .collection = "fm.plyr.dev.list",
            .rkey = "3m123abc",
        },
        .metadata = .{
            .name = "Album",
            .created_at = "2026-08-08T12:00:00.000000Z",
            .updated_at = "2026-08-08T13:00:00.000000Z",
        },
        .owner = .{
            .did = "did:plc:artist",
            .profile = .{ .handle = "artist.example", .display_name = "Artist", .avatar_url = null },
        },
        .metrics = .{ .member_count = 2, .available_count = 2, .total_plays = 3 },
        .sources = .{
            .owner_profile = .mixed,
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
    try std.testing.expectEqualStrings("album", root.get("object").?.string);
    try std.testing.expect(root.get("record") != null);
    try std.testing.expectEqualStrings("verified_repo", root.get("projection").?.object.get("verification").?.string);
    try std.testing.expect(root.get("metrics") != null);
    try std.testing.expect(root.get("presentation") == null);
    try std.testing.expect(root.get("atproto_record_uri") == null);
    try std.testing.expect(root.get("image_id") == null);
}

test "verified album detail JSON preserves every strong-reference position" {
    const domain = @import("../internal/domain/verified_list.zig");
    const members = [_]domain.Member{
        .{
            .position = 0,
            .subject = .{ .uri = "at://did:plc:artist/fm.plyr.dev.track/first", .cid = "bafyfirst" },
            .availability = .unavailable,
            .track = null,
        },
        .{
            .position = 1,
            .subject = .{ .uri = "at://did:plc:artist/fm.plyr.dev.track/second", .cid = "bafysecond" },
            .availability = .unavailable,
            .track = null,
        },
    };
    const value: domain.Detail = .{
        .object = .album,
        .id = "alb_example",
        .record = .{
            .uri = "at://did:plc:artist/fm.plyr.dev.list/album",
            .cid = "bafyrecord",
            .collection = "fm.plyr.dev.list",
            .rkey = "album",
        },
        .metadata = .{ .name = "Album", .created_at = "2026-08-08T12:00:00Z", .updated_at = null },
        .owner = .{ .did = "did:plc:artist", .profile = null },
        .members = &members,
        .metrics = .{ .member_count = 2, .available_count = 0, .total_plays = 0 },
        .sources = .{
            .owner_profile = .derived,
            .metrics = .derived,
            .account_availability = .verified_repo,
        },
        .projection = .{ .commit_cid = "bafycommit", .commit_rev = "3jqfcqzm3fo2j", .indexed_at_us = 42 },
    };

    const json = try std.json.Stringify.valueAlloc(std.testing.allocator, value, .{});
    defer std.testing.allocator.free(json);
    const parsed = try std.json.parseFromSlice(std.json.Value, std.testing.allocator, json, .{});
    defer parsed.deinit();
    const root = parsed.value.object;
    const serialized_members = root.get("members").?.array.items;
    try std.testing.expectEqual(@as(usize, 2), serialized_members.len);
    try std.testing.expectEqual(@as(i64, 0), serialized_members[0].object.get("position").?.integer);
    try std.testing.expectEqual(@as(i64, 1), serialized_members[1].object.get("position").?.integer);
    try std.testing.expectEqualStrings("unavailable", serialized_members[1].object.get("availability").?.string);
    try std.testing.expect(serialized_members[1].object.get("track").? == .null);
    try std.testing.expect(serialized_members[1].object.get("subject") != null);
    try std.testing.expect(root.get("tracks") == null);
    try std.testing.expect(root.get("album_id") == null);
}
