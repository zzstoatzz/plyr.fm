//! The appview's reads as XRPC methods in the experimental namespace
//! (`fm.plyr.track` -> `fm.plyr.unspecced.*`). Nothing here is published as a
//! lexicon schema record; the JSON definitions live in `lexicons/unspecced`.
//!
//! Each method rewrites its XRPC parameters into the `/v1` route's shape (an
//! AT-URI becomes the route's opaque ID, camelCase names become snake_case)
//! and calls that route's handler, so both surfaces answer identically while
//! clients move over. Errors on `/xrpc/` take XRPC's `{error, message}` shape
//! in `response.zig`.

const std = @import("std");
const Exchange = @import("exchange.zig").Exchange;
const router = @import("router.zig");
const response = @import("response.zig");
const albums = @import("albums.zig");
const artists = @import("artists.zig");
const actors = @import("actors.zig");
const charts = @import("charts.zig");
const suggestions = @import("suggestions.zig");
const health = @import("health.zig");
const playlists = @import("playlists.zig");
const records = @import("records.zig");
const search_api = @import("search.zig");
const stats = @import("stats.zig");
const tracks = @import("tracks.zig");
const query = @import("../internal/http/query.zig");
const track_id = @import("../internal/identity/track_id.zig");
const album_id = @import("../internal/identity/album_id.zig");
const playlist_id = @import("../internal/identity/playlist_id.zig");

pub const Method = enum {
    listTracks,
    getTrack,
    resolveTracks,
    getPlayback,
    recordPlay,
    getTrackLikes,
    getTrackComments,
    getTags,
    getTrackChart,
    getTrackSuggestions,
    search,
    getStats,
    getAtlas,
    getStatsOverview,
    awaitRecord,
    listAlbums,
    getAlbum,
    listPlaylists,
    getPlaylist,
    getArtist,
    getArtistMetrics,
    resolveArtists,
    resolveLatestTracks,
    getActorLikes,
    getIngestStatus,

    fn isProcedure(self: Method) bool {
        return switch (self) {
            .resolveTracks, .recordPlay, .resolveArtists, .resolveLatestTracks => true,
            else => false,
        };
    }

    /// Public reads answer any origin, without credentials, like production's
    /// API. `recordPlay` keys anonymous listeners on the `plyr_play_id`
    /// cookie, so it stays credentialed and limited to plyr's own origins.
    pub fn isPublic(self: Method) bool {
        return self != .recordPlay;
    }
};

/// Which method `path` names, if any. `getTopTracks` and `getLatestTracks`
/// share the namespace but belong to `catalog.zig`.
pub fn match(track_collection: []const u8, path: []const u8) ?Method {
    const name = unspeccedName(track_collection, path) orelse return null;
    return std.meta.stringToEnum(Method, name);
}

/// The method name after `{namespace}.unspecced.` in an XRPC path.
pub fn unspeccedName(track_collection: []const u8, path: []const u8) ?[]const u8 {
    const xrpc = "/xrpc/";
    const suffix = ".track";
    if (!std.mem.startsWith(u8, path, xrpc)) return null;
    if (!std.mem.endsWith(u8, track_collection, suffix) or track_collection.len == suffix.len) return null;
    const namespace = track_collection[0 .. track_collection.len - suffix.len];
    const nsid = path[xrpc.len..];
    if (!std.mem.startsWith(u8, nsid, namespace)) return null;
    const rest = nsid[namespace.len..];
    const group = ".unspecced.";
    if (!std.mem.startsWith(u8, rest, group) or rest.len == group.len) return null;
    return rest[group.len..];
}

const Rename = struct { xrpc: []const u8, v1: []const u8 };

const Subject = enum { none, track, album, playlist, actor };

const Spec = struct {
    subject: Subject = .none,
    renames: []const Rename = &.{},
};

fn spec(method: Method) Spec {
    return switch (method) {
        .listTracks => .{ .renames = &.{ .{ .xrpc = "artistDid", .v1 = "artist_did" }, .{ .xrpc = "hiddenTag", .v1 = "hidden_tag" } } },
        .getTrack, .getPlayback, .recordPlay, .getTrackLikes, .getTrackComments => .{ .subject = .track },
        .getAlbum => .{ .subject = .album },
        .getPlaylist => .{ .subject = .playlist },
        .getArtist, .getArtistMetrics, .getActorLikes => .{ .subject = .actor },
        .listAlbums => .{ .renames = &.{.{ .xrpc = "artistDid", .v1 = "artist_did" }} },
        .listPlaylists => .{ .renames = &.{.{ .xrpc = "ownerDid", .v1 = "owner_did" }} },
        .awaitRecord => .{ .renames = &.{.{ .xrpc = "timeoutMs", .v1 = "timeout_ms" }} },
        else => .{},
    };
}

