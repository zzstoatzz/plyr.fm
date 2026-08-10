const std = @import("std");
const auth = @import("auth.zig");
const config = @import("../config.zig");
const albums = @import("albums.zig");
const artists = @import("artists.zig");
const charts = @import("charts.zig");
const playlists = @import("playlists.zig");
const response = @import("response.zig");
const search = @import("search.zig");
const tracks = @import("tracks.zig");
const path_segment = @import("../internal/http/path_segment.zig");
const ArtistStore = @import("../internal/index/artist_store.zig").ArtistStore;
const ArtistMetricStore = @import("../internal/metrics/artist_metric_store.zig").ArtistMetricStore;
const PlaybackStore = @import("../internal/index/playback_store.zig").PlaybackStore;
const SearchStore = @import("../internal/index/search_store.zig").SearchStore;
const PlayDedupStore = @import("../internal/metrics/play_dedup_store.zig").PlayDedupStore;
const PlayMetricStore = @import("../internal/metrics/play_metric_store.zig").PlayMetricStore;
const TrackStore = @import("../internal/index/track_store.zig").TrackStore;
const TrackChartStore = @import("../internal/index/track_chart_store.zig").TrackChartStore;
const VerifiedListStore = @import("../internal/index/verified_list_store.zig").VerifiedListStore;
const PostgresAuthStore = @import("../internal/auth/postgres_store.zig").PostgresAuthStore;

const http = std.http;
const mem = std.mem;

pub const prefix = "/v1";

