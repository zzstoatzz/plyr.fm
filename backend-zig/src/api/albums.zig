const std = @import("std");
const list_albums = @import("../internal/application/list_albums.zig");
const AlbumStore = @import("../internal/index/album_store.zig").AlbumStore;
const response = @import("response.zig");

pub fn list(
    request: *std.http.Server.Request,
    allocator: std.mem.Allocator,
    store: ?AlbumStore,
    collection: []const u8,
    cors: response.CorsPolicy,
    request_id: []const u8,
) !void {
    switch (list_albums.execute(allocator, store, collection, request.head.target)) {
        .found => |value| {
            const body = try std.json.Stringify.valueAlloc(allocator, value, .{});
            try response.json(request, .ok, body, request_id, cors);
        },
        .invalid_request => try response.apiError(request, .invalid_request, request_id, cors),
        .internal_error => try response.apiError(request, .internal_error, request_id, cors),
        .unavailable => try response.apiError(request, .service_unavailable, request_id, cors),
    }
}

test "v1 album JSON separates record identity from local presentation" {
    const domain = @import("../internal/domain/album.zig");
    const value: domain.Album = .{
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
        .presentation = .{
            .slug = "album",
            .description = "local liner notes",
            .artwork_url = "https://cdn.example/album.jpg",
        },
        .artist = .{ .did = "did:plc:artist", .handle = "artist.example", .display_name = "Artist" },
        .metrics = .{ .track_count = 2, .total_plays = 3 },
        .sources = .{
            .metadata = .legacy_projection,
            .presentation = .legacy_local,
            .membership = .legacy_local,
            .metrics = .derived,
        },
        .projection = .{ .indexed_at = null, .verification = .legacy_unverified },
    };

    const json = try std.json.Stringify.valueAlloc(std.testing.allocator, value, .{});
    defer std.testing.allocator.free(json);
    const parsed = try std.json.parseFromSlice(std.json.Value, std.testing.allocator, json, .{});
    defer parsed.deinit();
    const root = parsed.value.object;
    try std.testing.expectEqualStrings("album", root.get("object").?.string);
    try std.testing.expect(root.get("record") != null);
    try std.testing.expect(root.get("presentation") != null);
    try std.testing.expect(root.get("metrics") != null);
    try std.testing.expect(root.get("atproto_record_uri") == null);
    try std.testing.expect(root.get("image_id") == null);
}
