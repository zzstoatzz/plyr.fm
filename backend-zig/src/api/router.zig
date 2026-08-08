const std = @import("std");
const response = @import("response.zig");
const tracks = @import("tracks.zig");
const TrackStore = @import("../internal/index/track_store.zig").TrackStore;

const http = std.http;
const mem = std.mem;

pub const prefix = "/v1";

pub const App = struct {
    track_store: ?TrackStore,
    track_collection: []const u8,
    cors: response.CorsPolicy,
};

pub fn handle(
    request: *http.Server.Request,
    allocator: std.mem.Allocator,
    app: App,
    request_id: []const u8,
) !void {
    // std.http assumes body-capable methods have either Content-Length or a
    // transfer encoding when respond() discards an unread request body. An
    // empty POST without either header is valid and common in generic clients;
    // normalize it instead of letting the stdlib assertion terminate a worker.
    if (request.head.content_length == null and request.head.transfer_encoding == .none) {
        request.head.content_length = 0;
    }

    const target = request.head.target;
    const path = pathFromTarget(target);

    if (request.head.method == .OPTIONS) {
        try response.empty(request, .no_content, request_id, app.cors);
    } else if (mem.eql(u8, path, "/health")) {
        if (request.head.method != .GET) {
            try response.apiError(request, .method_not_allowed, request_id, app.cors);
            return;
        }
        try response.json(request, .ok, "{\"status\":\"ok\",\"role\":\"api\"}", request_id, app.cors);
    } else if (trackId(path)) |id| {
        if (request.head.method != .GET) {
            try response.apiError(request, .method_not_allowed, request_id, app.cors);
            return;
        }
        try tracks.get(
            request,
            allocator,
            app.track_store,
            app.track_collection,
            app.cors,
            id,
            request_id,
        );
    } else if (mem.eql(u8, path, prefix)) {
        if (request.head.method != .GET) {
            try response.apiError(request, .method_not_allowed, request_id, app.cors);
            return;
        }
        try response.json(request, .ok, "{\"object\":\"api\",\"version\":\"v1\"}", request_id, app.cors);
    } else if (mem.eql(u8, path, "/")) {
        if (request.head.method != .GET) {
            try response.apiError(request, .method_not_allowed, request_id, app.cors);
            return;
        }
        try response.json(request, .ok, "{\"name\":\"plyr.fm\",\"api\":\"/v1\"}", request_id, app.cors);
    } else {
        try response.apiError(request, .not_found, request_id, app.cors);
    }
}

fn trackId(path: []const u8) ?[]const u8 {
    const tracks_prefix = prefix ++ "/tracks/";
    if (!mem.startsWith(u8, path, tracks_prefix)) return null;
    const id = path[tracks_prefix.len..];
    if (id.len == 0 or mem.indexOfScalar(u8, id, '/') != null) return null;
    return id;
}

fn pathFromTarget(target: []const u8) []const u8 {
    const index = mem.indexOfScalar(u8, target, '?') orelse return target;
    return target[0..index];
}

test "query strings do not participate in route matching" {
    try std.testing.expectEqualStrings("/health", pathFromTarget("/health?probe=fly"));
}

test "product API paths use a major-version namespace" {
    try std.testing.expect(mem.startsWith(u8, "/v1/tracks", prefix ++ "/"));
    try std.testing.expect(!mem.startsWith(u8, "/tracks", prefix ++ "/"));
}

test "track detail routes accept exactly one opaque path segment" {
    try std.testing.expectEqualStrings("trk_abc", trackId("/v1/tracks/trk_abc").?);
    try std.testing.expect(trackId("/v1/tracks/") == null);
    try std.testing.expect(trackId("/v1/tracks/trk_abc/play") == null);
    try std.testing.expect(trackId("/tracks/trk_abc") == null);
}
