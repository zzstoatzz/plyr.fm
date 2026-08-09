const std = @import("std");
const search_catalog = @import("../internal/application/search_catalog.zig");
const SearchStore = @import("../internal/index/search_store.zig").SearchStore;
const response = @import("response.zig");

pub fn list(
    request: *std.http.Server.Request,
    allocator: std.mem.Allocator,
    store: ?SearchStore,
    track_collection: []const u8,
    list_collection: []const u8,
    profile_collection: []const u8,
    cors: response.CorsPolicy,
    request_id: []const u8,
) !void {
    switch (search_catalog.execute(
        allocator,
        store,
        track_collection,
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

test "search JSON exposes provenance and match semantics without internal score" {
    const domain = @import("../internal/domain/search.zig");
    const hits = [_]domain.Hit{.{
        .type = .artist,
        .id = "did:plc:artist",
        .record = .{
            .uri = "at://did:plc:artist/fm.plyr.dev.actor.profile/self",
            .cid = "bafyprofile",
        },
        .title = "Artist",
        .owner = .{
            .did = "did:plc:artist",
            .handle = "artist.example",
            .display_name = "Artist",
        },
        .image_url = null,
        .metrics = .{},
        .match = .{ .kind = .exact, .field = .handle },
        .sources = .{
            .title = .legacy_local,
            .owner_handle = .legacy_projection,
            .owner_display_name = .legacy_projection,
            .image = .derived,
            .metrics = .derived,
            .account_availability = .verified_repo,
        },
        .projection = .{ .indexed_at_us = 42 },
    }};
    const value: domain.Page = .{
        .data = &hits,
        .query = "artist.example",
        .counts = .{ .artists = 1 },
    };
    const json = try std.json.Stringify.valueAlloc(std.testing.allocator, value, .{});
    defer std.testing.allocator.free(json);
    const parsed = try std.json.parseFromSlice(std.json.Value, std.testing.allocator, json, .{});
    defer parsed.deinit();
    const root = parsed.value.object;
    try std.testing.expectEqualStrings("list", root.get("object").?.string);
    try std.testing.expectEqualStrings("artist.example", root.get("query").?.string);
    const hit = root.get("data").?.array.items[0].object;
    try std.testing.expectEqualStrings("search_result", hit.get("object").?.string);
    try std.testing.expectEqualStrings("artist", hit.get("type").?.string);
    try std.testing.expectEqualStrings("exact", hit.get("match").?.object.get("kind").?.string);
    try std.testing.expect(hit.get("relevance") == null);
    try std.testing.expect(hit.get("score") == null);
}
