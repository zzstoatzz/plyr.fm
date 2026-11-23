const std = @import("std");
const Exchange = @import("exchange.zig").Exchange;
const response = @import("response.zig");
const managed_space = @import("managed_space.zig");
const notifications = @import("notifications.zig");
const moderation = @import("moderation.zig");
const PostgresRestrictions = @import("../internal/space/postgres_restrictions.zig").PostgresRestrictions;
const labels = @import("labels.zig");
const PostgresModerationLog = @import("../internal/moderation/postgres_log.zig").PostgresModerationLog;
const catalog = @import("catalog.zig");
const radio = @import("radio.zig");
const RadioService = @import("../internal/radio/service.zig").Service;
const xrpc = @import("xrpc.zig");
const NotificationService = @import("../internal/notification/service.zig").Config;
const NotificationStore = @import("../internal/notification/store.zig").NotificationStore;
const ManagedSpaceConfig = @import("../internal/space/managed_space.zig").Config;
const ArtistStore = @import("../internal/index/artist_store.zig").ArtistStore;
const ArtistMetricStore = @import("../internal/metrics/artist_metric_store.zig").ArtistMetricStore;
const LikeQueryStore = @import("../internal/index/like_query_store.zig").LikeQueryStore;
const CommentQueryStore = @import("../internal/index/comment_query_store.zig").CommentQueryStore;
const ViewerLikeStore = @import("../internal/index/viewer_like_store.zig").Store;
const LikedTrackStore = @import("../internal/index/liked_track_store.zig").Store;
const PlaybackStore = @import("../internal/index/playback_store.zig").PlaybackStore;
const SearchStore = @import("../internal/index/search_store.zig").SearchStore;
const PlayMetricStore = @import("../internal/metrics/play_metric_store.zig").PlayMetricStore;
const TrackStore = @import("../internal/index/track_store.zig").TrackStore;
const TrackChartStore = @import("../internal/index/track_chart_store.zig").TrackChartStore;
const TrackSuggestionStore = @import("../internal/index/track_suggestion_store.zig").TrackSuggestionStore;
const TrackRecordJsonStore = @import("../internal/index/track_record_json_store.zig").Store;
const VerifiedListStore = @import("../internal/index/verified_list_store.zig").VerifiedListStore;
const RecordStatusStore = @import("../internal/index/record_status_store.zig").RecordStatusStore;
const IngestStatusStore = @import("../internal/index/ingest_status_store.zig").IngestStatusStore;
const legacy_links = @import("legacy_links.zig");

const mem = std.mem;

pub const App = struct {
    io: std.Io,
    stats_store: ?@import("../internal/metrics/platform_stats_store.zig").Store = null,
    stats_overview_store: ?*@import("../internal/metrics/postgres_stats_overview_store.zig").PostgresStatsOverviewStore = null,
    track_store: ?TrackStore,
    track_chart_store: ?TrackChartStore = null,
    track_suggestion_store: ?TrackSuggestionStore = null,
    track_record_json_store: ?TrackRecordJsonStore = null,
    like_store: ?LikeQueryStore = null,
    comment_store: ?CommentQueryStore = null,
    viewer_like_store: ?ViewerLikeStore = null,
    liked_track_store: ?LikedTrackStore = null,
    playback_store: ?PlaybackStore,
    artist_store: ?ArtistStore,
    artist_metric_store: ?ArtistMetricStore,
    verified_list_store: ?VerifiedListStore,
    record_status_store: ?RecordStatusStore = null,
    ingest_status_store: ?IngestStatusStore = null,
    legacy_audio: ?*@import("../internal/index/postgres_legacy_audio_store.zig").PostgresLegacyAudioStore = null,
    search_store: ?SearchStore,
    play_metric_store: ?PlayMetricStore,
    track_collection: []const u8,
    list_collection: []const u8,
    profile_collection: []const u8,
    like_collection: []const u8,
    comment_collection: []const u8 = "",
    cors: response.CorsPolicy,
    managed_space: ?ManagedSpaceConfig = null,
    /// null when no service DID is configured: callers authenticate to it
    notifications: ?NotificationService = null,
    notification_store: ?NotificationStore = null,
    /// null when no service DID is configured, like notifications
    moderation: ?moderation.Config = null,
    moderation_log: ?*PostgresModerationLog = null,
    /// takedowns, asked by checkUserAccess
    space_restrictions: ?*PostgresRestrictions = null,
    radio: ?RadioService = null,
    waveform_store: ?@import("../internal/delivery/postgres_waveform_store.zig").PostgresWaveformStore = null,
};