pub fn handle(
    request: *Exchange,
    allocator: std.mem.Allocator,
    shared: router.App,
    method: Method,
    request_id: []const u8,
) !void {
    var app = shared;
    app.cors.public = method.isPublic();
    const expected: @TypeOf(request.method) = if (method.isProcedure()) .POST else .GET;
    if (request.method != expected) return response.apiError(request, .method_not_allowed, request_id, app.cors);

    const method_spec = spec(method);
    const rewritten = rewriteQuery(allocator, request.target, method_spec, method == .getTrack) catch |err| switch (err) {
        error.OutOfMemory => return err,
        else => return response.apiError(request, .invalid_request, request_id, app.cors),
    };
    request.target = rewritten.target;

    // A subject the method needs must be present; one it does not take was
    // already refused by `rewriteQuery`.
    const id: []const u8 = switch (method_spec.subject) {
        .none => "",
        .actor => rewritten.subject orelse return response.apiError(request, .invalid_request, request_id, app.cors),
        .track, .album, .playlist => blk: {
            if (rewritten.legacy) break :blk rewritten.subject.?;
            const uri = rewritten.subject orelse return response.apiError(request, .invalid_request, request_id, app.cors);
            break :blk encodeId(allocator, method_spec.subject, uri) catch |err| switch (err) {
                error.OutOfMemory => return err,
                else => return response.apiError(request, .invalid_request, request_id, app.cors),
            };
        },
    };

    switch (method) {
        .listTracks => try tracks.list(request, allocator, app.track_store, app.track_collection, app.cors, request_id),
        .getTrack => try tracks.get(request, allocator, app.track_store, app.track_collection, app.cors, id, request_id),
        .resolveTracks => {
            request.body = resolveBody(allocator, request.body) catch |err| switch (err) {
                error.OutOfMemory => return err,
                else => return response.apiError(request, .invalid_request, request_id, app.cors),
            };
            try tracks.resolve(request, allocator, app.track_store, app.track_collection, app.cors, request_id);
        },
        .getPlayback => try tracks.playback(request, allocator, app.playback_store, app.track_collection, app.cors, id, request_id),
        .recordPlay => try tracks.recordPlay(request, allocator, app.play_metric_store, app.track_collection, app.cors, app.io, id, request_id),
        .getTrackLikes => try tracks.likes(request, allocator, app.track_store, app.like_store, app.track_collection, app.like_collection, app.profile_collection, app.cors, id, request_id),
        .getTrackComments => try tracks.comments(request, allocator, app.track_store, app.comment_store, app.track_collection, app.comment_collection, app.profile_collection, app.cors, id, request_id),
        .getTags => try tracks.tags(request, allocator, app.track_store, app.track_collection, app.cors, request_id),
        .getTrackChart => try charts.tracks(request, allocator, app.track_chart_store, app.track_collection, app.profile_collection, app.like_collection, app.cors, app.io, request_id),
        .getTrackSuggestions => try suggestions.tracks(request, allocator, app.track_suggestion_store, .{ .track = app.track_collection, .profile = app.profile_collection, .like = app.like_collection }, app.cors, request_id),
        .search => try search_api.list(request, allocator, app.search_store, app.track_collection, app.list_collection, app.profile_collection, app.cors, request_id),
        .getStats => try stats.get(request, allocator, app.stats_store, app.cors, request_id),
        .getAtlas => try stats.atlas(request, allocator, app.stats_store, app.cors, request_id),
        .getStatsOverview => try stats.overview(request, allocator, app.stats_overview_store, app.cors, request_id),
        .awaitRecord => try records.awaitRecord(request, allocator, app.io, app.record_status_store, .{
            .track = app.track_collection,
            .list = app.list_collection,
            .like = app.like_collection,
            .profile = app.profile_collection,
        }, app.cors, request_id),
        .listAlbums => try albums.list(request, allocator, app.verified_list_store, app.list_collection, app.profile_collection, app.cors, request_id),
        .getAlbum => try albums.get(request, allocator, app.verified_list_store, app.list_collection, app.track_collection, app.profile_collection, app.cors, id, request_id),
        .listPlaylists => try playlists.list(request, allocator, app.verified_list_store, app.list_collection, app.profile_collection, app.cors, request_id),
        .getPlaylist => try playlists.get(request, allocator, app.verified_list_store, app.list_collection, app.track_collection, app.profile_collection, app.cors, id, request_id),
        .getArtist => try artists.get(request, allocator, app.artist_store, app.cors, id, request_id),
        .getArtistMetrics => try artists.getMetrics(request, allocator, app.artist_store, app.artist_metric_store, app.track_collection, app.cors, id, request_id),
        .resolveArtists => try artists.resolve(request, allocator, app.artist_store, app.track_collection, app.cors, request_id),
        .resolveLatestTracks => try tracks.latestByArtists(request, allocator, app.track_store, app.track_collection, app.cors, request_id),
        .getActorLikes => {
            if (!std.mem.startsWith(u8, id, "did:")) return response.apiError(request, .invalid_request, request_id, app.cors);
            try actors.listLikes(request, allocator, app.liked_track_store, id, app.track_collection, app.cors, request_id);
        },
        .getIngestStatus => try health.ingest(request, allocator, app.io, app.ingest_status_store, app.cors, request_id),
    }
}

