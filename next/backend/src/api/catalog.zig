//! HTTP surface of the public catalog XRPC queries. No auth: a PDS proxies
//! them to `{service did}#plyr_appview`, or clients call them directly.

const std = @import("std");
const Exchange = @import("exchange.zig").Exchange;
const response = @import("response.zig");
const application = @import("../internal/application/public_catalog.zig");
const TrackChartStore = @import("../internal/index/track_chart_store.zig").TrackChartStore;
const TrackStore = @import("../internal/index/track_store.zig").TrackStore;
const RecordJsonStore = @import("../internal/index/track_record_json_store.zig").Store;

pub const Method = enum { top_tracks, latest_tracks };

pub const Stores = struct {
    chart: ?TrackChartStore,
    tracks: ?TrackStore,
    records: ?RecordJsonStore,
};

/// Which catalog method `path` names, if any. Method names share the track
/// collection's namespace (`fm.plyr.track` -> `fm.plyr.getTopTracks`).
pub fn match(track_collection: []const u8, path: []const u8) ?Method {
    const xrpc = "/xrpc/";
    if (!std.mem.startsWith(u8, path, xrpc)) return null;
    const nsid = path[xrpc.len..];
    const namespace = namespaceOf(track_collection) orelse return null;
    if (!std.mem.startsWith(u8, nsid, namespace) or nsid.len <= namespace.len or nsid[namespace.len] != '.') return null;
    const name = nsid[namespace.len + 1 ..];
    if (std.mem.eql(u8, name, "getTopTracks")) return .top_tracks;
    if (std.mem.eql(u8, name, "getLatestTracks")) return .latest_tracks;
    return null;
}

fn namespaceOf(track_collection: []const u8) ?[]const u8 {
    const suffix = ".track";
    if (!std.mem.endsWith(u8, track_collection, suffix) or track_collection.len == suffix.len) return null;
    return track_collection[0 .. track_collection.len - suffix.len];
}

pub fn handle(
    request: *Exchange,
    allocator: std.mem.Allocator,
    io: std.Io,
    method: Method,
    stores: Stores,
    collections: application.Collections,
    cors: response.CorsPolicy,
    request_id: []const u8,
) !void {
    if (request.method != .GET) {
        try xrpcError(request, .method_not_allowed, "InvalidRequest", "method not allowed", request_id, cors);
        return;
    }
    const result = switch (method) {
        .top_tracks => blk: {
            const nanoseconds = std.Io.Timestamp.now(io, .real).nanoseconds;
            const now_us = if (nanoseconds >= 0)
                std.math.cast(i64, @divFloor(nanoseconds, 1000)) orelse -1
            else
                -1;
            break :blk application.topTracks(allocator, stores.chart, stores.records, collections, request.target, now_us);
        },
        .latest_tracks => application.latestTracks(allocator, stores.tracks, stores.records, collections.track, request.target),
    };
    switch (result) {
        .found => |body| try response.json(request, .ok, body, request_id, cors),
        .invalid_request => try xrpcError(request, .bad_request, "InvalidRequest", "invalid limit, period or cursor", request_id, cors),
        .internal_error => try xrpcError(request, .internal_server_error, "InternalServerError", "tracks could not be read", request_id, cors),
        .unavailable => try xrpcError(request, .service_unavailable, "ServiceUnavailable", "tracks are temporarily unavailable", request_id, cors),
    }
}

fn xrpcError(
    request: *Exchange,
    status: std.http.Status,
    comptime name: []const u8,
    comptime message: []const u8,
    request_id: []const u8,
    cors: response.CorsPolicy,
) !void {
    try response.json(request, status, "{\"error\":\"" ++ name ++ "\",\"message\":\"" ++ message ++ "\"}", request_id, cors);
}

test "catalog routes follow the track collection's namespace" {
    try std.testing.expectEqual(Method.top_tracks, match("fm.plyr.track", "/xrpc/fm.plyr.getTopTracks").?);
    try std.testing.expectEqual(Method.latest_tracks, match("fm.plyr.track", "/xrpc/fm.plyr.getLatestTracks").?);
    try std.testing.expectEqual(Method.top_tracks, match("fm.plyr.dev.track", "/xrpc/fm.plyr.dev.getTopTracks").?);
    try std.testing.expect(match("fm.plyr.track", "/xrpc/fm.plyr.dev.getTopTracks") == null);
    try std.testing.expect(match("fm.plyr.dev.track", "/xrpc/fm.plyr.getTopTracks") == null);
    try std.testing.expect(match("fm.plyr.track", "/xrpc/fm.plyrgetTopTracks") == null);
    try std.testing.expect(match("fm.plyr.track", "/v1/charts/tracks") == null);
}
