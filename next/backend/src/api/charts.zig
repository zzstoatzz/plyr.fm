const std = @import("std");
const list_track_chart = @import("../internal/application/list_track_chart.zig");
const TrackChartStore = @import("../internal/index/track_chart_store.zig").TrackChartStore;
const response = @import("response.zig");

pub fn tracks(
    request: *std.http.Server.Request,
    allocator: std.mem.Allocator,
    store: ?TrackChartStore,
    track_collection: []const u8,
    profile_collection: []const u8,
    like_collection: []const u8,
    cors: response.CorsPolicy,
    io: std.Io,
    request_id: []const u8,
) !void {
    const nanoseconds = std.Io.Timestamp.now(io, .real).nanoseconds;
    const now_us = if (nanoseconds >= 0)
        std.math.cast(i64, @divFloor(nanoseconds, 1000)) orelse -1
    else
        -1;
    switch (list_track_chart.execute(
        allocator,
        store,
        track_collection,
        profile_collection,
        like_collection,
        request.head.target,
        now_us,
    )) {
        .found => |value| {
            const body = try std.json.Stringify.valueAlloc(allocator, value, .{});
            try response.json(request, .ok, body, request_id, cors);
        },
        .invalid_request => try response.apiError(request, .invalid_request, request_id, cors),
        .internal_error => try response.apiError(request, .internal_error, request_id, cors),
        .unavailable => try response.apiError(request, .service_unavailable, request_id, cors),
    }
}