const Rewritten = struct {
    /// `/xrpc` plus the remaining parameters under their `/v1` names
    target: []const u8,
    subject: ?[]const u8 = null,
    /// `getTrack` named its track by `legacyId`, a numeric ID from production
    legacy: bool = false,
};

const RewriteError = error{ OutOfMemory, InvalidQuery };

/// Takes the subject parameter (`uri` or `actor`) out of the query and
/// renames the rest. A repeated or unexpected subject, or a `/v1` name sent
/// to XRPC, is refused rather than passed through.
fn rewriteQuery(allocator: std.mem.Allocator, target: []const u8, method_spec: Spec, accepts_legacy: bool) RewriteError!Rewritten {
    var out: std.ArrayList(u8) = .empty;
    try out.appendSlice(allocator, "/xrpc");
    var result: Rewritten = .{ .target = "" };
    var first = true;
    var pairs = query.Iterator.init(allocator, target);
    while (pairs.next() catch return error.InvalidQuery) |pair| {
        const subject_name: []const u8 = switch (method_spec.subject) {
            .none => "",
            .actor => "actor",
            .track, .album, .playlist => "uri",
        };
        const is_subject = subject_name.len != 0 and std.mem.eql(u8, pair.name, subject_name);
        const is_legacy = accepts_legacy and std.mem.eql(u8, pair.name, "legacyId");
        if (is_subject or is_legacy) {
            if (result.subject != null or pair.value.len == 0) return error.InvalidQuery;
            result.subject = pair.value;
            result.legacy = is_legacy;
            continue;
        }
        if (std.mem.eql(u8, pair.name, "uri") and method_spec.subject != .none) return error.InvalidQuery;
        var name = pair.name;
        for (method_spec.renames) |rename| {
            if (std.mem.eql(u8, pair.name, rename.v1)) return error.InvalidQuery;
            if (std.mem.eql(u8, pair.name, rename.xrpc)) name = rename.v1;
        }
        try out.append(allocator, if (first) '?' else '&');
        first = false;
        try percentEncode(allocator, &out, name);
        try out.append(allocator, '=');
        try percentEncode(allocator, &out, pair.value);
    }
    result.target = try out.toOwnedSlice(allocator);
    return result;
}

fn percentEncode(allocator: std.mem.Allocator, out: *std.ArrayList(u8), value: []const u8) !void {
    const hex = "0123456789ABCDEF";
    for (value) |byte| {
        if (std.ascii.isAlphanumeric(byte) or byte == '-' or byte == '.' or byte == '_' or byte == '~') {
            try out.append(allocator, byte);
        } else {
            try out.appendSlice(allocator, &.{ '%', hex[byte >> 4], hex[byte & 0x0f] });
        }
    }
}