pub const App = struct {
    io: std.Io,
    track_store: ?TrackStore,
    track_chart_store: ?TrackChartStore = null,
    playback_store: ?PlaybackStore,
    artist_store: ?ArtistStore,
    artist_metric_store: ?ArtistMetricStore,
    verified_list_store: ?VerifiedListStore,
    search_store: ?SearchStore,
    play_metric_store: ?PlayMetricStore,
    play_dedup_store: ?PlayDedupStore,
    track_collection: []const u8,
    list_collection: []const u8,
    profile_collection: []const u8,
    cors: response.CorsPolicy,
    auth: ?config.AuthConfig = null,
    auth_store: ?PostgresAuthStore = null,
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
    } else if (mem.eql(u8, path, "/oauth-client-metadata.json")) {
        if (request.head.method != .GET) {
            try response.apiError(request, .method_not_allowed, request_id, app.cors);
            return;
        }
        try auth.clientMetadata(request, allocator, app.auth, app.cors, request_id);
    } else if (mem.eql(u8, path, "/auth/pds-options")) {
        if (request.head.method != .GET) {
            try response.apiError(request, .method_not_allowed, request_id, app.cors);
            return;
        }
        try auth.pdsOptions(request, app.cors, request_id);
    } else if (mem.eql(u8, path, "/auth/exchange")) {
        if (request.head.method != .POST) {
            try response.apiError(request, .method_not_allowed, request_id, app.cors);
            return;
        }
        try auth.exchange(request, allocator, app.auth, app.auth_store, app.cors, request_id);
    } else if (mem.eql(u8, path, "/auth/me")) {
        if (request.head.method != .GET) {
            try response.apiError(request, .method_not_allowed, request_id, app.cors);
            return;
        }
        try auth.me(request, allocator, app.auth_store, app.cors, request_id);
    } else if (mem.eql(u8, path, "/auth/logout")) {
        if (request.head.method != .POST) {
            try response.apiError(request, .method_not_allowed, request_id, app.cors);
            return;
        }
        try auth.logout(request, app.auth_store, app.cors, request_id);
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
            app.verified_list_store,
            app.list_collection,
            app.profile_collection,
            app.cors,
            request_id,
        );
    } else if (mem.eql(u8, path, prefix ++ "/playlists")) {
        if (request.head.method != .GET) {
            try response.apiError(request, .method_not_allowed, request_id, app.cors);
            return;
        }
        try playlists.list(
            request,
            allocator,
            app.verified_list_store,
            app.list_collection,
            app.profile_collection,
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
    } else if (mem.eql(u8, path, prefix ++ "/charts/tracks")) {
        if (request.head.method != .GET) {
            try response.apiError(request, .method_not_allowed, request_id, app.cors);
            return;
        }
        try charts.tracks(
            request,
            allocator,
            app.track_chart_store,
            app.track_collection,
            app.profile_collection,
            app.cors,
            app.io,
            request_id,
        );
    } else if (mem.eql(u8, path, prefix ++ "/search")) {
        if (request.head.method != .GET) {
            try response.apiError(request, .method_not_allowed, request_id, app.cors);
            return;
        }
        try search.list(
            request,
            allocator,
            app.search_store,
            app.track_collection,
            app.list_collection,
            app.profile_collection,
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
            app.verified_list_store,
            app.list_collection,
            app.track_collection,
            app.profile_collection,
            app.cors,
            id,
            request_id,
        );
    } else if (playlistId(path)) |id| {
        if (request.head.method != .GET) {
            try response.apiError(request, .method_not_allowed, request_id, app.cors);
            return;
        }
        try playlists.get(
            request,
            allocator,
            app.verified_list_store,
            app.list_collection,
            app.track_collection,
            app.profile_collection,
            app.cors,
            id,
            request_id,
        );
    } else if (trackPlaybackId(path)) |id| {
        if (request.head.method != .GET) {
            try response.apiError(request, .method_not_allowed, request_id, app.cors);
            return;
        }
        try tracks.playback(
            request,
            allocator,
            app.playback_store,
            app.track_collection,
            app.cors,
            id,
            request_id,
        );
    } else if (trackPlayId(path)) |id| {
        if (request.head.method != .POST) {
            try response.apiError(request, .method_not_allowed, request_id, app.cors);
            return;
        }
        try tracks.recordPlay(
            request,
            allocator,
            app.play_metric_store,
            app.play_dedup_store,
            app.track_collection,
            app.cors,
            app.io,
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
    } else if (artistMetricsIdentifier(path)) |identifier| {
        if (request.head.method != .GET) {
            try response.apiError(request, .method_not_allowed, request_id, app.cors);
            return;
        }
        const decoded_identifier = path_segment.decode(allocator, identifier) catch {
            try response.apiError(request, .invalid_request, request_id, app.cors);
            return;
        };
        try artists.getMetrics(
            request,
            allocator,
            app.artist_store,
            app.artist_metric_store,
            app.track_collection,
            app.cors,
            decoded_identifier,
            request_id,
        );
    } else if (artistIdentifier(path)) |identifier| {
        if (request.head.method != .GET) {
            try response.apiError(request, .method_not_allowed, request_id, app.cors);
            return;
        }
        const decoded_identifier = path_segment.decode(allocator, identifier) catch {
            try response.apiError(request, .invalid_request, request_id, app.cors);
            return;
        };
        try artists.get(
            request,
            allocator,
            app.artist_store,
            app.cors,
            decoded_identifier,
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

fn trackPlaybackId(path: []const u8) ?[]const u8 {
    const tracks_prefix = prefix ++ "/tracks/";
    const playback_suffix = "/playback";
    if (!mem.startsWith(u8, path, tracks_prefix) or
        !mem.endsWith(u8, path, playback_suffix)) return null;
    if (path.len <= tracks_prefix.len + playback_suffix.len) return null;
    const id = path[tracks_prefix.len .. path.len - playback_suffix.len];
    if (id.len == 0 or mem.indexOfScalar(u8, id, '/') != null) return null;
    return id;
}

fn trackPlayId(path: []const u8) ?[]const u8 {
    const tracks_prefix = prefix ++ "/tracks/";
    const plays_suffix = "/plays";
    if (!mem.startsWith(u8, path, tracks_prefix) or
        !mem.endsWith(u8, path, plays_suffix)) return null;
    if (path.len <= tracks_prefix.len + plays_suffix.len) return null;
    const id = path[tracks_prefix.len .. path.len - plays_suffix.len];
    if (id.len == 0 or mem.indexOfScalar(u8, id, '/') != null) return null;
    return id;
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

fn playlistId(path: []const u8) ?[]const u8 {
    const playlists_prefix = prefix ++ "/playlists/";
    if (!mem.startsWith(u8, path, playlists_prefix)) return null;
    const id = path[playlists_prefix.len..];
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

fn artistMetricsIdentifier(path: []const u8) ?[]const u8 {
    const artists_prefix = prefix ++ "/artists/";
    const metrics_suffix = "/metrics";
    if (!mem.startsWith(u8, path, artists_prefix) or
        !mem.endsWith(u8, path, metrics_suffix)) return null;
    if (path.len <= artists_prefix.len + metrics_suffix.len) return null;
    const identifier = path[artists_prefix.len .. path.len - metrics_suffix.len];
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

test "search is one versioned collection route" {
    try std.testing.expectEqualStrings("/v1/search", pathFromTarget("/v1/search?q=plyr"));
    try std.testing.expect(!std.mem.eql(u8, "/search", prefix ++ "/search"));
}

test "track detail routes accept exactly one opaque path segment" {
    try std.testing.expectEqualStrings("trk_abc", trackId("/v1/tracks/trk_abc").?);
    try std.testing.expect(trackId("/v1/tracks/") == null);
    try std.testing.expect(trackId("/v1/tracks/trk_abc/play") == null);
    try std.testing.expect(trackId("/tracks/trk_abc") == null);
}

test "track playback routes accept one opaque track segment" {
    try std.testing.expectEqualStrings("trk_abc", trackPlaybackId("/v1/tracks/trk_abc/playback").?);
    try std.testing.expect(trackPlaybackId("/v1/tracks/playback") == null);
    try std.testing.expect(trackPlaybackId("/v1/tracks/trk_abc/playback/more") == null);
    try std.testing.expect(trackPlaybackId("/tracks/trk_abc/playback") == null);
}

test "track play-write routes accept one opaque track segment" {
    try std.testing.expectEqualStrings("trk_abc", trackPlayId("/v1/tracks/trk_abc/plays").?);
    try std.testing.expect(trackPlayId("/v1/tracks/plays") == null);
    try std.testing.expect(trackPlayId("/v1/tracks/trk_abc/plays/more") == null);
}

test "album detail routes accept exactly one opaque path segment" {
    try std.testing.expectEqualStrings("alb_abc", albumId("/v1/albums/alb_abc").?);
    try std.testing.expect(albumId("/v1/albums/") == null);
    try std.testing.expect(albumId("/v1/albums/artist/slug") == null);
}

test "playlist detail routes accept exactly one opaque path segment" {
    try std.testing.expectEqualStrings("pls_abc", playlistId("/v1/playlists/pls_abc").?);
    try std.testing.expect(playlistId("/v1/playlists/") == null);
    try std.testing.expect(playlistId("/v1/playlists/pls_abc/tracks") == null);
    try std.testing.expect(playlistId("/playlists/pls_abc") == null);
}

test "artist detail routes accept exactly one DID or handle segment" {
    try std.testing.expectEqualStrings("did:plc:artist", artistIdentifier("/v1/artists/did:plc:artist").?);
    try std.testing.expectEqualStrings("artist.example", artistIdentifier("/v1/artists/artist.example").?);
    try std.testing.expect(artistIdentifier("/v1/artists/") == null);
    try std.testing.expect(artistIdentifier("/v1/artists/artist.example/tracks") == null);
    try std.testing.expect(artistIdentifier("/artists/artist.example") == null);
}

test "artist metric routes accept exactly one DID or handle segment" {
    try std.testing.expectEqualStrings(
        "did:plc:artist",
        artistMetricsIdentifier("/v1/artists/did:plc:artist/metrics").?,
    );
    try std.testing.expectEqualStrings(
        "artist.example",
        artistMetricsIdentifier("/v1/artists/artist.example/metrics").?,
    );
    try std.testing.expect(artistMetricsIdentifier("/v1/artists/metrics") == null);
    try std.testing.expect(artistMetricsIdentifier("/v1/artists/a/b/metrics") == null);
}
