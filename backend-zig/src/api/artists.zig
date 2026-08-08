const std = @import("std");
const get_artist = @import("../internal/application/get_artist.zig");
const ArtistStore = @import("../internal/index/artist_store.zig").ArtistStore;
const response = @import("response.zig");

pub fn get(
    request: *std.http.Server.Request,
    allocator: std.mem.Allocator,
    store: ?ArtistStore,
    cors: response.CorsPolicy,
    identifier: []const u8,
    request_id: []const u8,
) !void {
    switch (get_artist.execute(allocator, store, identifier)) {
        .found => |value| {
            const body = try std.json.Stringify.valueAlloc(allocator, value, .{});
            try response.json(request, .ok, body, request_id, cors);
        },
        .invalid_identifier => try response.apiError(request, .invalid_request, request_id, cors),
        .not_found => try response.apiError(request, .not_found, request_id, cors),
        .internal_error => try response.apiError(request, .internal_error, request_id, cors),
        .unavailable => try response.apiError(request, .service_unavailable, request_id, cors),
    }
}

test "v1 artist JSON preserves compatible fields and exposes their provenance" {
    const domain = @import("../internal/domain/artist.zig");
    const value: domain.Artist = .{
        .did = "did:plc:artist",
        .handle = "artist.example",
        .display_name = "Artist",
        .bio = "sound maker",
        .avatar_url = null,
        .show_liked_on_profile = true,
        .support_url = "https://artist.example/support",
        .created_at = "2026-08-08T12:00:00.000000Z",
        .updated_at = "2026-08-08T13:00:00.000000Z",
        .sources = .{
            .identity = .legacy_projection,
            .profile = .legacy_projection,
            .public_preferences = .legacy_local,
        },
        .projection = .{ .indexed_at = null, .verification = .legacy_unverified },
    };

    const json = try std.json.Stringify.valueAlloc(std.testing.allocator, value, .{});
    defer std.testing.allocator.free(json);
    const parsed = try std.json.parseFromSlice(std.json.Value, std.testing.allocator, json, .{});
    defer parsed.deinit();
    const root = parsed.value.object;
    try std.testing.expectEqualStrings("artist", root.get("object").?.string);
    try std.testing.expectEqualStrings("did:plc:artist", root.get("did").?.string);
    try std.testing.expectEqualStrings("Artist", root.get("display_name").?.string);
    try std.testing.expect(root.get("sources") != null);
    try std.testing.expect(root.get("projection") != null);
    try std.testing.expect(root.get("pds_url") == null);
}