fn encodeId(allocator: std.mem.Allocator, subject: Subject, uri: []const u8) ![]const u8 {
    return switch (subject) {
        .track => track_id.encode(try allocator.alloc(u8, track_id.encodedLength(uri)), uri),
        .album => album_id.encode(try allocator.alloc(u8, album_id.encodedLength(uri)), uri),
        .playlist => playlist_id.encode(try allocator.alloc(u8, playlist_id.encodedLength(uri)), uri),
        .none, .actor => unreachable,
    };
}

/// `{"uris": [...]}` becomes the `/v1` body `{"ids": [...]}`.
fn resolveBody(allocator: std.mem.Allocator, body: []const u8) ![]const u8 {
    const parsed = std.json.parseFromSliceLeaky(struct { uris: []const []const u8 }, allocator, body, .{}) catch
        return error.InvalidBody;
    const ids = try allocator.alloc([]const u8, parsed.uris.len);
    for (parsed.uris, ids) |uri, *id| id.* = try encodeId(allocator, .track, uri);
    return std.json.Stringify.valueAlloc(allocator, .{ .ids = ids }, .{});
}

test "methods follow the track collection's namespace" {
    try std.testing.expectEqual(Method.getTrack, match("fm.plyr.track", "/xrpc/fm.plyr.unspecced.getTrack").?);
    try std.testing.expectEqual(Method.search, match("fm.plyr.dev.track", "/xrpc/fm.plyr.dev.unspecced.search").?);
    try std.testing.expect(match("fm.plyr.track", "/xrpc/fm.plyr.dev.unspecced.getTrack") == null);
    try std.testing.expect(match("fm.plyr.track", "/xrpc/fm.plyr.unspecced.getTopTracks") == null);
    try std.testing.expect(match("fm.plyr.track", "/xrpc/fm.plyr.unspecced.") == null);
    try std.testing.expect(match("fm.plyr.track", "/xrpc/fm.plyrx.unspecced.getTrack") == null);
    try std.testing.expect(match("fm.plyr.track", "/v1/tracks") == null);
}

test "parameters take their /v1 names and the subject leaves the query" {
    var arena_state = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();

    const listed = try rewriteQuery(arena, "/xrpc/x?artistDid=did%3Aplc%3Aa&tag=ambient&hiddenTag=ai&limit=5", spec(.listTracks), false);
    try std.testing.expectEqualStrings("/xrpc?artist_did=did%3Aplc%3Aa&tag=ambient&hidden_tag=ai&limit=5", listed.target);
    try std.testing.expect(listed.subject == null);

    const likes = try rewriteQuery(arena, "/xrpc/x?uri=at%3A%2F%2Fdid%3Aplc%3Aa%2Ffm.plyr.track%2F3k&limit=30", spec(.getTrackLikes), false);
    try std.testing.expectEqualStrings("/xrpc?limit=30", likes.target);
    try std.testing.expectEqualStrings("at://did:plc:a/fm.plyr.track/3k", likes.subject.?);

    const legacy = try rewriteQuery(arena, "/xrpc/x?legacyId=42", spec(.getTrack), true);
    try std.testing.expect(legacy.legacy);
    try std.testing.expectEqualStrings("42", legacy.subject.?);

    try std.testing.expectError(error.InvalidQuery, rewriteQuery(arena, "/xrpc/x?artist_did=did%3Aplc%3Aa", spec(.listTracks), false));
    try std.testing.expectError(error.InvalidQuery, rewriteQuery(arena, "/xrpc/x?uri=a&uri=b", spec(.getTrack), true));
    try std.testing.expectError(error.InvalidQuery, rewriteQuery(arena, "/xrpc/x?uri=a&legacyId=4", spec(.getTrack), true));
}

test "a track URI becomes the same ID the /v1 route takes" {
    var arena_state = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();
    const uri = "at://did:plc:ewvi7nxzyoun6zhxrhs64oiz/fm.plyr.track/3m123abc";
    var buffer: [256]u8 = undefined;
    try std.testing.expectEqualStrings(try track_id.encode(&buffer, uri), try encodeId(arena, .track, uri));
    try std.testing.expectError(error.InvalidBody, resolveBody(arena, "{\"ids\":[]}"));
    const body = try resolveBody(arena, "{\"uris\":[\"" ++ uri ++ "\"]}");
    try std.testing.expect(std.mem.startsWith(u8, body, "{\"ids\":[\"trk_"));
}
