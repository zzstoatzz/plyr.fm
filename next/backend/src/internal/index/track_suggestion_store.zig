const std = @import("std");
const track = @import("../domain/track.zig");

pub const Request = struct {
    track_collection: []const u8,
    profile_collection: []const u8,
    like_collection: []const u8,
    /// Record URIs the suggestions should go with.
    seeds: []const []const u8,
    /// Record URIs the caller already has, such as the rest of the queue.
    exclude: []const []const u8,
    limit: usize,
};

pub const TrackSuggestionStore = struct {
    context: *anyopaque,
    list_fn: *const fn (*anyopaque, std.mem.Allocator, Request) Error![]track.Track,

    pub const Error = error{
        IndexUnavailable,
        CorruptProjection,
        OutOfMemory,
    };

    pub fn list(
        self: TrackSuggestionStore,
        allocator: std.mem.Allocator,
        request: Request,
    ) Error![]track.Track {
        return self.list_fn(self.context, allocator, request);
    }
};