pub fn handle(
    request: *Exchange,
    allocator: std.mem.Allocator,
    app: App,
    request_id: []const u8,
) !void {
    const target = request.target;
    const path = pathFromTarget(target);

    if (request.method == .OPTIONS) {
        var cors = app.cors;
        cors.public = isPublicPath(app.track_collection, path);
        try response.empty(request, .no_content, request_id, cors);
    } else if (mem.eql(u8, path, "/health")) {
        if (request.method != .GET) {
            try response.apiError(request, .method_not_allowed, request_id, app.cors);
            return;
        }
        try response.json(request, .ok, "{\"status\":\"ok\",\"role\":\"api\"}", request_id, app.cors);
    } else if (mem.eql(u8, path, "/ready")) {
        if (request.method != .GET) {
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
        if (request.method != .GET) {
            try response.apiError(request, .method_not_allowed, request_id, app.cors);
            return;
        }
        try managed_space.didDocument(request, allocator, config, app.cors, request_id);
    } else if (mem.eql(u8, path, "/xrpc/com.atproto.managedspace.checkUserAccess")) {
        const config = app.managed_space orelse {
            try response.apiError(request, .not_found, request_id, app.cors);
            return;
        };
        if (request.method != .GET) {
            try response.apiError(request, .method_not_allowed, request_id, app.cors);
            return;
        }
        try managed_space.checkUserAccess(request, allocator, app.io, config, if (app.space_restrictions) |store| store.restrictions() else null, app.cors, request_id);
    } else if (catalog.match(app.track_collection, path)) |method| {
        try catalog.handle(request, allocator, app.io, method, .{
            .chart = app.track_chart_store,
            .tracks = app.track_store,
            .records = app.track_record_json_store,
        }, .{
            .track = app.track_collection,
            .profile = app.profile_collection,
            .like = app.like_collection,
        }, publicCors(app.cors), request_id);
    } else if (radio.match(app.track_collection, path)) |route| {
        try radio.handle(request, allocator, app.io, app.radio, route, publicCors(app.cors), request_id);
    } else if (xrpc.match(app.track_collection, path)) |method| {
        try xrpc.handle(request, allocator, app, method, request_id);
    } else if (if (app.notifications) |config| notifications.match(config, path) else null) |method| {
        try notifications.handle(
            request,
            allocator,
            app.io,
            app.notifications.?,
            app.notification_store,
            method,
            app.cors,
            request_id,
        );
    } else if (mem.eql(u8, path, labels.path)) {
        try labels.queryLabels(request, allocator, app.moderation_log, app.cors, request_id);
    } else if (if (app.moderation) |config| moderation.match(config, path) else null) |method| {
        try moderation.handle(
            request,
            allocator,
            app.io,
            app.moderation.?,
            app.moderation_log,
            method,
            app.cors,
            request_id,
        );
    } else if (legacy_links.match(path)) |route| {
        try legacy_links.handle(request, allocator, route, app.legacy_audio, app.track_collection, app.cors, request_id);
    } else if (mem.eql(u8, path, "/oembed")) {
        if (request.method != .GET and request.method != .HEAD) {
            try response.apiError(request, .method_not_allowed, request_id, app.cors);
            return;
        }
        // public like production's: embed hosts may ask from a page's own script
        try response.redirectWithHeaders(request, try oembedLocation(allocator, request.header("host"), target), request_id, &.{
            .{ .name = "access-control-allow-origin", .value = "*" },
        });
    } else if (mem.eql(u8, path, "/")) {
        if (request.method != .GET) {
            try response.apiError(request, .method_not_allowed, request_id, app.cors);
            return;
        }
        try response.json(request, .ok, "{\"name\":\"plyr.fm\",\"api\":\"/xrpc\"}", request_id, app.cors);
    } else {
        try response.apiError(request, .not_found, request_id, app.cors);
    }
}

/// Paths any website may read from the browser (no credentials), so a
/// preflight answers them with `*`. Everything credentialed or service-authed
/// (recordPlay's cookie, notifications, moderation, checkUserAccess) keeps the
/// exact `CORS_ALLOWED_ORIGINS` list.
fn isPublicPath(track_collection: []const u8, path: []const u8) bool {
    if (catalog.match(track_collection, path) != null) return true;
    if (radio.match(track_collection, path) != null) return true;
    if (mem.eql(u8, path, labels.path)) return true;
    if (xrpc.match(track_collection, path)) |method| return method.isPublic();
    return false;
}

test "public reads preflight for any origin; credentialed paths do not" {
    const collection = "fm.plyr.track";
    try std.testing.expect(isPublicPath(collection, "/xrpc/fm.plyr.unspecced.search"));
    try std.testing.expect(isPublicPath(collection, "/xrpc/fm.plyr.unspecced.getTrackChart"));
    try std.testing.expect(isPublicPath(collection, "/xrpc/fm.plyr.unspecced.resolveTracks"));
    try std.testing.expect(isPublicPath(collection, "/xrpc/fm.plyr.unspecced.getTopTracks"));
    try std.testing.expect(!isPublicPath(collection, "/xrpc/fm.plyr.unspecced.recordPlay"));
    try std.testing.expect(!isPublicPath(collection, "/xrpc/com.atproto.managedspace.checkUserAccess"));
    try std.testing.expect(!isPublicPath(collection, "/xrpc/fm.plyr.notification.listNotifications"));
}

fn publicCors(cors: response.CorsPolicy) response.CorsPolicy {
    var public = cors;
    public.public = true;
    return public;
}

/// Production answered oEmbed at api.plyr.fm/oembed, and old pages and embed
/// services still ask there. The web app serves it now (next/web/edge), so send
/// each API host's callers to its own site.
fn oembedLocation(allocator: std.mem.Allocator, host: ?[]const u8, target: []const u8) ![]const u8 {
    const query = if (mem.indexOfScalar(u8, target, '?')) |index| target[index..] else "";
    return std.fmt.allocPrint(allocator, "https://{s}/oembed{s}", .{ siteHost(host), query });
}

fn siteHost(host: ?[]const u8) []const u8 {
    const value = host orelse return "next.plyr.fm";
    const name = if (mem.indexOfScalar(u8, value, ':')) |index| value[0..index] else value;
    if (std.ascii.eqlIgnoreCase(name, "api.plyr.fm")) return "plyr.fm";
    return "next.plyr.fm";
}

test "oembed moves to the site that owns the api host" {
    var arena_state = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();
    try std.testing.expectEqualStrings(
        "https://plyr.fm/oembed?url=https%3A%2F%2Fplyr.fm%2Ftrack%2F1667",
        try oembedLocation(arena, "api.plyr.fm", "/oembed?url=https%3A%2F%2Fplyr.fm%2Ftrack%2F1667"),
    );
    try std.testing.expectEqualStrings("https://next.plyr.fm/oembed?url=x", try oembedLocation(arena, "api.next.plyr.fm:443", "/oembed?url=x"));
    try std.testing.expectEqualStrings("https://next.plyr.fm/oembed", try oembedLocation(arena, "evil.example", "/oembed"));
    try std.testing.expectEqualStrings("https://next.plyr.fm/oembed", try oembedLocation(arena, null, "/oembed"));
}

fn pathFromTarget(target: []const u8) []const u8 {
    const index = mem.indexOfScalar(u8, target, '?') orelse return target;
    return target[0..index];
}

test "query strings do not participate in route matching" {
    try std.testing.expectEqualStrings("/health", pathFromTarget("/health?probe=fly"));
}
