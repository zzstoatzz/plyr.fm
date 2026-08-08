const std = @import("std");
const track = @import("../domain/track.zig");

pub const TrackStore = struct {
    context: *anyopaque,
    get_by_uri_fn: *const fn (*anyopaque, std.mem.Allocator, []const u8) Error!?track.Track,

    pub const Error = error{
        IndexUnavailable,
        CorruptProjection,
        OutOfMemory,
    };

    pub fn getByUri(
        self: TrackStore,
        allocator: std.mem.Allocator,
        at_uri: []const u8,
    ) Error!?track.Track {
        return self.get_by_uri_fn(self.context, allocator, at_uri);
    }
};
