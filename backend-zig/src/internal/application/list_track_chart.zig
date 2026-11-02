const std = @import("std");
const track_chart = @import("../domain/track_chart.zig");
const query = @import("../http/query.zig");
const store_module = @import("../index/track_chart_store.zig");
const TrackChartStore = store_module.TrackChartStore;

pub const default_limit: usize = 10;
pub const max_limit: usize = 50;

const Options = struct {
    limit: usize = default_limit,
    period: track_chart.Period = .all_time,
};

pub const Result = union(enum) {
    found: track_chart.Chart,
    invalid_request,
    internal_error,
    unavailable,
};

pub fn execute(
    allocator: std.mem.Allocator,
    store: ?TrackChartStore,
    track_collection: []const u8,
    profile_collection: []const u8,
    like_collection: []const u8,
    target: []const u8,
    now_us: i64,
) Result {
    if (now_us < 0) return .unavailable;
    const options = parseOptions(allocator, target) catch |err| return switch (err) {
        error.OutOfMemory => .unavailable,
        else => .invalid_request,
    };
    const configured_store = store orelse return .unavailable;
    const entries = configured_store.list(allocator, .{
        .track_collection = track_collection,
        .profile_collection = profile_collection,
        .like_collection = like_collection,
        .since_us = sinceMicros(options.period, now_us) catch return .unavailable,
        .limit = options.limit,
    }) catch |err| return switch (err) {
        error.CorruptProjection => .internal_error,
        error.IndexUnavailable, error.OutOfMemory => .unavailable,
    };
    if (entries.len > options.limit) return .internal_error;
    return .{ .found = .{ .period = options.period, .data = entries } };
}

fn parseOptions(allocator: std.mem.Allocator, target: []const u8) !Options {
    var options: Options = .{};
    var saw_limit = false;
    var saw_period = false;
    var pairs = query.Iterator.init(allocator, target);
    while (try pairs.next()) |pair| {
        if (std.mem.eql(u8, pair.name, "limit")) {
            if (saw_limit or pair.value.len == 0) return error.InvalidQuery;
            saw_limit = true;
            options.limit = std.fmt.parseInt(usize, pair.value, 10) catch
                return error.InvalidQuery;
            if (options.limit < 1 or options.limit > max_limit) return error.InvalidQuery;
        } else if (std.mem.eql(u8, pair.name, "period")) {
            if (saw_period or pair.value.len == 0) return error.InvalidQuery;
            saw_period = true;
            options.period = std.meta.stringToEnum(track_chart.Period, pair.value) orelse
                return error.InvalidQuery;
        } else return error.InvalidQuery;
    }
    return options;
}

fn sinceMicros(period: track_chart.Period, now_us: i64) !?i64 {
    const days: ?i64 = switch (period) {
        .all_time => null,
        .month => 30,
        .week => 7,
        .day => 1,
    };
    const delta = if (days) |value|
        try std.math.mul(i64, value, 24 * 60 * 60 * std.time.us_per_s)
    else
        return null;
    return @as(?i64, try std.math.sub(i64, now_us, delta));
}

test "chart query is strict and period windows are exact" {
    const a = std.testing.allocator;
    try std.testing.expectEqual(track_chart.Period.all_time, (try parseOptions(a, "/v1/charts/tracks")).period);
    try std.testing.expectEqual(track_chart.Period.month, (try parseOptions(a, "/v1/charts/tracks?period=month&limit=12")).period);
    try std.testing.expectError(error.InvalidQuery, parseOptions(a, "/v1/charts/tracks?period=year"));
    try std.testing.expectError(error.InvalidQuery, parseOptions(a, "/v1/charts/tracks?limit=0"));
    try std.testing.expectError(error.InvalidQuery, parseOptions(a, "/v1/charts/tracks?limit=51"));
    try std.testing.expect((try sinceMicros(.all_time, 1_000_000)) == null);
    try std.testing.expectEqual(
        @as(?i64, 9 * 24 * 60 * 60 * std.time.us_per_s),
        try sinceMicros(.day, 10 * 24 * 60 * 60 * std.time.us_per_s),
    );
}
