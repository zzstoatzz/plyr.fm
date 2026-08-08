const std = @import("std");
const albums = @import("albums.zig");
const artists = @import("artists.zig");
const response = @import("response.zig");
const tracks = @import("tracks.zig");
const ArtistStore = @import("../internal/index/artist_store.zig").ArtistStore;
const AlbumDetailStore = @import("../internal/index/album_detail_store.zig").AlbumDetailStore;
const AlbumStore = @import("../internal/index/album_store.zig").AlbumStore;
const TrackStore = @import("../internal/index/track_store.zig").TrackStore;

const http = std.http;
const mem = std.mem;

pub const prefix = "/v1";

pub const App = struct {
    track_store: ?TrackStore,
    artist_store: ?ArtistStore,
    album_store: ?AlbumStore,
    album_detail_store: ?AlbumDetailStore,
    track_collection: []const u8,
    list_collection: []const u8,
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
    } else if (mem.eql(u8, path, "/ready")) {
        if (request.head.method != .GET) {
            try response.apiError(request, .method_not_allowed, request_id, app.cors);
            return;
        }
        const store = app.track_store orelse {
            try response.apiError(request, .service_unavailable, request_id, app.cors);
            return;
        };
        if (!store.ready()) {
            try response.apiError(request, .service_unavailable, request_id, app.cors);
            return;
        }
        try response.json(request, .ok, "{\"status\":\"ready\",\"index\":\"reachable\"}", request_id, app.cors);
    } else if (mem.eql(u8, path, prefix ++ "/albums")) {
        if (request.head.method != .GET) {
            try response.apiError(request, .method_not_allowed, request_id, app.cors);
            return;
        }
        try albums.list(
            request,
            allocator,
            app.album_store,
            app.list_collection,
            app.cors,
            request_id,
        );
    } else if (mem.eql(u8, path, prefix ++ "/tracks")) {
        if (request.head.method != .GET) {
            try response.apiError(request, .method_not_allowed, request_id, app.cors);
            return;
        }
        try tracks.list(
            request,
            allocator,
            app.track_store,
            app.track_collection,
            app.cors,
            request_id,
        );
    } else if (albumId(path)) |id| {
        if (request.head.method != .GET) {
            try response.apiError(request, .method_not_allowed, request_id, app.cors);
            return;
        }
        try albums.get(
            request,
            allocator,
            app.album_detail_store,
            app.list_collection,
            app.track_collection,
            app.cors,
            id,
            request_id,
        );
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
    } else if (artistIdentifier(path)) |identifier| {
        if (request.head.method != .GET) {
            try response.apiError(request, .method_not_allowed, request_id, app.cors);
            return;
        }
        try artists.get(
            request,
            allocator,
            app.artist_store,
            app.cors,
            identifier,
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

fn albumId(path: []const u8) ?[]const u8 {
    const albums_prefix = prefix ++ "/albums/";
    if (!mem.startsWith(u8, path, albums_prefix)) return null;
    const id = path[albums_prefix.len..];
    if (id.len == 0 or mem.indexOfScalar(u8, id, '/') != null) return null;
    return id;
}

fn artistIdentifier(path: []const u8) ?[]const u8 {
    const artists_prefix = prefix ++ "/artists/";
    if (!mem.startsWith(u8, path, artists_prefix)) return null;
    const identifier = path[artists_prefix.len..];
    if (identifier.len == 0 or mem.indexOfScalar(u8, identifier, '/') != null) return null;
    return identifier;
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

test "album detail routes accept exactly one opaque path segment" {
    try std.testing.expectEqualStrings("alb_abc", albumId("/v1/albums/alb_abc").?);
    try std.testing.expect(albumId("/v1/albums/") == null);
    try std.testing.expect(albumId("/v1/albums/artist/slug") == null);
}

test "artist detail routes accept exactly one DID or handle segment" {
    try std.testing.expectEqualStrings("did:plc:artist", artistIdentifier("/v1/artists/did:plc:artist").?);
    try std.testing.expectEqualStrings("artist.example", artistIdentifier("/v1/artists/artist.example").?);
    try std.testing.expect(artistIdentifier("/v1/artists/") == null);
    try std.testing.expect(artistIdentifier("/v1/artists/artist.example/tracks") == null);
    try std.testing.expect(artistIdentifier("/artists/artist.example") == null);
}
