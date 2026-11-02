const std = @import("std");
const playback = @import("../domain/playback.zig");

pub const PlaybackStore = struct {
    context: *anyopaque,
    get_by_uri_fn: *const fn (*anyopaque, std.mem.Allocator, []const u8) Error!?playback.Candidate,

    pub const Error = error{
        IndexUnavailable,
        CorruptProjection,
        OutOfMemory,
    };

    pub fn getByUri(
        self: PlaybackStore,
        allocator: std.mem.Allocator,
        at_uri: []const u8,
    ) Error!?playback.Candidate {
        return self.get_by_uri_fn(self.context, allocator, at_uri);
    }
};
