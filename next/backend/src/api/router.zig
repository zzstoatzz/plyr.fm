const std = @import("std");
const albums = @import("albums.zig");
const artists = @import("artists.zig");
const charts = @import("charts.zig");
const playlists = @import("playlists.zig");
const health = @import("health.zig");
const records = @import("records.zig");
const response = @import("response.zig");
const search = @import("search.zig");
const tracks = @import("tracks.zig");
const actors = @import("actors.zig");
const managed_space = @import("managed_space.zig");
const ManagedSpaceConfig = @import("../internal/space/managed_space.zig").Config;
const path_segment = @import("../internal/http/path_segment.zig");
const ArtistStore = @import("../internal/index/artist_store.zig").ArtistStore;
const ArtistMetricStore = @import("../internal/metrics/artist_metric_store.zig").ArtistMetricStore;
const LikeQueryStore = @import("../internal/index/like_query_store.zig").LikeQueryStore;
const ViewerLikeStore = @import("../internal/index/viewer_like_store.zig").Store;
const LikedTrackStore = @import("../internal/index/liked_track_store.zig").Store;
const PlaybackStore = @import("../internal/index/playback_store.zig").PlaybackStore;
const SearchStore = @import("../internal/index/search_store.zig").SearchStore;
const PlayDedupStore = @import("../internal/metrics/play_dedup_store.zig").PlayDedupStore;
const PlayMetricStore = @import("../internal/metrics/play_metric_store.zig").PlayMetricStore;
const TrackStore = @import("../internal/index/track_store.zig").TrackStore;
const TrackChartStore = @import("../internal/index/track_chart_store.zig").TrackChartStore;
const VerifiedListStore = @import("../internal/index/verified_list_store.zig").VerifiedListStore;
const RecordStatusStore = @import("../internal/index/record_status_store.zig").RecordStatusStore;
const IngestStatusStore = @import("../internal/index/ingest_status_store.zig").IngestStatusStore;

const http = std.http;
const mem = std.mem;

pub const prefix = "/v1";

