const std = @import("std");
const track_chart = @import("../domain/track_chart.zig");

pub const Request = struct {
    track_collection: []const u8,
    profile_collection: []const u8,
    since_us: ?i64,
    limit: usize,
};

pub const TrackChartStore = struct {
    context: *anyopaque,
    list_fn: *const fn (*anyopaque, std.mem.Allocator, Request) Error![]track_chart.Entry,

    pub const Error = error{
        IndexUnavailable,
        CorruptProjection,
        OutOfMemory,
    };

    pub fn list(
        self: TrackChartStore,
        allocator: std.mem.Allocator,
        request: Request,
    ) Error![]track_chart.Entry {
        return self.list_fn(self.context, allocator, request);
    }
};
