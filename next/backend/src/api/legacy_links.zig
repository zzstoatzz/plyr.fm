//! Production's API answered `/audio/{file_id}` and `/tracks/{id}`, and records,
//! embeds, stream overlays and other apps still name them on api.plyr.fm. Once
//! that host points here they resolve to next: audio to its public copy, a track
//! to its getTrack.

const std = @import("std");
const Exchange = @import("exchange.zig").Exchange;
const response = @import("response.zig");
const legacy_audio = @import("../internal/index/postgres_legacy_audio_store.zig");

pub const Route = union(enum) {
    audio: []const u8,
    track: []const u8,
};

pub fn match(path: []const u8) ?Route {
    if (segment(path, "/audio/")) |file_id| return .{ .audio = file_id };
    if (segment(path, "/tracks/")) |id| {
        for (id) |c| if (!std.ascii.isDigit(c)) return null;
        return .{ .track = id };
    }
    return null;
}

fn segment(path: []const u8, prefix: []const u8) ?[]const u8 {
    if (!std.mem.startsWith(u8, path, prefix)) return null;
    const rest = path[prefix.len..];
    if (rest.len == 0 or std.mem.indexOfScalar(u8, rest, '/') != null) return null;
    return rest;
}

const public_headers: []const std.http.Header = &.{
    .{ .name = "access-control-allow-origin", .value = "*" },
};

pub fn handle(
    request: *Exchange,
    allocator: std.mem.Allocator,
    route: Route,
    store: ?*legacy_audio.PostgresLegacyAudioStore,
    track_collection: []const u8,
    cors: response.CorsPolicy,
    request_id: []const u8,
) !void {
    if (request.method != .GET and request.method != .HEAD) return response.apiError(request, .method_not_allowed, request_id, cors);
    switch (route) {
        .track => |id| {
            const namespace = track_collection[0 .. std.mem.lastIndexOfScalar(u8, track_collection, '.') orelse track_collection.len];
            const location = try std.fmt.allocPrint(allocator, "/xrpc/{s}.unspecced.getTrack?legacyId={s}", .{ namespace, id });
            try response.redirectWithHeaders(request, location, request_id, public_headers);
        },
        .audio => |file_id| {
            const source = store orelse return response.apiError(request, .service_unavailable, request_id, cors);
            const found = source.find(allocator, file_id) catch |err| switch (err) {
                error.OutOfMemory => return err,
                else => return response.apiError(request, .service_unavailable, request_id, cors),
            } orelse return response.apiError(request, .not_found, request_id, cors);
            switch (found) {
                .public => |url| try response.redirectWithHeaders(request, url, request_id, public_headers),
                // gated tracks play only for their artist on next, inside plyr.fm
                .gated => try response.apiError(request, .authentication_required, request_id, cors),
            }
        },
    }
}

test "production's audio and track paths" {
    try std.testing.expectEqualStrings("89d18ada205c48ad", match("/audio/89d18ada205c48ad").?.audio);
    try std.testing.expectEqualStrings("1667", match("/tracks/1667").?.track);
    try std.testing.expect(match("/tracks/") == null);
    try std.testing.expect(match("/tracks/by-uri") == null);
    try std.testing.expect(match("/audio/x/download") == null);
    try std.testing.expect(match("/audio/") == null);
    try std.testing.expect(match("/xrpc/fm.plyr.unspecced.getTrack") == null);
}
