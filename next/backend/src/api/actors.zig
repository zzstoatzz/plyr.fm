const std = @import("std");
const list_viewer_liked_tracks = @import("../internal/application/list_viewer_liked_tracks.zig");
const resolve_viewer_likes = @import("../internal/application/resolve_viewer_likes.zig");
const ViewerLikeStore = @import("../internal/index/viewer_like_store.zig").Store;
const LikedTrackStore = @import("../internal/index/liked_track_store.zig").Store;
const response = @import("response.zig");

const maximum_body_bytes = 32 * 1024;

/// Likes are public records in the actor's repo, so the appview serves them
/// without a session: GET /v1/actors/{did}/likes.
pub fn listLikes(
    request: *std.http.Server.Request,
    allocator: std.mem.Allocator,
    store: ?LikedTrackStore,
    actor_did: []const u8,
    track_collection: []const u8,
    cors: response.CorsPolicy,
    request_id: []const u8,
) !void {
    switch (list_viewer_liked_tracks.execute(
        allocator,
        store,
        actor_did,
        track_collection,
        request.head.target,
    )) {
        .found => |value| {
            const encoded = try std.json.Stringify.valueAlloc(allocator, value, .{});
            try response.json(request, .ok, encoded, request_id, cors);
        },
        .invalid_request => try response.apiError(request, .invalid_request, request_id, cors),
        .corrupt_projection => try response.apiError(request, .internal_error, request_id, cors),
        .unavailable => try response.apiError(request, .service_unavailable, request_id, cors),
    }
}

/// Which of the given tracks the actor likes, per the index:
/// POST /v1/actors/{did}/likes/resolve. POST only because the subject list can
/// be long; nothing is written.
pub fn resolveLikes(
    request: *std.http.Server.Request,
    allocator: std.mem.Allocator,
    store: ?ViewerLikeStore,
    actor_did: []const u8,
    track_collection: []const u8,
    like_collection: []const u8,
    cors: response.CorsPolicy,
    request_id: []const u8,
) !void {
    const response_cors = try response.captureCors(request, allocator, cors);
    const body_reader = request.readerExpectContinue(&.{}) catch {
        try response.apiError(request, .invalid_request, request_id, response_cors);
        return;
    };
    const body = body_reader.allocRemaining(
        allocator,
        std.Io.Limit.limited(maximum_body_bytes),
    ) catch {
        try response.apiError(request, .invalid_request, request_id, response_cors);
        return;
    };
    const parsed = std.json.parseFromSliceLeaky(
        struct { tracks: []const resolve_viewer_likes.Input },
        allocator,
        body,
        .{ .ignore_unknown_fields = false },
    ) catch {
        try response.apiError(request, .invalid_request, request_id, response_cors);
        return;
    };
    switch (resolve_viewer_likes.execute(
        allocator,
        store,
        actor_did,
        track_collection,
        like_collection,
        parsed.tracks,
    )) {
        .found => |value| {
            const encoded = try std.json.Stringify.valueAlloc(allocator, value, .{});
            try response.json(request, .ok, encoded, request_id, response_cors);
        },
        .invalid_request => try response.apiError(request, .invalid_request, request_id, response_cors),
        .corrupt_projection => try response.apiError(request, .internal_error, request_id, response_cors),
        .unavailable => try response.apiError(request, .service_unavailable, request_id, response_cors),
    }
}