pub const App = struct {
    io: std.Io,
    track_store: ?TrackStore,
    track_chart_store: ?TrackChartStore = null,
    like_store: ?LikeQueryStore = null,
    viewer_like_store: ?ViewerLikeStore = null,
    liked_track_store: ?LikedTrackStore = null,
    playback_store: ?PlaybackStore,
    artist_store: ?ArtistStore,
    artist_metric_store: ?ArtistMetricStore,
    verified_list_store: ?VerifiedListStore,
    record_status_store: ?RecordStatusStore = null,
    ingest_status_store: ?IngestStatusStore = null,
    search_store: ?SearchStore,
    play_metric_store: ?PlayMetricStore,
    play_dedup_store: ?PlayDedupStore,
    track_collection: []const u8,
    list_collection: []const u8,
    profile_collection: []const u8,
    like_collection: []const u8,
    cors: response.CorsPolicy,
    managed_space: ?ManagedSpaceConfig = null,
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
    } else if (mem.eql(u8, path, "/.well-known/did.json")) {
        const config = app.managed_space orelse {
            try response.apiError(request, .not_found, request_id, app.cors);
            return;
        };
        if (request.head.method != .GET) {
            try response.apiError(request, .method_not_allowed, request_id, app.cors);
            return;
        }
        try managed_space.didDocument(request, allocator, config, app.cors, request_id);
    } else if (mem.eql(u8, path, "/xrpc/com.atproto.managedspace.checkUserAccess")) {
        const config = app.managed_space orelse {
            try response.apiError(request, .not_found, request_id, app.cors);
            return;
        };
        if (request.head.method != .GET) {
            try response.apiError(request, .method_not_allowed, request_id, app.cors);
            return;
        }
        try managed_space.checkUserAccess(request, allocator, app.io, config, app.cors, request_id);
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
    } else if (actorLikesDid(path)) |did| {
        if (request.head.method != .GET) {
            try response.apiError(request, .method_not_allowed, request_id, app.cors);
            return;
        }
        try actors.listLikes(
            request,
            allocator,
            app.liked_track_store,
            did,
            app.track_collection,
            app.cors,
            request_id,
        );
    } else if (actorLikesResolveDid(path)) |did| {
        if (request.head.method != .POST) {
            try response.apiError(request, .method_not_allowed, request_id, app.cors);
            return;
        }
        try actors.resolveLikes(
            request,
            allocator,
            app.viewer_like_store,
            did,
            app.track_collection,
            app.like_collection,
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
            app.like_collection,
            app.cors,
            app.io,
            request_id,
        );
    } else if (mem.eql(u8, path, prefix ++ "/health/ingest")) {
        if (request.head.method != .GET) {
            try response.apiError(request, .method_not_allowed, request_id, app.cors);
            return;
        }
        try health.ingest(request, allocator, app.io, app.ingest_status_store, app.cors, request_id);
    } else if (mem.eql(u8, path, prefix ++ "/records/await")) {
        if (request.head.method != .GET) {
            try response.apiError(request, .method_not_allowed, request_id, app.cors);
            return;
        }
        try records.awaitRecord(request, allocator, app.io, app.record_status_store, .{
            .track = app.track_collection,
            .list = app.list_collection,
            .like = app.like_collection,
            .profile = app.profile_collection,
        }, app.cors, request_id);
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
    } else if (trackLikesId(path)) |id| {
        if (request.head.method != .GET) {
            try response.apiError(request, .method_not_allowed, request_id, app.cors);
            return;
        }
        try tracks.likes(
            request,
            allocator,
            app.track_store,
            app.like_store,
            app.track_collection,
            app.like_collection,
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

fn trackLikesId(path: []const u8) ?[]const u8 {
    const tracks_prefix = prefix ++ "/tracks/";
    const likes_suffix = "/likes";
    if (!mem.startsWith(u8, path, tracks_prefix) or
        !mem.endsWith(u8, path, likes_suffix)) return null;
    if (path.len <= tracks_prefix.len + likes_suffix.len) return null;
    const id = path[tracks_prefix.len .. path.len - likes_suffix.len];
    if (id.len == 0 or mem.indexOfScalar(u8, id, '/') != null) return null;
    return id;
}

fn actorLikesDid(path: []const u8) ?[]const u8 {
    return actorSuffixed(path, "/likes");
}

fn actorLikesResolveDid(path: []const u8) ?[]const u8 {
    return actorSuffixed(path, "/likes/resolve");
}

/// /v1/actors/{did}{suffix}. Only DIDs: likes are keyed by repo, and a
/// client that just wrote to its PDS already knows its own DID.
fn actorSuffixed(path: []const u8, comptime suffix: []const u8) ?[]const u8 {
    const actors_prefix = prefix ++ "/actors/";
    if (!mem.startsWith(u8, path, actors_prefix) or !mem.endsWith(u8, path, suffix)) return null;
    if (path.len <= actors_prefix.len + suffix.len) return null;
    const did = path[actors_prefix.len .. path.len - suffix.len];
    if (!mem.startsWith(u8, did, "did:") or mem.indexOfScalar(u8, did, '/') != null) return null;
    return did;
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

test "track like-read routes accept one opaque track segment" {
    try std.testing.expectEqualStrings("trk_abc", trackLikesId("/v1/tracks/trk_abc/likes").?);
    try std.testing.expect(trackLikesId("/v1/tracks/likes") == null);
    try std.testing.expect(trackLikesId("/v1/tracks/trk_abc/likes/more") == null);
    try std.testing.expect(trackLikesId("/tracks/trk_abc/likes") == null);
}

test "actor like routes take one DID segment" {
    try std.testing.expectEqualStrings("did:plc:abc", actorLikesDid("/v1/actors/did:plc:abc/likes").?);
    try std.testing.expectEqualStrings("did:plc:abc", actorLikesResolveDid("/v1/actors/did:plc:abc/likes/resolve").?);
    try std.testing.expect(actorLikesDid("/v1/actors/did:plc:abc/likes/resolve") == null);
    try std.testing.expect(actorLikesDid("/v1/actors/alice.example/likes") == null);
    try std.testing.expect(actorLikesDid("/v1/actors//likes") == null);
    try std.testing.expect(actorLikesDid("/v1/actors/did:plc:a/b/likes") == null);
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
