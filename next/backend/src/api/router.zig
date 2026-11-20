const std = @import("std");
const Exchange = @import("exchange.zig").Exchange;
const response = @import("response.zig");
const managed_space = @import("managed_space.zig");
const notifications = @import("notifications.zig");
const moderation = @import("moderation.zig");
const labels = @import("labels.zig");
const PostgresModerationLog = @import("../internal/moderation/postgres_log.zig").PostgresModerationLog;
const catalog = @import("catalog.zig");
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

const mem = std.mem;

pub const App = struct {
    io: std.Io,
    stats_store: ?@import("../internal/metrics/platform_stats_store.zig").Store = null,
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
        if (catalog.match(app.track_collection, path) != null or mem.eql(u8, path, labels.path)) cors.public = true;
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
        try managed_space.checkUserAccess(request, allocator, app.io, config, app.cors, request_id);
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

fn publicCors(cors: response.CorsPolicy) response.CorsPolicy {
    var public = cors;
    public.public = true;
    return public;
}

fn pathFromTarget(target: []const u8) []const u8 {
    const index = mem.indexOfScalar(u8, target, '?') orelse return target;
    return target[0..index];
}

test "query strings do not participate in route matching" {
    try std.testing.expectEqualStrings("/health", pathFromTarget("/health?probe=fly"));
}
