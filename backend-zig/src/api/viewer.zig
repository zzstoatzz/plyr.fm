const std = @import("std");
const config = @import("../config.zig");
const resolve_viewer_likes = @import("../internal/application/resolve_viewer_likes.zig");
const AuthStore = @import("../internal/auth/store.zig").Store;
const ViewerLikeStore = @import("../internal/index/viewer_like_store.zig").Store;
const auth = @import("auth.zig");
const response = @import("response.zig");

const maximum_body_bytes = 32 * 1024;

pub fn resolveLikes(
    request: *std.http.Server.Request,
    allocator: std.mem.Allocator,
    store: ?ViewerLikeStore,
    auth_config: ?config.AuthConfig,
    sessions: ?AuthStore,
    track_collection: []const u8,
    like_collection: []const u8,
    cors: response.CorsPolicy,
    request_id: []const u8,
) !void {
    var identity = (try auth.requireMutationIdentity(
        request,
        allocator,
        auth_config,
        sessions,
        cors,
        request_id,
    )) orelse return;
    defer identity.deinit(allocator);
    const body_reader = request.readerExpectContinue(&.{}) catch {
        try response.apiError(request, .invalid_request, request_id, cors);
        return;
    };
    const body = body_reader.allocRemaining(
        allocator,
        std.Io.Limit.limited(maximum_body_bytes),
    ) catch {
        try response.apiError(request, .invalid_request, request_id, cors);
        return;
    };
    const parsed = std.json.parseFromSliceLeaky(
        struct { tracks: []const resolve_viewer_likes.Input },
        allocator,
        body,
        .{ .ignore_unknown_fields = false },
    ) catch {
        try response.apiError(request, .invalid_request, request_id, cors);
        return;
    };
    switch (resolve_viewer_likes.execute(
        allocator,
        store,
        identity.session.did,
        track_collection,
        like_collection,
        parsed.tracks,
    )) {
        .found => |value| {
            const encoded = try std.json.Stringify.valueAlloc(allocator, value, .{});
            try response.jsonWithHeaders(request, .ok, encoded, request_id, cors, &.{
                .{ .name = "cache-control", .value = "no-store" },
                .{ .name = "pragma", .value = "no-cache" },
            });
        },
        .invalid_request => try response.apiError(request, .invalid_request, request_id, cors),
        .corrupt_projection => try response.apiError(request, .internal_error, request_id, cors),
        .unavailable => try response.apiError(request, .service_unavailable, request_id, cors),
    }
}
