//! `fm.plyr.unspecced.getTrackWaveform`: how loud a track's bass, mids and
//! treble are over time, for clients to draw its playing bars from. Only a
//! track whose public audio the waveform prober has measured has one.

const std = @import("std");
const Exchange = @import("exchange.zig").Exchange;
const response = @import("response.zig");
const query = @import("../internal/http/query.zig");
const WaveformStore = @import("../internal/delivery/postgres_waveform_store.zig").PostgresWaveformStore;

pub fn get(request: *Exchange, allocator: std.mem.Allocator, store: ?WaveformStore, cors: response.CorsPolicy, request_id: []const u8) !void {
    const uri = subject(allocator, request.target) catch |err| switch (err) {
        error.OutOfMemory => return err,
        else => return response.apiError(request, .invalid_request, request_id, cors),
    };
    const source = store orelse return response.apiError(request, .service_unavailable, request_id, cors);
    const found = source.get(allocator, uri) catch |err| switch (err) {
        error.OutOfMemory => return err,
        else => {
            std.log.err("waveform read failed: {}", .{err});
            return response.apiError(request, .service_unavailable, request_id, cors);
        },
    } orelse return response.apiError(request, .not_found, request_id, cors);
    const encoder = std.base64.standard.Encoder;
    const levels = try allocator.alloc(u8, encoder.calcSize(found.waveform.levels.len));
    _ = encoder.encode(levels, found.waveform.levels);
    const body = try std.json.Stringify.valueAlloc(allocator, .{
        .uri = uri,
        .cid = found.cid,
        .fps = found.waveform.fps,
        .bands = found.waveform.bands,
        .levels = levels,
    }, .{});
    // keyed by the record, not its version: an edit is picked up within the hour
    try response.jsonWithHeaders(request, .ok, body, request_id, cors, &.{
        .{ .name = "cache-control", .value = "public, max-age=3600" },
    });
}

/// The one `uri` parameter, an AT-URI of a track record.
fn subject(allocator: std.mem.Allocator, target: []const u8) ![]const u8 {
    var found: ?[]const u8 = null;
    var pairs = query.Iterator.init(allocator, target);
    while (try pairs.next()) |pair| {
        if (!std.mem.eql(u8, pair.name, "uri") or found != null) return error.InvalidQuery;
        found = pair.value;
    }
    const uri = found orelse return error.InvalidQuery;
    if (!std.mem.startsWith(u8, uri, "at://") or uri.len > 512) return error.InvalidQuery;
    return uri;
}

test "a waveform names exactly one track" {
    var arena_state = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();
    try std.testing.expectEqualStrings("at://did:plc:a/fm.plyr.track/3k", try subject(arena, "/xrpc?uri=at%3A%2F%2Fdid%3Aplc%3Aa%2Ffm.plyr.track%2F3k"));
    try std.testing.expectError(error.InvalidQuery, subject(arena, "/xrpc"));
    try std.testing.expectError(error.InvalidQuery, subject(arena, "/xrpc?uri=at%3A%2F%2Fa&uri=at%3A%2F%2Fb"));
    try std.testing.expectError(error.InvalidQuery, subject(arena, "/xrpc?uri=https%3A%2F%2Fa"));
    try std.testing.expectError(error.InvalidQuery, subject(arena, "/xrpc?uri=at%3A%2F%2Fa&limit=3"));
}
